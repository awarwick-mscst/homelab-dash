import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { getScans, createScan, cancelScan } from '@/api/scans'
import { useWebSocket } from '@/hooks/useWebSocket'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Play, Square, Scan } from 'lucide-react'
import type { ScanProfile, ScanStatus } from '@/types'

const profileLabels: Record<ScanProfile, string> = {
  ping_sweep: 'Ping Sweep',
  port_scan: 'Port Scan',
  os_detect: 'OS Detection',
  full: 'Full Scan',
}

const statusVariant: Record<ScanStatus, 'default' | 'secondary' | 'success' | 'destructive' | 'warning'> = {
  pending: 'secondary',
  running: 'default',
  completed: 'success',
  failed: 'destructive',
  cancelled: 'warning',
}

export default function ScannerPage() {
  const queryClient = useQueryClient()
  const [target, setTarget] = useState('')
  const [profile, setProfile] = useState<ScanProfile>('ping_sweep')

  const { data: scans = [] } = useQuery({ queryKey: ['scans'], queryFn: getScans })

  useWebSocket((msg) => {
    if (msg.type === 'scan_status') {
      queryClient.invalidateQueries({ queryKey: ['scans'] })
    }
  })

  const startMutation = useMutation({
    mutationFn: () => createScan(target, profile),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['scans'] })
      setTarget('')
    },
  })

  const cancelMutation = useMutation({
    mutationFn: cancelScan,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['scans'] }),
  })

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold">Network Scanner</h1>

      <Card>
        <CardHeader><CardTitle>New Scan</CardTitle></CardHeader>
        <CardContent>
          <form onSubmit={(e) => { e.preventDefault(); startMutation.mutate() }} className="flex gap-3">
            <Input
              placeholder="Target (e.g., 192.168.1.0/24)"
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              className="flex-1"
              required
            />
            <Select value={profile} onValueChange={(v) => setProfile(v as ScanProfile)}>
              <SelectTrigger className="w-48">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(profileLabels).map(([value, label]) => (
                  <SelectItem key={value} value={value}>{label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button type="submit" disabled={startMutation.isPending}>
              <Play className="h-4 w-4 mr-2" />Start
            </Button>
          </form>
        </CardContent>
      </Card>

      {scans.length === 0 ? (
        <Card>
          <CardContent className="p-12 text-center text-muted-foreground">
            <Scan className="h-12 w-12 mx-auto mb-4 opacity-50" />
            <p>No scans yet. Start a scan to discover devices on your network.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="rounded-md border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/50">
                <th className="p-3 text-left font-medium">ID</th>
                <th className="p-3 text-left font-medium">Target</th>
                <th className="p-3 text-left font-medium">Profile</th>
                <th className="p-3 text-left font-medium">Status</th>
                <th className="p-3 text-left font-medium">Progress</th>
                <th className="p-3 text-left font-medium">Hosts</th>
                <th className="p-3 text-left font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {scans.map((scan) => (
                <tr key={scan.id} className="border-b hover:bg-muted/30">
                  <td className="p-3">#{scan.id}</td>
                  <td className="p-3 font-mono">{scan.target}</td>
                  <td className="p-3">{profileLabels[scan.profile]}</td>
                  <td className="p-3">
                    <Badge variant={statusVariant[scan.status]}>{scan.status}</Badge>
                  </td>
                  <td className="p-3">
                    {scan.status === 'running' ? (
                      <div className="w-24 bg-muted rounded-full h-2">
                        <div className="bg-primary rounded-full h-2 transition-all" style={{ width: `${scan.progress}%` }} />
                      </div>
                    ) : (
                      `${scan.progress}%`
                    )}
                  </td>
                  <td className="p-3">{scan.hosts_found}</td>
                  <td className="p-3">
                    {(scan.status === 'pending' || scan.status === 'running') && (
                      <Button variant="ghost" size="sm" onClick={() => cancelMutation.mutate(scan.id)}>
                        <Square className="h-3 w-3 mr-1" />Cancel
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
