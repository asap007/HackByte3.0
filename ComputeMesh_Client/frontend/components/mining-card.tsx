import React, { useState, useEffect, useRef } from 'react';
import { Info, Wifi, WifiOff } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';

// --- Constants ---
// Cortex Client Configuration
const CORTEX_PORT = 39281;
const CORTEX_BASE_URL = `http://127.0.0.1:${CORTEX_PORT}`;
const ENGINE_NAME = 'llama-cpp';
const API_TIMEOUT_MS = 30000;
const MODEL_START_TIMEOUT_MS = 120000;

// Backend Server Configuration
const BACKEND_BASE_URL = 'http://127.0.0.1:8000'; // Use localhost backend

// WebSocket Configuration
const WS_RECONNECT_DELAY = 3000; // Initial reconnect delay
const WS_MAX_RECONNECT_ATTEMPTS = 5;

// Mining Logic Configuration (Based on original code)
const MINING_CYCLE_DURATION_SECONDS = 60; // Duration of one earning cycle
const POINTS_PER_CYCLE = 10; // Points earned and saved per cycle
const PENDING_INCREMENT_PER_SECOND = 0.1; // How much pending score increases each second

export function MiningCard() {
  // --- State ---
  const [time, setTime] = useState(() => parseFloat(sessionStorage.getItem('miningTime') || MINING_CYCLE_DURATION_SECONDS.toString()));
  const [pending, setPending] = useState(() => parseFloat(sessionStorage.getItem('miningPending') || '0'));
  const [saved, setSaved] = useState(() => parseFloat(localStorage.getItem('savedScore') || '40')); // Keep original default saved score
  const [isRunning, setIsRunning] = useState(false); // Timer/Mining active state
  const [wsStatus, setWsStatus] = useState('disconnected'); // WebSocket connection status
  // State for Cortex management
  const [isEngineLoaded, setIsEngineLoaded] = useState(false);
  const [currentLoadedModel, setCurrentLoadedModel] = useState(null);
  const [isManagingModelState, setIsManagingModelState] = useState(false);

  // --- Refs ---
  const wsRef = useRef(null);
  const reconnectTimeoutRef = useRef(null);
  const timerRef = useRef(null); // Ref for the mining timer interval
  const reconnectAttempts = useRef(0);

  // --- Internal Logging (Console Only) ---
  const log = (message, level = 'info') => {
    console.log(`[${new Date().toLocaleTimeString()}] [MiningCard-${level.toUpperCase()}] ${message}`);
  };

  // --- Browser Opener ---
  const openInBrowser = (url) => {
    if (window.electron?.shell?.openExternal) {
      window.electron.shell.openExternal(url);
    } else {
      window.open(url, '_blank', 'noopener,noreferrer');
    }
  };

  // --- Score Update & Timer Reset (Original Logic Adapted) ---
  const resetTimer = () => {
    log('Resetting mining timer and pending points.');
    setTime(MINING_CYCLE_DURATION_SECONDS);
    setPending(0);
    setIsRunning(true); // Assuming reset implies we want to run again
    sessionStorage.setItem('miningTime', MINING_CYCLE_DURATION_SECONDS.toString());
    sessionStorage.setItem('miningPending', '0');
    // Restart the timer interval explicitly if connection is active
    if (wsStatus === 'connected') {
       startMiningProgress();
    }
  };

  const updateScoreViaAPI = async () => {
    log(`Attempting to save ${POINTS_PER_CYCLE} points via API.`);
    try {
      const token = localStorage.getItem('authToken');
      if (!token) {
        log('No auth token found for score update', 'warn');
        return; // Don't proceed without token
      }

      const response = await fetch(`${BACKEND_BASE_URL}/user/points`, { // Use constant
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ points: POINTS_PER_CYCLE }) // Use constant
      });

      if (!response.ok) {
          const errorData = await response.json().catch(() => ({ detail: `HTTP error! status: ${response.status}` }));
          throw new Error(errorData.detail || `HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      setSaved(prevSaved => {
        // Prefer total_points from response, fallback to local calculation
        const newSaved = data.total_points ?? (prevSaved + POINTS_PER_CYCLE);
        localStorage.setItem('savedScore', newSaved.toString());
        log(`Successfully updated points via API. New saved total: ${newSaved.toFixed(2)}`);
        return newSaved;
      });
      resetTimer(); // Reset timer cycle AFTER successful save

    } catch (error) {
      console.error('Error updating points:', error);
      log(`Failed to update points: ${error.message}`, 'error');
      // Decide: Stop timer on failure? Or let it potentially try again?
      // Let's stop it to prevent loops on persistent API errors.
      stopMiningProgress();
    }
  };

  // --- Mining Progress Timer (Original Logic) ---
  const stopMiningProgress = () => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
      setIsRunning(false); // Set running state to false
      log('Mining progress timer stopped.');
    }
  };

  const startMiningProgress = () => {
    if (timerRef.current) {
      // log('Mining progress timer already running.', 'debug');
      return; // Prevent multiple intervals
    }
    if (wsStatus !== 'connected') {
        log('Cannot start mining progress: WebSocket not connected.', 'warn');
        return;
    }

    setIsRunning(true); // Set running state to true
    log('Starting mining progress timer.');

    timerRef.current = setInterval(() => {
      let cycleEnded = false;
      setTime(prevTime => {
        // Calculate decrement based on the interval (1s in this case)
        const timeDecrement = 1; // Since interval is 1000ms
        const newTime = Math.max(0, prevTime - timeDecrement);
        sessionStorage.setItem('miningTime', newTime.toString());

        if (newTime <= 0) {
           cycleEnded = true; // Mark cycle end
        }
        return newTime;
      });

      setPending(prevPending => {
        // Use the defined increment rate
        const newPending = prevPending + PENDING_INCREMENT_PER_SECOND;
        sessionStorage.setItem('miningPending', newPending.toString());
        return parseFloat(newPending.toFixed(1)); // Use original precision
      });

       // Handle cycle end after state updates
       if (cycleEnded) {
            log('Mining cycle complete.');
            stopMiningProgress(); // Stop interval first
            updateScoreViaAPI(); // Attempt to save points
            // updateScoreViaAPI calls resetTimer on success, which restarts the process
       }

    }, 1000); // Run every second like original
  };

  // --- WebSocket Communication ---
  const sendWsMessage = (payload) => {
     if (wsRef.current?.readyState === WebSocket.OPEN) {
        try {
            wsRef.current.send(JSON.stringify(payload));
        } catch (error) {
            log(`Failed to send WebSocket message: ${error.message}`, 'error');
        }
     } else {
        log('Cannot send WebSocket message: connection not open', 'warn');
     }
  };

  const sendSuccessResponse = (command_id, result) => {
    sendWsMessage({ command_id, result });
  };

  const sendErrorResponse = (command_id, errorMessage) => {
    log(`Sending error response for ${command_id}: ${errorMessage}`, 'error');
    sendWsMessage({
      command_id,
      result: { error: errorMessage } // Ensure consistent error structure
    });
  };

   // --- Local Cortex API Interaction (Keep New Logic) ---
  const callCortexAPI = async (endpoint, method = 'GET', body = null, timeout = API_TIMEOUT_MS) => {
    const url = `${CORTEX_BASE_URL}${endpoint}`;
    log(`Calling Cortex API: ${method} ${url}`, 'debug');
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    try {
      const options = {
        method,
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        signal: controller.signal,
      };
      if (body && method !== 'GET') {
        options.body = JSON.stringify(body);
      }

      const response = await fetch(url, options);
      clearTimeout(timeoutId);

      if (!response.ok) {
        let errorData;
        try { errorData = await response.json(); } catch (parseError) { errorData = { detail: response.statusText }; }
        const errorMessage = errorData?.error?.message || errorData?.detail || `HTTP error ${response.status}`;
        log(`Cortex API Error (${method} ${url}): ${errorMessage}`, 'error');
        throw new Error(errorMessage);
      }

       const contentType = response.headers.get("content-type");
       if (contentType && contentType.indexOf("application/json") !== -1) {
            const data = await response.json();
            log(`Cortex API Success (${method} ${url}): Received JSON response`, 'debug');
            return data;
       } else if (response.status === 204 || response.headers.get('content-length') === '0') {
            log(`Cortex API Success (${method} ${url}): Received empty response`, 'debug');
            return null;
       } else {
            const textData = await response.text();
            log(`Cortex API Success (${method} ${url}): Received non-JSON response`, 'warn');
            return { raw_response: textData };
       }

    } catch (error) {
      clearTimeout(timeoutId);
      if (error.name === 'AbortError') {
          log(`Cortex API Timeout: ${method} ${url}`, 'error');
          throw new Error(`Request timed out after ${timeout / 1000}s`);
      }
      log(`Cortex API Fetch Error (${method} ${url}): ${error.message}`, 'error');
      throw error;
    }
  };

   // --- Cortex State Management Functions (Keep New Logic) ---
   const getCurrentCortexStatus = async () => {
     log('Querying current Cortex status (/v1/models)...', 'debug');
     try {
       const response = await callCortexAPI('/v1/models', 'GET');
       const models = response?.data || [];
       let foundLoadedModel = null;
       models.forEach(model => {
           if (model.status === 'LOADED' || model.state === 'loaded') { // Adjust conditions based on Cortex API
               foundLoadedModel = model.id;
           }
       });
       log(`Cortex status updated. Loaded model: ${foundLoadedModel || 'None'}`, 'debug');
       setCurrentLoadedModel(foundLoadedModel);
       return { loadedModel: foundLoadedModel, enginePotentiallyRunning: true };
     } catch (error) {
       log(`Failed to get Cortex status: ${error.message}. Assuming engine/model not loaded.`, 'error');
       setIsEngineLoaded(false);
       setCurrentLoadedModel(null);
       return { loadedModel: null, enginePotentiallyRunning: false };
     }
   };

  const ensureEngineLoaded = async () => {
    log(`Ensuring engine '${ENGINE_NAME}' is loaded. Currently: ${isEngineLoaded}`, 'debug');
    if (isEngineLoaded) return true;
    log(`Attempting to load engine '${ENGINE_NAME}'...`);
    try {
        await callCortexAPI(`/v1/engines/${ENGINE_NAME}/load`, 'POST', null, API_TIMEOUT_MS);
        log(`Engine '${ENGINE_NAME}' loaded successfully.`);
        setIsEngineLoaded(true);
        return true;
    } catch (error) {
        log(`Failed to load engine '${ENGINE_NAME}': ${error.message}`, 'error');
        setIsEngineLoaded(false);
        return false;
    }
  };

  const ensureModelLoaded = async (targetModelId) => {
     if (!targetModelId) {
       log('Target model ID missing', 'error');
       return false;
     }
     if (isManagingModelState) {
         log('Model state management already in progress, skipping.', 'warn');
         return false;
     }
     setIsManagingModelState(true);
     log(`Ensuring model '${targetModelId}' is loaded. Current: ${currentLoadedModel || 'None'}.`, 'debug');

    try {
        const engineReady = await ensureEngineLoaded();
        if (!engineReady) throw new Error(`Engine '${ENGINE_NAME}' could not be loaded.`);

        const status = await getCurrentCortexStatus(); // Check real status
        const actualLoadedModel = status.loadedModel;

        if (actualLoadedModel === targetModelId) {
           log(`Model '${targetModelId}' is already loaded.`);
           setCurrentLoadedModel(targetModelId); // Sync state
           return true;
        }

        // Stop different loaded model
        if (actualLoadedModel && actualLoadedModel !== targetModelId) {
          log(`Stopping current model '${actualLoadedModel}'...`);
          try {
            await callCortexAPI('/v1/models/stop', 'POST', { model: actualLoadedModel }, API_TIMEOUT_MS);
            log(`Model '${actualLoadedModel}' stopped.`);
            setCurrentLoadedModel(null);
          } catch (stopError) {
            log(`Failed to stop model '${actualLoadedModel}': ${stopError.message}. Proceeding cautiously.`, 'warn');
             setCurrentLoadedModel(null); // Assume stopped or bad state
          }
        }

        // Start target model
        log(`Starting target model '${targetModelId}'...`);
        await callCortexAPI('/v1/models/start', 'POST', { model: targetModelId }, MODEL_START_TIMEOUT_MS);
        log(`Model '${targetModelId}' started successfully.`);
        setCurrentLoadedModel(targetModelId);
        return true;

    } catch (error) {
        log(`Failed to ensure model '${targetModelId}' loaded: ${error.message}`, 'error');
        setCurrentLoadedModel(null); // Reset state on error
        return false;
    } finally {
        setIsManagingModelState(false); // Release lock
    }
  };

  // --- Command Handling Logic (Keep New Logic) ---
  const handleServerCommand = async (reqObj) => {
    const { method, url, data, command_id } = reqObj;
    log(`Received command ${command_id}: ${method} ${url}`, 'info');

    if (!method || !url || !command_id) {
      log(`Invalid command received: Missing method, url, or command_id`, 'error');
      return;
    }

    try {
      let resultData;
      let modelToEnsure = null;

      // Check if specific state is required
      if (url === '/v1/chat/completions') {
        modelToEnsure = data?.model;
        if (!modelToEnsure) throw new Error("Chat request missing 'model' identifier.");
         log(`Chat command requires model: ${modelToEnsure}`, 'debug');
      } else if (url === '/v1/models/pull' || (url === '/v1/models' && method === 'GET')) {
          const engineReady = await ensureEngineLoaded();
           if (!engineReady) throw new Error(`Engine '${ENGINE_NAME}' not loaded for ${url}.`);
      }

      // Ensure model is loaded if required
      if (modelToEnsure) {
        const modelReady = await ensureModelLoaded(modelToEnsure);
        if (!modelReady) throw new Error(`Failed to load required model '${modelToEnsure}'.`);
      }

      // Execute command
      log(`Executing final command ${command_id}: ${method} ${url} on Cortex...`, 'debug');
      resultData = await callCortexAPI(url, method, data);

      // Send success
      log(`Command ${command_id} executed successfully.`, 'info');
      sendSuccessResponse(command_id, resultData);

    } catch (error) {
      log(`Command ${command_id} failed: ${error.message}`, 'error');
      sendErrorResponse(command_id, error.message || 'Unknown error occurred');
    }
  };

  // --- WebSocket Initialization and Event Handlers ---
  const initializeWebSocket = () => {
    // Clear existing connections/timers
    if (wsRef.current) {
      wsRef.current.onclose = null;
      wsRef.current.close();
      wsRef.current = null;
    }
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }

    const token = localStorage.getItem('authToken');
    if (!token) {
      setWsStatus('disconnected');
      stopMiningProgress(); // Ensure timer is stopped
      log('Auth token missing, WebSocket connection cancelled.', 'warn');
      return;
    }

    const wsUrl = `ws://127.0.0.1:8000/ws?token=${encodeURIComponent(token)}`; // Use localhost
    log(`Attempting WebSocket connection to: ${wsUrl}`);
    setWsStatus('connecting');

    try {
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        setWsStatus('connected');
        reconnectAttempts.current = 0;
        log('WebSocket connection established.');
        startMiningProgress(); // Start timer now that we are connected
      };

      ws.onmessage = async (event) => {
        // Same message handling logic
        log(`WebSocket message received: ${event.data.substring(0, 100)}...`, 'debug');
        try {
          const messageData = JSON.parse(event.data);
          if (messageData.type === 'ping') {
               log('Received ping, sending pong.', 'debug');
               sendWsMessage({ type: 'pong' });
               return;
           }
          if (messageData.command_id) {
            await handleServerCommand(messageData);
          } else {
            log(`Received message without command_id`, 'warn');
          }
        } catch (err) {
          log(`Error processing WebSocket message: ${err.message}`, 'error');
        }
      };

      ws.onclose = (event) => {
        const wasConnected = wsStatus === 'connected';
        setWsStatus('disconnected');
        stopMiningProgress(); // Stop timer on disconnect
        wsRef.current = null;
        log(`WebSocket connection closed. Code: ${event.code}, Reason: ${event.reason || 'None'}, Clean: ${event.wasClean}`);

        // Reconnect logic (same as before)
        if (event.code !== 1000 && localStorage.getItem('authToken')) {
          reconnectAttempts.current++;
          if (reconnectAttempts.current <= WS_MAX_RECONNECT_ATTEMPTS) {
            const delay = WS_RECONNECT_DELAY * Math.pow(2, reconnectAttempts.current - 1);
            log(`Attempting reconnect ${reconnectAttempts.current}/${WS_MAX_RECONNECT_ATTEMPTS} in ${delay / 1000}s...`, 'warn');
            reconnectTimeoutRef.current = setTimeout(initializeWebSocket, delay);
          } else {
            log('Max WebSocket reconnection attempts reached.', 'error');
          }
        } else {
             log('WebSocket closed. No automatic reconnect planned.');
             reconnectAttempts.current = 0;
        }
      };

      ws.onerror = (error) => {
        setWsStatus('error');
        // Don't stop timer here, wait for onclose
        log(`WebSocket error: ${error.message || 'Unknown error'}`, 'error');
      };

    } catch (error) {
      console.error('WebSocket initialization failed:', error);
      setWsStatus('error');
      stopMiningProgress(); // Stop timer if init fails
      log(`Failed to initialize WebSocket: ${error.message}`, 'error');
      // Reconnect logic (same as before)
      if (localStorage.getItem('authToken')) {
         reconnectAttempts.current++;
          if (reconnectAttempts.current <= WS_MAX_RECONNECT_ATTEMPTS) {
             const delay = WS_RECONNECT_DELAY * Math.pow(2, reconnectAttempts.current - 1);
              log(`Retrying connect ${reconnectAttempts.current}/${WS_MAX_RECONNECT_ATTEMPTS} in ${delay / 1000}s...`, 'warn');
             reconnectTimeoutRef.current = setTimeout(initializeWebSocket, delay);
          } else {
              log('Max reconnection attempts reached after init failure.', 'error');
          }
      }
    }
  };

  // --- Effects ---
  useEffect(() => {
    // Restore state from storage on initial mount
    const initialTime = parseFloat(sessionStorage.getItem('miningTime') || MINING_CYCLE_DURATION_SECONDS.toString());
    setTime(initialTime);
    const initialPending = parseFloat(sessionStorage.getItem('miningPending') || '0');
    setPending(initialPending);
    const initialSaved = parseFloat(localStorage.getItem('savedScore') || '40'); // Use original default
    setSaved(initialSaved);

    // Start WebSocket connection attempt
    initializeWebSocket();

    // Network status listeners
    const handleOnline = () => {
        log('Browser detected online status.', 'info');
        if (wsStatus !== 'connected' && !reconnectTimeoutRef.current && reconnectAttempts.current < WS_MAX_RECONNECT_ATTEMPTS) {
             log('Attempting WebSocket reconnect after coming online.');
             initializeWebSocket(); // Will trigger timer start if successful
        }
    };
    const handleOffline = () => {
        log('Browser detected offline status.', 'warn');
        setWsStatus('offline');
        stopMiningProgress(); // Stop timer
        if (wsRef.current) wsRef.current.close(1000, "Browser offline");
        if (reconnectTimeoutRef.current) {
            clearTimeout(reconnectTimeoutRef.current);
            reconnectTimeoutRef.current = null;
             log('Cleared pending WebSocket reconnect attempts.');
        }
         reconnectAttempts.current = 0;
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    // Cleanup on component unmount
    return () => {
      log('MiningCard unmounting. Cleaning up...');
      stopMiningProgress(); // Stop timer
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);
      if (wsRef.current) {
        wsRef.current.onclose = null;
        wsRef.current.close(1000, 'Component unmounting');
        wsRef.current = null;
      }
       log('MiningCard cleanup complete.');
    };
  }, []); // Empty dependency array = run on mount only


  // UI Rendering Calculation (Original Logic)
  const progressPercentage = Math.min(100, ((MINING_CYCLE_DURATION_SECONDS - time) / MINING_CYCLE_DURATION_SECONDS) * 100);
  const wsColor = wsStatus === 'connected' ? 'text-green-500' : (wsStatus === 'connecting' ? 'text-yellow-500' : 'text-orange-500');
  const wsText = wsStatus === 'connected' ? 'Connected' :
                 wsStatus === 'connecting' ? 'Connecting...' :
                 wsStatus === 'offline' ? 'Offline' :
                 wsStatus === 'error' ? 'Error' :
                 reconnectAttempts.current > 0 ? `Reconnecting (${reconnectAttempts.current})` : 'Disconnected';


  return (
    // Use original Card structure but remove log div
    <Card className="bg-[#1a1a2e] border-0 h-full flex flex-col">
      <CardContent className="p-6 flex flex-col flex-grow">
        {/* Connection Status */}
        <div className="flex justify-end mb-2">
          <div className={`flex items-center ${wsColor}`}>
            {wsStatus === 'connected' ? <Wifi className="w-4 h-4 mr-1" /> : <WifiOff className="w-4 h-4 mr-1" />}
            <span className="text-xs">{wsText}</span>
          </div>
        </div>

        {/* Survey Button */}
        <button
          className="w-full bg-[#12121f] text-emerald-400 p-3 rounded-lg mb-6
                     transition-all duration-200 ease-in-out shrink-0
                     hover:bg-emerald-400 hover:text-[#12121f]
                     active:transform active:scale-95
                     focus:outline-none focus:ring-2 focus:ring-emerald-400 focus:ring-opacity-50"
          onClick={(e) => {
            e.preventDefault();
            openInBrowser(`${BACKEND_BASE_URL}/survey`); // Use constant
          }}
        >
          Complete the Survey (+1200 Tokens)
        </button>

        {/* Pending Score */}
        <div className="text-center mb-6 shrink-0">
          <div className="text-gray-400 mb-2 uppercase text-sm">Pending</div>
          <div className="text-4xl text-white mb-4">{pending.toFixed(1)}</div> {/* Original precision */}
          <div className="flex justify-center items-center gap-2 text-sm">
            {/* Keep original Level/Boost if needed */}
            {/* <span className="text-gray-400">LVL 0</span>
            <button className="text-gray-400 flex items-center gap-1"> BOOST <Info className="w-4 h-4" /> </button> */}
          </div>
        </div>

        {/* Saved Score & Progress Bar (Original Logic) */}
        <div className="mb-6 shrink-0">
          <div className="flex flex-col items-center mb-2">
            <span className="text-gray-400 text-sm">Saved</span>
            <div className="flex items-center gap-1">
              {/* Use original display */}
              <span className="text-2xl text-white">{saved.toFixed(2)}</span>
              <span className="text-gray-400">ComputeMesh</span>
              <Info className="w-4 h-4 text-gray-400" />
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex-1 h-2 bg-[#12121f] rounded-full overflow-hidden">
              <div
                className="h-full bg-green-500 rounded-full transition-width duration-1000 ease-linear" // Keep transition
                style={{ width: `${progressPercentage}%` }}
              />
            </div>
            <span className="text-gray-400 text-sm whitespace-nowrap">
              {/* Original time display logic */}
              {time <= 0 ? 'Saving...' : `${time.toFixed(0)} mins left`}
            </span>
          </div>
        </div>

        {/* Status Text */}
        <div className="text-gray-400 text-sm mt-auto shrink-0 text-center">
           {/* Use original text logic */}
          Don't turn off your PC to retain your Aptos
        </div>

        {/* Log window is intentionally removed */}

      </CardContent>
    </Card>
  );
}

export default MiningCard;