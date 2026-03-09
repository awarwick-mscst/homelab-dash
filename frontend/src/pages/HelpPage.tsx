import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import {
  HelpCircle,
  BookOpen,
  Wrench,
  Settings,
  Server,
  Shield,
  Wifi,
  Brain,
  Network,
  MonitorCheck,
  ScanSearch,
  Map,
  AlertTriangle,
  CheckCircle,
  Terminal,
} from 'lucide-react'

function Step({ number, children }: { number: number; children: React.ReactNode }) {
  return (
    <div className="flex gap-3 items-start">
      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground text-xs font-bold">
        {number}
      </span>
      <div className="text-sm">{children}</div>
    </div>
  )
}

function Code({ children }: { children: React.ReactNode }) {
  return (
    <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">{children}</code>
  )
}

export default function HelpPage() {
  return (
    <div className="space-y-6 max-w-3xl">
      <div className="flex items-center gap-3">
        <HelpCircle className="h-8 w-8" />
        <h1 className="text-3xl font-bold">Help &amp; Documentation</h1>
      </div>

      <Tabs defaultValue="getting-started">
        <TabsList>
          <TabsTrigger value="getting-started">
            <BookOpen className="h-4 w-4 mr-2" />Getting Started
          </TabsTrigger>
          <TabsTrigger value="integrations">
            <Wrench className="h-4 w-4 mr-2" />Integrations
          </TabsTrigger>
          <TabsTrigger value="features">
            <MonitorCheck className="h-4 w-4 mr-2" />Features
          </TabsTrigger>
          <TabsTrigger value="troubleshooting">
            <AlertTriangle className="h-4 w-4 mr-2" />Troubleshooting
          </TabsTrigger>
        </TabsList>

        {/* Getting Started */}
        <TabsContent value="getting-started" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <BookOpen className="h-4 w-4" />
                Overview
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-sm text-muted-foreground">
                Homelab Dash is a monitoring dashboard for your home lab infrastructure. It provides
                service monitoring, device inventory, network scanning, and integrations with popular
                homelab platforms like Proxmox, pfSense, and UniFi.
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <CheckCircle className="h-4 w-4" />
                Quick Start
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <Step number={1}>
                <p className="font-medium">Configure your integrations</p>
                <p className="text-muted-foreground">
                  Go to the <strong>Settings</strong> page and connect your Proxmox servers, pfSense firewall,
                  UniFi controller, network switch, or Ollama AI server. Each integration is optional -- configure
                  only what you use.
                </p>
              </Step>
              <Step number={2}>
                <p className="font-medium">Run a network scan</p>
                <p className="text-muted-foreground">
                  Navigate to the <strong>Scanner</strong> page and run a scan of your network. This discovers
                  devices, open ports, and operating systems on your LAN.
                </p>
              </Step>
              <Step number={3}>
                <p className="font-medium">Monitor your devices</p>
                <p className="text-muted-foreground">
                  View all discovered devices in the <strong>Device Inventory</strong>. Add services to monitor on
                  the <strong>Dashboard</strong>. Run the <strong>Advisor</strong> for security recommendations.
                </p>
              </Step>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Integrations */}
        <TabsContent value="integrations" className="space-y-4">
          {/* Proxmox */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Server className="h-4 w-4" />
                Proxmox VE
                <Badge variant="outline">Virtualization</Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <p className="text-sm font-medium mb-1">Requirements</p>
                <ul className="text-sm text-muted-foreground list-disc list-inside space-y-1">
                  <li>Proxmox VE host URL (e.g. <Code>https://192.168.1.100:8006</Code>)</li>
                  <li>API token (token ID + secret) or username and password</li>
                </ul>
              </div>
              <div>
                <p className="text-sm font-medium mb-1">Setup Steps</p>
                <ol className="text-sm text-muted-foreground list-decimal list-inside space-y-1">
                  <li>In Proxmox, go to <Code>Datacenter &gt; Permissions &gt; API Tokens</Code></li>
                  <li>Click <strong>Add</strong> to create a new API token</li>
                  <li>Note the token ID (e.g. <Code>user@pam!tokenname</Code>) and the secret</li>
                  <li>In Homelab Dash, go to <strong>Settings</strong> and add a Proxmox server</li>
                  <li>Enter the host and credentials, then click <strong>Save</strong></li>
                </ol>
              </div>
              <div>
                <p className="text-sm font-medium mb-1">Features</p>
                <ul className="text-sm text-muted-foreground list-disc list-inside space-y-1">
                  <li>VM and container monitoring with status indicators</li>
                  <li>CPU and memory usage per guest</li>
                  <li>Start, stop, and reboot actions</li>
                  <li>IP address display for each guest</li>
                  <li>Auto-link guests to the device inventory</li>
                </ul>
              </div>
            </CardContent>
          </Card>

          {/* pfSense */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Shield className="h-4 w-4" />
                pfSense
                <Badge variant="outline">Firewall</Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm text-muted-foreground">
                pfSense can be connected in two modes: <strong>SNMP</strong> or <strong>API</strong>.
              </p>

              <div className="rounded-md border p-4 space-y-3">
                <p className="text-sm font-medium">SNMP Mode</p>
                <ol className="text-sm text-muted-foreground list-decimal list-inside space-y-1">
                  <li>Log into your pfSense web UI</li>
                  <li>Go to <Code>Services &gt; SNMP</Code></li>
                  <li>Check <strong>Enable SNMP Daemon</strong></li>
                  <li>Set a <strong>Community String</strong> (default: <Code>public</Code>)</li>
                  <li>Click <strong>Save</strong></li>
                  <li>In Homelab Dash Settings, select SNMP mode, enter the pfSense IP and community string</li>
                </ol>
                <p className="text-sm text-muted-foreground">
                  <strong>Provides:</strong> System info, interface statistics, ARP table, routing table, CPU/memory usage, firewall state count.
                </p>
                <p className="text-xs text-muted-foreground">
                  SNMP mode works with most pfSense versions without installing additional packages.
                </p>
              </div>

              <div className="rounded-md border p-4 space-y-3">
                <p className="text-sm font-medium">API Mode</p>
                <ol className="text-sm text-muted-foreground list-decimal list-inside space-y-1">
                  <li>Log into your pfSense web UI</li>
                  <li>Go to <Code>System &gt; Package Manager &gt; Available Packages</Code></li>
                  <li>Install the <strong>pfSense-pkg-API</strong> package</li>
                  <li>Go to <Code>System &gt; REST API &gt; Settings</Code> and set authentication to API Token</li>
                  <li>Go to <Code>System &gt; REST API &gt; Keys</Code> and create a new key</li>
                  <li>Copy the API key and secret into Homelab Dash Settings</li>
                </ol>
                <p className="text-sm text-muted-foreground">
                  <strong>Provides:</strong> Firewall rules, DHCP leases, VPN status, and more detailed configuration data.
                </p>
              </div>
            </CardContent>
          </Card>

          {/* Network Switch */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Network className="h-4 w-4" />
                Network Switch (SNMP)
                <Badge variant="outline">Switch</Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Works with any SNMP-enabled managed switch, such as Cisco SF300/SG300 series, TP-Link, Netgear, and others.
              </p>
              <div>
                <p className="text-sm font-medium mb-1">Setup Steps</p>
                <ol className="text-sm text-muted-foreground list-decimal list-inside space-y-1">
                  <li>Log into your switch management interface</li>
                  <li>Navigate to SNMP settings (usually under <Code>Management &gt; SNMP</Code>)</li>
                  <li>Enable SNMP and set a community string</li>
                  <li>In Homelab Dash Settings, enter the switch IP address, community string, and SNMP port</li>
                </ol>
              </div>
              <div>
                <p className="text-sm font-medium mb-1">Features</p>
                <ul className="text-sm text-muted-foreground list-disc list-inside space-y-1">
                  <li>Port status (up/down, speed, duplex)</li>
                  <li>Traffic statistics per port</li>
                  <li>MAC address table</li>
                  <li>VLAN configuration</li>
                </ul>
              </div>
              <div className="rounded-md bg-muted p-3">
                <p className="text-sm font-medium mb-1">Troubleshooting</p>
                <ul className="text-sm text-muted-foreground list-disc list-inside space-y-1">
                  <li>Make sure SNMP is enabled on the switch</li>
                  <li>Verify the community string matches exactly</li>
                  <li>Ensure UDP port 161 is accessible from the Homelab Dash server</li>
                  <li>Check any firewall rules between the server and the switch</li>
                  <li>Some switches require SNMPv2c to be explicitly enabled</li>
                </ul>
              </div>
            </CardContent>
          </Card>

          {/* UniFi */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Wifi className="h-4 w-4" />
                UniFi
                <Badge variant="outline">Wireless</Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <p className="text-sm font-medium mb-1">Requirements</p>
                <ul className="text-sm text-muted-foreground list-disc list-inside space-y-1">
                  <li>UniFi Controller URL (e.g. <Code>https://192.168.1.10:8443</Code>)</li>
                  <li>Controller username and password</li>
                  <li>Site name (default: <Code>default</Code>)</li>
                </ul>
              </div>
              <div>
                <p className="text-sm font-medium mb-1">Setup Steps</p>
                <ol className="text-sm text-muted-foreground list-decimal list-inside space-y-1">
                  <li>Ensure your UniFi Controller (Network Application) is running and accessible</li>
                  <li>In Homelab Dash Settings, enter the controller URL, username, password, and site name</li>
                  <li>Click <strong>Save</strong></li>
                </ol>
              </div>
              <div>
                <p className="text-sm font-medium mb-1">Features</p>
                <ul className="text-sm text-muted-foreground list-disc list-inside space-y-1">
                  <li>Access point status and health</li>
                  <li>Connected clients</li>
                  <li>WLAN configuration</li>
                  <li>Network health overview</li>
                </ul>
              </div>
            </CardContent>
          </Card>

          {/* Ollama */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Brain className="h-4 w-4" />
                Ollama (AI Advisor)
                <Badge variant="outline">AI</Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <p className="text-sm font-medium mb-1">Requirements</p>
                <ul className="text-sm text-muted-foreground list-disc list-inside space-y-1">
                  <li>Ollama server URL (e.g. <Code>http://192.168.1.50:11434</Code>)</li>
                  <li>A downloaded model name (e.g. <Code>llama3</Code>)</li>
                </ul>
              </div>
              <div>
                <p className="text-sm font-medium mb-1">Setup Steps</p>
                <ol className="text-sm text-muted-foreground list-decimal list-inside space-y-1">
                  <li>Install Ollama on a machine in your network (<Code>curl -fsSL https://ollama.com/install.sh | sh</Code>)</li>
                  <li>Pull a model: <Code>ollama pull llama3</Code></li>
                  <li>Ensure Ollama is listening on the network (set <Code>OLLAMA_HOST=0.0.0.0</Code> if needed)</li>
                  <li>In Homelab Dash Settings, enter the Ollama URL and model name</li>
                  <li>Click <strong>Save</strong></li>
                </ol>
              </div>
              <div>
                <p className="text-sm font-medium mb-1">Features</p>
                <ul className="text-sm text-muted-foreground list-disc list-inside space-y-1">
                  <li>AI-powered security analysis of network scan results</li>
                  <li>Natural language summaries of findings</li>
                  <li>Prioritized recommendations based on your environment</li>
                </ul>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Features */}
        <TabsContent value="features" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <MonitorCheck className="h-4 w-4" />
                Dashboard
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">
                The Dashboard provides service monitoring. Add URLs for any service you want to track -- the system
                will periodically check each endpoint and report uptime status and response time. Use this to monitor
                web applications, APIs, or any HTTP/HTTPS endpoint in your homelab.
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Server className="h-4 w-4" />
                Device Inventory
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">
                All discovered devices from network scans appear in the Device Inventory. The table is sortable and
                filterable, showing IP addresses, MAC addresses, detected operating systems, hostnames, and open
                ports. Devices from Proxmox guests are automatically linked when their IPs match scan results.
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <ScanSearch className="h-4 w-4" />
                Network Scanner
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">
                Run nmap-based network scans with multiple scan types: ping sweep (fast discovery), port scan
                (common ports), OS detection (identify operating systems), and full scan (comprehensive analysis).
                Scan progress is shown in real time via WebSocket. Results feed into the Device Inventory and the
                Advisor engine.
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Map className="h-4 w-4" />
                Network Map
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">
                A visual topology map of your network. Displays devices and their connections, helping you
                understand how your homelab infrastructure is laid out.
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Shield className="h-4 w-4" />
                Advisor
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">
                The Advisor runs a security assessment based on your scan findings. It identifies open ports,
                insecure services, missing patches, and other potential issues. Findings are categorized by
                severity (critical, high, medium, low, info) with actionable recommendations. When Ollama is
                configured, the analysis is enhanced with AI-generated summaries and prioritized advice.
              </p>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Troubleshooting */}
        <TabsContent value="troubleshooting" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Settings className="h-4 w-4" />
                Integration shows "Not configured"
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">
                Go to the <strong>Settings</strong> page, enter the required credentials for the integration,
                and click <strong>Save</strong>. The status badge should update to "Connected" after saving
                valid credentials.
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Network className="h-4 w-4" />
                SNMP not returning data
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <p className="text-sm text-muted-foreground">Check the following:</p>
              <ul className="text-sm text-muted-foreground list-disc list-inside space-y-1">
                <li>SNMP is enabled on the target device</li>
                <li>The community string matches exactly (case-sensitive)</li>
                <li>UDP port 161 is open between the Homelab Dash server and the device</li>
                <li>No firewall is blocking SNMP traffic</li>
              </ul>
              <p className="text-sm text-muted-foreground mt-2">
                Test from the server with: <Code>snmpwalk -v2c -c public &lt;device-ip&gt;</Code>
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <ScanSearch className="h-4 w-4" />
                Scans failing
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <ul className="text-sm text-muted-foreground list-disc list-inside space-y-1">
                <li>Ensure <Code>nmap</Code> is installed on the server (<Code>apt install nmap</Code> on Debian/Ubuntu)</li>
                <li>OS detection scans require root/sudo privileges</li>
                <li>Check that the target subnet is reachable from the server</li>
              </ul>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Terminal className="h-4 w-4" />
                502 errors
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <p className="text-sm text-muted-foreground">
                A 502 error usually means the backend service is not running. Check its status:
              </p>
              <p className="text-sm">
                <Code>systemctl status homelab-dash-backend</Code>
              </p>
              <p className="text-sm text-muted-foreground">
                If the service is stopped, start it with <Code>systemctl start homelab-dash-backend</Code> and
                check the logs with <Code>journalctl -u homelab-dash-backend -f</Code> for errors.
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Network className="h-4 w-4" />
                Switch page empty
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <p className="text-sm text-muted-foreground">
                The switch page relies on SNMP queries. If the page is empty:
              </p>
              <ul className="text-sm text-muted-foreground list-disc list-inside space-y-1">
                <li>SNMP may be timing out -- check network connectivity to the switch</li>
                <li>Verify the switch responds to SNMP queries from the server</li>
                <li>Some switches need SNMPv2c explicitly enabled in their settings</li>
                <li>Try increasing the SNMP timeout or checking for packet loss</li>
              </ul>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}
