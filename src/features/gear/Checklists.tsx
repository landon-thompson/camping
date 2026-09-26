import { Link } from 'react-router-dom';
import { useRecords } from '../../db/records';
import { Card, PageTitle } from '../../components/ui';
import { tripKindLabel } from './format';
import { ToolsSubNav } from './nav';

export function ChecklistsPage() {
  const templates = useRecords('checklist_template');
  return (
    <div className="space-y-4">
      <PageTitle sub="The packing lists used on trips.">Checklist templates</PageTitle>
      <ToolsSubNav />
      <Card>
        <ul className="divide-y divide-line">
          {templates.rows.map((t) => (
            <li key={t.id}>
              <Link to={`/tools/checklists/${t.id}`} className="flex min-h-12 items-center justify-between gap-3 py-2">
                <div className="min-w-0">
                  <p className="truncate font-semibold">{t.data.name}</p>
                  <p className="text-sm text-ink-2">
                    {tripKindLabel[t.data.kind]} · {t.data.items.length} item{t.data.items.length === 1 ? '' : 's'}
                  </p>
                </div>
              </Link>
            </li>
          ))}
        </ul>
        {!templates.loading && templates.rows.length === 0 && <p className="text-ink-2">No checklist templates yet.</p>}
      </Card>
    </div>
  );
}
