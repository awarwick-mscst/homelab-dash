import { useState, useCallback } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { getScans, createScan, cancelScan, deleteScan } from '@/api/scans'
import { useWebSocket } from '@/hooks/useWebSocket'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Play, Square, Scan, Trash2 } from 'lucide-react'
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

interface ScanLiveInfo {
  progress: number
  message: string
}

export default function ScannerPage() {
  const queryClient = useQueryClient()
  const [target, setTarget] = useState('')
  const [profile, setProfile] = useState<ScanProfile>('ping_sweep')
  const [customPorts, setCustomPorts] = useState('')
  const [liveInfo, setLiveInfo] = useState<Record<number, ScanLiveInfo>>({})

  const { data: scans = [] } = useQuery({ queryKey: ['scans'], queryFn: getScans })

  useWebSocket(useCallback((msg: Record<string, unknown>) => {
    if (msg.type === 'scan_status') {
      const scanId = msg.scan_id as number
      if (msg.status === 'running') {
        setLiveInfo(prev => ({
          ...prev,
          [scanId]: {
            progress: (msg.progress as number) ?? prev[scanId]?.progress ?? 0,
            message: (msg.message as string) ?? prev[scanId]?.message ?? '',
          },
        }))
      } else {
        // Scan finished — clear live info
        setLiveInfo(prev => {
          const next = { ...prev }
          delete next[scanId]
          return next
        })
      }
      queryClient.invalidateQueries({ queryKey: ['scans'] })
    }
  }, [queryClient]))

  const startMutation = useMutation({
    mutationFn: () => createScan(target, profile, customPorts || undefined),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['scans'] })
      setTarget('')
      setCustomPorts('')
    },
  })

  const cancelMutation = useMutation({
    mutationFn: cancelScan,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['scans'] }),
  })

  const deleteMutation = useMutation({
    mutationFn: deleteScan,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['scans'] }),
  })

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold">Network Scanner</h1>

      <Card>
        <CardHeader><CardTitle>New Scan</CardTitle></CardHeader>
        <CardContent>
          <form onSubmit={(e) => { e.preventDefault(); startMutation.mutate() }} className="space-y-3">
            <div className="flex gap-3">
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
            </div>
            {profile !== 'ping_sweep' && (
              <div className="flex items-center gap-3">
                <Input
                  placeholder="Custom ports (e.g., 22,80,443 or 1-1024 or 80,443,8000-9000) — leave empty for defaults"
                  value={customPorts}
                  onChange={(e) => setCustomPorts(e.target.value)}
                  className="flex-1"
                />
                {customPorts && (
                  <span className="text-xs text-muted-foreground shrink-0">
                    Overrides default port selection
                  </span>
                )}
              </div>
            )}
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
        <div className="rounded-md border overflow-hidden">
          <table className="w-full text-sm table-fixed">
            <thead>
              <tr className="border-b bg-muted/50">
                <th className="p-3 text-left font-medium w-14">ID</th>
                <th className="p-3 text-left font-medium w-[180px]">Target</th>
                <th className="p-3 text-left font-medium w-[120px]">Profile</th>
                <th className="p-3 text-left font-medium w-[100px]">Status</th>
                <th className="p-3 text-left font-medium">Progress</th>
                <th className="p-3 text-left font-medium w-16">Hosts</th>
                <th className="p-3 text-left font-medium w-[100px]">Actions</th>
              </tr>
            </thead>
            <tbody>
              {scans.map((scan) => (
                <tr key={scan.id} className="border-b hover:bg-muted/30">
                  <td className="p-3">#{scan.id}</td>
                  <td className="p-3 font-mono truncate" title={scan.target}>{scan.target}</td>
                  <td className="p-3">{profileLabels[scan.profile]}</td>
                  <td className="p-3">
                    <Badge variant={statusVariant[scan.status]}>{scan.status}</Badge>
                  </td>
                  <td className="p-3 overflow-hidden">
                    {scan.status === 'running' ? (
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <div className="w-24 bg-muted rounded-full h-2 shrink-0">
                            <div className="bg-primary rounded-full h-2 transition-all" style={{ width: `${liveInfo[scan.id]?.progress ?? scan.progress}%` }} />
                          </div>
                          <span className="text-xs text-muted-foreground">{liveInfo[scan.id]?.progress ?? scan.progress}%</span>
                        </div>
                        {liveInfo[scan.id]?.message && (
                          <p className="text-xs text-muted-foreground truncate" title={liveInfo[scan.id].message}>
                            {liveInfo[scan.id].message}
                          </p>
                        )}
                      </div>
                    ) : scan.status === 'failed' && scan.error_message ? (
                      <p className="text-xs text-destructive truncate" title={scan.error_message}>{scan.error_message}</p>
                    ) : (
                      `${scan.progress}%`
                    )}
                  </td>
                  <td className="p-3">{scan.hosts_found}</td>
                  <td className="p-3">
                    <div className="flex gap-1">
                      {(scan.status === 'pending' || scan.status === 'running') && (
                        <Button variant="ghost" size="sm" onClick={() => cancelMutation.mutate(scan.id)}>
                          <Square className="h-3 w-3 mr-1" />Cancel
                        </Button>
                      )}
                      {scan.status !== 'running' && (
                        <Button
                          variant="destructive"
                          size="sm"
                          onClick={() => deleteMutation.mutate(scan.id)}
                        >
                          <Trash2 className="h-4 w-4 mr-1" />Delete
                        </Button>
                      )}
                    </div>
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
