# main.py
from fastapi import FastAPI, Depends, HTTPException, status, WebSocket, WebSocketDisconnect, Request
from fastapi.middleware.cors import CORSMiddleware
# --- New: Import StreamingResponse ---
from fastapi.responses import RedirectResponse, JSONResponse, StreamingResponse
# -----------------------------------
from sqlalchemy.orm import Session
import models, schemas, auth
from database import engine, SessionLocal
from command_dispatcher import manager
from datetime import timedelta, datetime
import logging
import asyncio
import random
from typing import List, Dict, Any, Optional, Tuple
from fastapi.security import OAuth2PasswordBearer, OAuth2PasswordRequestForm
from pydantic import BaseModel
from prometheus_fastapi_instrumentator import Instrumentator
# --- New: Import httpx for streaming HTTP requests ---
import httpx
# -------------------------------------------------

import json
import os
import re
from urllib.parse import urlparse

# Setup logging and DB (remains the same)
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)
models.Base.metadata.create_all(bind=engine)

app = FastAPI()
Instrumentator().instrument(app).expose(app)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], # Be specific in production
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# get_db dependency (remains the same)
def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

# --- Helper Functions ---

# send_command_to_provider is now primarily for NON-STREAMING requests via WebSocket
async def send_command_to_provider(command: schemas.CommandRequest, timeout: int = 60) -> Tuple[Optional[int], Any]:
    """
    Selects a random active provider, sends a NON-STREAMING command via WebSocket,
    and waits for the single JSON response.
    """
    provider_id = manager.get_random_provider_id() # Use the simpler ID getter
    if provider_id is None:
        logger.error("No active provider nodes available for non-streaming request.")
        return None, None

    logger.info(f"Selected provider node {provider_id} for non-streaming command: {command.url}")

    try:
        future = await manager.send_command(provider_id, command)
        result_json_str = await asyncio.wait_for(future, timeout=timeout)
        logger.info(f"Received WebSocket response from provider {provider_id} for command {command.url}")

        try:
            result_data = json.loads(result_json_str) # Parse the single JSON string
            if isinstance(result_data, dict) and result_data.get("error"):
                error_detail = result_data.get('error')
                logger.error(f"Provider {provider_id} reported error (via WS) for command {command.url}: {error_detail}")
                raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY,
                                  detail=f"Error from provider node {provider_id}: {error_detail}")
            return provider_id, result_data
        except json.JSONDecodeError:
            logger.warning(f"WS response from provider {provider_id} was not valid JSON: {result_json_str}")
            return provider_id, {"raw_response": result_json_str}
        except HTTPException as e:
             raise e
        except Exception as e:
             logger.error(f"Error processing WS JSON response from provider {provider_id}: {e}")
             raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                               detail=f"Error processing provider WS response: {str(e)}")
    except ConnectionError as e:
        logger.error(f"WS command to provider {provider_id} failed (Not connected?): {e}")
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                          detail=f"Selected provider {provider_id} not connected for WS command: {e}")
    except asyncio.TimeoutError:
        logger.error(f"Timeout waiting for WS response from provider {provider_id}.")
        raise HTTPException(status_code=status.HTTP_504_GATEWAY_TIMEOUT,
                          detail=f"Timeout waiting for WS response from provider node {provider_id}.")
    except Exception as e:
        logger.error(f"Unexpected error sending/receiving WS command via manager to provider {provider_id}: {e}")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                          detail=f"Server error communicating via WS with provider node: {str(e)}")

# extract_model_id_from_url (remains the same)
def extract_model_id_from_url(model_url: str) -> str:
    # ... (implementation is unchanged) ...
    try:
        parsed = urlparse(model_url)
        if not parsed.netloc or not parsed.netloc.endswith("huggingface.co"): # Check netloc exists
            # Fallback: Try to parse even if domain is not huggingface.co, assuming org/repo format
            path_parts = parsed.path.strip("/").split("/")
            if len(path_parts) >= 2 and all(path_parts[:2]): # Allow at least org/repo
                 org = path_parts[0]
                 repo = path_parts[1]
                 # Attempt to find gguf filename
                 filename = next((part for part in reversed(path_parts) if part.lower().endswith('.gguf')), None)
                 if filename:
                      return f"{org}:{repo}:{filename}"
                 else: # If no gguf, return org:repo
                      logger.warning(f"Model URL '{model_url}' seems valid but no .gguf found, using format org:repo.")
                      return f"{org}:{repo}"
            else:
                raise ValueError("URL does not seem to be a valid model identifier (expecting org/repo[/.../filename.gguf] or huggingface.co URL)")

        # Original HuggingFace parsing logic
        path_parts = parsed.path.strip("/").split("/")
        if len(path_parts) < 2: # Need at least org/repo
             raise ValueError("Invalid HuggingFace URL path (expecting /org/repo/...)")

        org = path_parts[0]
        repo = path_parts[1]
        filename = next((part for part in reversed(path_parts) if part.lower().endswith('.gguf')), None)

        if not filename:
             logger.warning(f"No .gguf file found in HuggingFace URL path '{parsed.path}', using format org:repo.")
             return f"{org}:{repo}" # Return org:repo if no specific file

        return f"{org}:{repo}:{filename}"
    except Exception as e:
        logger.error(f"Error parsing model URL '{model_url}': {e}")
        # Return the original string if parsing fails? Or raise error?
        # Raising error seems safer to indicate invalid input.
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid or unsupported model URL/ID format: {str(e)}"
        )

# --- API Endpoints ---

# User Registration & Auth (remain the same)
@app.post("/register", response_model=schemas.UserOut)
def register(user: schemas.UserCreate, db: Session = Depends(get_db)):
    # ... (implementation is unchanged) ...
    db_user = db.query(models.User).filter(models.User.email == user.email).first()
    if db_user:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Email already registered")
    hashed_password = auth.get_password_hash(user.password)
    new_user = models.User(
        email=user.email,
        name=user.name,
        hashed_password=hashed_password,
        user_type=user.user_type
    )
    db.add(new_user)
    db.commit()
    db.refresh(new_user)
    logger.info(f"Registered new {new_user.user_type}: {new_user.email} (ID: {new_user.id})")
    return new_user

@app.post("/token", response_model=schemas.Token)
def login_for_access_token(form_data: OAuth2PasswordRequestForm = Depends(), db: Session = Depends(get_db)):
    # ... (implementation is unchanged) ...
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
        data={"sub": user.email, "uid": user.id, "typ": user.user_type}, # Include type
        expires_delta=access_token_expires
    )
    logger.info(f"User logged in: {user.email} (ID: {user.id}, Type: {user.user_type})")
    return {"access_token": access_token, "token_type": "bearer"}

# --- WebSocket Connection ---
@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket, token: str, http_base_url: Optional[str] = None): # Added http_base_url query param
    """Handles WebSocket connections, authentication, and registration with ConnectionManager."""
    user_id: Optional[int] = None
    user_email: Optional[str] = None
    user_type: Optional[str] = None

    try:
        payload = auth.jwt.decode(token, auth.SECRET_KEY, algorithms=[auth.ALGORITHM])
        user_email = payload.get("sub")
        # user_id = payload.get("uid") # Can rely on DB lookup
        user_type_from_token = payload.get("typ") # Get type from token if included

        if user_email is None:
            logger.warning("WebSocket connection attempted with invalid token (missing email).")
            await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
            return

        with SessionLocal() as db:
            user = auth.get_user(db, email=user_email)
            if user is None:
                logger.warning(f"WebSocket connection attempted for non-existent user: {user_email}")
                await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
                return
            user_id = user.id
            user_type = user.user_type # Get authoritative type from DB

        # --- Pass http_base_url to manager ---
        await manager.connect(websocket, user_id, user_type, http_base_url=http_base_url if user_type == 'provider' else None)
        # -------------------------------------

    except auth.JWTError as e:
        logger.error(f"WebSocket authentication failed (JWTError): {e}")
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
        return
    except Exception as e:
        logger.error(f"WebSocket connection setup failed: {e}")
        await websocket.close(code=status.WS_1003_UNSUPPORTED_DATA)
        if user_id:
            # Ensure cleanup happens even if connect fails mid-way
            await manager.disconnect(user_id)
        return

    # Main loop to listen for messages (responses) from the client via WebSocket
    try:
        while True:
            data = await websocket.receive_text()
            logger.debug(f"Received raw WS message from user {user_email} (ID: {user_id}): {data}")
            # This manager only handles single responses now
            await manager.receive_response(data)
    except WebSocketDisconnect as e:
        logger.info(f"WebSocket disconnected for user: {user_email} (ID: {user_id}), code: {e.code}, reason: {e.reason}")
    except Exception as e:
        logger.error(f"WebSocket error for user {user_email} (ID: {user_id}): {e}")
    finally:
        if user_id:
            await manager.disconnect(user_id)
            logger.info(f"Cleaned up connection manager for user {user_id}.")


# --- Decentralized Compute Endpoints ---

@app.post("/v1/models/pull")
async def pull_model_endpoint(request: schemas.ModelPullRequest, token: str = Depends(auth.oauth2_scheme)):
    """Sends a *non-streaming* command via WebSocket to pull a model."""
    auth.get_current_user(token, SessionLocal())
    try:
        model_id = extract_model_id_from_url(request.model)
        command = schemas.CommandRequest(
            method="POST",
            url="/v1/models/pull",
            data={"model": model_id} # Use resolved model_id
        )
        logger.info(f"Attempting to send pull command for model '{model_id}' to a provider via WebSocket.")
        provider_id, response_data = await send_command_to_provider(command, timeout=300) # Use WS helper

        if provider_id is None:
             raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                                 detail="No active provider nodes available for pull command.")

        logger.info(f"Pull command sent via WS to provider {provider_id}. Response: {response_data}")
        return JSONResponse(content=response_data) # Return the single response
    except HTTPException as e:
        raise e
    except ValueError as e:
         raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))
    except Exception as e:
        logger.exception("Unexpected error processing model pull request")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=f"Internal server error: {str(e)}")


# --- Modified Chat Completions Endpoint for Streaming ---
# Remove response_model as it returns a stream
@app.post("/v1/chat/completions")
async def chat_completion(request: schemas.ChatCompletionRequest, token: str = Depends(auth.oauth2_scheme)):
    """
    Forwards a chat completion request to a randomly selected provider node
    using HTTP streaming.
    """
    current_user = auth.get_current_user(token, SessionLocal()) # Verify auth
    logger.info(f"Chat completion request received from user {current_user.email} for model {request.model}, stream={request.stream}")

    # Ensure stream=true is explicitly requested from frontend for this endpoint logic
    if not request.stream:
        # Optionally handle non-streaming requests differently,
        # maybe via the old WebSocket method if needed, or just raise an error.
        # Forcing stream=True for this example.
        logger.warning("Request received with stream=false, forcing to true for streaming endpoint.")
        request.stream = True
        # Alternative:
        # raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST,
        #                     detail="This endpoint requires 'stream': true in the request body.")

    # Find a provider with an HTTP endpoint
    provider_info = manager.get_random_provider_info()
    if provider_info is None:
        logger.error("No active provider nodes with registered HTTP endpoints found.")
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                            detail="No suitable provider nodes available for chat completion.")

    provider_id, provider_base_url = provider_info
    target_url = f"{provider_base_url}/v1/chat/completions" # Construct target URL
    logger.info(f"Selected provider {provider_id} at {provider_base_url} for streaming chat completion.")

    # Prepare request data, ensuring stream=true
    request_data = request.dict()
    request_data['stream'] = True # Ensure it's true

    async def stream_generator():
        """Generator to proxy the stream from the provider."""
        nonlocal provider_id # Allow modifying provider_id in case of error
        try:
            # Use httpx.AsyncClient for streaming requests
            async with httpx.AsyncClient(timeout=httpx.Timeout(300.0)) as client: # Increased timeout
                 async with client.stream("POST", target_url, json=request_data) as response:
                    # Check for errors from the provider *before* streaming
                    if response.status_code != 200:
                         error_content = await response.aread()
                         logger.error(f"Provider {provider_id} ({target_url}) returned error {response.status_code}: {error_content.decode()}")
                         # Don't raise HTTPException here, as we can't send it mid-stream.
                         # Yield an error message or just stop. Best is usually to just stop.
                         yield f"data: {json.dumps({'error': {'message': f'Provider error {response.status_code}', 'code': response.status_code}})}\n\n"
                         yield f"data: [DONE]\n\n" # Signal end even on error
                         return # Stop generation

                    # Stream the response content chunk by chunk
                    logger.info(f"Successfully connected to provider {provider_id}, starting stream proxy.")
                    async for chunk in response.aiter_bytes():
                        # logger.debug(f"Received chunk from provider {provider_id}: {chunk}")
                        yield chunk # Forward the raw bytes directly

        except httpx.RequestError as e:
            logger.error(f"HTTP request error connecting to provider {provider_id} ({target_url}): {e}")
            # Yield a final error message in SSE format
            yield f"data: {json.dumps({'error': {'message': f'Failed to connect to provider: {e}', 'code': 503}})}\n\n"
            yield f"data: [DONE]\n\n"
        except asyncio.TimeoutError:
             logger.error(f"Timeout during streaming from provider {provider_id} ({target_url}).")
             yield f"data: {json.dumps({'error': {'message': 'Timeout during streaming response from provider', 'code': 504}})}\n\n"
             yield f"data: [DONE]\n\n"
        except Exception as e:
            logger.exception(f"Unexpected error during stream proxying from provider {provider_id}")
            yield f"data: {json.dumps({'error': {'message': f'Internal server error during streaming: {e}', 'code': 500}})}\n\n"
            yield f"data: [DONE]\n\n"
        finally:
             logger.info(f"Stream proxy finished for request to provider {provider_id}.")
             # Ensure response is closed if generator exits unexpectedly (httpx context manager handles this)

    # Return the StreamingResponse
    # Use text/event-stream for Server-Sent Events
    return StreamingResponse(stream_generator(), media_type="text/event-stream")

# ----------------------------------------------------

# /v1/models and /v1/models/status (use non-streaming WS command)
@app.get("/v1/models", response_model=schemas.ModelListResponse)
async def list_models(token: str = Depends(auth.oauth2_scheme)):
    """Gets model list from a random provider via WebSocket."""
    auth.get_current_user(token, SessionLocal())
    try:
        command = schemas.CommandRequest(method="GET", url="/v1/models", data=None)
        logger.info("Attempting to get model list from a provider via WebSocket.")
        provider_id, response_data = await send_command_to_provider(command, timeout=60) # Use WS helper

        if provider_id is None:
             raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                                 detail="No active provider nodes available to list models.")

        available_models = []
        if isinstance(response_data, dict) and "data" in response_data:
             if isinstance(response_data["data"], list):
                 available_models = response_data["data"]
             else:
                 logger.warning(f"Provider {provider_id} returned 'data' (via WS) but it was not a list: {response_data['data']}")
        else:
             logger.warning(f"Received unexpected format for model list (via WS) from provider {provider_id}: {response_data}")

        logger.info(f"Model list received via WS from provider {provider_id}.")
        return schemas.ModelListResponse(data=available_models, provider_id=provider_id)

    except HTTPException as e:
        raise e
    except Exception as e:
        logger.exception("Unexpected error getting model list")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=f"Internal server error: {str(e)}")

@app.get("/v1/models/status", response_model=schemas.ModelListResponse)
async def model_status(token: str = Depends(auth.oauth2_scheme)):
    """Gets model list from a random provider (same as /v1/models)."""
    logger.info("Model status request received, forwarding to /v1/models logic.")
    return await list_models(token=token)


# --- Other Endpoints (Keep as is, using non-streaming WS commands if applicable) ---
# /send-command/{user_id} (remains the same, uses WS)
# /broadcast-command (remains the same, uses WS)
# /public-stats (remains the same)
# /user (remains the same)
# /user/points (remains the same)
# /leaderboard/* (remain the same)
# Other static/redirect endpoints (remain the same)
# /device-registration (remains the same)
# / (root endpoint remains the same)

# ... (rest of your endpoints remain largely unchanged, check if any relied on the old send_command_to_provider behavior and adapt if needed) ...

# Example for /send-command/{user_id} confirmation (no change needed here)
@app.post("/send-command/{user_id}")
async def send_command_direct(user_id: int, command_request: schemas.CommandRequest, token: str = Depends(auth.oauth2_scheme), db: Session = Depends(get_db)):
    """Sends a NON-STREAMING command directly to a specific user ID via WebSocket."""
    # ... (implementation is unchanged, it correctly uses manager.send_command for WS) ...
    requesting_user = auth.get_current_user(token, db)
    target_user = db.query(models.User).filter(models.User.id == user_id).first()
    if not target_user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Target user not found")
    logger.info(f"User {requesting_user.email} initiating direct WS command to user {user_id}: {command_request.url}")
    try:
        future = await manager.send_command(user_id, command_request) # Uses WS
        result_json_str = await asyncio.wait_for(future, timeout=60)
        response_data = json.loads(result_json_str)
        logger.info(f"Direct WS command sent to user {user_id}. Response: {response_data}")
        return {"message": f"Direct command sent to user '{target_user.email}' (ID: {user_id})", "response": response_data}
    except ConnectionError as e:
        logger.error(f"Direct WS command failed: User {user_id} not connected. Error: {e}")
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"Target user {user_id} not connected.")
    except asyncio.TimeoutError:
        logger.error(f"Direct WS command to user {user_id} timed out.")
        raise HTTPException(status_code=status.HTTP_504_GATEWAY_TIMEOUT, detail=f"Timeout waiting for response from user {user_id}.")
    except json.JSONDecodeError:
         logger.error(f"Direct WS command response from user {user_id} was not valid JSON: {result_json_str}")
         return {"message": f"Direct command sent to user '{target_user.email}' (ID: {user_id})", "raw_response": result_json_str}
    except Exception as e:
        logger.error(f"Error sending direct WS command to user {user_id}: {e}")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=f"Server error sending direct WS command: {str(e)}")

# ... (include all your other unchanged endpoints here) ...
@app.get("/public-stats", response_model=schemas.PublicStats)
def get_public_stats():
    active_providers = len(manager.get_active_provider_ids())
    return schemas.PublicStats(
        active_nodes=active_providers,
        dllm_price={"yesterday": 0.073, "current": 0.1}, # Example data
        btc_price={"yesterday": 93825.89, "current": 100000.00}, # Example data
        twitter_link="https://x.com/ComputeMesh",
        discord_link="https://discord.gg/computemesh",
        online_discord_users=500, # Static example
        twitter_followers=3000 # Static example
    )

@app.get("/user", response_model=schemas.UserDashboard)
def get_user_info(token: str = Depends(auth.oauth2_scheme), db: Session = Depends(get_db)):
    current_user = auth.get_current_user(token, db)
    return schemas.UserDashboard(
        email=current_user.email,
        name=getattr(current_user, 'name', None),
        profile_picture=getattr(current_user, 'profile_picture', None),
        dllm_tokens=getattr(current_user, 'dllm_tokens', 0),
        referral_link=getattr(current_user, 'referral_link', None)
    )

@app.post("/user/points")
def add_points(points_request: schemas.PointsRequest, token: str = Depends(auth.oauth2_scheme), db: Session = Depends(get_db)):
    current_user = auth.get_current_user(token, db)
    points = points_request.points
    if not hasattr(current_user, 'dllm_tokens') or current_user.dllm_tokens is None:
         current_user.dllm_tokens = 0
    current_user.dllm_tokens += points
    db.commit()
    db.refresh(current_user)
    logger.info(f"Added {points} points to user {current_user.email}. New total: {current_user.dllm_tokens}")
    return {"detail": f"{points} points added.", "total_points": current_user.dllm_tokens}

@app.get("/leaderboard/users", response_model=List[schemas.LeaderboardUser])
def get_user_leaderboard(db: Session = Depends(get_db)):
    users = db.query(models.User)\
              .order_by(models.User.dllm_tokens.desc().nullslast())\
              .limit(10)\
              .all()
    return [
        schemas.LeaderboardUser(
            username=u.name or u.email.split('@')[0],
            profile_picture=u.profile_picture,
            score=u.dllm_tokens if u.dllm_tokens is not None else 0
        ) for u in users
    ]

@app.get("/leaderboard/agents", response_model=List[schemas.LeaderboardAgent])
def get_agent_leaderboard():
    return [
        {"agent_name": "GPT-4 Turbo", "agent_link": "#", "score": 98},
        {"agent_name": "Claude 3 Opus", "agent_link": "#", "score": 97},
    ]

@app.get("/signup")
def signup():
    return RedirectResponse(url="https://computemesh.network/")

@app.get("/survey")
def survey():
    return {"message": "ComputeMesh Survey is Coming Soon, Hang Tight!🚀"}

@app.get("/leaderboard/agents/all")
def get_all_agents():
    return {"message": "Agent listing Cooking. Hang Tight!🚀"}

@app.post("/device-registration", status_code=status.HTTP_201_CREATED)
def device_registration(request: schemas.DeviceRegistrationRequest, db: Session = Depends(get_db)):
    device = db.query(models.Device).filter(models.Device.device_id == request.device_id).first()
    if device:
        return {"status": "already recorded", "registered_date": device.registered_date}
    new_device = models.Device(device_id=request.device_id, registered_date=datetime.utcnow())
    db.add(new_device)
    db.commit()
    logger.info(f"Registered new device: {request.device_id}")
    return {"status": "registered", "device_id": new_device.device_id}

@app.get("/")
async def root():
    logger.info("--- Root endpoint '/' was accessed ---")
    return {"message": "ComputeMesh API is running!"}