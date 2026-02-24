export interface User {
  id: number
  username: string
  is_active: boolean
}

export interface Token {
  access_token: string
  token_type: string
}

export type ServiceStatus = 'online' | 'offline' | 'degraded' | 'unknown'

export interface MonitoredService {
  id: number
  name: string
  url: string
  icon: string | null
  category: string
  status: ServiceStatus
  response_time_ms: number | null
  last_checked: string | null
  check_interval: number
  expected_status_code: number
  notes: string | null
  created_at: string
}

export interface Device {
  id: number
  hostname: string | null
  ip_address: string
  mac_address: string | null
  device_type: string
  os_family: string | null
  os_version: string | null
  vendor: string | null
  subnet_id: number | null
  location: string | null
  notes: string | null
  is_online: boolean
  last_seen: string | null
  first_seen: string
  ports: DevicePort[]
}

export interface DevicePort {
  id: number
  port_number: number
  protocol: string
  state: string
  service_name: string | null
  service_version: string | null
  last_seen: string
}

export interface Subnet {
  id: number
  cidr: string
  name: string
  vlan_id: number | null
  gateway: string | null
  dns_servers: string | null
  dhcp_enabled: boolean
  description: string | null
  created_at: string
}

export interface NetworkLink {
  id: number
  source_device_id: number
  target_device_id: number
  link_type: string
  bandwidth: string | null
  notes: string | null
}

export interface TopologyLayout {
  id: number
  name: string
  layout_data: Record<string, unknown>
  updated_at: string
}

export type ScanStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled'
export type ScanProfile = 'ping_sweep' | 'port_scan' | 'os_detect' | 'full'

export interface ScanJob {
  id: number
  target: string
  profile: ScanProfile
  status: ScanStatus
  progress: number
  hosts_found: number
  results: Record<string, unknown> | null
  error_message: string | null
  started_at: string | null
  completed_at: string | null
  created_at: string
}

export interface ScanSchedule {
  id: number
  name: string
  target: string
  profile: ScanProfile
  cron_expression: string
  is_active: boolean
  last_run: string | null
  created_at: string
}

export type Severity = 'critical' | 'high' | 'medium' | 'low' | 'info'

export interface AdvisoryFinding {
  id: number
  category: string
  title: string
  description: string
  severity: Severity
  recommendation: string
  is_resolved: boolean
  resolved_at: string | null
  details: Record<string, unknown> | null
}

export interface AdvisoryReport {
  id: number
  overall_score: number
  total_findings: number
  critical_count: number
  high_count: number
  medium_count: number
  low_count: number
  info_count: number
  created_at: string
  findings: AdvisoryFinding[]
}

export interface Settings {
  proxmox_host: string
  proxmox_token_id: string
  proxmox_configured: boolean
  pfsense_host: string
  pfsense_configured: boolean
  health_check_interval: number
  proxmox_poll_interval: number
}

export interface ProxmoxNode {
  node: string
  status: string
  cpu: number
  maxcpu: number
  mem: number
  maxmem: number
  disk: number
  maxdisk: number
  uptime: number
}

export interface ProxmoxVM {
  vmid: number
  name: string
  status: string
  cpu: number
  cpus: number
  mem: number
  maxmem: number
  disk: number
  maxdisk: number
  uptime: number
  type?: 'qemu' | 'lxc'
}
