import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { getServers, getNodes, getGuests, vmAction, containerAction, autoLinkDevices, linkDevice, unlinkDevice } from '@/api/proxmox'
import { getDevices } from '@/api/devices'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Monitor, Play, Square, RotateCcw, Server, HardDrive, LayoutList, Link2, Unlink, Zap, ArrowUp, ArrowDown, ArrowUpDown } from 'lucide-react'
import type { ProxmoxNode, ProxmoxVM, ProxmoxServer, Device } from '@/types'

type GuestSortKey = 'vmid' | 'name' | 'node' | 'type' | 'status' | 'ip' | 'cpu' | 'memory' | 'uptime' | 'device'
type SortDir = 'asc' | 'desc'

function getGuestSortValue(g: ProxmoxVM, key: GuestSortKey, selectedNode: string): string | number {
  switch (key) {
    case 'vmid': return g.vmid
    case 'name': return (g.name || '').toLowerCase()
    case 'node': return (g._node ?? selectedNode).toLowerCase()
    case 'type': return (g._type ?? g.type ?? 'qemu')
    case 'status': return g.status
    case 'ip': return g.ip_addresses?.[0] ?? ''
    case 'cpu': return g.status === 'running' ? (g.cpu || 0) : -1
    case 'memory': return g.maxmem > 0 ? g.mem / g.maxmem : -1
    case 'uptime': return g.uptime || 0
    case 'device': return g.linked_device?.hostname ?? g.linked_device?.ip_address ?? ''
  }
}

function formatBytes(bytes: number): string {
  const gb = bytes / 1024 / 1024 / 1024
  return gb >= 1 ? `${gb.toFixed(1)} GB` : `${(bytes / 1024 / 1024).toFixed(0)} MB`
}

function formatUptime(seconds: number): string {
  if (!seconds) return '-'
  const d = Math.floor(seconds / 86400)
  const h = Math.floor((seconds % 86400) / 3600)
  if (d > 0) return `${d}d ${h}h`
  const m = Math.floor((seconds % 3600) / 60)
  return `${h}h ${m}m`
}

function UsageBar({ used, total, label }: { used: number; total: number; label: string }) {
  const pct = total > 0 ? (used / total) * 100 : 0
  return (
    <div>
      <div className="flex justify-between text-xs mb-1">
        <span>{label}</span>
        <span>{pct.toFixed(0)}%</span>
      </div>
      <div className="w-full bg-muted rounded-full h-2">
        <div
          className={`rounded-full h-2 transition-all ${pct > 90 ? 'bg-red-500' : pct > 70 ? 'bg-yellow-500' : 'bg-green-500'}`}
          style={{ width: `${Math.min(pct, 100)}%` }}
        />
      </div>
    </div>
  )
}

function MiniBar({ pct }: { pct: number }) {
  return (
    <div className="flex items-center gap-1.5">
      <div className="w-16 bg-muted rounded-full h-1.5">
        <div
          className={`rounded-full h-1.5 transition-all ${pct > 90 ? 'bg-red-500' : pct > 70 ? 'bg-yellow-500' : 'bg-green-500'}`}
          style={{ width: `${Math.min(pct, 100)}%` }}
        />
      </div>
      <span className="text-xs text-muted-foreground w-8">{pct.toFixed(0)}%</span>
    </div>
  )
}

function GuestTable({ guests, selectedNode, showNode, serverId, onAction, devices, onLink, onUnlink }: {
  guests: ProxmoxVM[]
  selectedNode: string
  showNode?: boolean
  serverId: string
  onAction: (params: { type: 'vm' | 'ct'; node: string; vmid: number; action: string }) => void
  devices: Device[]
  onLink: (guest: ProxmoxVM, node: string) => void
  onUnlink: (deviceId: number) => void
}) {
  const [sortKey, setSortKey] = useState<GuestSortKey>('vmid')
  const [sortDir, setSortDir] = useState<SortDir>('asc')
  const [statusFilter, setStatusFilter] = useState<string>('all')

  function handleSort(key: GuestSortKey) {
    if (sortKey === key) {
      setSortDir(sortDir === 'asc' ? 'desc' : 'asc')
    } else {
      setSortKey(key)
      setSortDir('asc')
    }
  }

  function SortIcon({ col }: { col: GuestSortKey }) {
    if (sortKey !== col) return <ArrowUpDown className="h-3 w-3 ml-1 opacity-30" />
    return sortDir === 'asc' ? <ArrowUp className="h-3 w-3 ml-1" /> : <ArrowDown className="h-3 w-3 ml-1" />
  }

  const statuses = [...new Set(guests.map(g => g.status))].sort()

  const sorted = [...guests]
    .filter(g => statusFilter === 'all' || g.status === statusFilter)
    .sort((a, b) => {
      const va = getGuestSortValue(a, sortKey, selectedNode)
      const vb = getGuestSortValue(b, sortKey, selectedNode)
      let cmp: number
      if (typeof va === 'number' && typeof vb === 'number') {
        cmp = va - vb
      } else {
        cmp = String(va).localeCompare(String(vb))
      }
      return sortDir === 'asc' ? cmp : -cmp
    })

  const headers: [GuestSortKey, string][] = [
    ['vmid', 'ID'],
    ['name', 'Name'],
    ...(showNode ? [['node', 'Node'] as [GuestSortKey, string]] : []),
    ['type', 'Type'],
    ['status', 'Status'],
    ['ip', 'IP Address'],
    ['cpu', 'CPU'],
    ['memory', 'Memory'],
    ['uptime', 'Uptime'],
    ['device', 'Device'],
  ]

  return (
    <div className="space-y-2">
      <div className="flex gap-2 items-center">
        <span className="text-sm text-muted-foreground">Status:</span>
        <div className="flex gap-1">
          <Button
            variant={statusFilter === 'all' ? 'default' : 'outline'}
            size="sm" className="h-7 text-xs"
            onClick={() => setStatusFilter('all')}
          >
            All ({guests.length})
          </Button>
          {statuses.map(s => (
            <Button
              key={s}
              variant={statusFilter === s ? 'default' : 'outline'}
              size="sm" className="h-7 text-xs"
              onClick={() => setStatusFilter(s)}
            >
              {s} ({guests.filter(g => g.status === s).length})
            </Button>
          ))}
        </div>
      </div>
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
              <th className="p-3 text-left font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((g) => {
            const guestNode = g._node ?? selectedNode
            const guestType = (g._type ?? g.type ?? 'vm') as 'qemu' | 'lxc'
            const actionType = guestType === 'qemu' ? 'vm' : 'ct'
            const cpuPct = (g.cpu || 0) * 100
            const memPct = g.maxmem > 0 ? (g.mem / g.maxmem) * 100 : 0
            return (
              <tr key={`${guestType}-${g.vmid}`} className="border-b hover:bg-muted/30">
                <td className="p-3">{g.vmid}</td>
                <td className="p-3 font-medium">{g.name}</td>
                {showNode && <td className="p-3">{guestNode}</td>}
                <td className="p-3">
                  <Badge variant="outline">{guestType === 'qemu' ? 'VM' : 'CT'}</Badge>
                </td>
                <td className="p-3">
                  <Badge variant={g.status === 'running' ? 'success' : 'secondary'}>{g.status}</Badge>
                </td>
                <td className="p-3 font-mono text-xs">
                  {g.ip_addresses && g.ip_addresses.length > 0
                    ? g.ip_addresses.map((ip, i) => <div key={i}>{ip}</div>)
                    : <span className="text-muted-foreground">-</span>}
                </td>
                <td className="p-3 min-w-[120px]">
                  {g.status === 'running' ? (
                    <MiniBar pct={cpuPct} />
                  ) : (
                    <span className="text-xs text-muted-foreground">-</span>
                  )}
                </td>
                <td className="p-3 min-w-[120px]">
                  {g.status === 'running' ? (
                    <div>
                      <MiniBar pct={memPct} />
                      <span className="text-[10px] text-muted-foreground">{formatBytes(g.mem)} / {formatBytes(g.maxmem)}</span>
                    </div>
                  ) : (
                    <span className="text-xs text-muted-foreground">{formatBytes(g.maxmem)}</span>
                  )}
                </td>
                <td className="p-3 text-xs">{formatUptime(g.uptime)}</td>
                <td className="p-3">
                  {g.linked_device ? (
                    <div className="flex items-center gap-1">
                      <Badge variant="outline" className="text-xs">
                        {g.linked_device.hostname || g.linked_device.ip_address}
                      </Badge>
                      <Button
                        variant="ghost" size="icon" className="h-6 w-6"
                        onClick={() => onUnlink(g.linked_device!.id)}
                        title="Unlink device"
                      >
                        <Unlink className="h-3 w-3" />
                      </Button>
                    </div>
                  ) : (
                    <Button
                      variant="ghost" size="sm" className="h-6 text-xs text-muted-foreground"
                      onClick={() => onLink(g, guestNode)}
                      title="Link to device"
                    >
                      <Link2 className="h-3 w-3 mr-1" />Link
                    </Button>
                  )}
                </td>
                <td className="p-3">
                  <div className="flex gap-1">
                    {g.status !== 'running' && (
                      <Button size="sm" variant="ghost" onClick={() => onAction({ type: actionType, node: guestNode, vmid: g.vmid, action: 'start' })} title="Start">
                        <Play className="h-3 w-3" />
                      </Button>
                    )}
                    {g.status === 'running' && (
                      <>
                        <Button size="sm" variant="ghost" onClick={() => onAction({ type: actionType, node: guestNode, vmid: g.vmid, action: 'shutdown' })} title="Shutdown">
                          <Square className="h-3 w-3" />
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => onAction({ type: actionType, node: guestNode, vmid: g.vmid, action: 'reboot' })} title="Reboot">
                          <RotateCcw className="h-3 w-3" />
                        </Button>
                      </>
                    )}
                  </div>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
    </div>
  )
}

function ServerView({ server }: { server: ProxmoxServer }) {
  const queryClient = useQueryClient()
  const [selectedNode, setSelectedNode] = useState<string>('')
  const [viewAll, setViewAll] = useState(false)
  const [linkDialog, setLinkDialog] = useState<{ guest: ProxmoxVM; node: string } | null>(null)
  const [selectedDeviceId, setSelectedDeviceId] = useState<string>('')

  const { data: nodes = [] } = useQuery({
    queryKey: ['proxmox', server.id, 'nodes'],
    queryFn: () => getNodes(server.id),
    retry: false,
  })

  const { data: guests = [] } = useQuery({
    queryKey: ['proxmox', server.id, 'guests', selectedNode],
    queryFn: () => getGuests(server.id, selectedNode),
    enabled: !!selectedNode && !viewAll,
  })

  const { data: devices = [] } = useQuery({
    queryKey: ['devices'],
    queryFn: () => getDevices(),
  })

  const allNodeNames = (nodes as ProxmoxNode[]).map((n) => n.node)
  const allGuestsQuery = useQuery({
    queryKey: ['proxmox', server.id, 'all-guests', allNodeNames],
    queryFn: async () => {
      const results = await Promise.all(
        allNodeNames.map((node) => getGuests(server.id, node))
      )
      return results.flat().sort((a, b) => a.vmid - b.vmid)
    },
    enabled: viewAll && allNodeNames.length > 0,
  })

  const actionMutation = useMutation({
    mutationFn: ({ type, node, vmid, action }: { type: 'vm' | 'ct'; node: string; vmid: number; action: string }) =>
      type === 'vm' ? vmAction(server.id, node, vmid, action) : containerAction(server.id, node, vmid, action),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['proxmox', server.id] })
    },
  })

  const autoLinkMutation = useMutation({
    mutationFn: () => autoLinkDevices(server.id),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['proxmox', server.id] })
      queryClient.invalidateQueries({ queryKey: ['devices'] })
      alert(`Auto-linked ${data.linked} device(s)`)
    },
  })

  const linkMutation = useMutation({
    mutationFn: linkDevice,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['proxmox', server.id] })
      queryClient.invalidateQueries({ queryKey: ['devices'] })
      setLinkDialog(null)
      setSelectedDeviceId('')
    },
  })

  const unlinkMutation = useMutation({
    mutationFn: unlinkDevice,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['proxmox', server.id] })
      queryClient.invalidateQueries({ queryKey: ['devices'] })
    },
  })

  if (!selectedNode && nodes.length > 0) {
    setSelectedNode((nodes[0] as ProxmoxNode).node)
  }

  function handleLink(guest: ProxmoxVM, node: string) {
    setLinkDialog({ guest, node })
    setSelectedDeviceId('')
  }

  function confirmLink() {
    if (!linkDialog || !selectedDeviceId) return
    const guestType = linkDialog.guest._type ?? linkDialog.guest.type ?? 'qemu'
    linkMutation.mutate({
      device_id: parseInt(selectedDeviceId),
      server_id: server.id,
      node: linkDialog.node,
      vmid: linkDialog.guest.vmid,
      type: guestType,
    })
  }

  const currentGuests = viewAll ? (allGuestsQuery.data ?? []) : guests
  const guestVms = currentGuests.filter(g => (g._type ?? g.type) === 'qemu')
  const guestCts = currentGuests.filter(g => (g._type ?? g.type) === 'lxc')

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-end gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={() => autoLinkMutation.mutate()}
          disabled={autoLinkMutation.isPending}
        >
          <Zap className="h-4 w-4 mr-2" />
          {autoLinkMutation.isPending ? 'Linking...' : 'Auto-Link Devices'}
        </Button>
        <Button
          variant={viewAll ? 'default' : 'outline'}
          onClick={() => setViewAll(!viewAll)}
        >
          <LayoutList className="h-4 w-4 mr-2" />
          {viewAll ? 'View by Node' : 'View All'}
        </Button>
      </div>

      {/* Node Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {(nodes as ProxmoxNode[]).map((node) => (
          <Card
            key={node.node}
            className={`cursor-pointer transition-colors ${!viewAll && selectedNode === node.node ? 'ring-2 ring-primary' : ''}`}
            onClick={() => { setViewAll(false); setSelectedNode(node.node) }}
          >
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2">
                <Server className="h-4 w-4" />
                {node.node}
                <Badge variant={node.status === 'online' ? 'success' : 'destructive'} className="ml-auto">
                  {node.status}
                </Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <UsageBar used={node.cpu * node.maxcpu} total={node.maxcpu} label="CPU" />
              <UsageBar used={node.mem} total={node.maxmem} label="Memory" />
              <UsageBar used={node.disk} total={node.maxdisk} label="Disk" />
            </CardContent>
          </Card>
        ))}
      </div>

      {/* View All mode */}
      {viewAll && (
        <div>
          <h2 className="text-lg font-semibold mb-3">All VMs & Containers ({currentGuests.length})</h2>
          {currentGuests.length > 0 ? (
            <GuestTable
              guests={currentGuests}
              selectedNode={selectedNode}
              showNode
              serverId={server.id}
              onAction={(p) => actionMutation.mutate(p)}
              devices={devices}
              onLink={handleLink}
              onUnlink={(id) => unlinkMutation.mutate(id)}
            />
          ) : (
            <p className="text-muted-foreground p-4">No VMs or containers found.</p>
          )}
        </div>
      )}

      {/* Per-node view */}
      {!viewAll && selectedNode && (
        <Tabs defaultValue="vms">
          <TabsList>
            <TabsTrigger value="vms">
              <HardDrive className="h-4 w-4 mr-2" />VMs ({guestVms.length})
            </TabsTrigger>
            <TabsTrigger value="containers">
              <Server className="h-4 w-4 mr-2" />Containers ({guestCts.length})
            </TabsTrigger>
          </TabsList>
          <TabsContent value="vms">
            {guestVms.length ? (
              <GuestTable
                guests={guestVms}
                selectedNode={selectedNode}
                serverId={server.id}
                onAction={(p) => actionMutation.mutate(p)}
                devices={devices}
                onLink={handleLink}
                onUnlink={(id) => unlinkMutation.mutate(id)}
              />
            ) : <p className="text-muted-foreground p-4">No VMs on this node.</p>}
          </TabsContent>
          <TabsContent value="containers">
            {guestCts.length ? (
              <GuestTable
                guests={guestCts}
                selectedNode={selectedNode}
                serverId={server.id}
                onAction={(p) => actionMutation.mutate(p)}
                devices={devices}
                onLink={handleLink}
                onUnlink={(id) => unlinkMutation.mutate(id)}
              />
            ) : <p className="text-muted-foreground p-4">No containers on this node.</p>}
          </TabsContent>
        </Tabs>
      )}

      {/* Link Device Dialog */}
      <Dialog open={!!linkDialog} onOpenChange={(o) => !o && setLinkDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Link to Device</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Link <strong>{linkDialog?.guest.name}</strong> (VMID {linkDialog?.guest.vmid}) to a device in your inventory.
          </p>
          <Select value={selectedDeviceId} onValueChange={setSelectedDeviceId}>
            <SelectTrigger>
              <SelectValue placeholder="Select a device..." />
            </SelectTrigger>
            <SelectContent>
              {devices.map((d) => (
                <SelectItem key={d.id} value={String(d.id)}>
                  {d.hostname || d.ip_address} — {d.ip_address}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className="flex gap-2 justify-end">
            <Button variant="outline" onClick={() => setLinkDialog(null)}>Cancel</Button>
            <Button onClick={confirmLink} disabled={!selectedDeviceId || linkMutation.isPending}>Link</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}

export default function ProxmoxPage() {
  const { data: servers = [], isError } = useQuery({
    queryKey: ['proxmox', 'servers'],
    queryFn: getServers,
    retry: false,
  })

  if (isError || servers.length === 0) {
    return (
      <div className="space-y-6">
        <h1 className="text-3xl font-bold">Proxmox</h1>
        <Card>
          <CardContent className="p-12 text-center text-muted-foreground">
            <Monitor className="h-12 w-12 mx-auto mb-4 opacity-50" />
            <p>No Proxmox servers configured. Go to Settings to add your Proxmox servers.</p>
          </CardContent>
        </Card>
      </div>
    )
  }

  if (servers.length === 1) {
    return (
      <div className="space-y-6">
        <h1 className="text-3xl font-bold">Proxmox — {servers[0].id}</h1>
        <ServerView server={servers[0]} />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold">Proxmox</h1>
      <Tabs defaultValue={servers[0].id}>
        <TabsList>
          {servers.map((s) => (
            <TabsTrigger key={s.id} value={s.id}>
              <Server className="h-4 w-4 mr-2" />
              {s.id}
              {s.host && <span className="ml-1 text-xs text-muted-foreground">({s.host})</span>}
            </TabsTrigger>
          ))}
        </TabsList>
        {servers.map((s) => (
          <TabsContent key={s.id} value={s.id}>
            <ServerView server={s} />
          </TabsContent>
        ))}
      </Tabs>
    </div>
  )
}
