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
          Category budgets add up to {formatUsd(categorySum)}, which is {formatUsd(categorySum - seasonBudget)} over the season
          budget.
        </div>
      )}

      <Card title="Season total">
        <dl className="grid grid-cols-2 gap-3 text-center sm:grid-cols-3">
          <Stat label="Spent" value={formatUsd(overall.spent)} />
          <Stat label="Planned" value={overall.planned === overall.plannedLow && overall.plannedLow === overall.plannedHigh
            ? formatUsd(overall.planned)
            : `${formatUsd(overall.plannedLow)}–${formatUsd(overall.plannedHigh)}`} />
          <Stat label="Remaining" value={formatUsd(overall.remaining)} bad={overall.remaining < 0} />
        </dl>
        {overall.unpriced > 0 && (
          <p className="mt-3 text-sm text-ink-2">
            {overall.unpriced} wishlist item{overall.unpriced === 1 ? '' : 's'} with no price yet — the plan will cost more than
            shown.
          </p>
        )}
        {overall.optional > 0 && (
          <p className="mt-1 text-sm text-ink-2">Plus {formatUsd(overall.optional)} in optional extras (not counted above).</p>
        )}
      </Card>

      {sortedCategories.map((c) => {
        const t = catTotalsById.get(c.id);
        if (!t) return null;
        return <CategoryCard key={c.id} id={c.id} data={c.data} totals={t} />;
      })}
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

function CategoryCard({ id, data, totals: t }: { id: string; data: BudgetCategory; totals: CategoryTotals }) {
  const [draft, setDraft] = useState(String(data.budgetUsd));
  useEffect(() => setDraft(String(data.budgetUsd)), [data.budgetUsd]);

  async function saveBudget() {
    const n = Number(draft);
    if (!Number.isFinite(n) || n < 0) return;
    await saveRecord('budget_category', id, { ...data, budgetUsd: n });
  }

  const budget = t.budget;
  const spentPct = budget > 0 ? Math.min(100, (t.spent / budget) * 100) : t.spent > 0 ? 100 : 0;
  const plannedPct = budget > 0 ? Math.min(100 - spentPct, (t.planned / budget) * 100) : 0;
  const over = t.spent + t.planned > budget;

  return (
    <Card title={data.name}>
      <div className="flex items-end gap-3">
        <Field label="Category budget (USD)">
          <input
            className={inputClass}
            type="number"
            inputMode="decimal"
            min={0}
            step={25}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={() => void saveBudget()}
          />
        </Field>
      </div>

      <div className="mt-3 flex h-3 w-full overflow-hidden rounded-full bg-surface-2">
        <div className="h-full bg-brand" style={{ width: `${spentPct}%` }} />
        <div className="h-full bg-info" style={{ width: `${plannedPct}%` }} />
      </div>

      <dl className="mt-3 grid grid-cols-3 gap-3 text-center">
        <Stat label="Spent" value={formatUsd(t.spent)} />
        <Stat label="Planned" value={formatUsd(t.planned)} />
        <Stat label="Remaining" value={formatUsd(t.remaining)} bad={over} />
      </dl>
      {over && <p className="mt-2 text-sm font-semibold text-warn">Over this category's budget.</p>}
      {t.unpriced > 0 && (
        <p className="mt-2 text-sm text-ink-2">
          {t.unpriced} item{t.unpriced === 1 ? '' : 's'} with no price yet.
        </p>
      )}
      {t.optional > 0 && <p className="mt-1 text-sm text-ink-2">Plus {formatUsd(t.optional)} optional.</p>}
    </Card>
  );
}
