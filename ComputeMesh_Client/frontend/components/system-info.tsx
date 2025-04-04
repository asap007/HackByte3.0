import { useEffect, useState } from "react"

export function SystemInfo() {
  const [systemInfo, setSystemInfo] = useState(null)

  useEffect(() => {
    const fetchSystemInfo = () => {
      const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://127.0.0.1:39281'
      
      fetch(`${API_URL}/v1/hardware`)
        .then((res) => res.json())
        .then((data) => setSystemInfo(data))
        .catch((err) => console.error("Failed to fetch system info:", err))
    }

    // Fetch immediately on mount
    fetchSystemInfo()

    // Set up interval to fetch every 2 seconds
    const intervalId = setInterval(fetchSystemInfo, 2000)

    // Clean up interval on component unmount
    return () => clearInterval(intervalId)
  }, [])

  if (!systemInfo) {
    return <div className="text-gray-400">Loading system info...</div>
  }

  const { cpu, gpus, ram } = systemInfo
  const nvidiaGpu = gpus.find((gpu) => gpu.name.includes("NVIDIA")) || gpus[0]
  const ramUsage = Math.round(((ram.total - ram.available) / ram.total) * 100)
  const vramUsage = nvidiaGpu
    ? Math.round(((nvidiaGpu.total_vram - nvidiaGpu.free_vram) / nvidiaGpu.total_vram) * 100)
    : 0

  return (
    <div className="flex items-center justify-between gap-6 p-4 bg-[#1a1a2e] rounded-lg text-sm">
      <div className="flex items-center gap-6">
        <span className="text-emerald-400 bg-emerald-400/10 px-2 py-1 rounded">AI READY</span>
        <span className="text-gray-400">{nvidiaGpu ? nvidiaGpu.name : "No GPU Detected"}</span>
        <span className="text-gray-400">{cpu.model}</span>
      </div>
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2">
          <span className="text-gray-400">RAM</span>
          <div className="w-20 h-2 bg-[#12121f] rounded">
            <div className="h-full bg-blue-500 rounded" style={{ width: `${ramUsage}%` }} />
          </div>
          <span className="text-gray-400">{ramUsage}%</span>
        </div>
        {nvidiaGpu && (
          <div className="flex items-center gap-2">
            <span className="text-gray-400">GPU VRAM</span>
            <div className="w-20 h-2 bg-[#12121f] rounded">
              <div className="h-full bg-purple-500 rounded" style={{ width: `${vramUsage}%` }} />
            </div>
            <span className="text-gray-400">{vramUsage}%</span>
          </div>
        )}
      </div>
    </div>
  )
}