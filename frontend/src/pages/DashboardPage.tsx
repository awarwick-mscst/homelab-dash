import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { getServices, createService, deleteService } from '@/api/services'
import { getDevices } from '@/api/devices'
import { getSettings } from '@/api/settings'
import { getScans } from '@/api/scans'
import { useWebSocket } from '@/hooks/useWebSocket'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import {
  Plus, ExternalLink, Trash2, Activity, CheckCircle, XCircle, AlertTriangle,
  Server, Monitor, Flame, Wifi, Network, Shield, Scan, HelpCircle,
  ArrowRight, LayoutDashboard, Pin,
} from 'lucide-react'
import type { MonitoredService, ServiceStatus, Device } from '@/types'

const statusConfig: Record<ServiceStatus, { variant: 'success' | 'destructive' | 'warning' | 'secondary'; icon: typeof CheckCircle }> = {
  online: { variant: 'success', icon: CheckCircle },
  offline: { variant: 'destructive', icon: XCircle },
  degraded: { variant: 'warning', icon: AlertTriangle },
  unknown: { variant: 'secondary', icon: Activity },
}

function ServiceCard({ service, onDelete }: { service: MonitoredService; onDelete: () => void }) {
  const config = statusConfig[service.status]
  const Icon = config.icon

  return (
    <Card className="group relative">
      <CardContent className="p-4">
        <div className="flex items-start justify-between">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <h3 className="font-medium truncate">{service.name}</h3>
              <Badge variant={config.variant} className="text-xs">
                <Icon className="h-3 w-3 mr-1" />
                {service.status}
              </Badge>
            </div>
            <p className="text-xs text-muted-foreground truncate">{service.url}</p>
            {service.response_time_ms != null && (
              <p className="text-xs text-muted-foreground mt-1">{service.response_time_ms}ms</p>
            )}
          </div>
          <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
            <a href={service.url} target="_blank" rel="noopener noreferrer">
              <Button variant="ghost" size="icon" className="h-8 w-8">
                <ExternalLink className="h-3 w-3" />
              </Button>
            </a>
            <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={onDelete}>
              <Trash2 className="h-3 w-3" />
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

function IntegrationCard({ name, icon: Icon, configured, href, description }: {
  name: string; icon: typeof Server; configured: boolean; href: string; description: string
}) {
  return (
    <Link to={href}>
      <Card className="hover:bg-muted/30 transition-colors cursor-pointer h-full">
        <CardContent className="p-4">
          <div className="flex items-start justify-between mb-2">
            <div className="flex items-center gap-2">
              <Icon className="h-5 w-5 text-muted-foreground" />
              <h3 className="font-medium">{name}</h3>
            </div>
            <Badge variant={configured ? 'success' : 'secondary'} className="text-xs">
              {configured ? 'Connected' : 'Not configured'}
            </Badge>
          </div>
          <p className="text-xs text-muted-foreground">{description}</p>
        </CardContent>
      </Card>
    </Link>
  )
}

function pinnedDeviceUrl(device: Device): string | null {
  const port = device.pinned_port
  if (!port) return null
  const proto = port === 443 || port === 8443 ? 'https' : 'http'
  if (port === 80) return `http://${device.ip_address}`
  if (port === 443) return `https://${device.ip_address}`
  return `${proto}://${device.ip_address}:${port}`
}

function PinnedDeviceCard({ device }: { device: Device }) {
  const url = pinnedDeviceUrl(device)
  const inner = (
    <Card className="hover:bg-muted/30 transition-colors cursor-pointer h-full group">
      <CardContent className="p-4">
        <div className="flex items-start justify-between mb-1">
          <div className="flex items-center gap-2 min-w-0">
            <Pin className="h-4 w-4 text-yellow-500 shrink-0" />
            <h3 className="font-medium truncate">{device.hostname || device.ip_address}</h3>
          </div>
          <Badge variant={device.is_online ? 'success' : 'secondary'} className="text-xs shrink-0 ml-2">
            {device.is_online ? 'online' : 'offline'}
          </Badge>
        </div>
        <p className="text-xs text-muted-foreground font-mono">{device.ip_address}</p>
        {device.pinned_port && (
          <div className="flex items-center gap-1 mt-1.5">
            <span className="text-xs text-primary font-mono">:{device.pinned_port}</span>
            <ExternalLink className="h-3 w-3 text-primary opacity-0 group-hover:opacity-100 transition-opacity" />
          </div>
        )}
        {device.device_type && device.device_type !== 'unknown' && (
          <p className="text-xs text-muted-foreground mt-0.5 capitalize">{device.device_type}</p>
        )}
      </CardContent>
    </Card>
  )

  if (url) {
    return <a href={url} target="_blank" rel="noopener noreferrer">{inner}</a>
  }
  return <Link to="/devices">{inner}</Link>
}

export default function DashboardPage() {
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [url, setUrl] = useState('')
  const [category, setCategory] = useState('general')

  const { data: services = [] } = useQuery({ queryKey: ['services'], queryFn: getServices })
  const { data: devices = [] } = useQuery({ queryKey: ['devices'], queryFn: () => getDevices() })
  const { data: settingsData } = useQuery({ queryKey: ['settings'], queryFn: getSettings, retry: false })
  const { data: scans = [] } = useQuery({ queryKey: ['scans'], queryFn: getScans, retry: false })

  useWebSocket((msg) => {
    if (msg.type === 'service_status') {
      queryClient.invalidateQueries({ queryKey: ['services'] })
    }
  })

  const addMutation = useMutation({
    mutationFn: () => createService({ name, url, category }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['services'] })
      setOpen(false)
      setName('')
      setUrl('')
    },
  })

  const deleteMutation = useMutation({
    mutationFn: deleteService,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['services'] }),
  })

  const online = services.filter((s) => s.status === 'online').length
  const offline = services.filter((s) => s.status === 'offline').length
  const degraded = services.filter((s) => s.status === 'degraded').length
  const onlineDevices = devices.filter((d) => d.is_online).length
  const recentScans = scans.filter((s) => s.status === 'completed').length
  const runningScans = scans.filter((s) => s.status === 'running').length

  const categories = [...new Set(services.map((s) => s.category))]

  const integrations = [
    { name: 'Proxmox', icon: Monitor, configured: settingsData?.proxmox_configured ?? false, href: '/proxmox', description: 'Virtual machines and containers' },
    { name: 'pfSense', icon: Flame, configured: settingsData?.pfsense_configured ?? false, href: '/pfsense', description: 'Firewall, interfaces, ARP table' },
    { name: 'Switch', icon: Network, configured: settingsData?.switch_configured ?? false, href: '/switch', description: 'SNMP switch ports, MAC table, VLANs' },
    { name: 'UniFi', icon: Wifi, configured: settingsData?.unifi_configured ?? false, href: '/unifi', description: 'Access points, wireless clients' },
    { name: 'Ollama', icon: Shield, configured: settingsData?.ollama_configured ?? false, href: '/advisor', description: 'AI-powered security advisor' },
  ]

  const configuredCount = integrations.filter((i) => i.configured).length

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold">Dashboard</h1>
        <div className="flex gap-2">
          <Link to="/help">
            <Button variant="outline" size="sm">
              <HelpCircle className="h-4 w-4 mr-2" />Help
            </Button>
          </Link>
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button><Plus className="h-4 w-4 mr-2" />Add Service</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Add Monitored Service</DialogTitle>
              </DialogHeader>
              <form onSubmit={(e) => { e.preventDefault(); addMutation.mutate() }} className="space-y-4">
                <div className="space-y-2">
                  <label className="text-sm font-medium">Name</label>
                  <Input value={name} onChange={(e) => setName(e.target.value)} required />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">URL</label>
                  <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://..." required />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">Category</label>
                  <Input value={category} onChange={(e) => setCategory(e.target.value)} />
                </div>
                <Button type="submit" className="w-full" disabled={addMutation.isPending}>
                  {addMutation.isPending ? 'Adding...' : 'Add Service'}
                </Button>
              </form>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {/* Overview Stats */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <Link to="/devices">
          <Card className="hover:bg-muted/30 transition-colors cursor-pointer">
            <CardContent className="p-4 text-center">
              <Server className="h-5 w-5 mx-auto mb-1 text-muted-foreground" />
              <p className="text-2xl font-bold">{devices.length}</p>
              <p className="text-xs text-muted-foreground">
                Devices{onlineDevices > 0 && <span className="text-green-500 ml-1">({onlineDevices} online)</span>}
              </p>
            </CardContent>
          </Card>
        </Link>
        <Card>
          <CardContent className="p-4 text-center">
            <Activity className="h-5 w-5 mx-auto mb-1 text-muted-foreground" />
            <p className="text-2xl font-bold">{services.length}</p>
            <p className="text-xs text-muted-foreground">
              Services
              {online > 0 && <span className="text-green-500 ml-1">({online} up)</span>}
              {offline > 0 && <span className="text-red-500 ml-1">({offline} down)</span>}
            </p>
          </CardContent>
        </Card>
        <Link to="/scanner">
          <Card className="hover:bg-muted/30 transition-colors cursor-pointer">
            <CardContent className="p-4 text-center">
              <Scan className="h-5 w-5 mx-auto mb-1 text-muted-foreground" />
              <p className="text-2xl font-bold">{recentScans}</p>
              <p className="text-xs text-muted-foreground">
                Scans{runningScans > 0 && <span className="text-yellow-500 ml-1">({runningScans} running)</span>}
              </p>
            </CardContent>
          </Card>
        </Link>
        <Link to="/settings">
          <Card className="hover:bg-muted/30 transition-colors cursor-pointer">
            <CardContent className="p-4 text-center">
              <LayoutDashboard className="h-5 w-5 mx-auto mb-1 text-muted-foreground" />
              <p className="text-2xl font-bold">{configuredCount}/{integrations.length}</p>
              <p className="text-xs text-muted-foreground">Integrations</p>
            </CardContent>
          </Card>
        </Link>
        <Card>
          <CardContent className="p-4 text-center">
            <AlertTriangle className="h-5 w-5 mx-auto mb-1 text-muted-foreground" />
            <p className="text-2xl font-bold text-yellow-500">{degraded}</p>
            <p className="text-xs text-muted-foreground">Degraded</p>
          </CardContent>
        </Card>
      </div>

      {/* Integrations Overview */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-semibold">Integrations</h2>
          <Link to="/settings">
            <Button variant="ghost" size="sm" className="text-xs">
              Configure <ArrowRight className="h-3 w-3 ml-1" />
            </Button>
          </Link>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4">
          {integrations.map((integ) => (
            <IntegrationCard key={integ.name} {...integ} />
          ))}
        </div>
      </div>

      {/* Pinned Devices */}
      {devices.filter((d) => d.is_pinned).length > 0 && (
        <div>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-lg font-semibold">Pinned Devices</h2>
            <Link to="/devices">
              <Button variant="ghost" size="sm" className="text-xs">
                Manage <ArrowRight className="h-3 w-3 ml-1" />
              </Button>
            </Link>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {devices.filter((d) => d.is_pinned).map((device) => (
              <PinnedDeviceCard key={device.id} device={device} />
            ))}
          </div>
        </div>
      )}

      {/* Monitored Services */}
      <div>
        <h2 className="text-lg font-semibold mb-3">Monitored Services</h2>
        {services.length === 0 ? (
          <Card>
            <CardContent className="p-8 text-center text-muted-foreground">
              <Activity className="h-10 w-10 mx-auto mb-3 opacity-50" />
              <p className="mb-2">No services monitored yet.</p>
              <p className="text-xs">Click "Add Service" to monitor a URL's uptime and response time.</p>
            </CardContent>
          </Card>
        ) : (
          categories.map((cat) => (
            <div key={cat} className="mb-4">
              <h3 className="text-sm font-medium text-muted-foreground mb-2 capitalize">{cat}</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {services
                  .filter((s) => s.category === cat)
                  .map((service) => (
                    <ServiceCard
                      key={service.id}
                      service={service}
                      onDelete={() => deleteMutation.mutate(service.id)}
                    />
                  ))}
              </div>
            </div>
          ))
        )}
      </div>

      {/* Recent Devices */}
      {devices.length > 0 && (
        <div>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-lg font-semibold">Recent Devices</h2>
            <Link to="/devices">
              <Button variant="ghost" size="sm" className="text-xs">
                View all <ArrowRight className="h-3 w-3 ml-1" />
              </Button>
            </Link>
          </div>
          <div className="rounded-md border">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/50">
                  <th className="p-3 text-left font-medium">Hostname</th>
                  <th className="p-3 text-left font-medium">IP Address</th>
                  <th className="p-3 text-left font-medium">Status</th>
                  <th className="p-3 text-left font-medium">Type</th>
                  <th className="p-3 text-left font-medium">Last Seen</th>
                </tr>
              </thead>
              <tbody>
                {devices.slice(0, 10).map((device) => (
                  <tr key={device.id} className="border-b hover:bg-muted/30">
                    <td className="p-3 font-medium">{device.hostname || '-'}</td>
                    <td className="p-3 font-mono text-xs">{device.ip_address}</td>
                    <td className="p-3">
                      <Badge variant={device.is_online ? 'success' : 'secondary'} className="text-xs">
                        {device.is_online ? 'online' : 'offline'}
                      </Badge>
                    </td>
                    <td className="p-3 text-xs text-muted-foreground">{device.device_type || '-'}</td>
                    <td className="p-3 text-xs text-muted-foreground">
                      {device.last_seen ? new Date(device.last_seen).toLocaleString() : '-'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
