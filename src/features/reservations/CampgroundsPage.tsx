import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Card, inputClass, PageTitle } from '../../components/ui';
import type { Agency, BookingSystem, Campground } from '../../model/schemas';
import type { Row } from '../../db/records';
import { AGENCY_LABEL, useCampgrounds } from './data';
import { NavButton } from './shared';
import { StateParkImport } from './StateParkImport';

const SYSTEM_LABEL: Record<BookingSystem, string> = {
  reservemn: 'ReserveMN',
  'recreation-gov': 'Recreation.gov',
  'first-come': 'First-come',
  dispersed: 'Dispersed',
  other: 'Other',
};

/** /book/campgrounds — filterable directory, linking to each campground's detail page. */
export function CampgroundsPage() {
  const { loading, rows } = useCampgrounds();
  const [search, setSearch] = useState('');
  const [agency, setAgency] = useState<Agency | ''>('');
  const [system, setSystem] = useState<BookingSystem | ''>('');
  const [electricOnly, setElectricOnly] = useState(false);
  const [boatOnly, setBoatOnly] = useState(false);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows
      .filter((r) => !q || r.data.name.toLowerCase().includes(q) || r.data.unit.toLowerCase().includes(q))
      .filter((r) => !agency || r.data.agency === agency)
      .filter((r) => !system || r.data.bookingSystem === system)
      .filter((r) => !electricOnly || r.data.electric === true)
      .filter((r) => !boatOnly || r.data.boatLaunch === true)
      .sort((a, b) => a.data.name.localeCompare(b.data.name));
  }, [rows, search, agency, system, electricOnly, boatOnly]);

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <PageTitle sub={`${rows.length} campground${rows.length === 1 ? '' : 's'} in the directory`}>Campgrounds</PageTitle>
        <NavButton to="/book/campgrounds/new">Add</NavButton>
      </div>

      <StateParkImport />

      <Card>
        <div className="space-y-3">
          <input
            className={inputClass}
            placeholder="Search by name or unit…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="Search campgrounds"
          />
          <div className="grid grid-cols-2 gap-3">
            <select className={inputClass} value={agency} onChange={(e) => setAgency(e.target.value as Agency | '')} aria-label="Filter by agency">
              <option value="">Any agency</option>
              {(Object.keys(AGENCY_LABEL) as Agency[]).map((a) => (
                <option key={a} value={a}>
                  {AGENCY_LABEL[a]}
                </option>
              ))}
            </select>
            <select className={inputClass} value={system} onChange={(e) => setSystem(e.target.value as BookingSystem | '')} aria-label="Filter by booking system">
              <option value="">Any booking system</option>
              {(Object.keys(SYSTEM_LABEL) as BookingSystem[]).map((s) => (
                <option key={s} value={s}>
                  {SYSTEM_LABEL[s]}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-wrap gap-4">
            <label className="flex min-h-11 items-center gap-2">
              <input type="checkbox" className="h-5 w-5" checked={electricOnly} onChange={(e) => setElectricOnly(e.target.checked)} />
              <span>Electric sites</span>
            </label>
            <label className="flex min-h-11 items-center gap-2">
              <input type="checkbox" className="h-5 w-5" checked={boatOnly} onChange={(e) => setBoatOnly(e.target.checked)} />
              <span>Boat launch</span>
            </label>
          </div>
        </div>
      </Card>

      {loading && <p className="text-ink-2">Loading…</p>}
      {!loading && filtered.length === 0 && <p className="text-ink-2">No campgrounds match those filters.</p>}
      <div className="space-y-3">
        {filtered.map((r) => (
          <CampgroundRow key={r.id} row={r} />
        ))}
      </div>
    </div>
  );
}

function CampgroundRow({ row }: { row: Row<Campground> }) {
  const c = row.data;
  return (
    <Link to={`/book/campgrounds/${encodeURIComponent(row.id)}`} className="block">
      <Card>
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="font-semibold">{c.name}</p>
            <p className="text-sm text-ink-2">
              {c.unit} · {AGENCY_LABEL[c.agency]} · {SYSTEM_LABEL[c.bookingSystem]}
            </p>
            <div className="mt-1 flex flex-wrap gap-2 text-xs text-ink-2">
              {c.electric === true && <span className="rounded-full bg-surface-2 px-2 py-0.5">Electric</span>}
              {c.electric === false && <span className="rounded-full bg-surface-2 px-2 py-0.5">Non-electric</span>}
              {c.boatLaunch === true && <span className="rounded-full bg-surface-2 px-2 py-0.5">Boat launch</span>}
              {c.verify && <span className="rounded-full bg-warn-bg px-2 py-0.5 text-warn">verify</span>}
            </div>
          </div>
        </div>
      </Card>
    </Link>
  );
}
