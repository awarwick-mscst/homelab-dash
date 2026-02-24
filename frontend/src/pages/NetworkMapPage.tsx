import { useCallback, useEffect, useState } from 'react'
import ReactFlow, {
  Node, Edge, useNodesState, useEdgesState, Controls, Background, MiniMap,
} from 'react-flow-renderer'
import { useQuery, useMutation } from '@tanstack/react-query'
import { getDevices } from '@/api/devices'
import { getLinks, getTopology, saveTopology, getSubnets } from '@/api/networks'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Save, Network } from 'lucide-react'

export default function NetworkMapPage() {
  const { data: devices = [] } = useQuery({ queryKey: ['devices'], queryFn: () => getDevices() })
  const { data: links = [] } = useQuery({ queryKey: ['links'], queryFn: getLinks })
  const { data: topology } = useQuery({ queryKey: ['topology'], queryFn: getTopology })
  const { data: subnets = [] } = useQuery({ queryKey: ['subnets'], queryFn: getSubnets })

  const [nodes, setNodes, onNodesChange] = useNodesState([])
  const [edges, setEdges, onEdgesChange] = useEdgesState([])

  const saveMutation = useMutation({
    mutationFn: (layoutData: Record<string, unknown>) =>
      saveTopology({ name: 'default', layout_data: layoutData }),
  })

  useEffect(() => {
    if (!devices.length) return

    const savedPositions = (topology?.layout_data as Record<string, { x: number; y: number }>) || {}

    const newNodes: Node[] = devices.map((d, i) => ({
      id: String(d.id),
      position: savedPositions[String(d.id)] || { x: (i % 6) * 200, y: Math.floor(i / 6) * 120 },
      data: {
        label: (
          <div className="text-center">
            <div className="font-medium text-xs">{d.hostname || d.ip_address}</div>
            <div className="text-[10px] text-muted-foreground">{d.ip_address}</div>
            <div className={`w-2 h-2 rounded-full mx-auto mt-1 ${d.is_online ? 'bg-green-500' : 'bg-gray-400'}`} />
          </div>
        ),
      },
      style: {
        background: 'hsl(var(--card))',
        border: '1px solid hsl(var(--border))',
        borderRadius: '8px',
        padding: '8px',
        width: 150,
      },
    }))

    const newEdges: Edge[] = links.map((l) => ({
      id: String(l.id),
      source: String(l.source_device_id),
      target: String(l.target_device_id),
      label: l.link_type,
      style: { stroke: 'hsl(var(--muted-foreground))' },
    }))

    setNodes(newNodes)
    setEdges(newEdges)
  }, [devices, links, topology])

  const handleSave = useCallback(() => {
    const positions: Record<string, { x: number; y: number }> = {}
    nodes.forEach((n) => {
      positions[n.id] = n.position
    })
    saveMutation.mutate(positions)
  }, [nodes, saveMutation])

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold">Network Map</h1>
        <Button onClick={handleSave} disabled={saveMutation.isPending}>
          <Save className="h-4 w-4 mr-2" />
          Save Layout
        </Button>
      </div>

      {devices.length === 0 ? (
        <Card>
          <CardContent className="p-12 text-center text-muted-foreground">
            <Network className="h-12 w-12 mx-auto mb-4 opacity-50" />
            <p>No devices to display. Add devices or run a scan first.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="h-[calc(100vh-200px)] border rounded-lg overflow-hidden">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            fitView
          >
            <Controls />
            <MiniMap />
            <Background />
          </ReactFlow>
        </div>
      )}

      {subnets.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {subnets.map((s) => (
            <Card key={s.id}>
              <CardContent className="p-4">
                <h3 className="font-medium">{s.name}</h3>
                <p className="text-sm text-muted-foreground font-mono">{s.cidr}</p>
                {s.vlan_id && <p className="text-xs text-muted-foreground">VLAN {s.vlan_id}</p>}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
