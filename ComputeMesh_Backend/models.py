from sqlalchemy import Column, Integer, String, DateTime
from datetime import datetime
from database import Base

class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    email = Column(String, unique=True, index=True, nullable=False)
    name = Column(String, nullable=True)
    hashed_password = Column(String, nullable=False)
    profile_picture = Column(String, nullable=True)
    dllm_tokens = Column(Integer, default=0)
    referral_link = Column(String, nullable=True)
    wallet_address = Column(String(66), nullable=True, unique=True)  # Added for Aptos wallet support

class Device(Base):
    __tablename__ = "devices"
    device_id = Column(String, primary_key=True, index=True)
    registered_date = Column(DateTime, default=datetime.utcnow)