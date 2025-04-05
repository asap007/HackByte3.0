from fastapi import FastAPI, Depends, HTTPException, status, WebSocket, WebSocketDisconnect, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import RedirectResponse, JSONResponse
from sqlalchemy.orm import Session
import models, schemas, auth
from database import engine, SessionLocal, redis_client
from command_dispatcher import manager
from datetime import timedelta, datetime
import logging
import asyncio
from typing import List, Dict, Any, Optional
from fastapi.security import OAuth2PasswordBearer, OAuth2PasswordRequestForm
from pydantic import BaseModel
from prometheus_fastapi_instrumentator import Instrumentator
import httpx
import json
import os
import re
from urllib.parse import urlparse

# --- Cortex Configuration ---
CORTEX_API_BASE_URL = os.getenv("CORTEX_API_URL", "http://127.0.0.1:39281")
CORTEX_ENGINE_NAME = os.getenv("CORTEX_ENGINE_NAME", "llama-cpp")

# --- State Variables ---
cortex_engine_loaded = False
currently_loaded_model_id: Optional[str] = None
model_pull_tasks: Dict[str, Dict[str, Any]] = {}  # Track ongoing model downloads

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

# --- Schemas ---
class DeviceRegistrationRequest(BaseModel):
    device_id: str

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
    download_tasks: Dict[str, Dict[str, Any]]

# --- Helper Functions ---
async def call_cortex_api(
    method: str,
    endpoint: str,
    payload: Optional[Dict[str, Any]] = None,
    expected_status: int = 200
) -> Dict[str, Any]:
    """Helper function to make calls to the Cortex API."""
    url = f"{CORTEX_API_BASE_URL}{endpoint}"
    async with httpx.AsyncClient(timeout=60.0) as client:
        try:
            logger.info(f"Calling Cortex API: {method} {url} Payload: {payload}")
            if method.upper() == "POST":
                response = await client.post(url, json=payload)
            elif method.upper() == "GET":
                response = await client.get(url)
            else:
                raise ValueError(f"Unsupported HTTP method: {method}")

            logger.info(f"Cortex API Response Status: {response.status_code}")
            
            if not response.text:
                if response.status_code == expected_status:
                    logger.info(f"Cortex API returned empty response with status {response.status_code}")
                    return {"message": "Operation successful (empty response)"}
                raise HTTPException(
                    status_code=status.HTTP_502_BAD_GATEWAY,
                    detail="Cortex API returned an empty error response."
                )

            try:
                response_data = response.json()
                if response.status_code != expected_status:
                    logger.error(f"Cortex API Error ({response.status_code}): {response_data}")
                    raise HTTPException(
                        status_code=status.HTTP_502_BAD_GATEWAY,
                        detail=f"Error from Cortex API: {response_data}"
                    )
                return response_data
            except json.JSONDecodeError:
                logger.error(f"Cortex API Error: Failed to decode JSON response")
                raise HTTPException(
                    status_code=status.HTTP_502_BAD_GATEWAY,
                    detail="Cortex API returned non-JSON response"
                )

        except httpx.RequestError as e:
            logger.error(f"Error connecting to Cortex API at {url}: {e}")
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail=f"Could not connect to Cortex API: {e}"
            )
        except Exception as e:
            logger.error(f"An unexpected error occurred during Cortex API call: {e}")
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail=f"An internal error occurred: {e}"
            )

async def get_available_models() -> List[Dict[str, Any]]:
    """Get list of available models from Cortex"""
    try:
        response = await call_cortex_api("GET", "/v1/models")
        return response.get("data", [])
    except Exception as e:
        logger.error(f"Error getting available models: {e}")
        return []

def extract_model_id_from_url(model_url: str) -> str:
    """Extract a standardized model ID from a HuggingFace URL"""
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

async def pull_model(model_identifier: str) -> Dict[str, Any]:
    """Pull a model from HuggingFace"""
    try:
        # Determine if it's a URL or ID
        if model_identifier.startswith("http"):
            model_id = extract_model_id_from_url(model_identifier)
        else:
            model_id = model_identifier
        
        # Start the download
        response = await call_cortex_api(
            "POST",
            "/v1/models/pull",
            {"model": model_id}
        )
        
        # Track the download task
        task_id = response.get("task", {}).get("id", model_id)
        model_pull_tasks[task_id] = {
            "status": "downloading",
            "model_id": model_id,
            "start_time": datetime.utcnow(),
            "response": response
        }
        
        return response
    except HTTPException as e:
        raise e
    except Exception as e:
        logger.error(f"Error pulling model: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to pull model: {str(e)}"
        )

async def ensure_model_loaded(target_model_id: str) -> bool:
    """Ensure the specified model is loaded, switching if needed"""
    global currently_loaded_model_id, cortex_engine_loaded
    
    # 1. Load Engine (if not already done)
    if not cortex_engine_loaded:
        logger.info(f"Cortex engine '{CORTEX_ENGINE_NAME}' not loaded yet. Attempting to load.")
        try:
            await call_cortex_api(
                "POST", 
                f"/v1/engines/{CORTEX_ENGINE_NAME}/load"
            )
            cortex_engine_loaded = True
            logger.info(f"Cortex engine '{CORTEX_ENGINE_NAME}' loaded successfully.")
        except HTTPException as e:
            logger.error(f"Failed to load Cortex engine: {e.detail}")
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="Failed to load the backend inference engine."
            )

    # 2. Check if model needs to be changed
    if currently_loaded_model_id == target_model_id:
        logger.info(f"Model '{target_model_id}' is already loaded.")
        return True
    
    # 3. Stop currently loaded model if any
    if currently_loaded_model_id:
        try:
            await call_cortex_api(
                "POST", 
                "/v1/models/stop",
                {"model": currently_loaded_model_id}
            )
            logger.info(f"Stopped previous model: {currently_loaded_model_id}")
        except HTTPException as e:
            logger.warning(f"Error stopping previous model: {e.detail}")
            # Continue anyway - might already be stopped
    
    # 4. Start new model
    try:
        await call_cortex_api(
            "POST",
            "/v1/models/start",
            {"model": target_model_id}
        )
        currently_loaded_model_id = target_model_id
        logger.info(f"Successfully switched to model: {target_model_id}")
        return True
    except HTTPException as e:
        currently_loaded_model_id = None
        logger.error(f"Failed to start model '{target_model_id}': {e.detail}")
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=f"Failed to start the requested model '{target_model_id}': {e.detail}"
        )

# --- API Endpoints ---
@app.post("/v1/models/pull")
async def pull_model_endpoint(request: ModelPullRequest, token: str = Depends(auth.oauth2_scheme)):
    """Pull a model from HuggingFace"""
    auth.get_current_user(token, SessionLocal())  # Verify auth
    
    try:
        response = await pull_model(request.model)
        return JSONResponse(content=response)
    except HTTPException as e:
        raise e
    except Exception as e:
        logger.exception("Unexpected error in model pull")
        raise HTTPException(500, "Internal server error")

@app.post("/v1/chat/completions")
async def chat_completion(request: ChatCompletionRequest, token: str = Depends(auth.oauth2_scheme)):
    """Handle chat completion with model switching"""
    auth.get_current_user(token, SessionLocal())
    
    try:
        # Ensure the requested model is loaded
        await ensure_model_loaded(request.model)
        
        # Forward to Cortex
        cortex_response = await call_cortex_api(
            "POST",
            "/v1/chat/completions",
            request.dict()
        )
        return JSONResponse(content=cortex_response)
    except HTTPException as e:
        raise e
    except Exception as e:
        logger.exception("Unexpected error in chat completion")
        raise HTTPException(500, "Internal server error")

@app.get("/v1/models")
async def list_models(token: str = Depends(auth.oauth2_scheme)):
    """Get available models and their status"""
    auth.get_current_user(token, SessionLocal())
    
    try:
        models = await get_available_models()
        return {
            "data": models,
            "loaded": currently_loaded_model_id,
            "engine_loaded": cortex_engine_loaded,
            "download_tasks": model_pull_tasks
        }
    except Exception as e:
        logger.exception("Error getting model list")
        raise HTTPException(500, "Could not retrieve models")

@app.get("/v1/models/status")
async def model_status(token: str = Depends(auth.oauth2_scheme)):
    """Check current model status"""
    auth.get_current_user(token, SessionLocal())
    return ModelStatusResponse(
        loaded=currently_loaded_model_id,
        engine_loaded=cortex_engine_loaded,
        available_models=await get_available_models(),
        download_tasks=model_pull_tasks
    )


# --- Existing Endpoints (Keep them as they are) ---

# Device Registration Endpoint
@app.post("/device-registration")
def device_registration(request: DeviceRegistrationRequest, db: Session = Depends(get_db)):
    # ... (existing code)
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
    # Existing validation
    db_user = db.query(models.User).filter(models.User.email == user.email).first()
    if db_user:
        raise HTTPException(status_code=400, detail="Email already registered")

    # Wallet address validation if provided
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
    # ... (existing code)
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


# WebSocket Endpoint
@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket, token: str):
    # ... (existing code - assuming this talks to nodes directly, not Cortex)
    try:
        payload = auth.jwt.decode(token, auth.SECRET_KEY, algorithms=[auth.ALGORITHM])
        username: str = payload.get("sub")
        if username is None:
            logger.warning("WebSocket connection attempted without username in token.")
            await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
            return
        db = SessionLocal() # Create new session for async context
        user = auth.get_user(db, email=username)
        db.close() # Close session after use
        if user is None:
            logger.warning(f"WebSocket connection attempted with invalid user: {username}")
            await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
            return
    except (auth.JWTError, Exception) as e:
        logger.error(f"WebSocket authentication failed: {e}")
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
        return

    await manager.connect(websocket, user.id)
    logger.info(f"WebSocket connection established for user: {username}")
    try:
        while True:
            data = await websocket.receive_text()
            logger.info(f"Received message from user {username}: {data}")
            await manager.receive_response(data) # Assumes manager handles node responses
    except WebSocketDisconnect:
        logger.info(f"WebSocket connection closed for user: {username}")
    except Exception as e:
        logger.error(f"WebSocket error for user {username}: {e}")
    finally:
        # Ensure disconnect is called even if errors occur within the loop
        await manager.disconnect(user.id)


# Command Dispatch Endpoint (If this is meant for your nodes, keep it)
@app.post("/send-command/{user_id}")
async def send_command(user_id: int, command_request: schemas.CommandRequest, db: Session = Depends(get_db)):
    # ... (existing code - assuming this talks to nodes directly, not Cortex)
    user = db.query(models.User).filter(models.User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    # Assuming CommandRequest has 'method', 'url', 'data' like before
    # command = command_request.url
    try:
        future = await manager.send_command(user_id, command_request) # Send to specific node via manager
        result = await asyncio.wait_for(future, timeout=30) # Wait for node response
        logger.info(f"Received response for command to user '{user.email}': {result}")
        # Process result as needed, maybe parse if it's JSON string
        try:
            response_data = json.loads(result)
        except json.JSONDecodeError:
            response_data = result # Keep as string if not JSON
        return {"message": f"Command sent to user '{user.email}'", "response": response_data}
    except ConnectionError as e:
        logger.error(f"Failed to send command to user '{user.email}': {e}")
        raise HTTPException(status_code=400, detail=str(e))
    except asyncio.TimeoutError:
        logger.error(f"Timeout waiting for response for command for user '{user.email}'.")
        raise HTTPException(status_code=504, detail="Timeout waiting for command response.")
    except Exception as e:
        logger.error(f"Error sending command via manager: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# Example Broadcast Command Endpoint (If this is meant for your nodes, keep it)
@app.post("/broadcast-command")
async def broadcast_command(command_request: schemas.CommandRequest):
    # ... (existing code - assuming this talks to nodes directly, not Cortex)
    # command = command_request.command # Assuming structure
    # data = command_request.data
    try:
        # Assuming manager.broadcast_command takes the whole request or parts
        results = await manager.broadcast_command(command_request)
        return {"message": f"Command broadcasted to all connected users.", "results": results}
    except Exception as e:
        logger.error(f"Error broadcasting command: {e}")
        raise HTTPException(status_code=500, detail=str(e))

# --- Other existing endpoints ---
@app.get("/public-stats", response_model=schemas.PublicStats)
def get_public_stats():
    # ... (existing code)
    return schemas.PublicStats(
        active_nodes=2000, # Maybe update this based on manager.get_active_connections_count() if manager has it
        dllm_price={"yesterday": 0.073, "current": 0.1},
        btc_price={"yesterday": 93825.89, "current": 100000.00},
        twitter_link="https://x.com/AnshulSingh5180",
        discord_link="https://x.com/AnshulSingh5180",
        online_discord_users=500,
        twitter_followers=3000
    )

@app.get("/user", response_model=schemas.UserDashboard)
def get_user_info(token: str = Depends(auth.oauth2_scheme), db: Session = Depends(get_db)):
    current_user = auth.get_current_user(token, db)
    return schemas.UserDashboard(
        email=current_user.email,
        name=current_user.name,
        profile_picture=current_user.profile_picture,
        dllm_tokens=current_user.dllm_tokens,
        referral_link=current_user.referral_link,
        wallet_address=current_user.wallet_address  # Added this line
    )


@app.post("/user/points")
def add_points(points: int, token: str = Depends(auth.oauth2_scheme), db: Session = Depends(get_db)):
    # ... (existing code - make sure user model has dllm_tokens)
    current_user = auth.get_current_user(token, db)
    if hasattr(current_user, 'dllm_tokens') and current_user.dllm_tokens is not None:
         current_user.dllm_tokens += points
    else:
         # Handle case where attribute might not exist or is None
         logger.warning(f"User {current_user.email} does not have 'dllm_tokens' attribute or it is None.")
         # Optionally initialize it: current_user.dllm_tokens = points
         return {"detail": "User does not have points tracking enabled.", "total_points": None}

    db.commit()
    db.refresh(current_user)
    return {"detail": f"{points} points added.", "total_points": current_user.dllm_tokens}

@app.get("/leaderboard/users", response_model=List[schemas.LeaderboardUser])
def get_user_leaderboard():
    # ... (existing code - replace with actual DB query later)
    # Example:
    # users = db.query(models.User).order_by(models.User.dllm_tokens.desc()).limit(10).all()
    # return [{"username": u.name or u.email, "profile_picture": u.profile_picture, "score": u.dllm_tokens} for u in users]
    return [
        {"username": "John Doe", "profile_picture": None, "score": 90},
        {"username": "Jane Smith", "profile_picture": None, "score": 50},
        {"username": "Rohabn", "profile_picture": None, "score": 80},
        {"username": "Jake", "profile_picture": None, "score": 70},
        {"username": "Dan", "profile_picture": None, "score": 78},
        # ... other dummy data
    ]

@app.get("/leaderboard/agents", response_model=List[schemas.LeaderboardAgent])
def get_agent_leaderboard():
     # ... (existing code - replace with actual data if available)
    return [
        {"agent_name": "GPT-2 Turbo", "agent_link": "#", "score": 98},
        {"agent_name": "Claude 2", "agent_link": "#", "score": 95},
        {"agent_name": "Tinyllama:1b", "agent_link": "#", "score": 98},
        {"agent_name": "Llama:3b", "agent_link": "#", "score": 98},
        {"agent_name": "Tinyllama:1.1b", "agent_link": "#", "score": 98},
        
        # ... other dummy data
    ]

# GET endpoint for sign up redirection
@app.get("/signup")
def signup():
    # ... (existing code)
    return RedirectResponse(url="#")

@app.patch("/user/wallet", response_model=schemas.WalletResponse)
def update_wallet_address(
    wallet_update: schemas.WalletUpdate,
    token: str = Depends(auth.oauth2_scheme),
    db: Session = Depends(get_db)
):
    """
    Update the user's Aptos wallet address
    - Validates Aptos address format (0x + 64 hex chars)
    - Ensures address is unique across users
    """
    # Authenticate user
    current_user = auth.get_current_user(token, db)
    
    # Validate Aptos address format
    if not re.match(r'^0x[0-9a-fA-F]{64}$', wallet_update.wallet_address):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid Aptos address format. Must be 0x followed by 64 hex characters."
        )
    
    # Check if address is already in use by another user
    existing_user = db.query(models.User).filter(
        models.User.wallet_address == wallet_update.wallet_address,
        models.User.id != current_user.id
    ).first()
    
    if existing_user:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="This wallet address is already associated with another account."
        )
    
    # Update the wallet address
    current_user.wallet_address = wallet_update.wallet_address
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
    """
    Check if a wallet address is available (not already registered)
    - Returns 400 for invalid format
    - Returns 200 with availability status
    """
    if not re.match(r'^0x[0-9a-fA-F]{64}$', wallet_address):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid Aptos address format. Must be 0x followed by 64 hex characters."
        )
    
    exists = db.query(models.User).filter(
        models.User.wallet_address == wallet_address
    ).first() is not None
    
    return {"available": not exists}

# GET endpoint for survey redirection
@app.get("/survey")
def survey():
     # ... (existing code)
    return {"message": "ComputeMesh Survey is Coming Soon, Hang Tight!🚀"}

# GET endpoint for survey redirection
@app.get("/leaderboard/agents/all")
def get_all_agents(): # Renamed function slightly
    # ... (existing code)
    return {"message": "Cooking. Hang Tight!🚀"}
