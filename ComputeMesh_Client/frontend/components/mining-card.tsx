import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Info, Wifi, WifiOff } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';

declare global {
  interface Window {
    electron?: {
      shell?: {
        openExternal: (url: string) => Promise<void>;
      };
    };
  }
}

type CortexApiResponse = any;

interface ServerCommand {
  command_id: string;
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  url: string;
  data?: any;
}

interface WebSocketMessage {
  type?: 'ping' | 'pong';
  command_id?: string;
  method?: ServerCommand['method'];
  url?: string;
  data?: any;
  result?: any;
  error?: string | { message: string };
}

const CORTEX_PORT: number = 39281;
const CORTEX_BASE_URL: string = `http://127.0.0.1:${CORTEX_PORT}`;
const ENGINE_NAME: string = 'llama-cpp';
const DEFAULT_MODEL: string = 'tinyllama:1b';
const API_TIMEOUT_MS: number = 30000;
const MODEL_START_TIMEOUT_MS: number = 120000;
const BACKEND_BASE_URL: string = 'http://127.0.0.1:8000';
const WS_RECONNECT_DELAY: number = 3000;
const WS_MAX_RECONNECT_ATTEMPTS: number = 5;
const MINING_CYCLE_DURATION_SECONDS: number = 60;
const POINTS_PER_CYCLE: number = 10;
const PENDING_INCREMENT_PER_SECOND: number = 0.1;

export function MiningCard(): JSX.Element {
  const [time, setTime] = useState<number>(() => parseFloat(sessionStorage.getItem('miningTime') || MINING_CYCLE_DURATION_SECONDS.toString()));
  const [pending, setPending] = useState<number>(() => parseFloat(sessionStorage.getItem('miningPending') || '0'));
  const [saved, setSaved] = useState<number>(() => parseFloat(localStorage.getItem('savedScore') || '40'));
  const [isRunning, setIsRunning] = useState<boolean>(false);
  const [wsStatus, setWsStatus] = useState<'disconnected' | 'connecting' | 'connected' | 'error' | 'offline'>('disconnected');
  const [isEngineLoaded, setIsEngineLoaded] = useState<boolean>(false);
  const [currentLoadedModel, setCurrentLoadedModel] = useState<string | null>(null);
  const [isManagingModelState, setIsManagingModelState] = useState<boolean>(false);
  const [targetModel, setTargetModel] = useState<string | null>(DEFAULT_MODEL);

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const reconnectAttempts = useRef<number>(0);
  const modelLoadTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const log = useCallback((message: string, level: 'info' | 'warn' | 'error' | 'debug' = 'info') => {
    console.log(`[${new Date().toLocaleTimeString()}] [MiningCard-${level.toUpperCase()}] ${message}`);
  }, []);

  const openInBrowser = useCallback((url: string): void => {
    log(`Opening external URL: ${url}`, 'info');
    if (window.electron?.shell?.openExternal) {
      window.electron.shell.openExternal(url).catch(err => log(`Electron failed to open URL: ${err}`, 'error'));
    } else {
      window.open(url, '_blank', 'noopener,noreferrer');
    }
  }, [log]);

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
        const newSaved = typeof data.total_points === 'number' ? data.total_points : (prevSaved + POINTS_PER_CYCLE);
        localStorage.setItem('savedScore', newSaved.toString());
        log(`Successfully updated points via API. New saved total: ${newSaved.toFixed(2)}`);
        return newSaved;
      });
      resetTimer();
    } catch (error: any) {
      console.error('Error updating points:', error);
      log(`Failed to update points: ${error.message}`, 'error');
      stopMiningProgress();
    }
  }, [log, resetTimer, stopMiningProgress]);

  const startMiningProgress = useCallback(() => {
    if (timerRef.current) return;
    if (wsStatus !== 'connected') {
      log('Cannot start mining progress: WebSocket not connected.', 'warn');
      return;
    }

    setIsRunning(true);
    log('Starting mining progress timer.');

    timerRef.current = setInterval(() => {
      let cycleEnded = false;
      setTime(prevTime => {
        const newTime = Math.max(0, prevTime - 1);
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
        stopMiningProgress();
        updateScoreViaAPI();
      }
    }, 1000);
  }, [log, stopMiningProgress, updateScoreViaAPI, wsStatus]);

  const sendWsMessage = useCallback((payload: WebSocketMessage): void => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      try {
        wsRef.current.send(JSON.stringify(payload));
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
      result: { error: errorMessage }
    });
  }, [log, sendWsMessage]);

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
      const options: RequestInit = {
        method,
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        signal: controller.signal,
      };
      if (body && method !== 'GET' && method !== 'HEAD') {
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
      if (contentType?.includes("application/json")) {
        return await response.json();
      } else if (response.status === 204 || response.headers.get('content-length') === '0') {
        return null;
      } else {
        const textData = await response.text();
        log(`Cortex API Success (${method} ${url}): Received non-JSON response: ${textData.substring(0, 100)}...`, 'warn');
        return { raw_response: textData };
      }
    } catch (error: any) {
      clearTimeout(timeoutId);
      if (error.name === 'AbortError') {
        log(`Cortex API Timeout: ${method} ${url}`, 'error');
        throw new Error(`Request timed out after ${timeout / 1000}s`);
      }
      log(`Cortex API Fetch Error (${method} ${url}): ${error.message}`, 'error');
      throw error;
    }
  }, [log]);

  const loadEngine = useCallback(async (): Promise<boolean> => {
    if (isEngineLoaded) return true;
    
    log(`Loading engine '${ENGINE_NAME}'...`);
    try {
      await callCortexAPI(`/v1/engines/${ENGINE_NAME}/load`, 'POST');
      log(`Engine '${ENGINE_NAME}' loaded successfully.`);
      setIsEngineLoaded(true);
      return true;
    } catch (error: any) {
      log(`Failed to load engine '${ENGINE_NAME}': ${error.message}`, 'error');
      setIsEngineLoaded(false);
      return false;
    }
  }, [isEngineLoaded, log, callCortexAPI]);

  const unloadEngine = useCallback(async (): Promise<void> => {
    log(`Unloading engine '${ENGINE_NAME}'...`);
    try {
      await callCortexAPI(`/v1/engines/${ENGINE_NAME}/load`, 'DELETE');
      log(`Engine '${ENGINE_NAME}' unloaded successfully.`);
      setIsEngineLoaded(false);
    } catch (error: any) {
      log(`Failed to unload engine '${ENGINE_NAME}': ${error.message}`, 'error');
    }
  }, [log, callCortexAPI]);

  const getCurrentModel = useCallback(async (): Promise<string | null> => {
    try {
      const response = await callCortexAPI('/v1/models', 'GET');
      const models = response?.data || [];
      const loadedModel = models.find((model: any) => model.id)?.id || null;
      log(`Current loaded model: ${loadedModel || 'None'}`);
      setCurrentLoadedModel(loadedModel);
      return loadedModel;
    } catch (error: any) {
      log(`Failed to get current model: ${error.message}`, 'error');
      setCurrentLoadedModel(null);
      return null;
    }
  }, [callCortexAPI, log]);

  const stopCurrentModel = useCallback(async (): Promise<boolean> => {
    const currentModel = await getCurrentModel();
    if (!currentModel) return true;

    log(`Stopping current model '${currentModel}'...`);
    try {
      await callCortexAPI('/v1/models/stop', 'POST', { model: currentModel });
      log(`Model '${currentModel}' stopped successfully.`);
      setCurrentLoadedModel(null);
      return true;
    } catch (error: any) {
      log(`Failed to stop model '${currentModel}': ${error.message}`, 'error');
      return false;
    }
  }, [callCortexAPI, getCurrentModel, log]);

  const startModel = useCallback(async (modelId: string): Promise<boolean> => {
    log(`Starting model '${modelId}'...`);
    try {
      await callCortexAPI('/v1/models/start', 'POST', { model: modelId }, MODEL_START_TIMEOUT_MS);
      log(`Model '${modelId}' started successfully.`);
      setCurrentLoadedModel(modelId);
      return true;
    } catch (error: any) {
      log(`Failed to start model '${modelId}': ${error.message}`, 'error');
      setCurrentLoadedModel(null);
      return false;
    }
  }, [callCortexAPI, log]);

  const loadModel = useCallback(async (modelId: string): Promise<boolean> => {
    if (isManagingModelState) {
      log('Model state management already in progress, skipping.', 'warn');
      return false;
    }

    setIsManagingModelState(true);
    log(`Loading model '${modelId}'...`);

    try {
      // First ensure engine is loaded
      const engineReady = await loadEngine();
      if (!engineReady) {
        throw new Error(`Engine '${ENGINE_NAME}' could not be loaded`);
      }

      // Stop any currently running model
      await stopCurrentModel();

      // Start the target model
      const modelStarted = await startModel(modelId);
      if (!modelStarted) {
        throw new Error(`Failed to start model '${modelId}'`);
      }

      return true;
    } catch (error: any) {
      log(`Model load failed: ${error.message}`, 'error');
      return false;
    } finally {
      setIsManagingModelState(false);
    }
  }, [isManagingModelState, loadEngine, log, startModel, stopCurrentModel]);

  const handleServerCommand = useCallback(async (reqObj: ServerCommand) => {
    const { method, url, data, command_id } = reqObj;
    log(`Received command ${command_id}: ${method} ${url}`, 'info');

    if (!method || !url || !command_id) {
      log(`Invalid command received: Missing method, url, or command_id`, 'error');
      return;
    }

    try {
      let resultData: CortexApiResponse;
      let modelToLoad: string | null = null;

      // Check if this command requires a specific model
      if (url === '/v1/chat/completions' || url.startsWith('/v1/chat/')) {
        modelToLoad = data?.model || DEFAULT_MODEL;
        log(`Command ${command_id} requires model: ${modelToLoad}`, 'debug');
      }

      // Load the required model if specified
      if (modelToLoad) {
        const modelReady = await loadModel(modelToLoad);
        if (!modelReady) {
          throw new Error(`Failed to load required model '${modelToLoad}'`);
        }
      }

      // Execute the command
      resultData = await callCortexAPI(url, method, data);
      sendSuccessResponse(command_id, resultData);

    } catch (error: any) {
      log(`Command ${command_id} (${method} ${url}) failed: ${error.message}`, 'error');
      sendErrorResponse(command_id, error.message || 'Unknown error occurred during command execution');
    }
  }, [callCortexAPI, loadModel, log, sendErrorResponse, sendSuccessResponse]);

  const initializeWebSocket = useCallback(() => {
    if (wsRef.current) {
      wsRef.current.onclose = null;
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

    const backendWsProtocol = BACKEND_BASE_URL.startsWith('https:') ? 'wss:' : 'ws:';
    const backendHost = BACKEND_BASE_URL.replace(/^http(s?):\/\//, '');
    const providerHttpUrlForBackend = CORTEX_BASE_URL;
    const wsUrl = `${backendWsProtocol}//${backendHost}/ws?token=${encodeURIComponent(token)}&http_base_url=${encodeURIComponent(providerHttpUrlForBackend)}`;

    log(`Attempting WebSocket connection to backend: ${wsUrl.split('?')[0]}?token=REDACTED&http_base_url=${encodeURIComponent(providerHttpUrlForBackend)}`);
    setWsStatus('connecting');

    try {
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        setWsStatus('connected');
        reconnectAttempts.current = 0;
        log('WebSocket connection established with backend.');
        startMiningProgress();
        // Load default model when connected
        loadModel(DEFAULT_MODEL).catch(error => 
          log(`Failed to load default model: ${error.message}`, 'error')
        );
      };

      ws.onmessage = async (event: MessageEvent) => {
        try {
          const messageData: WebSocketMessage = JSON.parse(event.data);
          if (messageData.type === 'ping') {
            sendWsMessage({ type: 'pong' });
            return;
          }
          if (messageData.command_id && messageData.method && messageData.url) {
            await handleServerCommand(messageData as ServerCommand);
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
        wsRef.current = null;
        log(`WebSocket connection closed. Code: ${event.code}, Reason: ${event.reason || 'None'}, Clean: ${event.wasClean}`);

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
          log('WebSocket closed cleanly or token removed. No automatic reconnect planned.');
          reconnectAttempts.current = 0;
        }
      };

      ws.onerror = (event: Event) => {
        setWsStatus('error');
        log(`WebSocket error occurred. Check console for details. Connection will close.`, 'error');
      };

    } catch (error: any) {
      console.error('WebSocket initialization failed:', error);
      setWsStatus('error');
      stopMiningProgress();
      log(`Failed to initialize WebSocket: ${error.message}`, 'error');
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
  }, [log, startMiningProgress, stopMiningProgress, handleServerCommand, sendWsMessage, loadModel, wsStatus]);

  useEffect(() => {
    const initialTime = parseFloat(sessionStorage.getItem('miningTime') || MINING_CYCLE_DURATION_SECONDS);
    setTime(initialTime);
    const initialPending = parseFloat(sessionStorage.getItem('miningPending') || 0);
    setPending(initialPending);
    const initialSaved = parseFloat(localStorage.getItem('savedScore') || 40);
    setSaved(initialSaved);

    initializeWebSocket();

    const handleOnline = () => {
      log('Browser detected online status.', 'info');
      if (wsStatus !== 'connected' && !reconnectTimeoutRef.current && reconnectAttempts.current < WS_MAX_RECONNECT_ATTEMPTS) {
        log('Attempting WebSocket reconnect after coming online.');
        initializeWebSocket();
      }
    };
    const handleOffline = () => {
      log('Browser detected offline status.', 'warn');
      setWsStatus('offline');
      stopMiningProgress();
      if (wsRef.current) wsRef.current.close(1000, "Browser offline");
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = null;
        log('Cleared pending WebSocket reconnect attempts due to offline status.');
      }
      reconnectAttempts.current = 0;
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      log('MiningCard unmounting. Cleaning up...');
      stopMiningProgress();
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);
      if (wsRef.current) {
        wsRef.current.onclose = null;
        wsRef.current.close(1000, 'Component unmounting');
        wsRef.current = null;
      }
      if (modelLoadTimeoutRef.current) clearTimeout(modelLoadTimeoutRef.current);
      log('MiningCard cleanup complete.');
    };
  }, []);

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
        <div className="flex justify-end mb-2">
          <div className={`flex items-center ${wsStatusInfo.color}`}>
            {wsStatusInfo.icon}
            <span className="text-xs">{wsStatusInfo.text}</span>
          </div>
        </div>

        <button
          className="w-full bg-[#12121f] text-emerald-400 p-3 rounded-lg mb-6 transition-all duration-200 ease-in-out shrink-0 hover:bg-emerald-400 hover:text-[#12121f] active:scale-95 focus:outline-none focus:ring-2 focus:ring-emerald-400 focus:ring-opacity-50"
          onClick={() => openInBrowser(`${BACKEND_BASE_URL}/survey`)}
        >
          Complete the Survey (+1200 Tokens)
        </button>

        <div className="text-center mb-6 shrink-0">
          <div className="text-gray-400 mb-2 uppercase text-sm">Pending</div>
          <div className="text-4xl text-white mb-4">{pending.toFixed(1)}</div>
        </div>

        <div className="mb-6 shrink-0">
          <div className="flex flex-col items-center mb-2">
            <span className="text-gray-400 text-sm">Saved</span>
            <div className="flex items-center gap-1">
              <span className="text-2xl text-white">{saved.toFixed(2)}</span>
              <span className="text-gray-400 text-sm">Tokens</span>
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
            <span className="text-gray-400 text-sm whitespace-nowrap w-20 text-right">
              {isRunning && time > 0 ? `${Math.floor(time / 60)}:${(time % 60).toString().padStart(2, '0')} left`
                : time <= 0 && isRunning ? 'Saving...'
                : wsStatus === 'connected' && !isRunning && time > 0 ? 'Starting...'
                : 'Paused'}
            </span>
          </div>
        </div>

        <div className="text-gray-400 text-sm mt-auto shrink-0 text-center">
          Keep this provider running to earn tokens.
        </div>
      </CardContent>
    </Card>
  );
}

export default MiningCard;