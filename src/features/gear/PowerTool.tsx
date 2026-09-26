import { useEffect, useState } from 'react';
import { useRecord } from '../../db/records';
import { Button, Card, Field, PageTitle, inputClass } from '../../components/ui';
import { computePower, loadWhPerDay } from '../../calc/power';
import type { PowerLoad, PowerProfile } from '../../model/schemas';
import { ToolsSubNav } from './nav';
import { SpecNumberEditor } from './SpecNumberEditor';
import { useAutoSaveDraft } from './useAutoSaveDraft';

const OUTLET_NOTE =
  "The GX550's cargo 120 V outlet is limited to 400 W and turns off with the car — set the EcoFlow AC charging limit to ~300 W when charging from it.";

let loadIdSeq = 0;
function newLoadId() {
  loadIdSeq += 1;
  return `local-${Date.now()}-${loadIdSeq}`;
}

export function PowerToolPage() {
  const profile = useRecord('power_profile', 'power_profile:default');
  return (
    <div className="space-y-4">
      <PageTitle sub="EcoFlow battery budget for a trip.">Power</PageTitle>
      <ToolsSubNav />
      {profile.loading || !profile.data ? <p className="text-ink-2">Loading…</p> : <PowerToolView initial={profile.data} />}
    </div>
  );
}

function PowerToolView({ initial }: { initial: PowerProfile }) {
  const [profile, setProfile] = useAutoSaveDraft('power_profile', 'power_profile:default', initial);

  const result = computePower({
    batteryWh: profile.batteryWh.value ?? 0,
    usablePct: profile.usablePct.value ?? 0,
    startPct: profile.startPct,
    loads: profile.loads,
    solar: profile.solar,
    driveCharge: profile.driveCharge,
    tripDays: profile.tripDays,
  });

  const driveWarn = profile.driveCharge.watts > 400 ? 'loud' : profile.driveCharge.watts > 300 ? 'warn' : null;

  return (
    <>
      <div className="rounded-xl bg-info-bg p-3 text-sm text-info">{OUTLET_NOTE}</div>

      <Card title="Results">
        <dl className="grid grid-cols-2 gap-3 text-center sm:grid-cols-3">
          <Stat label="Consumption/day" value={`${Math.round(result.consumptionWh)} Wh`} />
          <Stat label="Solar/day" value={`${Math.round(result.solarWh)} Wh`} />
          <Stat label="Net/day" value={`${result.netWh >= 0 ? '+' : ''}${Math.round(result.netWh)} Wh`} bad={result.netWh < 0} />
          <Stat
            label="Days of autonomy"
            value={result.daysOfAutonomy === Infinity ? 'Indefinite' : result.daysOfAutonomy.toFixed(1)}
          />
          <Stat label="End of trip" value={`${Math.round(result.endPct)}%`} bad={result.status !== 'ok'} />
          <Stat label="Flat on day" value={result.flatOnDay === null ? '—' : `Day ${result.flatOnDay}`} bad={result.flatOnDay !== null} />
        </dl>
        {result.status === 'over' && (
          <p className="mt-3 text-sm font-semibold text-bad">The battery runs flat before the trip ends.</p>
        )}
        {result.status === 'near' && (
          <p className="mt-3 text-sm font-semibold text-warn">Cutting it close — under 20% charge left at the end.</p>
        )}
      </Card>

      {driveWarn && (
        <div className={`rounded-xl p-3 text-sm font-semibold ${driveWarn === 'loud' ? 'bg-bad-bg text-bad' : 'bg-warn-bg text-warn'}`} role="alert">
          Drive charging is set to {profile.driveCharge.watts} W
          {driveWarn === 'loud'
            ? ' — well above the 400 W cargo-outlet limit. Double check this is a proper DC-DC charger, not the cargo outlet.'
            : ' — above the ~300 W AC charge limit recommended for the cargo outlet.'}
        </div>
      )}

      <Card title="Battery">
        <div className="space-y-3">
          <Field label="Name">
            <input
              className={inputClass}
              value={profile.batteryName}
              onChange={(e) => setProfile({ ...profile, batteryName: e.target.value })}
            />
          </Field>
          <SpecNumberEditor label="Capacity (Wh)" unit="Wh" spec={profile.batteryWh} onChange={(s) => setProfile({ ...profile, batteryWh: s })} />
          <SpecNumberEditor label="Usable %" unit="%" spec={profile.usablePct} onChange={(s) => setProfile({ ...profile, usablePct: s })} />
          <Field label="Start of trip charge (%)">
            <input
              className={inputClass}
              type="number"
              inputMode="numeric"
              min={0}
              max={100}
              value={profile.startPct}
              onChange={(e) => setProfile({ ...profile, startPct: clamp(Number(e.target.value), 0, 100) })}
            />
          </Field>
          <Field label="Trip length (days)">
            <input
              className={inputClass}
              type="number"
              inputMode="numeric"
              min={1}
              max={30}
              value={profile.tripDays}
              onChange={(e) => setProfile({ ...profile, tripDays: clamp(Math.round(Number(e.target.value)), 1, 30) })}
            />
          </Field>
        </div>
      </Card>

      <Card
        title="Loads"
        action={
          <Button
            type="button"
            variant="secondary"
            onClick={() =>
              setProfile({
                ...profile,
                loads: [...profile.loads, { id: newLoadId(), name: 'New load', enabled: true, whPerDay: 0, watts: null, hoursPerDay: null, note: '' }],
              })
            }
          >
            + Add
          </Button>
        }
      >
        <div className="space-y-3">
          {profile.loads.map((load, i) => (
            <LoadRow
              key={load.id}
              load={load}
              computedWh={loadWhPerDay(load)}
              onChange={(l) => {
                const loads = [...profile.loads];
                loads[i] = l;
                setProfile({ ...profile, loads });
              }}
              onDelete={() => setProfile({ ...profile, loads: profile.loads.filter((_, j) => j !== i) })}
            />
          ))}
          {profile.loads.length === 0 && <p className="text-ink-2">No loads yet.</p>}
        </div>
      </Card>

      <Card title="Solar">
        <div className="space-y-3">
          <label className="flex min-h-11 items-center gap-3">
            <input
              type="checkbox"
              className="h-5 w-5"
              checked={profile.solar.enabled}
              onChange={(e) => setProfile({ ...profile, solar: { ...profile.solar, enabled: e.target.checked } })}
            />
            <span>Solar panel</span>
          </label>
          <div className="grid grid-cols-3 gap-3">
            <Field label="Panel (W)">
              <input
                className={inputClass}
                type="number"
                inputMode="decimal"
                min={0}
                value={profile.solar.panelW}
                onChange={(e) => setProfile({ ...profile, solar: { ...profile.solar, panelW: nonNeg(e.target.value) } })}
              />
            </Field>
            <Field label="Peak sun (h)">
              <input
                className={inputClass}
                type="number"
                inputMode="decimal"
                min={0}
                max={24}
                value={profile.solar.peakSunHours}
                onChange={(e) => setProfile({ ...profile, solar: { ...profile.solar, peakSunHours: clamp(Number(e.target.value) || 0, 0, 24) } })}
              />
            </Field>
            <Field label="Efficiency (%)">
              <input
                className={inputClass}
                type="number"
                inputMode="decimal"
                min={0}
                max={100}
                value={profile.solar.efficiencyPct}
                onChange={(e) => setProfile({ ...profile, solar: { ...profile.solar, efficiencyPct: clamp(Number(e.target.value) || 0, 0, 100) } })}
              />
            </Field>
          </div>
        </div>
      </Card>

      <Card title="Drive charging">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Watts">
            <input
              className={inputClass}
              type="number"
              inputMode="decimal"
              min={0}
              value={profile.driveCharge.watts}
              onChange={(e) => setProfile({ ...profile, driveCharge: { ...profile.driveCharge, watts: nonNeg(e.target.value) } })}
            />
          </Field>
          <Field label="Hours/day">
            <input
              className={inputClass}
              type="number"
              inputMode="decimal"
              min={0}
              max={24}
              value={profile.driveCharge.hoursPerDay}
              onChange={(e) =>
                setProfile({ ...profile, driveCharge: { ...profile.driveCharge, hoursPerDay: clamp(Number(e.target.value) || 0, 0, 24) } })
              }
            />
          </Field>
        </div>
      </Card>
    </>
  );
}

function clamp(n: number, lo: number, hi: number): number {
  if (!Number.isFinite(n)) return lo;
  return Math.min(hi, Math.max(lo, n));
}
function nonNeg(v: string): number {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

function Stat({ label, value, bad }: { label: string; value: string; bad?: boolean }) {
  return (
    <div className="rounded-xl bg-surface-2 p-2">
      <dt className="text-sm text-ink-2">{label}</dt>
      <dd className={`text-lg font-bold ${bad ? 'text-bad' : ''}`}>{value}</dd>
    </div>
  );
}

function LoadRow({
  load,
  computedWh,
  onChange,
  onDelete,
}: {
  load: PowerLoad;
  computedWh: number;
  onChange: (l: PowerLoad) => void;
  onDelete: () => void;
}) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  useEffect(() => {
    if (!confirmDelete) return;
    const t = setTimeout(() => setConfirmDelete(false), 4000);
    return () => clearTimeout(t);
  }, [confirmDelete]);

  const mode: 'daily' | 'wattsHours' = load.whPerDay !== null ? 'daily' : 'wattsHours';

  return (
    <fieldset className="rounded-xl border border-line p-3">
      <div className="mb-2 flex items-center gap-2">
        <input
          type="checkbox"
          className="h-5 w-5"
          aria-label="Enabled"
          checked={load.enabled}
          onChange={(e) => onChange({ ...load, enabled: e.target.checked })}
        />
        <input
          className={`${inputClass} flex-1`}
          aria-label="Load name"
          value={load.name}
          onChange={(e) => onChange({ ...load, name: e.target.value })}
        />
      </div>
      <div className="mb-2 flex items-center gap-3">
        <select
          className={inputClass}
          aria-label="How this load is measured"
          value={mode}
          onChange={(e) =>
            e.target.value === 'daily'
              ? onChange({ ...load, whPerDay: 0, watts: null, hoursPerDay: null })
              : onChange({ ...load, whPerDay: null, watts: 0, hoursPerDay: 0 })
          }
        >
          <option value="daily">Daily total (Wh)</option>
          <option value="wattsHours">Watts × hours/day</option>
        </select>
      </div>
      {mode === 'daily' ? (
        <Field label="Wh/day">
          <input
            className={inputClass}
            type="number"
            inputMode="decimal"
            min={0}
            value={load.whPerDay ?? 0}
            onChange={(e) => onChange({ ...load, whPerDay: nonNeg(e.target.value) })}
          />
        </Field>
      ) : (
        <div className="grid grid-cols-2 gap-3">
          <Field label="Watts">
            <input
              className={inputClass}
              type="number"
              inputMode="decimal"
              min={0}
              value={load.watts ?? 0}
              onChange={(e) => onChange({ ...load, watts: nonNeg(e.target.value) })}
            />
          </Field>
          <Field label="Hours/day">
            <input
              className={inputClass}
              type="number"
              inputMode="decimal"
              min={0}
              max={24}
              value={load.hoursPerDay ?? 0}
              onChange={(e) => onChange({ ...load, hoursPerDay: clamp(Number(e.target.value) || 0, 0, 24) })}
            />
          </Field>
        </div>
      )}
      <p className="mt-2 text-sm text-ink-2">{load.enabled ? `${Math.round(computedWh)} Wh/day` : 'Disabled'}</p>
      {load.note && <p className="text-sm text-ink-2">{load.note}</p>}
      <button
        type="button"
        className={`mt-2 min-h-11 rounded-xl border px-4 text-sm font-semibold ${
          confirmDelete ? 'border-bad bg-bad-bg text-bad' : 'border-line bg-surface-2 text-ink'
        }`}
        onClick={() => (confirmDelete ? onDelete() : setConfirmDelete(true))}
      >
        {confirmDelete ? 'Tap again to delete' : 'Delete'}
      </button>
    </fieldset>
  );
}
