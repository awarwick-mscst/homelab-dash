import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { getSwitchOverview, testSwitchConnection } from '@/api/switch'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { Input } from '@/components/ui/input'
import { Network, ArrowUp, ArrowDown, ArrowUpDown, Loader2, CheckCircle, XCircle, Plug } from 'lucide-react'
import type { SwitchInterface, SwitchMacEntry } from '@/types'

function formatSpeed(bps: number): string {
  if (bps >= 1_000_000_000) return `${(bps / 1_000_000_000).toFixed(0)} Gbps`
  if (bps >= 1_000_000) return `${(bps / 1_000_000).toFixed(0)} Mbps`
  if (bps >= 1_000) return `${(bps / 1_000).toFixed(0)} Kbps`
  return `${bps} bps`
}

function formatBytes(bytes: number): string {
  if (bytes >= 1_073_741_824) return `${(bytes / 1_073_741_824).toFixed(1)} GB`
  if (bytes >= 1_048_576) return `${(bytes / 1_048_576).toFixed(1)} MB`
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${bytes} B`
}

function formatUptime(raw: string): string {
  // SG250 format: "121,12:22:04" (days,hour:min:sec)
  const m = raw.match(/^(\d+),(\d+):(\d+):(\d+)$/)
  if (m) {
    const [, days, hours, mins] = m
    return `${days}d ${hours}h ${mins}m`
  }
  // Already formatted or other format — return as-is
  return raw
}

type IfSortKey = 'name' | 'status' | 'speed' | 'in' | 'out' | 'errors'
type SortDir = 'asc' | 'desc'

function getIfSortVal(iface: SwitchInterface, key: IfSortKey): string | number {
  switch (key) {
    case 'name': return iface.name
    case 'status': return iface.oper_status
    case 'speed': return iface.speed
    case 'in': return iface.in_octets
    case 'out': return iface.out_octets
    case 'errors': return iface.in_errors + iface.out_errors
  }
}

export default function SwitchPage() {
  const [portFilter, setPortFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState<string>('all')
  const [sortKey, setSortKey] = useState<IfSortKey>('name')
  const [sortDir, setSortDir] = useState<SortDir>('asc')
  const [macFilter, setMacFilter] = useState('')
  const [testResult, setTestResult] = useState<{ ok: boolean; host: string; error?: string } | null>(null)

  const queryClient = useQueryClient()

  const { data: overview, isLoading, isError, error } = useQuery({
    queryKey: ['switch', 'overview'],
    queryFn: getSwitchOverview,
    retry: false,
    refetchInterval: 30000,
  })

  const testMutation = useMutation({
    mutationFn: testSwitchConnection,
    onSuccess: (data) => {
      setTestResult(data)
      if (data.ok) {
        queryClient.invalidateQueries({ queryKey: ['switch', 'overview'] })
      }
    },
    onError: (err: Error) => {
      setTestResult({ ok: false, host: '', error: err.message })
    },
  })

  // Extract error detail from axios error
  function getErrorDetail(err: unknown): string {
    if (err && typeof err === 'object' && 'response' in err) {
      const resp = (err as { response?: { data?: { detail?: string } } }).response
      if (resp?.data?.detail) return resp.data.detail
    }
    if (err instanceof Error) return err.message
    return 'Unknown error'
  }

  if (isLoading) {
    return (
      <div className="space-y-6">
        <h1 className="text-3xl font-bold">Network Switch</h1>
        <Card>
          <CardContent className="p-12 text-center text-muted-foreground">
            <Loader2 className="h-12 w-12 mx-auto mb-4 animate-spin opacity-50" />
            <p>Connecting to switch...</p>
          </CardContent>
        </Card>
      </div>
    )
  }

  if (isError) {
    const detail = getErrorDetail(error)
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-3xl font-bold">Network Switch</h1>
          <Button
            variant="outline"
            size="sm"
            onClick={() => testMutation.mutate()}
            disabled={testMutation.isPending}
          >
            {testMutation.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Plug className="h-4 w-4 mr-2" />}
            Test Connection
          </Button>
        </div>
        <Card>
          <CardContent className="p-12 text-center text-muted-foreground">
            <Network className="h-12 w-12 mx-auto mb-4 opacity-50" />
            <p className="font-medium text-foreground mb-1">Switch unreachable</p>
            <p className="text-sm">{detail}</p>
            <p className="text-sm mt-2">Go to Settings to configure your switch.</p>
          </CardContent>
        </Card>
        {testResult && (
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-2">
                {testResult.ok ? (
                  <CheckCircle className="h-5 w-5 text-green-500" />
                ) : (
                  <XCircle className="h-5 w-5 text-red-500" />
                )}
                <span className="font-medium">{testResult.ok ? 'Connection successful' : 'Connection failed'}</span>
                {testResult.host && <span className="text-sm text-muted-foreground">({testResult.host})</span>}
              </div>
              {testResult.error && (
                <p className="text-sm text-red-500 mt-1">{testResult.error}</p>
              )}
            </CardContent>
          </Card>
        )}
      </div>
    )
  }

  const system = overview?.system ?? null
  const interfaces = overview?.interfaces ?? []
  const macTable = overview?.mac_table ?? []
  const vlans = overview?.vlans ?? []

  // Filter to physical/relevant ports (skip internal, VLAN interfaces if desired)
  const physicalPorts = interfaces.filter(i =>
    i.name && !i.name.startsWith('Null') &&
    (portFilter === '' ||
     i.name.toLowerCase().includes(portFilter.toLowerCase()) ||
     (i.alias || '').toLowerCase().includes(portFilter.toLowerCase()))
  )

  const filteredPorts = physicalPorts.filter(i =>
    statusFilter === 'all' || i.oper_status === statusFilter
  )

  const sortedPorts = [...filteredPorts].sort((a, b) => {
    const va = getIfSortVal(a, sortKey)
    const vb = getIfSortVal(b, sortKey)
    let cmp: number
    if (typeof va === 'number' && typeof vb === 'number') cmp = va - vb
    else cmp = String(va).localeCompare(String(vb), undefined, { numeric: true })
    return sortDir === 'asc' ? cmp : -cmp
  })

  const upCount = physicalPorts.filter(i => i.oper_status === 'up').length
  const downCount = physicalPorts.filter(i => i.oper_status === 'down').length

  function handleSort(key: IfSortKey) {
    if (sortKey === key) setSortDir(sortDir === 'asc' ? 'desc' : 'asc')
    else { setSortKey(key); setSortDir('asc') }
  }

  function SortIcon({ col }: { col: IfSortKey }) {
    if (sortKey !== col) return <ArrowUpDown className="h-3 w-3 ml-1 opacity-30" />
    return sortDir === 'asc' ? <ArrowUp className="h-3 w-3 ml-1" /> : <ArrowDown className="h-3 w-3 ml-1" />
  }

  // Build interface index -> name lookup for MAC table
  const ifNameMap: Record<string, string> = {}
  for (const iface of interfaces) {
    ifNameMap[iface.index] = iface.name
  }

  // Build port name -> MAC addresses lookup for ports table
  const portMacs: Record<string, string[]> = {}
  for (const entry of macTable) {
    // MAC entries have port name in if_index (SSH) or bridge_port
    const port = entry.if_index || entry.bridge_port || ''
    // Match by port name directly (SSH mode) or via ifNameMap (SNMP mode)
    const portName = ifNameMap[port] || port
    if (portName) {
      if (!portMacs[portName]) portMacs[portName] = []
      portMacs[portName].push(entry.mac)
    }
  }

  const filteredMac = macTable.filter((m: SwitchMacEntry) =>
    macFilter === '' ||
    m.mac.toLowerCase().includes(macFilter.toLowerCase()) ||
    (m.if_index && ifNameMap[m.if_index]?.toLowerCase().includes(macFilter.toLowerCase()))
  )

  const headers: [IfSortKey, string][] = [
    ['name', 'Port'],
    ['status', 'Status'],
    ['speed', 'Speed'],
    ['in', 'Traffic In'],
    ['out', 'Traffic Out'],
    ['errors', 'Errors'],
  ]

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold">Network Switch</h1>
        <Button
          variant="outline"
          size="sm"
          onClick={() => testMutation.mutate()}
          disabled={testMutation.isPending}
        >
          {testMutation.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Plug className="h-4 w-4 mr-2" />}
          Test Connection
        </Button>
      </div>

      {/* Test result banner */}
      {testResult && (
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2">
              {testResult.ok ? (
                <CheckCircle className="h-5 w-5 text-green-500" />
              ) : (
                <XCircle className="h-5 w-5 text-red-500" />
              )}
              <span className="font-medium">{testResult.ok ? 'Connection successful' : 'Connection failed'}</span>
              {testResult.host && <span className="text-sm text-muted-foreground">({testResult.host})</span>}
            </div>
            {testResult.error && (
              <p className="text-sm text-red-500 mt-1">{testResult.error}</p>
            )}
          </CardContent>
        </Card>
      )}

      {/* Overview-level errors */}
      {overview?.error && (
        <Card>
          <CardContent className="p-4 text-sm text-yellow-600">
            Partial data: {overview.error}
          </CardContent>
        </Card>
      )}
      {overview?._errors && overview._errors.length > 0 && (
        <Card>
          <CardContent className="p-4 space-y-1">
            <p className="text-sm font-medium text-yellow-600">Switch communication issues:</p>
            {overview._errors.map((err: string, i: number) => (
              <p key={i} className="text-xs text-muted-foreground font-mono">{err}</p>
            ))}
          </CardContent>
        </Card>
      )}
      {overview?._debug && (
        <details className="text-xs">
          <summary className="cursor-pointer text-muted-foreground hover:text-foreground">Debug: raw command output</summary>
          <pre className="mt-2 p-3 bg-muted rounded overflow-auto max-h-60 text-xs whitespace-pre-wrap">
            {JSON.stringify(overview._debug, null, 2)}
          </pre>
        </details>
      )}

      {/* System Info */}
      {system && (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <Card>
            <CardContent className="p-4">
              <p className="text-xs text-muted-foreground">Hostname</p>
              <p className="font-semibold">{system.hostname || '-'}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <p className="text-xs text-muted-foreground">Uptime</p>
              <p className="font-semibold">{formatUptime(system.uptime)}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <p className="text-xs text-muted-foreground">Ports</p>
              <p className="font-semibold">
                <span className="text-green-500">{upCount} up</span>
                {' / '}
                <span className="text-muted-foreground">{downCount} down</span>
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <p className="text-xs text-muted-foreground">Description</p>
              <p className="font-semibold text-xs truncate" title={system.description}>{system.description || '-'}</p>
            </CardContent>
          </Card>
        </div>
      )}

      <Tabs defaultValue="ports">
        <TabsList>
          <TabsTrigger value="ports">Ports ({physicalPorts.length})</TabsTrigger>
          <TabsTrigger value="mac">MAC Table ({macTable.length})</TabsTrigger>
          <TabsTrigger value="vlans">VLANs ({vlans.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="ports" className="space-y-3">
          <div className="flex gap-2 items-center flex-wrap">
            <Input
              placeholder="Filter ports..."
              value={portFilter}
              onChange={(e) => setPortFilter(e.target.value)}
              className="max-w-xs"
            />
            <div className="flex gap-1">
              <Button
                variant={statusFilter === 'all' ? 'default' : 'outline'}
                size="sm" className="h-7 text-xs"
                onClick={() => setStatusFilter('all')}
              >All</Button>
              <Button
                variant={statusFilter === 'up' ? 'default' : 'outline'}
                size="sm" className="h-7 text-xs"
                onClick={() => setStatusFilter('up')}
              >Up ({upCount})</Button>
              <Button
                variant={statusFilter === 'down' ? 'default' : 'outline'}
                size="sm" className="h-7 text-xs"
                onClick={() => setStatusFilter('down')}
              >Down ({downCount})</Button>
            </div>
          </div>

          {sortedPorts.length === 0 && interfaces.length === 0 ? (
            <Card>
              <CardContent className="p-8 text-center text-muted-foreground">
                No interface data returned from switch.
              </CardContent>
            </Card>
          ) : (
            <div className="rounded-md border">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/50">
                    {headers.map(([key, label]) => (
                      <th
                        key={key}
                        className="p-3 text-left font-medium cursor-pointer select-none hover:bg-muted/80 transition-colors"
                        onClick={() => handleSort(key)}
                      >
                        <span className="inline-flex items-center">{label}<SortIcon col={key} /></span>
                      </th>
                    ))}
                    <th className="p-3 text-left font-medium">MAC Address</th>
                    <th className="p-3 text-left font-medium">Description</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedPorts.map((iface) => (
                    <tr key={iface.index} className="border-b hover:bg-muted/30">
                      <td className="p-3 font-mono font-medium">{iface.name}</td>
                      <td className="p-3">
                        <Badge variant={iface.oper_status === 'up' ? 'success' : 'secondary'}>
                          {iface.oper_status}
                        </Badge>
                        {iface.admin_status === 'down' && (
                          <span className="text-xs text-muted-foreground ml-1">(disabled)</span>
                        )}
                      </td>
                      <td className="p-3 text-xs">
                        {iface.oper_status === 'up' ? formatSpeed(iface.speed) : '-'}
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
                      <td className="p-3 text-xs font-mono max-w-[200px]">
                        {portMacs[iface.name]?.length ? (
                          <span title={portMacs[iface.name].join('\n')}>
                            {portMacs[iface.name][0]}
                            {portMacs[iface.name].length > 1 && (
                              <span className="text-muted-foreground ml-1">+{portMacs[iface.name].length - 1}</span>
                            )}
                          </span>
                        ) : '-'}
                      </td>
                      <td className="p-3 text-xs text-muted-foreground truncate max-w-[200px]" title={iface.alias}>
                        {iface.alias || '-'}
                      </td>
                    </tr>
                  ))}
                  {sortedPorts.length === 0 && interfaces.length > 0 && (
                    <tr><td colSpan={8} className="p-4 text-center text-muted-foreground">No ports match current filters.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </TabsContent>

        <TabsContent value="mac" className="space-y-3">
          <Input
            placeholder="Filter by MAC or port..."
            value={macFilter}
            onChange={(e) => setMacFilter(e.target.value)}
            className="max-w-xs"
          />
          <div className="rounded-md border">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/50">
                  <th className="p-3 text-left font-medium">MAC Address</th>
                  <th className="p-3 text-left font-medium">Port</th>
                  <th className="p-3 text-left font-medium">Type</th>
                </tr>
              </thead>
              <tbody>
                {filteredMac.map((entry: SwitchMacEntry, i: number) => (
                  <tr key={i} className="border-b hover:bg-muted/30">
                    <td className="p-3 font-mono">{entry.mac}</td>
                    <td className="p-3 font-mono">
                      {entry.if_index ? (ifNameMap[entry.if_index] || `Port ${entry.if_index}`) : entry.bridge_port || '-'}
                    </td>
                    <td className="p-3">
                      <Badge variant="outline" className="text-xs">{entry.status || 'unknown'}</Badge>
                    </td>
                  </tr>
                ))}
                {macTable.length === 0 && (
                  <tr><td colSpan={3} className="p-4 text-center text-muted-foreground">No MAC table data returned from switch.</td></tr>
                )}
                {macTable.length > 0 && filteredMac.length === 0 && (
                  <tr><td colSpan={3} className="p-4 text-center text-muted-foreground">No MAC entries match filter.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </TabsContent>

        <TabsContent value="vlans">
          <div className="rounded-md border">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/50">
                  <th className="p-3 text-left font-medium">VLAN ID</th>
                  <th className="p-3 text-left font-medium">Name</th>
                </tr>
              </thead>
              <tbody>
                {vlans.map((v) => (
                  <tr key={v.id} className="border-b hover:bg-muted/30">
                    <td className="p-3 font-mono">{v.id}</td>
                    <td className="p-3">{v.name}</td>
                  </tr>
                ))}
                {vlans.length === 0 && (
                  <tr><td colSpan={2} className="p-4 text-center text-muted-foreground">No VLAN data returned from switch.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  )
}
