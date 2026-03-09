import { useState, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { getOverview, getGateways, getMode } from '@/api/pfsense'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Flame, Network, Shield, Server, Route, ArrowRightLeft,
  ArrowUp, ArrowDown, ArrowUpDown, Cpu, MemoryStick, Activity,
} from 'lucide-react'
import type { PfSenseInterface, PfSenseArpEntry } from '@/types'

function formatBytes(bytes: number): string {
  if (bytes >= 1_073_741_824) return `${(bytes / 1_073_741_824).toFixed(1)} GB`
  if (bytes >= 1_048_576) return `${(bytes / 1_048_576).toFixed(1)} MB`
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${bytes} B`
}

function formatSpeed(bps: number): string {
  if (bps >= 1_000_000_000) return `${(bps / 1_000_000_000).toFixed(0)} Gbps`
  if (bps >= 1_000_000) return `${(bps / 1_000_000).toFixed(0)} Mbps`
  if (bps >= 1_000) return `${(bps / 1_000).toFixed(0)} Kbps`
  return `${bps} bps`
}

function formatKB(kb: number): string {
  if (kb >= 1_048_576) return `${(kb / 1_048_576).toFixed(1)} GB`
  if (kb >= 1024) return `${(kb / 1024).toFixed(0)} MB`
  return `${kb} KB`
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

type IfSortKey = 'name' | 'status' | 'speed' | 'in' | 'out' | 'ip'
type ArpSortKey = 'ip' | 'mac' | 'type'
type SortDir = 'asc' | 'desc'

function compareIPs(a: string, b: string): number {
  const pa = a.split('/')[0].split('.').map(Number)
  const pb = b.split('/')[0].split('.').map(Number)
  for (let i = 0; i < 4; i++) {
    if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) - (pb[i] || 0)
  }
  return 0
}

export default function PfSensePage() {
  const [ifFilter, setIfFilter] = useState('')
  const [ifStatusFilter, setIfStatusFilter] = useState('all')
  const [ifSortKey, setIfSortKey] = useState<IfSortKey>('name')
  const [ifSortDir, setIfSortDir] = useState<SortDir>('asc')
  const [arpFilter, setArpFilter] = useState('')
  const [arpSortKey, setArpSortKey] = useState<ArpSortKey>('ip')
  const [arpSortDir, setArpSortDir] = useState<SortDir>('asc')

  const { data: modeData, isLoading: modeLoading, isError: modeError } = useQuery({
    queryKey: ['pfsense', 'mode'],
    queryFn: getMode,
    retry: false,
  })

  const mode = modeData?.mode || ''

  const { data: overview, isLoading: overviewLoading, isError: overviewError, error: overviewErrorObj } = useQuery({
    queryKey: ['pfsense', 'overview'],
    queryFn: getOverview,
    retry: false,
    enabled: !!mode,
    refetchInterval: 30000,
  })

  const { data: gateways = [] } = useQuery({
    queryKey: ['pfsense', 'gateways'],
    queryFn: getGateways,
    retry: false,
    enabled: !!mode,
  })

  if (modeLoading || (!!mode && overviewLoading)) {
    return (
      <div className="space-y-6">
        <h1 className="text-3xl font-bold">pfSense Firewall</h1>
        <Card>
          <CardContent className="p-12 text-center text-muted-foreground">
            <Flame className="h-12 w-12 mx-auto mb-4 opacity-50 animate-pulse" />
            <p>Connecting to pfSense...</p>
          </CardContent>
        </Card>
      </div>
    )
  }

  if (modeError || !mode) {
    return (
      <div className="space-y-6">
        <h1 className="text-3xl font-bold">pfSense</h1>
        <Card>
          <CardContent className="p-12 text-center text-muted-foreground">
            <Flame className="h-12 w-12 mx-auto mb-4 opacity-50" />
            <p>pfSense not configured. Go to Settings to set up SNMP or API access.</p>
          </CardContent>
        </Card>
      </div>
    )
  }

  if (overviewError) {
    const errMsg = (overviewErrorObj as Error)?.message || 'Unknown error'
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-3">
          <h1 className="text-3xl font-bold">pfSense Firewall</h1>
          <Badge variant="outline">{mode.toUpperCase()}</Badge>
        </div>
        <Card>
          <CardContent className="p-12 text-center">
            <Flame className="h-12 w-12 mx-auto mb-4 opacity-50 text-destructive" />
            <p className="text-destructive font-medium mb-2">Failed to connect to pfSense</p>
            <p className="text-sm text-muted-foreground mb-4">{errMsg}</p>
            <p className="text-sm text-muted-foreground">
              Check your pfSense host, API key, and that the REST API plugin is installed and running.
            </p>
          </CardContent>
        </Card>
      </div>
    )
  }

  const system = overview?.system
  const interfaces = overview?.interfaces || []
  const arpTable = overview?.arp_table || []
  const ifCounts = overview?.interface_counts

  // Filter interfaces - skip loopback/null
  const physicalIfs = interfaces.filter((i: PfSenseInterface) =>
    i.name && !i.name.startsWith('lo') && !i.name.startsWith('Null') &&
    (ifFilter === '' ||
      i.name.toLowerCase().includes(ifFilter.toLowerCase()) ||
      (i.alias || '').toLowerCase().includes(ifFilter.toLowerCase()) ||
      i.ip_addresses?.some(ip => ip.includes(ifFilter)))
  )

  const filteredIfs = physicalIfs.filter((i: PfSenseInterface) =>
    ifStatusFilter === 'all' || i.oper_status === ifStatusFilter
  )

  const sortedIfs = useMemo(() => {
    return [...filteredIfs].sort((a: PfSenseInterface, b: PfSenseInterface) => {
      let cmp = 0
      switch (ifSortKey) {
        case 'name': cmp = a.name.localeCompare(b.name, undefined, { numeric: true }); break
        case 'status': cmp = a.oper_status.localeCompare(b.oper_status); break
        case 'speed': cmp = a.speed - b.speed; break
        case 'in': cmp = a.in_octets - b.in_octets; break
        case 'out': cmp = a.out_octets - b.out_octets; break
        case 'ip': {
          const aIp = a.ip_addresses?.[0] || 'zzz'
          const bIp = b.ip_addresses?.[0] || 'zzz'
          cmp = compareIPs(aIp, bIp)
          break
        }
      }
      return ifSortDir === 'asc' ? cmp : -cmp
    })
  }, [filteredIfs, ifSortKey, ifSortDir])

  const upCount = physicalIfs.filter((i: PfSenseInterface) => i.oper_status === 'up').length
  const downCount = physicalIfs.filter((i: PfSenseInterface) => i.oper_status === 'down').length

  // ARP filtering & sorting
  const filteredArp = useMemo(() => {
    const f = arpFilter.toLowerCase()
    return arpTable.filter((e: PfSenseArpEntry) =>
      f === '' || e.ip.toLowerCase().includes(f) || e.mac.toLowerCase().includes(f)
    )
  }, [arpTable, arpFilter])

  const sortedArp = useMemo(() => {
    return [...filteredArp].sort((a: PfSenseArpEntry, b: PfSenseArpEntry) => {
      let cmp = 0
      switch (arpSortKey) {
        case 'ip': cmp = compareIPs(a.ip, b.ip); break
        case 'mac': cmp = a.mac.localeCompare(b.mac); break
        case 'type': cmp = a.type.localeCompare(b.type); break
      }
      return arpSortDir === 'asc' ? cmp : -cmp
    })
  }, [filteredArp, arpSortKey, arpSortDir])

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

  const memTotal = Number(system?.mem_total_kb || 0)
  const memUsed = Number(system?.mem_used_kb || 0)
  const memPercent = system?.mem_percent
  const cpuLoad = system?.cpu_load_1
  const pfStates = system?.pf_states
  const tcpEstab = system?.tcp_established

  const ifHeaders: [IfSortKey, string][] = [
    ['name', 'Interface'],
    ['ip', 'IP Address'],
    ['status', 'Status'],
    ['speed', 'Speed'],
    ['in', 'Traffic In'],
    ['out', 'Traffic Out'],
  ]

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <h1 className="text-3xl font-bold">pfSense Firewall</h1>
        <Badge variant="outline">{mode.toUpperCase()}</Badge>
      </div>

      {/* System Overview Cards */}
      {system && (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-2 mb-1">
                <Server className="h-4 w-4 text-muted-foreground" />
                <p className="text-xs text-muted-foreground">Hostname</p>
              </div>
              <p className="font-semibold truncate" title={system.hostname}>{system.hostname || '-'}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-2 mb-1">
                <Activity className="h-4 w-4 text-muted-foreground" />
                <p className="text-xs text-muted-foreground">Uptime</p>
              </div>
              <p className="font-semibold">{system.uptime || '-'}</p>
            </CardContent>
          </Card>
          {cpuLoad && (
            <Card>
              <CardContent className="p-4">
                <div className="flex items-center gap-2 mb-1">
                  <Cpu className="h-4 w-4 text-muted-foreground" />
                  <p className="text-xs text-muted-foreground">CPU Load</p>
                </div>
                <p className="font-semibold">{cpuLoad}</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {system.cpu_load_5} / {system.cpu_load_15}
                </p>
              </CardContent>
            </Card>
          )}
          {memTotal > 0 && (
            <Card>
              <CardContent className="p-4">
                <div className="flex items-center gap-2 mb-1">
                  <MemoryStick className="h-4 w-4 text-muted-foreground" />
                  <p className="text-xs text-muted-foreground">Memory</p>
                </div>
                <p className="font-semibold">{formatKB(memUsed)} / {formatKB(memTotal)}</p>
                <MiniBar
                  value={memUsed}
                  max={memTotal}
                  color={memPercent && memPercent > 90 ? 'bg-red-500' : memPercent && memPercent > 70 ? 'bg-yellow-500' : 'bg-blue-500'}
                />
              </CardContent>
            </Card>
          )}
          {pfStates && (
            <Card>
              <CardContent className="p-4">
                <div className="flex items-center gap-2 mb-1">
                  <Shield className="h-4 w-4 text-muted-foreground" />
                  <p className="text-xs text-muted-foreground">Firewall States</p>
                </div>
                <p className="font-semibold text-lg">{Number(pfStates).toLocaleString()}</p>
              </CardContent>
            </Card>
          )}
          {tcpEstab && (
            <Card>
              <CardContent className="p-4">
                <div className="flex items-center gap-2 mb-1">
                  <Network className="h-4 w-4 text-muted-foreground" />
                  <p className="text-xs text-muted-foreground">TCP Connections</p>
                </div>
                <p className="font-semibold text-lg">{Number(tcpEstab).toLocaleString()}</p>
              </CardContent>
            </Card>
          )}
          {!cpuLoad && !pfStates && (
            <>
              <Card>
                <CardContent className="p-4">
                  <div className="flex items-center gap-2 mb-1">
                    <Network className="h-4 w-4 text-muted-foreground" />
                    <p className="text-xs text-muted-foreground">Interfaces</p>
                  </div>
                  <p className="font-semibold">
                    <span className="text-green-500">{ifCounts?.up ?? upCount} up</span>
                    {' / '}
                    <span className="text-muted-foreground">{ifCounts?.down ?? downCount} down</span>
                  </p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-4">
                  <div className="flex items-center gap-2 mb-1">
                    <ArrowRightLeft className="h-4 w-4 text-muted-foreground" />
                    <p className="text-xs text-muted-foreground">ARP Entries</p>
                  </div>
                  <p className="font-semibold text-lg">{arpTable.length}</p>
                </CardContent>
              </Card>
            </>
          )}
        </div>
      )}

      {/* Description banner */}
      {system?.description && (
        <Card>
          <CardContent className="p-3">
            <p className="text-xs text-muted-foreground truncate" title={system.description}>
              {system.description}
            </p>
          </CardContent>
        </Card>
      )}

      {/* Tabs */}
      <Tabs defaultValue="interfaces">
        <TabsList>
          <TabsTrigger value="interfaces">
            <Network className="h-4 w-4 mr-2" />Interfaces ({physicalIfs.length})
          </TabsTrigger>
          <TabsTrigger value="arp">
            <ArrowRightLeft className="h-4 w-4 mr-2" />ARP Table ({arpTable.length})
          </TabsTrigger>
          <TabsTrigger value="routes">
            <Route className="h-4 w-4 mr-2" />Routes ({(gateways as unknown[]).length})
          </TabsTrigger>
        </TabsList>

        {/* Interfaces Tab */}
        <TabsContent value="interfaces" className="space-y-3">
          <div className="flex gap-2 items-center flex-wrap">
            <Input
              placeholder="Filter interfaces..."
              value={ifFilter}
              onChange={(e) => setIfFilter(e.target.value)}
              className="max-w-xs"
            />
            <div className="flex gap-1">
              <Button
                variant={ifStatusFilter === 'all' ? 'default' : 'outline'}
                size="sm" className="h-7 text-xs"
                onClick={() => setIfStatusFilter('all')}
              >All</Button>
              <Button
                variant={ifStatusFilter === 'up' ? 'default' : 'outline'}
                size="sm" className="h-7 text-xs"
                onClick={() => setIfStatusFilter('up')}
              >Up ({upCount})</Button>
              <Button
                variant={ifStatusFilter === 'down' ? 'default' : 'outline'}
                size="sm" className="h-7 text-xs"
                onClick={() => setIfStatusFilter('down')}
              >Down ({downCount})</Button>
            </div>
          </div>

          <div className="rounded-md border">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/50">
                  {ifHeaders.map(([key, label]) => (
                    <th
                      key={key}
                      className="p-3 text-left font-medium cursor-pointer select-none hover:bg-muted/80 transition-colors"
                      onClick={() => handleIfSort(key)}
                    >
                      <span className="inline-flex items-center">
                        {label}<SortIcon active={ifSortKey === key} dir={ifSortDir} />
                      </span>
                    </th>
                  ))}
                  <th className="p-3 text-left font-medium">Errors</th>
                  <th className="p-3 text-left font-medium">Description</th>
                </tr>
              </thead>
              <tbody>
                {sortedIfs.map((iface: PfSenseInterface) => (
                  <tr key={iface.index} className="border-b hover:bg-muted/30">
                    <td className="p-3 font-mono font-medium">{iface.name}</td>
                    <td className="p-3 text-xs font-mono">
                      {iface.ip_addresses?.length > 0
                        ? iface.ip_addresses.map((ip, i) => <div key={i}>{ip}</div>)
                        : <span className="text-muted-foreground">-</span>
                      }
                    </td>
                    <td className="p-3">
                      <Badge variant={iface.oper_status === 'up' ? 'success' : 'secondary'}>
                        {iface.oper_status}
                      </Badge>
                      {iface.admin_status === 'down' && (
                        <span className="text-xs text-muted-foreground ml-1">(disabled)</span>
                      )}
                    </td>
                    <td className="p-3 text-xs">
                      {iface.oper_status === 'up' && iface.speed > 0 ? formatSpeed(iface.speed) : '-'}
                    </td>
                    <td className="p-3 text-xs font-mono">{formatBytes(iface.in_octets)}</td>
                    <td className="p-3 text-xs font-mono">{formatBytes(iface.out_octets)}</td>
                    <td className="p-3 text-xs">
                      {(iface.in_errors + iface.out_errors) > 0 ? (
                        <span className="text-red-500">{iface.in_errors + iface.out_errors}</span>
                      ) : (
                        <span className="text-muted-foreground">0</span>
                      )}
                    </td>
                    <td className="p-3 text-xs text-muted-foreground truncate max-w-[200px]" title={iface.alias}>
                      {iface.alias || '-'}
                    </td>
                  </tr>
                ))}
                {sortedIfs.length === 0 && (
                  <tr><td colSpan={8} className="p-4 text-center text-muted-foreground">No interfaces found.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </TabsContent>

        {/* ARP Table Tab */}
        <TabsContent value="arp" className="space-y-3">
          <Input
            placeholder="Filter by IP or MAC..."
            value={arpFilter}
            onChange={(e) => setArpFilter(e.target.value)}
            className="max-w-xs"
          />
          <div className="rounded-md border">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/50">
                  {([['ip', 'IP Address'], ['mac', 'MAC Address'], ['type', 'Type']] as [ArpSortKey, string][]).map(([key, label]) => (
                    <th
                      key={key}
                      className="p-3 text-left font-medium cursor-pointer select-none hover:bg-muted/80 transition-colors"
                      onClick={() => handleArpSort(key)}
                    >
                      <span className="inline-flex items-center">
                        {label}<SortIcon active={arpSortKey === key} dir={arpSortDir} />
                      </span>
                    </th>
                  ))}
                  <th className="p-3 text-left font-medium">Interface</th>
                </tr>
              </thead>
              <tbody>
                {sortedArp.map((entry: PfSenseArpEntry, i: number) => (
                  <tr key={i} className="border-b hover:bg-muted/30">
                    <td className="p-3 font-mono">{entry.ip}</td>
                    <td className="p-3 font-mono text-xs">{entry.mac}</td>
                    <td className="p-3">
                      <Badge variant={entry.type === 'dynamic' ? 'outline' : 'secondary'} className="text-xs">
                        {entry.type}
                      </Badge>
                    </td>
                    <td className="p-3 text-xs text-muted-foreground">{entry.interface || '-'}</td>
                  </tr>
                ))}
                {sortedArp.length === 0 && (
                  <tr><td colSpan={4} className="p-4 text-center text-muted-foreground">No ARP entries found.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </TabsContent>

        {/* Routes Tab */}
        <TabsContent value="routes">
          <div className="rounded-md border">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/50">
                  <th className="p-3 text-left font-medium">Destination</th>
                  <th className="p-3 text-left font-medium">Gateway</th>
                  <th className="p-3 text-left font-medium">Mask</th>
                  <th className="p-3 text-left font-medium">Metric</th>
                  <th className="p-3 text-left font-medium">Interface</th>
                </tr>
              </thead>
              <tbody>
                {(gateways as Array<{ destination?: string; gateway?: string; mask?: string; metric?: number; interface?: string }>).map((route, i) => (
                  <tr key={i} className="border-b hover:bg-muted/30">
                    <td className="p-3 font-mono text-xs">{route.destination || '-'}</td>
                    <td className="p-3 font-mono text-xs">{route.gateway || '-'}</td>
                    <td className="p-3 font-mono text-xs">{route.mask || '-'}</td>
                    <td className="p-3 text-xs">{route.metric ?? '-'}</td>
                    <td className="p-3 text-xs text-muted-foreground">{route.interface || '-'}</td>
                  </tr>
                ))}
                {(gateways as unknown[]).length === 0 && (
                  <tr><td colSpan={5} className="p-4 text-center text-muted-foreground">No routes found.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  )
}
