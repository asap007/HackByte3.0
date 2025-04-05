import React, { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Check, Crown, Cpu, Share2, Copy } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import Image from "next/image";

export function ClipboardNotification({ open, onClose }) {
  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="bg-[#1a1a2e] border border-gray-800 text-white max-w-md">
        <DialogHeader>
          <DialogTitle className="text-center text-xl font-semibold flex items-center justify-center gap-2">
            <Check className="h-6 w-6 text-green-500 animate-bounce" />
            Copied Successfully!
          </DialogTitle>
        </DialogHeader>
        <div className="p-6 text-center">
          <p className="text-lg text-gray-300">
            The invite link has been copied to your clipboard 🎉
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function Leaderboard() {
  const [leaderboardData, setLeaderboardData] = useState([]);
  const [showInviteLink, setShowInviteLink] = useState(false);
  const [popupPosition, setPopupPosition] = useState({ top: 0, left: 0 });
  const [activeNodes, setActiveNodes] = useState(0);
  const [referralLink, setReferralLink] = useState(null);
  const [isNotificationOpen, setIsNotificationOpen] = useState(false);

  const fetchLeaderboardData = async () => {
    try {
      const response = await fetch("https://hackbyte3-0.onrender.com/leaderboard/users");
      const data = await response.json();
      const sortedData = data.sort((a, b) => b.score - a.score);
      setLeaderboardData(sortedData);
    } catch (error) {
      console.error("Error fetching leaderboard:", error);
    }
  };

  const fetchPublicStats = async () => {
    try {
      const response = await fetch("https://hackbyte3-0.onrender.com/public-stats");
      const data = await response.json();
      setActiveNodes(data.active_nodes);
    } catch (error) {
      console.error("Error fetching public stats:", error);
    }
  };

  const fetchUserData = async () => {
    try {
      const token = localStorage.getItem('authToken');
      if (!token) {
        console.error("No auth token found");
        return;
      }

      const response = await fetch("https://hackbyte3-0.onrender.com/user", {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      const data = await response.json();
      setReferralLink(data.referral_link);
    } catch (error) {
      console.error("Error fetching user data:", error);
    }
  };

  useEffect(() => {
    fetchLeaderboardData();
    fetchPublicStats();
    fetchUserData();

    const leaderboardInterval = setInterval(fetchLeaderboardData, 30000);
    const statsInterval = setInterval(fetchPublicStats, 30000);

    return () => {
      clearInterval(leaderboardInterval);
      clearInterval(statsInterval);
    };
  }, []);

  const toggleInviteLink = (event) => {
    const rect = event.currentTarget.getBoundingClientRect();
    setPopupPosition({ top: rect.bottom + window.scrollY, left: rect.left + window.scrollX });
    setShowInviteLink(!showInviteLink);
  };

  const copyInviteLink = () => {
    const textToCopy = referralLink === null ? "Null" : referralLink;
    navigator.clipboard.writeText(textToCopy);
    setIsNotificationOpen(true);
    setShowInviteLink(false);
  };

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (showInviteLink && !event.target.closest('.invite-popup')) {
        setShowInviteLink(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showInviteLink]);

  return (
    <Card className="bg-[#1a1a2e] border-0">
      <CardHeader>
        <CardTitle className="flex items-center justify-center text-white">
          <Crown className="w-5 h-5 text-yellow-400 mr-2" />
          <span>LEADERBOARD</span>
          <Crown className="w-5 h-5 text-yellow-400 ml-2" />
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {leaderboardData.map((item, index) => (
            <div key={index} className="flex items-center gap-3">
              <span className="text-gray-400 w-6">{index + 1}.</span>
              <Image
                src={`https://ui-avatars.com/api/?name=${encodeURIComponent(item.username)}&background=random&color=fff`}
                alt={item.username}
                width={24}
                height={24}
                className="rounded-full"
              />
              <span className="text-gray-400">{item.username}</span>
              <span className="ml-auto text-white">{item.score}</span>
            </div>
          ))}
        </div>

        <div className="mt-6 pt-4 border-t border-gray-800">
          <div className="flex items-center justify-between text-gray-400">
            <div className="flex items-center gap-2">
              <Cpu className="w-4 h-4" />
              <span>No. of active nodes</span>
            </div>
            <span className="text-white">{activeNodes}</span>
          </div>
        </div>

        <div className="mt-4 space-y-2">
          <Button 
            onClick={toggleInviteLink} 
            className="w-full bg-purple-500 hover:bg-purple-600 text-white"
          >
            <Share2 className="w-4 h-4 mr-2" />
            Invite a friend and earn in Aptos
          </Button>
          {showInviteLink && (
            <div 
              className="absolute z-10 p-2 bg-gray-800 rounded-lg shadow-lg invite-popup" 
              style={{ top: `${popupPosition.top}px`, left: `${popupPosition.left}px` }}
            >
              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-300 truncate mr-2">
                  {referralLink === null ? "Null" : referralLink}
                </span>
                <Button 
                  onClick={copyInviteLink} 
                  variant="ghost" 
                  size="sm" 
                  className="text-gray-400 hover:text-gray-700"
                >
                  <Copy className="w-4 h-4" />
                </Button>
              </div>
            </div>
          )}
        </div>
      </CardContent>
      <ClipboardNotification
        open={isNotificationOpen}
        onClose={() => setIsNotificationOpen(false)}
      />
    </Card>
  );
}

export default Leaderboard;