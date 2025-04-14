from fastapi import FastAPI, Depends, HTTPException, status, WebSocket, WebSocketDisconnect, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import RedirectResponse, JSONResponse
from sqlalchemy.orm import Session
import models, schemas, auth
from database import engine, SessionLocal, redis_client # Assuming redis_client is still needed elsewhere
from command_dispatcher import manager # Use the instantiated manager
from datetime import timedelta, datetime
import logging
import asyncio
import random # Import random
from typing import List, Dict, Any, Optional, Tuple
from fastapi.security import OAuth2PasswordBearer, OAuth2PasswordRequestForm
from pydantic import BaseModel
from prometheus_fastapi_instrumentator import Instrumentator
import httpx

# Removed httpx import if no longer needed for direct calls
# import httpx

import json
import os
import re
from urllib.parse import urlparse

# --- Removed Configuration related to single hardcoded client ---
# CORTEX_API_BASE_URL, CORTEX_ENGINE_NAME, TARGET_CLIENT_USER_ID removed

# --- Removed Server-side State Variables for client node ---
# cortex_engine_loaded, currently_loaded_model_id, model_pull_tasks removed

# Setup logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__) # Use __name__ for logger

# Create database tables
models.Base.metadata.create_all(bind=engine)

app = FastAPI()

# Add Prometheus instrumentation
Instrumentator().instrument(app).expose(app)

# CORS configuration - Allow specific origins in production
# Example: allow_origins=["https://yourfrontend.com", "http://localhost:3000"]
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Be more specific in production
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

# --- Helper Functions ---

async def send_command_to_provider(command: schemas.CommandRequest, timeout: int = 60) -> Tuple[Optional[int], Any]:
    """
    Selects a random active provider, sends a command, and waits for the response.
    Returns a tuple: (provider_id, response_data) or (None, None) if no provider available.
    Raises HTTPException on errors during communication.
    """
    provider_id = manager.get_random_provider_id()
    if provider_id is None:
        logger.error("No active provider nodes available to handle the request.")
        # Return None, None instead of raising exception here, let caller decide
        # raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
        #                     detail="No active provider nodes available.")
        return None, None

    logger.info(f"Selected provider node {provider_id} for command: {command.url}")

    try:
        future = await manager.send_command(provider_id, command)
        # Wait for the response with the specified timeout
        result_json_str = await asyncio.wait_for(future, timeout=timeout)
        logger.info(f"Received response via WebSocket from provider {provider_id} for command {command.url}")

        # The result from the future is expected to be a JSON string
        try:
            result_data = json.loads(result_json_str) # Parse the JSON string from the future

            # Check for potential error structure *within* the JSON response from the client
            if isinstance(result_data, dict) and result_data.get("error"):
                error_detail = result_data.get('error')
                logger.error(f"Provider {provider_id} reported error for command {command.url}: {error_detail}")
                # Propagate the error detail if possible
                raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY,
                                  detail=f"Error from provider node {provider_id}: {error_detail}")

            return provider_id, result_data # Return provider_id and parsed data

        except json.JSONDecodeError:
            logger.warning(f"Response from provider {provider_id} for command {command.url} was not valid JSON: {result_json_str}")
            # Return the raw string if it's not JSON, maybe wrap it
            return provider_id, {"raw_response": result_json_str}
        except HTTPException as e:
            # Re-raise HTTP exceptions originating from error checks
             raise e
        except Exception as e:
             logger.error(f"Error processing JSON response from provider {provider_id} for command {command.url}: {e}")
             raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                               detail=f"Error processing provider response: {str(e)}")

    except ConnectionError as e:
        logger.error(f"Failed to send command to provider {provider_id} (Not connected?): {e}")
        # This specific provider might have disconnected just before sending
        # Consider retrying with another provider, or fail the request
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                          detail=f"Selected provider {provider_id} is not connected or command failed: {e}")
    except asyncio.TimeoutError:
        logger.error(f"Timeout waiting for response from provider {provider_id} for command {command.url}.")
        # This provider might be busy or unresponsive
        # Consider retrying with another provider, or fail the request
        raise HTTPException(status_code=status.HTTP_504_GATEWAY_TIMEOUT,
                          detail=f"Timeout waiting for response from provider node {provider_id}.")
    except Exception as e:
        logger.error(f"Unexpected error sending/receiving command via manager to provider {provider_id}: {e}")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                          detail=f"Server error communicating with provider node: {str(e)}")


# This helper remains useful for server-side URL parsing if needed
def extract_model_id_from_url(model_url: str) -> str:
    """Extract a standardized model ID from a HuggingFace URL (remains on server)"""
    try:
        parsed = urlparse(model_url)
        if not parsed.netloc or not parsed.netloc.endswith("huggingface.co"): # Check netloc exists
            raise ValueError("URL must be from huggingface.co domain")

        path_parts = parsed.path.strip("/").split("/")
        if len(path_parts) < 3 or not all(path_parts[:3]): # Ensure org/repo/filename are present
             raise ValueError("Invalid HuggingFace model URL format (expecting org/repo/.../filename.gguf)")

        # Extract org/repo/filename
        org = path_parts[0]
        repo = path_parts[1]
        # Find the first part that looks like a GGUF file
        filename = next((part for part in reversed(path_parts) if part.lower().endswith('.gguf')), None)
        if not filename:
             raise ValueError("Could not find a .gguf file in the URL path")


        # Create standardized ID format: org:repo:filename
        return f"{org}:{repo}:{filename}"
    except Exception as e:
        logger.error(f"Error parsing model URL '{model_url}': {e}")
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid or unsupported model URL format: {str(e)}"
        )

# --- API Endpoints ---

# --- User Registration ---
@app.post("/register", response_model=schemas.UserOut)
def register(user: schemas.UserCreate, db: Session = Depends(get_db)):
    """Registers a new user or provider."""
    db_user = db.query(models.User).filter(models.User.email == user.email).first()
    if db_user:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Email already registered")

    # Validate user_type (optional, schema already does this with Literal)
    # if user.user_type not in ['user', 'provider']:
    #     raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid user_type specified")

    # --- Wallet logic removed ---

    hashed_password = auth.get_password_hash(user.password)
    new_user = models.User(
        email=user.email,
        name=user.name,
        hashed_password=hashed_password,
        user_type=user.user_type # Assign user_type from request
        # wallet_address field removed
    )
    db.add(new_user)
    db.commit()
    db.refresh(new_user)
    logger.info(f"Registered new {new_user.user_type}: {new_user.email} (ID: {new_user.id})")
    return new_user

# --- Authentication ---
@app.post("/token", response_model=schemas.Token)
def login_for_access_token(form_data: OAuth2PasswordRequestForm = Depends(), db: Session = Depends(get_db)):
    """Provides an access token for valid user credentials."""
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
        data={"sub": user.email, "uid": user.id}, # Include user_id in token data if helpful
        expires_delta=access_token_expires
    )
    logger.info(f"User logged in: {user.email} (ID: {user.id}, Type: {user.user_type})")
    return {"access_token": access_token, "token_type": "bearer"}

# --- WebSocket Connection ---
@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket, token: str):
    """Handles WebSocket connections, authentication, and registration with the ConnectionManager."""
    user_id: Optional[int] = None
    user_email: Optional[str] = None
    user_type: Optional[str] = None

    try:
        payload = auth.jwt.decode(token, auth.SECRET_KEY, algorithms=[auth.ALGORITHM])
        user_email = payload.get("sub")
        # user_id = payload.get("uid") # Get user_id if included during token creation
        if user_email is None: # or user_id is None:
            logger.warning("WebSocket connection attempted with invalid token (missing email/id).")
            await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
            return

        # Query user details including user_type from DB
        with SessionLocal() as db:
            user = auth.get_user(db, email=user_email) # Use get_user which fetches the full user object
            if user is None:
                logger.warning(f"WebSocket connection attempted for non-existent user: {user_email}")
                await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
                return
            user_id = user.id
            user_type = user.user_type # Get the user_type

        # Connect the user to the manager, passing their type
        await manager.connect(websocket, user_id, user_type)

    except auth.JWTError as e:
        logger.error(f"WebSocket authentication failed (JWTError): {e}")
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
        return
    except Exception as e:
        logger.error(f"WebSocket connection setup failed: {e}")
        await websocket.close(code=status.WS_1003_UNSUPPORTED_DATA) # Or another appropriate code
        # Ensure cleanup if connect() wasn't reached or failed partially
        if user_id:
            await manager.disconnect(user_id)
        return

    # Main loop to listen for messages (responses) from the client
    try:
        while True:
            data = await websocket.receive_text()
            logger.debug(f"Received raw message from user {user_email} (ID: {user_id}): {data}")
            # Let the manager handle parsing and routing the response
            await manager.receive_response(data)
    except WebSocketDisconnect as e:
        logger.info(f"WebSocket disconnected for user: {user_email} (ID: {user_id}), code: {e.code}, reason: {e.reason}")
    except Exception as e:
        logger.error(f"WebSocket error for user {user_email} (ID: {user_id}): {e}")
    finally:
        # Ensure disconnection cleanup happens regardless of how the loop exits
        if user_id:
            await manager.disconnect(user_id)
            logger.info(f"Cleaned up connection manager for user {user_id}.")


# --- Decentralized Compute Endpoints ---

@app.post("/v1/models/pull")
async def pull_model_endpoint(request: schemas.ModelPullRequest, token: str = Depends(auth.oauth2_scheme)):
    """Sends a command to a randomly selected provider node to pull a model."""
    auth.get_current_user(token, SessionLocal())  # Verify auth

    try:
        # Resolve model ID on the server side if it's a URL
        if request.model.startswith("http"):
            model_id = extract_model_id_from_url(request.model)
            logger.info(f"Extracted model_id '{model_id}' from URL '{request.model}'")
        else:
            model_id = request.model
            logger.info(f"Using provided model_id '{model_id}'")

        # Prepare the command for the provider node's Cortex API
        command = schemas.CommandRequest(
            method="POST",
            url="/v1/models/pull", # Relative endpoint on the provider node
            data={"model": model_id} # Data payload for the provider's Cortex
        )

        logger.info(f"Attempting to send pull command for model '{model_id}' to a provider.")
        # Use the helper to find a provider and send the command
        provider_id, response_data = await send_command_to_provider(command, timeout=300) # Longer timeout for pulls

        if provider_id is None:
             raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                                 detail="No active provider nodes available to pull the model.")


        # Return the response received from the provider node
        # Note: Tracking pull progress centrally is complex and removed for now.
        logger.info(f"Pull command sent to provider {provider_id}. Response: {response_data}")
        return JSONResponse(content=response_data)

    except HTTPException as e:
        # Re-raise exceptions from send_command_to_provider or auth
        raise e
    except ValueError as e:
         # Catch errors from extract_model_id_from_url
         raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))
    except Exception as e:
        logger.exception("Unexpected error processing model pull request") # Log full traceback
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=f"Internal server error: {str(e)}")


@app.post("/v1/chat/completions", response_model=Optional[schemas.ChatCompletionResponse]) # Response might vary, be careful
async def chat_completion(request: schemas.ChatCompletionRequest, token: str = Depends(auth.oauth2_scheme)):
    """Forwards a chat completion request to a randomly selected provider node."""
    auth.get_current_user(token, SessionLocal()) # Verify auth

    # Server no longer tracks or manages engine/model state.
    # It directly forwards the request to a provider.

    try:
        # Prepare the chat command for the provider node's Cortex API
        chat_command = schemas.CommandRequest(
            method="POST",
            url="/v1/chat/completions", # Relative endpoint on the provider
            data=request.dict() # Forward the entire request payload
        )

        logger.info(f"Attempting to send chat completion request for model '{request.model}' to a provider.")
        # Use the helper to find a provider and send the command
        provider_id, response_data = await send_command_to_provider(chat_command, timeout=180) # Adjust timeout as needed

        if provider_id is None:
             raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                                 detail="No active provider nodes available for chat completion.")

        # Return the response received from the provider node
        logger.info(f"Chat completion request sent to provider {provider_id}. Response received.")
        # Assuming the provider returns data compatible with ChatCompletionResponse
        # Error handling within the response is done inside send_command_to_provider
        return JSONResponse(content=response_data)

    except HTTPException as e:
        # Re-raise exceptions from send_command_to_provider or auth
        raise e
    except Exception as e:
        logger.exception("Unexpected error processing chat completion request")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=f"Internal server error: {str(e)}")


@app.get("/v1/models", response_model=schemas.ModelListResponse)
async def list_models(token: str = Depends(auth.oauth2_scheme)):
    """Gets the list of available models from a randomly selected provider node."""
    auth.get_current_user(token, SessionLocal()) # Verify auth

    try:
        # Prepare the command to list models on the provider node
        command = schemas.CommandRequest(
            method="GET",
            url="/v1/models", # Relative endpoint on the provider
            data=None
        )

        logger.info("Attempting to get model list from a provider.")
        # Use the helper to find a provider and send the command
        provider_id, response_data = await send_command_to_provider(command, timeout=60)

        if provider_id is None:
             raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                                 detail="No active provider nodes available to list models.")


        # Process the response - expect format like {"data": [...]} from Cortex
        available_models = []
        if isinstance(response_data, dict) and "data" in response_data:
             if isinstance(response_data["data"], list):
                 available_models = response_data["data"]
             else:
                 logger.warning(f"Provider {provider_id} returned 'data' but it was not a list: {response_data['data']}")
        else:
             logger.warning(f"Received unexpected format for model list from provider {provider_id}: {response_data}")

        logger.info(f"Model list received from provider {provider_id}.")
        return schemas.ModelListResponse(data=available_models, provider_id=provider_id)

    except HTTPException as e:
        # Re-raise exceptions from send_command_to_provider or auth
        raise e
    except Exception as e:
        logger.exception("Unexpected error getting model list")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=f"Internal server error: {str(e)}")


@app.get("/v1/models/status", response_model=schemas.ModelListResponse)
async def model_status(token: str = Depends(auth.oauth2_scheme)):
    """
    Gets the list of available models from a random provider.
    (Currently functionally similar to /v1/models after removing server state).
    """
    # This endpoint now behaves identically to /v1/models as server state is removed.
    # Consider deprecating or changing its purpose later if needed.
    logger.info("Model status request received, forwarding to /v1/models logic.")
    return await list_models(token=token) # Simply call the other endpoint


# --- Other Existing Endpoints (Modified/Kept) ---

# Generic Command Dispatch (Keep for direct targeting if needed, USE WITH CAUTION)
@app.post("/send-command/{user_id}")
async def send_command_direct(user_id: int, command_request: schemas.CommandRequest, token: str = Depends(auth.oauth2_scheme), db: Session = Depends(get_db)):
    """
    Sends a command directly to a specific user ID (use carefully).
    Requires authentication. Could add authorization check (e.g., only admins).
    """
    requesting_user = auth.get_current_user(token, db) # Authenticate the sender
    # Optional: Add authorization logic here (e.g., check if requesting_user is admin)
    # if requesting_user.user_type != 'admin': # Example
    #     raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not authorized to send direct commands")

    target_user = db.query(models.User).filter(models.User.id == user_id).first()
    if not target_user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Target user not found")

    logger.info(f"User {requesting_user.email} initiating direct command to user {user_id}: {command_request.url}")

    try:
        # Use the original send_command logic from the manager directly
        future = await manager.send_command(user_id, command_request)
        result_json_str = await asyncio.wait_for(future, timeout=60) # Add timeout
        response_data = json.loads(result_json_str) # Parse the result
        logger.info(f"Direct command sent to user {user_id}. Response: {response_data}")
        return {"message": f"Direct command sent to user '{target_user.email}' (ID: {user_id})", "response": response_data}
    except ConnectionError as e:
        logger.error(f"Direct command failed: User {user_id} not connected. Error: {e}")
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"Target user {user_id} not connected.")
    except asyncio.TimeoutError:
        logger.error(f"Direct command to user {user_id} timed out.")
        raise HTTPException(status_code=status.HTTP_504_GATEWAY_TIMEOUT, detail=f"Timeout waiting for response from user {user_id}.")
    except json.JSONDecodeError:
         logger.error(f"Direct command response from user {user_id} was not valid JSON: {result_json_str}")
         # Decide how to return non-JSON response
         return {"message": f"Direct command sent to user '{target_user.email}' (ID: {user_id})", "raw_response": result_json_str}
    except Exception as e:
        logger.error(f"Error sending direct command to user {user_id}: {e}")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=f"Server error sending direct command: {str(e)}")


# Broadcast Command Endpoint (Keep, but consider target audience - all users? providers only?)
@app.post("/broadcast-command")
async def broadcast_command(command_request: schemas.CommandRequest, token: str = Depends(auth.oauth2_scheme), db: Session = Depends(get_db)):
    """Broadcasts command to ALL connected users (requires auth, potentially admin only)."""
    requesting_user = auth.get_current_user(token, db)
    # Optional: Add admin check here
    logger.warning(f"User {requesting_user.email} initiating BROADCAST command: {command_request.url}")
    try:
        # manager.broadcast_command currently sends to ALL users. Modify manager if needed.
        results = await manager.broadcast_command(command_request)
        return {"message": "Command broadcasted to all connected users.", "results": results}
    except Exception as e:
        logger.error(f"Error broadcasting command: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/public-stats", response_model=schemas.PublicStats)
def get_public_stats():
    """Provides public statistics about the platform."""
    # Get active providers count from the manager
    active_providers = len(manager.get_active_provider_ids())
    # You might want total connected users as well: total_connections = len(manager.active_connections)

    # Static data for now - replace with dynamic data sources later
    return schemas.PublicStats(
        active_nodes=active_providers, # Show provider count as active compute nodes
        dllm_price={"yesterday": 0.073, "current": 0.1}, # Example data
        btc_price={"yesterday": 93825.89, "current": 100000.00}, # Example data
        twitter_link="https://x.com/YourTwitter", # Update link
        discord_link="https://discord.gg/YourDiscord", # Update link
        online_discord_users=500, # Static example
        twitter_followers=3000 # Static example
    )

@app.get("/user", response_model=schemas.UserDashboard)
def get_user_info(token: str = Depends(auth.oauth2_scheme), db: Session = Depends(get_db)):
    """Retrieves dashboard information for the authenticated user."""
    current_user = auth.get_current_user(token, db)
    # Ensure attributes exist or provide defaults
    return schemas.UserDashboard(
        email=current_user.email,
        name=getattr(current_user, 'name', None),
        profile_picture=getattr(current_user, 'profile_picture', None),
        dllm_tokens=getattr(current_user, 'dllm_tokens', 0),
        referral_link=getattr(current_user, 'referral_link', None)
        # wallet_address removed
    )

@app.post("/user/points")
def add_points(points_request: schemas.PointsRequest, token: str = Depends(auth.oauth2_scheme), db: Session = Depends(get_db)):
    """Adds points (e.g., DLLM tokens) to the authenticated user's account."""
    current_user = auth.get_current_user(token, db)
    points = points_request.points # Get points from request body

    # Ensure 'dllm_tokens' attribute exists and is not None before adding
    if not hasattr(current_user, 'dllm_tokens') or current_user.dllm_tokens is None:
         logger.warning(f"User {current_user.email} 'dllm_tokens' attribute missing or None. Initializing to 0 before adding points.")
         current_user.dllm_tokens = 0 # Initialize if missing

    current_user.dllm_tokens += points
    db.commit()
    db.refresh(current_user)
    logger.info(f"Added {points} points to user {current_user.email}. New total: {current_user.dllm_tokens}")
    return {"detail": f"{points} points added.", "total_points": current_user.dllm_tokens}

@app.get("/leaderboard/users", response_model=List[schemas.LeaderboardUser])
def get_user_leaderboard(db: Session = Depends(get_db)):
    """Retrieves the top users based on points/tokens."""
    users = db.query(models.User)\
              .order_by(models.User.dllm_tokens.desc().nullslast())\
              .limit(10)\
              .all()
    return [
        schemas.LeaderboardUser(
            username=u.name or u.email.split('@')[0], # Use name or part of email
            profile_picture=u.profile_picture,
            score=u.dllm_tokens if u.dllm_tokens is not None else 0
            # wallet_address removed
        ) for u in users
    ]

@app.get("/leaderboard/agents", response_model=List[schemas.LeaderboardAgent])
def get_agent_leaderboard():
    """Placeholder for agent leaderboard."""
    # Replace with actual data source when available
    return [
        {"agent_name": "GPT-4 Turbo", "agent_link": "#", "score": 98},
        {"agent_name": "Claude 3 Opus", "agent_link": "#", "score": 97},
        # ... other dummy data
    ]

@app.get("/signup")
def signup():
    """Redirects to the main website or signup page."""
    return RedirectResponse(url="https://computemesh.network/") # Update URL if needed

@app.get("/survey")
def survey():
    """Placeholder endpoint for a survey."""
    return {"message": "ComputeMesh Survey is Coming Soon, Hang Tight!🚀"}

@app.get("/leaderboard/agents/all")
def get_all_agents():
    """Placeholder endpoint for all agents."""
    return {"message": "Agent listing Cooking. Hang Tight!🚀"}

# --- Removed Endpoints ---
# /user/wallet removed
# /wallet/check-availability removed

# --- Device Registration Endpoint (Kept as is) ---
@app.post("/device-registration", status_code=status.HTTP_201_CREATED) # Use 201 for creation
def device_registration(request: schemas.DeviceRegistrationRequest, db: Session = Depends(get_db)):
    """Registers a device ID."""
    device = db.query(models.Device).filter(models.Device.device_id == request.device_id).first()
    if device:
        # Return 200 OK if already registered, maybe include registration date?
        return {"status": "already recorded", "registered_date": device.registered_date}
    new_device = models.Device(device_id=request.device_id, registered_date=datetime.utcnow())
    db.add(new_device)
    db.commit()
    logger.info(f"Registered new device: {request.device_id}")
    return {"status": "registered", "device_id": new_device.device_id}

# --- Root Endpoint (Optional) ---
@app.get("/")
async def root():
    logger.info("--- Root endpoint '/' was accessed ---") # Add log for confirmation
    return {"message": "ComputeMesh API is running!"}