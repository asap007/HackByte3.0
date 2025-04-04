'use client'

import { useState } from 'react'
import Image from 'next/image'
import { Mail } from 'lucide-react'
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent } from "@/components/ui/card"

interface ForgotPasswordProps {
  onResetPassword: (email: string) => void;
  onBackToLogin: () => void;
}

export function ForgotPassword({ onResetPassword, onBackToLogin }: ForgotPasswordProps) {
  const [email, setEmail] = useState('')

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    onResetPassword(email)
  }

  return (
    <div className="min-h-screen bg-[#0a0a14] flex items-center justify-center p-4">
      <Card className="w-full max-w-md bg-[#12121f] border-0 shadow-2xl">
        <CardContent className="pt-12 pb-8 px-8">
          <div className="flex justify-center mb-8">
            <div className="flex items-center gap-2">
              {/* <Image 
                src="https://hebbkx1anhila5yf.public.blob.vercel-storage.com/Dashboard-8-Stop-KDzTq1PeganTG5K7kOwo9kypEENwcG.png" 
                alt="DLLM Logo" 
                width={32} 
                height={32} 
              /> */}
              <span className="text-white text-xl font-semibold">ComputeMesh</span>
              <span className="bg-[#1f1f2f] text-xs px-2 py-1 rounded">AI</span>
            </div>
          </div>

          <h1 className="text-2xl font-semibold text-white text-center mb-8">
            Reset Password
          </h1>

          <form onSubmit={handleSubmit} className="space-y-6">
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

            <Button type="submit" className="w-full bg-purple-500 hover:bg-purple-600 text-white">
              Reset Password
            </Button>

            <div className="text-center">
              <button
                type="button"
                onClick={onBackToLogin}
                className="text-sm text-blue-400 hover:text-blue-300"
              >
                Back to Login
              </button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}

