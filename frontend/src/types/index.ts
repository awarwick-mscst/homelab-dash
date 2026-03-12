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
  proxmox_vmid: number | null
  proxmox_server_id: string | null
  proxmox_node: string | null
  proxmox_type: string | null
  is_online: boolean
  is_pinned: boolean
  pinned_port: number | null
  is_monitored: boolean
  monitor_url: string | null
  monitor_status: string | null
  response_time_ms: number | null
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
  source_port_label: string | null
  target_port_label: string | null
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
  custom_ports: string | null
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
  ai_summary: string | null
  created_at: string
  findings: AdvisoryFinding[]
}

export interface ProxmoxServer {
  id: string
  host: string
  configured: boolean
}

export interface Settings {
  proxmox_host: string
  proxmox_token_id: string
  proxmox_configured: boolean
  proxmox_servers: ProxmoxServer[]
  pfsense_host: string
  pfsense_configured: boolean
  pfsense_mode: string
  unifi_host: string
  unifi_configured: boolean
  ollama_host: string
  ollama_configured: boolean
  ollama_model: string
  switch_host: string
  switch_configured: boolean
  switch_mode: string
  health_check_interval: number
  proxmox_poll_interval: number
}

export interface SwitchInterface {
  index: string
  name: string
  alias?: string
  mtu: number
  speed: number
  admin_status: string
  oper_status: string
  in_octets: number
  out_octets: number
  in_errors: number
  out_errors: number
}

export interface SwitchMacEntry {
  mac: string
  bridge_port?: string
  if_index?: string
  status?: string
}

export interface SwitchVlan {
  id: number
  name: string
}

export interface SwitchSystemInfo {
  description: string
  uptime: string
  uptime_seconds?: number
  contact: string
  hostname: string
  location: string
}

export interface DnsMonitoredDomain {
  id: number
  domain: string
  subdomains: string[] | null
  is_active: boolean
  check_interval_seconds: number
  created_at: string
}

export interface DnsSnapshot {
  id: number
  domain_id: number
  records: Record<string, Record<string, unknown[]>>
  error_message: string | null
  created_at: string
}

export interface DnsChange {
  id: number
  domain_id: number
  snapshot_id: number
  host: string | null
  record_type: string
  change_type: 'added' | 'removed' | 'modified'
  old_value: string | null
  new_value: string | null
  created_at: string
}

export interface PfSenseSystemInfo {
  description: string
  uptime: string
  uptime_seconds?: number
  contact: string
  hostname: string
  location: string
  cpu_load_1?: string
  cpu_load_5?: string
  cpu_load_15?: string
  mem_total_kb?: number
  mem_avail_kb?: number
  mem_used_kb?: number
  mem_free_kb?: number
  mem_percent?: number
  mem_buffer_kb?: number
  mem_cached_kb?: number
  tcp_established?: string
  pf_states?: string
}

export interface PfSenseInterface {
  index: string
  name: string
  alias?: string
  mtu: number
  speed: number
  admin_status: string
  oper_status: string
  in_octets: number
  out_octets: number
  in_errors: number
  out_errors: number
  ip_addresses: string[]
}

export interface PfSenseArpEntry {
  ip: string
  mac: string
  interface: string
  type: string
}

export interface PfSenseGateway {
  destination: string
  gateway: string
  mask: string
  metric: number
  interface: string
}

export interface PfSenseOverview {
  system: PfSenseSystemInfo
  interfaces: PfSenseInterface[]
  arp_table: PfSenseArpEntry[]
  interface_counts: { up: number; down: number; total: number }
}

export interface UniFiDevice {
  _id: string
  name: string
  model: string
  type: string
  ip: string
  mac: string
  state: number
  version: string
  uptime: number
  num_sta: number
  [key: string]: unknown
}

export interface UniFiClient {
  _id: string
  hostname?: string
  name?: string
  ip: string
  mac: string
  oui?: string
  network?: string
  essid?: string
  signal?: number
  rssi?: number
  tx_rate?: number
  rx_rate?: number
  uptime?: number
  is_wired: boolean
  [key: string]: unknown
}

export interface UniFiWlan {
  _id: string
  name: string
  enabled: boolean
  security: string
  vlan?: string | number
  wlan_band?: string
  [key: string]: unknown
}

export interface UniFiHealth {
  subsystem: string
  status: string
  num_user?: number
  num_ap?: number
  num_adopted?: number
  num_sw?: number
  num_gw?: number
  [key: string]: unknown
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

export interface ProxmoxLinkedDevice {
  id: number
  hostname: string | null
  ip_address: string
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
  _type?: 'qemu' | 'lxc'
  _node?: string
  ip_addresses?: string[]
  linked_device?: ProxmoxLinkedDevice | null
}
