import { ExternalLink, Flame } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import Image from "next/image";
import { useEffect, useState } from "react";

interface Agent {
  agent_name: string;
  agent_link: string;
  score: number;
}

export function TrendingAgentsCard() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const openInBrowser = (url) => {
    if (window.electron?.shell?.openExternal) {
      window.electron.shell.openExternal(url);
    } else {
      window.open(url, '_blank', 'noopener,noreferrer');
    }
  };

  const fetchAgents = async () => {
    try {
      setError(null);
      const response = await fetch("http://localhost:8000/leaderboard/agents");
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      const data = await response.json();
      // Sort agents by score in descending order
      const sortedAgents = [...data].sort((a, b) => b.score - a.score);
      setAgents(sortedAgents);
    } catch (error) {
      console.error("Error fetching agent leaderboard:", error);
      setError("Failed to load agents");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    // Initial fetch
    fetchAgents();

    // Set up polling every 30 seconds
    const intervalId = setInterval(fetchAgents, 30000);

    // Cleanup interval on component unmount
    return () => clearInterval(intervalId);
  }, []);

  const openInfoUrl = (url: string) => {
    window.open(url, "_blank", "noopener,noreferrer");
  };

  const handleSeeMore = () => {
    // Implement your see more logic here
    console.log("Show more agents");
  };

  return (
    <Card className="bg-[#1a1a2e] border-0">
      <CardHeader>
        <CardTitle className="text-white flex items-center justify-center">
          <Flame className="w-5 h-5 text-orange-500 mr-2" />
          <span>Trending Agents</span>
          <Flame className="w-5 h-5 text-orange-500 ml-2" />
        </CardTitle>
      </CardHeader>
      <CardContent>
        {loading ? (
          <p className="text-gray-400 text-center">Loading...</p>
        ) : error ? (
          <p className="text-red-400 text-center">{error}</p>
        ) : agents.length === 0 ? (
          <p className="text-gray-400 text-center">No agents found</p>
        ) : (
          <div className="space-y-4">
            {agents.map((agent, index) => (
              <div
                key={`${agent.agent_name}-${index}`}
                className="flex items-center justify-between"
              >
                <div className="flex items-center gap-3">
                  <Image
                    src={`https://ui-avatars.com/api/?name=${encodeURIComponent(agent.agent_name)}&background=random&color=fff`}
                    alt={agent.agent_name}
                    width={24}
                    height={24}
                    className="rounded-full"
                  />
                  <span className="text-white">{agent.agent_name}</span>
                </div>
                <div className="flex items-center gap-4">
                  <span className="text-gray-400">{agent.score}</span>
                  <Button
                    variant="outline"
                    size="sm"
                    className="bg-[#12121f] border-0 text-gray-400 hover:text-white hover:bg-[#1f1f2f] px-3"
                    onClick={() => openInfoUrl(agent.agent_link)}
                  >
                    Go
                    <ExternalLink className="ml-2 h-3 w-3" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
      <CardFooter>
        <Button
          className="w-full bg-purple-500 hover:bg-purple-600 text-white"
          onClick={(e) => {
            e.preventDefault();
            openInBrowser('http://localhost:8000/leaderboard/agents/all');
          }}
          disabled={loading || !!error}
        >
          See More Agents
        </Button>
      </CardFooter>
    </Card>
  );
}

export default TrendingAgentsCard;