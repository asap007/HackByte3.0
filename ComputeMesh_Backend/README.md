# FastAPI Command Dispatcher System

## Overview
This project implements a real-time command dispatching system using FastAPI, WebSockets, and SQLAlchemy. It allows authenticated users to connect via WebSocket and receive/respond to commands in real-time.

## Features
- 🔐 User authentication with JWT tokens
- 🔌 WebSocket-based real-time communication
- 📡 Command dispatching system
- 🚀 Asynchronous command handling
- 📝 SQLite database integration (configurable for production databases)
- 🔄 CORS support for cross-origin requests

## Technical Architecture

### Core Components

1. **Main Application** (`main.py`)
   - FastAPI application setup
   - API endpoints for registration, authentication, and command dispatching
   - WebSocket endpoint handling

2. **Authentication** (`auth.py`)
   - JWT-based authentication system
   - Password hashing using bcrypt
   - Token generation and validation

3. **Command Dispatcher** (`command_dispatcher.py`)
   - WebSocket connection management
   - Asynchronous command dispatching
   - Response handling with futures

4. **Database** (`database.py`, `models.py`)
   - SQLAlchemy ORM integration
   - User model definition
   - Database session management

## API Endpoints

### Authentication
- `POST /register` - Register new user
- `POST /token` - Login and receive JWT token

### WebSocket
- `WS /ws` - WebSocket connection endpoint (requires authentication token)

### Commands
- `POST /send-command/{user_id}` - Send command to specific user
- `POST /broadcast-command` - Broadcast command to all connected users

## Setup and Installation

1. Clone the repository
2. Install dependencies:
```bash
pip install fastapi uvicorn sqlalchemy passlib python-jose pydantic
```

3. Run the application:
```bash
uvicorn main:app --reload --host 0.0.0.0
```

## Development Configuration
The project includes VS Code launch configuration for debugging:

```1:22:.vscode/launch.json
{
    // Use IntelliSense to learn about possible attributes.
    // Hover to view descriptions of existing attributes.
    // For more information, visit: https://go.microsoft.com/fwlink/?linkid=830387
    "version": "0.2.0",
    "configurations": [
        
        {
            "name": "Python Debugger: FastAPI",
            "type": "debugpy",
            "request": "launch",
            "module": "uvicorn",
            "args": [
                "main:app",
                "--reload",
                "--host",
                "0.0.0.0"
            ],
            "jinja": true
        }
    ]
}
```


## Security Considerations

⚠️ **Important Notes for Production:**

1. Replace the hardcoded SECRET_KEY in `auth.py`:

```11:11:auth.py
SECRET_KEY = "a_very_secret_key"
```


2. Configure proper CORS settings in `main.py`:

```21:35:main.py
# CORS configuration
origins = [
    "http://localhost",
    "http://localhost:3000",
    "file://*",
    "*",  # For development only. Restrict in production.
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Allow all origins during development
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
```


3. Replace SQLite with a production-grade database in `database.py`:

```6:6:database.py
SQLALCHEMY_DATABASE_URL = "sqlite:///./test.db"  # For simplicity, using SQLite. Replace with PostgreSQL/MySQL in production.
```


## WebSocket Communication Protocol

Commands are sent in JSON format:
```json
{
    "command_id": "uuid",
    "method": "GET|POST|PUT|DELETE",
    "url": "command/endpoint",
    "data": {}
}
```

Responses should follow:
```json
{
    "command_id": "uuid",
    "result": "response_data"
}
```

## Error Handling
- Comprehensive error handling for WebSocket connections
- Command timeout handling (30-second default)
- Connection management with automatic cleanup
- Duplicate connection handling