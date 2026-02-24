import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { getSettings, updateProxmoxSettings, updatePfSenseSettings } from '@/api/settings'
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Settings, Save } from 'lucide-react'

export default function SettingsPage() {
  const queryClient = useQueryClient()
  const { data: settings } = useQuery({ queryKey: ['settings'], queryFn: getSettings })

  const [proxmox, setProxmox] = useState({
    host: '', token_id: '', token_secret: '', verify_ssl: false,
  })
  const [pfsense, setPfsense] = useState({
    host: '', api_key: '', api_secret: '', verify_ssl: false,
  })

  const proxmoxMutation = useMutation({
    mutationFn: () => updateProxmoxSettings(proxmox),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['settings'] }),
  })

  const pfsenseMutation = useMutation({
    mutationFn: () => updatePfSenseSettings(pfsense),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['settings'] }),
  })

  return (
    <div className="space-y-6 max-w-2xl">
      <h1 className="text-3xl font-bold">Settings</h1>

      {/* Status */}
      {settings && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Integration Status</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <div className="flex justify-between items-center">
              <span>Proxmox</span>
              <Badge variant={settings.proxmox_configured ? 'success' : 'secondary'}>
                {settings.proxmox_configured ? 'Connected' : 'Not configured'}
              </Badge>
            </div>
            <div className="flex justify-between items-center">
              <span>pfSense</span>
              <Badge variant={settings.pfsense_configured ? 'success' : 'secondary'}>
                {settings.pfsense_configured ? 'Connected' : 'Not configured'}
              </Badge>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Proxmox Settings */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Proxmox Configuration</CardTitle>
          <CardDescription>Connect to your Proxmox VE instance using API tokens.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={(e) => { e.preventDefault(); proxmoxMutation.mutate() }} className="space-y-3">
            <div className="space-y-1">
              <label className="text-sm font-medium">Host (IP or hostname)</label>
              <Input placeholder="192.168.1.100" value={proxmox.host} onChange={(e) => setProxmox({ ...proxmox, host: e.target.value })} />
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium">API Token ID</label>
              <Input placeholder="user@pam!tokenname" value={proxmox.token_id} onChange={(e) => setProxmox({ ...proxmox, token_id: e.target.value })} />
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium">API Token Secret</label>
              <Input type="password" value={proxmox.token_secret} onChange={(e) => setProxmox({ ...proxmox, token_secret: e.target.value })} />
            </div>
            <Button type="submit" disabled={proxmoxMutation.isPending}>
              <Save className="h-4 w-4 mr-2" />Save
            </Button>
          </form>
        </CardContent>
      </Card>

      {/* pfSense Settings */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">pfSense Configuration</CardTitle>
          <CardDescription>Connect to your pfSense firewall using the REST API package.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={(e) => { e.preventDefault(); pfsenseMutation.mutate() }} className="space-y-3">
            <div className="space-y-1">
              <label className="text-sm font-medium">Host (IP or hostname)</label>
              <Input placeholder="192.168.1.1" value={pfsense.host} onChange={(e) => setPfsense({ ...pfsense, host: e.target.value })} />
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium">API Key</label>
              <Input value={pfsense.api_key} onChange={(e) => setPfsense({ ...pfsense, api_key: e.target.value })} />
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium">API Secret</label>
              <Input type="password" value={pfsense.api_secret} onChange={(e) => setPfsense({ ...pfsense, api_secret: e.target.value })} />
            </div>
            <Button type="submit" disabled={pfsenseMutation.isPending}>
              <Save className="h-4 w-4 mr-2" />Save
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
