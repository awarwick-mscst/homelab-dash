import { useQuery } from '@tanstack/react-query'
import { getInterfaces, getFirewallRules, getDhcpLeases, getVpnStatus } from '@/api/pfsense'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { Badge } from '@/components/ui/badge'
import { Flame, Network, Shield, Wifi, Globe } from 'lucide-react'

function DataTable({ data, emptyMsg }: { data: unknown; emptyMsg: string }) {
  if (!data || (Array.isArray(data) && data.length === 0)) {
    return <p className="text-muted-foreground p-4">{emptyMsg}</p>
  }

  const items = Array.isArray(data) ? data : typeof data === 'object' ? Object.values(data as Record<string, unknown>) : []

  if (items.length === 0) {
    return <pre className="p-4 text-xs overflow-auto">{JSON.stringify(data, null, 2)}</pre>
  }

  const keys = Object.keys(items[0] as Record<string, unknown>).slice(0, 8)

  return (
    <div className="rounded-md border overflow-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b bg-muted/50">
            {keys.map((k) => (
              <th key={k} className="p-3 text-left font-medium whitespace-nowrap">{k}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {items.map((item, i) => (
            <tr key={i} className="border-b hover:bg-muted/30">
              {keys.map((k) => (
                <td key={k} className="p-3 text-xs whitespace-nowrap">
                  {String((item as Record<string, unknown>)[k] ?? '-')}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export default function PfSensePage() {
  const { data: interfaces, isError } = useQuery({
    queryKey: ['pfsense', 'interfaces'],
    queryFn: getInterfaces,
    retry: false,
  })
  const { data: rules } = useQuery({
    queryKey: ['pfsense', 'rules'],
    queryFn: getFirewallRules,
    retry: false,
  })
  const { data: leases } = useQuery({
    queryKey: ['pfsense', 'leases'],
    queryFn: getDhcpLeases,
    retry: false,
  })
  const { data: vpn } = useQuery({
    queryKey: ['pfsense', 'vpn'],
    queryFn: getVpnStatus,
    retry: false,
  })

  if (isError) {
    return (
      <div className="space-y-6">
        <h1 className="text-3xl font-bold">pfSense</h1>
        <Card>
          <CardContent className="p-12 text-center text-muted-foreground">
            <Flame className="h-12 w-12 mx-auto mb-4 opacity-50" />
            <p>pfSense not configured. Go to Settings to add your pfSense API credentials.</p>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold">pfSense</h1>

      <Tabs defaultValue="interfaces">
        <TabsList>
          <TabsTrigger value="interfaces"><Network className="h-4 w-4 mr-2" />Interfaces</TabsTrigger>
          <TabsTrigger value="rules"><Shield className="h-4 w-4 mr-2" />Firewall Rules</TabsTrigger>
          <TabsTrigger value="leases"><Wifi className="h-4 w-4 mr-2" />DHCP Leases</TabsTrigger>
          <TabsTrigger value="vpn"><Globe className="h-4 w-4 mr-2" />VPN</TabsTrigger>
        </TabsList>
        <TabsContent value="interfaces">
          <DataTable data={interfaces} emptyMsg="No interface data available." />
        </TabsContent>
        <TabsContent value="rules">
          <DataTable data={rules} emptyMsg="No firewall rules data available." />
        </TabsContent>
        <TabsContent value="leases">
          <DataTable data={leases} emptyMsg="No DHCP leases data available." />
        </TabsContent>
        <TabsContent value="vpn">
          <DataTable data={vpn} emptyMsg="No VPN data available." />
        </TabsContent>
      </Tabs>
    </div>
  )
}
