"use client"

import { useState, useEffect, useRef } from "react"
import { useAuth } from "../App"
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
} from "lucide-react"

function Dashboard() {
  const { user, setUser } = useAuth()
  const walletAddress = "0x1234...abcd"
  const [selectedModel, setSelectedModel] = useState("tinyllama:1b")
  const [customModelUrl, setCustomModelUrl] = useState("")
  const [chatHistory, setChatHistory] = useState([])
  const [activeChat, setActiveChat] = useState(null)
  const [messages, setMessages] = useState([])
  const [inputValue, setInputValue] = useState("")
  const [isModelDropdownOpen, setIsModelDropdownOpen] = useState(false)
  const [isProfileDropdownOpen, setIsProfileDropdownOpen] = useState(false)
  const [darkMode, setDarkMode] = useState(false)
  const [isCustomUrlActive, setIsCustomUrlActive] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [isTyping, setIsTyping] = useState(false)
  const [typingText, setTypingText] = useState("")
  const [fullResponseText, setFullResponseText] = useState("")
  const [typingSpeed, setTypingSpeed] = useState(60)
  const [editingChatId, setEditingChatId] = useState(null)
  const [editingTitle, setEditingTitle] = useState("")
  const [availableModels, setAvailableModels] = useState([])
  const [isModelLoading, setIsModelLoading] = useState(false)
  const [downloadTasks, setDownloadTasks] = useState({})
  const [loadedModel, setLoadedModel] = useState(null)
  const messagesEndRef = useRef(null)
  const inputRef = useRef(null)
  const [sidebarOpen, setSidebarOpen] = useState(true);

  // Initialize theme, chat history, and models
  useEffect(() => {
    // Load theme preference
    const savedTheme = localStorage.getItem("theme")
    if (savedTheme === "dark") {
      setDarkMode(true)
    } else if (savedTheme === "light") {
      setDarkMode(false)
    } else if (window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches) {
      setDarkMode(true)
    }

    // Load chat history
    const savedHistory = localStorage.getItem("chatHistory")
    if (savedHistory) {
      try {
        const parsedHistory = JSON.parse(savedHistory)
        setChatHistory(parsedHistory)

        if (parsedHistory.length > 0) {
          setActiveChat(parsedHistory[0].id)
          setMessages(parsedHistory[0].messages || [])
        }
      } catch (error) {
        console.error("Error parsing chat history:", error)
      }
    }

    // Load model preference
    const savedModel = localStorage.getItem("selectedModel")
    if (savedModel) {
      setSelectedModel(savedModel)
      if (savedModel.startsWith("Custom:")) {
        setIsCustomUrlActive(true)
        setCustomModelUrl(savedModel.replace("Custom: ", ""))
      }
    }

    // Fetch available models and current status
    fetchModelsAndStatus()

    // Set up polling for model status
    const statusInterval = setInterval(fetchModelsAndStatus, 10000)
    return () => clearInterval(statusInterval)
  }, [])

  // Save preferences
  useEffect(() => {
    localStorage.setItem("theme", darkMode ? "dark" : "light")
    document.documentElement.classList.toggle("dark", darkMode)
  }, [darkMode])

  useEffect(() => {
    if (chatHistory.length > 0) {
      localStorage.setItem("chatHistory", JSON.stringify(chatHistory))
    }
  }, [chatHistory])

  useEffect(() => {
    localStorage.setItem("selectedModel", selectedModel)
  }, [selectedModel])

  // Scroll to bottom when messages change
  useEffect(() => {
    scrollToBottom()
  }, [messages])

  // Handle typing animation
  useEffect(() => {
    if (isTyping && fullResponseText) {
      let currentIndex = 0
      const typingInterval = setInterval(() => {
        if (currentIndex <= fullResponseText.length) {
          setTypingText(fullResponseText.substring(0, currentIndex))
          currentIndex++
        } else {
          clearInterval(typingInterval)
          setIsTyping(false)

          const aiMessage = {
            id: Date.now(),
            role: "assistant",
            content: fullResponseText,
            timestamp: new Date().toISOString(),
          }

          const updatedMessages = [...messages, aiMessage]
          setMessages(updatedMessages)

          if (activeChat) {
            setChatHistory(
              chatHistory.map((chat) => (chat.id === activeChat ? { ...chat, messages: updatedMessages } : chat)),
            )
          }

          setFullResponseText("")
        }
      }, typingSpeed)

      return () => clearInterval(typingInterval)
    }
  }, [isTyping, fullResponseText, messages, typingSpeed, activeChat, chatHistory])

  const fetchModelsAndStatus = async () => {
    try {
      const token = localStorage.getItem("token")
      if (!token) return

      const response = await fetch("https://hackbyte3-0.onrender.com/v1/models/status", {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      })

      if (response.ok) {
        const data = await response.json()
        setAvailableModels(data.available_models || [])
        setLoadedModel(data.loaded)
        setDownloadTasks(data.download_tasks || {})
      }
    } catch (error) {
      console.error("Error fetching model status:", error)
    }
  }

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" })
  }

  const createNewChat = () => {
    const newChat = {
      id: Date.now(),
      title: "New Chat",
      date: new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }),
      messages: [],
    }
    setChatHistory([newChat, ...chatHistory])
    setActiveChat(newChat.id)
    setMessages([])

    setTimeout(() => {
      inputRef.current?.focus()
    }, 100)
  }

  const loadChat = (chatId) => {
    const chat = chatHistory.find((c) => c.id === chatId)
    if (chat) {
      setActiveChat(chatId)
      setMessages(chat.messages || [])
      setIsProfileDropdownOpen(false)
      setIsModelDropdownOpen(false)
    }
  }

  const deleteChat = (chatId, e) => {
    e.stopPropagation()
    const updatedHistory = chatHistory.filter((chat) => chat.id !== chatId)
    setChatHistory(updatedHistory)

    if (activeChat === chatId) {
      if (updatedHistory.length > 0) {
        setActiveChat(updatedHistory[0].id)
        setMessages(updatedHistory[0].messages || [])
      } else {
        setActiveChat(null)
        setMessages([])
      }
    }
  }

  const startEditingChatTitle = (chatId, currentTitle, e) => {
    e.stopPropagation()
    setEditingChatId(chatId)
    setEditingTitle(currentTitle)
  }

  const saveEditedChatTitle = (chatId, e) => {
    e.stopPropagation()
    if (editingTitle.trim()) {
      setChatHistory(chatHistory.map((chat) => (chat.id === chatId ? { ...chat, title: editingTitle.trim() } : chat)))
    }
    setEditingChatId(null)
    setEditingTitle("")
  }

  const pullAndUseModel = async (modelUrl) => {
    try {
      setIsModelLoading(true)
      const token = localStorage.getItem("token")
      if (!token) throw new Error("No authentication token found")

      // Pull the model
      const pullResponse = await fetch("https://hackbyte3-0.onrender.com/v1/models/pull", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          model: modelUrl,
        }),
      })

      if (!pullResponse.ok) {
        throw new Error(`Failed to pull model: ${pullResponse.status}`)
      }

      const pullData = await pullResponse.json()
      const modelId = pullData.task?.id || modelUrl

      // Set as selected model
      setSelectedModel(modelId)
      setIsCustomUrlActive(false)
      setIsModelDropdownOpen(false)

      // Wait a bit for the download to start before checking status
      await new Promise(resolve => setTimeout(resolve, 2000))
      await fetchModelsAndStatus()

    } catch (error) {
      console.error("Error pulling model:", error)
      const errorMessage = {
        id: Date.now(),
        role: "assistant",
        content: `Failed to download model: ${error.message}`,
        timestamp: new Date().toISOString(),
      }
      setMessages([...messages, errorMessage])
    } finally {
      setIsModelLoading(false)
    }
  }

  const sendMessage = async () => {
    if (!inputValue.trim() || isLoading || isTyping) return

    const userMessage = {
      id: Date.now(),
      role: "user",
      content: inputValue,
      timestamp: new Date().toISOString(),
    }

    const updatedMessages = [...messages, userMessage]
    setMessages(updatedMessages)
    setInputValue("")
    setIsLoading(true)

    try {
      const token = localStorage.getItem("token")
      if (!token) throw new Error("No authentication token found")

      const response = await fetch("https://hackbyte3-0.onrender.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          model: selectedModel,
          messages: [
            {
              role: "system",
              content: "You are a helpful AI assistant.",
            },
            ...updatedMessages.map((msg) => ({
              role: msg.role,
              content: msg.content,
            })),
          ],
          stream: false,
          max_tokens: 512,
          temperature: 0.6,
          top_p: 0.9,
        }),
      })

      if (!response.ok) {
        if (response.status === 401) {
          localStorage.removeItem("token")
          setUser(null)
          throw new Error("Session expired. Please log in again.")
        }
        throw new Error(`API request failed with status ${response.status}`)
      }

      const data = await response.json()
      const responseText = data.choices[0].message.content

      setFullResponseText(responseText)
      setIsTyping(true)

      if (!activeChat || (activeChat && chatHistory.find((c) => c.id === activeChat)?.messages.length === 0)) {
        const newChat = {
          id: activeChat || Date.now(),
          title: userMessage.content.substring(0, 30) + (userMessage.content.length > 30 ? "..." : ""),
          date: new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }),
          messages: updatedMessages,
        }

        if (activeChat) {
          setChatHistory(chatHistory.map((chat) => (chat.id === activeChat ? newChat : chat)))
        } else {
          setChatHistory([newChat, ...chatHistory])
          setActiveChat(newChat.id)
        }
      } else {
        setChatHistory(
          chatHistory.map((chat) => (chat.id === activeChat ? { ...chat, messages: updatedMessages } : chat)),
        )
      }
    } catch (error) {
      console.error("Error sending message:", error)
      const errorMessage = {
        id: Date.now(),
        role: "assistant",
        content: error.message.includes("401")
          ? "Session expired. Please log in again."
          : "Sorry, I encountered an error. Please try again.",
        timestamp: new Date().toISOString(),
      }
      setMessages([...updatedMessages, errorMessage])

      if (activeChat) {
        setChatHistory(
          chatHistory.map((chat) =>
            chat.id === activeChat ? { ...chat, messages: [...updatedMessages, errorMessage] } : chat,
          ),
        )
      }

      if (error.message.includes("401")) {
        setUser(null)
      }
    } finally {
      setIsLoading(false)
    }
  }

  const handleKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      sendMessage()
    }
  }

  const handleCustomUrlSubmit = async (e) => {
    e.preventDefault()
    if (customModelUrl.trim()) {
      await pullAndUseModel(customModelUrl)
    }
  }

  const toggleTheme = () => {
    setDarkMode(!darkMode)
  }

  const navigateToHuggingFace = () => {
    window.open("https://huggingface.co/models", "_blank")
  }

  const clearAllChats = () => {
    if (window.confirm("Are you sure you want to clear all chats? This cannot be undone.")) {
      setChatHistory([])
      setMessages([])
      setActiveChat(null)
      localStorage.removeItem("chatHistory")
    }
  }

  const getDownloadProgress = (taskId) => {
    const task = downloadTasks[taskId]
    if (!task) return null

    const item = task.items?.[0]
    if (!item) return null

    if (item.bytes && item.downloadedBytes) {
      return Math.round((item.downloadedBytes / item.bytes) * 100)
    }
    return null
  }

  return (
    <div className={`flex min-h-screen flex-col md:flex-row ${darkMode ? "dark bg-[#161616]" : "bg-gray-50"} transition-colors duration-300`}>
      {/* Sidebar */}
      <div
        className={`fixed inset-y-0 left-0 z-50 w-64 transform ${sidebarOpen ? "translate-x-0" : "-translate-x-full"
          } 
        ${darkMode ? "bg-[#111111]" : "bg-[#ebeaea] border-r border-gray-200"} flex flex-col transition-transform duration-300 ease-in-out`}
      >
        {/* Sidebar Header */}
        <div className="p-4 border-b border-opacity-10 border-gray-300 flex justify-between items-center">
          <div className="text-xl font-semibold flex items-center">
            <span className={`${darkMode ? "text-white" : "text-gray-800"}`}>ComputeMesh</span>
            <span className="text-[#7814E3] ml-1">AI</span>
          </div>
          <button
            onClick={() => setSidebarOpen(false)}
            className={`p-2 rounded ${darkMode ? "bg-[#222222] text-white" : "bg-gray-200 text-gray-800"}`}
            title="Close sidebar"
          >
            <Menu className="w-5 h-5" />
          </button>
        </div>

        {/* New Chat Button */}
        <div className="px-4 pt-2 pb-4">
          <button
            className={`flex items-center justify-center w-full p-3 ${darkMode ? "bg-[#7814E3]" : "bg-[#7814E3]"
              } bg-opacity-90 rounded-md text-white font-medium hover:bg-opacity-100 transition-all shadow-sm`}
            onClick={createNewChat}
          >
            <Plus className="w-4 h-4 mr-2" />
            New chat
          </button>
        </div>

        {/* Chat History */}
        <div className="flex-1 overflow-y-auto px-3">
          <div className="py-3 text-sm flex justify-between items-center">
            <span className={`${darkMode ? "text-gray-400" : "text-gray-600"}`}>Recent chats</span>
            {chatHistory.length > 0 && (
              <button
                onClick={clearAllChats}
                className={`text-xs ${darkMode ? "text-gray-500 hover:text-gray-300" : "text-gray-600 hover:text-gray-700"
                  } transition-colors`}
                title="Clear all chats"
              >
                <Trash2 className="w-3 h-3" />
              </button>
            )}
          </div>
          <div className="space-y-1">
            {chatHistory.length === 0 ? (
              <div className={`text-center py-6 ${darkMode ? "text-gray-500" : "text-gray-400"} text-sm`}>
                No chats yet
              </div>
            ) : (
              chatHistory.map((chat) => (
                <div
                  key={chat.id}
                  className={`flex items-center p-3 w-full text-left rounded-lg transition-all ${chat.id === activeChat
                    ? darkMode
                      ? "bg-[#222222] text-white"
                      : "bg-gray-300 text-gray-900"
                    : darkMode
                      ? "text-gray-300 hover:bg-[#1A1A1A]"
                      : "text-gray-700 hover:bg-gray-100"
                    } group relative`}
                  onClick={() => loadChat(chat.id)}
                >
                  <MessageSquare
                    className={`w-4 h-4 mr-3 shrink-0 ${chat.id === activeChat ? "text-[#7814E3]" : ""}`}
                  />
                  <div className="truncate flex-1 min-w-0">
                    {editingChatId === chat.id ? (
                      <div onClick={(e) => e.stopPropagation()} className="flex items-center">
                        <input
                          type="text"
                          value={editingTitle}
                          onChange={(e) => setEditingTitle(e.target.value)}
                          className={`w-full ${darkMode ? "bg-[#333333] text-white" : "bg-[#e9eaec] text-gray-900"
                            } text-sm rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-[#7814E3]`}
                          autoFocus
                        />
                        <button
                          onClick={(e) => saveEditedChatTitle(chat.id, e)}
                          className="ml-1 text-[#7814E3]"
                        >
                          <Save className="w-3 h-3" />
                        </button>
                      </div>
                    ) : (
                      <>
                        <div className="truncate text-sm font-medium">{chat.title}</div>
                        <div className={`text-xs ${darkMode ? "text-gray-500" : "text-gray-500"}`}>{chat.date}</div>
                      </>
                    )}
                  </div>
                  {chat.id === activeChat && !editingChatId && (
                    <div className="flex space-x-2 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button
                        onClick={(e) => startEditingChatTitle(chat.id, chat.title, e)}
                        className={`${darkMode ? "text-gray-400 hover:text-white" : "text-gray-600 hover:text-gray-700"
                          }`}
                        title="Rename"
                      >
                        <Edit className="w-3 h-3" />
                      </button>
                      <button
                        onClick={(e) => deleteChat(chat.id, e)}
                        className={`${darkMode ? "text-gray-400 hover:text-[#7814E3]" : "text-gray-600 hover:text-[#7814E3]"
                          }`}
                        title="Delete"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        </div>

        {/* Wallet Address */}
        <div className={`p-4 border-t ${darkMode ? "border-[#222222]" : "border-gray-300"}`}>
          <div className={`flex items-center p-2 rounded-md text-sm ${darkMode ? "bg-[#1A1A1A]" : "bg-[#d0d1d2]"}`}>
            <span className={`${darkMode ? "text-gray-400" : "text-gray-800"} mr-2`}>Wallet:</span>
            <span className={`${darkMode ? "text-gray-200" : "text-gray-800"} truncate text-xs font-mono`}>
              {walletAddress}
            </span>
          </div>
        </div>
      </div>

      {/* Main Content Container */}
      <div className={`flex-1 flex flex-col ${sidebarOpen ? "md:ml-64" : "md:ml-0"} transition-all duration-300`}>
        {/* Fixed Header */}
        <header
          className={`fixed top-0 left-0 right-0 z-40 ${sidebarOpen ? "md:ml-64" : "md:ml-0"} 
  ${darkMode ? "bg-[#111111] border-[#222222]" : "bg-[#f3f4f6] border-gray-200"} 
  border-b py-3 px-4 sm:px-6 flex items-center justify-between transition-colors duration-300`}
        >
          <div className="flex items-center space-x-2 w-full">
            {!sidebarOpen && (
              <button
                onClick={() => setSidebarOpen(true)}
                className={`p-2 rounded ${darkMode ? "bg-[#222222] text-white" : "bg-gray-200 text-gray-800"}`}
                title="Open sidebar"
              >
                <Menu className="w-5 h-5" />
              </button>
            )}
            <div className="relative flex-1 min-w-0">
              <button
                className={`flex items-center justify-between w-full text-sm font-medium min-w-0 
        ${darkMode ? "bg-[#1A1A1A] hover:bg-[#222222] text-white" : "bg-[#e9eaec] hover:bg-gray-200 text-gray-700"} 
        rounded-md px-3 py-2 transition-colors duration-200`}
                onClick={() => setIsModelDropdownOpen(!isModelDropdownOpen)}
                disabled={isModelLoading}
              >
                {isModelLoading ? (
                  <div className="flex items-center space-x-2 w-full min-w-0">
                    <Loader2 className="w-4 h-4 animate-spin text-[#7814E3] flex-shrink-0" />
                    <span className="flex-1 min-w-0 overflow-hidden">
                      <span className="block truncate">
                        Loading model...
                        {selectedModel && (
                          <span className="ml-1 text-xs text-[#7814E3]">
                            ({selectedModel})
                          </span>
                        )}
                      </span>
                    </span>
                  </div>
                ) : (
                  <div className="flex items-center space-x-2 w-full min-w-0">
                    <span className="flex-1 min-w-0 overflow-hidden">
                      <span className="block truncate">
                        {selectedModel || "Select a model"}
                        {loadedModel === selectedModel && (
                          <span className="ml-1 text-xs text-[#7814E3]">(loaded)</span>
                        )}
                      </span>
                    </span>
                    <ChevronDown className="w-4 h-4 flex-shrink-0" />
                  </div>
                )}
              </button>

              {isModelDropdownOpen && (
                <div
                  className={`absolute top-full left-0 mt-2 w-full sm:w-80 ${darkMode ? "bg-[#1A1A1A] border-[#222222]" : "bg-[#f3f4f6] border-gray-200"
                    } rounded-lg shadow-lg border z-10 transition-colors duration-300`}
                >
                  <div className="py-2 max-h-96 overflow-y-auto">
                    {availableModels.map((model) => (
                      <button
                        key={model.id}
                        className={`w-full text-left px-4 py-2 ${darkMode ? "hover:bg-[#222222] text-gray-200" : "hover:bg-gray-200 text-gray-700"
                          } text-sm transition-colors duration-200 ${selectedModel === model.id
                            ? darkMode
                              ? "bg-[#222222]"
                              : "bg-gray-200"
                            : ""
                          }`}
                        onClick={() => {
                          setSelectedModel(model.id);
                          setIsCustomUrlActive(false);
                          setIsModelDropdownOpen(false);
                        }}
                      >
                        <div className="flex justify-between items-center">
                          <span>{model.id}</span>
                          {loadedModel === model.id && <Check className="w-4 h-4 text-[#7814E3]" />}
                        </div>
                      </button>
                    ))}
                    {/* Rest of the dropdown content remains unchanged */}
                    <div className={`border-t ${darkMode ? "border-[#222222]" : "border-gray-200"} my-2`}></div>
                    <div className="px-4 py-3">
                      <div className="flex justify-between items-center mb-2">
                        <span className={`text-sm ${darkMode ? "text-gray-300" : "text-gray-700"}`}>
                          Custom Hugging Face Model
                        </span>
                        <button
                          className="text-xs text-[#7814E3] hover:text-[#7814e3e8] flex items-center"
                          onClick={navigateToHuggingFace}
                        >
                          Browse Models
                          <ExternalLink className="w-3 h-3 ml-1" />
                        </button>
                      </div>

                      <form onSubmit={handleCustomUrlSubmit} className="flex items-center space-x-2">
                        <input
                          type="text"
                          value={customModelUrl}
                          onChange={(e) => setCustomModelUrl(e.target.value)}
                          placeholder="Enter Hugging Face model URL"
                          className={`flex-1 text-sm p-2 rounded-md ${darkMode
                            ? "bg-[#2A2A2A] border-[#333333] text-white placeholder-gray-400"
                            : "bg-[#e9eaec] border-gray-200 text-gray-900 placeholder-gray-500"
                            } border focus:outline-none focus:ring-1 focus:ring-[#7814E3]`}
                        />
                        <button
                          type="submit"
                          className="bg-[#7814E3] hover:bg-[#7814e3f1] text-white font-medium text-xs py-2 px-3 rounded-md shadow-sm transition-colors"
                          disabled={isModelLoading}
                        >
                          {isModelLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : "Use"}
                        </button>
                      </form>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="flex items-center space-x-3">
            <button
              onClick={toggleTheme}
              className={`p-2 rounded-md ${darkMode ? "bg-[#1A1A1A] hover:bg-[#222222]" : "bg-[#e9eaec] hover:bg-gray-200"
                } transition-colors duration-200`}
              title={darkMode ? "Switch to light mode" : "Switch to dark mode"}
            >
              {darkMode ? <Sun className="w-5 h-5 text-gray-300" /> : <Moon className="w-5 h-5 text-gray-700" />}
            </button>

            <div className="relative">
              <button
                className="flex items-center space-x-2 rounded-full transition-colors duration-200"
                onClick={() => setIsProfileDropdownOpen(!isProfileDropdownOpen)}
              >
                <div className="w-9 h-9 rounded-full bg-[#7814E3] flex items-center justify-center text-white text-sm font-medium shadow-sm">
                  {user?.name?.charAt(0).toUpperCase() || user?.email?.charAt(0).toUpperCase() || "U"}
                </div>
              </button>

              {isProfileDropdownOpen && (
                <div
                  className={`absolute top-full right-0 mt-2 w-56 ${darkMode ? "bg-[#1A1A1A] border-[#222222]" : "bg-[#f3f4f6] border-gray-200"
                    } rounded-lg shadow-lg border z-10 transition-colors duration-300`}
                >
                  <div className={`p-3 border-b ${darkMode ? "border-[#222222]" : "border-gray-200"}`}>
                    <div className={`font-medium text-sm ${darkMode ? "text-white" : "text-gray-900"}`}>
                      {user?.name || ""}
                    </div>
                    <div className={`text-xs ${darkMode ? "text-gray-400" : "text-gray-500"} truncate`}>
                      {user?.email || "user@example.com"}
                    </div>
                  </div>
                  <div className="py-2">
                    <button
                      className={`flex items-center w-full text-left px-4 py-2 ${darkMode ? "hover:bg-[#222222] text-gray-300" : "hover:bg-gray-200 text-gray-700"
                        } text-sm transition-colors duration-200`}
                    >
                      <Settings className="w-4 h-4 mr-2" />
                      Settings
                    </button>
                    <button
                      className={`flex items-center w-full text-left px-4 py-2 ${darkMode ? "hover:bg-[#222222] text-gray-300" : "hover:bg-gray-200 text-gray-700"
                        } text-sm transition-colors duration-200`}
                      onClick={() => {
                        localStorage.removeItem("token");
                        localStorage.removeItem("user");
                        setUser(null);
                      }}
                    >
                      <LogOut className="w-4 h-4 mr-2" />
                      Log out
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </header>

        {/* Chat Content Area */}
        <div
          className={`flex-1 overflow-y-auto px-4 sm:px-6 py-4 
          ${darkMode ? "bg-[#161616]" : "bg-gray-50"} transition-colors duration-300 
          pt-[80px] pb-[140px]`}
        >
          {messages.length === 0 ? (
            <div className="h-full flex items-center justify-center">
              <div className="text-center max-w-md px-4">
                <div className="mb-6">
                  <div className="inline-flex items-center justify-center bg-opacity-10">
                    <img src="../../ComputeMeshLogo_Purple.png" className="w-24 sm:w-32 h-24 sm:h-32" />
                  </div>
                  <h1 className={`text-2xl sm:text-3xl font-bold ${darkMode ? "text-white" : "text-gray-900"}`}>
                    ComputeMesh AI
                  </h1>
                </div>
                <p className={`${darkMode ? "text-gray-400" : "text-gray-600"} mb-8 text-sm sm:text-base`}>
                  Ask anything about your data, models, or blockchain transactions.
                </p>
                {isCustomUrlActive && (
                  <div
                    className={`${darkMode ? "bg-[#1A1A1A]" : "bg-[#e9eaec] border border-gray-200"
                      } p-4 rounded-lg inline-block shadow-sm`}
                  >
                    <p className={`text-sm ${darkMode ? "text-gray-300" : "text-gray-700"}`}>Using custom model:</p>
                    <p className="text-xs sm:text-sm font-mono text-[#7814E3] mt-1 truncate max-w-[250px]">
                      {customModelUrl}
                    </p>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="max-w-3xl mx-auto space-y-6 pb-2 w-full">
              {messages.map((message) => (
                <div
                  key={message.id}
                  className={`flex ${message.role === "user" ? "justify-end" : "justify-start"}`}
                >
                  <div
                    className={`max-w-[90%] sm:max-w-xl rounded-xl px-4 sm:px-5 py-3 ${message.role === "user"
                      ? darkMode
                        ? "bg-[#7814E3] text-white"
                        : "bg-[#7814E3] bg-opacity-10 text-gray-50"
                      : darkMode
                        ? "bg-[#222222] text-gray-100"
                        : "bg-[#e9eaec] text-gray-800 border border-gray-200 shadow-sm"
                      }`}
                  >
                    <div className="whitespace-pre-wrap text-sm sm:text-base">{message.content}</div>
                  </div>
                </div>
              ))}
              {isTyping && (
                <div className="flex justify-start">
                  <div
                    className={`max-w-[90%] sm:max-w-xl rounded-xl px-4 sm:px-5 py-3 ${darkMode
                      ? "bg-[#222222] text-gray-100"
                      : "bg-[#e9eaec] text-gray-800 border border-gray-200 shadow-sm"
                      }`}
                  >
                    <div className="whitespace-pre-wrap text-sm sm:text-base">{typingText}</div>
                  </div>
                </div>
              )}
              {isLoading && !isTyping && (
                <div className="flex justify-start">
                  <div
                    className={`max-w-[90%] sm:max-w-xl rounded-xl px-4 sm:px-5 py-4 ${darkMode
                      ? "bg-[#222222] text-gray-100"
                      : "bg-[#e9eaec] text-gray-800 border border-gray-200 shadow-sm"
                      }`}
                  >
                    <div className="flex space-x-2 justify-center">
                      <div className="w-2 h-2 rounded-full bg-[#7814E3] animate-bounce"></div>
                      <div
                        className="w-2 h-2 rounded-full bg-[#7814E3] animate-bounce"
                        style={{ animationDelay: "0.2s" }}
                      ></div>
                      <div
                        className="w-2 h-2 rounded-full bg-[#7814E3] animate-bounce"
                        style={{ animationDelay: "0.4s" }}
                      ></div>
                    </div>
                  </div>
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>
          )}
        </div>

        {/* Input Area */}
        <div//
          className={`fixed bottom-0 left-0 right-0 z-40 ${sidebarOpen ? "md:ml-64" : "md:ml-0"} 
          ${darkMode ? "border-[#222222] bg-[#111111]" : "border-gray-200 bg-[#f3f4f6]"} 
          border-t px-4 sm:px-6 py-4 transition-colors duration-300`}
        >
          <div className="relative max-w-3xl mx-auto w-full">
            <textarea
              ref={inputRef}
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Message ComputeMesh..."
              disabled={isLoading || isTyping}
              rows={1}
              className={`w-full p-3 sm:p-4 pr-12 sm:pr-16 rounded-lg resize-none 
              ${darkMode ? "bg-[#1A1A1A] border-[#222222] text-white placeholder-gray-400 focus:ring-[#7814E3]"
                  : "bg-[#e9eaec] border-gray-200 text-gray-900 placeholder-gray-500 focus:ring-[#7814E3]"} 
              border focus:outline-none focus:ring-2 focus:border-transparent transition-colors duration-200 shadow-sm text-sm sm:text-base`}
              style={{ minHeight: "50px", maxHeight: "150px" }}
            />
            <button
              onClick={sendMessage}
              disabled={!inputValue.trim() || isLoading || isTyping}
              className={`absolute right-2 sm:right-3 top-1/2 transform -translate-y-1/2 p-2 rounded-md 
              ${!inputValue.trim() || isLoading || isTyping ? "bg-gray-400 cursor-not-allowed"
                  : "bg-[#7814E3] hover:bg-[#7814e3e9] shadow-sm"} text-white transition-all`}
            >
              <Send className="w-4 sm:w-5 h-4 sm:h-5" />
            </button>
          </div>
          <div className={`text-xs text-center mt-2 ${darkMode ? "text-gray-500" : "text-gray-400"}`}>
            ComputeMesh may produce inaccurate information about blockchain data or transactions.
          </div>
        </div>
      </div>
    </div>
  );
}

export default Dashboard;