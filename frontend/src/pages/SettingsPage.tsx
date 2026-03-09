import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { getSettings, updateProxmoxServers, updatePfSenseSettings, updateUniFiSettings, updateOllamaSettings, updateSwitchSettings } from '@/api/settings'
import { getOllamaModels } from '@/api/ollama'
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Save, Plus, Trash2 } from 'lucide-react'

type ProxmoxAuthMode = 'password' | 'token'
type PfSenseMode = 'snmp' | 'api'

interface ProxmoxServerForm {
  id: string
  host: string
  authMode: ProxmoxAuthMode
  username: string
  password: string
  token_id: string
  token_secret: string
  verify_ssl: boolean
}

function emptyServer(): ProxmoxServerForm {
  return { id: '', host: '', authMode: 'password', username: '', password: '', token_id: '', token_secret: '', verify_ssl: false }
}

export default function SettingsPage() {
  const queryClient = useQueryClient()
  const { data: settings } = useQuery({ queryKey: ['settings'], queryFn: getSettings })

  const [pxServers, setPxServers] = useState<ProxmoxServerForm[]>([emptyServer()])
  const [initialized, setInitialized] = useState(false)

  // Seed form from saved servers (once)
  useEffect(() => {
    if (settings && !initialized) {
      if (settings.proxmox_servers && settings.proxmox_servers.length > 0) {
        setPxServers(settings.proxmox_servers.map((s) => ({
          id: s.id,
          host: s.host,
          authMode: 'password' as ProxmoxAuthMode,
          username: '',
          password: '',
          token_id: '',
          token_secret: '',
          verify_ssl: false,
        })))
      }
      if (settings.pfsense_mode) {
        setPfsenseMode(settings.pfsense_mode === 'snmp' ? 'snmp' : 'api')
      }
      setInitialized(true)
    }
  }, [settings, initialized])

  const [pfsenseMode, setPfsenseMode] = useState<PfSenseMode>('snmp')
  const [pfsense, setPfsense] = useState({
    host: '', api_key: '', api_secret: '', verify_ssl: false,
    community: 'public', snmp_port: 161,
  })
  const [unifi, setUnifi] = useState({
    host: '', username: '', password: '', site: 'default', verify_ssl: false,
  })
  const [ollama, setOllama] = useState({ host: '', model: 'llama3' })
  const [switchCfg, setSwitchCfg] = useState({ host: '', community: 'public', port: 161 })

  const { data: ollamaModels } = useQuery({
    queryKey: ['ollama', 'models'],
    queryFn: () => getOllamaModels(),
    enabled: !!settings?.ollama_configured,
    retry: false,
  })

  const proxmoxMutation = useMutation({
    mutationFn: () => updateProxmoxServers(
      pxServers
        .filter((s) => s.id && s.host)
        .map((s) => ({
          id: s.id,
          host: s.host,
          username: s.authMode === 'password' ? s.username : '',
          password: s.authMode === 'password' ? s.password : '',
          token_id: s.authMode === 'token' ? s.token_id : '',
          token_secret: s.authMode === 'token' ? s.token_secret : '',
          verify_ssl: s.verify_ssl,
        }))
    ),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['settings'] }),
  })

  const pfsenseMutation = useMutation({
    mutationFn: () => updatePfSenseSettings({
      host: pfsense.host,
      mode: pfsenseMode,
      api_key: pfsenseMode === 'api' ? pfsense.api_key : '',
      api_secret: pfsenseMode === 'api' ? pfsense.api_secret : '',
      verify_ssl: pfsense.verify_ssl,
      community: pfsenseMode === 'snmp' ? pfsense.community : '',
      snmp_port: pfsense.snmp_port,
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['settings'] })
      queryClient.invalidateQueries({ queryKey: ['pfsense'] })
    },
  })

  const unifiMutation = useMutation({
    mutationFn: () => updateUniFiSettings(unifi),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['settings'] }),
  })

  const ollamaMutation = useMutation({
    mutationFn: () => updateOllamaSettings(ollama),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['settings'] })
      queryClient.invalidateQueries({ queryKey: ['ollama'] })
    },
  })

  const switchMutation = useMutation({
    mutationFn: () => updateSwitchSettings(switchCfg),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['settings'] })
      queryClient.invalidateQueries({ queryKey: ['switch'] })
    },
  })

  const updateServer = (index: number, patch: Partial<ProxmoxServerForm>) => {
    setPxServers((prev) => prev.map((s, i) => i === index ? { ...s, ...patch } : s))
  }

  const removeServer = (index: number) => {
    setPxServers((prev) => prev.filter((_, i) => i !== index))
  }

  return (
    <div className="space-y-6 max-w-2xl">
      <h1 className="text-3xl font-bold">Settings</h1>

      {settings && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Integration Status</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <div className="flex justify-between items-center">
              <span>Proxmox</span>
              <Badge variant={settings.proxmox_configured ? 'success' : 'secondary'}>
                {settings.proxmox_configured
                  ? `${settings.proxmox_servers.length} server${settings.proxmox_servers.length !== 1 ? 's' : ''} connected`
                  : 'Not configured'}
              </Badge>
            </div>
            <div className="flex justify-between items-center">
              <span>pfSense</span>
              <div className="flex gap-2 items-center">
                {settings.pfsense_mode && (
                  <Badge variant="outline">{settings.pfsense_mode.toUpperCase()}</Badge>
                )}
                <Badge variant={settings.pfsense_configured ? 'success' : 'secondary'}>
                  {settings.pfsense_configured ? 'Connected' : 'Not configured'}
                </Badge>
              </div>
            </div>
            <div className="flex justify-between items-center">
              <span>UniFi</span>
              <Badge variant={settings.unifi_configured ? 'success' : 'secondary'}>
                {settings.unifi_configured ? 'Connected' : 'Not configured'}
              </Badge>
            </div>
            <div className="flex justify-between items-center">
              <span>Switch</span>
              <Badge variant={settings.switch_configured ? 'success' : 'secondary'}>
                {settings.switch_configured ? 'Connected' : 'Not configured'}
              </Badge>
            </div>
            <div className="flex justify-between items-center">
              <span>Ollama AI</span>
              <div className="flex gap-2 items-center">
                {settings.ollama_configured && (
                  <Badge variant="outline">{settings.ollama_model}</Badge>
                )}
                <Badge variant={settings.ollama_configured ? 'success' : 'secondary'}>
                  {settings.ollama_configured ? 'Connected' : 'Not configured'}
                </Badge>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Proxmox Settings — Multi-Server */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Proxmox Servers</CardTitle>
          <CardDescription>Add one or more Proxmox servers. Each needs a unique name and host.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={(e) => { e.preventDefault(); proxmoxMutation.mutate() }} className="space-y-6">
            {pxServers.map((srv, idx) => (
              <div key={idx} className="space-y-3 rounded-md border p-4">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-semibold">Server {idx + 1}</span>
                  {pxServers.length > 1 && (
                    <Button type="button" variant="ghost" size="sm" onClick={() => removeServer(idx)}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <label className="text-sm font-medium">Name / ID</label>
                    <Input placeholder="PVE1" value={srv.id} onChange={(e) => updateServer(idx, { id: e.target.value })} />
                  </div>
                  <div className="space-y-1">
                    <label className="text-sm font-medium">Host (IP or hostname)</label>
                    <Input placeholder="192.168.1.100" value={srv.host} onChange={(e) => updateServer(idx, { host: e.target.value })} />
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant={srv.authMode === 'password' ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => updateServer(idx, { authMode: 'password' })}
                  >
                    Username & Password
                  </Button>
                  <Button
                    type="button"
                    variant={srv.authMode === 'token' ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => updateServer(idx, { authMode: 'token' })}
                  >
                    API Token
                  </Button>
                </div>
                {srv.authMode === 'password' ? (
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <label className="text-sm font-medium">Username</label>
                      <Input placeholder="root@pam" value={srv.username} onChange={(e) => updateServer(idx, { username: e.target.value })} />
                    </div>
                    <div className="space-y-1">
                      <label className="text-sm font-medium">Password</label>
                      <Input type="password" value={srv.password} onChange={(e) => updateServer(idx, { password: e.target.value })} />
                    </div>
                  </div>
                ) : (
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <label className="text-sm font-medium">API Token ID</label>
                      <Input placeholder="user@pam!tokenname" value={srv.token_id} onChange={(e) => updateServer(idx, { token_id: e.target.value })} />
                    </div>
                    <div className="space-y-1">
                      <label className="text-sm font-medium">API Token Secret</label>
                      <Input type="password" value={srv.token_secret} onChange={(e) => updateServer(idx, { token_secret: e.target.value })} />
                    </div>
                  </div>
                )}
              </div>
            ))}
            <div className="flex gap-2">
              <Button type="button" variant="outline" onClick={() => setPxServers([...pxServers, emptyServer()])}>
                <Plus className="h-4 w-4 mr-2" />Add Server
              </Button>
              <Button type="submit" disabled={proxmoxMutation.isPending}>
                <Save className="h-4 w-4 mr-2" />Save All
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      {/* pfSense Settings */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">pfSense Configuration</CardTitle>
          <CardDescription>Connect to your pfSense firewall via SNMP or the REST API package.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Mode Toggle */}
          <div className="flex gap-2">
            <Button
              type="button"
              variant={pfsenseMode === 'snmp' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setPfsenseMode('snmp')}
            >
              SNMP
            </Button>
            <Button
              type="button"
              variant={pfsenseMode === 'api' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setPfsenseMode('api')}
            >
              API Token
            </Button>
          </div>

          {/* Setup Instructions */}
          {pfsenseMode === 'snmp' ? (
            <div className="rounded-md bg-muted p-4 text-sm space-y-2">
              <p className="font-medium">SNMP Setup Instructions</p>
              <ol className="list-decimal list-inside space-y-1 text-muted-foreground">
                <li>Log into your pfSense web UI</li>
                <li>Go to <span className="font-mono text-xs">Services &gt; SNMP</span></li>
                <li>Check <span className="font-semibold text-foreground">Enable SNMP Daemon</span></li>
                <li>Set the <span className="font-semibold text-foreground">Community String</span> (default: public)</li>
                <li>Optionally restrict to a specific bind interface</li>
                <li>Click <span className="font-semibold text-foreground">Save</span></li>
              </ol>
              <p className="text-xs text-muted-foreground mt-2">
                SNMP provides system info, interface stats, ARP table, and routing data.
                For firewall rules, DHCP leases, and VPN status, use API mode instead.
              </p>
            </div>
          ) : (
            <div className="rounded-md bg-muted p-4 text-sm space-y-2">
              <p className="font-medium">API Setup Instructions</p>
              <ol className="list-decimal list-inside space-y-1 text-muted-foreground">
                <li>Log into your pfSense web UI</li>
                <li>Go to <span className="font-mono text-xs">System &gt; Package Manager &gt; Available Packages</span></li>
                <li>Search for and install <span className="font-semibold text-foreground">pfSense-pkg-API</span></li>
                <li>After install, go to <span className="font-mono text-xs">System &gt; REST API &gt; Settings</span></li>
                <li>Set Authentication Mode to <span className="font-semibold text-foreground">API Token</span></li>
                <li>Go to <span className="font-mono text-xs">System &gt; REST API &gt; Keys</span> and click <span className="font-semibold text-foreground">+ Add</span></li>
                <li>Copy the generated <span className="font-semibold text-foreground">Client ID</span> into API Key and <span className="font-semibold text-foreground">Client Token</span> into API Secret below</li>
              </ol>
              <p className="text-xs text-muted-foreground mt-2">
                If your plugin only generates a single key, just paste it as the API Key and leave the secret blank.
              </p>
            </div>
          )}

          <form onSubmit={(e) => { e.preventDefault(); pfsenseMutation.mutate() }} className="space-y-3">
            <div className="space-y-1">
              <label className="text-sm font-medium">Host (IP or hostname)</label>
              <Input placeholder="192.168.1.1" value={pfsense.host} onChange={(e) => setPfsense({ ...pfsense, host: e.target.value })} />
            </div>

            {pfsenseMode === 'snmp' ? (
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-sm font-medium">Community String</label>
                  <Input placeholder="public" value={pfsense.community} onChange={(e) => setPfsense({ ...pfsense, community: e.target.value })} />
                </div>
                <div className="space-y-1">
                  <label className="text-sm font-medium">SNMP Port</label>
                  <Input type="number" placeholder="161" value={pfsense.snmp_port} onChange={(e) => setPfsense({ ...pfsense, snmp_port: parseInt(e.target.value) || 161 })} />
                </div>
              </div>
            ) : (
              <>
                <div className="space-y-1">
                  <label className="text-sm font-medium">API Key</label>
                  <Input placeholder="Paste your API key here" value={pfsense.api_key} onChange={(e) => setPfsense({ ...pfsense, api_key: e.target.value })} />
                </div>
                <div className="space-y-1">
                  <label className="text-sm font-medium">API Secret <span className="text-muted-foreground font-normal">(optional)</span></label>
                  <Input type="password" placeholder="Client token (leave blank if not provided)" value={pfsense.api_secret} onChange={(e) => setPfsense({ ...pfsense, api_secret: e.target.value })} />
                </div>
              </>
            )}

            <Button type="submit" disabled={pfsenseMutation.isPending}>
              <Save className="h-4 w-4 mr-2" />Save
            </Button>
          </form>
        </CardContent>
      </Card>

      {/* UniFi Settings */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">UniFi Configuration</CardTitle>
          <CardDescription>Connect to your UniFi Network Application controller.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={(e) => { e.preventDefault(); unifiMutation.mutate() }} className="space-y-3">
            <div className="space-y-1">
              <label className="text-sm font-medium">Host (IP or hostname)</label>
              <Input placeholder="192.168.1.10" value={unifi.host} onChange={(e) => setUnifi({ ...unifi, host: e.target.value })} />
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium">Username</label>
              <Input placeholder="admin" value={unifi.username} onChange={(e) => setUnifi({ ...unifi, username: e.target.value })} />
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium">Password</label>
              <Input type="password" value={unifi.password} onChange={(e) => setUnifi({ ...unifi, password: e.target.value })} />
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium">Site</label>
              <Input placeholder="default" value={unifi.site} onChange={(e) => setUnifi({ ...unifi, site: e.target.value })} />
            </div>
            <Button type="submit" disabled={unifiMutation.isPending}>
              <Save className="h-4 w-4 mr-2" />Save
            </Button>
          </form>
        </CardContent>
      </Card>

      {/* Ollama AI Settings */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Ollama AI Server</CardTitle>
          <CardDescription>Connect to your local Ollama instance for AI-enhanced security analysis.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={(e) => { e.preventDefault(); ollamaMutation.mutate() }} className="space-y-3">
            <div className="space-y-1">
              <label className="text-sm font-medium">Host URL</label>
              <Input placeholder="http://192.168.1.50:11434" value={ollama.host} onChange={(e) => setOllama({ ...ollama, host: e.target.value })} />
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium">Model</label>
              {ollamaModels && ollamaModels.models.length > 0 ? (
                <select
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background"
                  value={ollama.model}
                  onChange={(e) => setOllama({ ...ollama, model: e.target.value })}
                >
                  {ollamaModels.models.map((m) => (
                    <option key={m.name} value={m.name}>{m.name}</option>
                  ))}
                </select>
              ) : (
                <Input placeholder="llama3" value={ollama.model} onChange={(e) => setOllama({ ...ollama, model: e.target.value })} />
              )}
            </div>
            <Button type="submit" disabled={ollamaMutation.isPending}>
              <Save className="h-4 w-4 mr-2" />Save
            </Button>
          </form>
        </CardContent>
      </Card>

      {/* Switch Settings */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Network Switch (SNMP)</CardTitle>
          <CardDescription>Connect to your Cisco SF300/SG300 or other SNMP-capable managed switch.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={(e) => { e.preventDefault(); switchMutation.mutate() }} className="space-y-3">
            <div className="space-y-1">
              <label className="text-sm font-medium">Host (IP address)</label>
              <Input placeholder="192.168.1.20" value={switchCfg.host} onChange={(e) => setSwitchCfg({ ...switchCfg, host: e.target.value })} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-sm font-medium">Community String</label>
                <Input placeholder="public" value={switchCfg.community} onChange={(e) => setSwitchCfg({ ...switchCfg, community: e.target.value })} />
              </div>
              <div className="space-y-1">
                <label className="text-sm font-medium">SNMP Port</label>
                <Input type="number" placeholder="161" value={switchCfg.port} onChange={(e) => setSwitchCfg({ ...switchCfg, port: parseInt(e.target.value) || 161 })} />
              </div>
            </div>
            <Button type="submit" disabled={switchMutation.isPending}>
              <Save className="h-4 w-4 mr-2" />Save
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
