from sqlalchemy import Column, Integer, String, DateTime, Enum as SQLAlchemyEnum
from datetime import datetime
from database import Base
import enum

# Define UserType enum if you want strict type checking at the DB level (optional but good practice)
# class UserType(enum.Enum):
#     user = "user"
#     provider = "provider"

class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    email = Column(String, unique=True, index=True, nullable=False)
    name = Column(String, nullable=True)
    hashed_password = Column(String, nullable=False)
    profile_picture = Column(String, nullable=True)
    dllm_tokens = Column(Integer, default=0)
    referral_link = Column(String, nullable=True)
    # user_type = Column(SQLAlchemyEnum(UserType), default=UserType.user, nullable=False, index=True) # Enum version
    user_type = Column(String, default='user', nullable=False, index=True) # String version (simpler if enum not strictly needed)
    # Removed wallet_address column

class Device(Base):
    __tablename__ = "devices"
    device_id = Column(String, primary_key=True, index=True)
    registered_date = Column(DateTime, default=datetime.utcnow)