"use client"

import React, { useState, useEffect, useRef, useCallback } from "react"; // Ensure React is imported
import { useAuth } from "../App"; // Assuming App.js provides useAuth
import {
  MessageSquare,
  Plus,
  Settings,
  LogOut,
  ChevronDown,
  Moon,
  Sun,
  ExternalLink,
  Send,
  Trash2,
  Edit,
  Save,
  Loader2,
  Check,
  Menu,
  X, // Added for closing toast and sidebar
} from "lucide-react";

// --- CSS Styles Component ---
// Place this component inside your main component or import styles globally
const GlobalStyles = () => (
  <style jsx global>{`
    /* Thin scrollbar for Webkit browsers */
    .custom-scrollbar::-webkit-scrollbar {
      width: 6px;
      height: 6px;
    }
    .custom-scrollbar::-webkit-scrollbar-track {
      background: transparent;
    }
    .custom-scrollbar::-webkit-scrollbar-thumb {
      background-color: #ccc; /* Default light */
      border-radius: 10px;
      border: 2px solid transparent;
      background-clip: content-box;
    }
    .custom-scrollbar::-webkit-scrollbar-thumb:hover {
       background-color: #bbb; /* Default light hover */
     }
    .dark .custom-scrollbar::-webkit-scrollbar-thumb {
       background-color: #444; /* Dark */
    }
    .dark .custom-scrollbar::-webkit-scrollbar-thumb:hover {
      background-color: #555; /* Dark hover */
    }

    /* Simple scrollbar for Firefox */
    .custom-scrollbar {
      scrollbar-width: thin;
      scrollbar-color: #ccc transparent; /* Default light */
    }
    .dark .custom-scrollbar {
      scrollbar-color: #444 transparent; /* Dark */
    }

    /* Blink animation for cursor */
    @keyframes blink {
      0%, 100% { opacity: 1; }
      50% { opacity: 0; }
    }
    .animate-blink {
      animation: blink 1s step-end infinite;
      display: inline-block; /* Ensures visibility */
      vertical-align: bottom; /* Aligns with text */
      width: 2px; /* Make it thinner */
    }

    /* Fade-in for toasts */
    @keyframes fade-in {
        from { opacity: 0; transform: translateY(10px); }
        to { opacity: 1; transform: translateY(0); }
    }
    .animate-fade-in {
        animation: fade-in 0.3s ease-out forwards;
    }
  `}</style>
);
// --- End CSS Styles ---


// Toast Component
const Toast = ({ message, type = "info", onClose }) => {
  useEffect(() => {
    const timer = setTimeout(onClose, 5000);
    return () => clearTimeout(timer);
  }, [onClose]);

  const bgColor =
    type === "success"
      ? "bg-green-500"
      : type === "error"
      ? "bg-red-500"
      : "bg-[#7814E3]";

  return (
    <div
      className={`relative p-4 rounded-lg shadow-lg text-sm max-w-sm animate-fade-in ${bgColor} text-white`}
    >
      <div className="flex justify-between items-start">
        <span className="break-words whitespace-pre-wrap mr-2">{message}</span>
        <button onClick={onClose} className="text-white hover:text-gray-200 flex-shrink-0 -mt-1 -mr-1 p-1 rounded-full hover:bg-black/20">
          <X size={16} />
        </button>
      </div>
    </div>
  );
};

function Dashboard() {
  const { user, setUser } = useAuth();
  const walletAddress = user?.walletAddress || "0x005fe...0f372";
  const [selectedModel, setSelectedModel] = useState("tinyllama:1b");
  const [customModelUrl, setCustomModelUrl] = useState("");
  const [chatHistory, setChatHistory] = useState([]);
  const [activeChat, setActiveChat] = useState(null);
  const [messages, setMessages] = useState([]);
  const [inputValue, setInputValue] = useState("");
  const [isModelDropdownOpen, setIsModelDropdownOpen] = useState(false);
  const [isProfileDropdownOpen, setIsProfileDropdownOpen] = useState(false);
  const [darkMode, setDarkMode] = useState(false);
  const [isCustomUrlActive, setIsCustomUrlActive] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);
  const [editingChatId, setEditingChatId] = useState(null);
  const [editingTitle, setEditingTitle] = useState("");
  const [availableModels, setAvailableModels] = useState([]);
  const [isModelLoading, setIsModelLoading] = useState(false);
  const [downloadTasks, setDownloadTasks] = useState({});
  const [loadedModel, setLoadedModel] = useState(null);
  const [toasts, setToasts] = useState([]);
  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const abortControllerRef = useRef(null);

  // --- Utilities ---
  const generateHash = useCallback(() => "0x" + Math.random().toString(16).substr(2, 40), []);
  const generateNodeId = useCallback(() => "node_" + Math.random().toString(36).substr(2, 8), []);

  // --- Toast Management ---
  const addToast = useCallback((message, type = "info") => {
    const id = Date.now();
    setToasts((prev) => [...prev.slice(-4), { id, message, type }]);
  }, []);

  const removeToast = useCallback((id) => {
    setToasts((prev) => prev.filter((toast) => toast.id !== id));
  }, []);

  // --- Logout Handler ---
  const handleLogout = useCallback(() => {
    if (abortControllerRef.current) {
        abortControllerRef.current.abort("Logging out");
    }
    localStorage.removeItem("token");
    localStorage.removeItem("user");
    localStorage.removeItem("chatHistory");
    localStorage.removeItem("selectedModel");
    localStorage.removeItem("activeChatId");
    setUser(null);
    setChatHistory([]);
    setMessages([]);
    setActiveChat(null);
    setIsLoading(false);
    setIsStreaming(false);
    setToasts([]);
    addToast("Logged out successfully.", "info");
  }, [setUser, addToast]);


  // --- API Fetching ---
  const fetchModelsAndStatus = useCallback(async () => {
    let isMounted = true; // Track mount status for async operations
    try {
      const token = localStorage.getItem("token");
      if (!token) return;

      const response = await fetch("http://localhost:8000/v1/models/status", { // Backend URL
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!isMounted) return; // Don't update state if unmounted

      if (response.ok) {
        const data = await response.json();
        // Ensure data structure matches backend response
        setAvailableModels(data.data || data.available_models || []);
        setLoadedModel(data.loaded_model || data.loaded || null);
        setDownloadTasks(data.download_tasks || {});
      } else if (response.status === 401) {
        handleLogout();
      } else {
         console.error("Error fetching model status:", response.status, await response.text());
      }
    } catch (error) {
      if (isMounted) {
        console.error("Network error fetching model status:", error);
      }
    }
    // Cleanup function for the fetchModelsAndStatus useCallback
    return () => { isMounted = false; };
  }, [handleLogout]); // Include handleLogout

  // --- Effects ---

  // Initial Load Effect
  useEffect(() => {
    let isMounted = true; // Track mount status

    const loadInitialData = async () => {
        const savedTheme = localStorage.getItem("theme");
        if (isMounted) {
            if (savedTheme === "dark") setDarkMode(true);
            else if (savedTheme === "light") setDarkMode(false);
            else if (window.matchMedia("(prefers-color-scheme: dark)").matches) setDarkMode(true);
        }

        const savedHistory = localStorage.getItem("chatHistory");
        if (savedHistory && isMounted) {
          try {
            const parsedHistory = JSON.parse(savedHistory);
            setChatHistory(parsedHistory);
            const lastActiveChatId = localStorage.getItem("activeChatId");
            const chatToLoad = lastActiveChatId ? parsedHistory.find(c => c.id === parseInt(lastActiveChatId)) : parsedHistory[0];
            if (chatToLoad) {
              setActiveChat(chatToLoad.id);
              setMessages(chatToLoad.messages || []);
            } else if (parsedHistory.length > 0) {
              setActiveChat(parsedHistory[0].id);
              setMessages(parsedHistory[0].messages || []);
            }
          } catch (error) {
            console.error("Error parsing chat history:", error);
            localStorage.removeItem("chatHistory");
            localStorage.removeItem("activeChatId");
          }
        }

        const savedModel = localStorage.getItem("selectedModel");
        if (savedModel && isMounted) {
          setSelectedModel(savedModel);
          if (savedModel.startsWith("Custom:")) {
            setIsCustomUrlActive(true);
            setCustomModelUrl(savedModel.replace("Custom: ", ""));
          }
        }

        // Initial fetch
        await fetchModelsAndStatus();
    };

    loadInitialData();

    // Setup interval
    const statusInterval = setInterval(fetchModelsAndStatus, 15000);

    // Cleanup function
    return () => {
      isMounted = false; // Set mount status to false
      clearInterval(statusInterval);
      if (abortControllerRef.current) {
        abortControllerRef.current.abort("Component unmounting");
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Run only on mount

  // Theme Persistence Effect
  useEffect(() => {
    localStorage.setItem("theme", darkMode ? "dark" : "light");
    document.documentElement.classList.toggle("dark", darkMode);
  }, [darkMode]);

  // Chat History Persistence Effect
  useEffect(() => {
    // Save history only if it has content or was previously saved
    if (chatHistory.length > 0 || localStorage.getItem("chatHistory")) {
      localStorage.setItem("chatHistory", JSON.stringify(chatHistory));
    } else {
      // If history becomes empty and wasn't previously saved, remove the key
      localStorage.removeItem("chatHistory");
    }
    // Save active chat ID
    if (activeChat !== null) {
      localStorage.setItem("activeChatId", activeChat.toString());
    } else {
      localStorage.removeItem("activeChatId");
    }
  }, [chatHistory, activeChat]);

  // Selected Model Persistence Effect
  useEffect(() => {
    localStorage.setItem("selectedModel", selectedModel);
  }, [selectedModel]);

  // Scroll to Bottom Effect
  const scrollToBottom = useCallback(() => {
    // Use requestAnimationFrame for smoother scroll after render
    requestAnimationFrame(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
    });
  }, []);

  useEffect(() => {
    // Trigger scroll after messages update or streaming state changes
    const timer = setTimeout(scrollToBottom, 100);
    return () => clearTimeout(timer);
  }, [messages, isStreaming, scrollToBottom]);

  // Textarea Height Adjustment Effect
  useEffect(() => {
    const adjustTextareaHeight = (element) => {
        if (element) {
            element.style.height = 'auto';
            const scrollHeight = element.scrollHeight;
            // Adjust based on scroll height, limit to max height
            element.style.height = `${Math.min(scrollHeight, 150)}px`;
        }
    };
    adjustTextareaHeight(inputRef.current);
  }, [inputValue]);

  // --- Chat Management ---

  const abortCurrentStream = useCallback((reason = "New action initiated") => {
      if (abortControllerRef.current) {
          console.log("Aborting current fetch stream:", reason);
          abortControllerRef.current.abort(reason);
          abortControllerRef.current = null;
          setIsLoading(false); // Ensure indicators are reset
          setIsStreaming(false);
      }
  }, []); // No dependencies needed

  const createNewChat = useCallback(() => {
    abortCurrentStream("Creating new chat");
    const newChat = {
      id: Date.now(),
      title: "New Chat",
      date: new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }),
      messages: [],
    };
    setChatHistory(prev => [newChat, ...prev]);
    setActiveChat(newChat.id);
    setMessages([]);
    setTimeout(() => inputRef.current?.focus(), 100);
  }, [abortCurrentStream]);

  const loadChat = useCallback((chatId) => {
    if (chatId === activeChat) return;
    abortCurrentStream(`Loading chat ${chatId}`);
    const chat = chatHistory.find((c) => c.id === chatId);
    if (chat) {
      setActiveChat(chatId);
      setMessages(chat.messages || []);
      setIsProfileDropdownOpen(false);
      setIsModelDropdownOpen(false);
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [activeChat, chatHistory, abortCurrentStream]);

  const deleteChat = useCallback((chatId, e) => {
    e.stopPropagation();
    const chatToDelete = chatHistory.find(c => c.id === chatId);
    if (!chatToDelete) return;

    // Optional: Confirm deletion
    // if (!window.confirm(`Delete chat "${chatToDelete.title}"?`)) return;

    const updatedHistory = chatHistory.filter((chat) => chat.id !== chatId);
    setChatHistory(updatedHistory);

    if (activeChat === chatId) {
      abortCurrentStream(`Deleting active chat ${chatId}`);
      if (updatedHistory.length > 0) {
        // Load the first chat in the updated list
        setActiveChat(updatedHistory[0].id);
        setMessages(updatedHistory[0].messages || []);
      } else {
        // No chats left
        setActiveChat(null);
        setMessages([]);
      }
    }
    addToast("Chat deleted.", "info");
  }, [activeChat, chatHistory, abortCurrentStream, addToast]);

  const startEditingChatTitle = useCallback((chatId, currentTitle, e) => {
    e.stopPropagation();
    setEditingChatId(chatId);
    setEditingTitle(currentTitle);
  }, []);

  const saveEditedChatTitle = useCallback((chatId, e) => {
    e.stopPropagation();
    const trimmedTitle = editingTitle.trim();
    if (trimmedTitle) {
      setChatHistory(prev => prev.map(chat =>
        chat.id === chatId ? { ...chat, title: trimmedTitle } : chat
      ));
      addToast("Chat renamed.", "success");
    }
    setEditingChatId(null);
    setEditingTitle("");
  }, [editingTitle, addToast]);

   const clearAllChats = useCallback(() => {
    if (window.confirm("Are you sure you want to clear all chats? This cannot be undone.")) {
      abortCurrentStream("Clearing all chats");
      setChatHistory([]);
      setMessages([]);
      setActiveChat(null);
      // Local storage removal will happen in the history persistence effect
      addToast("All chats cleared.", "info");
    }
  }, [abortCurrentStream, addToast]);

  // --- Model Management ---
  const pullAndUseModel = useCallback(async (modelUrlOrId) => {
    setIsModelLoading(true);
    addToast(`Attempting to download model: ${modelUrlOrId}`, "info");
    let isMounted = true;
    try {
      const token = localStorage.getItem("token");
      if (!token) throw new Error("No authentication token found");

      const response = await fetch("http://localhost:8000/v1/models/pull", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ model: modelUrlOrId }),
      });

      if (!isMounted) return;

      if (!response.ok) {
        if (response.status === 401) {
          handleLogout(); // Logout handled centrally
          // Error will be thrown and caught below
        }
        const errorData = await response.json().catch(() => ({ detail: "Unknown pull error" }));
        throw new Error(`Failed to pull model: ${errorData.detail || response.statusText}`);
      }

      const pullData = await response.json();
      // Adapt key based on actual backend response structure
      const modelId = pullData?.model_id || pullData?.task?.id || modelUrlOrId;
      addToast(`Model download started: ${modelId}. Status will update.`, "success");
      setSelectedModel(modelId); // Update selection
      setIsCustomUrlActive(false);
      setIsModelDropdownOpen(false);

      // Trigger status refresh after a short delay
      await new Promise(resolve => setTimeout(resolve, 2000));
      if (isMounted) {
          await fetchModelsAndStatus();
      }

    } catch (error) {
        if (isMounted) {
            console.error("Error pulling model:", error);
            addToast(`Failed to start download: ${error.message}`, "error");
        }
    } finally {
      if (isMounted) {
          setIsModelLoading(false);
      }
    }
    return () => { isMounted = false; }; // Cleanup for the async operation
  }, [addToast, handleLogout, fetchModelsAndStatus]); // Added fetchModelsAndStatus dependency


  const handleCustomUrlSubmit = useCallback(async (e) => {
    e.preventDefault();
    if (customModelUrl.trim()) {
      await pullAndUseModel(customModelUrl);
    }
  }, [customModelUrl, pullAndUseModel]);

  const getDownloadProgress = useCallback((taskId) => {
    const task = downloadTasks[taskId];
    if (!task) return null;
    const item = task.items?.[0];
    if (!item) return null;
    if (item.bytes && item.downloadedBytes) {
      return Math.round((item.downloadedBytes / item.bytes) * 100);
    }
    return null;
  }, [downloadTasks]);

  // --- Send Message (Streaming Logic) ---
  const sendMessage = useCallback(async () => {
    const currentInputValue = inputValue.trim();
    if (!currentInputValue || isLoading || isStreaming) return;

    abortCurrentStream("Sending new message");
    const controller = new AbortController();
    abortControllerRef.current = controller; // Assign new controller
    const signal = controller.signal;

    const queryHash = generateHash();
    const userMessage = {
      id: Date.now(),
      role: "user",
      content: currentInputValue,
      timestamp: new Date().toISOString(),
      queryHash,
    };
    setInputValue(""); // Clear input immediately
    setIsLoading(true); // Show loading dots

    const assistantMessageId = Date.now() + 1;
    const placeholderAssistantMessage = {
      id: assistantMessageId,
      role: "assistant",
      content: "",
      timestamp: new Date().toISOString(),
      nodeId: null,
      responseHash: null,
      isError: false, // Add isError flag
    };

    const currentChatId = activeChat; // Capture active chat ID
    const isFirstMessageInChat = messages.length === 0;

    // Update UI immediately
    const tempMessages = [...messages, userMessage, placeholderAssistantMessage];
    setMessages(tempMessages);

    // Prepare messages for API
    const messagesForApi = [
      { role: "system", content: "You are a helpful AI assistant." },
      ...messages.map((msg) => ({ role: msg.role, content: msg.content })),
      { role: userMessage.role, content: userMessage.content },
    ];

    // --- Optimistic History Update ---
    // Update history immediately with user message and placeholder
    const chatTitle = isFirstMessageInChat
        ? currentInputValue.substring(0, 30) + (currentInputValue.length > 30 ? "..." : "")
        : chatHistory.find(c => c.id === currentChatId)?.title || "Chat"; // Use existing title

    let tempChatId = currentChatId; // Temporary variable for chat ID

    if (tempChatId) {
        setChatHistory(prev => prev.map(chat =>
            chat.id === tempChatId ? { ...chat, title: chatTitle, messages: tempMessages } : chat
        ));
    } else {
         // Create a new chat if none is active (should align with createNewChat logic)
        const newChatId = Date.now();
        tempChatId = newChatId; // Update tempChatId
        const newChat = {
            id: newChatId, title: chatTitle, messages: tempMessages,
            date: new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
        };
        setChatHistory(prev => [newChat, ...prev]);
        setActiveChat(newChatId); // Set the new chat as active
    }
    // --- End Optimistic History Update ---


    try {
      const token = localStorage.getItem("token");
      if (!token) throw new Error("No authentication token found");

      addToast(`Query recorded\nHash: ${queryHash.substring(0,10)}...`, "success");

      const response = await fetch("http://localhost:8000/v1/chat/completions", { // Backend URL
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          model: selectedModel,
          messages: messagesForApi,
          stream: true,
          max_tokens: 1024,
          temperature: 0.7,
          top_p: 0.9,
        }),
        signal,
      });

      if (!response.ok) {
        // Handle non-OK status codes before trying to read the stream
        if (response.status === 401) {
           handleLogout(); // Central logout
        }
        const errorData = await response.json().catch(() => ({ detail: `API error ${response.status}` }));
        throw new Error(errorData.detail || `API request failed with status ${response.status}`);
      }

      if (!response.body) throw new Error("ReadableStream not available");

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let accumulatedContent = "";
      let doneReading = false;

      while (!doneReading) {
        if (signal.aborted) throw new Error("Request cancelled"); // Check before read

        const { value, done } = await reader.read();
        if (done) {
          doneReading = true;
          break;
        }

        if (!isStreaming && !isLoading) setIsLoading(true); // Re-ensure loading state if needed
        if (isLoading) setIsLoading(false); // Turn off dots once first chunk arrives
        if (!isStreaming) setIsStreaming(true); // Set streaming true

        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split("\n\n");

        for (const line of lines) {
          if (line.startsWith("data: ")) {
            const jsonString = line.substring(6).trim();
            if (jsonString === "[DONE]") {
              doneReading = true; // Treat [DONE] marker as end of stream data
              break;
            }
            if (jsonString) {
              try {
                const parsed = JSON.parse(jsonString);
                if (parsed.error) {
                  console.error("Error streamed from backend:", parsed.error);
                  accumulatedContent += `\n\n[Error: ${parsed.error.message || 'Unknown stream error'}]`;
                  // Update UI with error mark
                  setMessages(prev => prev.map(msg =>
                      msg.id === assistantMessageId ? { ...msg, content: accumulatedContent, isError: true } : msg
                  ));
                  continue; // Continue processing other lines/chunks
                }
                const deltaContent = parsed.choices?.[0]?.delta?.content;
                if (deltaContent) {
                  accumulatedContent += deltaContent;
                  // Update placeholder content in real-time
                  setMessages(prev => prev.map(msg =>
                    msg.id === assistantMessageId ? { ...msg, content: accumulatedContent, isError: false } : msg // Ensure error flag is false
                  ));
                }
              } catch (e) {
                console.error("Failed to parse stream chunk JSON:", jsonString, e);
              }
            }
          }
        }
        if (doneReading) break; // Break outer loop if [DONE] was encountered
      } // End while loop

      // --- Stream Finished Successfully ---
      console.log("Stream finished successfully.");
      setIsStreaming(false);

      const finalNodeId = generateNodeId();
      const finalResponseHash = generateHash();

      // *** Create the final, complete message object ***
      const finalAssistantMessage = {
        id: assistantMessageId,
        role: "assistant",
        content: accumulatedContent.trim() || "...", // Use accumulated content
        timestamp: new Date().toISOString(),
        nodeId: finalNodeId,
        responseHash: finalResponseHash,
        isError: false, // Final state is not an error
      };

      // *** Update messages state with the FINAL message ***
      setMessages(prevMessages =>
        prevMessages.map(msg =>
          msg.id === assistantMessageId ? finalAssistantMessage : msg
        )
      );

      // *** Update history with the FINAL message ***
      if (tempChatId) {
        setChatHistory(prevHistory =>
          prevHistory.map(chat => {
            if (chat.id === tempChatId) {
              // Make sure to map using the final message object
              const finalChatMessages = chat.messages.map(m =>
                m.id === assistantMessageId ? finalAssistantMessage : m
              );
              return { ...chat, messages: finalChatMessages };
            }
            return chat;
          })
        );
      }

      // Show success toasts
      addToast(`Response recorded\nHash: ${finalResponseHash.substring(0,10)}...`, "success");
      setTimeout(() => {
        const providerAddress = "0x" + Math.random().toString(16).substr(2, 40);
        addToast(`Transaction simulated\nTo: ${providerAddress.substring(0,10)}...`, "success");
      }, 1500);

    } catch (error) {
      // Error Handling Block
      if (error.name === 'AbortError' || error.message === 'Request cancelled') {
        console.log('Stream fetch aborted by user action.');
        addToast("Request cancelled", "info");
        // Leave potentially partial message in state, maybe mark as cancelled
        setMessages(prev => prev.map(msg => msg.id === assistantMessageId ? {...msg, content: msg.content + "\n[Cancelled]"} : msg));
        // History will have the partial message from optimistic update
      } else {
        // Handle other errors (network, API errors, parsing errors)
        console.error("Error sending message or processing stream:", error);
        const errorMessageContent = error.message.includes("401")
          ? "Session expired. Please log in again."
          : `Sorry, an error occurred: ${error.message || "Unknown error"}`;

        const errorAssistantMessage = {
          id: assistantMessageId,
          role: "assistant",
          content: errorMessageContent,
          timestamp: new Date().toISOString(),
          isError: true,
          nodeId: null, // No node/hash for errors
          responseHash: null,
        };

        // Update UI with error message
        setMessages(prev => prev.map(msg => msg.id === assistantMessageId ? errorAssistantMessage : msg));

        // Update history with error message
        if (tempChatId) {
           setChatHistory(prevHistory => prevHistory.map(chat => {
                if (chat.id === tempChatId) {
                     const finalChatMessages = chat.messages.map(m =>
                         m.id === assistantMessageId ? errorAssistantMessage : m
                     );
                    return { ...chat, messages: finalChatMessages };
                }
                return chat;
            }));
        }

        addToast(`Error: ${error.message}`, "error");
        if (error.message.includes("401")) {
           setTimeout(handleLogout, 1000);
        }
      }
    } finally {
      // Cleanup regardless of success or failure (unless already aborted)
      if (abortControllerRef.current === controller) { // Check if it's still the same controller
        setIsLoading(false);
        setIsStreaming(false);
        abortControllerRef.current = null; // Clear the controller ref
      }
      inputRef.current?.focus();
    }
  }, [inputValue, isLoading, isStreaming, messages, selectedModel, activeChat, chatHistory, generateHash, generateNodeId, addToast, handleLogout, abortCurrentStream]); // Added dependencies


  const handleKeyDown = useCallback((e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  }, [sendMessage]); // Dependency on sendMessage

  const toggleTheme = useCallback(() => {
    setDarkMode(prev => !prev);
  }, []);

  const navigateToHuggingFace = useCallback(() => {
    window.open("https://huggingface.co/models", "_blank");
  }, []);

  // --- JSX ---
  return (
    <>
      <GlobalStyles /> {/* Include global styles */}
      <div className={`flex min-h-screen flex-col md:flex-row ${darkMode ? "dark bg-[#161616]" : "bg-gray-50"} transition-colors duration-300`}>
        {/* Sidebar */}
        <div className={`fixed inset-y-0 left-0 z-30 w-64 transform ${sidebarOpen ? "translate-x-0" : "-translate-x-full"} ${darkMode ? "bg-[#111111]" : "bg-[#ebeaea] border-r border-gray-200/80"} flex flex-col transition-transform duration-300 ease-in-out md:relative md:translate-x-0 md:flex shrink-0`}>
            {/* Sidebar Header */}
            <div className="p-4 border-b border-black/10 dark:border-white/10 flex justify-between items-center h-[65px] shrink-0">
                <div className="text-xl font-semibold flex items-center">
                    <span className={`${darkMode ? "text-white" : "text-gray-800"}`}>ComputeMesh</span>
                    <span className="text-[#7814E3] ml-1">AI</span>
                </div>
                <button onClick={() => setSidebarOpen(false)} className={`p-1 rounded md:hidden ${darkMode ? "text-gray-400 hover:bg-[#222222]" : "text-gray-600 hover:bg-gray-200"}`} title="Close sidebar">
                    <X className="w-5 h-5" />
                </button>
            </div>
             {/* New Chat Button */}
            <div className="px-4 pt-4 pb-2 shrink-0">
                <button className={`flex items-center justify-center w-full p-3 ${darkMode ? "bg-[#7814E3] hover:bg-[#6a11cc]" : "bg-[#7814E3] hover:bg-[#6a11cc]"} bg-opacity-90 rounded-md text-white font-medium transition-all shadow-sm active:scale-95`} onClick={createNewChat}>
                    <Plus className="w-4 h-4 mr-2" /> New chat
                </button>
            </div>
             {/* Chat History List */}
             <div className="flex-1 overflow-y-auto px-3 custom-scrollbar">
                <div className="py-3 text-sm flex justify-between items-center sticky top-0 z-10" style={{ backgroundColor: darkMode ? '#111111' : '#ebeaea' }}>
                    <span className={`${darkMode ? "text-gray-400" : "text-gray-600"}`}>Recent chats</span>
                    {chatHistory.length > 0 && (
                        <button onClick={clearAllChats} className={`p-1 rounded ${darkMode ? "text-gray-500 hover:text-red-400 hover:bg-[#222222]" : "text-gray-600 hover:text-red-500 hover:bg-gray-200"} transition-colors`} title="Clear all chats">
                            <Trash2 className="w-3 h-3" />
                        </button>
                    )}
                </div>
                <div className="space-y-1 pb-2">
                    {/* Chat History Items */}
                     {chatHistory.length === 0 ? (
                        <div className={`text-center py-6 ${darkMode ? "text-gray-500" : "text-gray-400"} text-xs`}> Start a new chat. </div>
                    ) : (
                        chatHistory.map((chat) => (
                             <div key={chat.id} className={`flex items-center p-3 w-full text-left rounded-lg transition-all cursor-pointer ${ chat.id === activeChat ? (darkMode ? "bg-[#222222] text-white" : "bg-gray-300 text-gray-900") : (darkMode ? "text-gray-300 hover:bg-[#1A1A1A]" : "text-gray-700 hover:bg-gray-100") } group relative`} onClick={() => loadChat(chat.id)}>
                                <MessageSquare className={`w-4 h-4 mr-3 shrink-0 ${chat.id === activeChat ? "text-[#7814E3]" : (darkMode ? "text-gray-400" : "text-gray-500")}`} />
                                <div className="truncate flex-1 min-w-0">
                                    {editingChatId === chat.id ? (
                                        <div onClick={(e) => e.stopPropagation()} className="flex items-center space-x-1">
                                            <input type="text" value={editingTitle} onChange={(e) => setEditingTitle(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') saveEditedChatTitle(chat.id, e); if (e.key === 'Escape') { setEditingChatId(null); setEditingTitle(''); }}} className={`w-full ${darkMode ? "bg-[#333333] text-white" : "bg-white text-gray-900"} text-sm rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-[#7814E3]`} autoFocus />
                                            <button onClick={(e) => saveEditedChatTitle(chat.id, e)} className="text-[#7814E3] p-1 hover:bg-opacity-20 hover:bg-purple-500 rounded" title="Save title"> <Save className="w-3 h-3" /> </button>
                                        </div>
                                    ) : ( <> <div className="truncate text-sm font-medium">{chat.title}</div> <div className={`text-xs ${darkMode ? "text-gray-500" : "text-gray-500"}`}>{chat.date}</div> </> )}
                                </div>
                                {!editingChatId && (
                                    <div className="absolute right-1 top-1/2 transform -translate-y-1/2 flex space-x-1 opacity-0 group-hover:opacity-100 transition-opacity bg-inherit pl-1">
                                        <button onClick={(e) => startEditingChatTitle(chat.id, chat.title, e)} className={`${darkMode ? "text-gray-400 hover:text-white hover:bg-[#2a2a2a]" : "text-gray-500 hover:text-gray-800 hover:bg-gray-200"} p-1 rounded`} title="Rename"> <Edit className="w-3 h-3" /> </button>
                                        <button onClick={(e) => deleteChat(chat.id, e)} className={`${darkMode ? "text-gray-400 hover:text-red-400 hover:bg-[#2a2a2a]" : "text-gray-500 hover:text-red-500 hover:bg-gray-200"} p-1 rounded`} title="Delete"> <Trash2 className="w-3 h-3" /> </button>
                                    </div>
                                )}
                            </div>
                        ))
                    )}
                </div>
            </div>
             {/* Footer Wallet Info */}
            <div className={`p-4 border-t ${darkMode ? "border-black/10" : "border-gray-300/80"} mt-auto shrink-0`}>
                <div className={`flex items-center p-2 rounded-md text-sm ${darkMode ? "bg-[#1A1A1A]" : "bg-gray-200"}`}>
                    <span className={`${darkMode ? "text-gray-400" : "text-gray-600"} mr-2 text-xs`}>Wallet:</span>
                    <span className={`${darkMode ? "text-gray-200" : "text-gray-800"} truncate text-xs font-mono`}> {walletAddress} </span>
                </div>
            </div>
        </div>

        {/* Main Content */}
        <div className={`flex-1 flex flex-col h-screen overflow-hidden`}>
             {/* Header */}
            <header className={`sticky top-0 z-20 w-full ${darkMode ? "bg-[#111111] border-black/10" : "bg-[#f3f4f6] border-gray-200/80"} border-b py-3 px-4 sm:px-6 flex items-center justify-between transition-colors duration-300 h-[65px] shrink-0`}>
                {/* Left Side: Hamburger & Model Selector */}
                 <div className="flex items-center space-x-2 flex-1 min-w-0">
                    {!sidebarOpen && ( <button onClick={() => setSidebarOpen(true)} className={`p-2 rounded md:hidden ${darkMode ? "bg-[#222222] text-white" : "bg-gray-200 text-gray-800"}`} title="Open sidebar"> <Menu className="w-5 h-5" /> </button> )}
                     {/* Model Selector */}
                    <div className="relative flex-1 min-w-0 max-w-xs sm:max-w-sm md:max-w-md">
                        <button className={`flex items-center justify-between w-full text-sm font-medium min-w-0 ${darkMode ? "bg-[#1A1A1A] hover:bg-[#222222] text-white" : "bg-[#e9eaec] hover:bg-gray-200 text-gray-700"} rounded-md px-3 py-2 transition-colors duration-200`} onClick={() => setIsModelDropdownOpen(!isModelDropdownOpen)} disabled={isModelLoading}>
                            {isModelLoading ? ( /* Loading */ <div className="flex items-center space-x-2 w-full min-w-0"> <Loader2 className="w-4 h-4 animate-spin text-[#7814E3] flex-shrink-0" /> <span className="flex-1 min-w-0 overflow-hidden"><span className="block truncate"> Loading... {selectedModel && <span className="ml-1 text-xs text-[#7814E3]">({selectedModel.split(':')[0]})</span>}</span></span> </div>
                            ) : ( /* Model Name */ <div className="flex items-center space-x-2 w-full min-w-0"> <span className="flex-1 min-w-0 overflow-hidden"><span className="block truncate"> {selectedModel || "Select model"} {loadedModel === selectedModel && <Check className="w-3 h-3 inline-block ml-1 text-green-500" />}</span></span> <ChevronDown className="w-4 h-4 flex-shrink-0" /> </div> )}
                        </button>
                         {/* Model Dropdown */}
                         {isModelDropdownOpen && ( <div className={`absolute top-full left-0 mt-2 w-full sm:w-80 ${darkMode ? "bg-[#1A1A1A] border-[#222222]" : "bg-white border-gray-200/80"} rounded-lg shadow-lg border z-30 transition-colors duration-300 max-h-96 overflow-y-auto custom-scrollbar`}> <div className="py-2">
                             {/* Available Models */}
                             {availableModels.map((model) => {
                                const modelId = model.id || model.name;
                                const taskId = model.task_id;
                                const progress = taskId ? getDownloadProgress(taskId) : null;
                                const isDownloading = taskId && progress !== null && progress < 100;
                                const isSelected = selectedModel === modelId;
                                const isLoaded = loadedModel === modelId;
                                return (<button key={modelId} className={`w-full text-left px-4 py-2 ${darkMode ? "hover:bg-[#222222] text-gray-200" : "hover:bg-gray-100 text-gray-700"} text-sm transition-colors duration-200 relative ${isSelected ? (darkMode ? "bg-[#252525]" : "bg-gray-200") : ""} ${isDownloading ? "cursor-not-allowed opacity-60" : ""}`} onClick={() => { if (!isDownloading) { setSelectedModel(modelId); setIsCustomUrlActive(false); setIsModelDropdownOpen(false); } }} disabled={isDownloading}>
                                     <div className="flex justify-between items-center"> <span className="truncate pr-2">{modelId}</span> {isLoaded && <Check className="w-4 h-4 text-green-500 flex-shrink-0" />} </div>
                                     {isDownloading && (<div className="absolute inset-0 bg-black bg-opacity-60 flex items-center justify-center text-white text-xs rounded-md"> Downloading {progress !== null ? `${progress}%` : '...'} </div>)}
                                </button>);
                             })}
                             <div className={`border-t ${darkMode ? "border-white/10" : "border-gray-200/80"} my-2`}></div>
                             {/* Custom Model Input */}
                             <div className="px-4 py-3">
                                <div className="flex justify-between items-center mb-2"> <span className={`text-sm ${darkMode ? "text-gray-300" : "text-gray-700"}`}>Custom Model</span> <button className="text-xs text-[#7814E3] hover:underline flex items-center" onClick={navigateToHuggingFace}> Browse HF <ExternalLink className="w-3 h-3 ml-1" /> </button> </div>
                                <form onSubmit={handleCustomUrlSubmit} className="flex items-center space-x-2">
                                    <input type="text" value={customModelUrl} onChange={(e) => setCustomModelUrl(e.target.value)} placeholder="org/model-name:tag" className={`flex-1 text-sm p-2 rounded-md ${darkMode ? "bg-[#2A2A2A] border-[#333333] text-white placeholder-gray-400" : "bg-white border-gray-300/80 text-gray-900 placeholder-gray-500"} border focus:outline-none focus:ring-1 focus:ring-[#7814E3]`} />
                                    <button type="submit" className="bg-[#7814E3] hover:bg-[#6a11cc] text-white font-medium text-xs py-2 px-3 rounded-md shadow-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed active:scale-95" disabled={isModelLoading || !customModelUrl.trim()}> {isModelLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : "Use"} </button>
                                </form>
                            </div>
                        </div> </div> )}
                    </div>
                </div>
                 {/* Right Side: Theme Toggle & Profile */}
                <div className="flex items-center space-x-3 pl-4">
                    <button onClick={toggleTheme} className={`p-2 rounded-md ${darkMode ? "bg-[#1A1A1A] hover:bg-[#222222]" : "bg-[#e9eaec] hover:bg-gray-200"} transition-colors duration-200`} title={darkMode ? "Switch to light mode" : "Switch to dark mode"}>
                        {darkMode ? <Sun className="w-5 h-5 text-yellow-400" /> : <Moon className="w-5 h-5 text-gray-700" />}
                    </button>
                     {/* Profile Dropdown */}
                    <div className="relative">
                        <button className="flex items-center space-x-2 rounded-full transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-[#7814E3] focus:ring-offset-gray-800 dark:focus:ring-offset-gray-900" onClick={() => setIsProfileDropdownOpen(!isProfileDropdownOpen)}>
                            <div className="w-8 h-8 rounded-full bg-[#7814E3] flex items-center justify-center text-white text-sm font-medium shadow-sm ring-1 ring-black ring-opacity-5"> {user?.name?.charAt(0).toUpperCase() || user?.email?.charAt(0).toUpperCase() || "U"} </div>
                        </button>
                        {isProfileDropdownOpen && ( <div className={`absolute top-full right-0 mt-2 w-56 ${darkMode ? "bg-[#1A1A1A] border-[#222222]" : "bg-white border-gray-200/80"} rounded-lg shadow-lg border z-30 transition-colors duration-300`}>
                            <div className={`p-3 border-b ${darkMode ? "border-white/10" : "border-gray-200/80"}`}> <div className={`font-medium text-sm ${darkMode ? "text-white" : "text-gray-900"} truncate`}>{user?.name || "User Name"}</div> <div className={`text-xs ${darkMode ? "text-gray-400" : "text-gray-500"} truncate`}>{user?.email || "user@example.com"}</div> </div>
                            <div className="py-2"> <button className={`flex items-center w-full text-left px-4 py-2 ${darkMode ? "hover:bg-[#222222] text-gray-300" : "hover:bg-gray-100 text-gray-700"} text-sm transition-colors duration-200`}> <Settings className="w-4 h-4 mr-2" /> Settings </button> <button className={`flex items-center w-full text-left px-4 py-2 ${darkMode ? "hover:bg-[#222222] text-gray-300" : "hover:bg-gray-100 text-gray-700"} text-sm transition-colors duration-200`} onClick={handleLogout}> <LogOut className="w-4 h-4 mr-2" /> Log out </button> </div>
                        </div> )}
                    </div>
                </div>
            </header>

             {/* Chat Content Area */}
            <div className={`flex-1 overflow-y-auto px-4 sm:px-6 py-4 ${darkMode ? "bg-[#161616]" : "bg-gray-50"} transition-colors duration-300 custom-scrollbar`}>
                {/* Welcome / Empty State */}
                 {(messages.length === 0 && !activeChat) ? (<div className="h-full flex flex-col items-center justify-center text-center"> <img src="/ComputeMeshLogo_Purple.png" alt="Logo" className="w-24 h-24 mb-4" /> <h1 className={`text-2xl sm:text-3xl font-bold ${darkMode ? "text-white" : "text-gray-900"} mb-2`}> ComputeMesh AI </h1> <p className={`${darkMode ? "text-gray-400" : "text-gray-600"} text-sm sm:text-base max-w-md`}> How can I help you today? </p> </div>
                ) : (messages.length === 0 && activeChat) ? (<div className="h-full flex flex-col items-center justify-center text-center"> <MessageSquare className={`w-16 h-16 mb-4 ${darkMode ? "text-gray-600" : "text-gray-400"}`} /> <p className={`${darkMode ? "text-gray-400" : "text-gray-600"} text-sm sm:text-base max-w-md`}> Send a message to start. </p> </div>
                ) : (
                    /* Display messages */
                    <div className="max-w-3xl mx-auto space-y-6 pb-4 w-full">
                        {messages.map((message, index) => (
                            <div key={message.id || index} className={`flex ${message.role === "user" ? "justify-end" : "justify-start"}`}>
                                <div className={`max-w-[90%] sm:max-w-[80%] rounded-xl px-4 sm:px-5 py-3 shadow-sm ${ message.role === "user" ? `${darkMode ? "bg-[#7814E3] text-white" : "bg-[#7814E3] text-white"}` : message.isError ? `${darkMode ? "bg-red-800 bg-opacity-60 text-red-100" : "bg-red-100 text-red-700 border border-red-200/80"}` : `${darkMode ? "bg-[#222222] text-gray-100" : "bg-[#e9eaec] text-gray-800 border border-gray-200/80"}` }`}>
                                    <div className="whitespace-pre-wrap text-sm sm:text-base break-words">
                                        {message.content}
                                        {isStreaming && message.role === 'assistant' && index === messages.length - 1 && ( <span className="animate-blink h-4 bg-current ml-1"></span> )}
                                    </div>
                                    {/* Metadata */}
                                    {message.queryHash && ( <div className={`text-xs mt-2 ${darkMode ? "text-gray-400 opacity-70" : "text-gray-500 opacity-80"}`}> Query Hash: <span className="font-mono">{message.queryHash.substring(0,10)}...</span> </div> )}
                                    {message.responseHash && ( <div className={`text-xs mt-2 ${darkMode ? "text-gray-400 opacity-70" : "text-gray-500 opacity-80"}`}> Resp Hash: <span className="font-mono">{message.responseHash.substring(0,10)}...</span> | Node: <span className="font-mono">{message.nodeId}</span> </div> )}
                                </div>
                            </div>
                        ))}
                         {/* Loading indicator */}
                        {isLoading && !isStreaming && ( <div className="flex justify-start"> <div className={`max-w-[90%] sm:max-w-xl rounded-xl px-4 sm:px-5 py-4 ${darkMode ? "bg-[#222222] text-gray-100" : "bg-[#e9eaec] text-gray-800 border border-gray-200/80 shadow-sm"}`}> <div className="flex space-x-2 justify-center items-center h-5"> <div className="w-2 h-2 rounded-full bg-[#7814E3] animate-bounce"></div> <div className="w-2 h-2 rounded-full bg-[#7814E3] animate-bounce" style={{ animationDelay: "0.15s" }}></div> <div className="w-2 h-2 rounded-full bg-[#7814E3] animate-bounce" style={{ animationDelay: "0.3s" }}></div> </div> </div> </div> )}
                        <div ref={messagesEndRef} className="h-1" /> {/* Scroll target */}
                    </div>
                )}
            </div>

             {/* Input Area */}
            <div className={`sticky bottom-0 w-full z-10 ${darkMode ? "border-black/10 bg-[#111111]" : "border-gray-200/80 bg-[#f3f4f6]"} border-t px-4 sm:px-6 py-3 transition-colors duration-300 shrink-0`}>
                <div className="relative max-w-3xl mx-auto w-full">
                    <textarea ref={inputRef} value={inputValue} onChange={(e) => setInputValue(e.target.value)} onKeyDown={handleKeyDown} placeholder={ isStreaming ? "Waiting for response..." : "Message ComputeMesh..."} disabled={isLoading || isStreaming} rows={1} className={`w-full p-3 sm:p-4 pr-12 sm:pr-14 rounded-lg resize-none overflow-y-auto custom-scrollbar ${darkMode ? "bg-[#1A1A1A] border-[#222222] text-white placeholder-gray-400 focus:ring-[#7814E3]" : "bg-white border-gray-300/80 text-gray-900 placeholder-gray-500 focus:ring-[#7814E3]"} border focus:outline-none focus:ring-2 focus:border-transparent transition-all duration-200 shadow-sm text-sm sm:text-base disabled:opacity-70 disabled:cursor-not-allowed`} style={{ minHeight: "52px", maxHeight: "150px" }} />
                    <button onClick={sendMessage} disabled={!inputValue.trim() || isLoading || isStreaming} className={`absolute right-2 sm:right-3 bottom-2 sm:bottom-2.5 p-2 rounded-md ${!inputValue.trim() || isLoading || isStreaming ? "bg-gray-400 text-gray-200 cursor-not-allowed" : "bg-[#7814E3] hover:bg-[#6a11cc] shadow-sm text-white active:scale-90"} transition-all`} title="Send message">
                        {isLoading ? (<Loader2 className="w-4 sm:w-5 h-4 sm:h-5 animate-spin"/>) : (<Send className="w-4 sm:w-5 h-4 sm:h-5" />)}
                    </button>
                </div>
                <div className={`text-xs text-center mt-2 ${darkMode ? "text-gray-500" : "text-gray-400"} select-none`}> ComputeMesh AI may provide inaccurate information. Verify critical details. </div>
            </div>
        </div> {/* End Main Content */}

         {/* Toast Notifications Container */}
        <div className="fixed bottom-4 right-4 z-50 space-y-2 w-full max-w-sm"> {/* Position container */}
             {toasts.map((toast) => (
                <Toast key={toast.id} message={toast.message} type={toast.type} onClose={() => removeToast(toast.id)} />
             ))}
        </div>

    </div> {/* End Outer container */}
    </>
  );
}

export default Dashboard;