# create_db.py
from database import Base, engine

# Create all tables
Base.metadata.create_all(bind=engine)
print("Database tables created successfully.")