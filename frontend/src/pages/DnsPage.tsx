import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  getDomains, addDomain, deleteDomain, updateDomain,
  triggerCheck, getLatestSnapshot, getDomainChanges,
} from '@/api/dns'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import {
  Plus, Trash2, RefreshCw, Globe, Loader2, Play, Pause,
} from 'lucide-react'
import type { DnsMonitoredDomain, DnsChange } from '@/types'

const RECORD_TYPE_COLORS: Record<string, string> = {
  A: 'bg-blue-500/15 text-blue-400',
  AAAA: 'bg-indigo-500/15 text-indigo-400',
  CNAME: 'bg-purple-500/15 text-purple-400',
  MX: 'bg-amber-500/15 text-amber-400',
  NS: 'bg-green-500/15 text-green-400',
  TXT: 'bg-gray-500/15 text-gray-400',
  SOA: 'bg-red-500/15 text-red-400',
  SRV: 'bg-cyan-500/15 text-cyan-400',
}

function RecordBadge({ type }: { type: string }) {
  return (
    <span className={`inline-block rounded px-2 py-0.5 text-xs font-mono font-semibold ${RECORD_TYPE_COLORS[type] || 'bg-muted text-muted-foreground'}`}>
      {type}
    </span>
  )
}

function formatValue(val: unknown): string {
  if (typeof val === 'string') return val
  if (typeof val === 'object' && val !== null) {
    const obj = val as Record<string, unknown>
    if ('priority' in obj && 'exchange' in obj) return `${obj.priority} ${obj.exchange}`
    if ('priority' in obj && 'port' in obj && 'target' in obj) return `${obj.priority} ${obj.weight} ${obj.port} ${obj.target}`
    if ('mname' in obj && 'serial' in obj) return `${obj.mname} ${obj.rname} (serial: ${obj.serial})`
    return JSON.stringify(obj)
  }
  return String(val)
}

function formatChangeValue(jsonStr: string): string {
  try {
    const parsed = JSON.parse(jsonStr)
    if (Array.isArray(parsed)) {
      return parsed.map((v) => formatValue(v)).join(', ')
    }
    return formatValue(parsed)
  } catch {
    return jsonStr
  }
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

function ChangeBadge({ type }: { type: string }) {
  const colors = {
    added: 'bg-green-500/15 text-green-400',
    removed: 'bg-red-500/15 text-red-400',
    modified: 'bg-yellow-500/15 text-yellow-400',
  }
  return (
    <span className={`inline-block rounded px-2 py-0.5 text-xs font-semibold ${colors[type as keyof typeof colors] || 'bg-muted'}`}>
      {type}
    </span>
  )
}

export default function DnsPage() {
  const queryClient = useQueryClient()
  const [addOpen, setAddOpen] = useState(false)
  const [newDomain, setNewDomain] = useState('')
  const [newSubdomains, setNewSubdomains] = useState('')
  const [selectedDomainId, setSelectedDomainId] = useState<number | null>(null)
  const [editSubsId, setEditSubsId] = useState<number | null>(null)
  const [editSubsValue, setEditSubsValue] = useState('')

  const { data: domains = [] } = useQuery({
    queryKey: ['dns', 'domains'],
    queryFn: getDomains,
  })

  const activeDomainId = selectedDomainId ?? (domains.length > 0 ? domains[0].id : null)

  const { data: snapshot, isLoading: snapshotLoading } = useQuery({
    queryKey: ['dns', 'snapshot', activeDomainId],
    queryFn: () => activeDomainId ? getLatestSnapshot(activeDomainId) : null,
    enabled: !!activeDomainId,
    refetchInterval: 30000,
  })

  const { data: changes = [] } = useQuery({
    queryKey: ['dns', 'changes', activeDomainId],
    queryFn: () => activeDomainId ? getDomainChanges(activeDomainId) : [],
    enabled: !!activeDomainId,
    refetchInterval: 30000,
  })

  const addMutation = useMutation({
    mutationFn: () => {
      const subs = newSubdomains.split(',').map(s => s.trim()).filter(Boolean)
      return addDomain(newDomain.trim(), subs.length > 0 ? subs : undefined)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['dns'] })
      setAddOpen(false)
      setNewDomain('')
      setNewSubdomains('')
    },
  })

  const deleteMutation = useMutation({
    mutationFn: deleteDomain,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['dns'] }),
  })

  const toggleMutation = useMutation({
    mutationFn: ({ id, is_active }: { id: number; is_active: boolean }) => updateDomain(id, { is_active }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['dns'] }),
  })

  const updateSubsMutation = useMutation({
    mutationFn: ({ id, subdomains }: { id: number; subdomains: string[] }) => updateDomain(id, { subdomains }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['dns'] })
      setEditSubsId(null)
    },
  })

  const checkMutation = useMutation({
    mutationFn: triggerCheck,
    onSuccess: () => {
      setTimeout(() => queryClient.invalidateQueries({ queryKey: ['dns'] }), 3000)
    },
  })

  // Records may be nested {host: {type: [values]}} or flat {type: [values]} from old snapshots
  const rawRecords = snapshot?.records || {}
  const records: Record<string, Record<string, unknown[]>> = {}
  const rootDomain = domains.find((d: DnsMonitoredDomain) => d.id === activeDomainId)?.domain || ''

  // Detect format: if any value is an array, it's the old flat format
  const isFlat = Object.values(rawRecords).some((v) => Array.isArray(v))
  if (isFlat) {
    records[rootDomain] = rawRecords as unknown as Record<string, unknown[]>
  } else {
    Object.assign(records, rawRecords)
  }

  const hosts = Object.keys(records).sort((a, b) => {
    if (a === rootDomain) return -1
    if (b === rootDomain) return 1
    return a.localeCompare(b)
  })

  const activeDomain = domains.find((d: DnsMonitoredDomain) => d.id === activeDomainId)

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold">DNS Monitor</h1>
        <Dialog open={addOpen} onOpenChange={setAddOpen}>
          <DialogTrigger asChild>
            <Button><Plus className="h-4 w-4 mr-2" />Add Domain</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Add Domain to Monitor</DialogTitle></DialogHeader>
            <form onSubmit={(e) => { e.preventDefault(); addMutation.mutate() }} className="space-y-3">
              <div>
                <label className="text-sm font-medium">Domain</label>
                <Input
                  placeholder="machome.us"
                  value={newDomain}
                  onChange={(e) => setNewDomain(e.target.value)}
                  required
                />
              </div>
              <div>
                <label className="text-sm font-medium">Subdomains</label>
                <Input
                  placeholder="www, mail, home, ai (comma separated)"
                  value={newSubdomains}
                  onChange={(e) => setNewSubdomains(e.target.value)}
                />
                <p className="text-xs text-muted-foreground mt-1">CNAME records only exist on subdomains, not the root domain.</p>
              </div>
              <Button type="submit" className="w-full" disabled={addMutation.isPending}>
                {addMutation.isPending ? 'Adding...' : 'Add & Check'}
              </Button>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {domains.length === 0 ? (
        <Card>
          <CardContent className="p-12 text-center text-muted-foreground">
            <Globe className="h-12 w-12 mx-auto mb-4 opacity-50" />
            <p>No domains monitored yet. Add a domain to start tracking DNS records.</p>
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="flex gap-2 items-center flex-wrap">
            {domains.map((d: DnsMonitoredDomain) => (
              <Button
                key={d.id}
                variant={d.id === activeDomainId ? 'default' : 'outline'}
                size="sm"
                onClick={() => setSelectedDomainId(d.id)}
              >
                <Globe className="h-3 w-3 mr-1.5" />
                {d.domain}
                {!d.is_active && <span className="ml-1 text-muted-foreground">(paused)</span>}
              </Button>
            ))}
          </div>

          <Tabs defaultValue="records">
            <TabsList>
              <TabsTrigger value="records">Current Records</TabsTrigger>
              <TabsTrigger value="changes">Change History ({changes.length})</TabsTrigger>
              <TabsTrigger value="manage">Manage Domains</TabsTrigger>
            </TabsList>

            {/* Current Records */}
            <TabsContent value="records" className="space-y-4">
              <div className="flex items-center justify-between">
                <div className="text-sm text-muted-foreground">
                  {activeDomain?.domain}
                  {activeDomain?.subdomains && activeDomain.subdomains.length > 0 && (
                    <span className="ml-1">+ {activeDomain.subdomains.length} subdomains</span>
                  )}
                  {snapshot && <span className="ml-2">| Last checked: {timeAgo(snapshot.created_at)}</span>}
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => activeDomainId && checkMutation.mutate(activeDomainId)}
                  disabled={checkMutation.isPending}
                >
                  {checkMutation.isPending ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <RefreshCw className="h-4 w-4 mr-2" />
                  )}
                  Refresh Now
                </Button>
              </div>

              {snapshotLoading ? (
                <Card>
                  <CardContent className="p-8 text-center">
                    <Loader2 className="h-8 w-8 mx-auto mb-2 animate-spin opacity-50" />
                    <p className="text-muted-foreground">Loading DNS records...</p>
                  </CardContent>
                </Card>
              ) : snapshot?.error_message ? (
                <Card>
                  <CardContent className="p-4 text-red-500 text-sm">
                    Error: {snapshot.error_message}
                  </CardContent>
                </Card>
              ) : hosts.length === 0 ? (
                <Card>
                  <CardContent className="p-8 text-center text-muted-foreground">
                    No DNS records found. Click "Refresh Now" to run a check.
                  </CardContent>
                </Card>
              ) : (
                <div className="space-y-6">
                  {hosts.map((host) => {
                    const hostRecords = records[host]
                    const recordTypes = Object.keys(hostRecords).sort()
                    return (
                      <div key={host}>
                        <h3 className="text-lg font-semibold font-mono mb-3 flex items-center gap-2">
                          <Globe className="h-4 w-4 text-muted-foreground" />
                          {host}
                        </h3>
                        <div className="rounded-md border">
                          <table className="w-full text-sm">
                            <thead>
                              <tr className="border-b bg-muted/50">
                                <th className="p-3 text-left font-medium w-24">Type</th>
                                <th className="p-3 text-left font-medium">Value</th>
                              </tr>
                            </thead>
                            <tbody>
                              {recordTypes.map((rtype) => (
                                (hostRecords[rtype] as unknown[]).map((val, i) => (
                                  <tr key={`${rtype}-${i}`} className="border-b hover:bg-muted/30">
                                    {i === 0 ? (
                                      <td className="p-3" rowSpan={(hostRecords[rtype] as unknown[]).length}>
                                        <RecordBadge type={rtype} />
                                      </td>
                                    ) : null}
                                    <td className="p-3 font-mono text-sm break-all">{formatValue(val)}</td>
                                  </tr>
                                ))
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </TabsContent>

            {/* Change History */}
            <TabsContent value="changes" className="space-y-3">
              {changes.length === 0 ? (
                <Card>
                  <CardContent className="p-8 text-center text-muted-foreground">
                    No changes detected yet. Changes will appear here when DNS records are added, removed, or modified.
                  </CardContent>
                </Card>
              ) : (
                <div className="rounded-md border">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b bg-muted/50">
                        <th className="p-3 text-left font-medium">Time</th>
                        <th className="p-3 text-left font-medium">Host</th>
                        <th className="p-3 text-left font-medium">Type</th>
                        <th className="p-3 text-left font-medium">Change</th>
                        <th className="p-3 text-left font-medium">Old Value</th>
                        <th className="p-3 text-left font-medium">New Value</th>
                      </tr>
                    </thead>
                    <tbody>
                      {changes.map((c: DnsChange) => (
                        <tr key={c.id} className="border-b hover:bg-muted/30">
                          <td className="p-3 text-xs text-muted-foreground whitespace-nowrap">
                            {new Date(c.created_at).toLocaleString()}
                          </td>
                          <td className="p-3 font-mono text-xs">{c.host || activeDomain?.domain}</td>
                          <td className="p-3"><RecordBadge type={c.record_type} /></td>
                          <td className="p-3"><ChangeBadge type={c.change_type} /></td>
                          <td className="p-3 font-mono text-xs max-w-[200px] truncate" title={c.old_value || ''}>
                            {c.old_value ? formatChangeValue(c.old_value) : '-'}
                          </td>
                          <td className="p-3 font-mono text-xs max-w-[200px] truncate" title={c.new_value || ''}>
                            {c.new_value ? formatChangeValue(c.new_value) : '-'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </TabsContent>

            {/* Manage Domains */}
            <TabsContent value="manage">
              <div className="rounded-md border">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-muted/50">
                      <th className="p-3 text-left font-medium">Domain</th>
                      <th className="p-3 text-left font-medium">Subdomains</th>
                      <th className="p-3 text-left font-medium">Status</th>
                      <th className="p-3 text-left font-medium">Interval</th>
                      <th className="p-3 text-left font-medium">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {domains.map((d: DnsMonitoredDomain) => (
                      <tr key={d.id} className="border-b hover:bg-muted/30">
                        <td className="p-3 font-mono">{d.domain}</td>
                        <td className="p-3">
                          {editSubsId === d.id ? (
                            <div className="flex items-center gap-1">
                              <Input
                                value={editSubsValue}
                                onChange={(e) => setEditSubsValue(e.target.value)}
                                placeholder="www, mail, home"
                                className="h-7 text-xs w-48"
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') {
                                    const subs = editSubsValue.split(',').map(s => s.trim()).filter(Boolean)
                                    updateSubsMutation.mutate({ id: d.id, subdomains: subs })
                                  }
                                  if (e.key === 'Escape') setEditSubsId(null)
                                }}
                              />
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-7 text-xs"
                                onClick={() => {
                                  const subs = editSubsValue.split(',').map(s => s.trim()).filter(Boolean)
                                  updateSubsMutation.mutate({ id: d.id, subdomains: subs })
                                }}
                              >Save</Button>
                            </div>
                          ) : (
                            <span
                              className="text-xs text-muted-foreground cursor-pointer hover:text-foreground"
                              onClick={() => {
                                setEditSubsId(d.id)
                                setEditSubsValue((d.subdomains || []).join(', '))
                              }}
                            >
                              {d.subdomains && d.subdomains.length > 0
                                ? d.subdomains.join(', ')
                                : 'click to add subdomains'}
                            </span>
                          )}
                        </td>
                        <td className="p-3">
                          <Badge variant={d.is_active ? 'success' : 'secondary'}>
                            {d.is_active ? 'Active' : 'Paused'}
                          </Badge>
                        </td>
                        <td className="p-3 text-muted-foreground">{d.check_interval_seconds / 60}m</td>
                        <td className="p-3">
                          <div className="flex gap-1">
                            <Button variant="ghost" size="icon" className="h-8 w-8"
                              onClick={() => checkMutation.mutate(d.id)} title="Check now">
                              <RefreshCw className="h-3 w-3" />
                            </Button>
                            <Button variant="ghost" size="icon" className="h-8 w-8"
                              onClick={() => toggleMutation.mutate({ id: d.id, is_active: !d.is_active })}
                              title={d.is_active ? 'Pause' : 'Resume'}>
                              {d.is_active ? <Pause className="h-3 w-3" /> : <Play className="h-3 w-3" />}
                            </Button>
                            <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive"
                              onClick={() => deleteMutation.mutate(d.id)}>
                              <Trash2 className="h-3 w-3" />
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </TabsContent>
          </Tabs>
        </>
      )}
    </div>
  )
}
