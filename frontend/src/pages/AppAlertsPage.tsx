import AlertLogSection from '../components/AlertLogSection'

export default function AppAlertsPage() {
  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-xl font-bold text-white">App Alerts</h1>
        <p className="text-sm text-gray-400 mt-0.5">Health-driven alerts across registered apps</p>
      </div>

      <AlertLogSection />
    </div>
  )
}
