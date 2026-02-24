import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { getNodes, getVMs, getContainers, vmAction, containerAction } from '@/api/proxmox'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { Monitor, Play, Square, RotateCcw, Server, HardDrive } from 'lucide-react'
import type { ProxmoxNode, ProxmoxVM } from '@/types'

function formatBytes(bytes: number): string {
  const gb = bytes / 1024 / 1024 / 1024
  return `${gb.toFixed(1)} GB`
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

export default function ProxmoxPage() {
  const queryClient = useQueryClient()
  const [selectedNode, setSelectedNode] = useState<string>('')

  const { data: nodes = [], isError } = useQuery({
    queryKey: ['proxmox', 'nodes'],
    queryFn: getNodes,
    retry: false,
  })

  const { data: vms = [] } = useQuery({
    queryKey: ['proxmox', 'vms', selectedNode],
    queryFn: () => getVMs(selectedNode),
    enabled: !!selectedNode,
  })

  const { data: containers = [] } = useQuery({
    queryKey: ['proxmox', 'containers', selectedNode],
    queryFn: () => getContainers(selectedNode),
    enabled: !!selectedNode,
  })

  const actionMutation = useMutation({
    mutationFn: ({ type, node, vmid, action }: { type: 'vm' | 'ct'; node: string; vmid: number; action: string }) =>
      type === 'vm' ? vmAction(node, vmid, action) : containerAction(node, vmid, action),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['proxmox'] })
    },
  })

  if (isError) {
    return (
      <div className="space-y-6">
        <h1 className="text-3xl font-bold">Proxmox</h1>
        <Card>
          <CardContent className="p-12 text-center text-muted-foreground">
            <Monitor className="h-12 w-12 mx-auto mb-4 opacity-50" />
            <p>Proxmox not configured. Go to Settings to add your Proxmox credentials.</p>
          </CardContent>
        </Card>
      </div>
    )
  }

  if (!selectedNode && nodes.length > 0) {
    setSelectedNode((nodes[0] as ProxmoxNode).node)
  }

  const GuestTable = ({ guests, type }: { guests: ProxmoxVM[]; type: 'vm' | 'ct' }) => (
    <div className="rounded-md border">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b bg-muted/50">
            <th className="p-3 text-left font-medium">ID</th>
            <th className="p-3 text-left font-medium">Name</th>
            <th className="p-3 text-left font-medium">Status</th>
            <th className="p-3 text-left font-medium">CPU</th>
            <th className="p-3 text-left font-medium">Memory</th>
            <th className="p-3 text-left font-medium">Actions</th>
          </tr>
        </thead>
        <tbody>
          {guests.map((g) => (
            <tr key={g.vmid} className="border-b hover:bg-muted/30">
              <td className="p-3">{g.vmid}</td>
              <td className="p-3 font-medium">{g.name}</td>
              <td className="p-3">
                <Badge variant={g.status === 'running' ? 'success' : 'secondary'}>{g.status}</Badge>
              </td>
              <td className="p-3">{(g.cpu * 100).toFixed(0)}% / {g.cpus} cores</td>
              <td className="p-3">{formatBytes(g.mem)} / {formatBytes(g.maxmem)}</td>
              <td className="p-3">
                <div className="flex gap-1">
                  {g.status !== 'running' && (
                    <Button size="sm" variant="ghost" onClick={() => actionMutation.mutate({ type, node: selectedNode, vmid: g.vmid, action: 'start' })}>
                      <Play className="h-3 w-3" />
                    </Button>
                  )}
                  {g.status === 'running' && (
                    <>
                      <Button size="sm" variant="ghost" onClick={() => actionMutation.mutate({ type, node: selectedNode, vmid: g.vmid, action: 'shutdown' })}>
                        <Square className="h-3 w-3" />
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => actionMutation.mutate({ type, node: selectedNode, vmid: g.vmid, action: 'reboot' })}>
                        <RotateCcw className="h-3 w-3" />
                      </Button>
                    </>
                  )}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold">Proxmox</h1>

      {/* Node Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {(nodes as ProxmoxNode[]).map((node) => (
          <Card
            key={node.node}
            className={`cursor-pointer transition-colors ${selectedNode === node.node ? 'ring-2 ring-primary' : ''}`}
            onClick={() => setSelectedNode(node.node)}
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

      {selectedNode && (
        <Tabs defaultValue="vms">
          <TabsList>
            <TabsTrigger value="vms">
              <HardDrive className="h-4 w-4 mr-2" />VMs ({vms.length})
            </TabsTrigger>
            <TabsTrigger value="containers">
              <Server className="h-4 w-4 mr-2" />Containers ({containers.length})
            </TabsTrigger>
          </TabsList>
          <TabsContent value="vms">
            {vms.length ? <GuestTable guests={vms as ProxmoxVM[]} type="vm" /> : <p className="text-muted-foreground p-4">No VMs on this node.</p>}
          </TabsContent>
          <TabsContent value="containers">
            {containers.length ? <GuestTable guests={containers as ProxmoxVM[]} type="ct" /> : <p className="text-muted-foreground p-4">No containers on this node.</p>}
          </TabsContent>
        </Tabs>
      )}
    </div>
  )
}
