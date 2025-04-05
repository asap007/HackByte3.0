import React, { useState, useEffect } from 'react';
import { Twitter, MessageSquare } from 'lucide-react';
import { Discord } from './icons';

export function StatusBar() {
  const [stats, setStats] = useState({
    dllm_price: { current: 0, yesterday: 0 },
    btc_price: { current: 0, yesterday: 0 },
    twitter_followers: 0,
    online_discord_users: 0,
    twitter_link: '',
    discord_link: '',
  });

  useEffect(() => {
    const fetchStats = async () => {
      try {
        const response = await fetch('https://acehack4-0-backend.onrender.com/public-stats');
        const data = await response.json();
        setStats(data);
      } catch (error) {
        console.error('Failed to fetch stats:', error);
      }
    };

    fetchStats();
    const intervalId = setInterval(fetchStats, 60000);
    return () => clearInterval(intervalId);
  }, []);

  const openInBrowser = (url) => {
    if (window.electron?.shell?.openExternal) {
      window.electron.shell.openExternal(url);
    } else {
      window.open(url, '_blank', 'noopener,noreferrer');
    }
  };

  const calculateChange = (current, yesterday) => {
    return (((current - yesterday) / yesterday) * 100).toFixed(2);
  };

  return (
    <div className="flex items-center justify-between p-4 bg-[#1a1a2e] rounded-lg text-sm">
      <div className="flex items-center gap-6">
        <div className="flex items-center gap-2">
          <span className="text-gray-400">Aptos (24h)</span>
          <span className="text-white">${stats.dllm_price.current.toFixed(3)}</span>
          <span
            className={`${
              calculateChange(stats.dllm_price.current, stats.dllm_price.yesterday) < 0
                ? 'text-red-500'
                : 'text-green-500'
            }`}
          >
            {Math.abs(calculateChange(stats.dllm_price.current, stats.dllm_price.yesterday))}%{' '}
            {calculateChange(stats.dllm_price.current, stats.dllm_price.yesterday) < 0 ? '↓' : '↑'}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-gray-400">BTC (24h)</span>
          <span className="text-white">${stats.btc_price.current.toLocaleString()}</span>
          <span
            className={`${
              calculateChange(stats.btc_price.current, stats.btc_price.yesterday) < 0
                ? 'text-red-500'
                : 'text-green-500'
            }`}
          >
            {Math.abs(calculateChange(stats.btc_price.current, stats.btc_price.yesterday))}%{' '}
            {calculateChange(stats.btc_price.current, stats.btc_price.yesterday) < 0 ? '↓' : '↑'}
          </span>
        </div>
      </div>

      <div className="flex items-center gap-6">
        <span className="text-gray-400">Find us on:</span>
        <div className="flex items-center gap-4">
          <a
            href={stats.twitter_link}
            onClick={(e) => {
              e.preventDefault();
              openInBrowser(stats.twitter_link);
            }}
            className="cursor-pointer flex items-center hover:opacity-80 transition-opacity"
          >
            <Twitter className="w-5 h-5 text-gray-400" />
            <span className="text-gray-400 ml-2">{stats.twitter_followers} FOLLOWERS</span>
          </a>
          <a
            href={stats.discord_link}
            onClick={(e) => {
              e.preventDefault();
              openInBrowser(stats.discord_link);
            }}
            className="cursor-pointer flex items-center hover:opacity-80 transition-opacity"
          >
            <Discord className="w-5 h-5 text-gray-400" />
            <span className="text-gray-400 ml-2">ONLINE {stats.online_discord_users}</span>
          </a>
        </div>
      </div>
    </div>
  );
}