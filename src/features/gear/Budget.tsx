import { useEffect, useState, type FormEvent } from 'react';
import { saveRecord, useRecord, useRecords, type Row } from '../../db/records';
import { Button, Card, Field, PageTitle, inputClass } from '../../components/ui';
import { totals, totalsByCategory, type CategoryTotals } from '../../calc/budget';
import type { BudgetCategory, Gear, Settings } from '../../model/schemas';
import { formatUsd } from './format';
import { GearSubNav } from './nav';

export function BudgetPage() {
  const settings = useRecord('settings', 'settings');
  const categories = useRecords('budget_category');
  const gear = useRecords('gear');

  return (
    <div className="space-y-4">
      <PageTitle sub="Season and per-category spending.">Budget</PageTitle>
      <GearSubNav />
      {settings.loading || categories.loading || gear.loading || !settings.data ? (
        <p className="text-ink-2">Loading…</p>
      ) : (
        <BudgetView settings={settings.data} categories={categories.rows} gear={gear.rows} />
      )}
    </div>
  );
}

function BudgetView({
  settings,
  categories,
  gear,
}: {
  settings: Settings;
  categories: Row<BudgetCategory>[];
  gear: Row<Gear>[];
}) {
  const inBudgetItems = gear.map((g) => ({ ...g.data, id: g.id }));
  const seasonBudget = settings.seasonBudgetUsd;
  const overall = totals(inBudgetItems, seasonBudget);
  const categorySum = categories.reduce((a, c) => a + c.data.budgetUsd, 0);
  const catTotals = totalsByCategory(
    inBudgetItems,
    categories.map((c) => ({ id: c.id, budgetUsd: c.data.budgetUsd })),
  );
  const catTotalsById = new Map(catTotals.map((t) => [t.categoryId, t]));
  const sortedCategories = [...categories].sort((a, b) => a.data.order - b.data.order);

  return (
    <>
      <SeasonBudgetCard settings={settings} />

      {categorySum > seasonBudget && (
        <div className="rounded-xl bg-warn-bg p-3 text-sm font-semibold text-warn" role="alert">
          Category budgets add up to {formatUsd(categorySum)}, {formatUsd(categorySum - seasonBudget)} over the season budget.
        </div>
      )}

      <Card title="Season total">
        <dl className="grid grid-cols-2 gap-3 text-center sm:grid-cols-3">
          <Stat label="Spent" value={formatUsd(overall.spent)} />
          <Stat
            label="Planned"
            value={
              overall.planned === overall.plannedLow && overall.plannedLow === overall.plannedHigh
                ? formatUsd(overall.planned)
                : `${formatUsd(overall.plannedLow)}–${formatUsd(overall.plannedHigh)}`
            }
          />
          <Stat label="Remaining" value={formatUsd(overall.remaining)} bad={overall.remaining < 0} />
        </dl>
        {overall.unpriced > 0 && (
          <p className="mt-3 text-sm text-ink-2">{overall.unpriced} wishlist item{overall.unpriced === 1 ? '' : 's'} with no price yet.</p>
        )}
        {overall.optional > 0 && <p className="mt-1 text-sm text-ink-2">Plus {formatUsd(overall.optional)} in optional extras.</p>}
      </Card>

      <Card title="Categories">
        <ul className="divide-y divide-line">
          {sortedCategories.map((c) => {
            const t = catTotalsById.get(c.id);
            if (!t) return null;
            return <CategoryRow key={c.id} id={c.id} data={c.data} totals={t} />;
          })}
        </ul>
      </Card>
    </>
  );
}

function Stat({ label, value, bad }: { label: string; value: string; bad?: boolean }) {
  return (
    <div className="rounded-xl bg-surface-2 p-2">
      <dt className="text-sm text-ink-2">{label}</dt>
      <dd className={`text-lg font-bold ${bad ? 'text-bad' : ''}`}>{value}</dd>
    </div>
  );
}

function SeasonBudgetCard({ settings }: { settings: Settings }) {
  const [draft, setDraft] = useState(String(settings.seasonBudgetUsd));
  const [saved, setSaved] = useState(false);
  useEffect(() => setDraft(String(settings.seasonBudgetUsd)), [settings.seasonBudgetUsd]);
  const dirty = Number(draft) !== settings.seasonBudgetUsd;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const n = Number(draft);
    if (!Number.isFinite(n) || n < 0) return;
    await saveRecord('settings', 'settings', { ...settings, seasonBudgetUsd: n });
    setSaved(true);
  }

  return (
    <Card title="Season gear budget">
      <form className="flex items-end gap-3" onSubmit={(e) => void onSubmit(e)}>
        <Field label="Budget (USD)">
          <input
            className={inputClass}
            type="number"
            inputMode="decimal"
            min={0}
            step={50}
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value);
              setSaved(false);
            }}
          />
        </Field>
        <Button type="submit" disabled={!dirty}>
          Save
        </Button>
        {saved && !dirty && <span className="self-center text-sm text-ok">Saved</span>}
      </form>
    </Card>
  );
}

/** One compact row per category: name, bar, planned-vs-budget; tap to edit that category's budget. */
function CategoryRow({ id, data, totals: t }: { id: string; data: BudgetCategory; totals: CategoryTotals }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(String(data.budgetUsd));
  useEffect(() => setDraft(String(data.budgetUsd)), [data.budgetUsd]);

  const budget = t.budget;
  const committed = t.spent + t.planned;
  const pct = budget > 0 ? Math.min(100, (committed / budget) * 100) : committed > 0 ? 100 : 0;
  const over = committed > budget;

  async function saveBudget() {
    const n = Number(draft);
    if (!Number.isFinite(n) || n < 0) return;
    await saveRecord('budget_category', id, { ...data, budgetUsd: n });
    setEditing(false);
  }

  return (
    <li className="py-2">
      <button
        type="button"
        className="flex min-h-12 w-full items-center gap-3 text-left"
        onClick={() => setEditing((v) => !v)}
        aria-expanded={editing}
      >
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold">{data.name}</p>
          <div className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-surface-2">
            <div className={`h-full ${over ? 'bg-bad' : 'bg-brand'}`} style={{ width: `${pct}%` }} />
          </div>
        </div>
        <div className="shrink-0 text-right">
          <p className={`text-sm font-semibold ${over ? 'text-bad' : ''}`}>
            {formatUsd(committed)} / {formatUsd(budget)}
          </p>
          {t.unpriced > 0 && <p className="text-xs text-ink-2">+{t.unpriced} unpriced</p>}
        </div>
      </button>

      {editing && (
        <div className="mt-2 flex items-end gap-3">
          <Field label={`${data.name} budget (USD)`}>
            <input
              className={inputClass}
              type="number"
              inputMode="decimal"
              min={0}
              step={25}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              autoFocus
            />
          </Field>
          <Button onClick={() => void saveBudget()}>Save</Button>
        </div>
      )}
    </li>
  );
}
