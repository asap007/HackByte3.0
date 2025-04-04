// // HTML elements
// const loginSection = document.getElementById('login-section');
// const commandSection = document.getElementById('command-section');
// const loginBtn = document.getElementById('login-btn');
// const logoutBtn = document.getElementById('logout-btn');

// const usernameInput = document.getElementById('username');
// const passwordInput = document.getElementById('password');
// const loginStatus = document.getElementById('login-status');

// const portDisplay = document.getElementById('port-display');
// const wsStatus = document.getElementById('ws-status');
// const logArea = document.getElementById('log-area');

// let selectedPort = 39281;
// let token = '';
// let ws = null;

// // Initialize when DOM is loaded
// window.addEventListener('DOMContentLoaded', () => {
//   // Request the server port from main process
//   window.electronAPI.requestServerPort();
  
//   // Scroll log area to bottom whenever new content is added
//   logArea.value = 'Application started...';
// });

// // Listen for server port
// window.electronAPI.onServerPort(({ port }) => {
//   selectedPort = port;
//   portDisplay.textContent = `Server running on port: ${port}`;
//   logArea.value += `\nServer port received: ${port}`;
// });

// // Listen for server started event
// window.electronAPI.onServerStarted(({ port }) => {
//   selectedPort = port;
//   logArea.value += `\nServer started on port ${port}`;
//   portDisplay.textContent = `Server running on port: ${port}`;
// });

// // Listen for server exited event
// window.electronAPI.onServerExited(({ code, signal }) => {
//   logArea.value += `\nServer exited with code ${code}, signal ${signal}`;
//   portDisplay.textContent = 'Server has stopped';
// });

// // Listen for server health updates
// window.electronAPI.onServerHealth((status) => {
//   if (status.status === 'healthy') {
//     portDisplay.style.color = 'green';
//   } else {
//     portDisplay.style.color = 'red';
//     logArea.value += `\nServer health check failed: ${status.error || 'Unknown error'}`;
//   }
// });

// // Server status updates
// window.electronAPI.onServerStatus((status) => {
//   switch(status.status) {
//     case 'starting':
//       portDisplay.textContent = `Server starting on port: ${status.port}...`;
//       portDisplay.style.color = 'orange';
//       break;
//     case 'running':
//       portDisplay.textContent = `Server running on port: ${status.port}`;
//       portDisplay.style.color = 'green';
//       break;
//     case 'stopped':
//       portDisplay.textContent = 'Server stopped';
//       portDisplay.style.color = 'red';
//       break;
//     case 'restarting':
//       portDisplay.textContent = `Server restarting (Attempt ${status.attempt}/${status.maxAttempts})...`;
//       portDisplay.style.color = 'orange';
//       break;
//   }
//   logArea.value += `\nServer ${status.status}`;
// });

// // Listen for log messages
// window.electronAPI.onLogMessage((message) => {
//   logArea.value += `\n${message}`;
//   logArea.scrollTop = logArea.scrollHeight;
// });

// // Login button handler
// loginBtn.addEventListener('click', async () => {
//   const username = usernameInput.value.trim();
//   const password = passwordInput.value.trim();

//   if (!username || !password) {
//     loginStatus.innerText = 'Please enter both username and password.';
//     return;
//   }

//   try {
//     const response = await fetch('http://server.dllm.chat:8000/token', {
//       method: 'POST',
//       headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
//       body: new URLSearchParams({ username, password })
//     });

//     if (!response.ok) {
//       const errorData = await response.json();
//       throw new Error(errorData.detail || 'Login failed');
//     }

//     const data = await response.json();
//     token = data.access_token;
//     loginStatus.innerText = 'Login successful!';
//     loginSection.style.display = 'none';
//     commandSection.style.display = 'block';

//     // Initialize WebSocket after successful login
//     initializeWebSocket();
//   } catch (error) {
//     loginStatus.innerText = `Login failed: ${error.message}`;
//     console.error('Login error:', error);
//   }
// });

// // WebSocket initialization
// function initializeWebSocket() {
//   if (ws) {
//     ws.close();
//     ws = null;
//   }

//   const wsUrl = `ws://server.dllm.chat:8000/ws?token=${token}`;
  
//   const connect = () => {
//     if (!navigator.onLine) {
//       wsStatus.textContent = 'Offline - Waiting for connection...';
//       wsStatus.style.color = 'orange';
//       return;
//     }

//     try {
//       ws = new WebSocket(wsUrl);

//       ws.onopen = () => {
//         wsStatus.textContent = 'Connected';
//         wsStatus.style.color = 'green';
//         logArea.value += '\nWebSocket connected to central server';
//       };

//       ws.onmessage = async (event) => {
//         try {
//           const commandObj = JSON.parse(event.data);
//           await handleServerCommand(commandObj);
//         } catch (err) {
//           logArea.value += `\nError processing server message: ${err.message}`;
//         }
//       };

//       ws.onclose = (event) => {
//         wsStatus.textContent = 'Disconnected';
//         wsStatus.style.color = 'red';
//         logArea.value += '\nWebSocket connection closed';
//         ws = null;

//         if (navigator.onLine && token && !event.wasClean) {
//           setTimeout(connect, 3000);
//         }
//       };

//       ws.onerror = (error) => {
//         logArea.value += '\nWebSocket error occurred';
//         if (ws) ws.close();
//       };
//     } catch (error) {
//       logArea.value += `\nFailed to create WebSocket connection: ${error.message}`;
//       setTimeout(connect, 3000);
//     }
//   };

//   // Set up online/offline handlers
//   window.removeEventListener('online', connect);
//   window.removeEventListener('offline', handleOffline);
  
//   window.addEventListener('online', connect);
//   window.addEventListener('offline', handleOffline);

//   connect();
// }

// function handleOffline() {
//   wsStatus.textContent = 'Offline - Waiting for connection...';
//   wsStatus.style.color = 'orange';
//   if (ws) ws.close();
// }

// // Handle commands from the central server
// async function handleServerCommand(reqObj) {
//   const { method, url, data, command_id } = reqObj;
//   if (!method || !url) {
//     sendErrorResponse(command_id, 'Missing method or url in request');
//     return;
//   }

//   const fullUrl = `http://127.0.0.1:${selectedPort}${url}`;

//   try {
//     const result = await window.electronAPI.forwardRequest({
//       method,
//       url: fullUrl,
//       data
//     });

//     if (result.success) {
//       sendSuccessResponse(command_id, result.data);
//       logArea.value += `\nForwarded ${method.toUpperCase()} ${url} -> success`;
//     } else {
//       if (result.isConnectionRefused) {
//         sendErrorResponse(command_id, `Server API unreachable on port ${selectedPort}`);
//       } else {
//         sendErrorResponse(command_id, result.error);
//       }
//       logArea.value += `\nFailed to forward ${method.toUpperCase()} ${url}: ${result.error}`;
//     }
//   } catch (error) {
//     sendErrorResponse(command_id, error.message);
//     logArea.value += `\nFailed to forward ${method.toUpperCase()} ${url}: ${error.message}`;
//   }
// }

// function sendSuccessResponse(command_id, result) {
//   if (ws?.readyState === WebSocket.OPEN) {
//     ws.send(JSON.stringify({ command_id, result }));
//   }
// }

// function sendErrorResponse(command_id, errorMessage) {
//   if (ws?.readyState === WebSocket.OPEN) {
//     ws.send(JSON.stringify({ command_id, result: { error: errorMessage } }));
//   }
// }

// logoutBtn.addEventListener('click', () => {
//   // Clear WebSocket event listeners
//   window.removeEventListener('online', initializeWebSocket);
//   window.removeEventListener('offline', handleOffline);
  
//   // Close WebSocket connection if it exists
//   if (ws) {
//     ws.close();
//     ws = null;
//   }
  
//   // Reset all states
//   token = '';
//   usernameInput.value = '';  // Clear username
//   passwordInput.value = '';  // Clear password
  
//   // Update UI visibility
//   loginSection.style.display = 'block';
//   commandSection.style.display = 'none';
  
//   // Update status messages
//   loginStatus.innerText = 'Logged out successfully';
//   loginStatus.style.color = 'green';  // Optional: make it green to indicate success
//   wsStatus.textContent = 'Disconnected';
//   wsStatus.style.color = 'red';
  
//   // Add logout message to logs
//   logArea.value += '\nLogged out successfully';
//   logArea.scrollTop = logArea.scrollHeight;  // Auto-scroll to bottom
// });