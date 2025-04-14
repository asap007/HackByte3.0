# command_dispatcher.py
import asyncio
import json
from typing import Dict, Tuple, Set, Optional, Any, List
from fastapi import WebSocket, WebSocketDisconnect
import uuid
import random
import logging
import schemas # Keep schemas import

logger = logging.getLogger(__name__)

def generate_unique_command_id() -> str:
    return str(uuid.uuid4())

class ConnectionManager:
    def __init__(self):
        self.active_connections: Dict[int, WebSocket] = {}
        self.pending_commands: Dict[str, Tuple[int, asyncio.Future]] = {}
        self.active_providers: Set[int] = set()
        self.provider_http_endpoints: Dict[int, str] = {}
        self.lock = asyncio.Lock()
        self.heartbeat_interval = 30 # seconds between pings
        self.heartbeat_timeout = 60 # seconds to wait for pong (optional, can rely on read errors)
        logger.info("ConnectionManager initialized.")

    async def connect(self, websocket: WebSocket, user_id: int, user_type: str, http_base_url: Optional[str] = None):
        """Registers a new connection, tracks provider status and HTTP endpoint."""
        async with self.lock:
            # --- Close existing connection logic ---
            if user_id in self.active_connections:
                existing_ws = self.active_connections.pop(user_id)
                if user_id in self.active_providers:
                    self.active_providers.discard(user_id)
                    self.provider_http_endpoints.pop(user_id, None)
                try:
                    # Use a standard code like 1001 (Going Away)
                    await existing_ws.close(code=1001, reason="New connection established")
                    logger.warning(f"Closed existing WebSocket for user_id: {user_id} due to new connection.")
                except Exception as e:
                    # Log error but continue, the old connection might already be dead
                    logger.error(f"Error closing stale WebSocket for user {user_id}: {e}")
            # --- End close existing ---

            await websocket.accept()
            self.active_connections[user_id] = websocket
            logger.info(f"User {user_id} (type: {user_type}) connected via WebSocket.")

            if user_type == 'provider':
                self.active_providers.add(user_id)
                if http_base_url:
                    if http_base_url.startswith("http://") or http_base_url.startswith("https"):
                        self.provider_http_endpoints[user_id] = http_base_url.rstrip('/')
                        logger.info(f"User {user_id} registered as active provider with HTTP endpoint: {self.provider_http_endpoints[user_id]}. Total providers: {len(self.active_providers)}")
                    else:
                        logger.warning(f"Provider {user_id} connected but provided invalid http_base_url: {http_base_url}")
                else:
                    logger.warning(f"Provider {user_id} connected but did not provide an http_base_url.")
            else:
                 self.provider_http_endpoints.pop(user_id, None)

        # --- Start heartbeat task FOR THIS CONNECTION ---
        # Ensure this line is present and uncommented
        asyncio.create_task(self.heartbeat(user_id, websocket))
        # ----------------------------------------------

    async def disconnect(self, user_id: int):
        """Unregisters a connection and cleans up associated resources."""
        async with self.lock:
            websocket = self.active_connections.pop(user_id, None)
            self.provider_http_endpoints.pop(user_id, None)
            if websocket:
                 logger.info(f"User {user_id} disconnected.")
            # else: # Removing this warning as disconnect might be called multiple times during cleanup
            #      logger.warning(f"Attempted to disconnect non-existent user_id: {user_id}")

            was_provider = user_id in self.active_providers
            self.active_providers.discard(user_id)
            if was_provider:
                logger.info(f"User {user_id} removed from active providers. Total providers: {len(self.active_providers)}")

            # Cancel any pending commands for this user
            commands_to_cancel = []
            # Iterate over a copy of items to avoid modification issues during iteration
            for cmd_id, (uid, future) in list(self.pending_commands.items()):
                if uid == user_id:
                    commands_to_cancel.append((cmd_id, future))

            for cmd_id, future in commands_to_cancel:
                # Check again if it still exists before deleting
                pending_entry = self.pending_commands.pop(cmd_id, None)
                # Only set exception if future exists and is not already done
                if pending_entry and future and not future.done():
                    try:
                         future.set_exception(ConnectionError(f"User {user_id} disconnected while waiting for response."))
                         logger.warning(f"Cancelled pending command {cmd_id} for disconnected user {user_id}.")
                    except asyncio.InvalidStateError:
                         # This can happen in race conditions, log it but don't crash
                         logger.warning(f"Future for command {cmd_id} was already done/cancelled when trying to cancel for user {user_id}.")

    # --- Add this method back ---
    async def heartbeat(self, user_id: int, websocket: WebSocket):
        """Periodically sends a ping to keep the connection alive and detect closures."""
        while True:
            # Check if the connection still exists *before* sleeping
            async with self.lock:
                if user_id not in self.active_connections or self.active_connections[user_id] != websocket:
                    logger.debug(f"Heartbeat stopping for user {user_id}: Connection mismatch or closed.")
                    break # Exit loop if connection closed/replaced

            await asyncio.sleep(self.heartbeat_interval)

            # Check again *after* sleeping, before sending ping
            async with self.lock:
                 if user_id not in self.active_connections or self.active_connections[user_id] != websocket:
                     logger.debug(f"Heartbeat stopping for user {user_id} after sleep: Connection mismatch or closed.")
                     break

            try:
                # Use ping frame if supported, otherwise JSON ping
                # await websocket.ping() # Standard WebSocket ping
                # Or stick to JSON ping for simplicity across clients:
                await websocket.send_json({"type": "ping"})
                # logger.debug(f"Sent ping to user {user_id}")

                # Optional: Add a timeout to wait for a pong response if needed
                # try:
                #     await asyncio.wait_for(websocket.receive_json(), timeout=self.heartbeat_timeout)
                #     # Process pong if necessary
                # except asyncio.TimeoutError:
                #     logger.warning(f"Pong timeout for user {user_id}. Disconnecting.")
                #     await self.disconnect(user_id) # Or close directly
                #     break
                # except WebSocketDisconnect: # Handle disconnect during receive
                #      logger.warning(f"Heartbeat detected WebSocketDisconnect while waiting for pong for user {user_id}.")
                #      # disconnect will be handled by the main loop's exception handler
                #      break

            except WebSocketDisconnect:
                logger.warning(f"Heartbeat detected WebSocketDisconnect for user {user_id} during ping send.")
                # No need to call self.disconnect here, the main loop's finally block will handle it
                break # Exit heartbeat loop
            except Exception as e:
                # Catch broader errors during send (e.g., connection reset)
                logger.error(f"Heartbeat send error for user {user_id}: {e}. Assuming disconnection.")
                # No need to call self.disconnect here, main loop handles it
                break # Exit heartbeat loop
        logger.debug(f"Heartbeat task ended for user {user_id}")
    # --- End of heartbeat method ---

    async def send_command(self, user_id: int, command_request: schemas.CommandRequest) -> asyncio.Future:
        """Sends a *non-streaming* command via WebSocket."""
        async with self.lock:
            if user_id not in self.active_connections:
                logger.error(f"Attempted to send command to disconnected user: {user_id}")
                raise ConnectionError(f"User {user_id} is not connected")

            websocket = self.active_connections[user_id]
            command_id = generate_unique_command_id()
            command_payload = {
                "command_id": command_id,
                "method": command_request.method,
                "url": command_request.url,
                "data": command_request.data
            }
            future = asyncio.get_event_loop().create_future()
            # Store user_id along with future for potential cancellation
            self.pending_commands[command_id] = (user_id, future)

        try:
            await websocket.send_text(json.dumps(command_payload))
            logger.info(f"Sent command (ID: {command_id}, URL: {command_request.url}) to user {user_id}.")
            return future
        except Exception as e:
             logger.error(f"Failed to send command {command_id} to user {user_id}: {e}")
             async with self.lock:
                 entry = self.pending_commands.pop(command_id, None)
             if entry and not entry[1].done():
                 try:
                     entry[1].set_exception(e)
                 except asyncio.InvalidStateError: pass # Already set
             # Re-raise as ConnectionError or a custom exception
             raise ConnectionError(f"Failed to send command to user {user_id}: {e}") from e

    async def broadcast_command(self, command_request: schemas.CommandRequest) -> Dict[int, Any]:
        """Broadcasts a command to all connected clients (use with caution)."""
        # ... (implementation remains the same) ...
        results = {}
        # Get a snapshot of current users under lock for safety
        async with self.lock:
            user_ids_to_send = list(self.active_connections.keys())

        logger.warning(f"Broadcasting command {command_request.url} to {len(user_ids_to_send)} user(s).")

        tasks = []
        # Create tasks to send commands concurrently
        for user_id in user_ids_to_send:
             # Define a helper async function to handle sending and waiting for one user
             async def send_and_wait(uid, cmd):
                 try:
                     future = await self.send_command(uid, cmd)
                     result_json_str = await asyncio.wait_for(future, timeout=30)
                     return uid, json.loads(result_json_str)
                 except asyncio.TimeoutError:
                     logger.warning(f"Broadcast response timeout for user {uid}")
                     return uid, {"error": "Timeout waiting for response."}
                 except (ConnectionError, json.JSONDecodeError) as send_err:
                     logger.warning(f"Broadcast error for user {uid}: {send_err}")
                     return uid, {"error": str(send_err)}
                 except Exception as e:
                     logger.error(f"Unexpected broadcast error for user {uid}: {e}")
                     return uid, {"error": "Unexpected server error during broadcast."}

             tasks.append(send_and_wait(user_id, command_request))

        # Gather results from all tasks
        task_results = await asyncio.gather(*tasks)

        # Populate the results dictionary
        for user_id, result_data in task_results:
            results[user_id] = result_data

        logger.info("Broadcast finished.")
        return results

    async def receive_response(self, message: str):
        """Processes incoming WebSocket messages (expected to be single JSON responses)."""
        # ... (implementation remains the same) ...
        try:
            data = json.loads(message)
            command_id = data.get("command_id")

            if data.get("type") == "pong":
                # logger.debug(f"Received pong.") # Can log if needed
                return

            if not command_id:
                logger.warning(f"Received WebSocket message without command_id: {message[:100]}...")
                return

            # result can be anything (dict, list, string, null, etc.)
            result_data = data.get("result")

        except json.JSONDecodeError:
            logger.warning(f"Received non-JSON WebSocket message: {message[:100]}...")
            return
        except Exception as e:
             logger.error(f"Error parsing received WebSocket message: {e} - Message: {message[:100]}...")
             return

        # --- Safely handle future completion ---
        async with self.lock:
            entry = self.pending_commands.pop(command_id, None)

        if entry:
            _user_id, future = entry # Unpack user_id (maybe use later?)
            # Check if future exists and is not already done/cancelled
            if future and not future.done():
                try:
                    # Pass the raw JSON string of the result part back
                    future.set_result(json.dumps(result_data))
                    # logger.info(f"Received response for command {command_id}.")
                except asyncio.InvalidStateError:
                     logger.warning(f"Attempted to set result on already completed future for command {command_id}.")
            elif future and future.done():
                 logger.warning(f"Received response for already completed/cancelled command {command_id}.")
            # else: # Should not happen if entry exists
            #      logger.error(f"Internal error: Found entry for command {command_id} but future is invalid.")
        else:
            # This can happen if the response arrives after a timeout or disconnect cleanup
            logger.warning(f"Received response for unknown or already processed/cancelled command_id: {command_id}")
        # --- End safe future handling ---

    def get_active_provider_ids(self) -> List[int]:
        """Returns a list of currently connected provider user IDs."""
        # Reading the set should be safe without a lock if adds/removes are locked
        return list(self.active_providers)

    def get_random_provider_info(self) -> Optional[Tuple[int, str]]:
        """Selects a random provider ID and their registered HTTP endpoint."""
        # Reading set/dict should be safe without lock if adds/removes are locked
        if not self.active_providers: return None
        eligible_provider_ids = [pid for pid in self.active_providers if pid in self.provider_http_endpoints]
        if not eligible_provider_ids:
            logger.warning("No active providers have registered HTTP endpoints.")
            return None
        chosen_id = random.choice(eligible_provider_ids)
        # Endpoint should exist due to the filter, but check anyway
        endpoint = self.provider_http_endpoints.get(chosen_id)
        if not endpoint:
            logger.error(f"Inconsistency: Provider {chosen_id} is active but endpoint missing.")
            # Attempt to find another one quickly? Or just return None
            return None
        return chosen_id, endpoint

    def get_random_provider_id(self) -> Optional[int]:
        """Selects a random user ID from active providers (kept for compatibility)."""
        if not self.active_providers: return None
        provider_list = list(self.active_providers)
        return random.choice(provider_list)

# Instantiate the manager (remains the same)
manager = ConnectionManager()