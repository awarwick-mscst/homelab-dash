import { useState, Component, type ReactNode, type ErrorInfo } from 'react'
import { useQuery, useMutation } from '@tanstack/react-query'
import { getOverview, getMode, testConnection, getVpnStatus } from '@/api/sonicwall'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Shield, Network, Server, ArrowRightLeft,
  ArrowUp, ArrowDown, ArrowUpDown, Cpu, MemoryStick, Activity,
} from 'lucide-react'

// ---------- Error Boundary ----------
interface EBProps { children: ReactNode; overview?: unknown }
interface EBState { error: Error | null }

class SonicWallErrorBoundary extends Component<EBProps, EBState> {
  state: EBState = { error: null }
  static getDerivedStateFromError(error: Error) { return { error } }
  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('SonicWallPage render error:', error, info)
  }
  render() {
    if (this.state.error) {
      return (
        <div className="space-y-6">
          <h1 className="text-3xl font-bold">SonicWall Firewall</h1>
          <Card>
            <CardContent className="p-8">
              <p className="text-destructive font-medium mb-2">Render error: {this.state.error.message}</p>
              <pre className="p-3 bg-muted rounded text-xs overflow-auto max-h-96 whitespace-pre-wrap">
                {JSON.stringify(this.props.overview, null, 2)}
              </pre>
            </CardContent>
          </Card>
        </div>
      )
    }
    return this.props.children
  }
}

// ---------- Helpers ----------
function formatBytes(bytes: number): string {
  if (!bytes || isNaN(bytes)) return '0 B'
  if (bytes >= 1_073_741_824) return `${(bytes / 1_073_741_824).toFixed(1)} GB`
  if (bytes >= 1_048_576) return `${(bytes / 1_048_576).toFixed(1)} MB`
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${bytes} B`
}

function formatSpeed(bps: number): string {
  if (!bps || isNaN(bps)) return '0 bps'
  if (bps >= 1_000_000_000) return `${(bps / 1_000_000_000).toFixed(0)} Gbps`
  if (bps >= 1_000_000) return `${(bps / 1_000_000).toFixed(0)} Mbps`
  if (bps >= 1_000) return `${(bps / 1_000).toFixed(0)} Kbps`
  return `${bps} bps`
}

function MiniBar({ value, max, color = 'bg-blue-500' }: { value: number; max: number; color?: string }) {
  const pct = max > 0 ? Math.min((value / max) * 100, 100) : 0
  return (
    <div className="flex items-center gap-2">
      <div className="h-2 w-20 bg-muted rounded-full overflow-hidden">
        <div className={`h-full ${color} rounded-full`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs text-muted-foreground">{pct.toFixed(0)}%</span>
    </div>
  )
}

function s(val: unknown): string { return String(val ?? '') }
function n(val: unknown): number { const v = Number(val); return isNaN(v) ? 0 : v }

function compareIPs(a: string, b: string): number {
  const pa = (a || '').split('/')[0].split('.').map(Number)
  const pb = (b || '').split('/')[0].split('.').map(Number)
  for (let i = 0; i < 4; i++) {
    if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) - (pb[i] || 0)
  }
  return 0
}

// ---------- Main Page ----------
export default function SonicWallPage() {
  return <SonicWallPageInner />
}

type IfSortKey = 'name' | 'status' | 'speed' | 'in' | 'out' | 'ip'
type ArpSortKey = 'ip' | 'mac' | 'type'
type SortDir = 'asc' | 'desc'

type Iface = Record<string, unknown>
type ArpEntry = Record<string, unknown>
type VpnEntry = Record<string, unknown>

function SonicWallPageInner() {
  const [ifFilter, setIfFilter] = useState('')
  const [ifStatusFilter, setIfStatusFilter] = useState('all')
  const [ifSortKey, setIfSortKey] = useState<IfSortKey>('name')
  const [ifSortDir, setIfSortDir] = useState<SortDir>('asc')
  const [arpFilter, setArpFilter] = useState('')
  const [arpSortKey, setArpSortKey] = useState<ArpSortKey>('ip')
  const [arpSortDir, setArpSortDir] = useState<SortDir>('asc')
  const [showRaw, setShowRaw] = useState(false)

  const { data: modeData, isLoading: modeLoading, isError: modeError } = useQuery({
    queryKey: ['sonicwall', 'mode'],
    queryFn: getMode,
    retry: false,
  })

  const mode = modeData?.mode || ''

  const { data: overview, isLoading: overviewLoading, isError: overviewError, error: overviewErrorObj } = useQuery({
    queryKey: ['sonicwall', 'overview'],
    queryFn: getOverview,
    retry: false,
    enabled: !!mode,
    refetchInterval: 30000,
  })

  const { data: vpnRaw } = useQuery({
    queryKey: ['sonicwall', 'vpn'],
    queryFn: getVpnStatus,
    retry: false,
    enabled: !!mode && mode === 'api',
  })
  const vpnData: VpnEntry[] = Array.isArray(vpnRaw) ? vpnRaw : (vpnRaw as Record<string, unknown>)?.data ? (vpnRaw as Record<string, unknown>).data as VpnEntry[] : []

  const testMutation = useMutation({ mutationFn: testConnection })

  // --- Loading ---
  if (modeLoading || (!!mode && overviewLoading)) {
    return (
      <div className="space-y-6">
        <h1 className="text-3xl font-bold">SonicWall Firewall</h1>
        <Card>
          <CardContent className="p-12 text-center text-muted-foreground">
            <Shield className="h-12 w-12 mx-auto mb-4 opacity-50 animate-pulse" />
            <p>Connecting to SonicWall...</p>
          </CardContent>
        </Card>
      </div>
    )
  }

  // --- Not configured ---
  if (modeError || !mode) {
    return (
      <div className="space-y-6">
        <h1 className="text-3xl font-bold">SonicWall</h1>
        <Card>
          <CardContent className="p-12 text-center text-muted-foreground">
            <Shield className="h-12 w-12 mx-auto mb-4 opacity-50" />
            <p>SonicWall not configured. Go to Settings to set up API or SNMP access.</p>
          </CardContent>
        </Card>
      </div>
    )
  }

  // --- Error state ---
  if (overviewError) {
    const axiosErr = overviewErrorObj as { response?: { data?: { detail?: string }; status?: number } }
    const detail = axiosErr?.response?.data?.detail
    const status = axiosErr?.response?.status
    const errMsg = detail
      || (status === 502 ? 'Cannot reach SonicWall -- check host and credentials in Settings'
        : status === 400 ? 'SonicWall not configured -- go to Settings to set up access'
        : (overviewErrorObj as Error)?.message || 'Unknown error')
    const testResult = testMutation.data as Record<string, string | number | boolean> | undefined
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-3">
          <h1 className="text-3xl font-bold">SonicWall Firewall</h1>
          <Badge variant="outline">{mode.toUpperCase()}</Badge>
        </div>
        <Card>
          <CardContent className="p-12 text-center">
            <Shield className="h-12 w-12 mx-auto mb-4 opacity-50 text-destructive" />
            <p className="text-destructive font-medium mb-2">Failed to connect to SonicWall</p>
            <p className="text-sm text-muted-foreground mb-4">{errMsg}</p>
            <Button onClick={() => testMutation.mutate()} disabled={testMutation.isPending} variant="outline">
              {testMutation.isPending ? 'Testing...' : 'Test Connection'}
            </Button>
          </CardContent>
        </Card>
        {testResult && (
          <Card>
            <CardHeader><CardTitle className="text-base">Connection Test Result</CardTitle></CardHeader>
            <CardContent>
              <div className="space-y-2">
                <Badge variant={testResult.ok ? 'success' : 'destructive'}>
                  {testResult.ok ? 'Connected' : 'Failed'}
                </Badge>
                {testResult.url && <p className="text-xs font-mono">{String(testResult.url)}</p>}
                {testResult.status_code && <p className="text-xs">HTTP {String(testResult.status_code)}</p>}
                {testResult.error && <p className="text-sm text-destructive">{String(testResult.error)}</p>}
                {testResult.response_body && (
                  <pre className="p-3 bg-muted rounded text-xs overflow-auto max-h-60 whitespace-pre-wrap">{String(testResult.response_body)}</pre>
                )}
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    )
  }

  // --- Data loaded ---
  const system: Record<string, unknown> = (overview?.system as unknown as Record<string, unknown>) || {}
  const interfaces: Iface[] = Array.isArray(overview?.interfaces) ? (overview.interfaces as unknown as Iface[]) : []
  const arpTable: ArpEntry[] = Array.isArray(overview?.arp_table) ? (overview.arp_table as unknown as ArpEntry[]) : []
  const ifCounts = (overview?.interface_counts || {}) as Record<string, number>

  const physicalIfs = interfaces.filter((i) => {
    const name = s(i.name)
    if (!name || name.startsWith('lo') || name.startsWith('Null')) return false
    if (ifFilter === '') return true
    const f = ifFilter.toLowerCase()
    return name.toLowerCase().includes(f) ||
      s(i.alias).toLowerCase().includes(f) ||
      (Array.isArray(i.ip_addresses) ? i.ip_addresses : []).some((ip: unknown) => s(ip).includes(ifFilter))
  })

  const filteredIfs = physicalIfs.filter((i) =>
    ifStatusFilter === 'all' || s(i.oper_status) === ifStatusFilter
  )

  const sortedIfs = [...filteredIfs].sort((a, b) => {
    let cmp = 0
    switch (ifSortKey) {
      case 'name': cmp = s(a.name).localeCompare(s(b.name), undefined, { numeric: true }); break
      case 'status': cmp = s(a.oper_status).localeCompare(s(b.oper_status)); break
      case 'speed': cmp = n(a.speed) - n(b.speed); break
      case 'in': cmp = n(a.in_octets) - n(b.in_octets); break
      case 'out': cmp = n(a.out_octets) - n(b.out_octets); break
      case 'ip': {
        const aIps = Array.isArray(a.ip_addresses) ? a.ip_addresses : []
        const bIps = Array.isArray(b.ip_addresses) ? b.ip_addresses : []
        cmp = compareIPs(s(aIps[0]), s(bIps[0]))
        break
      }
    }
    return ifSortDir === 'asc' ? cmp : -cmp
  })

  const upCount = physicalIfs.filter((i) => s(i.oper_status) === 'up').length
  const downCount = physicalIfs.filter((i) => s(i.oper_status) === 'down').length

  const filteredArp = arpTable.filter((e) => {
    if (arpFilter === '') return true
    const f = arpFilter.toLowerCase()
    return s(e.ip).toLowerCase().includes(f) || s(e.mac).toLowerCase().includes(f)
  })

  const sortedArp = [...filteredArp].sort((a, b) => {
    let cmp = 0
    switch (arpSortKey) {
      case 'ip': cmp = compareIPs(s(a.ip), s(b.ip)); break
      case 'mac': cmp = s(a.mac).localeCompare(s(b.mac)); break
      case 'type': cmp = s(a.type).localeCompare(s(b.type)); break
    }
    return arpSortDir === 'asc' ? cmp : -cmp
  })

  function handleIfSort(key: IfSortKey) {
    if (ifSortKey === key) setIfSortDir(ifSortDir === 'asc' ? 'desc' : 'asc')
    else { setIfSortKey(key); setIfSortDir('asc') }
  }

  function handleArpSort(key: ArpSortKey) {
    if (arpSortKey === key) setArpSortDir(arpSortDir === 'asc' ? 'desc' : 'asc')
    else { setArpSortKey(key); setArpSortDir('asc') }
  }

  function SortIcon({ active, dir }: { active: boolean; dir: SortDir }) {
    if (!active) return <ArrowUpDown className="h-3 w-3 ml-1 opacity-30" />
    return dir === 'asc' ? <ArrowUp className="h-3 w-3 ml-1" /> : <ArrowDown className="h-3 w-3 ml-1" />
  }

  const cpuPercent = system.cpu_percent != null ? n(system.cpu_percent) : null
  const memPercent = system.mem_percent != null ? n(system.mem_percent) : null
  const currentConns = system.current_connections != null ? n(system.current_connections) : null
  const maxConns = system.max_connections != null ? n(system.max_connections) : null

  const ifHeaders: [IfSortKey, string][] = [
    ['name', 'Interface'], ['ip', 'IP Address'], ['status', 'Status'],
    ['speed', 'Speed'], ['in', 'Traffic In'], ['out', 'Traffic Out'],
  ]

  return (
    <SonicWallErrorBoundary overview={overview}>
      <div className="space-y-6">
        <div className="flex items-center gap-3">
          <h1 className="text-3xl font-bold">SonicWall Firewall</h1>
          <Badge variant="outline">{mode.toUpperCase()}</Badge>
          <Button variant="ghost" size="sm" className="ml-auto text-xs" onClick={() => setShowRaw(!showRaw)}>
            {showRaw ? 'Hide' : 'Show'} Raw Data
          </Button>
        </div>

        {showRaw && (
          <Card>
            <CardHeader><CardTitle className="text-base">Raw API Response</CardTitle></CardHeader>
            <CardContent>
              <pre className="p-3 bg-muted rounded text-xs overflow-auto max-h-96 whitespace-pre-wrap">
                {JSON.stringify(overview, null, 2)}
              </pre>
            </CardContent>
          </Card>
        )}

        {/* System Overview Cards */}
        {system && Object.keys(system).length > 0 && (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
            <Card>
              <CardContent className="p-4">
                <div className="flex items-center gap-2 mb-1">
                  <Server className="h-4 w-4 text-muted-foreground" />
                  <p className="text-xs text-muted-foreground">Hostname</p>
                </div>
                <p className="font-semibold truncate">{s(system.hostname) || '-'}</p>
                {system.model ? <p className="text-xs text-muted-foreground truncate">{s(system.model)}</p> : null}
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <div className="flex items-center gap-2 mb-1">
                  <Activity className="h-4 w-4 text-muted-foreground" />
                  <p className="text-xs text-muted-foreground">Uptime</p>
                </div>
                <p className="font-semibold">{s(system.uptime) || '-'}</p>
              </CardContent>
            </Card>
            {system.firmware ? (
              <Card>
                <CardContent className="p-4">
                  <div className="flex items-center gap-2 mb-1">
                    <Shield className="h-4 w-4 text-muted-foreground" />
                    <p className="text-xs text-muted-foreground">Firmware</p>
                  </div>
                  <p className="font-semibold text-sm truncate">{s(system.firmware)}</p>
                </CardContent>
              </Card>
            ) : null}
            {cpuPercent !== null && (
              <Card>
                <CardContent className="p-4">
                  <div className="flex items-center gap-2 mb-1">
                    <Cpu className="h-4 w-4 text-muted-foreground" />
                    <p className="text-xs text-muted-foreground">CPU</p>
                  </div>
                  <p className="font-semibold">{cpuPercent}%</p>
                  <MiniBar value={cpuPercent} max={100} color={cpuPercent > 90 ? 'bg-red-500' : cpuPercent > 70 ? 'bg-yellow-500' : 'bg-blue-500'} />
                </CardContent>
              </Card>
            )}
            {memPercent !== null && (
              <Card>
                <CardContent className="p-4">
                  <div className="flex items-center gap-2 mb-1">
                    <MemoryStick className="h-4 w-4 text-muted-foreground" />
                    <p className="text-xs text-muted-foreground">Memory</p>
                  </div>
                  <p className="font-semibold">{memPercent}%</p>
                  <MiniBar value={memPercent} max={100} color={memPercent > 90 ? 'bg-red-500' : memPercent > 70 ? 'bg-yellow-500' : 'bg-blue-500'} />
                </CardContent>
              </Card>
            )}
            {currentConns !== null && (
              <Card>
                <CardContent className="p-4">
                  <div className="flex items-center gap-2 mb-1">
                    <Network className="h-4 w-4 text-muted-foreground" />
                    <p className="text-xs text-muted-foreground">Connections</p>
                  </div>
                  <p className="font-semibold text-lg">{currentConns.toLocaleString()}</p>
                  {maxConns !== null && maxConns > 0 && (
                    <MiniBar value={currentConns} max={maxConns} color={currentConns / maxConns > 0.9 ? 'bg-red-500' : 'bg-blue-500'} />
                  )}
                </CardContent>
              </Card>
            )}
            <Card>
              <CardContent className="p-4">
                <div className="flex items-center gap-2 mb-1">
                  <Network className="h-4 w-4 text-muted-foreground" />
                  <p className="text-xs text-muted-foreground">Interfaces</p>
                </div>
                <p className="font-semibold">
                  <span className="text-green-500">{ifCounts.up ?? upCount} up</span>
                  {' / '}
                  <span className="text-muted-foreground">{ifCounts.down ?? downCount} down</span>
                </p>
              </CardContent>
            </Card>
          </div>
        )}

        {/* Tabs */}
        <Tabs defaultValue="interfaces">
          <TabsList>
            <TabsTrigger value="interfaces">
              <Network className="h-4 w-4 mr-2" />Interfaces ({physicalIfs.length})
            </TabsTrigger>
            <TabsTrigger value="arp">
              <ArrowRightLeft className="h-4 w-4 mr-2" />ARP ({arpTable.length})
            </TabsTrigger>
            {vpnData.length > 0 && (
              <TabsTrigger value="vpn">
                <Shield className="h-4 w-4 mr-2" />VPN ({vpnData.length})
              </TabsTrigger>
            )}
          </TabsList>

          {/* Interfaces Tab */}
          <TabsContent value="interfaces" className="space-y-3">
            <div className="flex gap-2 items-center flex-wrap">
              <Input placeholder="Filter interfaces..." value={ifFilter} onChange={(e) => setIfFilter(e.target.value)} className="max-w-xs" />
              <div className="flex gap-1">
                {(['all', 'up', 'down'] as const).map((f) => (
                  <Button key={f} variant={ifStatusFilter === f ? 'default' : 'outline'} size="sm" className="h-7 text-xs" onClick={() => setIfStatusFilter(f)}>
                    {f === 'all' ? 'All' : f === 'up' ? `Up (${upCount})` : `Down (${downCount})`}
                  </Button>
                ))}
              </div>
            </div>
            <div className="rounded-md border">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/50">
                    {ifHeaders.map(([key, label]) => (
                      <th key={key} className="p-3 text-left font-medium cursor-pointer select-none hover:bg-muted/80" onClick={() => handleIfSort(key)}>
                        <span className="inline-flex items-center">{label}<SortIcon active={ifSortKey === key} dir={ifSortDir} /></span>
                      </th>
                    ))}
                    <th className="p-3 text-left font-medium">Errors</th>
                    <th className="p-3 text-left font-medium">Zone</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedIfs.map((iface, idx) => {
                    const ips = Array.isArray(iface.ip_addresses) ? iface.ip_addresses : []
                    return (
                      <tr key={idx} className="border-b hover:bg-muted/30">
                        <td className="p-3 font-mono font-medium">{s(iface.name) || '-'}</td>
                        <td className="p-3 text-xs font-mono">
                          {ips.length > 0 ? ips.map((ip: unknown, i: number) => <div key={i}>{s(ip)}</div>) : <span className="text-muted-foreground">-</span>}
                        </td>
                        <td className="p-3">
                          <Badge variant={s(iface.oper_status) === 'up' ? 'success' : 'secondary'}>{s(iface.oper_status) || 'unknown'}</Badge>
                          {s(iface.admin_status) === 'down' && <span className="text-xs text-muted-foreground ml-1">(disabled)</span>}
                        </td>
                        <td className="p-3 text-xs">{s(iface.oper_status) === 'up' && n(iface.speed) > 0 ? formatSpeed(n(iface.speed)) : '-'}</td>
                        <td className="p-3 text-xs font-mono">{formatBytes(n(iface.in_octets))}</td>
                        <td className="p-3 text-xs font-mono">{formatBytes(n(iface.out_octets))}</td>
                        <td className="p-3 text-xs">
                          {(n(iface.in_errors) + n(iface.out_errors)) > 0
                            ? <span className="text-red-500">{n(iface.in_errors) + n(iface.out_errors)}</span>
                            : <span className="text-muted-foreground">0</span>}
                        </td>
                        <td className="p-3 text-xs text-muted-foreground">{s(iface.zone) || '-'}</td>
                      </tr>
                    )
                  })}
                  {sortedIfs.length === 0 && (
                    <tr><td colSpan={8} className="p-4 text-center text-muted-foreground">No interfaces found.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </TabsContent>

          {/* ARP Table Tab */}
          <TabsContent value="arp" className="space-y-3">
            <Input placeholder="Filter by IP or MAC..." value={arpFilter} onChange={(e) => setArpFilter(e.target.value)} className="max-w-xs" />
            <div className="rounded-md border">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/50">
                    {([['ip', 'IP Address'], ['mac', 'MAC Address'], ['type', 'Type']] as [ArpSortKey, string][]).map(([key, label]) => (
                      <th key={key} className="p-3 text-left font-medium cursor-pointer select-none hover:bg-muted/80" onClick={() => handleArpSort(key)}>
                        <span className="inline-flex items-center">{label}<SortIcon active={arpSortKey === key} dir={arpSortDir} /></span>
                      </th>
                    ))}
                    <th className="p-3 text-left font-medium">Interface</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedArp.map((entry, i) => (
                    <tr key={i} className="border-b hover:bg-muted/30">
                      <td className="p-3 font-mono">{s(entry.ip)}</td>
                      <td className="p-3 font-mono text-xs">{s(entry.mac)}</td>
                      <td className="p-3">
                        <Badge variant={s(entry.type) === 'dynamic' ? 'outline' : 'secondary'} className="text-xs">{s(entry.type) || '-'}</Badge>
                      </td>
                      <td className="p-3 text-xs text-muted-foreground">{s(entry.interface) || '-'}</td>
                    </tr>
                  ))}
                  {sortedArp.length === 0 && (
                    <tr><td colSpan={4} className="p-4 text-center text-muted-foreground">No ARP entries.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </TabsContent>

          {/* VPN Tab */}
          {vpnData.length > 0 && (
            <TabsContent value="vpn">
              <div className="rounded-md border">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-muted/50">
                      <th className="p-3 text-left font-medium">Name</th>
                      <th className="p-3 text-left font-medium">Peer</th>
                      <th className="p-3 text-left font-medium">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {vpnData.map((vpn, i) => (
                      <tr key={i} className="border-b hover:bg-muted/30">
                        <td className="p-3 font-medium text-xs">{s(vpn.name) || s(vpn.policy_name) || '-'}</td>
                        <td className="p-3 font-mono text-xs">{s(vpn.peer) || s(vpn.peer_gateway) || '-'}</td>
                        <td className="p-3">
                          <Badge variant={s(vpn.status) === 'active' || s(vpn.status) === 'up' ? 'success' : 'secondary'} className="text-xs">
                            {s(vpn.status) || 'unknown'}
                          </Badge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </TabsContent>
          )}
        </Tabs>
      </div>
    </SonicWallErrorBoundary>
  )
}
