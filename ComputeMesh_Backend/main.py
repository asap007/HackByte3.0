from fastapi import FastAPI, Depends, HTTPException, status, WebSocket, WebSocketDisconnect, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import RedirectResponse, JSONResponse
from sqlalchemy.orm import Session
import models, schemas, auth
from database import engine, SessionLocal, redis_client
from command_dispatcher import manager # Assuming manager is correctly configured
from datetime import timedelta, datetime
import logging
import asyncio
from typing import List, Dict, Any, Optional
from fastapi.security import OAuth2PasswordBearer, OAuth2PasswordRequestForm
from pydantic import BaseModel
from prometheus_fastapi_instrumentator import Instrumentator
# import httpx # No longer needed for direct Cortex calls from server
import json
import os
import re
from urllib.parse import urlparse

# --- Configuration ---
# CORTEX_API_BASE_URL = os.getenv("CORTEX_API_URL", "http://127.0.0.1:39281") # Client handles this now
# CORTEX_ENGINE_NAME = os.getenv("CORTEX_ENGINE_NAME", "llama-cpp") # Client handles this now
TARGET_CLIENT_USER_ID = 1 # The user_id of the client running Cortex

# --- State Variables (Managed by Server based on Client Feedback) ---
# These track the *assumed* state of the client node (user_id=1)
# They should be updated based on responses received from the client via WebSocket
cortex_engine_loaded: bool = False # Assume not loaded initially
currently_loaded_model_id: Optional[str] = None # Assume no model loaded initially
# model_pull_tasks: Dict[str, Dict[str, Any]] = {} # Tracking pull tasks accurately requires more complex client<->server communication. Simplified for now.

# Setup logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Create database tables
models.Base.metadata.create_all(bind=engine)

app = FastAPI()

# Add Prometheus instrumentation
Instrumentator().instrument(app).expose(app)

# CORS configuration
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Dependency to get DB session
def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

# --- Schemas (Ensure CommandRequest is defined correctly in schemas.py) ---
class DeviceRegistrationRequest(BaseModel):
    device_id: str

# Assuming schemas.CommandRequest has method, url, data fields
# Example (should be in schemas.py):
# class CommandRequest(BaseModel):
#     method: str
#     url: str
#     data: Optional[Dict[str, Any]] = None

class ChatCompletionRequest(BaseModel):
    model: str
    messages: List[schemas.ChatMessage]
    stream: bool = False
    max_tokens: int = 512
    temperature: float = 0.6
    top_p: float = 0.9
    frequency_penalty: float = 0
    presence_penalty: float = 0

class ModelPullRequest(BaseModel):
    model: str  # Can be model ID or HuggingFace URL
    name: Optional[str] = None  # Optional custom name

class ModelStatusResponse(BaseModel):
    loaded: Optional[str]
    engine_loaded: bool
    available_models: List[Dict[str, Any]]
    # download_tasks: Dict[str, Dict[str, Any]] # Simplified, see note above

# --- Helper Functions ---

async def send_command_to_client(user_id: int, command: schemas.CommandRequest, timeout: int = 60) -> Any:
    """Sends a command via WebSocket manager and waits for the response."""
    try:
        future = await manager.send_command(user_id, command)
        result_str = await asyncio.wait_for(future, timeout=timeout)
        logger.info(f"Received response via WebSocket from user {user_id} for command {command.url}: {result_str}")
        try:
            # Assume client sends back JSON string representation of Cortex response
            result_data = json.loads(result_str)
            # Check for potential error structure from client/Cortex
            if isinstance(result_data, dict) and result_data.get("error"):
                 logger.error(f"Client {user_id} reported error for command {command.url}: {result_data}")
                 # Re-raise as HTTPException or return error structure
                 raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=f"Error from client node: {result_data.get('error')}")
            return result_data
        except json.JSONDecodeError:
            logger.warning(f"Response from user {user_id} for command {command.url} was not valid JSON: {result_str}")
            # Depending on expected behavior, might return raw string or raise error
            return {"raw_response": result_str} # Or raise HTTPException
        except HTTPException as e:
            raise e # Propagate errors reported by client
        except Exception as e:
            logger.error(f"Error processing response from user {user_id} for command {command.url}: {e}")
            raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=f"Error processing client response: {e}")

    except ConnectionError as e:
        logger.error(f"Failed to send command to user {user_id} (Not connected?): {e}")
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"Client {user_id} not connected or command failed: {e}")
    except asyncio.TimeoutError:
        logger.error(f"Timeout waiting for response from user {user_id} for command {command.url}.")
        raise HTTPException(status_code=status.HTTP_504_GATEWAY_TIMEOUT, detail=f"Timeout waiting for response from client {user_id}.")
    except Exception as e:
        logger.error(f"Unexpected error sending command via manager to user {user_id}: {e}")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=f"Server error sending command: {e}")


def extract_model_id_from_url(model_url: str) -> str:
    """Extract a standardized model ID from a HuggingFace URL (remains on server)"""
    try:
        parsed = urlparse(model_url)
        if not parsed.netloc.endswith("huggingface.co"):
            raise ValueError("URL must be from huggingface.co domain")

        path_parts = parsed.path.strip("/").split("/")
        if len(path_parts) < 3:
            raise ValueError("Invalid HuggingFace model URL format")

        # Extract org/repo/filename
        org = path_parts[0]
        repo = path_parts[1]
        filename = path_parts[-1]

        # Create standardized ID format: org:repo:filename
        return f"{org}:{repo}:{filename}"
    except Exception as e:
        logger.error(f"Error parsing model URL: {e}")
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid model URL format: {str(e)}"
        )

# --- API Endpoints ---

@app.post("/v1/models/pull")
async def pull_model_endpoint(request: ModelPullRequest, token: str = Depends(auth.oauth2_scheme)):
    """Sends a command to the client (user_id=1) to pull a model."""
    auth.get_current_user(token, SessionLocal())  # Verify auth

    try:
        # Determine model identifier (URL or ID) - resolve URL on server
        if request.model.startswith("http"):
            model_id = extract_model_id_from_url(request.model)
        else:
            model_id = request.model

        command = schemas.CommandRequest(
            method="POST",
            url="/v1/models/pull", # Cortex relative endpoint
            data={"model": model_id} # Data payload for Cortex
        )
        logger.info(f"Sending pull command for model '{model_id}' to client {TARGET_CLIENT_USER_ID}")
        response_data = await send_command_to_client(TARGET_CLIENT_USER_ID, command, timeout=300) # Longer timeout for pulls

        # Optional: Update server state based on response if needed (e.g., track task ID)
        # task_id = response_data.get("task", {}).get("id")
        # if task_id:
        #     model_pull_tasks[task_id] = {...} # Complex to track progress accurately here

        return JSONResponse(content=response_data)

    except HTTPException as e:
        raise e # Propagate specific HTTP errors
    except Exception as e:
        logger.exception("Unexpected error processing model pull request")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=f"Internal server error: {e}")


@app.post("/v1/chat/completions")
async def chat_completion(request: ChatCompletionRequest, token: str = Depends(auth.oauth2_scheme)):
    """Sends commands to the client (user_id=1) to ensure model is loaded and perform chat completion."""
    global currently_loaded_model_id, cortex_engine_loaded
    auth.get_current_user(token, SessionLocal())

    target_model_id = request.model

    try:
        # --- Step 1: Ensure Engine Loaded (Send command if server state indicates not loaded) ---
        # Note: This relies on server state, which might drift from client state.
        # A more robust approach would be to always ask the client or have client report status.
        if not cortex_engine_loaded:
            logger.info(f"Server state indicates engine not loaded. Sending load engine command to client {TARGET_CLIENT_USER_ID}.")
            # Assuming CORTEX_ENGINE_NAME is known/configured on the client side
            # The client needs to know its engine name. We send the command to load *its* configured engine.
            # If multiple engines are possible, the command might need engine name in data.
            # Simple approach: client loads its default engine upon receiving this command.
            engine_load_command = schemas.CommandRequest(
                method="POST",
                url="/v1/engines/load", # Simplified - Client knows its engine
                # Or url=f"/v1/engines/{CORTEX_ENGINE_NAME}/load" if client needs name
                data=None # Or {"engine_name": CORTEX_ENGINE_NAME} if needed
            )
            try:
                await send_command_to_client(TARGET_CLIENT_USER_ID, engine_load_command, timeout=60)
                cortex_engine_loaded = True # Assume success if no exception
                logger.info(f"Engine load command sent successfully to client {TARGET_CLIENT_USER_ID}. Assuming engine loaded.")
            except Exception as e:
                logger.error(f"Failed to send/process engine load command to client {TARGET_CLIENT_USER_ID}: {e}")
                raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=f"Failed to ensure backend engine is loaded on client: {e}")

        # --- Step 2: Ensure Correct Model Loaded (Send commands if needed) ---
        if currently_loaded_model_id != target_model_id:
            logger.info(f"Model needs changing. Current: '{currently_loaded_model_id}', Target: '{target_model_id}'. Sending commands to client {TARGET_CLIENT_USER_ID}.")

            # Optional: Stop current model (best effort)
            if currently_loaded_model_id:
                try:
                    stop_command = schemas.CommandRequest(
                        method="POST",
                        url="/v1/models/stop",
                        data={"model": currently_loaded_model_id}
                    )
                    logger.info(f"Sending stop command for model '{currently_loaded_model_id}' to client {TARGET_CLIENT_USER_ID}")
                    await send_command_to_client(TARGET_CLIENT_USER_ID, stop_command, timeout=60)
                except Exception as e:
                    logger.warning(f"Failed to send/process stop command for model '{currently_loaded_model_id}' to client {TARGET_CLIENT_USER_ID} (continuing anyway): {e}")
                    # Don't halt the process if stopping fails, maybe it wasn't running

            # Start new model
            start_command = schemas.CommandRequest(
                method="POST",
                url="/v1/models/start",
                data={"model": target_model_id}
            )
            logger.info(f"Sending start command for model '{target_model_id}' to client {TARGET_CLIENT_USER_ID}")
            try:
                await send_command_to_client(TARGET_CLIENT_USER_ID, start_command, timeout=120) # Longer timeout for model loads
                currently_loaded_model_id = target_model_id # Update server state *after* success
                logger.info(f"Successfully sent start command for model '{target_model_id}' to client {TARGET_CLIENT_USER_ID}.")
            except Exception as e:
                logger.error(f"Failed to send/process start command for model '{target_model_id}' to client {TARGET_CLIENT_USER_ID}: {e}")
                currently_loaded_model_id = None # Reset state as load failed
                raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=f"Failed to start requested model '{target_model_id}' on client: {e}")
        else:
             logger.info(f"Model '{target_model_id}' is already assumed loaded on client {TARGET_CLIENT_USER_ID}.")


        # --- Step 3: Forward Chat Completion Request ---
        chat_command = schemas.CommandRequest(
            method="POST",
            url="/v1/chat/completions",
            data=request.dict() # Send the original request payload
        )
        logger.info(f"Sending chat completion command to client {TARGET_CLIENT_USER_ID}")
        response_data = await send_command_to_client(TARGET_CLIENT_USER_ID, chat_command, timeout=180) # Timeout for completion

        return JSONResponse(content=response_data)

    except HTTPException as e:
        raise e # Propagate specific HTTP errors
    except Exception as e:
        logger.exception("Unexpected error processing chat completion request")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=f"Internal server error: {e}")


@app.get("/v1/models")
async def list_models(token: str = Depends(auth.oauth2_scheme)):
    """Gets the list of available models from the client (user_id=1) via WebSocket."""
    auth.get_current_user(token, SessionLocal())

    try:
        command = schemas.CommandRequest(
            method="GET",
            url="/v1/models",
            data=None
        )
        logger.info(f"Sending list models command to client {TARGET_CLIENT_USER_ID}")
        response_data = await send_command_to_client(TARGET_CLIENT_USER_ID, command)

        # Ensure the response structure matches expectation (e.g., {"data": [...]})
        available_models = response_data.get("data", [])
        if not isinstance(available_models, list):
             logger.error(f"Received unexpected format for model list from client {TARGET_CLIENT_USER_ID}: {response_data}")
             available_models = [] # Default to empty list on error

        return {
            "data": available_models,
            # Server's *assumed* state based on last known successful operations
            "loaded": currently_loaded_model_id,
            "engine_loaded": cortex_engine_loaded,
            # "download_tasks": model_pull_tasks # Simplified
        }
    except HTTPException as e:
        raise e
    except Exception as e:
        logger.exception("Error getting model list via WebSocket")
        # Return server state even if client call fails? Or fail completely?
        # Failing completely might be better to avoid inconsistent info.
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=f"Could not retrieve models from client node: {e}")


@app.get("/v1/models/status")
async def model_status(token: str = Depends(auth.oauth2_scheme)):
    """Gets available models from client (user_id=1) and combines with server's assumed state."""
    auth.get_current_user(token, SessionLocal())
    available_models = []
    try:
        command = schemas.CommandRequest(
            method="GET",
            url="/v1/models", # Reuse the models list endpoint on client
            data=None
        )
        logger.info(f"Sending get models command for status check to client {TARGET_CLIENT_USER_ID}")
        response_data = await send_command_to_client(TARGET_CLIENT_USER_ID, command)
        
        models_list = response_data.get("data", [])
        if isinstance(models_list, list):
            available_models = models_list
        else:
            logger.warning(f"Received non-list format for available models from client {TARGET_CLIENT_USER_ID}: {response_data}")

    except Exception as e:
        # Log the error but proceed to return server state, maybe indicating client state is unavailable
        logger.error(f"Could not retrieve available models from client {TARGET_CLIENT_USER_ID} for status check: {e}")
        # Optionally add an error indicator to the response

    return ModelStatusResponse(
        loaded=currently_loaded_model_id,
        engine_loaded=cortex_engine_loaded,
        available_models=available_models, # Return what we got, or empty list if error
        # download_tasks=model_pull_tasks # Simplified
    )


# --- Existing Endpoints (Unchanged - Keep as they are) ---

# Device Registration Endpoint
@app.post("/device-registration")
def device_registration(request: DeviceRegistrationRequest, db: Session = Depends(get_db)):
    device = db.query(models.Device).filter(models.Device.device_id == request.device_id).first()
    if device:
        return {"status": "already recorded"}
    new_device = models.Device(device_id=request.device_id, registered_date=datetime.utcnow())
    db.add(new_device)
    db.commit()
    return {"status": "registered"}

# User Registration Endpoint
@app.post("/register", response_model=schemas.UserOut)
def register(user: schemas.UserCreate, db: Session = Depends(get_db)):
    db_user = db.query(models.User).filter(models.User.email == user.email).first()
    if db_user:
        raise HTTPException(status_code=400, detail="Email already registered")

    if user.wallet_address:
        if not re.match(r'^0x[0-9a-fA-F]{64}$', user.wallet_address):
            raise HTTPException(
                status_code=400,
                detail="Invalid Aptos wallet address format"
            )
        if db.query(models.User).filter(models.User.wallet_address == user.wallet_address).first():
            raise HTTPException(
                status_code=400,
                detail="Wallet address already in use"
            )

    hashed_password = auth.get_password_hash(user.password)
    new_user = models.User(
        email=user.email,
        name=user.name,
        hashed_password=hashed_password,
        wallet_address=user.wallet_address if user.wallet_address else None
    )
    db.add(new_user)
    db.commit()
    db.refresh(new_user)
    return new_user

# Token Endpoint
@app.post("/token", response_model=schemas.Token)
def login_for_access_token(form_data: OAuth2PasswordRequestForm = Depends(), db: Session = Depends(get_db)):
    user = auth.authenticate_user(db, form_data.username, form_data.password)
    if not user:
        logger.warning(f"Failed login attempt for user: {form_data.username}")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect username or password",
            headers={"WWW-Authenticate": "Bearer"},
        )
    access_token_expires = timedelta(minutes=auth.ACCESS_TOKEN_EXPIRE_MINUTES)
    access_token = auth.create_access_token(
        data={"sub": user.email}, expires_delta=access_token_expires
    )
    logger.info(f"User logged in: {user.email}")
    return {"access_token": access_token, "token_type": "bearer"}


# WebSocket Endpoint (Crucial for receiving commands and sending responses)
@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket, token: str):
    # Authentication logic remains the same
    try:
        payload = auth.jwt.decode(token, auth.SECRET_KEY, algorithms=[auth.ALGORITHM])
        username: str = payload.get("sub")
        if username is None:
            logger.warning("WebSocket connection attempted without username in token.")
            await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
            return
        # Use a context manager for the session
        with SessionLocal() as db:
            user = auth.get_user(db, email=username)
        if user is None:
            logger.warning(f"WebSocket connection attempted with invalid user: {username}")
            await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
            return
    except (auth.JWTError, Exception) as e:
        logger.error(f"WebSocket authentication failed: {e}")
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
        return

    # Connect the user to the manager
    await manager.connect(websocket, user.id)
    logger.info(f"WebSocket connection established for user: {username} (ID: {user.id})")
    
    # If this is the designated client, maybe update server state?
    if user.id == TARGET_CLIENT_USER_ID:
        logger.info(f"Designated Cortex client (user_id={TARGET_CLIENT_USER_ID}) connected.")
        # Potentially reset/query initial state here if needed
        # Example: Trigger a status check command upon connection
        # asyncio.create_task(send_command_to_client(TARGET_CLIENT_USER_ID, schemas.CommandRequest(method="GET", url="/v1/models/status"))) # Fire-and-forget status check? Needs careful handling.

    try:
        while True:
            # Listen for responses/messages from the client
            data = await websocket.receive_text()
            logger.debug(f"Received raw message from user {username} (ID: {user.id}): {data}")
            # Manager handles correlating responses to commands
            await manager.receive_response(data) # Manager needs to parse response and find matching future
    except WebSocketDisconnect:
        logger.info(f"WebSocket connection closed for user: {username} (ID: {user.id})")
        if user.id == TARGET_CLIENT_USER_ID:
             logger.warning(f"Designated Cortex client (user_id={TARGET_CLIENT_USER_ID}) disconnected.")
             # Reset server's assumed state for the client
             global currently_loaded_model_id, cortex_engine_loaded
             currently_loaded_model_id = None
             cortex_engine_loaded = False
    except Exception as e:
        logger.error(f"WebSocket error for user {username} (ID: {user.id}): {e}")
    finally:
        # Ensure disconnection cleanup
        await manager.disconnect(user.id)
        if user.id == TARGET_CLIENT_USER_ID:
            logger.info(f"Cleaned up connection manager for disconnected Cortex client (user_id={TARGET_CLIENT_USER_ID}).")
            # State already reset in disconnect handler


# Generic Command Dispatch Endpoint (Remains useful for other commands/clients)
@app.post("/send-command/{user_id}")
async def send_command(user_id: int, command_request: schemas.CommandRequest, db: Session = Depends(get_db)):
    # This endpoint remains, but shouldn't be used for the primary Cortex interactions anymore
    # unless you specifically want to target *other* clients with generic commands.
    # Authentication/Authorization might be needed here depending on use case.
    user = db.query(models.User).filter(models.User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    logger.info(f"Received generic command request for user {user_id} via /send-command endpoint: {command_request}")
    # Use the helper, but be mindful this bypasses the specific logic in Cortex endpoints
    response_data = await send_command_to_client(user_id, command_request)
    return {"message": f"Generic command sent to user '{user.email}' (ID: {user_id})", "response": response_data}


# Example Broadcast Command Endpoint (Remains unchanged)
@app.post("/broadcast-command")
async def broadcast_command(command_request: schemas.CommandRequest):
    # This interacts with manager directly, remains unchanged
    try:
        results = await manager.broadcast_command(command_request)
        return {"message": f"Command broadcasted to all connected users.", "results": results}
    except Exception as e:
        logger.error(f"Error broadcasting command: {e}")
        raise HTTPException(status_code=500, detail=str(e))

# --- Other existing endpoints (Unchanged) ---
@app.get("/public-stats", response_model=schemas.PublicStats)
def get_public_stats():
    # Simplification: Get active connections from manager if possible
    active_nodes = len(manager.connections) if hasattr(manager, 'connections') else 2000 # Example fallback
    return schemas.PublicStats(
        active_nodes=active_nodes,
        dllm_price={"yesterday": 0.073, "current": 0.1},
        btc_price={"yesterday": 93825.89, "current": 100000.00},
        twitter_link="https://x.com/AnshulSingh5180",
        discord_link="https://discord.gg/computemesh", # Example Discord Link
        online_discord_users=500, # Static example
        twitter_followers=3000 # Static example
    )

@app.get("/user", response_model=schemas.UserDashboard)
def get_user_info(token: str = Depends(auth.oauth2_scheme), db: Session = Depends(get_db)):
    current_user = auth.get_current_user(token, db)
    # Ensure these attributes exist on your models.User or handle missing ones
    return schemas.UserDashboard(
        email=current_user.email,
        name=getattr(current_user, 'name', None),
        profile_picture=getattr(current_user, 'profile_picture', None),
        dllm_tokens=getattr(current_user, 'dllm_tokens', 0), # Default to 0 if missing
        referral_link=getattr(current_user, 'referral_link', None),
        wallet_address=getattr(current_user, 'wallet_address', None)
    )

@app.post("/user/points")
def add_points(points: int, token: str = Depends(auth.oauth2_scheme), db: Session = Depends(get_db)):
    current_user = auth.get_current_user(token, db)
    if hasattr(current_user, 'dllm_tokens') and current_user.dllm_tokens is not None:
         current_user.dllm_tokens += points
    else:
         # If 'dllm_tokens' doesn't exist or is None, initialize it
         logger.warning(f"User {current_user.email} 'dllm_tokens' attribute missing or None. Initializing to {points}.")
         current_user.dllm_tokens = points
         # return {"detail": "User does not have points tracking enabled.", "total_points": None} # Old behavior

    db.commit()
    db.refresh(current_user)
    return {"detail": f"{points} points added.", "total_points": current_user.dllm_tokens}


@app.get("/leaderboard/users", response_model=List[schemas.LeaderboardUser])
def get_user_leaderboard(db: Session = Depends(get_db)):
    # Replace dummy data with actual query
    users = db.query(models.User).order_by(models.User.dllm_tokens.desc().nullslast()).limit(10).all()
    return [
        schemas.LeaderboardUser(
            username=u.name or u.email.split('@')[0], # Use name or part of email
            profile_picture=u.profile_picture,
            score=u.dllm_tokens if u.dllm_tokens is not None else 0
        ) for u in users
    ]
    # Dummy data (keep commented for reference):
    # return [
    #     {"username": "John Doe", "profile_picture": None, "score": 90},
    #     # ... other dummy data
    # ]

@app.get("/leaderboard/agents", response_model=List[schemas.LeaderboardAgent])
def get_agent_leaderboard():
     # Replace with actual data if available
    return [
        {"agent_name": "GPT-4 Turbo", "agent_link": "#", "score": 98},
        {"agent_name": "Claude 3 Opus", "agent_link": "#", "score": 97},
        {"agent_name": "Gemini Pro", "agent_link": "#", "score": 96},
        {"agent_name": "Llama 3 70B", "agent_link": "#", "score": 95},
        {"agent_name": "Mixtral 8x7B", "agent_link": "#", "score": 94},
    ]

@app.get("/signup")
def signup():
    return RedirectResponse(url="https://computemesh.network/") # Redirect to main site or specific page

@app.patch("/user/wallet", response_model=schemas.WalletResponse)
def update_wallet_address(
    wallet_update: schemas.WalletUpdate,
    token: str = Depends(auth.oauth2_scheme),
    db: Session = Depends(get_db)
):
    current_user = auth.get_current_user(token, db)
    wallet_address = wallet_update.wallet_address

    if not re.match(r'^0x[0-9a-fA-F]{64}$', wallet_address):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid Aptos address format. Must be 0x followed by 64 hex characters."
        )

    existing_user = db.query(models.User).filter(
        models.User.wallet_address == wallet_address,
        models.User.id != current_user.id
    ).first()

    if existing_user:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="This wallet address is already associated with another account."
        )

    current_user.wallet_address = wallet_address
    db.commit()
    db.refresh(current_user)

    return {
        "message": "Wallet address updated successfully",
        "wallet_address": current_user.wallet_address
    }

@app.get("/wallet/check-availability/{wallet_address}")
def check_wallet_availability(
    wallet_address: str,
    db: Session = Depends(get_db)
):
    if not re.match(r'^0x[0-9a-fA-F]{64}$', wallet_address):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid Aptos address format. Must be 0x followed by 64 hex characters."
        )

    exists = db.query(models.User).filter(
        models.User.wallet_address == wallet_address
    ).first() is not None

    return {"available": not exists}

@app.get("/survey")
def survey():
     return {"message": "ComputeMesh Survey is Coming Soon, Hang Tight!🚀"}

@app.get("/leaderboard/agents/all")
def get_all_agents():
    return {"message": "Cooking. Hang Tight!🚀"}