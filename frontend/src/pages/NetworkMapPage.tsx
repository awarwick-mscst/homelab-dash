import { useCallback, useEffect, useRef, useState, useMemo } from 'react'
import ReactFlow, {
  Node, Edge, useNodesState, useEdgesState, Controls, Background, MiniMap,
  MarkerType, Handle, Position, Connection, NodeDragHandler,
} from 'react-flow-renderer'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { getDevices, createDevice, updateDevice } from '@/api/devices'
import {
  getLinks, createLink, deleteLink, getTopology, saveTopology, getSubnets,
  autoLinkUnifi, autoLinkSwitch, autoLinkProxmox,
} from '@/api/networks'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import {
  Save, Network, Link2, Trash2, Globe, Settings2, Wifi,
} from 'lucide-react'
import type { Device, NetworkLink as LinkType } from '@/types'

// ─── Remove ReactFlow default node chrome ──────────────────────────────
const clearStyle: React.CSSProperties = {
  background: 'transparent',
  border: 'none',
  padding: 0,
  boxShadow: 'none',
  borderRadius: 0,
  width: 'auto',
  height: 'auto',
}

// ─── Handles ───────────────────────────────────────────────────────────
const hdl: React.CSSProperties = { width: 6, height: 6, background: '#475569', border: '2px solid #1e293b', opacity: 0 }

function Handles({ top = 1, bottom = 1, left = 1, right = 1 }: { top?: number; bottom?: number; left?: number; right?: number }) {
  const make = (pos: Position, count: number, type: 'source' | 'target') =>
    Array.from({ length: count }).map((_, i) => {
      const pct = `${((i + 1) / (count + 1)) * 100}%`
      const s: React.CSSProperties = {
        ...hdl,
        ...(pos === Position.Top || pos === Position.Bottom
          ? { left: pct, [pos === Position.Top ? 'top' : 'bottom']: -3 }
          : { top: pct, [pos === Position.Left ? 'left' : 'right']: -3 }),
      }
      return <Handle key={`${pos}-${i}`} id={`${pos}-${i}`} type={type} position={pos} style={s} />
    })
  return (
    <>
      {make(Position.Top, top, 'target')}
      {make(Position.Bottom, bottom, 'source')}
      {make(Position.Left, left, 'target')}
      {make(Position.Right, right, 'source')}
    </>
  )
}

// ─── UniFi-style Node Components ───────────────────────────────────────
// Clean rounded cards: icon circle on top, name + IP below, status dot

function UnifiNode({
  icon, color, bgFrom, bgTo, label, ip, online, subtitle, wide,
  topH = 2, bottomH = 2, leftH = 1, rightH = 1,
}: {
  icon: React.ReactNode
  color: string
  bgFrom: string
  bgTo: string
  label: string
  ip: string
  online?: boolean
  subtitle?: string
  wide?: boolean
  topH?: number; bottomH?: number; leftH?: number; rightH?: number
}) {
  const w = wide ? 200 : 120
  return (
    <div className="relative" style={{ width: w }}>
      <Handles top={topH} bottom={bottomH} left={leftH} right={rightH} />
      <div
        style={{
          background: `linear-gradient(135deg, ${bgFrom}, ${bgTo})`,
          borderRadius: wide ? 10 : 14,
          padding: wide ? '10px 16px' : '12px 8px 10px',
          textAlign: 'center',
          border: `1.5px solid ${color}33`,
          minWidth: w,
        }}
      >
        {/* Icon circle */}
        <div
          style={{
            width: wide ? 32 : 40,
            height: wide ? 32 : 40,
            borderRadius: '50%',
            background: color,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            margin: wide ? '0 auto 6px' : '0 auto 8px',
            boxShadow: `0 2px 8px ${color}66`,
          }}
        >
          {icon}
        </div>
        {/* Name */}
        <div style={{ fontSize: 11, fontWeight: 700, color: '#f1f5f9', lineHeight: 1.2, marginBottom: 2 }}>
          {label}
        </div>
        {/* IP */}
        {ip && ip !== '0.0.0.0' && (
          <div style={{ fontSize: 9, color: '#94a3b8', fontFamily: 'monospace' }}>{ip}</div>
        )}
        {/* Subtitle / type */}
        {subtitle && (
          <div style={{ fontSize: 8, color: '#64748b', marginTop: 2, textTransform: 'capitalize' }}>{subtitle}</div>
        )}
        {/* Status dot */}
        {online !== undefined && (
          <div
            style={{
              width: 6,
              height: 6,
              borderRadius: '50%',
              background: online ? '#22c55e' : '#64748b',
              margin: '4px auto 0',
              boxShadow: online ? '0 0 6px #22c55e88' : 'none',
            }}
          />
        )}
      </div>
    </div>
  )
}

// SVG icons (small, white)
const iconGlobe = <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2"><circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15.3 15.3 0 010 20 15.3 15.3 0 010-20z"/></svg>
const iconShield = <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
const iconSwitch = <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2"><rect x="2" y="6" width="20" height="12" rx="2"/><line x1="6" y1="10" x2="6" y2="14"/><line x1="10" y1="10" x2="10" y2="14"/><line x1="14" y1="10" x2="14" y2="14"/><line x1="18" y1="10" x2="18" y2="14"/></svg>
const iconWifi = <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2"><path d="M5 12.55a11 11 0 0114.08 0M1.42 9a16 16 0 0121.16 0M8.53 16.11a6 6 0 016.95 0"/><circle cx="12" cy="20" r="1" fill="#fff"/></svg>
const iconServer = <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2"><rect x="2" y="2" width="20" height="8" rx="2"/><rect x="2" y="14" width="20" height="8" rx="2"/><circle cx="6" cy="6" r="1" fill="#fff"/><circle cx="6" cy="18" r="1" fill="#fff"/></svg>
const iconMonitor = <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>
const iconBox = <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2"><path d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z"/></svg>

function InternetNode({ data }: { data: { label: string; ip: string } }) {
  return <UnifiNode icon={iconGlobe} color="#3b82f6" bgFrom="#1e293b" bgTo="#0f172a" label={data.label} ip={data.ip} />
}
function FirewallNode({ data }: { data: { label: string; ip: string; online: boolean } }) {
  return <UnifiNode icon={iconShield} color="#ef4444" bgFrom="#1e293b" bgTo="#0f172a" label={data.label} ip={data.ip} online={data.online} topH={3} bottomH={3} />
}
function SwitchNode({ data }: { data: { label: string; ip: string; online: boolean } }) {
  return <UnifiNode icon={iconSwitch} color="#f59e0b" bgFrom="#1e293b" bgTo="#0f172a" label={data.label} ip={data.ip} online={data.online} wide topH={12} bottomH={12} leftH={2} rightH={2} />
}
function SwitchLargeNode({ data }: { data: { label: string; ip: string; online: boolean } }) {
  return <UnifiNode icon={iconSwitch} color="#f59e0b" bgFrom="#1e293b" bgTo="#0f172a" label={data.label} ip={data.ip} online={data.online} wide topH={24} bottomH={24} leftH={2} rightH={2} />
}
function AccessPointNode({ data }: { data: { label: string; ip: string; online: boolean } }) {
  return <UnifiNode icon={iconWifi} color="#8b5cf6" bgFrom="#1e293b" bgTo="#0f172a" label={data.label} ip={data.ip} online={data.online} />
}
function ServerNode({ data }: { data: { label: string; ip: string; online: boolean; deviceType: string } }) {
  return <UnifiNode icon={iconServer} color="#10b981" bgFrom="#1e293b" bgTo="#0f172a" label={data.label} ip={data.ip} online={data.online} subtitle={data.deviceType} />
}
function VMNode({ data }: { data: { label: string; ip: string; online: boolean; deviceType: string } }) {
  return <UnifiNode icon={iconBox} color="#06b6d4" bgFrom="#1e293b" bgTo="#0f172a" label={data.label} ip={data.ip} online={data.online} subtitle={data.deviceType} />
}
function DefaultNode({ data }: { data: { label: string; ip: string; online: boolean; deviceType: string } }) {
  return <UnifiNode icon={iconMonitor} color="#64748b" bgFrom="#1e293b" bgTo="#0f172a" label={data.label} ip={data.ip} online={data.online} subtitle={data.deviceType} />
}

const nodeTypes = {
  internet: InternetNode,
  firewall: FirewallNode,
  switch: SwitchNode,
  switchLarge: SwitchLargeNode,
  accessPoint: AccessPointNode,
  server: ServerNode,
  vm: VMNode,
  default: DefaultNode,
}

const DEVICE_TYPES = [
  { value: 'internet', label: 'Internet' },
  { value: 'firewall', label: 'Firewall' },
  { value: 'router', label: 'Router' },
  { value: 'switch', label: 'Switch (26 port)' },
  { value: 'switch_large', label: 'Switch (48+ port)' },
  { value: 'access_point', label: 'Access Point' },
  { value: 'server', label: 'Server' },
  { value: 'vm', label: 'Virtual Machine' },
  { value: 'container', label: 'Container (LXC)' },
  { value: 'workstation', label: 'Workstation' },
  { value: 'phone', label: 'Phone / Mobile' },
  { value: 'iot', label: 'IoT Device' },
  { value: 'camera', label: 'Camera' },
  { value: 'printer', label: 'Printer' },
  { value: 'unknown', label: 'Unknown' },
]

function getNodeType(d: Device): string {
  const t = d.device_type.toLowerCase()
  if (t === 'internet') return 'internet'
  if (t === 'firewall' || t === 'router') return 'firewall'
  if (t === 'switch_large') return 'switchLarge'
  if (t === 'switch') return 'switch'
  if (t === 'access_point' || t === 'ap') return 'accessPoint'
  if (t === 'server') return 'server'
  if (t === 'vm' || t === 'container') return 'vm'
  return 'default'
}

function deviceTier(d: Device): number {
  const t = d.device_type.toLowerCase()
  if (t === 'internet') return 0
  if (t === 'firewall' || t === 'router') return 1
  if (t === 'switch' || t === 'switch_large') return 2
  if (t === 'server') return 3
  if (t === 'access_point' || t === 'ap') return 3
  if (t === 'vm' || t === 'container') return 4
  return 5
}

function computeHierarchicalPositions(devices: Device[]): Record<string, { x: number; y: number }> {
  const tiers: Record<number, Device[]> = {}
  for (const d of devices) {
    const t = deviceTier(d)
    if (!tiers[t]) tiers[t] = []
    tiers[t].push(d)
  }

  const positions: Record<string, { x: number; y: number }> = {}
  const tierGap = 160
  const itemGap = 150

  // Find widest tier for centering
  const maxCount = Math.max(...Object.values(tiers).map(a => a.length), 1)
  const totalWidth = maxCount * itemGap
  const centerX = totalWidth / 2

  const sortedTierKeys = Object.keys(tiers).map(Number).sort((a, b) => a - b)

  for (const tier of sortedTierKeys) {
    const tierDevices = tiers[tier]
    const y = tier * tierGap + 40
    const tierWidth = tierDevices.length * itemGap
    const startX = centerX - tierWidth / 2

    for (let i = 0; i < tierDevices.length; i++) {
      positions[String(tierDevices[i].id)] = {
        x: startX + i * itemGap + itemGap / 2 - 60,
        y,
      }
    }
  }

  return positions
}

function buildEdgeLabel(link: LinkType): string {
  const parts: string[] = []
  if (link.source_port_label) parts.push(link.source_port_label)
  if (link.target_port_label) {
    if (parts.length > 0) parts.push('↔')
    parts.push(link.target_port_label)
  }
  if (parts.length === 0 && link.link_type !== 'ethernet') return link.link_type
  if (parts.length === 0) return ''
  return parts.join(' ')
}

// Edge color by type
function edgeColor(link: LinkType, selected: boolean): string {
  if (selected) return '#ef4444'
  switch (link.link_type) {
    case 'wifi': return '#8b5cf6'
    case 'wan': return '#3b82f6'
    case 'virtual': return '#06b6d4'
    case 'trunk': return '#f59e0b'
    case 'fiber': return '#f97316'
    default: return '#475569'
  }
}

// ─── Main Component ────────────────────────────────────────────────────

export default function NetworkMapPage() {
  const queryClient = useQueryClient()
  const { data: devices = [] } = useQuery({ queryKey: ['devices'], queryFn: () => getDevices() })
  const { data: links = [] } = useQuery({ queryKey: ['links'], queryFn: getLinks })
  const { data: topology } = useQuery({ queryKey: ['topology'], queryFn: getTopology })
  const { data: subnets = [] } = useQuery({ queryKey: ['subnets'], queryFn: getSubnets })

  const [nodes, setNodes, onNodesChange] = useNodesState([])
  const [edges, setEdges, onEdgesChange] = useEdgesState([])
  const draggedPositionsRef = useRef<Record<string, { x: number; y: number }>>({})

  const [addInternetOpen, setAddInternetOpen] = useState(false)
  const [inetName, setInetName] = useState('Internet')
  const [inetIp, setInetIp] = useState('')
  const [addLinkOpen, setAddLinkOpen] = useState(false)
  const [linkSource, setLinkSource] = useState('')
  const [linkTarget, setLinkTarget] = useState('')
  const [linkSourcePort, setLinkSourcePort] = useState('')
  const [linkTargetPort, setLinkTargetPort] = useState('')
  const [linkType, setLinkType] = useState('ethernet')
  const [linkBandwidth, setLinkBandwidth] = useState('')
  const [selectedEdge, setSelectedEdge] = useState<string | null>(null)
  const [changeTypeOpen, setChangeTypeOpen] = useState(false)
  const [changeTypeDeviceId, setChangeTypeDeviceId] = useState<number | null>(null)
  const [changeTypeValue, setChangeTypeValue] = useState('')
  const [autoLinkResult, setAutoLinkResult] = useState<string | null>(null)

  const saveMutation = useMutation({
    mutationFn: (layoutData: Record<string, unknown>) => saveTopology({ name: 'default', layout_data: layoutData }),
  })
  const addDeviceMutation = useMutation({
    mutationFn: (device: Partial<Device>) => createDevice(device),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['devices'] }); setAddInternetOpen(false); setInetName('Internet'); setInetIp('') },
  })
  const addLinkMutation = useMutation({
    mutationFn: (link: Partial<LinkType>) => createLink(link),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['links'] }); setAddLinkOpen(false); resetLinkForm() },
  })
  const deleteLinkMutation = useMutation({
    mutationFn: deleteLink,
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['links'] }); setSelectedEdge(null) },
  })
  const changeTypeMutation = useMutation({
    mutationFn: ({ id, device_type }: { id: number; device_type: string }) => updateDevice(id, { device_type } as Partial<Device>),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['devices'] }); setChangeTypeOpen(false) },
  })

  const runAutoLink = useCallback(() => {
    const msgs: string[] = []
    autoLinkUnifi().then(r => { if (r.created > 0) msgs.push(`${r.created} WiFi`) }).catch(() => {}).finally(() => {
      autoLinkProxmox().then(r => { if (r.created > 0) msgs.push(`${r.created} Proxmox`) }).catch(() => {}).finally(() => {
        autoLinkSwitch().then(r => { if (r.created > 0) msgs.push(`${r.created} wired`) }).catch(() => {}).finally(() => {
          queryClient.invalidateQueries({ queryKey: ['links'] })
          if (msgs.length > 0) {
            setAutoLinkResult(`Auto-linked: ${msgs.join(', ')} device${msgs.length > 1 ? 's' : ''}`)
            setTimeout(() => setAutoLinkResult(null), 5000)
          }
        })
      })
    })
  }, [queryClient])

  // Auto-link on mount
  const autoLinkRanRef = useRef(false)
  useEffect(() => {
    if (!autoLinkRanRef.current && devices.length > 0) {
      autoLinkRanRef.current = true
      runAutoLink()
    }
  }, [devices.length, runAutoLink])

  function resetLinkForm() { setLinkSource(''); setLinkTarget(''); setLinkSourcePort(''); setLinkTargetPort(''); setLinkType('ethernet'); setLinkBandwidth('') }

  const sortedDevices = useMemo(() => [...devices].sort((a, b) => {
    if (a.device_type === 'internet') return -1
    if (b.device_type === 'internet') return 1
    return (a.hostname || a.ip_address).localeCompare(b.hostname || b.ip_address)
  }), [devices])

  const onNodeDragStop: NodeDragHandler = useCallback((_e, node) => {
    draggedPositionsRef.current[node.id] = node.position
  }, [])

  // Build graph
  useEffect(() => {
    if (!devices.length) return
    const saved = (topology?.layout_data as Record<string, { x: number; y: number }>) || {}
    const dragged = draggedPositionsRef.current
    const hier = computeHierarchicalPositions(devices)

    setNodes(devices.map((d) => ({
      id: String(d.id),
      type: getNodeType(d),
      position: dragged[String(d.id)] || saved[String(d.id)] || hier[String(d.id)] || { x: 100, y: 100 },
      style: clearStyle,
      data: { label: d.hostname || d.ip_address, ip: d.ip_address, online: d.is_online, deviceType: d.device_type },
    })))

    setEdges(links.map((l) => {
      const label = buildEdgeLabel(l)
      const sel = selectedEdge === String(l.id)
      return {
        id: String(l.id),
        source: String(l.source_device_id),
        target: String(l.target_device_id),
        label: label || undefined,
        labelStyle: { fontSize: 9, fontWeight: 500, fill: '#94a3b8' },
        labelBgStyle: { fill: '#0f172a', fillOpacity: 0.9 },
        labelBgPadding: [4, 2] as [number, number],
        style: { stroke: edgeColor(l, sel), strokeWidth: sel ? 2.5 : 1.2 },
        markerEnd: { type: MarkerType.Arrow, width: 10, height: 10, color: edgeColor(l, sel) },
        animated: l.link_type === 'wan' || l.link_type === 'wifi',
      }
    }))
  }, [devices, links, topology])

  useEffect(() => {
    setEdges(eds => eds.map(e => {
      const link = links.find(l => String(l.id) === e.id)
      if (!link) return e
      const sel = selectedEdge === e.id
      return { ...e, style: { stroke: edgeColor(link, sel), strokeWidth: sel ? 2.5 : 1.2 } }
    }))
  }, [selectedEdge, setEdges, links])

  const onConnect = useCallback((c: Connection) => {
    if (!c.source || !c.target) return
    setLinkSource(c.source); setLinkTarget(c.target); setLinkSourcePort(''); setLinkTargetPort(''); setLinkType('ethernet'); setLinkBandwidth(''); setAddLinkOpen(true)
  }, [])

  const handleSave = useCallback(() => {
    const all: Record<string, { x: number; y: number }> = {}
    for (const n of nodes) all[n.id] = n.position
    Object.assign(all, draggedPositionsRef.current)
    saveMutation.mutate(all)
  }, [saveMutation, nodes])

  const selectedLink = selectedEdge ? links.find(l => String(l.id) === selectedEdge) : null
  const selectedSourceDevice = selectedLink ? devices.find(d => d.id === selectedLink.source_device_id) : null
  const selectedTargetDevice = selectedLink ? devices.find(d => d.id === selectedLink.target_device_id) : null
  const changeTypeDevice = changeTypeDeviceId ? devices.find(d => d.id === changeTypeDeviceId) : null

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h1 className="text-3xl font-bold">Network Map</h1>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => setAddInternetOpen(true)}>
            <Globe className="h-4 w-4 mr-2" />Add Internet
          </Button>
          <Button variant="outline" size="sm" onClick={() => { resetLinkForm(); setAddLinkOpen(true) }}>
            <Link2 className="h-4 w-4 mr-2" />Add Connection
          </Button>
          <Button variant="outline" size="sm" onClick={runAutoLink}>
            <Wifi className="h-4 w-4 mr-2" />Auto-Link
          </Button>
          <Button size="sm" onClick={handleSave} disabled={saveMutation.isPending}>
            <Save className="h-4 w-4 mr-2" />Save Layout
          </Button>
        </div>
      </div>

      <p className="text-xs text-muted-foreground">Drag between devices to connect. Right-click to change type.</p>

      {autoLinkResult && (
        <div className="bg-green-50 dark:bg-green-950 border border-green-200 dark:border-green-800 rounded-md p-2.5 text-sm">{autoLinkResult}</div>
      )}

      {selectedLink && (
        <Card>
          <CardContent className="p-3 flex items-center justify-between">
            <div className="flex items-center gap-3 text-sm">
              <Badge variant="outline">{selectedLink.link_type}</Badge>
              <span className="font-medium">{selectedSourceDevice?.hostname || selectedSourceDevice?.ip_address || '?'}</span>
              {selectedLink.source_port_label && <span className="text-xs text-muted-foreground">({selectedLink.source_port_label})</span>}
              <span className="text-muted-foreground">&rarr;</span>
              <span className="font-medium">{selectedTargetDevice?.hostname || selectedTargetDevice?.ip_address || '?'}</span>
              {selectedLink.target_port_label && <span className="text-xs text-muted-foreground">({selectedLink.target_port_label})</span>}
            </div>
            <Button variant="destructive" size="sm" onClick={() => deleteLinkMutation.mutate(selectedLink.id)}>
              <Trash2 className="h-4 w-4 mr-1" />Delete
            </Button>
          </CardContent>
        </Card>
      )}

      {devices.length === 0 ? (
        <Card><CardContent className="p-12 text-center text-muted-foreground">
          <Network className="h-12 w-12 mx-auto mb-4 opacity-50" />
          <p>No devices to display. Add devices or run a scan first.</p>
        </CardContent></Card>
      ) : (
        <div className="h-[calc(100vh-240px)] border rounded-lg overflow-hidden" style={{ background: '#0f172a' }}>
          <ReactFlow
            nodes={nodes} edges={edges}
            onNodesChange={onNodesChange} onEdgesChange={onEdgesChange}
            onNodeDragStop={onNodeDragStop} onConnect={onConnect}
            onEdgeClick={useCallback((_: React.MouseEvent, e: Edge) => setSelectedEdge(p => p === e.id ? null : e.id), [])}
            onPaneClick={useCallback(() => setSelectedEdge(null), [])}
            onNodeContextMenu={useCallback((ev: React.MouseEvent, node: Node) => {
              ev.preventDefault()
              const d = devices.find(x => String(x.id) === node.id)
              if (d) { setChangeTypeDeviceId(d.id); setChangeTypeValue(d.device_type); setChangeTypeOpen(true) }
            }, [devices])}
            nodeTypes={nodeTypes} fitView snapToGrid snapGrid={[10, 10]}
          >
            <Controls />
            <MiniMap style={{ background: '#1e293b' }} nodeColor={() => '#334155'} />
            <Background gap={30} color="#1e293b" />
          </ReactFlow>
        </div>
      )}

      {subnets.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {subnets.map(s => (
            <Card key={s.id}><CardContent className="p-4">
              <h3 className="font-medium">{s.name}</h3>
              <p className="text-sm text-muted-foreground font-mono">{s.cidr}</p>
              {s.vlan_id && <p className="text-xs text-muted-foreground">VLAN {s.vlan_id}</p>}
            </CardContent></Card>
          ))}
        </div>
      )}

      {/* Dialogs */}
      <Dialog open={addInternetOpen} onOpenChange={setAddInternetOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Add Internet / WAN Node</DialogTitle></DialogHeader>
          <form onSubmit={e => { e.preventDefault(); addDeviceMutation.mutate({ hostname: inetName, ip_address: inetIp || '0.0.0.0', device_type: 'internet' }) }} className="space-y-3">
            <Input value={inetName} onChange={e => setInetName(e.target.value)} placeholder="Name" />
            <Input value={inetIp} onChange={e => setInetIp(e.target.value)} placeholder="Public IP (optional)" />
            <Button type="submit" className="w-full" disabled={addDeviceMutation.isPending}>Add</Button>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={addLinkOpen} onOpenChange={setAddLinkOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>Add Connection</DialogTitle></DialogHeader>
          <form onSubmit={e => { e.preventDefault(); if (linkSource && linkTarget) addLinkMutation.mutate({ source_device_id: Number(linkSource), target_device_id: Number(linkTarget), link_type: linkType, source_port_label: linkSourcePort || null, target_port_label: linkTargetPort || null, bandwidth: linkBandwidth || null }) }} className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-sm font-medium">From</label>
                <Select value={linkSource} onValueChange={setLinkSource}><SelectTrigger><SelectValue placeholder="Device..." /></SelectTrigger><SelectContent>
                  {sortedDevices.map(d => <SelectItem key={d.id} value={String(d.id)}>{d.hostname || d.ip_address} <span className="text-muted-foreground text-xs">({d.device_type})</span></SelectItem>)}
                </SelectContent></Select>
              </div>
              <div className="space-y-1"><label className="text-sm font-medium">Port</label><Input value={linkSourcePort} onChange={e => setLinkSourcePort(e.target.value)} placeholder="WAN, LAN, eth0" /></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-sm font-medium">To</label>
                <Select value={linkTarget} onValueChange={setLinkTarget}><SelectTrigger><SelectValue placeholder="Device..." /></SelectTrigger><SelectContent>
                  {sortedDevices.map(d => <SelectItem key={d.id} value={String(d.id)}>{d.hostname || d.ip_address} <span className="text-muted-foreground text-xs">({d.device_type})</span></SelectItem>)}
                </SelectContent></Select>
              </div>
              <div className="space-y-1"><label className="text-sm font-medium">Port</label><Input value={linkTargetPort} onChange={e => setLinkTargetPort(e.target.value)} placeholder="Port 26, Port 1" /></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1"><label className="text-sm font-medium">Type</label>
                <Select value={linkType} onValueChange={setLinkType}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>
                  <SelectItem value="ethernet">Ethernet</SelectItem><SelectItem value="wan">WAN</SelectItem><SelectItem value="trunk">Trunk</SelectItem>
                  <SelectItem value="wifi">WiFi</SelectItem><SelectItem value="vpn">VPN</SelectItem><SelectItem value="fiber">Fiber</SelectItem><SelectItem value="virtual">Virtual</SelectItem>
                </SelectContent></Select>
              </div>
              <div className="space-y-1"><label className="text-sm font-medium">Bandwidth</label><Input value={linkBandwidth} onChange={e => setLinkBandwidth(e.target.value)} placeholder="1Gbps" /></div>
            </div>
            <Button type="submit" className="w-full" disabled={addLinkMutation.isPending || !linkSource || !linkTarget}>Create Connection</Button>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={changeTypeOpen} onOpenChange={setChangeTypeOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle><Settings2 className="h-4 w-4 inline mr-2" />Change Device Type</DialogTitle></DialogHeader>
          {changeTypeDevice && (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                <span className="font-medium text-foreground">{changeTypeDevice.hostname || changeTypeDevice.ip_address}</span>
                {' '}&mdash; <Badge variant="outline" className="ml-1">{changeTypeDevice.device_type}</Badge>
              </p>
              <Select value={changeTypeValue} onValueChange={setChangeTypeValue}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>
                {DEVICE_TYPES.map(dt => <SelectItem key={dt.value} value={dt.value}>{dt.label}</SelectItem>)}
              </SelectContent></Select>
              <Button className="w-full" disabled={changeTypeMutation.isPending || changeTypeValue === changeTypeDevice.device_type}
                onClick={() => { if (changeTypeDeviceId) changeTypeMutation.mutate({ id: changeTypeDeviceId, device_type: changeTypeValue }) }}>
                Update Type
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
