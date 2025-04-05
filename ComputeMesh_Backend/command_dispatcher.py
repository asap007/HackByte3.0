import asyncio
import json
from typing import Dict, Tuple, List, Optional, Any
from fastapi import WebSocket
# from jose import JWTError, jwt # Not used directly here
# from sqlalchemy.orm import Session # Not used directly here
import schemas
# from auth import SECRET_KEY, ALGORITHM # Not used directly here
import uuid
# import redis # Not used directly here
# from database import redis_client # Not used directly here
import logging # Use logging instead of print for better practice

logger = logging.getLogger(__name__) # Use FastAPI's logger or configure your own

def generate_unique_command_id() -> str:
    return str(uuid.uuid4())

class ConnectionManager:
    def __init__(self):
        # user_id -> WebSocket mapping
        self.active_connections: Dict[int, WebSocket] = {}
        # command_id -> (user_id, Future) mapping
        self.pending_commands: Dict[str, Tuple[int, asyncio.Future]] = {}
        self.lock = asyncio.Lock()
        self.heartbeat_interval = 30  # seconds
        self.heartbeat_timeout = 60 # seconds to wait for pong or disconnect

    async def connect(self, websocket: WebSocket, user_id: int):
        await websocket.accept()
        async with self.lock: # Protect access to active_connections
            # Close any existing connection for the same user_id cleanly
            if user_id in self.active_connections:
                existing_ws = self.active_connections.pop(user_id, None)
                if existing_ws:
                    logger.warning(f"Closing existing connection for user_id: {user_id}")
                    # Use a task to avoid blocking connect if close takes time
                    asyncio.create_task(existing_ws.close(code=status.WS_1008_POLICY_VIOLATION, reason="New connection established")) # Use standard code
            # Store the new connection
            self.active_connections[user_id] = websocket
            logger.info(f"User {user_id} connected. Total connections: {len(self.active_connections)}")
            # Consider starting heartbeat *after* adding to dict if needed, but current is likely fine

        # Start heartbeat task - consider passing the lock if needed by heartbeat logic
        # asyncio.create_task(self.heartbeat(user_id, websocket)) # Optional: If you implement ping/pong

    async def disconnect(self, user_id: int):
        async with self.lock:
            websocket = self.active_connections.pop(user_id, None)
            if websocket:
                logger.info(f"User {user_id} disconnected. Total connections: {len(self.active_connections)}")
                # Optional: Try to close the websocket gracefully if not already closed
                # try:
                #     await websocket.close(code=status.WS_1000_NORMAL_CLOSURE)
                # except Exception:
                #     pass # Ignore errors if already closed
            else:
                 logger.info(f"Attempted to disconnect user {user_id}, but no active connection found.")


            # Clean up pending commands for this user
            to_remove = [cmd_id for cmd_id, (uid, _) in self.pending_commands.items() if uid == user_id]

            if to_remove:
                 logger.warning(f"Cancelling {len(to_remove)} pending commands for disconnected user {user_id}.")
                 for cmd_id in to_remove:
                     entry = self.pending_commands.pop(cmd_id, None)
                     if entry:
                         _, future = entry
                         if future and not future.done():
                             future.set_exception(ConnectionError(f"User {user_id} disconnected while waiting for command '{cmd_id}' response."))

    # --- Optional Heartbeat Improvement (Ping/Pong) ---
    # async def heartbeat(self, user_id: int, websocket: WebSocket):
    #     while user_id in self.active_connections and self.active_connections[user_id] == websocket:
    #         try:
    #             # Send ping and wait for pong
    #             await asyncio.wait_for(websocket.ping(), timeout=self.heartbeat_interval / 2)
    #             logger.debug(f"Ping sent to user {user_id}")
    #             # If using FastAPI's built-in ping/pong, you might not need explicit pong waiting
    #             # Just rely on exceptions during send/receive
    #             await asyncio.sleep(self.heartbeat_interval)
    #         except asyncio.TimeoutError:
    #             logger.warning(f"Ping timeout for user {user_id}. Disconnecting.")
    #             await self.disconnect(user_id)
    #             break
    #         except Exception as e:
    #             logger.error(f"Heartbeat error for user {user_id}: {e}. Disconnecting.")
    #             await self.disconnect(user_id)
    #             break
    #     logger.debug(f"Heartbeat task stopped for user {user_id}")
    # --- End Optional Heartbeat ---


    async def send_command(self, user_id: int, command_request: schemas.CommandRequest) -> asyncio.Future:
        async with self.lock: # Ensure connection exists while sending
             if user_id not in self.active_connections:
                 logger.error(f"Attempted to send command to disconnected user: {user_id}")
                 raise ConnectionError(f"User {user_id} is not connected")
             websocket = self.active_connections[user_id]

        command_id = generate_unique_command_id()
        # Ensure data is serializable (FastAPI request models usually are)
        try:
            command_payload = {
                "command_id": command_id,
                "method": command_request.method,
                "url": command_request.url,
                "data": command_request.data # Assumes data is already a dict/list/primitive
            }
            payload_str = json.dumps(command_payload)
        except TypeError as e:
             logger.error(f"Failed to serialize command data for user {user_id}, command {command_request.url}: {e}")
             raise ValueError(f"Command data not JSON serializable: {e}")

        try:
            await websocket.send_text(payload_str)
            logger.info(f"Sent command (ID: {command_id}) {command_request.method} {command_request.url} to user {user_id}.")
        except Exception as e:
            logger.error(f"Failed to send command (ID: {command_id}) to user {user_id}: {e}")
            # Consider disconnecting the user if send fails persistently
            # await self.disconnect(user_id)
            raise ConnectionError(f"Failed to send command to user {user_id}: {e}")

        loop = asyncio.get_running_loop() # Use get_running_loop in async context
        future = loop.create_future()
        async with self.lock:
            self.pending_commands[command_id] = (user_id, future)

        return future

    async def broadcast_command(self, command_request: schemas.CommandRequest) -> Dict[int, Any]:
        """Broadcasts a command defined by CommandRequest to all connected users."""
        results = {}
        # Use a consistent payload structure with send_command
        command_payload_template = {
            "method": command_request.method,
            "url": command_request.url,
            "data": command_request.data
        }

        # Get a snapshot of connections under lock
        async with self.lock:
            connections_snapshot = list(self.active_connections.items())

        # Prepare futures outside the send loop
        futures_dict: Dict[int, Tuple[str, asyncio.Future]] = {}
        for user_id, _ in connections_snapshot:
            command_id = generate_unique_command_id()
            loop = asyncio.get_running_loop()
            future = loop.create_future()
            futures_dict[user_id] = (command_id, future)
            # Store pending command under lock immediately
            async with self.lock:
                 # Check if user disconnected between snapshot and now
                 if user_id in self.active_connections:
                     self.pending_commands[command_id] = (user_id, future)
                 else:
                      # User disconnected, don't track future
                      futures_dict.pop(user_id, None) # Remove from our temporary dict
                      logger.warning(f"User {user_id} disconnected before broadcast command {command_id} could be stored.")


        # Send commands
        for user_id, websocket in connections_snapshot:
             if user_id not in futures_dict: # Skip if already disconnected
                 continue

             command_id, future = futures_dict[user_id]
             command_payload = {"command_id": command_id, **command_payload_template}

             try:
                 payload_str = json.dumps(command_payload)
                 await websocket.send_text(payload_str)
                 logger.info(f"Broadcasted command (ID: {command_id}) {command_request.method} {command_request.url} to user {user_id}.")
             except Exception as e:
                 logger.error(f"Error broadcasting command (ID: {command_id}) to user {user_id}: {e}")
                 # Remove pending command and set exception on future if send fails
                 async with self.lock:
                     entry = self.pending_commands.pop(command_id, None)
                 if entry and not future.done():
                     future.set_exception(ConnectionError(f"Failed to send broadcast command: {e}"))
                 # Remove from our temporary dict as well
                 futures_dict.pop(user_id, None)


        # Wait for results
        for user_id, (command_id, future) in futures_dict.items():
            try:
                # Use a reasonable timeout for broadcast responses
                result = await asyncio.wait_for(future, timeout=30)
                results[user_id] = result # Store the full response object
            except asyncio.TimeoutError:
                logger.warning(f"Timeout waiting for broadcast response (ID: {command_id}) from user {user_id}.")
                results[user_id] = {"error": "Timeout waiting for response."}
                # Clean up pending command on timeout
                async with self.lock:
                    self.pending_commands.pop(command_id, None)
            except Exception as e:
                logger.error(f"Error waiting for broadcast response (ID: {command_id}) from user {user_id}: {e}")
                results[user_id] = {"error": f"Error receiving response: {str(e)}"}
                # Pending command should have been removed when exception was set (e.g. disconnect) or cleaned up here if needed

        return results


    async def receive_response(self, message: str):
        """Handles incoming messages, expecting JSON with command_id and response payload."""
        try:
            # STEP 1: Parse the incoming JSON string
            data = json.loads(message)
            if not isinstance(data, dict):
                 logger.warning(f"Received non-dict JSON message: {message}")
                 return

            # STEP 2: Get the command_id
            command_id = data.get("command_id")
            if not command_id:
                logger.warning(f"Received message without command_id: {message}")
                # Could be heartbeat pong or other message type - handle if necessary
                # if data.get("type") == "heartbeat_pong": logger.debug("Received pong")
                return

            # STEP 3: Find the pending command Future
            async with self.lock:
                entry = self.pending_commands.pop(command_id, None)

            # STEP 4: Resolve the Future with the ENTIRE parsed dictionary
            if entry:
                user_id, future = entry
                if future and not future.done():
                    # Set the result to the whole dictionary received
                    future.set_result(data)
                    # Log the keys received for clarity, avoid logging potentially large values
                    logger.info(f"Received response for command_id '{command_id}' from user_id {user_id}. Keys: {list(data.keys())}")
                    logger.debug(f"Full response data for {command_id}: {data}") # Debug level for full data
                elif future and future.done():
                     logger.warning(f"Received response for already completed command_id '{command_id}' from user_id {user_id}.")
            else:
                logger.warning(f"Received response for unknown or already handled command_id '{command_id}'. Message: {message}")

        except json.JSONDecodeError:
            logger.error(f"Received invalid JSON message: {message}")
        except Exception as e:
             logger.exception(f"Error processing received message: {message}") # Log full exception traceback


manager = ConnectionManager()