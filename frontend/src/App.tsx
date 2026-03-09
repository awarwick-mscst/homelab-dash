import { Routes, Route } from 'react-router-dom'
import { AppShell } from '@/components/layout/AppShell'
import { ProtectedRoute } from '@/components/layout/ProtectedRoute'
import LoginPage from '@/pages/LoginPage'
import DashboardPage from '@/pages/DashboardPage'
import DeviceInventoryPage from '@/pages/DeviceInventoryPage'
import NetworkMapPage from '@/pages/NetworkMapPage'
import ScannerPage from '@/pages/ScannerPage'
import ProxmoxPage from '@/pages/ProxmoxPage'
import PfSensePage from '@/pages/PfSensePage'
import UniFiPage from '@/pages/UniFiPage'
import SwitchPage from '@/pages/SwitchPage'
import AdvisorPage from '@/pages/AdvisorPage'
import SettingsPage from '@/pages/SettingsPage'
import HelpPage from '@/pages/HelpPage'

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route
        path="/*"
        element={
          <ProtectedRoute>
            <AppShell>
              <Routes>
                <Route path="/" element={<DashboardPage />} />
                <Route path="/devices" element={<DeviceInventoryPage />} />
                <Route path="/network" element={<NetworkMapPage />} />
                <Route path="/scanner" element={<ScannerPage />} />
                <Route path="/proxmox" element={<ProxmoxPage />} />
                <Route path="/pfsense" element={<PfSensePage />} />
                <Route path="/unifi" element={<UniFiPage />} />
                <Route path="/switch" element={<SwitchPage />} />
                <Route path="/advisor" element={<AdvisorPage />} />
                <Route path="/settings" element={<SettingsPage />} />
                <Route path="/help" element={<HelpPage />} />
              </Routes>
            </AppShell>
          </ProtectedRoute>
        }
      />
    </Routes>
  )
}
