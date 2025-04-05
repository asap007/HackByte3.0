from pydantic import BaseModel
from typing import List, Optional, Dict, Any
import re

class UserBase(BaseModel):
    email: str
    name: Optional[str] = None
    wallet_address: Optional[str] = None

class UserCreate(UserBase):
    password: str

class UserOut(UserBase):
    id: int

    class Config:
        orm_mode = True

class WalletUpdate(BaseModel):
    wallet_address: str

    @classmethod
    def validate_wallet_address(cls, v):
        if not re.match(r'^0x[0-9a-fA-F]{64}$', v):
            raise ValueError('Invalid Aptos address format')
        return v

    class Config:
        json_schema_extra = {
            "example": {
                "wallet_address": "0x03f93542dd877b075a37d629c7c021f33b572e8d336e73511ad481c9b0560698"
            }
        }

class WalletResponse(BaseModel):
    message: str
    wallet_address: Optional[str] = None

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

class UserDashboard(UserBase):
    profile_picture: Optional[str] = None
    dllm_tokens: int
    referral_link: Optional[str] = None

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
    wallet_address: Optional[str] = None  # Added for leaderboard

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