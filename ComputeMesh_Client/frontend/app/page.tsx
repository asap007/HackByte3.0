'use client'

import { useState, useEffect } from "react"
import axios from "axios"
import { Header } from "../components/header"
import { Navigation } from "../components/navigation"
import { TrendingAgentsCard } from "../components/trending-agents-card"
import { MiningCard } from "../components/mining-card"
import { Leaderboard } from "../components/leaderboard"
import { SystemInfo } from "../components/system-info"
import { StatusBar } from "../components/status-bar"
import { LoginForm } from "../components/login-form"
import { ForgotPassword } from "../components/forgot-password"
import { Head } from "react-day-picker"
import UpdateModal from "../components/update-modal";

type AuthState = "login" | "forgotPassword" | "authenticated"

interface UserData {
  email: string
  name: string | null
  profile_picture: string | null
  dllm_tokens: number
  referral_link: string | null
  wallet_address: string | null
}

export default function Dashboard() {
  const [authState, setAuthState] = useState<AuthState>("login")
  const [token, setToken] = useState<string | null>(null)
  const [userData, setUserData] = useState<UserData | null>(null)
  const [resetMessage, setResetMessage] = useState("")
  const [updateReady, setUpdateReady] = useState(false)
  const [walletModalOpen, setWalletModalOpen] = useState(false)
  const [walletAddress, setWalletAddress] = useState("")
  const [walletError, setWalletError] = useState("")

  useEffect(() => {
    if (window.electronAPI) {
      window.electronAPI.onUpdateDownloaded(() => {
        setUpdateReady(true);
      });
    }
  }, []);

  useEffect(() => {
    const storedToken = localStorage.getItem('authToken');
    const explicitLogout = localStorage.getItem('explicitLogout');

    if (storedToken && explicitLogout !== 'true') {
      validateToken(storedToken);
    }
  }, []);

  useEffect(() => {
    const registerDevice = async () => {
      try {
        const deviceId = await window.electronAPI.getMachineId();
        await axios.post('https://hackbyte3-0.onrender.com/device-registration', {
          device_id: deviceId
        }, {
          headers: {
            'Content-Type': 'application/json'
          }
        });
        console.log('Device registered successfully');
      } catch (error) {
        console.error('Device registration failed:', error);
      }
    };

    registerDevice();
  }, []);

  const validateToken = async (token: string) => {
    try {
      const response = await axios.get('https://hackbyte3-0.onrender.com/user', {
        headers: { 'Authorization': `Bearer ${token}` }
      })
      setUserData(response.data)
      setToken(token)
      setAuthState("authenticated")
    } catch (error) {
      localStorage.removeItem('authToken')
      sessionStorage.removeItem('miningTime')
      sessionStorage.removeItem('miningPending')
      setAuthState("login")
    }
  }

  const handleLogin = async (receivedToken: string) => {
    localStorage.setItem('authToken', receivedToken);
    localStorage.removeItem('explicitLogout');

    try {
      const response = await axios.get('https://hackbyte3-0.onrender.com/user', {
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
    localStorage.removeItem('authToken');
    localStorage.removeItem('updateDeferred');
    localStorage.setItem('explicitLogout', 'true');
    sessionStorage.removeItem('miningTime');
    sessionStorage.removeItem('miningPending');
    setToken(null);
    setUserData(null);
    setAuthState("login");
  };

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

  const validateAptosAddress = (address: string): boolean => {
    // Basic Aptos address validation (0x followed by 64 hex characters)
    return /^0x[0-9a-fA-F]{64}$/.test(address);
  }

  const handleConnectWallet = async () => {
    if (!validateAptosAddress(walletAddress)) {
      setWalletError("Please enter a valid Aptos address (0x followed by 64 hex characters)");
      return;
    }

    try {
      // Save wallet address to user profile
      const response = await axios.patch(
        'https://hackbyte3-0.onrender.com/user/wallet',
        { wallet_address: walletAddress },
        { headers: { 'Authorization': `Bearer ${token}` } }
      );

      setUserData({ ...userData, wallet_address: walletAddress });
      setWalletModalOpen(false);
      setWalletAddress("");
      setWalletError("");
    } catch (error) {
      console.error("Error saving wallet address:", error);
      setWalletError("Failed to connect wallet. Please try again.");
    }
  }

  if (authState === "login") {
    return (
      <>
        {updateReady && <UpdateModal isAuthenticated={authState === "authenticated"} />}
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
      {updateReady && <UpdateModal isAuthenticated={authState === "authenticated"} />}
      
      {/* Wallet Connection Modal */}
      {walletModalOpen && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-[#1a1a2e] p-6 rounded-lg w-full max-w-md">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-xl font-semibold text-white">Connect Aptos Wallet</h2>
              <button 
                onClick={() => setWalletModalOpen(false)}
                className="text-gray-400 hover:text-white"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            
            <div className="mb-4">
              <label className="block text-gray-400 mb-2">Enter your Aptos wallet address</label>
              <input
                type="text"
                value={walletAddress}
                onChange={(e) => setWalletAddress(e.target.value)}
                placeholder="0x..."
                className="w-full bg-[#12121f] border border-gray-700 rounded-md py-2 px-3 text-white focus:outline-none focus:ring-2 focus:ring-purple-500"
              />
              {walletError && (
                <p className="mt-2 text-red-400 text-sm">{walletError}</p>
              )}
            </div>
            
            <div className="flex justify-end space-x-3">
              <button
                onClick={() => setWalletModalOpen(false)}
                className="px-4 py-2 bg-gray-700 text-white rounded-md hover:bg-gray-600 transition"
              >
                Cancel
              </button>
              <button
                onClick={handleConnectWallet}
                className="px-4 py-2 bg-purple-600 text-white rounded-md hover:bg-purple-700 transition"
              >
                Connect
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="flex-1">
        <Header 
          userData={userData} 
          onConnectWallet={() => setWalletModalOpen(true)}
        />
        <div className="mb-4"></div>
        <Navigation 
          onLogout={handleLogout} 
          userData={userData} 
        />
        
        <main className="p-6 pt-0 pb-0">
          <div className="grid grid-cols-3 gap-6 mb-6">
            <TrendingAgentsCard />
            <MiningCard />
            <Leaderboard />
          </div>

          <div className="space-y-4">
            <SystemInfo />
            <StatusBar />
          </div>
        </main>
      </div>
    </div>
  )
}