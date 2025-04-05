import React, { useState, useEffect, useRef } from 'react';
import { Info, Wifi, WifiOff } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';

export function MiningCard() {
  const [time, setTime] = useState(() => {
    const savedTime = sessionStorage.getItem('miningTime');
    return savedTime ? parseFloat(savedTime) : 60;
  });
  
  const openInBrowser = (url) => {
    if (window.electron?.shell?.openExternal) {
      window.electron.shell.openExternal(url);
    } else {
      window.open(url, '_blank', 'noopener,noreferrer');
    }
  };

  const [pending, setPending] = useState(() => {
    const savedPending = sessionStorage.getItem('miningPending');
    return savedPending ? parseFloat(savedPending) : 0;
  });
  
  const [saved, setSaved] = useState(() => {
    const savedScore = localStorage.getItem('savedScore');
    return savedScore ? parseFloat(savedScore) : 40;
  });

  const [isRunning, setIsRunning] = useState(true);
  const [wsStatus, setWsStatus] = useState('disconnected');
  const [logs, setLogs] = useState([]);
  const wsRef = useRef(null);
  const reconnectTimeoutRef = useRef(null);
  const timerRef = useRef(null);
  const PORT = 39281;
  const RECONNECT_DELAY = 3000;
  const MAX_RECONNECT_ATTEMPTS = 5;
  const reconnectAttempts = useRef(0);

  const addLog = (message) => {
    setLogs(prevLogs => [...prevLogs, `${new Date().toLocaleTimeString()} - ${message}`]);
  };

  const resetTimer = () => {
    setTime(60);
    setPending(0);
    setIsRunning(true);
    sessionStorage.setItem('miningTime', '60');
    sessionStorage.setItem('miningPending', '0');
  };

  const updateScoreViaAPI = async () => {
    try {
      const token = localStorage.getItem('authToken');
      if (!token) {
        addLog('No auth token found for score update');
        return;
      }

      const response = await fetch('https://acehack4-0-backend.onrender.com/user/points', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ points: 10 })
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      setSaved(prevSaved => {
        const newSaved = prevSaved + 10;
        localStorage.setItem('savedScore', newSaved.toString());
        return newSaved;
      });
      resetTimer();
      addLog('Successfully updated points');
    } catch (error) {
      console.error('Error updating points:', error);
      addLog(`Failed to update points: ${error.message}`);
    }
  };

  const handleServerCommand = async (reqObj) => {
    const { method, url, data, command_id } = reqObj;
    
    if (!method || !url) {
      sendErrorResponse(command_id, 'Missing method or url in request');
      return;
    }
  
    const fullUrl = `http://127.0.0.1:${PORT}${url}`;
    
    try {
      const fetchOptions = {
        method,
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(data)
      };
  
      // Special handling for GET requests
      if (method.toUpperCase() === 'GET') {
        delete fetchOptions.body;
      }
  
      const response = await fetch(fullUrl, fetchOptions);
  
      if (!response.ok) {
        const error = await response.json().catch(() => ({ detail: response.statusText }));
        throw new Error(error.detail || 'Request failed');
      }
  
      const responseData = await response.json();
      sendSuccessResponse(command_id, responseData);
      addLog(`Success: ${method.toUpperCase()} ${url}`);
      
      // Special handling for model pull progress
      if (url === '/v1/models/pull' && responseData.task) {
        const taskId = responseData.task.id;
        addLog(`Started downloading model (Task ID: ${taskId})`);
      }
    } catch (error) {
      sendErrorResponse(command_id, error.message);
      addLog(`Error: ${method.toUpperCase()} ${url} - ${error.message}`);
      console.error('Command failed:', { url, error });
    }
  };

  const sendSuccessResponse = (command_id, result) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ command_id, result }));
    }
  };

  const sendErrorResponse = (command_id, errorMessage) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ 
        command_id, 
        result: { error: errorMessage } 
      }));
    }
  };

  const handleOffline = () => {
    setWsStatus('offline');
    if (wsRef.current) wsRef.current.close();
    stopMiningProgress();
    addLog('Network connection lost');
  };

  const stopMiningProgress = () => {
    setIsRunning(false);
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  };

  const startMiningProgress = () => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
    }

    timerRef.current = setInterval(() => {
      setTime(prevTime => {
        const newTime = Math.max(0, prevTime - (1/60));
        sessionStorage.setItem('miningTime', newTime.toString());

        setPending(prevPending => {
          const newPending = prevPending + 0.1;
          sessionStorage.setItem('miningPending', newPending.toString());
          return parseFloat(newPending.toFixed(1));
        });

        if (newTime <= 0) {
          updateScoreViaAPI();
          return 60;
        }

        return newTime;
      });
    }, 1000);
  };

  const initializeWebSocket = () => {
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }

    const token = localStorage.getItem('authToken');
    if (!token) {
      setWsStatus('disconnected');
      stopMiningProgress();
      addLog('Authentication required');
      return;
    }

    const wsUrl = `wss://acehack4-0-backend.onrender.com/ws?token=${encodeURIComponent(token)}`;
    addLog(`Connecting to WebSocket at ${wsUrl}`);
    
    try {
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        setWsStatus('connected');
        setIsRunning(true);
        startMiningProgress();
        reconnectAttempts.current = 0;
        addLog('WebSocket connection established');
      };

      ws.onmessage = async (event) => {
        try {
          const commandObj = JSON.parse(event.data);
          addLog(`Received command: ${commandObj.command_id}`);
          await handleServerCommand(commandObj);
        } catch (err) {
          addLog(`Error processing message: ${err.message}`);
        }
      };

      ws.onclose = (event) => {
        setWsStatus('disconnected');
        stopMiningProgress();
        wsRef.current = null;
        addLog(`Connection closed: ${event.code} ${event.reason || ''}`);

        if (event.code !== 1000 && localStorage.getItem('authToken')) {
          reconnectAttempts.current++;
          if (reconnectAttempts.current <= MAX_RECONNECT_ATTEMPTS) {
            addLog(`Reconnecting attempt ${reconnectAttempts.current}/${MAX_RECONNECT_ATTEMPTS}`);
            reconnectTimeoutRef.current = setTimeout(initializeWebSocket, RECONNECT_DELAY);
          } else {
            addLog('Max reconnection attempts reached');
          }
        }
      };

      ws.onerror = (error) => {
        setWsStatus('error');
        stopMiningProgress();
        addLog(`WebSocket error: ${error.message}`);
        console.error('WebSocket error:', error);
      };

    } catch (error) {
      console.error('WebSocket initialization error:', error);
      setWsStatus('error');
      stopMiningProgress();
      addLog(`Failed to initialize WebSocket: ${error.message}`);
      
      reconnectTimeoutRef.current = setTimeout(() => {
        initializeWebSocket();
      }, RECONNECT_DELAY);
    }
  };

  useEffect(() => {
    initializeWebSocket();

    window.addEventListener('online', initializeWebSocket);
    window.addEventListener('offline', handleOffline);

    return () => {
      stopMiningProgress();
      if (wsRef.current) {
        wsRef.current.close();
      }
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      window.removeEventListener('online', initializeWebSocket);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  const progressPercentage = ((60 - time) / 60) * 100;

  return (
    <Card className="bg-[#1a1a2e] border-0">
      <CardContent className="p-6">
        <div className="flex justify-end mb-2">
          {wsStatus === 'connected' ? (
            <div className="flex items-center text-green-500">
              <Wifi className="w-4 h-4 mr-1" />
              <span className="text-xs">Connected</span>
            </div>
          ) : (
            <div className="flex items-center text-orange-500">
              <WifiOff className="w-4 h-4 mr-1" />
              <span className="text-xs">
                {wsStatus === 'offline' ? 'Offline' :
                 wsStatus === 'error' ? 'Connection Error' : 
                 reconnectAttempts.current > 0 ? `Reconnecting (${reconnectAttempts.current}/${MAX_RECONNECT_ATTEMPTS})` : 'Disconnected'}
              </span>
            </div>
          )}
        </div>

        <button 
          className="w-full bg-[#12121f] text-emerald-400 p-3 rounded-lg mb-6 
                     transition-all duration-200 ease-in-out
                     hover:bg-emerald-400 hover:text-[#12121f]
                     active:transform active:scale-95
                     focus:outline-none focus:ring-2 focus:ring-emerald-400 focus:ring-opacity-50"
          onClick={(e) => {
            e.preventDefault();
            openInBrowser('https://acehack4-0-backend.onrender.com/survey');
          }}
        >
          Complete the Survey (+1200 Aptos)
        </button>

        <div className="text-center mb-6">
          <div className="text-gray-400 mb-2">PENDING</div>
          <div className="text-4xl text-white mb-4">{pending.toFixed(1)}</div>
          <div className="flex justify-center items-center gap-2">
            <span className="text-gray-400">LVL 0</span>
            <button className="text-gray-400 flex items-center gap-1">
              BOOST <Info className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div className="mb-6">
          <div className="flex flex-col items-center mb-2">
            <span className="text-gray-400">Saved</span>
            <div className="flex items-center gap-1">
              <span className="text-2xl text-white">{saved.toFixed(2)}</span>
              <span className="text-gray-400">ComputeMesh</span>
              <Info className="w-4 h-4 text-gray-400" />
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex-1 h-2 bg-[#12121f] rounded-full overflow-hidden">
              <div 
                className="h-full bg-green-500 rounded-full" 
                style={{ width: `${progressPercentage}%` }} 
              />
            </div>
            <span className="text-gray-400 text-sm whitespace-nowrap">
              {time.toFixed(0)} mins
            </span>
          </div>
        </div>

        <div className="text-gray-400 text-sm">
          Don't turn off your PC to retain your Aptos
        </div>

        {/* Debugging logs - can be hidden in production
        <div className="mt-4 p-2 bg-black text-xs text-gray-400 max-h-20 overflow-y-auto">
          {logs.slice(-5).map((log, i) => (
            <div key={i}>{log}</div>
          ))}
        </div> */}
      </CardContent>
    </Card>
  );
}

export default MiningCard;