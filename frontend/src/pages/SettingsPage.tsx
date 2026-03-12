import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { getSettings, updateProxmoxServers, updatePfSenseSettings, updateUniFiSettings, updateOllamaSettings, updateSwitchSettings } from '@/api/settings'
import { getOllamaModels } from '@/api/ollama'
import { testConnection as testPfSense } from '@/api/pfsense'
import { testSwitchConnection } from '@/api/switch'
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Save, Plus, Trash2, Zap } from 'lucide-react'

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
      if (settings.switch_host) {
        setSwitchCfg(prev => ({
          ...prev,
          host: settings.switch_host,
          mode: (settings.switch_mode === 'snmp' ? 'snmp' : 'ssh') as 'ssh' | 'snmp',
        }))
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
  const [switchCfg, setSwitchCfg] = useState({
    host: '', mode: 'ssh' as 'ssh' | 'snmp',
    username: '', password: '', ssh_port: 22, enable_password: '',
    community: 'public', snmp_port: 161,
  })

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

  const pfTestMutation = useMutation({ mutationFn: testPfSense })
  const switchTestMutation = useMutation({
    mutationFn: async () => {
      // Auto-save before testing so the backend has the latest config
      await updateSwitchSettings(switchCfg)
      queryClient.invalidateQueries({ queryKey: ['settings'] })
      return testSwitchConnection()
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
              <p className="font-medium">pfSense REST API Setup (pfrest)</p>
              <ol className="list-decimal list-inside space-y-1 text-muted-foreground">
                <li>SSH into your pfSense box or use <span className="font-mono text-xs">Diagnostics &gt; Command Prompt</span></li>
                <li>Install the REST API package:
                  <pre className="bg-background rounded p-2 mt-1 mb-1 text-xs overflow-x-auto select-all">pkg-static add https://github.com/pfrest/pfSense-pkg-RESTAPI/releases/latest/download/pfSense-2.8.1-pkg-RESTAPI.pkg</pre>
                </li>
                <li>In the pfSense web UI, go to <span className="font-mono text-xs">System &gt; REST API &gt; Settings</span></li>
                <li>Ensure <span className="font-semibold text-foreground">Authentication Mode</span> includes <span className="font-semibold text-foreground">API Key</span></li>
                <li>Go to <span className="font-mono text-xs">System &gt; REST API &gt; Keys</span>, click <span className="font-semibold text-foreground">+ Add</span></li>
                <li>Copy the generated key and paste it below as <span className="font-semibold text-foreground">API Key</span></li>
              </ol>
              <p className="text-xs text-muted-foreground mt-2">
                Uses <span className="font-mono">X-API-Key</span> header auth via <a href="https://pfrest.org" target="_blank" rel="noreferrer" className="underline">pfrest.org</a>.
                Swagger docs available at <span className="font-mono">System &gt; REST API &gt; Documentation</span> on your pfSense.
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
              <div className="space-y-1">
                  <label className="text-sm font-medium">API Key</label>
                  <Input placeholder="Paste your API key from System > REST API > Keys" value={pfsense.api_key} onChange={(e) => setPfsense({ ...pfsense, api_key: e.target.value })} />
                </div>
            )}

            <div className="flex gap-2">
              <Button type="submit" disabled={pfsenseMutation.isPending}>
                <Save className="h-4 w-4 mr-2" />Save
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={pfTestMutation.isPending}
                onClick={() => pfTestMutation.mutate()}
              >
                <Zap className="h-4 w-4 mr-2" />{pfTestMutation.isPending ? 'Testing...' : 'Test Connection'}
              </Button>
            </div>
            {pfTestMutation.data && (() => {
              const r = pfTestMutation.data as Record<string, string | number | boolean>
              return (
                <div className="rounded-md border p-4 space-y-2 mt-2">
                  <div className="flex items-center gap-2">
                    <Badge variant={r.ok ? 'success' : 'destructive'}>
                      {r.ok ? 'Connected' : 'Failed'}
                    </Badge>
                    {r.status_code && <span className="text-xs text-muted-foreground">HTTP {String(r.status_code)}</span>}
                  </div>
                  {r.url && <p className="text-xs font-mono text-muted-foreground">{String(r.url)}</p>}
                  {r.error && <p className="text-sm text-destructive">{String(r.error)}</p>}
                  {r.response_body && (
                    <pre className="p-2 bg-muted rounded text-xs overflow-x-auto max-h-40 whitespace-pre-wrap">{String(r.response_body)}</pre>
                  )}
                </div>
              )
            })()}
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
          <CardTitle className="text-base">Network Switch</CardTitle>
          <CardDescription>Connect to your Cisco SG300/SF300 or other managed switch via SSH or SNMP.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={(e) => { e.preventDefault(); switchMutation.mutate() }} className="space-y-3">
            <div className="space-y-1">
              <label className="text-sm font-medium">Host (IP address)</label>
              <Input placeholder="192.168.1.20" value={switchCfg.host} onChange={(e) => setSwitchCfg({ ...switchCfg, host: e.target.value })} />
            </div>

            <div className="space-y-1">
              <label className="text-sm font-medium">Connection Mode</label>
              <div className="flex gap-2">
                <Button type="button" size="sm" variant={switchCfg.mode === 'ssh' ? 'default' : 'outline'} onClick={() => setSwitchCfg({ ...switchCfg, mode: 'ssh' })}>SSH (recommended)</Button>
                <Button type="button" size="sm" variant={switchCfg.mode === 'snmp' ? 'default' : 'outline'} onClick={() => setSwitchCfg({ ...switchCfg, mode: 'snmp' })}>SNMP</Button>
              </div>
            </div>

            {switchCfg.mode === 'ssh' ? (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <label className="text-sm font-medium">Username</label>
                    <Input placeholder="admin" value={switchCfg.username} onChange={(e) => setSwitchCfg({ ...switchCfg, username: e.target.value })} />
                  </div>
                  <div className="space-y-1">
                    <label className="text-sm font-medium">Password</label>
                    <Input type="password" placeholder="password" value={switchCfg.password} onChange={(e) => setSwitchCfg({ ...switchCfg, password: e.target.value })} />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <label className="text-sm font-medium">SSH Port</label>
                    <Input type="number" placeholder="22" value={switchCfg.ssh_port} onChange={(e) => setSwitchCfg({ ...switchCfg, ssh_port: parseInt(e.target.value) || 22 })} />
                  </div>
                  <div className="space-y-1">
                    <label className="text-sm font-medium">Enable Password (optional)</label>
                    <Input type="password" placeholder="enable password" value={switchCfg.enable_password} onChange={(e) => setSwitchCfg({ ...switchCfg, enable_password: e.target.value })} />
                  </div>
                </div>
              </>
            ) : (
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-sm font-medium">Community String</label>
                  <Input placeholder="public" value={switchCfg.community} onChange={(e) => setSwitchCfg({ ...switchCfg, community: e.target.value })} />
                </div>
                <div className="space-y-1">
                  <label className="text-sm font-medium">SNMP Port</label>
                  <Input type="number" placeholder="161" value={switchCfg.snmp_port} onChange={(e) => setSwitchCfg({ ...switchCfg, snmp_port: parseInt(e.target.value) || 161 })} />
                </div>
              </div>
            )}

            <div className="flex gap-2">
              <Button type="submit" disabled={switchMutation.isPending}>
                <Save className="h-4 w-4 mr-2" />Save
              </Button>
              <Button type="button" variant="outline" disabled={switchTestMutation.isPending} onClick={() => switchTestMutation.mutate()}>
                <Zap className="h-4 w-4 mr-2" />Test Connection
              </Button>
            </div>
          </form>
          {switchTestMutation.data && (
            <div className="mt-3 p-3 rounded-md border space-y-1">
              <div className="flex items-center gap-2">
                <Badge variant={switchTestMutation.data.ok ? 'success' : 'destructive'}>
                  {switchTestMutation.data.ok ? 'Connected' : 'Failed'}
                </Badge>
                {switchTestMutation.data.host && <span className="text-xs font-mono">{switchTestMutation.data.host}</span>}
                {switchTestMutation.data.mode && <span className="text-xs text-muted-foreground">({String(switchTestMutation.data.mode)})</span>}
              </div>
              {switchTestMutation.data.ok && switchTestMutation.data.system && (
                <p className="text-xs text-muted-foreground">
                  {switchTestMutation.data.system.hostname || 'Unknown'} — {switchTestMutation.data.system.description || ''}
                </p>
              )}
              {switchTestMutation.data.ok && switchTestMutation.data.output && (
                <pre className="text-xs p-2 bg-muted rounded mt-1 overflow-auto max-h-40 whitespace-pre-wrap">{String(switchTestMutation.data.output)}</pre>
              )}
              {switchTestMutation.data.error && (
                <p className="text-sm text-destructive">{switchTestMutation.data.error}</p>
              )}
            </div>
          )}
          {switchTestMutation.error && (
            <div className="mt-3 p-3 rounded-md border">
              <Badge variant="destructive">Error</Badge>
              <p className="text-sm text-destructive mt-1">{switchTestMutation.error instanceof Error ? switchTestMutation.error.message : 'Request failed'}</p>
            </div>
          )}
          <div className="mt-4 p-3 rounded-md bg-muted/50 text-xs text-muted-foreground space-y-1">
            <p className="font-medium">Setup Instructions (SSH — recommended):</p>
            <p>1. Enable SSH on your switch: Management &gt; Security &gt; SSH Server</p>
            <p>2. Use the same credentials you use for the web UI</p>
            <p>3. If your switch has an enable password, enter it in the optional field</p>
            <p className="font-medium mt-2">Setup Instructions (SNMP — legacy):</p>
            <p>1. Enable SNMP v2c on the switch: Management &gt; SNMP &gt; Communities</p>
            <p>2. Set a community string (default is &quot;public&quot; for read-only)</p>
            <p>3. Ensure the LXC/server IP is allowed to query SNMP</p>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
