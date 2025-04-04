# database.py
from sqlalchemy import create_engine
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker
import redis
from dotenv import load_dotenv
import os

# Load environment variables
load_dotenv()

# Neon PostgreSQL connection string
DATABASE_URL = os.getenv("DATABASE_URL", "postgresql://dllm_owner:npg_S7ZoNmnID5aq@ep-muddy-band-a8yv7ycm-pooler.eastus2.azure.neon.tech/dllm?sslmode=require")

# Create PostgreSQL engine
engine = create_engine(DATABASE_URL)

# Session factory
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

# Base for models
Base = declarative_base()

# Redis setup
redis_client = redis.Redis(host='localhost', port=6379, db=0, decode_responses=True)