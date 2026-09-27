import { Link } from 'react-router-dom';
import { useRecord } from '../db/records';
import { Card, PageTitle } from '../components/ui';
import { InstallHint } from '../components/InstallHint';
import { SeasonMap } from '../features/trips/SeasonMap';
import { UpNextCard } from '../features/trips/DashboardCard';

export function Dashboard() {
  const settings = useRecord('settings', 'settings').data;

  return (
    <div className="space-y-4">
      <PageTitle sub={settings ? `${settings.seasonYear} season · home base ${settings.homeBase.name}` : undefined}>
        {settings?.householdName ?? 'Camp Planner'}
      </PageTitle>

      <InstallHint />

      <Card title="Season map" action={<Link to="/trips" className="min-h-11 content-center font-semibold text-brand">All trips</Link>}>
        <SeasonMap className="h-[45vh] min-h-64 w-full" />
      </Card>

      <UpNextCard />
    </div>
  );
}
