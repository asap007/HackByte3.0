import asyncio
import json
from typing import Dict, Tuple
from fastapi import WebSocket
from jose import JWTError, jwt
from sqlalchemy.orm import Session
import schemas
from auth import SECRET_KEY, ALGORITHM
from typing import List, Optional, Dict, Any
import uuid
import redis
from database import redis_client

def generate_unique_command_id() -> str:
    return str(uuid.uuid4())

class ConnectionManager:
    def __init__(self):
        self.active_connections: Dict[int, WebSocket] = {}
        self.pending_commands: Dict[str, Tuple[int, asyncio.Future]] = {}
        self.lock = asyncio.Lock()
        self.heartbeat_interval = 30  # seconds

    async def connect(self, websocket: WebSocket, user_id: int):
        if user_id in self.active_connections:
            existing_ws = self.active_connections[user_id]
            await existing_ws.close(code=1001)
            print(f"Disconnected existing connection for user_id: {user_id}")
        
        await websocket.accept()
        self.active_connections[user_id] = websocket
        print(f"User {user_id} connected.")
        
        # Start heartbeat task
        asyncio.create_task(self.heartbeat(user_id, websocket))

    async def disconnect(self, user_id: int):
        if user_id in self.active_connections:
            del self.active_connections[user_id]
            print(f"User {user_id} disconnected.")
        
        to_remove = []
        async with self.lock:
            for cmd_id, (uid, _) in list(self.pending_commands.items()):
                if uid == user_id:
                    to_remove.append(cmd_id)
        
        for cmd_id in to_remove:
            async with self.lock:
                entry = self.pending_commands.pop(cmd_id, None)
            if entry:
                _, future = entry
                if not future.done():
                    future.set_exception(ConnectionError("Connection lost while waiting for command response."))

    async def heartbeat(self, user_id: int, websocket: WebSocket):
        while True:
            await asyncio.sleep(self.heartbeat_interval)
            try:
                await websocket.send_json({"type": "heartbeat"})
                print(f"Heartbeat sent to user {user_id}")
            except Exception as e:
                print(f"Heartbeat failed for user {user_id}: {e}")
                await self.disconnect(user_id)
                break

    async def send_command(self, user_id: int, command_request: schemas.CommandRequest) -> asyncio.Future:
        if user_id not in self.active_connections:
            raise ConnectionError("User is not connected")
        
        websocket = self.active_connections[user_id]
        command_id = generate_unique_command_id()
        command = command_request.url
        command_payload = {
            "command_id": command_id,
            "method": command_request.method,
            "url": command_request.url,
            "data": command_request.data
        }
        await websocket.send_text(json.dumps(command_payload))
        print(f"Sent command '{command}' with id '{command_id}' to user_id {user_id}.")
        
        loop = asyncio.get_event_loop()
        future = loop.create_future()
        async with self.lock:
            self.pending_commands[command_id] = (user_id, future)
        
        return future

    async def broadcast_command(self, command: str, data: Any = None) -> Dict[int, Any]:
        results = {}
        for user_id, websocket in self.active_connections.items():
            try:
                command_id = generate_unique_command_id()
                command_payload = {
                    "command_id": command_id,
                    "command": command,
                    "data": data
                }
                await websocket.send_text(json.dumps(command_payload))
                print(f"Broadcasted command '{command}' with id '{command_id}' to user_id {user_id}.")
                
                loop = asyncio.get_event_loop()
                future = loop.create_future()
                async with self.lock:
                    self.pending_commands[command_id] = (user_id, future)
                
                try:
                    result = await asyncio.wait_for(future, timeout=30)
                    results[user_id] = result
                except asyncio.TimeoutError:
                    results[user_id] = "Timeout waiting for response."
            except Exception as e:
                results[user_id] = f"Error: {str(e)}"
        return results

    async def receive_response(self, message: str):
        try:
            data = json.loads(message)
            command_id = data.get("command_id")
            result = data.get("result")
            if not command_id:
                print("Received response without command_id.")
                return
            async with self.lock:
                entry = self.pending_commands.pop(command_id, None)
            if entry:
                user_id, future = entry
                if not future.done():
                    future.set_result(result)
                    print(f"Received response for command_id '{command_id}' from user_id {user_id}: {result}")
            else:
                print(f"No pending command for command_id '{command_id}'.")
        except json.JSONDecodeError:
            print("Received invalid JSON message.")

manager = ConnectionManager()