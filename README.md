
# ComputeMesh

A decentralized GPU compute network powered by university students, delivering affordable, sustainable AI for researchers on the Aptos blockchain.

## 🚀 Overview

ComputeMesh addresses the soaring cost and environmental impact of AI computing. We harness idle student GPUs into a decentralized network, cutting prices by 65% and carbon emissions by 80% compared to AWS. Running on Aptos, it's secure, fast, and empowers students and researchers.

## ✨ Key Features

-   **Decentralized**: Powered by student GPUs, not centralized servers
-   **Affordable**: $0.07/query vs. AWS's $0.20—save $650 on a $1,000 LLM training
-   **Convenient**: Providers install the desktop app to join; users get a ChatGPT-like UI
-   **Greener**: Reduces carbon by 80% (~0.1 kg CO2/kWh vs. 0.5 kg)—5 kg saved/query
-   **Secure**: Aptos's Move encryption and 160,000 tx/sec ensure safe data and payments
-   **Model Freedom**: Pick any Hugging Face model (e.g., BERT, LLaMA)

## 🏗️ Project Structure

-   **`computemesh-client`**: Desktop app for GPU providers (Electron-based)
-   **`computemesh-frontend`**: Web UI for users (React + Vite)
-   **`computemesh-backend`**: Python-based backend with Aptos integration

## 🛠️ Tech Stack

### Client (Desktop App)

-   **Electron**: v25.3.1
-   **Dependencies**:  `electron-store`,  `electron-updater`,  `ws`  (WebSocket)
-   **Build**:  `electron-builder`  (Windows NSIS)

### Frontend (Web UI)

-   **React**: v19.0.0 with Vite v6.2.0
-   **UI**: TailwindCSS v4.0.17, Lucide-React
-   **Routing**:  `react-router-dom`  v7.4.1

### Backend (Server)

-   **Python**: v3.10+
-   **Aptos Blockchain**: Secure transactions via Move
-   **Dependencies**:  `requests`,  `websocket-client`, Aptos SDK

## 📋 Installation

### Prerequisites

-   Node.js (v18+) for client/frontend
-   Python (v3.10+) for backend
-   Git
-   Aptos CLI (for blockchain setup)
-   Windows (for client build)

### Steps

1.  **Clone the Repo**:

```bash
git clone <repository-url>
cd ComputeMesh

```

Send command to Terminal

2.  **Install Client (Provider App)**:

```bash
cd computemesh-client
npm install

```

Send command to Terminal

3.  **Install Frontend (User UI)**:

```bash
cd ../computemesh-frontend
npm install

```

Send command to Terminal

4.  **Install Backend**:

```bash
cd ../computemesh-backend
pip install -r requirements.txt

```

Send command to Terminal

5.  **Run Development Mode**:
    
    -   Client:  `cd computemesh-client && npm run dev:electron`
    -   Frontend:  `cd computemesh-frontend && npm run dev`  (runs on  `http://localhost:4000`)
    -   Backend:  `cd computemesh-backend && python main.py`
6.  **Build Client for Production**:
    

```bash
cd computemesh-client
npm run dist

```

Send command to Terminal

-   Output:  `dist/ComputeMesh-Setup-0.0.1.exe`

## 🎮 Usage

### For Providers (Students)

1.  Install the  `computemesh-client`  desktop app
2.  Launch it—your GPU is automatically declared an available node
3.  Earn $0.05/query in crypto via Aptos wallet (e.g., Petra)

### For Users (Researchers)

1.  Visit the web UI (`computemesh-frontend`)
2.  Type a query, pick a Hugging Face model, and compute for $0.07/query

## 🧠 Challenges Overcome

-   **Node Matching**: Tuned GPU speed scoring for fair task distribution
-   **Aptos Transactions**: Batched payments in Python to cut lag
-   **Wallet Connection**: Fixed Petra disconnects with retries in backend
-   **WebSocket Drops**: Added timeouts in Python WebSocket code for dorm Wi-Fi
-   **Path Errors**: Shortened Windows paths for  `cargo build -p aptos`

## 📊 Impact

-   **Economic**: 65% cost reduction for AI researchers
-   **Environmental**: 80% carbon footprint reduction
-   **Educational**: Students gain blockchain and AI experience while earning
-   **Research**: Democratizes access to AI compute for underfunded institutions

## 🔮 Future Work

- Scale from 10K to 1M providers, starting with students like Facebook.  
- Partner with ASUS/NVIDIA for pre-installed apps.  
- Train custom, eco-friendly AI models.
## Why ComputeMesh?

- **Pricing**: 65% cheaper than AWS ($350 vs. $1,000 for LLM training).  
- **Sustainability**: 80% less carbon—5 kg CO2 saved/query.  
- **Impact**: Empowers students with income and researchers with affordable AI.




_Built with ❤️ for HackByte3.0_