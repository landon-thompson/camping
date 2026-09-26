import { Link } from 'react-router-dom';
import { Card, PageTitle } from '../../components/ui';
import { ToolsSubNav } from './nav';

export function ToolsIndexPage() {
  return (
    <div className="space-y-4">
      <PageTitle sub="Calculators and checklist templates.">Tools</PageTitle>
      <ToolsSubNav />

      <Link to="/tools/load">
        <Card title="Load & tow">
          <p className="text-ink-2">Payload, roof and trailer weight against the GX550's limits.</p>
        </Card>
      </Link>
      <Link to="/tools/power">
        <Card title="Power">
          <p className="text-ink-2">EcoFlow battery budget for a trip: consumption, solar and drive charging.</p>
        </Card>
      </Link>
      <Link to="/trails">
        <Card title="Routes & pins">
          <p className="text-ink-2">Every imported onX/GPX route and map pin, with the MVUM layer. Import and export GPX here.</p>
        </Card>
      </Link>
      <Link to="/tools/checklists">
        <Card title="Checklists">
          <p className="text-ink-2">Edit the packing checklist templates used on trips.</p>
        </Card>
      </Link>
    </div>
  );
}
