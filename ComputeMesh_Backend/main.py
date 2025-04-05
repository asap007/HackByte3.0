# main.py - Rewritten for Command Relay

from fastapi import (
    FastAPI, Depends, HTTPException, status, WebSocket, 
    WebSocketDisconnect, Request, Query
)
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import RedirectResponse, JSONResponse
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy.orm import Session
from pydantic import BaseModel # Keep for existing schemas
from prometheus_fastapi_instrumentator import Instrumentator
from datetime import timedelta, datetime
from typing import List, Dict, Any, Optional
import logging
import asyncio
import json
import os
import re

# Local imports (assuming they are in the same directory or accessible)
import models
import schemas # Keep for existing schemas and potentially CommandRequest if defined there
import auth
from database import engine, SessionLocal, redis_client # Assuming redis_client is still needed elsewhere
from command_dispatcher import manager # CRITICAL: Use the manager for relaying

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
    allow_origins=["*"], # Be more specific in production
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

# --- Schemas (Keep relevant ones used by endpoints) ---
# Schemas needed for Auth, User management, Points, etc. are kept.
# Schemas specific to direct Cortex interaction might be simplified if 
# the backend no longer needs to parse their specifics deeply.

class DeviceRegistrationRequest(BaseModel):
    device_id: str

# Reuse schemas defined in schemas.py if they exist
class ChatCompletionRequest(BaseModel):
    model: str
    messages: List[schemas.ChatMessage] # Assuming schemas.ChatMessage exists
    stream: bool = False
    max_tokens: int = 512
    temperature: float = 0.6
    top_p: float = 0.9
    frequency_penalty: float = 0
    presence_penalty: float = 0

class ModelPullRequest(BaseModel):
    model: str  # Can be model ID or HuggingFace URL
    # name: Optional[str] = None # Keep if needed by client, otherwise remove


# --- Helper Function for Command Relay ---
async def relay_command_to_client(
    user_id: int,
    method: str,
    url: str,
    data: Optional[Dict[str, Any]] = None,
    timeout: int = 30 # Seconds to wait for client response
) -> Any:
    """Sends a command to a connected client via WebSocket and awaits the response."""
    if user_id not in manager.active_connections:
        logger.warning(f"Attempted to relay command to disconnected user {user_id}")
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"User {user_id} is not connected.")

    # Ensure schemas.CommandRequest is correctly defined or create one ad-hoc
    # Assuming schemas.py has:
    # class CommandRequest(BaseModel):
    #     method: str
    #     url: str
    #     data: Optional[Dict[str, Any]] = None
    # If not, adjust the payload creation accordingly.
    command_request_payload = {
        "method": method,
        "url": url,
        "data": data
    }
    # If schemas.CommandRequest exists and is used by manager:
    command_request_obj = schemas.CommandRequest(**command_request_payload)


    try:
        logger.info(f"Relaying command to user {user_id}: {method} {url} Data: {data}")
        # Send command via WebSocket manager and get the Future
        # Use command_request_obj if manager expects the Pydantic model
        future = await manager.send_command(user_id, command_request_obj) 

        # Wait for the client's response via the Future
        result = await asyncio.wait_for(future, timeout=timeout)

        logger.info(f"Received response from user {user_id} for {method} {url}: {result}")
        # The 'result' here is whatever the client sent back in its response payload
        return result

    except ConnectionError as e:
        # This exception might be raised by manager if connection drops *during* send
        logger.error(f"Connection error relaying command to user {user_id}: {e}")
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=f"Failed to send command to client: {e}")
    except asyncio.TimeoutError:
        logger.error(f"Timeout waiting for response from user {user_id} for {method} {url}.")
        raise HTTPException(status_code=status.HTTP_504_GATEWAY_TIMEOUT, detail="Timeout waiting for response from client.")
    except Exception as e:
        logger.exception(f"Unexpected error relaying command to user {user_id} for {method} {url}") # Use logger.exception for stack trace
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Internal server error during command relay.")


# --- API Endpoints ---

# --- Cortex Related Endpoints (Rewritten to Relay Commands) ---

@app.post("/v1/models/pull")
async def pull_model_endpoint(request: ModelPullRequest, db: Session = Depends(get_db), token: str = Depends(auth.oauth2_scheme)):
    """(Relayed) Pull a model via the connected client."""
    current_user = auth.get_current_user(token, db)
    response = await relay_command_to_client(
        user_id=current_user.id,
        method="POST",
        url="/v1/models/pull",
        data={"model": request.model} # Pass necessary data from request
    )
    # Return the exact response received from the client
    return JSONResponse(content=response)

@app.post("/v1/chat/completions")
async def chat_completion_endpoint(request: ChatCompletionRequest, db: Session = Depends(get_db), token: str = Depends(auth.oauth2_scheme)):
    """(Relayed) Handle chat completion via the connected client."""
    current_user = auth.get_current_user(token, db)
    # Forward the entire request payload as data to the client
    response = await relay_command_to_client(
        user_id=current_user.id,
        method="POST",
        url="/v1/chat/completions",
        data=request.dict() # Pass the full request details
    )
    # Return the exact response received from the client
    return JSONResponse(content=response)

@app.get("/v1/models")
async def list_models_endpoint(db: Session = Depends(get_db), token: str = Depends(auth.oauth2_scheme)):
    """(Relayed) Get available models from the connected client."""
    current_user = auth.get_current_user(token, db)
    response = await relay_command_to_client(
        user_id=current_user.id,
        method="GET",
        url="/v1/models",
        data=None
    )
    # The response directly from the client's Cortex /v1/models call
    # Backend no longer manages 'loaded', 'engine_loaded', 'download_tasks' state directly
    return JSONResponse(content=response)

@app.get("/v1/models/status")
async def model_status_endpoint(db: Session = Depends(get_db), token: str = Depends(auth.oauth2_scheme)):
    """(Relayed) Check current model status on the connected client."""
    current_user = auth.get_current_user(token, db)
    response = await relay_command_to_client(
        user_id=current_user.id,
        method="GET",
        url="/v1/models/status",
        data=None
    )
    # The response directly from the client's Cortex /v1/models/status call
    return JSONResponse(content=response)


# --- Existing Endpoints (Largely Unchanged) ---

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
@app.post("/register", response_model=schemas.UserOut) # Assuming schemas.UserOut exists
def register(user: schemas.UserCreate, db: Session = Depends(get_db)): # Assuming schemas.UserCreate exists
    db_user = db.query(models.User).filter(models.User.email == user.email).first()
    if db_user:
        raise HTTPException(status_code=400, detail="Email already registered")

    # Wallet address validation if provided (keep if needed)
    if hasattr(user, 'wallet_address') and user.wallet_address:
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
    new_user_data = {
        "email": user.email,
        "hashed_password": hashed_password,
    }
    # Add optional fields if they exist in the model and schema
    if hasattr(user, 'name'): new_user_data['name'] = user.name
    if hasattr(user, 'wallet_address'): new_user_data['wallet_address'] = user.wallet_address

    new_user = models.User(**new_user_data)
    db.add(new_user)
    db.commit()
    db.refresh(new_user)
    return new_user

# Token Endpoint
@app.post("/token", response_model=schemas.Token) # Assuming schemas.Token exists
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


# WebSocket Endpoint
@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket, token: str = Query(...)): # Get token from query param
    try:
        payload = auth.jwt.decode(token, auth.SECRET_KEY, algorithms=[auth.ALGORITHM])
        username: str = payload.get("sub")
        if username is None:
            logger.warning("WebSocket connection attempted without username in token.")
            await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
            return
        # Use context manager for session safety in async
        with SessionLocal() as db:
            user = auth.get_user(db, email=username)
            if user is None:
                logger.warning(f"WebSocket connection attempted with invalid user: {username}")
                await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
                return
            user_id = user.id # Get user_id before session closes
    
    except (auth.JWTError, Exception) as e:
        logger.error(f"WebSocket authentication failed: {e}")
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
        return

    # Proceed with connection if user is valid
    await manager.connect(websocket, user_id)
    logger.info(f"WebSocket connection established for user: {username} (ID: {user_id})")
    try:
        while True:
            data = await websocket.receive_text()
            logger.debug(f"Received raw message from user {user_id}: {data}") # Use debug level
            # This is where the client sends RESPONSES back
            await manager.receive_response(data)
    except WebSocketDisconnect as e:
        logger.info(f"WebSocket connection closed for user {user_id}. Code: {e.code}, Reason: {e.reason}")
    except Exception as e:
        logger.error(f"WebSocket error for user {user_id}: {e}", exc_info=True) # Log stack trace
    finally:
        # Ensure disconnect is called even if errors occur within the loop
        await manager.disconnect(user_id)
        logger.info(f"Cleaned up connection for user {user_id}")


# --- Admin/Debug Command Endpoints (Keep or Remove based on need) ---
# These endpoints might be useful for admins to send commands, but ensure
# they have proper authorization checks if kept. They already use the manager.

@app.post("/send-command/{target_user_id}")
async def send_command_endpoint(
    target_user_id: int,
    command_request: schemas.CommandRequest, # Assuming schemas.CommandRequest exists
    db: Session = Depends(get_db),
    token: str = Depends(auth.oauth2_scheme) # Add auth for this endpoint
):
    # Add authorization check: Is the current user an admin?
    current_user = auth.get_current_user(token, db)
    # Example: if not current_user.is_admin: raise HTTPException(403, "Not authorized")
    logger.info(f"Admin user {current_user.email} attempting to send command to user {target_user_id}")

    # Use the relay helper function for consistency
    response = await relay_command_to_client(
        user_id=target_user_id,
        method=command_request.method,
        url=command_request.url,
        data=command_request.data
    )
    return {"message": f"Command sent to user {target_user_id}", "response": response}


@app.post("/broadcast-command")
async def broadcast_command_endpoint(
    command_request: schemas.CommandRequest, # Assuming schemas.CommandRequest exists
    db: Session = Depends(get_db),
    token: str = Depends(auth.oauth2_scheme) # Add auth for this endpoint
):
     # Add authorization check: Is the current user an admin?
    current_user = auth.get_current_user(token, db)
    # Example: if not current_user.is_admin: raise HTTPException(403, "Not authorized")
    logger.info(f"Admin user {current_user.email} attempting to broadcast command")

    # Broadcasting might need different handling in the manager if it doesn't return futures per user
    # The original manager.broadcast_command seemed to try and collect results, which might be complex.
    # Consider if broadcast needs responses or is fire-and-forget.
    # For simplicity, let's assume the manager handles sending without waiting for individual responses here.
    # If you NEED aggregated results, the manager logic would need adjustment.

    # Simplified broadcast (adjust if your manager returns differently)
    connected_users = list(manager.active_connections.keys())
    if not connected_users:
        return {"message": "No users connected to broadcast to."}

    logger.info(f"Broadcasting command to users: {connected_users}")
    # This part depends heavily on how manager.broadcast_command is implemented.
    # If it just sends, we don't await futures here.
    # If it tries to collect results like the old code, it might need async gathering.
    # Let's assume fire-and-forget for now based on likely use cases.
    broadcast_payload = {
        "command_id": f"broadcast-{uuid.uuid4()}", # Generate a broadcast ID
        "method": command_request.method,
        "url": command_request.url,
        "data": command_request.data
    }
    tasks = []
    for user_id, websocket in manager.active_connections.items():
        try:
            # Directly send without waiting for individual responses via manager's future mechanism
            # manager.send_command internally creates futures we don't need here
            await websocket.send_text(json.dumps(broadcast_payload))
            logger.debug(f"Sent broadcast payload to user {user_id}")
        except Exception as e:
            logger.error(f"Failed to send broadcast to user {user_id}: {e}")

    return {"message": f"Broadcast command initiated to {len(connected_users)} connected users."}


# --- Other existing endpoints (Mostly Unchanged) ---
@app.get("/public-stats", response_model=schemas.PublicStats) # Assuming schemas.PublicStats exists
def get_public_stats():
    active_node_count = len(manager.active_connections) # Get live count
    return schemas.PublicStats(
        active_nodes=active_node_count,
        dllm_price={"yesterday": 0.073, "current": 0.1}, # Keep as static or fetch elsewhere
        btc_price={"yesterday": 93825.89, "current": 100000.00}, # Keep as static or fetch elsewhere
        twitter_link="https://x.com/AnshulSingh5180",
        discord_link="https://x.com/AnshulSingh5180",
        online_discord_users=500, # Static or fetch elsewhere
        twitter_followers=3000 # Static or fetch elsewhere
    )

@app.get("/user", response_model=schemas.UserDashboard) # Assuming schemas.UserDashboard exists
def get_user_info(token: str = Depends(auth.oauth2_scheme), db: Session = Depends(get_db)):
    current_user = auth.get_current_user(token, db)
    # Ensure the schema fields match the user model attributes
    dashboard_data = {"email": current_user.email}
    if hasattr(current_user, 'name'): dashboard_data['name'] = current_user.name
    if hasattr(current_user, 'profile_picture'): dashboard_data['profile_picture'] = current_user.profile_picture
    if hasattr(current_user, 'dllm_tokens'): dashboard_data['dllm_tokens'] = current_user.dllm_tokens
    if hasattr(current_user, 'referral_link'): dashboard_data['referral_link'] = current_user.referral_link
    if hasattr(current_user, 'wallet_address'): dashboard_data['wallet_address'] = current_user.wallet_address
    
    return schemas.UserDashboard(**dashboard_data)


@app.post("/user/points")
def add_points(points_update: schemas.PointsUpdate, token: str = Depends(auth.oauth2_scheme), db: Session = Depends(get_db)): # Assuming schemas.PointsUpdate exists
    current_user = auth.get_current_user(token, db)
    if hasattr(current_user, 'dllm_tokens') and current_user.dllm_tokens is not None:
         current_user.dllm_tokens += points_update.points # Use points from schema
    else:
         # Initialize if missing? Or return error?
         # current_user.dllm_tokens = points_update.points # Initialize
         logger.warning(f"User {current_user.email} does not have 'dllm_tokens' attribute or it is None. Points not added.")
         # Return an error instead?
         # raise HTTPException(status_code=400, detail="User points tracking not enabled.")
         return {"detail": "User does not have points tracking enabled or is null.", "total_points": None}

    db.commit()
    db.refresh(current_user)
    return {"detail": f"{points_update.points} points added.", "total_points": current_user.dllm_tokens}

@app.get("/leaderboard/users", response_model=List[schemas.LeaderboardUser]) # Assuming schema exists
def get_user_leaderboard(db: Session = Depends(get_db)): # Add db dependency
    # Replace dummy data with actual query
    users = db.query(models.User)\
              .filter(models.User.dllm_tokens != None)\
              .order_by(models.User.dllm_tokens.desc())\
              .limit(10)\
              .all()
    
    leaderboard = []
    for u in users:
         leaderboard.append({
             "username": u.name or u.email.split('@')[0], # Use name or part of email
             "profile_picture": u.profile_picture if hasattr(u, 'profile_picture') else None,
             "score": u.dllm_tokens
         })
    return leaderboard

@app.get("/leaderboard/agents", response_model=List[schemas.LeaderboardAgent]) # Assuming schema exists
def get_agent_leaderboard():
     # This likely remains dummy data unless you track agent performance server-side
    return [
        {"agent_name": "GPT-4 Turbo", "agent_link": "#", "score": 98},
        {"agent_name": "Claude 3 Opus", "agent_link": "#", "score": 97},
        {"agent_name": "Llama-3-70B", "agent_link": "#", "score": 95},
        # ... other dummy data
    ]

# GET endpoint for sign up redirection (keep as is)
@app.get("/signup")
def signup():
    return RedirectResponse(url="#") # Or your actual signup page URL

# Endpoint for updating wallet address (keep if needed)
@app.patch("/user/wallet", response_model=schemas.WalletResponse) # Assuming schema exists
def update_wallet_address(
    wallet_update: schemas.WalletUpdate, # Assuming schema exists
    token: str = Depends(auth.oauth2_scheme),
    db: Session = Depends(get_db)
):
    current_user = auth.get_current_user(token, db)
    if not re.match(r'^0x[0-9a-fA-F]{64}$', wallet_update.wallet_address):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid Aptos address format."
        )
    existing_user = db.query(models.User).filter(
        models.User.wallet_address == wallet_update.wallet_address,
        models.User.id != current_user.id
    ).first()
    if existing_user:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="This wallet address is already associated with another account."
        )
    current_user.wallet_address = wallet_update.wallet_address
    db.commit()
    db.refresh(current_user)
    return {
        "message": "Wallet address updated successfully",
        "wallet_address": current_user.wallet_address
    }

# Endpoint for checking wallet availability (keep if needed)
@app.get("/wallet/check-availability/{wallet_address}")
def check_wallet_availability(wallet_address: str, db: Session = Depends(get_db)):
    if not re.match(r'^0x[0-9a-fA-F]{64}$', wallet_address):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid Aptos address format."
        )
    exists = db.query(models.User).filter(
        models.User.wallet_address == wallet_address
    ).first() is not None
    return {"available": not exists}


# GET endpoint for survey redirection (keep as is)
@app.get("/survey")
def survey():
    # return RedirectResponse(url="YOUR_SURVEY_URL") # Point to actual survey
    return {"message": "ComputeMesh Survey is Coming Soon, Hang Tight!🚀"}

# GET endpoint for all agents (keep as is or implement)
@app.get("/leaderboard/agents/all")
def get_all_agents(): # Renamed function slightly
    return {"message": "Cooking. Hang Tight!🚀"}