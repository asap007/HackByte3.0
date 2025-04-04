"use client"

import { BrowserRouter as Router, Routes, Route, Navigate } from "react-router-dom"
import { useState, useEffect, createContext, useContext } from "react"
import Login from "./components/Auth/Login"
import Signup from "./components/Auth/Signup"
import Dashboard from "./pages/Dashboard"
import "./styles/global.css"

// Authentication Context
const AuthContext = createContext()
export const useAuth = () => useContext(AuthContext)

function App() {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)

  // Check for existing user session on app load
  useEffect(() => {
    const token = localStorage.getItem("token")
    const savedUser = localStorage.getItem("user")

    if (token && savedUser) {
      try {
        setUser(JSON.parse(savedUser))
      } catch (error) {
        console.error("Error parsing saved user:", error)
        localStorage.removeItem("user")
        localStorage.removeItem("token")
      }
    }

    setLoading(false)
  }, [])

  // Update localStorage when user changes
  useEffect(() => {
    if (user) {
      localStorage.setItem("user", JSON.stringify(user))
    }
  }, [user])

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gray-50">
        <div className="flex space-x-2">
          <div className="h-3 w-3 animate-pulse rounded-full bg-blue-400 delay-100"></div>
          <div className="h-3 w-3 animate-pulse rounded-full bg-blue-500 delay-200"></div>
          <div className="h-3 w-3 animate-pulse rounded-full bg-blue-600 delay-300"></div>
        </div>
      </div>
    )
  }

  return (
    <AuthContext.Provider value={{ user, setUser }}>
      <Router>
        <Routes>
          <Route path="/" element={user ? <Navigate to="/dashboard" /> : <Login />} />
          <Route path="/signup" element={<Signup />} />
          <Route path="/dashboard" element={user ? <Dashboard /> : <Navigate to="/" />} />
        </Routes>
      </Router>
    </AuthContext.Provider>
  )
}

export default App

