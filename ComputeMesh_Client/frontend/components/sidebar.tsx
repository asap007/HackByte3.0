import { Home, MessageCircle, Plus, Settings } from 'lucide-react'
import Link from 'next/link'

export function Sidebar() {
  return (
    <div className="w-16 bg-[#12121f] border-r border-gray-800 flex flex-col h-screen">
      <Link href="/" className="p-4 text-purple-500 hover:bg-[#1f1f2f]">
        <Home className="w-6 h-6" />
      </Link>
      <Link href="/chat" className="p-4 text-gray-400 hover:bg-[#1f1f2f]">
        <MessageCircle className="w-6 h-6" />
      </Link>
      <Link href="/new" className="p-4 text-gray-400 hover:bg-[#1f1f2f]">
        <Plus className="w-6 h-6" />
      </Link>
      <div className="mt-auto">
        <Link href="/settings" className="p-4 text-gray-400 hover:bg-[#1f1f2f]">
          <Settings className="w-6 h-6" />
        </Link>
      </div>
    </div>
  )
}

