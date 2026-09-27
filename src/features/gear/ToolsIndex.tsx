import { Link } from 'react-router-dom';
import { Card, PageTitle } from '../../components/ui';

export function ToolsIndexPage() {
  return (
    <div className="space-y-4">
      <PageTitle sub="Calculators and checklist templates.">Tools</PageTitle>

      <Link to="/tools/load" className="block">
        <Card title="Load & tow">
          <p className="text-ink-2">Payload, roof and trailer weight against the GX550's limits.</p>
        </Card>
      </Link>
      <Link to="/tools/power" className="block">
        <Card title="Power">
          <p className="text-ink-2">EcoFlow battery budget: consumption, solar, drive charging.</p>
        </Card>
      </Link>
      <Link to="/trails" className="block">
        <Card title="Routes & pins">
          <p className="text-ink-2">Imported onX/GPX routes and pins, plus the MVUM layer.</p>
        </Card>
      </Link>
      <Link to="/tools/fishing" className="block">
        <Card title="Fishing">
          <p className="text-ink-2">DNR fish surveys for any Minnesota lake: numbers and size vs similar lakes.</p>
        </Card>
      </Link>
      <Link to="/tools/checklists" className="block">
        <Card title="Checklists">
          <p className="text-ink-2">Edit the packing checklist templates used on trips.</p>
        </Card>
      </Link>
    </div>
  );
}
