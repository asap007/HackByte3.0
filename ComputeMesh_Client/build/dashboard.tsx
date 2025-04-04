'use client'

import { useState, useEffect } from "react"
import axios from "axios"
import { Header } from "./components/header"
import { Navigation } from "./components/navigation"
import { TrendingAgentsCard } from "./components/trending-agents-card"
import { MiningCard } from "./components/mining-card"
import { Leaderboard } from "./components/leaderboard"
import { SystemInfo } from "./components/system-info"
import { StatusBar } from "./components/status-bar"
import { LoginForm } from "./components/login-form"
import { ForgotPassword } from "./components/forgot-password"
import { Head } from "react-day-picker"

type AuthState = "login" | "forgotPassword" | "authenticated"

interface UserData {
  email: string
  name: string | null
  profile_picture: string | null
  dllm_tokens: number
  referral_link: string | null
}

export default function Dashboard() {
  const [authState, setAuthState] = useState<AuthState>("login")
  const [token, setToken] = useState<string | null>(null)
  const [userData, setUserData] = useState<UserData | null>(null)
  const [resetMessage, setResetMessage] = useState("")

  useEffect(() => {
    const storedToken = localStorage.getItem('authToken')
    if (storedToken) {
      validateToken(storedToken)
    }
  }, [])

  const validateToken = async (token: string) => {
    try {
      const response = await axios.get('http://server.dllm.chat:8000/user', {
        headers: { 'Authorization': `Bearer ${token}` }
      })
      setUserData(response.data)
      setToken(token)
      setAuthState("authenticated")
    } catch (error) {
      localStorage.removeItem('authToken')
      setAuthState("login")
    }
  }

  const handleLogin = async (receivedToken: string) => {
    localStorage.setItem('authToken', receivedToken)
    
    try {
      const response = await axios.get('http://server.dllm.chat:8000/user', {
        headers: { 'Authorization': `Bearer ${receivedToken}` }
      })
      setUserData(response.data)
      setToken(receivedToken)
      setAuthState("authenticated")
    } catch (error) {
      localStorage.removeItem('authToken')
      setAuthState("login")
    }
  }

  const handleLogout = () => {
    localStorage.removeItem('authToken')
    setToken(null)
    setUserData(null)
    setAuthState("login")
  }

  const handleForgotPassword = () => {
    setAuthState("forgotPassword")
  }

  const handleResetPassword = (email: string) => {
    console.log("Password reset requested for:", email)
    setResetMessage("Password reset link has been sent to your email.")
    setAuthState("login")
  }

  const handleBackToLogin = () => {
    setAuthState("login")
  }

  const handleSignup = () => {
    console.log("Navigate to signup page")
  }

  if (authState === "login") {
    return (
      <>
        <LoginForm 
          onLogin={handleLogin} 
          onForgotPassword={handleForgotPassword} 
          onSignup={handleSignup} 
        />
        {resetMessage && (
          <div className="fixed bottom-4 right-4 bg-green-500 text-white p-4 rounded-md shadow-lg">
            {resetMessage}
          </div>
        )}
      </>
    )
  }

  if (authState === "forgotPassword") {
    return (
      <ForgotPassword 
        onResetPassword={handleResetPassword} 
        onBackToLogin={handleBackToLogin} 
      />
    )
  }

  return (
    <div className="min-h-screen bg-[#0a0a14] flex">
      <div className="flex-1">
      <Header />
        <div className="mb-6"></div>
        <Navigation 
          onLogout={handleLogout} 
          userData={userData} 
        />
        <main className="p-6 pb-0">
          <div className="grid grid-cols-3 gap-6 mb-6">
            <TrendingAgentsCard />
            <MiningCard />
            <Leaderboard />
          </div>
          
          <div className="space-y-6">
            {/* <div className="bg-[#1a1a2e] p-4 rounded-lg">
              <div className="flex items-start gap-4 mb-4">
                <div className="p-2 bg-[#12121f] rounded">
                  <svg
                    className="w-4 h-4 text-gray-400"
                    viewBox="0 0 24 24"
                    fill="none"
                    xmlns="http://www.w3.org/2000/svg"
                  >
                    <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2" />
                    <path d="M12 8v4M12 16h.01" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                  </svg>
                </div>
                <div className="flex-1">
                  <p className="text-gray-400">
                    We have an exciting news! Our mining bonus system is now more advantageous for GPU users than for ASIC users.
                  </p>
                </div>
              </div>
              <img src="/placeholder.svg" alt="Promotional Banner" className="w-full h-32 object-cover rounded-lg" />
            </div> */}
            <SystemInfo />
            <StatusBar />
          </div>
        </main>
      </div>
    </div>
  )
}