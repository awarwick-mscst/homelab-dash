import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { getDevices, createDevice, deleteDevice } from '@/api/devices'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Plus, Trash2, Server } from 'lucide-react'

export default function DeviceInventoryPage() {
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)
  const [filter, setFilter] = useState('')
  const [form, setForm] = useState({ hostname: '', ip_address: '', device_type: 'unknown', mac_address: '', location: '' })

  const { data: devices = [] } = useQuery({ queryKey: ['devices'], queryFn: () => getDevices() })

  const addMutation = useMutation({
    mutationFn: () => createDevice(form),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['devices'] })
      setOpen(false)
      setForm({ hostname: '', ip_address: '', device_type: 'unknown', mac_address: '', location: '' })
    },
  })

  const deleteMutation = useMutation({
    mutationFn: deleteDevice,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['devices'] }),
  })

  const filtered = devices.filter(
    (d) =>
      (d.hostname || '').toLowerCase().includes(filter.toLowerCase()) ||
      d.ip_address.includes(filter) ||
      (d.mac_address || '').toLowerCase().includes(filter.toLowerCase())
  )

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold">Device Inventory</h1>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button><Plus className="h-4 w-4 mr-2" />Add Device</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Add Device</DialogTitle></DialogHeader>
            <form onSubmit={(e) => { e.preventDefault(); addMutation.mutate() }} className="space-y-3">
              <Input placeholder="Hostname" value={form.hostname} onChange={(e) => setForm({ ...form, hostname: e.target.value })} />
              <Input placeholder="IP Address" value={form.ip_address} onChange={(e) => setForm({ ...form, ip_address: e.target.value })} required />
              <Input placeholder="MAC Address" value={form.mac_address} onChange={(e) => setForm({ ...form, mac_address: e.target.value })} />
              <Input placeholder="Device Type" value={form.device_type} onChange={(e) => setForm({ ...form, device_type: e.target.value })} />
              <Input placeholder="Location" value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} />
              <Button type="submit" className="w-full" disabled={addMutation.isPending}>Add</Button>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      <Input placeholder="Filter by hostname, IP, or MAC..." value={filter} onChange={(e) => setFilter(e.target.value)} className="max-w-md" />

      {filtered.length === 0 ? (
        <Card>
          <CardContent className="p-12 text-center text-muted-foreground">
            <Server className="h-12 w-12 mx-auto mb-4 opacity-50" />
            <p>No devices found. Add devices manually or run a network scan.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="rounded-md border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/50">
                <th className="p-3 text-left font-medium">Status</th>
                <th className="p-3 text-left font-medium">Hostname</th>
                <th className="p-3 text-left font-medium">IP Address</th>
                <th className="p-3 text-left font-medium">MAC</th>
                <th className="p-3 text-left font-medium">Type</th>
                <th className="p-3 text-left font-medium">OS</th>
                <th className="p-3 text-left font-medium">Ports</th>
                <th className="p-3 text-left font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((device) => (
                <tr key={device.id} className="border-b hover:bg-muted/30">
                  <td className="p-3">
                    <Badge variant={device.is_online ? 'success' : 'secondary'}>
                      {device.is_online ? 'Online' : 'Offline'}
                    </Badge>
                  </td>
                  <td className="p-3 font-mono">{device.hostname || '-'}</td>
                  <td className="p-3 font-mono">{device.ip_address}</td>
                  <td className="p-3 font-mono text-xs">{device.mac_address || '-'}</td>
                  <td className="p-3 capitalize">{device.device_type}</td>
                  <td className="p-3 text-xs">{device.os_family || '-'}</td>
                  <td className="p-3">{device.ports.length > 0 ? device.ports.map((p) => p.port_number).join(', ') : '-'}</td>
                  <td className="p-3">
                    <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => deleteMutation.mutate(device.id)}>
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
