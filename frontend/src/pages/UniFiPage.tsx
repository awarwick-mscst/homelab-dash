import { useQuery } from '@tanstack/react-query'
import { getDevices, getClients, getWlanNetworks, getHealth } from '@/api/unifi'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { Badge } from '@/components/ui/badge'
import { Wifi, Radio, Users, Activity, Router } from 'lucide-react'
import type { UniFiDevice, UniFiClient as UniFiClientType, UniFiWlan, UniFiHealth } from '@/types'

function formatUptime(seconds: number): string {
  if (!seconds) return '-'
  const days = Math.floor(seconds / 86400)
  const hours = Math.floor((seconds % 86400) / 3600)
  if (days > 0) return `${days}d ${hours}h`
  const mins = Math.floor((seconds % 3600) / 60)
  return `${hours}h ${mins}m`
}

function formatRate(rate?: number): string {
  if (!rate) return '-'
  if (rate >= 1000) return `${(rate / 1000).toFixed(0)} Mbps`
  return `${rate} Kbps`
}

function deviceTypeLabel(type: string): string {
  switch (type) {
    case 'uap': return 'AP'
    case 'usw': return 'Switch'
    case 'ugw': return 'Gateway'
    case 'udm': return 'Dream Machine'
    case 'uxg': return 'Gateway'
    default: return type?.toUpperCase() ?? 'Unknown'
  }
}

function DevicesTab({ devices }: { devices: UniFiDevice[] }) {
  if (!devices.length) return <p className="text-muted-foreground p-4">No devices found.</p>

  return (
    <div className="rounded-md border overflow-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b bg-muted/50">
            <th className="p-3 text-left font-medium">Name</th>
            <th className="p-3 text-left font-medium">Type</th>
            <th className="p-3 text-left font-medium">Model</th>
            <th className="p-3 text-left font-medium">IP</th>
            <th className="p-3 text-left font-medium">MAC</th>
            <th className="p-3 text-left font-medium">Status</th>
            <th className="p-3 text-left font-medium">Clients</th>
            <th className="p-3 text-left font-medium">Version</th>
            <th className="p-3 text-left font-medium">Uptime</th>
          </tr>
        </thead>
        <tbody>
          {devices.map((d) => (
            <tr key={d._id} className="border-b hover:bg-muted/30">
              <td className="p-3 font-medium">{d.name || 'Unnamed'}</td>
              <td className="p-3">
                <Badge variant="outline">{deviceTypeLabel(d.type)}</Badge>
              </td>
              <td className="p-3 text-xs">{d.model}</td>
              <td className="p-3 font-mono text-xs">{d.ip}</td>
              <td className="p-3 font-mono text-xs">{d.mac}</td>
              <td className="p-3">
                <Badge variant={d.state === 1 ? 'success' : 'destructive'}>
                  {d.state === 1 ? 'Online' : 'Offline'}
                </Badge>
              </td>
              <td className="p-3">{d.num_sta ?? 0}</td>
              <td className="p-3 text-xs">{d.version}</td>
              <td className="p-3 text-xs">{formatUptime(d.uptime)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function ClientsTab({ clients }: { clients: UniFiClientType[] }) {
  if (!clients.length) return <p className="text-muted-foreground p-4">No connected clients.</p>

  const sorted = [...clients].sort((a, b) => {
    if (a.is_wired !== b.is_wired) return a.is_wired ? 1 : -1
    return (a.hostname ?? a.name ?? a.mac).localeCompare(b.hostname ?? b.name ?? b.mac)
  })

  return (
    <div className="rounded-md border overflow-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b bg-muted/50">
            <th className="p-3 text-left font-medium">Name</th>
            <th className="p-3 text-left font-medium">IP</th>
            <th className="p-3 text-left font-medium">MAC</th>
            <th className="p-3 text-left font-medium">Connection</th>
            <th className="p-3 text-left font-medium">Network / SSID</th>
            <th className="p-3 text-left font-medium">Signal</th>
            <th className="p-3 text-left font-medium">TX / RX</th>
            <th className="p-3 text-left font-medium">Uptime</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((c) => (
            <tr key={c._id} className="border-b hover:bg-muted/30">
              <td className="p-3 font-medium">{c.hostname || c.name || c.mac}</td>
              <td className="p-3 font-mono text-xs">{c.ip}</td>
              <td className="p-3 font-mono text-xs">{c.mac}</td>
              <td className="p-3">
                <Badge variant="outline">{c.is_wired ? 'Wired' : 'WiFi'}</Badge>
              </td>
              <td className="p-3 text-xs">{c.essid || c.network || '-'}</td>
              <td className="p-3 text-xs">
                {!c.is_wired && c.signal != null ? `${c.signal} dBm` : '-'}
              </td>
              <td className="p-3 text-xs">
                {!c.is_wired ? `${formatRate(c.tx_rate)} / ${formatRate(c.rx_rate)}` : '-'}
              </td>
              <td className="p-3 text-xs">{formatUptime(c.uptime ?? 0)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function WlanTab({ wlans }: { wlans: UniFiWlan[] }) {
  if (!wlans.length) return <p className="text-muted-foreground p-4">No WiFi networks configured.</p>

  return (
    <div className="rounded-md border overflow-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b bg-muted/50">
            <th className="p-3 text-left font-medium">SSID</th>
            <th className="p-3 text-left font-medium">Status</th>
            <th className="p-3 text-left font-medium">Security</th>
            <th className="p-3 text-left font-medium">VLAN</th>
            <th className="p-3 text-left font-medium">Band</th>
          </tr>
        </thead>
        <tbody>
          {wlans.map((w) => (
            <tr key={w._id} className="border-b hover:bg-muted/30">
              <td className="p-3 font-medium">{w.name}</td>
              <td className="p-3">
                <Badge variant={w.enabled ? 'success' : 'secondary'}>
                  {w.enabled ? 'Enabled' : 'Disabled'}
                </Badge>
              </td>
              <td className="p-3 text-xs">{w.security || 'Open'}</td>
              <td className="p-3">{w.vlan || '-'}</td>
              <td className="p-3 text-xs">{w.wlan_band || 'Both'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function HealthTab({ health }: { health: UniFiHealth[] }) {
  if (!health.length) return <p className="text-muted-foreground p-4">No health data available.</p>

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
      {health.map((h) => (
        <Card key={h.subsystem}>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              {h.subsystem === 'wlan' && <Wifi className="h-4 w-4" />}
              {h.subsystem === 'lan' && <Router className="h-4 w-4" />}
              {h.subsystem === 'wan' && <Activity className="h-4 w-4" />}
              {!['wlan', 'lan', 'wan'].includes(h.subsystem) && <Radio className="h-4 w-4" />}
              {h.subsystem.toUpperCase()}
              <Badge variant={h.status === 'ok' ? 'success' : 'destructive'} className="ml-auto">
                {h.status}
              </Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="text-sm space-y-1">
            {h.num_user != null && <p>Users: {h.num_user}</p>}
            {h.num_ap != null && <p>Access Points: {h.num_ap}</p>}
            {h.num_adopted != null && <p>Adopted: {h.num_adopted}</p>}
            {h.num_sw != null && <p>Switches: {h.num_sw}</p>}
            {h.num_gw != null && <p>Gateways: {h.num_gw}</p>}
          </CardContent>
        </Card>
      ))}
    </div>
  )
}

export default function UniFiPage() {
  const { data: devices = [], isError } = useQuery({
    queryKey: ['unifi', 'devices'],
    queryFn: getDevices,
    retry: false,
  })
  const { data: clients = [] } = useQuery({
    queryKey: ['unifi', 'clients'],
    queryFn: getClients,
    retry: false,
  })
  const { data: wlans = [] } = useQuery({
    queryKey: ['unifi', 'wlan'],
    queryFn: getWlanNetworks,
    retry: false,
  })
  const { data: health = [] } = useQuery({
    queryKey: ['unifi', 'health'],
    queryFn: getHealth,
    retry: false,
  })

  if (isError) {
    return (
      <div className="space-y-6">
        <h1 className="text-3xl font-bold">UniFi</h1>
        <Card>
          <CardContent className="p-12 text-center text-muted-foreground">
            <Wifi className="h-12 w-12 mx-auto mb-4 opacity-50" />
            <p>UniFi not configured. Go to Settings to add your UniFi controller credentials.</p>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold">UniFi</h1>

      <Tabs defaultValue="devices">
        <TabsList>
          <TabsTrigger value="devices"><Radio className="h-4 w-4 mr-2" />Devices ({devices.length})</TabsTrigger>
          <TabsTrigger value="clients"><Users className="h-4 w-4 mr-2" />Clients ({clients.length})</TabsTrigger>
          <TabsTrigger value="wlan"><Wifi className="h-4 w-4 mr-2" />WiFi Networks ({wlans.length})</TabsTrigger>
          <TabsTrigger value="health"><Activity className="h-4 w-4 mr-2" />Health</TabsTrigger>
        </TabsList>
        <TabsContent value="devices">
          <DevicesTab devices={devices as UniFiDevice[]} />
        </TabsContent>
        <TabsContent value="clients">
          <ClientsTab clients={clients as UniFiClientType[]} />
        </TabsContent>
        <TabsContent value="wlan">
          <WlanTab wlans={wlans as UniFiWlan[]} />
        </TabsContent>
        <TabsContent value="health">
          <HealthTab health={health as UniFiHealth[]} />
        </TabsContent>
      </Tabs>
    </div>
  )
}
