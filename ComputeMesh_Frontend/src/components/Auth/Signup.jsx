"use client"

import { useState } from "react"
import { useAuth } from "../../App"
import { useNavigate } from "react-router-dom"

function Signup() {
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [name, setName] = useState("")
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState("")
  const [passwordStrength, setPasswordStrength] = useState(0)
  const { setUser } = useAuth()
  const navigate = useNavigate()

  const checkPasswordStrength = (password) => {
    let strength = 0
    if (password.length >= 8) strength += 1
    if (/[A-Z]/.test(password)) strength += 1
    if (/[0-9]/.test(password)) strength += 1
    if (/[^A-Za-z0-9]/.test(password)) strength += 1
    setPasswordStrength(strength)
  }

  const handleSignup = async (e) => {
    e.preventDefault()
    setIsLoading(true)
    setError("")

    try {
      const response = await fetch("http://localhost:8000/register", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          email,
          password,
          name,
        }),
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.detail || "Registration failed")
      }

      // After successful registration, automatically log in
      const loginResponse = await fetch("http://localhost:8000/token", {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          username: email,
          password,
        }),
      })

      if (!loginResponse.ok) {
        throw new Error("Registration successful but login failed")
      }

      const loginData = await loginResponse.json()
      localStorage.setItem("token", loginData.access_token)
      setUser({ email, name })
      navigate("/dashboard")
    } catch (err) {
      setError(err.message)
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="flex min-h-screen flex-col bg-gray-50">
      <div className="absolute top-6 left-6 flex items-center">
        <svg
          className="h-6 w-6 text-blue-600 mr-2"
          viewBox="0 0 24 24"
          fill="currentColor"
          xmlns="http://www.w3.org/2000/svg"
        >
          <path d="M12 2L2 7L12 12L22 7L12 2Z" />
          <path d="M2 17L12 22L22 17" />
          <path d="M2 12L12 17L22 12" />
        </svg>
        <span className="text-xl font-bold text-gray-900">ComputeMesh</span>
      </div>

      <div className="flex flex-1 flex-col items-center justify-center px-4">
        <div className="w-full max-w-md">
          <div className="mb-10 text-center">
            <h1 className="text-4xl font-bold mt-22 text-gray-900">Create an account</h1>
            <p className="text-gray-600 mt-2">Join ComputeMesh to get started</p>
            {error && (
              <div className="mt-4 p-3 bg-red-50 border border-red-200 text-red-700 rounded-md text-sm">{error}</div>
            )}
          </div>

          <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-md">
            <form onSubmit={handleSignup} className="space-y-4">
              <div>
                <label htmlFor="name" className="block text-sm font-medium text-gray-700">
                  Full name
                </label>
                <input
                  id="name"
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-blue-500"
                  placeholder="Your name"
                  required
                />
              </div>

              <div>
                <label htmlFor="email" className="block text-sm font-medium text-gray-700">
                  Email address
                </label>
                <input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-blue-500"
                  placeholder="name@example.com"
                  required
                />
              </div>

              <div>
                <label htmlFor="password" className="block text-sm font-medium text-gray-700">
                  Password
                </label>
                <input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => {
                    setPassword(e.target.value)
                    checkPasswordStrength(e.target.value)
                  }}
                  className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-blue-500"
                  placeholder="••••••••"
                  required
                />
                <div className="mt-2">
                  <div className="flex h-1 w-full space-x-1">
                    <div
                      className={`h-full w-1/4 rounded-l ${passwordStrength >= 1 ? "bg-red-400" : "bg-gray-200"}`}
                    ></div>
                    <div className={`h-full w-1/4 ${passwordStrength >= 2 ? "bg-yellow-400" : "bg-gray-200"}`}></div>
                    <div className={`h-full w-1/4 ${passwordStrength >= 3 ? "bg-blue-400" : "bg-gray-200"}`}></div>
                    <div
                      className={`h-full w-1/4 rounded-r ${passwordStrength >= 4 ? "bg-green-400" : "bg-gray-200"}`}
                    ></div>
                  </div>
                  <p className="mt-1 text-xs text-gray-500">
                    {passwordStrength === 0 && "Enter a password"}
                    {passwordStrength === 1 && "Weak - Use at least 8 characters"}
                    {passwordStrength === 2 && "Fair - Add uppercase letters"}
                    {passwordStrength === 3 && "Good - Add numbers"}
                    {passwordStrength === 4 && "Strong password"}
                  </p>
                </div>
              </div>

              <div className="pt-2">
                <button
                  type="submit"
                  className={`flex w-full justify-center rounded-md border border-transparent bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 transition-all duration-200 ${
                    isLoading ? "cursor-not-allowed opacity-70" : ""
                  }`}
                  disabled={isLoading}
                >
                  {isLoading ? (
                    <>
                      <svg
                        className="mr-2 h-4 w-4 animate-spin text-white"
                        xmlns="http://www.w3.org/2000/svg"
                        fill="none"
                        viewBox="0 0 24 24"
                      >
                        <circle
                          className="opacity-25"
                          cx="12"
                          cy="12"
                          r="10"
                          stroke="currentColor"
                          strokeWidth="4"
                        ></circle>
                        <path
                          className="opacity-75"
                          fill="currentColor"
                          d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                        ></path>
                      </svg>
                      Creating account...
                    </>
                  ) : (
                    "Sign up"
                  )}
                </button>
              </div>
            </form>
          </div>

          <div className="mt-6 text-center">
            <p className="text-sm text-gray-600">
              Already have an account?{" "}
              <a href="/" className="font-medium text-blue-600 hover:text-blue-500 hover:underline transition-all">
                Log in
              </a>
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}

export default Signup

