'use client'

import { useState } from 'react'
import Image from 'next/image'
import { Mail, Lock } from 'lucide-react'
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Checkbox } from "@/components/ui/checkbox"
import { Card, CardContent } from "@/components/ui/card"
import axios from 'axios'

interface LoginFormProps {
  onLogin: (token: string) => void;
  onForgotPassword: () => void;
  onSignup: () => void;
}

export function LoginForm({ onLogin, onForgotPassword, onSignup }: LoginFormProps) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')

  const openInBrowser = (url) => {
    if (window.electron?.shell?.openExternal) {
      window.electron.shell.openExternal(url);
    } else {
      window.open(url, '_blank', 'noopener,noreferrer');
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    
    try {
      const response = await axios.post(
        'https://hackbyte3-0.onrender.com/token', 
        new URLSearchParams({
          username: email,
          password: password
        }),
        {
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded'
          }
        }
      )
      
      const token = response.data.access_token
      onLogin(token)
    } catch (err) {
      setError('Invalid email or password')
      console.error(err)
    }
  }

  return (
    <div className="min-h-screen bg-[#0a0a14] flex items-center justify-center p-4">
      <Card className="w-full max-w-md bg-[#12121f] border-0 shadow-2xl">
        <CardContent className="pt-12 pb-8 px-8">
          <div className="flex justify-center mb-8">
            <div className="flex items-center gap-2">
              <Image 
                src="https://zgzfpxamyedvgkvh.public.blob.vercel-storage.com/ComputeMesh%20Logo-65v9DaySZ5gBRpTeCeLzqKF0nWaG8a.ico" 
                alt="DLLM Logo" 
                width={32} 
                height={32} 
              />
              <span className="text-white text-xl font-semibold">ComputeMesh</span>
              <span className="bg-[#1f1f2f] text-xs px-2 py-1 rounded">AI</span>
            </div>
          </div>

          <h1 className="text-2xl font-semibold text-white text-center mb-8">
            Login
          </h1>

          <form onSubmit={handleSubmit} className="space-y-6">
            {error && (
              <div className="text-red-500 text-center mb-4">
                {error}
              </div>
            )}

            <div className="relative">
              <Mail className="absolute left-3 top-3 h-5 w-5 text-gray-400" />
              <Input
                type="email"
                placeholder="Your email"
                className="pl-10 bg-[#1f1f2f] border-0 text-white placeholder:text-gray-400"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>

            <div className="relative">
              <Lock className="absolute left-3 top-3 h-5 w-5 text-gray-400" />
              <Input
                type="password"
                placeholder="Password"
                className="pl-10 bg-[#1f1f2f] border-0 text-white placeholder:text-gray-400"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>

            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <Checkbox id="remember" defaultChecked={true} className="border-gray-400 data-[state=checked]:bg-purple-500" />
                <label
                  htmlFor="remember"
                  className="text-sm font-medium text-gray-400 leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
                >
                  Remember me
                </label>
              </div>
              <button 
                type="button" 
                onClick={onForgotPassword}
                className="text-sm text-blue-400 hover:text-blue-300"
              >
                Forgot password?
              </button>
            </div>

            <Button type="submit" className="w-full bg-purple-500 hover:bg-purple-600 text-white">
              Login
            </Button>

            <div className="text-center">
              <span className="text-gray-400">Don't have an account?</span>
              <button
                type="button"
                onClick={(e) => {
                  e.preventDefault();
                  openInBrowser('https://hackbyte3-0.onrender.com/signup');
                }}
                className="ml-2 text-blue-400 hover:text-blue-300"
              >
                Sign up
              </button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}