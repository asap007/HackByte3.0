"use client"

import { useState, useEffect } from "react"
import { useAuth } from "../../App"
import { useNavigate } from "react-router-dom"

function Login() {
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState("")
  const [rememberMe, setRememberMe] = useState(false)
  const { setUser } = useAuth()
  const navigate = useNavigate()

  // Check for saved email
  useEffect(() => {
    const savedEmail = localStorage.getItem("rememberedEmail")
    if (savedEmail) {
      setEmail(savedEmail)
      setRememberMe(true)
    }
  }, [])

  const handleLogin = async (e) => {
    e.preventDefault()
    setIsLoading(true)
    setError("")

    try {
      const response = await fetch("https://acehack4-0-backend.onrender.com/token", {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          username: email,
          password,
        }),
      })

      if (!response.ok) {
        throw new Error(response.status === 401 ? "Invalid email or password" : "Login failed")
      }

      const data = await response.json()
      localStorage.setItem("token", data.access_token)

      // Handle remember me
      if (rememberMe) {
        localStorage.setItem("rememberedEmail", email)
      } else {
        localStorage.removeItem("rememberedEmail")
      }

      setUser({ email, name: data.name || email.split("@")[0] })
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
            <h1 className="text-4xl font-bold mb-2 text-gray-900">Welcome Back!</h1>
            <p className="text-gray-600">Sign in to continue to ComputeMesh</p>
            {error && (
              <div className="mt-4 p-3 bg-red-50 border border-red-200 text-red-700 rounded-md text-sm">{error}</div>
            )}
          </div>

          <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-md">
            <form onSubmit={handleLogin} className="space-y-4">
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
                <div className="flex items-center justify-between">
                  <label htmlFor="password" className="block text-sm font-medium text-gray-700">
                    Password
                  </label>
                  <a href="#" className="text-sm font-medium text-blue-600 hover:text-blue-500">
                    Forgot password?
                  </a>
                </div>
                <input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-blue-500"
                  placeholder="••••••••"
                  required
                />
              </div>

              <div className="flex items-center">
                <input
                  id="remember-me"
                  type="checkbox"
                  checked={rememberMe}
                  onChange={(e) => setRememberMe(e.target.checked)}
                  className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                />
                <label htmlFor="remember-me" className="ml-2 block text-sm text-gray-700">
                  Remember me
                </label>
              </div>

              <div>
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
                      Logging in...
                    </>
                  ) : (
                    "Log in"
                  )}
                </button>
              </div>
            </form>
          </div>

          <div className="mt-6 text-center">
            <p className="text-sm text-gray-600">
              Don't have an account?{" "}
              <a
                href="/signup"
                className="font-medium text-blue-600 hover:text-blue-500 hover:underline transition-all"
              >
                Sign up
              </a>
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}

export default Login

