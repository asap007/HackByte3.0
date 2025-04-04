import { Info, BarChart2, Settings } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'

export function EarningsCard() {
  return (
    <Card className="bg-[#1a1a2e] border-0">
      <CardContent className="p-6">
        <div className="flex items-center gap-2 mb-4">
          <h2 className="text-gray-400">ESTIMATED EARNINGS</h2>
          <Info className="w-4 h-4 text-gray-400" />
          <div className="ml-auto flex gap-2">
            <button className="px-3 py-1 bg-[#12121f] text-gray-400 rounded">USD</button>
            <button className="px-3 py-1 text-gray-400 rounded">mBTC</button>
          </div>
        </div>

        <div className="mb-6">
          <div className="text-3xl text-white">$18.47 <span className="text-sm text-gray-400">/month</span></div>
        </div>

        <div className="mb-6">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-gray-400">PENDING</span>
            <Info className="w-4 h-4 text-gray-400" />
          </div>
          <div className="text-3xl text-white">$-,--</div>
        </div>

        <Button variant="destructive" className="w-full mb-4">
          Stop
        </Button>

        <div className="flex gap-4">
          <Button variant="outline" className="flex-1 bg-[#12121f] border-0 text-gray-400">
            <BarChart2 className="w-4 h-4 mr-2" />
            Benchmarks
          </Button>
          <Button variant="outline" className="flex-1 bg-[#12121f] border-0 text-gray-400">
            <Settings className="w-4 h-4 mr-2" />
            Settings
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

