from pydantic import BaseModel, EmailStr, Field, validator
from typing import List, Optional, Dict, Any, Literal
import re
from datetime import datetime # Ensure datetime is imported if used

# Define allowed user types
UserType = Literal['user', 'provider']

class UserBase(BaseModel):
    email: EmailStr
    name: Optional[str] = None
    user_type: UserType = 'user' # Added user_type with default

class UserCreate(UserBase):
    password: str

class UserOut(UserBase):
    id: int
    # Removed wallet_address

    class Config:
        orm_mode = True # Keep orm_mode for database model mapping

# Removed WalletUpdate and WalletResponse schemas

class Token(BaseModel):
    access_token: str
    token_type: str

class CommandRequest(BaseModel):
    method: str
    url: str
    data: Optional[Any] = None

class CommandResponse(BaseModel):
    command_id: str
    result: Any

class ErrorResponse(BaseModel):
    command_id: Optional[str] = None
    error: str

class UserDashboard(BaseModel): # Changed inheritance from UserBase as it doesn't need user_type here potentially
    email: EmailStr
    name: Optional[str] = None
    profile_picture: Optional[str] = None
    dllm_tokens: int
    referral_link: Optional[str] = None
    # Removed wallet_address

class PublicStats(BaseModel):
    active_nodes: int
    dllm_price: Dict[str, float]
    btc_price: Dict[str, float]
    twitter_link: str
    discord_link: str
    online_discord_users: int
    twitter_followers: int

class LeaderboardUser(BaseModel):
    username: str
    profile_picture: Optional[str] = None
    score: int
    # Removed wallet_address

class LeaderboardAgent(BaseModel):
    agent_name: str
    agent_link: str
    score: int

class ChatMessage(BaseModel):
    role: str
    content: str

class ChatCompletionRequest(BaseModel):
    model: str
    messages: List[ChatMessage]
    stream: bool = False
    max_tokens: Optional[int] = None
    temperature: Optional[float] = None
    top_p: Optional[float] = None
    frequency_penalty: Optional[float] = None
    presence_penalty: Optional[float] = None

class ChatCompletionResponse(BaseModel):
    id: str
    object: str = "chat.completion"
    created: int
    model: str
    choices: List[Dict[str, Any]]
    usage: Dict[str, int]

class PointsRequest(BaseModel):
    points: int

# New/Modified Schemas for API endpoints

class DeviceRegistrationRequest(BaseModel): # Added this schema definition if it wasn't explicit
    device_id: str

class ModelPullRequest(BaseModel):
    model: str
    name: Optional[str] = None

class ModelListResponse(BaseModel): # Schema for /v1/models and /v1/models/status
    data: List[Dict[str, Any]] = []
    provider_id: Optional[int] = None # Indicate which provider responded (optional)