from pydantic import BaseModel
from typing import List, Optional, Dict, Any

class UserCreate(BaseModel):
    email: str
    password: str
    name: Optional[str] = None

class UserOut(BaseModel):
    id: int
    email: str
    name: Optional[str] = None

    class Config:
        orm_mode = True

class Token(BaseModel):
    access_token: str
    token_type: str

class CommandRequest(BaseModel):
    method: str
    url: str
    data: Optional[Any] = None  # Command-specific data

class CommandResponse(BaseModel):
    command_id: str
    result: Any  # The response from the client

class ErrorResponse(BaseModel):
    command_id: Optional[str] = None
    error: str

class UserDashboard(BaseModel):
    email: str
    name: Optional[str] = None
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

class LeaderboardAgent(BaseModel):
    agent_name: str
    agent_link: str
    score: int

class ChatMessage(BaseModel):
    role: str  # "system", "user", or "assistant"
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