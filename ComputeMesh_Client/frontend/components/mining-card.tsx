import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Info, Wifi, WifiOff } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card'; // Ensure this path is correct

// --- TypeScript Type Declarations (Optional but Recommended) ---
// If window.electron is injected, declare its expected shape globally
// You might put this in a separate .d.ts file (e.g., global.d.ts)
declare global {
  interface Window {
    electron?: { // Make electron optional
      shell?: { // Make shell optional
        openExternal: (url: string) => Promise<void>;
      };
      // Add other expected electron properties here if needed
    };
  }
}

// Type for Cortex API responses (can be refined)
type CortexApiResponse = any; // Use a more specific type if the structure is known

// Type for WebSocket command objects received from server
interface ServerCommand {
    command_id: string;
    method: 'GET' | 'POST' | 'PUT' | 'DELETE'; // Add other methods if needed
    url: string;
    data?: any; // Payload for POST/PUT etc.
}

// Type for WebSocket message data (more specific than 'any')
interface WebSocketMessage {
    type?: 'ping' | 'pong';
    command_id?: string;
    method?: ServerCommand['method'];
    url?: string;
    data?: any;
    result?: any; // For responses sent back TO server
    error?: string | { message: string }; // Allow string or object for errors
}


// --- Constants ---
const CORTEX_PORT: number = 39281;
const CORTEX_BASE_URL: string = `http://127.0.0.1:${CORTEX_PORT}`; // Provider's local Cortex API
const ENGINE_NAME: string = 'llama-cpp';
const API_TIMEOUT_MS: number = 30000;
const MODEL_START_TIMEOUT_MS: number = 120000;

const BACKEND_BASE_URL: string = 'http://127.0.0.1:8000'; // FastAPI backend server URL

const WS_RECONNECT_DELAY: number = 3000;
const WS_MAX_RECONNECT_ATTEMPTS: number = 5;

const MINING_CYCLE_DURATION_SECONDS: number = 60;
const POINTS_PER_CYCLE: number = 10;
const PENDING_INCREMENT_PER_SECOND: number = 0.1;

// --- Component ---
export function MiningCard(): JSX.Element {
  // --- State ---
  const [time, setTime] = useState<number>(() => parseFloat(sessionStorage.getItem('miningTime') || MINING_CYCLE_DURATION_SECONDS.toString()));
  const [pending, setPending] = useState<number>(() => parseFloat(sessionStorage.getItem('miningPending') || '0'));
  const [saved, setSaved] = useState<number>(() => parseFloat(localStorage.getItem('savedScore') || '40'));
  const [isRunning, setIsRunning] = useState<boolean>(false);
  const [wsStatus, setWsStatus] = useState<'disconnected' | 'connecting' | 'connected' | 'error' | 'offline'>('disconnected');
  const [isEngineLoaded, setIsEngineLoaded] = useState<boolean>(false);
  const [currentLoadedModel, setCurrentLoadedModel] = useState<string | null>(null);
  const [isManagingModelState, setIsManagingModelState] = useState<boolean>(false);

  // --- Refs ---
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const reconnectAttempts = useRef<number>(0);

  // --- Internal Logging ---
  const log = useCallback((message: string, level: 'info' | 'warn' | 'error' | 'debug' = 'info') => {
    console.log(`[${new Date().toLocaleTimeString()}] [MiningCard-${level.toUpperCase()}] ${message}`);
  }, []);

  // --- Browser Opener ---
  const openInBrowser = useCallback((url: string): void => {
    log(`Opening external URL: ${url}`, 'info');
    // Use optional chaining for safety
    if (window.electron?.shell?.openExternal) {
      window.electron.shell.openExternal(url).catch(err => log(`Electron failed to open URL: ${err}`, 'error'));
    } else {
      window.open(url, '_blank', 'noopener,noreferrer');
    }
  }, [log]);

  // --- Score Update & Timer Reset ---
  const resetTimer = useCallback(() => {
    log('Resetting mining timer and pending points.');
    setTime(MINING_CYCLE_DURATION_SECONDS);
    setPending(0);
    setIsRunning(true);
    sessionStorage.setItem('miningTime', MINING_CYCLE_DURATION_SECONDS.toString());
    sessionStorage.setItem('miningPending', '0');
  }, [log]);

  const stopMiningProgress = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
      setIsRunning(false);
      log('Mining progress timer stopped.');
    }
  }, [log]);

  const updateScoreViaAPI = useCallback(async (): Promise<void> => {
    log(`Attempting to save ${POINTS_PER_CYCLE} points via API.`);
    try {
      const token = localStorage.getItem('authToken');
      if (!token) {
        log('No auth token found for score update', 'warn');
        return;
      }

      const response = await fetch(`${BACKEND_BASE_URL}/user/points`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ points: POINTS_PER_CYCLE })
      });

      if (!response.ok) {
          const errorData = await response.json().catch(() => ({ detail: `HTTP error! status: ${response.status}` }));
          throw new Error(errorData.detail || `HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      setSaved(prevSaved => {
        // Prefer total_points from response if available
        const newSaved = typeof data.total_points === 'number' ? data.total_points : (prevSaved + POINTS_PER_CYCLE);
        localStorage.setItem('savedScore', newSaved.toString());
        log(`Successfully updated points via API. New saved total: ${newSaved.toFixed(2)}`);
        return newSaved;
      });
      resetTimer(); // Reset timer cycle AFTER successful save

    } catch (error: any) {
      console.error('Error updating points:', error);
      log(`Failed to update points: ${error.message}`, 'error');
      stopMiningProgress(); // Stop timer on failure
    }
  }, [log, resetTimer, stopMiningProgress]);


  // --- Mining Progress Timer ---
  const startMiningProgress = useCallback(() => {
    if (timerRef.current) return; // Already running
    if (wsStatus !== 'connected') {
        log('Cannot start mining progress: WebSocket not connected.', 'warn');
        return;
    }

    setIsRunning(true);
    log('Starting mining progress timer.');

    timerRef.current = setInterval(() => {
      let cycleEnded = false;
      setTime(prevTime => {
        const newTime = Math.max(0, prevTime - 1); // Decrement by 1 second
        sessionStorage.setItem('miningTime', newTime.toString());
        if (newTime <= 0) cycleEnded = true;
        return newTime;
      });

      setPending(prevPending => {
        const newPending = prevPending + PENDING_INCREMENT_PER_SECOND;
        sessionStorage.setItem('miningPending', newPending.toString());
        return parseFloat(newPending.toFixed(1));
      });

       if (cycleEnded) {
            log('Mining cycle complete.');
            stopMiningProgress(); // Stop interval
            updateScoreViaAPI(); // Attempt to save points (calls resetTimer on success)
       }
    }, 1000); // Run every second
  }, [log, stopMiningProgress, updateScoreViaAPI, wsStatus]);

  // --- WebSocket Communication ---
  const sendWsMessage = useCallback((payload: WebSocketMessage): void => {
     if (wsRef.current?.readyState === WebSocket.OPEN) {
        try {
            wsRef.current.send(JSON.stringify(payload));
            // log(`WS Sent: ${JSON.stringify(payload).substring(0, 100)}...`, 'debug');
        } catch (error: any) {
            log(`Failed to send WebSocket message: ${error.message}`, 'error');
        }
     } else {
        log('Cannot send WebSocket message: connection not open', 'warn');
     }
  }, [log]);

  const sendSuccessResponse = useCallback((command_id: string, result: any): void => {
    sendWsMessage({ command_id, result });
  }, [sendWsMessage]);

  const sendErrorResponse = useCallback((command_id: string, errorMessage: string): void => {
    log(`Sending error response for ${command_id}: ${errorMessage}`, 'error');
    sendWsMessage({
      command_id,
      result: { error: errorMessage } // Standardized error response structure
    });
  }, [log, sendWsMessage]);

   // --- Local Cortex API Interaction ---
  const callCortexAPI = useCallback(async (
    endpoint: string,
    method: ServerCommand['method'] = 'GET',
    body: any = null,
    timeout: number = API_TIMEOUT_MS
  ): Promise<CortexApiResponse> => {
    const url = `${CORTEX_BASE_URL}${endpoint}`;
    log(`Calling Cortex API: ${method} ${url}`, 'debug');
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    try {
      const options: RequestInit = { // Use RequestInit type
        method,
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        signal: controller.signal,
      };
      if (body && method !== 'GET' && method !== 'HEAD') { // Check method allows body
        options.body = JSON.stringify(body);
      }

      const response = await fetch(url, options);
      clearTimeout(timeoutId);

      if (!response.ok) {
        let errorData;
        try { errorData = await response.json(); } catch (parseError) { errorData = { detail: response.statusText }; }
        // Safely access nested error message
        const errorMessage = errorData?.error?.message || errorData?.detail || `HTTP error ${response.status}`;
        log(`Cortex API Error (${method} ${url}): ${errorMessage}`, 'error');
        throw new Error(errorMessage);
      }

       const contentType = response.headers.get("content-type");
       if (contentType?.includes("application/json")) {
            const data = await response.json();
            // log(`Cortex API Success (${method} ${url}): Received JSON`, 'debug');
            return data;
       } else if (response.status === 204 || response.headers.get('content-length') === '0') {
            // log(`Cortex API Success (${method} ${url}): Received empty response`, 'debug');
            return null; // Represent empty body as null
       } else {
            const textData = await response.text();
            log(`Cortex API Success (${method} ${url}): Received non-JSON response: ${textData.substring(0, 100)}...`, 'warn');
            return { raw_response: textData }; // Wrap non-JSON in an object
       }

    } catch (error: any) {
      clearTimeout(timeoutId);
      if (error.name === 'AbortError') {
          log(`Cortex API Timeout: ${method} ${url}`, 'error');
          throw new Error(`Request timed out after ${timeout / 1000}s`);
      }
      log(`Cortex API Fetch Error (${method} ${url}): ${error.message}`, 'error');
      throw error; // Re-throw the original error
    }
  }, [log]);

   // --- Cortex State Management Functions ---
   const getCurrentCortexStatus = useCallback(async (): Promise<{ loadedModel: string | null; enginePotentiallyRunning: boolean }> => {
     // log('Querying current Cortex status (/v1/models)...', 'debug');
     try {
       const response = await callCortexAPI('/v1/models', 'GET');
       const models = response?.data || [];
       // Find the first loaded model (adjust logic based on actual Cortex API response)
       const loadedModel = models.find((model: any) => model.status === 'LOADED' || model.state === 'loaded')?.id || null;
       // log(`Cortex status updated. Loaded model: ${loadedModel || 'None'}`, 'debug');
       setCurrentLoadedModel(loadedModel);
       setIsEngineLoaded(!!loadedModel); // Assume engine is running if a model is loaded
       return { loadedModel, enginePotentiallyRunning: !!loadedModel };
     } catch (error: any) {
       log(`Failed to get Cortex status: ${error.message}. Assuming engine/model not loaded.`, 'error');
       setIsEngineLoaded(false);
       setCurrentLoadedModel(null);
       return { loadedModel: null, enginePotentiallyRunning: false };
     }
   }, [callCortexAPI, log]);

  const ensureEngineLoaded = useCallback(async (): Promise<boolean> => {
    // log(`Ensuring engine '${ENGINE_NAME}' is loaded. Currently: ${isEngineLoaded}`, 'debug');
    if (isEngineLoaded) return true; // Assume loaded if state says so (rely on getCurrentCortexStatus for updates)
    log(`Attempting to load engine '${ENGINE_NAME}'...`);
    try {
        // Consider adding a check here first if Cortex has a dedicated 'is engine loaded' endpoint
        await callCortexAPI(`/v1/engines/${ENGINE_NAME}/load`, 'POST', null, API_TIMEOUT_MS);
        log(`Engine '${ENGINE_NAME}' loaded successfully.`);
        setIsEngineLoaded(true);
        return true;
    } catch (error: any) {
        log(`Failed to load engine '${ENGINE_NAME}': ${error.message}`, 'error');
        setIsEngineLoaded(false);
        return false;
    }
  }, [isEngineLoaded, log, callCortexAPI]);

  const ensureModelLoaded = useCallback(async (targetModelId: string | undefined | null): Promise<boolean> => {
     if (!targetModelId) {
       log('Target model ID missing for ensureModelLoaded', 'error');
       return false;
     }
     if (isManagingModelState) {
         log('Model state management already in progress, skipping.', 'warn');
         return false; // Avoid race conditions
     }
     setIsManagingModelState(true);
     log(`Ensuring model '${targetModelId}' is loaded. Current: ${currentLoadedModel || 'None'}.`, 'info');

    try {
        // Don't explicitly ensure engine here, let model start/stop handle it if needed
        // const engineReady = await ensureEngineLoaded();
        // if (!engineReady) throw new Error(`Engine '${ENGINE_NAME}' could not be loaded.`);

        const status = await getCurrentCortexStatus(); // Check real status *before* actions
        const actualLoadedModel = status.loadedModel;

        if (actualLoadedModel === targetModelId) {
           log(`Model '${targetModelId}' is already loaded.`);
           return true;
        }

        // Stop different loaded model (if any)
        if (actualLoadedModel && actualLoadedModel !== targetModelId) {
          log(`Stopping currently loaded model '${actualLoadedModel}'...`);
          try {
            // Use the correct Cortex endpoint for stopping (may vary)
            await callCortexAPI('/v1/models/stop', 'POST', { model: actualLoadedModel }, API_TIMEOUT_MS);
            log(`Model '${actualLoadedModel}' stopped.`);
            setCurrentLoadedModel(null); // Update state immediately
          } catch (stopError: any) {
            log(`Failed to stop model '${actualLoadedModel}': ${stopError.message}. Proceeding to load target.`, 'warn');
             setCurrentLoadedModel(null); // Assume stopped or errored state
          }
        }

        // Start target model
        log(`Starting target model '${targetModelId}'... This might take a while.`);
        // Use the correct Cortex endpoint for starting (may vary)
        await callCortexAPI('/v1/models/start', 'POST', { model: targetModelId }, MODEL_START_TIMEOUT_MS);
        log(`Model '${targetModelId}' started successfully.`);
        setCurrentLoadedModel(targetModelId); // Update state immediately
        return true;

    } catch (error: any) {
        log(`Failed to ensure model '${targetModelId}' loaded: ${error.message}`, 'error');
        setCurrentLoadedModel(null); // Reset state on failure
        return false;
    } finally {
        setIsManagingModelState(false); // Release lock
    }
  }, [isManagingModelState, currentLoadedModel, log, getCurrentCortexStatus, callCortexAPI]);

  // --- Command Handling Logic ---
  const handleServerCommand = useCallback(async (reqObj: ServerCommand) => {
    const { method, url, data, command_id } = reqObj;
    log(`Received command ${command_id}: ${method} ${url}`, 'info');

    if (!method || !url || !command_id) {
      log(`Invalid command received: Missing method, url, or command_id`, 'error');
      return; // Ignore invalid commands
    }

    try {
      let resultData: CortexApiResponse;
      let modelToEnsure: string | null = null;

      // Determine if a specific model needs to be loaded for this command
      if (url === '/v1/chat/completions' || url.startsWith('/v1/chat/')) { // Handle chat-related endpoints
        modelToEnsure = data?.model;
        if (!modelToEnsure) throw new Error(`Request to ${url} missing 'model' identifier in data.`);
         log(`Command ${command_id} requires model: ${modelToEnsure}`, 'debug');
      }
      // Add other checks if specific endpoints require the engine but not a model
      // else if (url === '/v1/some_engine_endpoint') {
      //    const engineReady = await ensureEngineLoaded();
      //    if (!engineReady) throw new Error(`Engine '${ENGINE_NAME}' not loaded for ${url}.`);
      // }

      // Ensure the required model is loaded (if any)
      if (modelToEnsure) {
        const modelReady = await ensureModelLoaded(modelToEnsure);
        if (!modelReady) throw new Error(`Failed to load required model '${modelToEnsure}' for command ${command_id}.`);
      }

      // Execute the command against the local Cortex API
      log(`Executing command ${command_id} (${method} ${url}) on local Cortex...`, 'debug');
      resultData = await callCortexAPI(url, method, data);

      // Send success response back via WebSocket
      log(`Command ${command_id} executed successfully on Cortex.`, 'info');
      sendSuccessResponse(command_id, resultData);

    } catch (error: any) {
      log(`Command ${command_id} (${method} ${url}) failed: ${error.message}`, 'error');
      sendErrorResponse(command_id, error.message || 'Unknown error occurred during command execution');
    }
  }, [log, ensureModelLoaded, callCortexAPI, sendSuccessResponse, sendErrorResponse]);


  // --- WebSocket Initialization ---
  const initializeWebSocket = useCallback(() => {
    // Clear existing connections/timers
    if (wsRef.current) {
      wsRef.current.onclose = null; // Prevent old onclose from firing
      wsRef.current.close(1000, "Reinitializing");
      wsRef.current = null;
    }
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }

    const token = localStorage.getItem('authToken');
    if (!token) {
      setWsStatus('disconnected');
      stopMiningProgress();
      log('Auth token missing, WebSocket connection cancelled.', 'warn');
      return;
    }

    // Determine WebSocket protocol and backend host
    const backendWsProtocol = BACKEND_BASE_URL.startsWith('https:') ? 'wss:' : 'ws:';
    const backendHost = BACKEND_BASE_URL.replace(/^http(s?):\/\//, '');

    // *** This is the crucial part ***
    // This URL needs to be reachable *from the backend server* to access this provider's Cortex API.
    // For local testing (backend and provider on same machine), CORTEX_BASE_URL is okay.
    // For deployment, this MUST be the provider's external IP/hostname + Cortex port.
    // How to get this dynamically depends on your setup (e.g., user config, network discovery).
    const providerHttpUrlForBackend = CORTEX_BASE_URL; // <-- !! ADJUST THIS FOR DEPLOYMENT !!
    // Example for a hypothetical external IP:
    // const providerHttpUrlForBackend = `http://<PROVIDER_EXTERNAL_IP>:${CORTEX_PORT}`;

    const wsUrl = `${backendWsProtocol}//${backendHost}/ws?token=${encodeURIComponent(token)}&http_base_url=${encodeURIComponent(providerHttpUrlForBackend)}`;

    log(`Attempting WebSocket connection to backend: ${wsUrl.split('?')[0]}?token=REDACTED&http_base_url=${encodeURIComponent(providerHttpUrlForBackend)}`);
    setWsStatus('connecting');

    try {
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        setWsStatus('connected');
        reconnectAttempts.current = 0; // Reset attempts on successful connection
        log('WebSocket connection established with backend.');
        startMiningProgress(); // Start mining now connected
        // Optionally, sync Cortex status on connect
        getCurrentCortexStatus();
      };

      ws.onmessage = async (event: MessageEvent) => {
        // log(`WS Received: ${event.data.substring(0, 100)}...`, 'debug');
        try {
          const messageData: WebSocketMessage = JSON.parse(event.data);
          if (messageData.type === 'ping') {
               // log('Received ping, sending pong.', 'debug');
               sendWsMessage({ type: 'pong' });
               return;
          }
          // Check if it's a command from the server
          if (messageData.command_id && messageData.method && messageData.url) {
            await handleServerCommand(messageData as ServerCommand); // Type assertion
          } else {
            log(`Received non-command message or invalid command structure`, 'warn');
          }
        } catch (err: any) {
          log(`Error processing WebSocket message: ${err.message}`, 'error');
        }
      };

      ws.onclose = (event: CloseEvent) => {
        const wasConnected = wsStatus === 'connected';
        setWsStatus('disconnected');
        stopMiningProgress();
        wsRef.current = null; // Clear the ref
        log(`WebSocket connection closed. Code: ${event.code}, Reason: ${event.reason || 'None'}, Clean: ${event.wasClean}`);

        // Reconnect logic
        if (event.code !== 1000 && localStorage.getItem('authToken')) { // Don't retry on clean close or if logged out
          reconnectAttempts.current++;
          if (reconnectAttempts.current <= WS_MAX_RECONNECT_ATTEMPTS) {
            const delay = WS_RECONNECT_DELAY * Math.pow(2, reconnectAttempts.current - 1);
            log(`Attempting reconnect ${reconnectAttempts.current}/${WS_MAX_RECONNECT_ATTEMPTS} in ${delay / 1000}s...`, 'warn');
            reconnectTimeoutRef.current = setTimeout(initializeWebSocket, delay);
          } else {
            log('Max WebSocket reconnection attempts reached.', 'error');
            // Maybe notify user here
          }
        } else {
             log('WebSocket closed cleanly or token removed. No automatic reconnect planned.');
             reconnectAttempts.current = 0; // Reset attempts if closed cleanly or no token
        }
      };

      ws.onerror = (event: Event) => {
        // Log the raw event for more details if needed: console.error('WebSocket Error Event:', event);
        setWsStatus('error');
        // onclose will be triggered after onerror, handling cleanup and reconnect attempts
        log(`WebSocket error occurred. Check console for details. Connection will close.`, 'error');
      };

    } catch (error: any) {
      console.error('WebSocket initialization failed:', error);
      setWsStatus('error');
      stopMiningProgress();
      log(`Failed to initialize WebSocket: ${error.message}`, 'error');
      // Attempt reconnect even if initial connection throws error
      if (localStorage.getItem('authToken')) {
         reconnectAttempts.current++;
          if (reconnectAttempts.current <= WS_MAX_RECONNECT_ATTEMPTS) {
             const delay = WS_RECONNECT_DELAY * Math.pow(2, reconnectAttempts.current - 1);
              log(`Retrying connection attempt ${reconnectAttempts.current}/${WS_MAX_RECONNECT_ATTEMPTS} in ${delay / 1000}s...`, 'warn');
             reconnectTimeoutRef.current = setTimeout(initializeWebSocket, delay);
          } else {
              log('Max connection attempts reached after init failure.', 'error');
          }
      }
    }
  }, [log, startMiningProgress, stopMiningProgress, handleServerCommand, sendWsMessage, getCurrentCortexStatus, wsStatus]); // Add wsStatus dependency

  // --- Effects ---
  useEffect(() => {
    // Restore state from storage on initial mount
    const initialTime = parseFloat(sessionStorage.getItem('miningTime') || MINING_CYCLE_DURATION_SECONDS.toString());
    setTime(initialTime);
    const initialPending = parseFloat(sessionStorage.getItem('miningPending') || '0');
    setPending(initialPending);
    const initialSaved = parseFloat(localStorage.getItem('savedScore') || '40');
    setSaved(initialSaved);

    // Start WebSocket connection attempt
    initializeWebSocket();

    // Network status listeners for browser online/offline events
    const handleOnline = () => {
        log('Browser detected online status.', 'info');
        // Only try reconnecting if disconnected and not already retrying
        if (wsStatus !== 'connected' && !reconnectTimeoutRef.current && reconnectAttempts.current < WS_MAX_RECONNECT_ATTEMPTS) {
             log('Attempting WebSocket reconnect after coming online.');
             initializeWebSocket();
        }
    };
    const handleOffline = () => {
        log('Browser detected offline status.', 'warn');
        setWsStatus('offline'); // Update status visually
        stopMiningProgress();
        if (wsRef.current) wsRef.current.close(1000, "Browser offline"); // Close WS gently
        if (reconnectTimeoutRef.current) {
            clearTimeout(reconnectTimeoutRef.current); // Stop pending retries
            reconnectTimeoutRef.current = null;
             log('Cleared pending WebSocket reconnect attempts due to offline status.');
        }
         reconnectAttempts.current = 0; // Reset attempts when offline
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    // Cleanup on component unmount
    return () => {
      log('MiningCard unmounting. Cleaning up...');
      stopMiningProgress();
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);
      if (wsRef.current) {
        wsRef.current.onclose = null; // Important: prevent onclose logic during unmount close
        wsRef.current.close(1000, 'Component unmounting');
        wsRef.current = null;
      }
       log('MiningCard cleanup complete.');
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Run only on mount

  // --- UI Rendering Calculations ---
  const progressPercentage: number = Math.min(100, ((MINING_CYCLE_DURATION_SECONDS - time) / MINING_CYCLE_DURATION_SECONDS) * 100);

  const getWsStatusInfo = (): { color: string; text: string; icon: React.ReactNode } => {
      switch (wsStatus) {
          case 'connected': return { color: 'text-green-500', text: 'Connected', icon: <Wifi className="w-4 h-4 mr-1" /> };
          case 'connecting': return { color: 'text-yellow-500', text: 'Connecting...', icon: <WifiOff className="w-4 h-4 mr-1" /> };
          case 'offline': return { color: 'text-gray-500', text: 'Offline', icon: <WifiOff className="w-4 h-4 mr-1" /> };
          case 'error': return { color: 'text-red-500', text: 'Error', icon: <WifiOff className="w-4 h-4 mr-1" /> };
          case 'disconnected':
          default:
              return {
                  color: 'text-orange-500',
                  text: reconnectAttempts.current > 0 ? `Reconnecting (${reconnectAttempts.current})` : 'Disconnected',
                  icon: <WifiOff className="w-4 h-4 mr-1" />
              };
      }
  };
  const wsStatusInfo = getWsStatusInfo();

  return (
    <Card className="bg-[#1a1a2e] border-0 h-full flex flex-col text-white">
      <CardContent className="p-6 flex flex-col flex-grow">
        {/* Connection Status */}
        <div className="flex justify-end mb-2">
          <div className={`flex items-center ${wsStatusInfo.color}`}>
            {wsStatusInfo.icon}
            <span className="text-xs">{wsStatusInfo.text}</span>
          </div>
        </div>

        {/* Survey Button */}
        <button
          className="w-full bg-[#12121f] text-emerald-400 p-3 rounded-lg mb-6 transition-all duration-200 ease-in-out shrink-0 hover:bg-emerald-400 hover:text-[#12121f] active:scale-95 focus:outline-none focus:ring-2 focus:ring-emerald-400 focus:ring-opacity-50"
          onClick={() => openInBrowser(`${BACKEND_BASE_URL}/survey`)}
        >
          Complete the Survey (+1200 Tokens)
        </button>

        {/* Pending Score */}
        <div className="text-center mb-6 shrink-0">
          <div className="text-gray-400 mb-2 uppercase text-sm">Pending</div>
          <div className="text-4xl text-white mb-4">{pending.toFixed(1)}</div>
        </div>

        {/* Saved Score & Progress Bar */}
        <div className="mb-6 shrink-0">
          <div className="flex flex-col items-center mb-2">
            <span className="text-gray-400 text-sm">Saved</span>
            <div className="flex items-center gap-1">
              <span className="text-2xl text-white">{saved.toFixed(2)}</span>
              <span className="text-gray-400 text-sm">Tokens</span> {/* Simplified label */}
              {/* <Info className="w-4 h-4 text-gray-400" /> */}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex-1 h-2 bg-[#12121f] rounded-full overflow-hidden">
              <div
                className="h-full bg-green-500 rounded-full transition-width duration-1000 ease-linear"
                style={{ width: `${progressPercentage}%` }}
                aria-valuenow={progressPercentage}
                aria-valuemin={0}
                aria-valuemax={100}
                role="progressbar"
              />
            </div>
             {/* Dynamic Time Left Display */}
            <span className="text-gray-400 text-sm whitespace-nowrap w-20 text-right">
                {isRunning && time > 0 ? `${Math.floor(time / 60)}:${(time % 60).toString().padStart(2, '0')} left`
                 : time <= 0 && isRunning ? 'Saving...' // Show saving when cycle ends but API call pending
                 : wsStatus === 'connected' && !isRunning && time > 0 ? 'Starting...' // Show starting if connected but timer not running yet
                 : 'Paused'}
            </span>
          </div>
        </div>

        {/* Status Text */}
        <div className="text-gray-400 text-sm mt-auto shrink-0 text-center">
          Keep this provider running to earn tokens.
        </div>

      </CardContent>
    </Card>
  );
}

export default MiningCard; // Default export if this is the main export of the file