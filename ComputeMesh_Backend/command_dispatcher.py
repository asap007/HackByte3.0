import asyncio
import json
from typing import Dict, Tuple, Set, Optional, Any, List
from fastapi import WebSocket, WebSocketDisconnect
import uuid
import random # Import random
import logging

# Assuming schemas is imported correctly
import schemas

logger = logging.getLogger(__name__)

def generate_unique_command_id() -> str:
    return str(uuid.uuid4())

class ConnectionManager:
    def __init__(self):
        # Stores active WebSocket connection for each user_id
        self.active_connections: Dict[int, WebSocket] = {}
        # Stores futures waiting for responses, keyed by command_id
        self.pending_commands: Dict[str, Tuple[int, asyncio.Future]] = {}
        # Stores the user_ids of currently connected providers
        self.active_providers: Set[int] = set()
        # Lock for thread-safe operations on shared resources
        self.lock = asyncio.Lock()
        # Heartbeat configuration
        self.heartbeat_interval = 30  # seconds
        logger.info("ConnectionManager initialized.")

    async def connect(self, websocket: WebSocket, user_id: int, user_type: str):
        """Registers a new connection and tracks if it's a provider."""
        async with self.lock:
            # Close any existing connection for the same user_id
            if user_id in self.active_connections:
                existing_ws = self.active_connections.pop(user_id)
                # Also remove from providers if they were one
                if user_id in self.active_providers:
                    self.active_providers.discard(user_id)
                try:
                    await existing_ws.close(code=1001, reason="New connection established")
                    logger.warning(f"Closed existing WebSocket for user_id: {user_id} due to new connection.")
                except Exception as e:
                    logger.error(f"Error closing stale WebSocket for user {user_id}: {e}")


            await websocket.accept()
            self.active_connections[user_id] = websocket
            logger.info(f"User {user_id} (type: {user_type}) connected via WebSocket.")

            # Add to active providers if applicable
            if user_type == 'provider':
                self.active_providers.add(user_id)
                logger.info(f"User {user_id} registered as an active provider. Total providers: {len(self.active_providers)}")

        # Start heartbeat task for this connection
        asyncio.create_task(self.heartbeat(user_id, websocket))

    async def disconnect(self, user_id: int):
        """Unregisters a connection and cleans up associated resources."""
        async with self.lock:
            # Remove from active connections
            websocket = self.active_connections.pop(user_id, None)
            if websocket:
                 logger.info(f"User {user_id} disconnected.")
            else:
                 logger.warning(f"Attempted to disconnect non-existent user_id: {user_id}")


            # Remove from active providers if they were one
            if user_id in self.active_providers:
                self.active_providers.discard(user_id)
                logger.info(f"User {user_id} removed from active providers. Total providers: {len(self.active_providers)}")

            # Cancel any pending commands for this user
            commands_to_cancel = []
            for cmd_id, (uid, future) in self.pending_commands.items():
                if uid == user_id:
                    commands_to_cancel.append((cmd_id, future))

            for cmd_id, future in commands_to_cancel:
                if cmd_id in self.pending_commands: # Check again as it might have been removed
                     del self.pending_commands[cmd_id]
                if future and not future.done():
                    try:
                         future.set_exception(ConnectionError(f"User {user_id} disconnected while waiting for response."))
                         logger.warning(f"Cancelled pending command {cmd_id} for disconnected user {user_id}.")
                    except asyncio.InvalidStateError:
                         logger.warning(f"Future for command {cmd_id} was already done when trying to cancel for user {user_id}.")


    async def heartbeat(self, user_id: int, websocket: WebSocket):
        """Periodically sends a ping to keep the connection alive and detect closures."""
        while user_id in self.active_connections and self.active_connections[user_id] == websocket:
            await asyncio.sleep(self.heartbeat_interval)
            try:
                await websocket.send_json({"type": "ping"})
                # logger.debug(f"Sent ping to user {user_id}")
            except WebSocketDisconnect:
                logger.warning(f"Heartbeat detected WebSocketDisconnect for user {user_id}. Cleaning up.")
                await self.disconnect(user_id) # Ensure cleanup on disconnect
                break
            except Exception as e:
                logger.error(f"Heartbeat failed for user {user_id}: {e}. Assuming disconnection.")
                await self.disconnect(user_id) # Ensure cleanup on error
                break
        # logger.debug(f"Heartbeat task stopped for user {user_id}")


    async def send_command(self, user_id: int, command_request: schemas.CommandRequest) -> asyncio.Future:
        """Sends a command to a specific user and returns a Future for the response."""
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
            self.pending_commands[command_id] = (user_id, future)

        try:
            await websocket.send_text(json.dumps(command_payload))
            logger.info(f"Sent command (ID: {command_id}, URL: {command_request.url}) to user {user_id}.")
            return future
        except Exception as e:
             logger.error(f"Failed to send command {command_id} to user {user_id}: {e}")
             # Clean up the pending command if sending failed
             async with self.lock:
                 entry = self.pending_commands.pop(command_id, None)
             if entry and not entry[1].done():
                 entry[1].set_exception(e)
             raise ConnectionError(f"Failed to send command to user {user_id}: {e}") from e

    async def broadcast_command(self, command_request: schemas.CommandRequest) -> Dict[int, Any]:
        """Broadcasts a command to all connected clients (use with caution)."""
        # Consider if you need to broadcast only to providers or all users
        # This example broadcasts to ALL connected users.
        results = {}
        user_ids_to_send = list(self.active_connections.keys()) # Get a snapshot of current users

        for user_id in user_ids_to_send:
            try:
                # Use send_command logic but handle results here
                future = await self.send_command(user_id, command_request)
                # Add a timeout for broadcast responses
                try:
                    result = await asyncio.wait_for(future, timeout=30) # Example timeout
                    results[user_id] = json.loads(result) # Assume JSON response
                except asyncio.TimeoutError:
                    logger.warning(f"Broadcast response timeout for user {user_id}")
                    results[user_id] = {"error": "Timeout waiting for response."}
                except json.JSONDecodeError:
                     logger.warning(f"Broadcast response from user {user_id} was not valid JSON")
                     results[user_id] = {"error": "Invalid JSON response received."} # Or return raw string if preferred
                except ConnectionError:
                     logger.warning(f"User {user_id} disconnected before broadcast response.")
                     results[user_id] = {"error": "User disconnected."}

            except ConnectionError as e:
                 logger.warning(f"Cannot broadcast to user {user_id} (not connected): {e}")
                 results[user_id] = {"error": "User not connected."}
            except Exception as e:
                 logger.error(f"Error broadcasting command to user {user_id}: {e}")
                 results[user_id] = {"error": f"Failed to send broadcast: {str(e)}"}
        return results


    async def receive_response(self, message: str):
        """Processes incoming messages, matching them to pending commands."""
        try:
            data = json.loads(message)
            command_id = data.get("command_id")

            # Handle potential pongs from heartbeats if client sends them
            if data.get("type") == "pong":
                # logger.debug(f"Received pong from a client.")
                return

            if not command_id:
                logger.warning(f"Received message without command_id: {message}")
                return

            result_data = data.get("result") # Result can be anything (dict, list, string, null)

        except json.JSONDecodeError:
            logger.warning(f"Received non-JSON message, cannot process as response: {message}")
            # Decide how to handle non-JSON messages if they are expected for some reason
            return
        except Exception as e:
             logger.error(f"Error parsing received message: {e} - Message: {message}")
             return


        async with self.lock:
            entry = self.pending_commands.pop(command_id, None)

        if entry:
            user_id, future = entry
            if future and not future.done():
                # Pass the raw JSON string representation of the result back
                # The send_command_to_client function will handle parsing it
                future.set_result(json.dumps(result_data))
                logger.info(f"Received response for command {command_id} from user {user_id}.")
            elif future and future.done():
                 logger.warning(f"Received response for already completed command {command_id} from user {user_id}.")
            else:
                 logger.error(f"Internal error: Found entry for command {command_id} but future is invalid.") # Should not happen
        else:
            logger.warning(f"Received response for unknown or already processed command_id: {command_id}")


    def get_active_provider_ids(self) -> List[int]:
        """Returns a list of currently connected provider user IDs."""
        # Return a copy to prevent modification issues
        return list(self.active_providers)

    def get_random_provider_id(self) -> Optional[int]:
        """Selects a random user ID from the active providers."""
        # No lock needed for reading the set if additions/removals are locked
        if not self.active_providers:
            return None
        # Convert set to list for random.choice
        provider_list = list(self.active_providers)
        return random.choice(provider_list)

# Instantiate the manager
manager = ConnectionManager()