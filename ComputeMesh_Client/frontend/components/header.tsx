import React from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Rocket } from 'lucide-react';

export function ComingSoonPopup({ open, onClose }) {
  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="bg-[#1a1a2e] border border-gray-800 text-white max-w-md">
        <DialogHeader>
          <DialogTitle className="text-center text-xl font-semibold flex items-center justify-center gap-2">
            <Rocket className="h-6 w-6 text-purple-500 animate-bounce" />
            Coming Soon!
          </DialogTitle>
        </DialogHeader>
        <div className="p-6 text-center">
          <p className="text-lg text-gray-300">
            Hang Tight. We are currently working on the feature! 🚀
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function Header({ userData, onConnectWallet }) {
  const [isPopupOpen, setIsPopupOpen] = React.useState(false);

  return (
    <header className="flex items-center justify-between px-4 py-2 bg-[#12121f] border-b border-gray-800">
      <div className="flex items-center gap-2">
        <img
          src="https://zgzfpxamyedvgkvh.public.blob.vercel-storage.com/ComputeMesh%20Logo-65v9DaySZ5gBRpTeCeLzqKF0nWaG8a.ico"
          alt="DLLM Logo"
          width={32}
          height={32}
          className="w-8 h-8"
        />
        <span className="text-white text-xl font-semibold">ComputeMesh</span>
        <span className="bg-[#1f1f2f] text-xs px-2 py-1 rounded">AI</span>
        <span className="text-gray-400 text-sm ml-2">0.0.1</span>
      </div>

      <div className="flex items-center gap-4">
        {userData?.wallet_address ? (
          <div className="flex items-center gap-2">
            <div className="bg-green-900/20 border border-green-700 rounded-lg px-3 py-1 flex items-center">
              <svg className="w-4 h-4 text-green-400 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <span className="text-green-200 text-sm">
                {userData.wallet_address.substring(0, 6)}...{userData.wallet_address.substring(58)}
              </span>
            </div>
            <Button 
              variant="outline"
              className="bg-gray-700 hover:bg-gray-600 text-white"
              onClick={onConnectWallet}
            >
              Change
            </Button>
          </div>
        ) : (
          <Button 
            className="bg-purple-500 hover:bg-purple-600"
            onClick={onConnectWallet}
          >
            Connect Wallet
          </Button>
        )}
        <ComingSoonPopup 
          open={isPopupOpen} 
          onClose={() => setIsPopupOpen(false)} 
        />
      </div>
    </header>
  );
}

export default Header;