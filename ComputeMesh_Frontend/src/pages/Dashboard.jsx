"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";
import { useAuth } from "../App";
import {
  MessageSquare,
  Plus,
  Settings,
  LogOut,
  Moon,
  Sun,
  ExternalLink,
  Send,
  Trash2,
  Edit,
  Save,
  Loader2,
  Menu,
  X,
} from "lucide-react";

// --- Global CSS Styles ---
const GlobalStyles = () => (
  <style jsx global>{`
    .custom-scrollbar::-webkit-scrollbar {
      width: 6px;
      height: 6px;
    }
    .custom-scrollbar::-webkit-scrollbar-track {
      background: transparent;
    }
    .custom-scrollbar::-webkit-scrollbar-thumb {
      background-color: #d1d5db;
      border-radius: 10px;
      border: 2px solid transparent;
      background-clip: content-box;
    }
    .custom-scrollbar::-webkit-scrollbar-thumb:hover {
      background-color: #9ca3af;
    }
    .dark .custom-scrollbar::-webkit-scrollbar-thumb {
      background-color: #4b5563;
    }
    .dark .custom-scrollbar::-webkit-scrollbar-thumb:hover {
      background-color: #6b7280;
    }
    .custom-scrollbar {
      scrollbar-width: thin;
      scrollbar-color: #d1d5db transparent;
    }
    .dark .custom-scrollbar {
      scrollbar-color: #4b5563 transparent;
    }
    @keyframes blink {
      0%, 100% { opacity: 1; }
      50% { opacity: 0; }
    }
    .animate-blink {
      animation: blink 1s step-end infinite;
      display: inline-block;
      vertical-align: bottom;
      width: 2px;
    }
    @keyframes fade-in {
      from { opacity: 0; transform: translateY(10px); }
      to { opacity: 1; transform: translateY(0); }
    }
    .animate-fade-in {
      animation: fade-in 0.3s ease-out forwards;
    }
  `}</style>
);

// --- Toast Component ---
const Toast = ({ message, type = "info", onClose }) => {
  useEffect(() => {
    const timer = setTimeout(onClose, 5000);
    return () => clearTimeout(timer);
  }, [onClose]);

  const bgColor =
    type === "success"
      ? "bg-green-600"
      : type === "error"
      ? "bg-red-600"
      : "bg-purple-600";

  return (
    <div
      className={`relative p-4 rounded-lg shadow-lg text-sm max-w-sm animate-fade-in ${bgColor} text-white`}
    >
      <div className="flex justify-between items-start">
        <span className="break-words whitespace-pre-wrap mr-2">{message}</span>
        <button
          onClick={onClose}
          className="text-white hover:text-gray-200 flex-shrink-0 p-1 rounded-full hover:bg-black/20"
        >
          <X size={16} />
        </button>
      </div>
    </div>
  );
};

// --- Dashboard Component ---
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
  const [isLoading, setIsLoading] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);
  const [editingChatId, setEditingChatId] = useState(null);
  const [editingTitle, setEditingTitle] = useState("");
  const [isModelLoading, setIsModelLoading] = useState(false);
  const [toasts, setToasts] = useState([]);
  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);
  const [sidebarOpen, setSidebarOpen] = useState(window.innerWidth >= 768);
  const abortControllerRef = useRef(null);

  // --- Utilities ---
  const generateHash = useCallback(
    () => "0x" + Math.random().toString(16).substr(2, 40),
    []
  );
  const generateNodeId = useCallback(
    () => "node_" + Math.random().toString(36).substr(2, 8),
    []
  );

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
  const fetchModelStatus = useCallback(async () => {
    try {
      const token = localStorage.getItem("token");
      if (!token) return;

      const response = await fetch("http://localhost:8000/v1/models/status", {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (response.ok) {
        const data = await response.json();
        // Handle loaded model or other status if needed
      } else if (response.status === 401) {
        handleLogout();
      } else {
        console.error("Error fetching model status:", response.status);
      }
    } catch (error) {
      console.error("Network error fetching model status:", error);
    }
  }, [handleLogout]);

  // --- Effects ---
  useEffect(() => {
    const loadInitialData = async () => {
      const savedTheme = localStorage.getItem("theme");
      if (savedTheme === "dark") setDarkMode(true);
      else if (savedTheme === "light") setDarkMode(false);
      else if (window.matchMedia("(prefers-color-scheme: dark)").matches)
        setDarkMode(true);

      const savedHistory = localStorage.getItem("chatHistory");
      if (savedHistory) {
        try {
          const parsedHistory = JSON.parse(savedHistory);
          setChatHistory(parsedHistory);
          const lastActiveChatId = localStorage.getItem("activeChatId");
          const chatToLoad = lastActiveChatId
            ? parsedHistory.find((c) => c.id === parseInt(lastActiveChatId))
            : parsedHistory[0];
          if (chatToLoad) {
            setActiveChat(chatToLoad.id);
            setMessages(chatToLoad.messages || []);
          }
        } catch (error) {
          console.error("Error parsing chat history:", error);
          localStorage.removeItem("chatHistory");
          localStorage.removeItem("activeChatId");
        }
      }

      const savedModel = localStorage.getItem("selectedModel");
      if (savedModel) setSelectedModel(savedModel);

      await fetchModelStatus();
    };

    loadInitialData();

    const statusInterval = setInterval(fetchModelStatus, 15000);
    return () => {
      clearInterval(statusInterval);
      if (abortControllerRef.current) {
        abortControllerRef.current.abort("Component unmounting");
      }
    };
  }, [fetchModelStatus]);

  useEffect(() => {
    const handleResize = () => {
      if (window.innerWidth >= 768) {
        setSidebarOpen(true);
      }
    };
    
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  useEffect(() => {
    localStorage.setItem("theme", darkMode ? "dark" : "light");
    document.documentElement.classList.toggle("dark", darkMode);
  }, [darkMode]);

  useEffect(() => {
    if (chatHistory.length > 0 || localStorage.getItem("chatHistory")) {
      localStorage.setItem("chatHistory", JSON.stringify(chatHistory));
    } else {
      localStorage.removeItem("chatHistory");
    }
    if (activeChat !== null) {
      localStorage.setItem("activeChatId", activeChat.toString());
    } else {
      localStorage.removeItem("activeChatId");
    }
  }, [chatHistory, activeChat]);

  useEffect(() => {
    localStorage.setItem("selectedModel", selectedModel);
  }, [selectedModel]);

  const scrollToBottom = useCallback(() => {
    requestAnimationFrame(() => {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
    });
  }, []);

  useEffect(() => {
    const timer = setTimeout(scrollToBottom, 100);
    return () => clearTimeout(timer);
  }, [messages, isStreaming, scrollToBottom]);

  useEffect(() => {
    const adjustTextareaHeight = (element) => {
      if (element) {
        element.style.height = "auto";
        const scrollHeight = element.scrollHeight;
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
      setIsLoading(false);
      setIsStreaming(false);
    }
  }, []);

  const createNewChat = useCallback(() => {
    abortCurrentStream("Creating new chat");
    const newChat = {
      id: Date.now(),
      title: "New Chat",
      date: new Date().toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      }),
      messages: [],
    };
    setChatHistory((prev) => [newChat, ...prev]);
    setActiveChat(newChat.id);
    setMessages([]);
    setTimeout(() => inputRef.current?.focus(), 100);
  }, [abortCurrentStream]);

  const loadChat = useCallback(
    (chatId) => {
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
    },
    [activeChat, chatHistory, abortCurrentStream]
  );

  const deleteChat = useCallback(
    (chatId, e) => {
      e.stopPropagation();
      const updatedHistory = chatHistory.filter((chat) => chat.id !== chatId);
      setChatHistory(updatedHistory);

      if (activeChat === chatId) {
        abortCurrentStream(`Deleting active chat ${chatId}`);
        if (updatedHistory.length > 0) {
          setActiveChat(updatedHistory[0].id);
          setMessages(updatedHistory[0].messages || []);
        } else {
          setActiveChat(null);
          setMessages([]);
        }
      }
      addToast("Chat deleted.", "info");
    },
    [activeChat, chatHistory, abortCurrentStream, addToast]
  );

  const startEditingChatTitle = useCallback((chatId, currentTitle, e) => {
    e.stopPropagation();
    setEditingChatId(chatId);
    setEditingTitle(currentTitle);
  }, []);

  const saveEditedChatTitle = useCallback(
    (chatId, e) => {
      e.stopPropagation();
      const trimmedTitle = editingTitle.trim();
      if (trimmedTitle) {
        setChatHistory((prev) =>
          prev.map((chat) =>
            chat.id === chatId ? { ...chat, title: trimmedTitle } : chat
          )
        );
        addToast("Chat renamed.", "success");
      }
      setEditingChatId(null);
      setEditingTitle("");
    },
    [editingTitle, addToast]
  );

  const clearAllChats = useCallback(() => {
    if (window.confirm("Are you sure you want to clear all chats?")) {
      abortCurrentStream("Clearing all chats");
      setChatHistory([]);
      setMessages([]);
      setActiveChat(null);
      addToast("All chats cleared.", "info");
    }
  }, [abortCurrentStream, addToast]);

  // --- Model Management ---
  const pullAndUseModel = useCallback(
    async (modelUrlOrId) => {
      setIsModelLoading(true);
      addToast(`Attempting to download model: ${modelUrlOrId}`, "info");
      try {
        const token = localStorage.getItem("token");
        if (!token) throw new Error("No authentication token found");

        const response = await fetch("http://localhost:8000/v1/models/pull", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ model: modelUrlOrId }),
        });

        if (!response.ok) {
          if (response.status === 401) {
            handleLogout();
          }
          const errorData = await response.json().catch(() => ({
            detail: "Unknown pull error",
          }));
          throw new Error(
            `Failed to pull model: ${errorData.detail || response.statusText}`
          );
        }

        const pullData = await response.json();
        const modelId = pullData?.model_id || modelUrlOrId;
        addToast(`Model download started: ${modelId}.`, "success");
        setSelectedModel(modelId);
        setIsModelDropdownOpen(false);
        setCustomModelUrl("");

        await new Promise((resolve) => setTimeout(resolve, 2000));
        await fetchModelStatus();
      } catch (error) {
        console.error("Error pulling model:", error);
        addToast(`Failed to start download: ${error.message}`, "error");
      } finally {
        setIsModelLoading(false);
      }
    },
    [addToast, handleLogout, fetchModelStatus]
  );

  const handleCustomUrlSubmit = useCallback(
    (e) => {
      e.preventDefault();
      if (customModelUrl.trim()) {
        pullAndUseModel(customModelUrl);
      }
    },
    [customModelUrl, pullAndUseModel]
  );

  // --- Send Message ---
  const sendMessage = useCallback(async () => {
    const currentInputValue = inputValue.trim();
    if (!currentInputValue || isLoading || isStreaming) return;

    abortCurrentStream("Sending new message");
    const controller = new AbortController();
    abortControllerRef.current = controller;
    const signal = controller.signal;

    const queryHash = generateHash();
    const userMessage = {
      id: Date.now(),
      role: "user",
      content: currentInputValue,
      timestamp: new Date().toISOString(),
      queryHash,
    };
    setInputValue("");
    setIsLoading(true);

    const assistantMessageId = Date.now() + 1;
    const placeholderAssistantMessage = {
      id: assistantMessageId,
      role: "assistant",
      content: "",
      timestamp: new Date().toISOString(),
      nodeId: null,
      responseHash: null,
      isError: false,
    };

    const currentChatId = activeChat;
    const isFirstMessageInChat = messages.length === 0;

    const tempMessages = [...messages, userMessage, placeholderAssistantMessage];
    setMessages(tempMessages);

    const messagesForApi = [
      { role: "system", content: "You are a helpful AI assistant." },
      ...messages.map((msg) => ({ role: msg.role, content: msg.content })),
      { role: userMessage.role, content: userMessage.content },
    ];

    const chatTitle = isFirstMessageInChat
      ? currentInputValue.substring(0, 30) +
        (currentInputValue.length > 30 ? "..." : "")
      : chatHistory.find((c) => c.id === currentChatId)?.title || "Chat";

    let tempChatId = currentChatId;

    if (tempChatId) {
      setChatHistory((prev) =>
        prev.map((chat) =>
          chat.id === tempChatId ? { ...chat, title: chatTitle, messages: tempMessages } : chat
        )
      );
    } else {
      const newChatId = Date.now();
      tempChatId = newChatId;
      const newChat = {
        id: newChatId,
        title: chatTitle,
        messages: tempMessages,
        date: new Date().toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
          year: "numeric",
        }),
      };
      setChatHistory((prev) => [newChat, ...prev]);
      setActiveChat(newChatId);
    }

    try {
      const token = localStorage.getItem("token");
      if (!token) throw new Error("No authentication token found");

      addToast(`Query recorded\nHash: ${queryHash.substring(0, 10)}...`, "success");

      const response = await fetch("http://localhost:8000/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
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
        if (response.status === 401) {
          handleLogout();
        }
        const errorData = await response.json().catch(() => ({
          detail: `API error ${response.status}`,
        }));
        throw new Error(errorData.detail || `API request failed with status ${response.status}`);
      }

      if (!response.body) throw new Error("ReadableStream not available");

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let accumulatedContent = "";
      let doneReading = false;

      while (!doneReading) {
        if (signal.aborted) throw new Error("Request cancelled");

        const { value, done } = await reader.read();
        if (done) {
          doneReading = true;
          break;
        }

        if (!isStreaming && !isLoading) setIsLoading(true);
        if (isLoading) setIsLoading(false);
        if (!isStreaming) setIsStreaming(true);

        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split("\n\n");

        for (const line of lines) {
          if (line.startsWith("data: ")) {
            const jsonString = line.substring(6).trim();
            if (jsonString === "[DONE]") {
              doneReading = true;
              break;
            }
            if (jsonString) {
              try {
                const parsed = JSON.parse(jsonString);
                if (parsed.error) {
                  accumulatedContent += `\n\n[Error: ${parsed.error.message || "Unknown stream error"}]`;
                  setMessages((prev) =>
                    prev.map((msg) =>
                      msg.id === assistantMessageId
                        ? { ...msg, content: accumulatedContent, isError: true }
                        : msg
                    )
                  );
                  continue;
                }
                const deltaContent = parsed.choices?.[0]?.delta?.content;
                if (deltaContent) {
                  accumulatedContent += deltaContent;
                  setMessages((prev) =>
                    prev.map((msg) =>
                      msg.id === assistantMessageId
                        ? { ...msg, content: accumulatedContent, isError: false }
                        : msg
                    )
                  );
                }
              } catch (e) {
                console.error("Failed to parse stream chunk JSON:", jsonString, e);
              }
            }
          }
        }
        if (doneReading) break;
      }

      setIsStreaming(false);

      const finalNodeId = generateNodeId();
      const finalResponseHash = generateHash();

      const finalAssistantMessage = {
        id: assistantMessageId,
        role: "assistant",
        content: accumulatedContent.trim() || "...",
        timestamp: new Date().toISOString(),
        nodeId: finalNodeId,
        responseHash: finalResponseHash,
        isError: false,
      };

      setMessages((prevMessages) =>
        prevMessages.map((msg) =>
          msg.id === assistantMessageId ? finalAssistantMessage : msg
        )
      );

      if (tempChatId) {
        setChatHistory((prevHistory) =>
          prevHistory.map((chat) => {
            if (chat.id === tempChatId) {
              const finalChatMessages = chat.messages.map((m) =>
                m.id === assistantMessageId ? finalAssistantMessage : m
              );
              return { ...chat, messages: finalChatMessages };
            }
            return chat;
          })
        );
      }

      addToast(`Response recorded\nHash: ${finalResponseHash.substring(0, 10)}...`, "success");
      setTimeout(() => {
        const providerAddress = "0x" + Math.random().toString(16).substr(2, 40);
        addToast(`Transaction simulated\nTo: ${providerAddress.substring(0, 10)}...`, "success");
      }, 1500);
    } catch (error) {
      if (error.name === "AbortError" || error.message === "Request cancelled") {
        addToast("Request cancelled", "info");
        setMessages((prev) =>
          prev.map((msg) =>
            msg.id === assistantMessageId
              ? { ...msg, content: msg.content + "\n[Cancelled]" }
              : msg
          )
        );
      } else {
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
          nodeId: null,
          responseHash: null,
        };

        setMessages((prev) =>
          prev.map((msg) => (msg.id === assistantMessageId ? errorAssistantMessage : msg))
        );

        if (tempChatId) {
          setChatHistory((prevHistory) =>
            prevHistory.map((chat) => {
              if (chat.id === tempChatId) {
                const finalChatMessages = chat.messages.map((m) =>
                  m.id === assistantMessageId ? errorAssistantMessage : m
                );
                return { ...chat, messages: finalChatMessages };
              }
              return chat;
            })
          );
        }

        addToast(`Error: ${error.message}`, "error");
        if (error.message.includes("401")) {
          setTimeout(handleLogout, 1000);
        }
      }
    } finally {
      if (abortControllerRef.current === controller) {
        setIsLoading(false);
        setIsStreaming(false);
        abortControllerRef.current = null;
      }
      inputRef.current?.focus();
    }
  }, [
    inputValue,
    isLoading,
    isStreaming,
    messages,
    selectedModel,
    activeChat,
    chatHistory,
    generateHash,
    generateNodeId,
    addToast,
    handleLogout,
    abortCurrentStream,
  ]);

  const handleKeyDown = useCallback(
    (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
      }
    },
    [sendMessage]
  );

  const toggleTheme = useCallback(() => {
    setDarkMode((prev) => !prev);
  }, []);

  const navigateToHuggingFace = useCallback(() => {
    window.open("https://huggingface.co/models", "_blank");
  }, []);

  // --- JSX ---
  return (
    <>
      <GlobalStyles />
      <div
        className={`flex min-h-screen ${darkMode ? "dark bg-gray-900" : "bg-gray-100"} transition-colors duration-300`}
      >
        {/* Sidebar */}
        <div
          className={`fixed inset-y-0 left-0 z-40 w-64 transform ${
            sidebarOpen ? "translate-x-0" : "-translate-x-full"
          } md:translate-x-0 md:static md:z-auto ${
            darkMode ? "bg-gray-800" : "bg-white"
          } flex flex-col transition-transform duration-300 ease-in-out border-r ${
            darkMode ? "border-gray-700" : "border-gray-200"
          }`}
        >
          {/* Sidebar Header */}
          <div
            className={`p-4 flex justify-between items-center border-b ${
              darkMode ? "border-gray-700" : "border-gray-200"
            } h-16`}
          >
            <div className="text-xl font-semibold flex items-center">
              <span className={darkMode ? "text-white" : "text-gray-900"}>ComputeMesh</span>
              <span className="text-purple-600 ml-1">AI</span>
            </div>
            <button
              onClick={() => setSidebarOpen(false)}
              className={`p-1 rounded md:hidden ${
                darkMode ? "text-gray-400 hover:bg-gray-700" : "text-gray-600 hover:bg-gray-100"
              }`}
              title="Close sidebar"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
          {/* New Chat Button */}
          <div className="px-4 pt-4 pb-2">
            <button
              className={`flex items-center justify-center w-full p-2.5 ${
                darkMode
                  ? "bg-purple-600 hover:bg-purple-700"
                  : "bg-purple-600 hover:bg-purple-700"
              } rounded-md text-white font-medium transition-all shadow-sm active:scale-95`}
              onClick={createNewChat}
            >
              <Plus className="w-4 h-4 mr-2" /> New Chat
            </button>
          </div>
          {/* Chat History */}
          <div className="flex-1 overflow-y-auto px-3 custom-scrollbar">
            <div
              className={`py-3 text-sm flex justify-between items-center sticky top-0 z-10 ${
                darkMode ? "bg-gray-800" : "bg-white"
              }`}
            >
              <span className={darkMode ? "text-gray-400" : "text-gray-600"}>Recent Chats</span>
              {chatHistory.length > 0 && (
                <button
                  onClick={clearAllChats}
                  className={`p-1 rounded ${
                    darkMode
                      ? "text-gray-500 hover:text-red-400 hover:bg-gray-700"
                      : "text-gray-600 hover:text-red-500 hover:bg-gray-100"
                  }`}
                  title="Clear all chats"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              )}
            </div>
            <div className="space-y-1 pb-2">
              {chatHistory.length === 0 ? (
                <div
                  className={`text-center py-6 ${
                    darkMode ? "text-gray-500" : "text-gray-400"
                  } text-sm`}
                >
                  Start a new chat.
                </div>
              ) : (
                chatHistory.map((chat) => (
                  <div
                    key={chat.id}
                    className={`flex items-center p-2.5 rounded-lg cursor-pointer transition-all ${
                      chat.id === activeChat
                        ? darkMode
                          ? "bg-gray-700 text-white"
                          : "bg-gray-200 text-gray-900"
                        : darkMode
                        ? "text-gray-300 hover:bg-gray-700"
                        : "text-gray-700 hover:bg-gray-100"
                    } group relative`}
                    onClick={() => loadChat(chat.id)}
                  >
                    <MessageSquare
                      className={`w-4 h-4 mr-2 shrink-0 ${
                        chat.id === activeChat
                          ? "text-purple-500"
                          : darkMode
                          ? "text-gray-400"
                          : "text-gray-500"
                      }`}
                    />
                    <div className="truncate flex-1 min-w-0">
                      {editingChatId === chat.id ? (
                        <div onClick={(e) => e.stopPropagation()} className="flex items-center space-x-1">
                          <input
                            type="text"
                            value={editingTitle}
                            onChange={(e) => setEditingTitle(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") saveEditedChatTitle(chat.id, e);
                              if (e.key === "Escape") {
                                setEditingChatId(null);
                                setEditingTitle("");
                              }
                            }}
                            className={`w-full text-sm rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-purple-500 ${
                              darkMode ? "bg-gray-700 text-white" : "bg-white text-gray-900"
                            }`}
                            autoFocus
                          />
                          <button
                            onClick={(e) => saveEditedChatTitle(chat.id, e)}
                            className="text-purple-500 p-1 hover:bg-purple-500 hover:bg-opacity-20 rounded"
                            title="Save title"
                          >
                            <Save className="w-4 h-4" />
                          </button>
                        </div>
                      ) : (
                        <>
                          <div className="truncate text-sm font-medium">{chat.title}</div>
                          <div className={`text-xs ${darkMode ? "text-gray-500" : "text-gray-500"}`}>
                            {chat.date}
                          </div>
                        </>
                      )}
                    </div>
                    {!editingChatId && (
                      <div className="absolute right-2 top-1/2 transform -translate-y-1/2 flex space-x-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button
                          onClick={(e) => startEditingChatTitle(chat.id, chat.title, e)}
                          className={`p-1 rounded ${
                            darkMode
                              ? "text-gray-400 hover:text-white hover:bg-gray-600"
                              : "text-gray-500 hover:text-gray-800 hover:bg-gray-200"
                          }`}
                          title="Rename"
                        >
                          <Edit className="w-4 h-4" />
                        </button>
                        <button
                          onClick={(e) => deleteChat(chat.id, e)}
                          className={`p-1 rounded ${
                            darkMode
                              ? "text-gray-400 hover:text-red-400 hover:bg-gray-600"
                              : "text-gray-500 hover:text-red-500 hover:bg-gray-200"
                          }`}
                          title="Delete"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>
          {/* Wallet Info */}
          <div
            className={`p-4 border-t ${
              darkMode ? "border-gray-700" : "border-gray-200"
            }`}
          >
            <div
              className={`flex items-center p-2 rounded-md text-sm ${
                darkMode ? "bg-gray-700" : "bg-gray-100"
              }`}
            >
              <span className={`mr-2 text-xs ${darkMode ? "text-gray-400" : "text-gray-600"}`}>
                Wallet:
              </span>
              <span
                className={`truncate text-xs font-mono ${
                  darkMode ? "text-gray-200" : "text-gray-800"
                }`}
              >
                {walletAddress}
              </span>
            </div>
          </div>
        </div>

        {/* Main Content */}
        <div className="flex-1 flex flex-col h-screen md:ml-64">
          {/* Header */}
          <header
            className={`sticky top-0 z-30 w-full ${
              darkMode ? "bg-gray-800 border-gray-700" : "bg-white border-gray-200"
            } border-b py-3 px-4 flex items-center justify-between h-16`}
 
          >
            <div className="flex items-center space-x-3 flex-1 min-w-0">
              {/* Hamburger Menu for Mobile */}
              <button
                onClick={() => setSidebarOpen(true)}
                className={`p-2 rounded md:hidden ${
                  darkMode
                    ? "bg-gray-700 text-white hover:bg-gray-600"
                    : "bg-gray-100 text-gray-800 hover:bg-gray-200"
                }`}
                title="Open sidebar"
              >
                <Menu className="w-5 h-5" />
              </button>
              {/* Model Selector */}
              <div className="relative flex items-center space-x-2 min-w-0">
                <span
                  className={`text-sm font-medium truncate ${
                    darkMode ? "text-gray-200" : "text-gray-800"
                  }`}
                >
                  Model: {selectedModel}
                </span>
                <button
                  onClick={() => setIsModelDropdownOpen(!isModelDropdownOpen)}
                  className={`p-2 rounded ${
                    darkMode
                      ? "bg-gray-700 hover:bg-gray-600 text-white"
                      : "bg-gray-100 hover:bg-gray-200 text-gray-800"
                  } flex items-center space-x-1 text-sm font-medium`}
                  disabled={isModelLoading}
                >
                  {isModelLoading ? (
                    <Loader2 className="w-4 h-4 animate-spin text-purple-500" />
                  ) : (
                    <span>Pull Model</span>
                  )}
                </button>
                {isModelDropdownOpen && (
                  <div
                    className={`absolute top-full left-0 mt-2 w-80 ${
                      darkMode
                        ? "bg-gray-800 border-gray-700"
                        : "bg-white border-gray-200"
                    } rounded-lg shadow-lg border z-50 max-h-96 overflow-y-auto custom-scrollbar`}
                  >
                    <div className="p-4">
                      <div className="flex justify-between items-center mb-3">
                        <span
                          className={`text-sm font-medium ${
                            darkMode ? "text-gray-200" : "text-gray-800"
                          }`}
                        >
                          Pull Custom Model
                        </span>
                        <button
                          onClick={navigateToHuggingFace}
                          className="text-xs text-purple-500 hover:underline flex items-center"
                        >
                          Browse HF <ExternalLink className="w-3 h-3 ml-1" />
                        </button>
                      </div>
                      <form
                        onSubmit={handleCustomUrlSubmit}
                        className="flex items-center space-x-2"
                      >
                        <input
                          type="text"
                          value={customModelUrl}
                          onChange={(e) => setCustomModelUrl(e.target.value)}
                          placeholder="org/model-name:tag"
                          className={`flex-1 text-sm p-2 rounded-md ${
                            darkMode
                              ? "bg-gray-700 border-gray-600 text-white placeholder-gray-400"
                              : "bg-white border-gray-200 text-gray-900 placeholder-gray-400"
                          } border focus:outline-none focus:ring-2 focus:ring-purple-500`}
                        />
                        <button
                          type="submit"
                          className={`p-2 rounded-md text-white font-medium text-sm ${
                            isModelLoading || !customModelUrl.trim()
                              ? "bg-gray-500 cursor-not-allowed"
                              : "bg-purple-600 hover:bg-purple-700"
                          } transition-all`}
                          disabled={isModelLoading || !customModelUrl.trim()}
                        >
                          {isModelLoading ? (
                            <Loader2 className="w-4 h-4 animate-spin" />
                          ) : (
                            "Pull"
                          )}
                        </button>
                      </form>
                    </div>
                  </div>
                )}
              </div>
            </div>
            {/* Theme Toggle & Profile */}
            <div className="flex items-center space-x-3">
              <button
                onClick={toggleTheme}
                className={`p-2 rounded-md ${
                  darkMode
                    ? "bg-gray-700 hover:bg-gray-600"
                    : "bg-gray-100 hover:bg-gray-200"
                }`}
                title={darkMode ? "Switch to light mode" : "Switch to dark mode"}
              >
                {darkMode ? (
                  <Sun className="w-5 h-5 text-yellow-400" />
                ) : (
                  <Moon className="w-5 h-5 text-gray-600" />
                )}
              </button>
              <div className="relative">
                <button
                  className={`flex items-center rounded-full p-1 ${
                    darkMode
                      ? "bg-gray-700 hover:bg-gray-600"
                      : "bg-gray-100 hover:bg-gray-200"
                  } focus:outline-none focus:ring-2 focus:ring-purple-500 focus:ring-offset-2 ${
                    darkMode ? "focus:ring-offset-gray-800" : "focus:ring-offset-white"
                  }`}
                  onClick={() => setIsProfileDropdownOpen(!isProfileDropdownOpen)}
                >
                  <div
                    className={`w-8 h-8 rounded-full bg-purple-600 flex items-center justify-center text-white text-sm font-medium shadow-sm ${
                      darkMode ? "ring-gray-700" : "ring-gray-200"
                    } ring-1 ring-opacity-50`}
                  >
                    {user?.name?.charAt(0).toUpperCase() ||
                      user?.email?.charAt(0).toUpperCase() ||
                      "U"}
                  </div>
                </button>
                {isProfileDropdownOpen && (
                  <div
                    className={`absolute top-full right-0 mt-2 w-56 ${
                      darkMode
                        ? "bg-gray-800 border-gray-700"
                        : "bg-white border-gray-200"
                    } rounded-lg shadow-lg border z-50`}
                  >
                    <div
                      className={`p-3 border-b ${
                        darkMode ? "border-gray-700" : "border-gray-200"
                      }`}
                    >
                      <div
                        className={`text-sm font-medium truncate ${
                          darkMode ? "text-white" : "text-gray-900"
                        }`}
                      >
                        {user?.name || "User Name"}
                      </div>
                      <div
                        className={`text-xs truncate ${
                          darkMode ? "text-gray-400" : "text-gray-500"
                        }`}
                      >
                        {user?.email || "user@example.com"}
                      </div>
                    </div>
                    <div className="py-1">
                      <button
                        className={`flex items-center w-full text-left px-4 py-2 text-sm ${
                          darkMode
                            ? "text-gray-200 hover:bg-gray-700"
                            : "text-gray-700 hover:bg-gray-100"
                        }`}
                      >
                        <Settings className="w-4 h-4 mr-2" /> Settings
                      </button>
                      <button
                        onClick={handleLogout}
                        className={`flex items-center w-full text-left px-4 py-2 text-sm ${
                          darkMode
                            ? "text-gray-200 hover:bg-gray-700"
                            : "text-gray-700 hover:bg-gray-100"
                        }`}
                      >
                        <LogOut className="w-4 h-4 mr-2" /> Log Out
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </header>

          {/* Chat Content Area */}
          <div
            className={`flex-1 overflow-y-auto p-4 md:p-6 ${
              darkMode ? "bg-gray-900" : "bg-gray-100"
            } custom-scrollbar`}
          >
            {(messages.length === 0 && !activeChat) ? (
              <div className="h-full flex flex-col items-center justify-center text-center">
                <img
                  src="/ComputeMeshLogo_Purple.png"
                  alt="Logo"
                  className="w-24 h-24 mb-4"
                />
                <h1
                  className={`text-2xl md:text-3xl font-bold ${
                    darkMode ? "text-white" : "text-gray-900"
                  } mb-2`}
                >
                  ComputeMesh AI
                </h1>
                <p
                  className={`${
                    darkMode ? "text-gray-400" : "text-gray-600"
                  } text-sm md:text-base max-w-md`}
                >
                  Start a conversation or pull a new model to begin.
                </p>
              </div>
            ) : (messages.length === 0 && activeChat) ? (
              <div className="h-full flex flex-col items-center justify-center text-center">
                <MessageSquare
                  className={`w-16 h-16 mb-4 ${
                    darkMode ? "text-gray-600" : "text-gray-400"
                  }`}
                />
                <p
                  className={`${
                    darkMode ? "text-gray-400" : "text-gray-600"
                  } text-sm md:text-base max-w-md`}
                >
                  Send a message to start the conversation.
                </p>
              </div>
            ) : (
              <div className="max-w-3xl mx-auto space-y-4 pb-4 w-full">
                {messages.map((message, index) => (
                  <div
                    key={message.id || index}
                    className={`flex ${
                      message.role === "user" ? "justify-end" : "justify-start"
                    }`}
                  >
                    <div
                      className={`max-w-[85%] md:max-w-[75%] rounded-lg px-4 py-3 shadow-sm text-sm md:text-base ${
                        message.role === "user"
                          ? `${
                              darkMode
                                ? "bg-purple-600 text-white"
                                : "bg-purple-600 text-white"
                            }`
                          : message.isError
                          ? `${
                              darkMode
                                ? "bg-red-800 bg-opacity-60 text-red-100"
                                : "bg-red-100 text-red-700"
                            } border border-red-200/50`
                          : `${
                              darkMode
                                ? "bg-gray-800 text-gray-100"
                                : "bg-white text-gray-800"
                            } border ${
                              darkMode ? "border-gray-700" : "border-gray-200"
                            }`
                      }`}
                    >
                      <div className="whitespace-pre-wrap break-words">
                        {message.content}
                        {isStreaming &&
                          message.role === "assistant" &&
                          index === messages.length - 1 && (
                            <span className="animate-blink h-4 bg-current ml-1"></span>
                          )}
                      </div>
                      {message.queryHash && (
                        <div
                          className={`text-xs mt-2 ${
                            darkMode ? "text-gray-400" : "text-gray-500"
                          } opacity-80`}
                        >
                          Query Hash:{" "}
                          <span className="font-mono">
                            {message.queryHash.substring(0, 10)}...
                          </span>
                        </div>
                      )}
                      {message.responseHash && (
                        <div
                          className={`text-xs mt-2 ${
                            darkMode ? "text-gray-400" : "text-gray-500"
                          } opacity-80`}
                        >
                          Resp Hash:{" "}
                          <span className="font-mono">
                            {message.responseHash.substring(0, 10)}...
                          </span>{" "}
                          | Node:{" "}
                          <span className="font-mono">{message.nodeId}</span>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
                {isLoading && !isStreaming && (
                  <div className="flex justify-start">
                    <div
                      className={`max-w-[85%] md:max-w-[75%] rounded-lg px-4 py-3 ${
                        darkMode
                          ? "bg-gray-800 text-gray-100"
                          : "bg-white text-gray-800"
                      } border ${
                        darkMode ? "border-gray-700" : "border-gray-200"
                      } shadow-sm`}
                    >
                      <div className="flex space-x-2 justify-center items-center h-5">
                        <div
                          className="w-2 h-2 rounded-full bg-purple-500 animate-bounce"
                          style={{ animationDelay: "0s" }}
                        ></div>
                        <div
                          className="w-2 h-2 rounded-full bg-purple-500 animate-bounce"
                          style={{ animationDelay: "0.15s" }}
                        ></div>
                        <div
                          className="w-2 h-2 rounded-full bg-purple-500 animate-bounce"
                          style={{ animationDelay: "0.3s" }}
                        ></div>
                      </div>
                    </div>
                  </div>
                )}
                <div ref={messagesEndRef} className="h-1" />
              </div>
            )}
          </div>

          {/* Input Area */}
          <div
            className={`sticky bottom-0 w-full z-20 ${
              darkMode ? "bg-gray-800 border-gray-700" : "bg-white border-gray-200"
            } border-t px-4 py-3`}
          >
            <div className="max-w-3xl mx-auto w-full relative">
              <textarea
                ref={inputRef}
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={
                  isStreaming ? "Waiting for response..." : "Message ComputeMesh..."
                }
                disabled={isLoading || isStreaming}
                rows={1}
                className={`w-full p-3 pr-12 rounded-lg resize-none overflow-y-auto custom-scrollbar text-sm md:text-base ${
                  darkMode
                    ? "bg-gray-700 border-gray-600 text-white placeholder-gray-400 focus:ring-purple-500"
                    : "bg-white border-gray-200 text-gray-900 placeholder-gray-400 focus:ring-purple-500"
                } border focus:outline-none focus:ring-2 focus:border-transparent shadow-sm transition-all disabled:opacity-70 disabled:cursor-not-allowed`}
                style={{ minHeight: "48px", maxHeight: "150px" }}
              />
              <button
                onClick={sendMessage}
                disabled={!inputValue.trim() || isLoading || isStreaming}
                className={`absolute right-2 bottom-2 p-2 rounded-md ${
                  !inputValue.trim() || isLoading || isStreaming
                    ? "bg-gray-400 text-gray-200 cursor-not-allowed"
                    : "bg-purple-600 hover:bg-purple-700 text-white"
                } shadow-sm transition-all active:scale-95`}
                title="Send message"
              >
                {isLoading ? (
                  <Loader2 className="w-5 h-5 animate-spin" />
                ) : (
                  <Send className="w-5 h-5" />
                )}
              </button>
            </div>
            <div
              className={`text-xs text-center mt-2 ${
                darkMode ? "text-gray-400" : "text-gray-500"
              } select-none`}
            >
              ComputeMesh AI may provide inaccurate information. Verify critical details.
            </div>
          </div>
        </div>

        {/* Toast Notifications */}
        <div className="fixed bottom-4 right-4 z-50 space-y-2 max-w-sm w-full">
          {toasts.map((toast) => (
            <Toast
              key={toast.id}
              message={toast.message}
              type={toast.type}
              onClose={() => removeToast(toast.id)}
            />
          ))}
        </div>
      </div>
    </>
  );
}

export default Dashboard;