import { useState, useMemo, useRef, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { getDevices, createDevice, updateDevice, deleteDevice, toggleDeviceMonitor, toggleDevicePin } from '@/api/devices'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Plus, Trash2, Server, Eye, EyeOff, ArrowUp, ArrowDown, ArrowUpDown, ExternalLink, Pencil, Check, X, Pin, PinOff } from 'lucide-react'
import { useWebSocket } from '@/hooks/useWebSocket'
import type { Device, DevicePort } from '@/types'

type SortKey = 'status' | 'hostname' | 'ip_address' | 'mac_address' | 'device_type' | 'os' | 'ports'
type SortDir = 'asc' | 'desc'

function compareIPs(a: string, b: string): number {
  const pa = a.split('.').map(Number)
  const pb = b.split('.').map(Number)
  for (let i = 0; i < 4; i++) {
    if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) - (pb[i] || 0)
  }
  return 0
}

function getSortValue(device: Device, key: SortKey): string | number {
  switch (key) {
    case 'status':
      return device.is_monitored ? (device.monitor_status || 'unknown') : (device.is_online ? 'online' : 'offline')
    case 'hostname':
      return (device.hostname || '').toLowerCase()
    case 'ip_address':
      return device.ip_address
    case 'mac_address':
      return (device.mac_address || '').toLowerCase()
    case 'device_type':
      return device.device_type.toLowerCase()
    case 'os':
      return (device.os_family || '').toLowerCase()
    case 'ports':
      return device.ports.length
  }
}

/** Build a URL from IP + port number */
function portUrl(ip: string, port: DevicePort): string {
  const p = port.port_number
  const proto = p === 443 || p === 8443 ? 'https' : 'http'
  if (p === 80) return `${proto}://${ip}`
  if (p === 443) return `${proto}://${ip}`
  return `${proto}://${ip}:${p}`
}

/** Whether a port is likely a web service */
function isWebPort(port: DevicePort): boolean {
  const webPorts = [80, 443, 8080, 8443, 8000, 8888, 3000, 3001, 5000, 5001, 8081, 8082, 9090, 9443, 4443, 7443, 8006, 8123, 8444, 9000, 10000]
  if (webPorts.includes(port.port_number)) return true
  const svc = (port.service_name || '').toLowerCase()
  return svc.includes('http') || svc.includes('https') || svc.includes('web') || svc.includes('ssl')
}

function PortBadges({ device }: { device: Device }) {
  if (device.ports.length === 0) return <span className="text-muted-foreground">-</span>
  return (
    <div className="flex flex-wrap gap-1">
      {device.ports.map((p) => {
        const web = isWebPort(p)
        if (web) {
          return (
            <a
              key={p.id}
              href={portUrl(device.ip_address, p)}
              target="_blank"
              rel="noopener noreferrer"
              title={`Open ${portUrl(device.ip_address, p)}${p.service_name ? ` (${p.service_name})` : ''}`}
              className="inline-flex items-center gap-0.5 rounded bg-primary/10 text-primary px-1.5 py-0.5 text-xs font-mono hover:bg-primary/20 transition-colors cursor-pointer"
            >
              {p.port_number}
              <ExternalLink className="h-2.5 w-2.5" />
            </a>
          )
        }
        return (
          <span
            key={p.id}
            title={p.service_name ? `${p.port_number}/${p.protocol} - ${p.service_name}` : `${p.port_number}/${p.protocol}`}
            className="inline-block rounded bg-muted px-1.5 py-0.5 text-xs font-mono"
          >
            {p.port_number}
          </span>
        )
      })}
    </div>
  )
}

function InlineHostnameEdit({ device, onSave }: { device: Device; onSave: (name: string) => void }) {
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState(device.hostname || '')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (editing) {
      setValue(device.hostname || '')
      setTimeout(() => inputRef.current?.focus(), 0)
    }
  }, [editing, device.hostname])

  function save() {
    const trimmed = value.trim()
    if (trimmed !== (device.hostname || '')) {
      onSave(trimmed)
    }
    setEditing(false)
  }

  function cancel() {
    setValue(device.hostname || '')
    setEditing(false)
  }

  if (editing) {
    return (
      <div className="flex items-center gap-1">
        <Input
          ref={inputRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') save()
            if (e.key === 'Escape') cancel()
          }}
          className="h-7 text-sm font-mono px-1.5 py-0 w-40"
        />
        <Button variant="ghost" size="icon" className="h-6 w-6 text-green-500" onClick={save}>
          <Check className="h-3 w-3" />
        </Button>
        <Button variant="ghost" size="icon" className="h-6 w-6 text-muted-foreground" onClick={cancel}>
          <X className="h-3 w-3" />
        </Button>
      </div>
    )
  }

  return (
    <div className="flex items-center gap-1 group/name">
      <span className="font-mono">{device.hostname || '-'}</span>
      <Button
        variant="ghost"
        size="icon"
        className="h-6 w-6 opacity-0 group-hover/name:opacity-100 transition-opacity"
        onClick={() => setEditing(true)}
        title="Rename device"
      >
        <Pencil className="h-3 w-3" />
      </Button>
    </div>
  )
}

export default function DeviceInventoryPage() {
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)
  const [monitorDialog, setMonitorDialog] = useState<{ id: number; hostname: string | null } | null>(null)
  const [monitorUrl, setMonitorUrl] = useState('')
  const [pinDialog, setPinDialog] = useState<Device | null>(null)
  const [pinPort, setPinPort] = useState<number | null>(null)
  const [filter, setFilter] = useState('')
  const [showMonitoredOnly, setShowMonitoredOnly] = useState(false)
  const [sortKey, setSortKey] = useState<SortKey>('ip_address')
  const [sortDir, setSortDir] = useState<SortDir>('asc')
  const [form, setForm] = useState({ hostname: '', ip_address: '', device_type: 'unknown', mac_address: '', location: '' })

  const { data: devices = [] } = useQuery({ queryKey: ['devices'], queryFn: () => getDevices() })

  useWebSocket((msg) => {
    if (msg.type === 'device_monitor') {
      queryClient.invalidateQueries({ queryKey: ['devices'] })
    }
  })

  const addMutation = useMutation({
    mutationFn: () => createDevice(form),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['devices'] })
      setOpen(false)
      setForm({ hostname: '', ip_address: '', device_type: 'unknown', mac_address: '', location: '' })
    },
  })

  const deleteMutation = useMutation({
    mutationFn: deleteDevice,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['devices'] }),
  })

  const renameMutation = useMutation({
    mutationFn: ({ id, hostname }: { id: number; hostname: string }) =>
      updateDevice(id, { hostname }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['devices'] }),
  })

  const pinMutation = useMutation({
    mutationFn: ({ id, is_pinned, pinned_port }: { id: number; is_pinned: boolean; pinned_port?: number | null }) =>
      toggleDevicePin(id, { is_pinned, pinned_port }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['devices'] }),
  })

  const monitorMutation = useMutation({
    mutationFn: ({ id, is_monitored, monitor_url }: { id: number; is_monitored: boolean; monitor_url?: string | null }) =>
      toggleDeviceMonitor(id, { is_monitored, monitor_url }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['devices'] }),
  })

  const filtered = useMemo(() => {
    const list = devices.filter((d) => {
      const matchesFilter =
        (d.hostname || '').toLowerCase().includes(filter.toLowerCase()) ||
        d.ip_address.includes(filter) ||
        (d.mac_address || '').toLowerCase().includes(filter.toLowerCase())
      if (showMonitoredOnly) return matchesFilter && d.is_monitored
      return matchesFilter
    })

    list.sort((a, b) => {
      let cmp: number
      if (sortKey === 'ip_address') {
        cmp = compareIPs(a.ip_address, b.ip_address)
      } else {
        const va = getSortValue(a, sortKey)
        const vb = getSortValue(b, sortKey)
        if (typeof va === 'number' && typeof vb === 'number') {
          cmp = va - vb
        } else {
          cmp = String(va).localeCompare(String(vb))
        }
      }
      return sortDir === 'asc' ? cmp : -cmp
    })

    return list
  }, [devices, filter, showMonitoredOnly, sortKey, sortDir])

  const monitoredCount = devices.filter((d) => d.is_monitored).length
  const onlineCount = devices.filter((d) => d.is_online).length
  const offlineCount = devices.length - onlineCount

  function handleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir(sortDir === 'asc' ? 'desc' : 'asc')
    } else {
      setSortKey(key)
      setSortDir('asc')
    }
  }

  function SortIcon({ column }: { column: SortKey }) {
    if (sortKey !== column) return <ArrowUpDown className="h-3 w-3 ml-1 opacity-30" />
    return sortDir === 'asc' ? <ArrowUp className="h-3 w-3 ml-1" /> : <ArrowDown className="h-3 w-3 ml-1" />
  }

  function handleMonitorToggle(device: typeof devices[0]) {
    if (device.is_monitored) {
      monitorMutation.mutate({ id: device.id, is_monitored: false })
    } else {
      setMonitorDialog({ id: device.id, hostname: device.hostname })
      setMonitorUrl('')
    }
  }

  function confirmMonitor() {
    if (monitorDialog) {
      monitorMutation.mutate({
        id: monitorDialog.id,
        is_monitored: true,
        monitor_url: monitorUrl || null,
      })
      setMonitorDialog(null)
    }
  }

  function statusBadge(device: typeof devices[0]) {
    if (!device.is_monitored) {
      return (
        <Badge variant={device.is_online ? 'success' : 'secondary'}>
          {device.is_online ? 'Online' : 'Offline'}
        </Badge>
      )
    }
    const status = device.monitor_status || 'unknown'
    const variant = status === 'online' ? 'success' : status === 'degraded' ? 'warning' : status === 'offline' ? 'destructive' : 'secondary'
    return (
      <div className="flex items-center gap-1.5">
        <Badge variant={variant as 'success' | 'warning' | 'destructive' | 'secondary'}>
          {status}
        </Badge>
        {device.response_time_ms != null && (
          <span className="text-xs text-muted-foreground">{device.response_time_ms}ms</span>
        )}
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold">Device Inventory <span className="text-lg font-normal text-muted-foreground">({filtered.length}{filtered.length !== devices.length ? ` / ${devices.length}` : ''} devices)</span></h1>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button><Plus className="h-4 w-4 mr-2" />Add Device</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Add Device</DialogTitle></DialogHeader>
            <form onSubmit={(e) => { e.preventDefault(); addMutation.mutate() }} className="space-y-3">
              <Input placeholder="Hostname" value={form.hostname} onChange={(e) => setForm({ ...form, hostname: e.target.value })} />
              <Input placeholder="IP Address" value={form.ip_address} onChange={(e) => setForm({ ...form, ip_address: e.target.value })} required />
              <Input placeholder="MAC Address" value={form.mac_address} onChange={(e) => setForm({ ...form, mac_address: e.target.value })} />
              <Input placeholder="Device Type" value={form.device_type} onChange={(e) => setForm({ ...form, device_type: e.target.value })} />
              <Input placeholder="Location" value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} />
              <Button type="submit" className="w-full" disabled={addMutation.isPending}>Add</Button>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      <div className="flex gap-4 text-sm">
        <div className="flex items-center gap-1.5">
          <div className="w-2.5 h-2.5 rounded-full bg-green-500" />
          <span>{onlineCount} online</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-2.5 h-2.5 rounded-full bg-gray-400" />
          <span>{offlineCount} offline</span>
        </div>
        <span className="text-muted-foreground">|</span>
        <span className="text-muted-foreground">{devices.length} total</span>
      </div>

      <div className="flex gap-3 items-center">
        <Input placeholder="Filter by hostname, IP, or MAC..." value={filter} onChange={(e) => setFilter(e.target.value)} className="max-w-md" />
        <Button
          variant={showMonitoredOnly ? 'default' : 'outline'}
          size="sm"
          onClick={() => setShowMonitoredOnly(!showMonitoredOnly)}
        >
          <Eye className="h-4 w-4 mr-1" />
          Monitored ({monitoredCount})
        </Button>
      </div>

      {/* Monitor URL Dialog */}
      <Dialog open={!!monitorDialog} onOpenChange={(o) => !o && setMonitorDialog(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Enable Monitoring</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">
            Device: {monitorDialog?.hostname || 'Unknown'}. Optionally provide an HTTP URL for health checks (leave empty for ping-only).
          </p>
          <Input placeholder="http://192.168.1.x:8080 (optional)" value={monitorUrl} onChange={(e) => setMonitorUrl(e.target.value)} />
          <div className="flex gap-2 justify-end">
            <Button variant="outline" onClick={() => setMonitorDialog(null)}>Cancel</Button>
            <Button onClick={confirmMonitor}>Enable</Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Pin to Dashboard Dialog */}
      <Dialog open={!!pinDialog} onOpenChange={(o) => { if (!o) setPinDialog(null) }}>
        <DialogContent>
          <DialogHeader><DialogTitle>Pin to Dashboard</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">
            Pin <span className="font-medium text-foreground">{pinDialog?.hostname || pinDialog?.ip_address}</span> to the dashboard.
            {pinDialog && pinDialog.ports.length > 0 && ' Select a port to open when clicked:'}
          </p>
          {pinDialog && pinDialog.ports.length > 0 && (
            <div className="flex flex-wrap gap-2">
              <Button
                variant={pinPort === null ? 'default' : 'outline'}
                size="sm"
                onClick={() => setPinPort(null)}
              >None</Button>
              {pinDialog.ports.map((p) => (
                <Button
                  key={p.id}
                  variant={pinPort === p.port_number ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setPinPort(p.port_number)}
                >
                  {p.port_number}{p.service_name ? ` (${p.service_name})` : ''}
                </Button>
              ))}
            </div>
          )}
          <div className="flex gap-2 justify-end">
            <Button variant="outline" onClick={() => setPinDialog(null)}>Cancel</Button>
            <Button onClick={() => {
              if (pinDialog) {
                pinMutation.mutate({ id: pinDialog.id, is_pinned: true, pinned_port: pinPort })
                setPinDialog(null)
              }
            }}>Pin</Button>
          </div>
        </DialogContent>
      </Dialog>

      {filtered.length === 0 ? (
        <Card>
          <CardContent className="p-12 text-center text-muted-foreground">
            <Server className="h-12 w-12 mx-auto mb-4 opacity-50" />
            <p>No devices found. Add devices manually or run a network scan.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="rounded-md border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/50">
                {([['status', 'Status'], ['hostname', 'Hostname'], ['ip_address', 'IP Address'], ['mac_address', 'MAC'], ['device_type', 'Type'], ['os', 'OS'], ['ports', 'Ports']] as [SortKey, string][]).map(([key, label]) => (
                  <th
                    key={key}
                    className="p-3 text-left font-medium cursor-pointer select-none hover:bg-muted/80 transition-colors"
                    onClick={() => handleSort(key)}
                  >
                    <span className="inline-flex items-center">
                      {label}<SortIcon column={key} />
                    </span>
                  </th>
                ))}
                <th className="p-3 text-left font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((device) => (
                <tr key={device.id} className="border-b hover:bg-muted/30">
                  <td className="p-3">{statusBadge(device)}</td>
                  <td className="p-3">
                    <InlineHostnameEdit
                      device={device}
                      onSave={(hostname) => renameMutation.mutate({ id: device.id, hostname })}
                    />
                  </td>
                  <td className="p-3 font-mono">{device.ip_address}</td>
                  <td className="p-3 font-mono text-xs">{device.mac_address || '-'}</td>
                  <td className="p-3 capitalize">{device.device_type}</td>
                  <td className="p-3 text-xs">
                    {device.os_family
                      ? `${device.os_family}${device.os_version ? ` ${device.os_version}` : ''}`
                      : '-'}
                  </td>
                  <td className="p-3"><PortBadges device={device} /></td>
                  <td className="p-3">
                    <div className="flex gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        className={`h-8 w-8 ${device.is_pinned ? 'text-yellow-500' : 'text-muted-foreground'}`}
                        onClick={() => {
                          if (device.is_pinned) {
                            pinMutation.mutate({ id: device.id, is_pinned: false })
                          } else {
                            setPinDialog(device)
                            setPinPort(device.ports.length > 0 ? device.ports[0].port_number : null)
                          }
                        }}
                        title={device.is_pinned ? 'Unpin from dashboard' : 'Pin to dashboard'}
                      >
                        {device.is_pinned ? <PinOff className="h-3 w-3" /> : <Pin className="h-3 w-3" />}
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className={`h-8 w-8 ${device.is_monitored ? 'text-primary' : 'text-muted-foreground'}`}
                        onClick={() => handleMonitorToggle(device)}
                        title={device.is_monitored ? 'Stop monitoring' : 'Start monitoring'}
                      >
                        {device.is_monitored ? <Eye className="h-3 w-3" /> : <EyeOff className="h-3 w-3" />}
                      </Button>
                      <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => deleteMutation.mutate(device.id)}>
                        <Trash2 className="h-3 w-3" />
                      </Button>
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
