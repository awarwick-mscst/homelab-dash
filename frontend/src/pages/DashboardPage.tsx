import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { getServices, createService, deleteService } from '@/api/services'
import { useWebSocket } from '@/hooks/useWebSocket'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Plus, ExternalLink, Trash2, Activity, CheckCircle, XCircle, AlertTriangle } from 'lucide-react'
import type { MonitoredService, ServiceStatus } from '@/types'

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

export default function DashboardPage() {
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [url, setUrl] = useState('')
  const [category, setCategory] = useState('general')

  const { data: services = [] } = useQuery({ queryKey: ['services'], queryFn: getServices })

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

  const categories = [...new Set(services.map((s) => s.category))]

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold">Dashboard</h1>
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

      {/* Quick Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-4 text-center">
            <p className="text-2xl font-bold">{services.length}</p>
            <p className="text-sm text-muted-foreground">Total</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-center">
            <p className="text-2xl font-bold text-green-500">{online}</p>
            <p className="text-sm text-muted-foreground">Online</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-center">
            <p className="text-2xl font-bold text-red-500">{offline}</p>
            <p className="text-sm text-muted-foreground">Offline</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-center">
            <p className="text-2xl font-bold text-yellow-500">{degraded}</p>
            <p className="text-sm text-muted-foreground">Degraded</p>
          </CardContent>
        </Card>
      </div>

      {/* Service Grid */}
      {services.length === 0 ? (
        <Card>
          <CardContent className="p-12 text-center text-muted-foreground">
            <Activity className="h-12 w-12 mx-auto mb-4 opacity-50" />
            <p>No services monitored yet. Add one to get started.</p>
          </CardContent>
        </Card>
      ) : (
        categories.map((cat) => (
          <div key={cat}>
            <h2 className="text-lg font-semibold mb-3 capitalize">{cat}</h2>
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
  )
}
