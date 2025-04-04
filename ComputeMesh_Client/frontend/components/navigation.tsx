import { Wallet, ShoppingCart, Gamepad2, LogOut } from 'lucide-react'
import Image from 'next/image'
import { Button } from '@/components/ui/button'

interface NavigationProps {
  onLogout: () => void;
userData: {
    email: string;
    name: string | null;
    profile_picture: string | null;
    dllm_tokens: number;
    referral_link: string | null;
  } | null;
}

export function Navigation({ onLogout, userData }: NavigationProps) {
// Generate display name from email if name is null
  const displayName = userData?.name || userData?.email?.split('@')[0] || 'User'
  
  // Generate avatar URL - use provided picture or fallback to UI avatars
  const avatarUrl = userData?.profile_picture || 
    `https://ui-avatars.com/api/?name=${encodeURIComponent(displayName)}&background=random&color=fff`

  return (
    <div className="flex justify-end items-center p-4 bg-[#1a1a2e] rounded-lg mb-6">
      {/* <div className="flex gap-8">
        <button className="flex items-center gap-2 text-yellow-400">
          <Wallet className="w-5 h-5" />
          <span>Wallet</span>
        </button>
        <button className="flex items-center gap-2 text-gray-400 hover:text-gray-300">
          <ShoppingCart className="w-5 h-5" />
          <span>Store</span>
        </button>
        <button className="flex items-center gap-2 text-gray-400 hover:text-gray-300">
          <Gamepad2 className="w-5 h-5" />
          <span>Play & Earn</span>
        </button>
      </div> */}
      {/* <div className="flex items-center gap-4">
        <div className="flex items-center gap-2 text-yellow-400">
          <Wallet className="w-5 h-5" />
          <span>{userData?.dllm_tokens || 0} DLLM</span>
        </div>
      </div> */}

      <div className="flex items-center gap-2">
        <Image
          src={avatarUrl}
          alt={displayName}
          width={32}
          height={32}
          className="rounded-full"
        />
        <span className="text-white">{displayName}</span>
        <Button 
          variant="ghost" 
          size="icon"
          onClick={onLogout}
          className="ml-2 text-gray-400 hover:text-red-500 hover:bg-red-500/10 transition-colors duration-200"
        >
          <LogOut className="h-4 w-4" />
        </Button>
      </div>
    </div>
  )
}

