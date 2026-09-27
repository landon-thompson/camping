import { Link } from 'react-router-dom';
import { useRecord, useRecords } from '../../db/records';
import { Card, PageTitle, StatusChip, inputClass } from '../../components/ui';
import { computeLoad } from '../../calc/load';
import type { LimitStatus } from '../../calc/limits';
import type { Gear, LoadProfile, Trailer, Vehicle } from '../../model/schemas';
import { gearForLoad } from './format';
import { ToolsSubNav } from './nav';
import { SpecNumberEditor } from './SpecNumberEditor';
import { useAutoSaveDraft } from './useAutoSaveDraft';

const fmt = (n: number) => Math.round(n).toLocaleString('en-US');

export function LoadToolPage() {
  const vehicle = useRecord('vehicle', 'vehicle:gx550');
  const trailer = useRecord('trailer', 'trailer:boat');
  const profile = useRecord('load_profile', 'load_profile:default');
  const gear = useRecords('gear');

  const ready = vehicle.data && trailer.data && profile.data && !gear.loading;

  return (
    <div className="space-y-4">
      <PageTitle sub="Payload, roof and trailer weight against the GX550's limits.">Load &amp; tow</PageTitle>
      <ToolsSubNav />
      {!ready ? (
        <p className="text-ink-2">Loading…</p>
      ) : (
        <LoadToolView vehicle={vehicle.data!} trailer={trailer.data!} profile={profile.data!} gear={gear.rows.map((g) => ({ ...g.data, id: g.id }))} />
      )}
    </div>
  );
}

function LoadToolView({
  vehicle,
  trailer,
  profile: initialProfile,
  gear,
}: {
  vehicle: Vehicle;
  trailer: Trailer;
  profile: LoadProfile;
  gear: (Gear & { id: string })[];
}) {
  const [profile, setProfile] = useAutoSaveDraft('load_profile', 'load_profile:default', initialProfile);

  const included = gearForLoad(
    gear.map((g) => ({ id: g.id, name: g.name, quantity: g.quantity, weightLb: g.weightLb.value, location: g.location, status: g.status })),
    profile.includeWishlist,
  );
  const nameToId = new Map(included.map((g) => [g.name, g.id]));

  const result = computeLoad({
    payloadLimitLb: vehicle.payloadLb.value,
    roofLimitLb: vehicle.roofLimitLb.value,
    towRatingLb: vehicle.towRatingLb.value,
    towing: profile.towing,
    trailer: {
      scaleTicketLb: trailer.scaleTicketLb.value,
      lowLb: trailer.weightLowLb.value,
      highLb: trailer.weightHighLb.value,
      tonguePctMin: trailer.tonguePctMin,
      tonguePctMax: trailer.tonguePctMax,
    },
    peopleLb: profile.people.map((p) => p.weightLb.value ?? 0),
    waterGal: profile.waterGal,
    extraFuelGal: profile.extraFuelGal,
    otherLb: profile.otherLb,
    gear: included,
  });

  return (
    <>
      <Card title="Gauges">
        <div className="grid grid-cols-3 gap-3">
          <Gauge label="Payload" usedLb={result.payload.usedLb} limitLb={result.payload.limitLb} status={result.payload.status} />
          <Gauge label="Roof" usedLb={result.roof.usedLb} limitLb={result.roof.limitLb} status={result.roof.status} />
          <Gauge
            label="Tow"
            usedLb={result.tow.usedLb}
            limitLb={result.tow.limitLb}
            status={result.tow.status}
            note={profile.towing && result.tow.isEstimate ? 'estimate' : undefined}
          />
        </div>
        {profile.towing && (
          <p className="mt-3 text-sm text-ink-2">
            Tongue weight: {fmt(result.tongue.lowLb)}–{fmt(result.tongue.highLb)} lb (counted against payload, heavy end)
          </p>
        )}
      </Card>

      {result.warnings.length > 0 && (
        <Card title="Warnings">
          <ul className="list-disc space-y-1 pl-5 text-sm text-warn">
            {result.warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </Card>
      )}

      <Card title="Breakdown">
        <dl className="space-y-1 text-sm">
          <Row label="People" value={`${fmt(result.breakdown.peopleLb)} lb`} />
          <Row label="Gear — roof" value={`${fmt(result.breakdown.gearLb.roof)} lb`} />
          <Row label="Gear — cargo" value={`${fmt(result.breakdown.gearLb.cargo)} lb`} />
          <Row label="Gear — cab" value={`${fmt(result.breakdown.gearLb.cab)} lb`} />
          <Row label="Gear — mounted" value={`${fmt(result.breakdown.gearLb.mounted)} lb`} />
          <Row label="Water" value={`${fmt(result.breakdown.waterLb)} lb`} />
          <Row label="Extra fuel" value={`${fmt(result.breakdown.fuelLb)} lb`} />
          <Row label="Other" value={`${fmt(result.breakdown.otherLb)} lb`} />
          {profile.towing && <Row label="Tongue (on the hitch)" value={`${fmt(result.breakdown.tongueLb)} lb`} />}
        </dl>
        {result.missingWeights.length > 0 && (
          <div className="mt-3">
            <p className="text-sm font-semibold text-warn">No weight yet — the real load is higher:</p>
            <ul className="mt-1 list-disc space-y-1 pl-5 text-sm">
              {result.missingWeights.map((name) => (
                <li key={name}>
                  {nameToId.has(name) ? (
                    <Link to={`/gear/${nameToId.get(name)}`} className="text-brand hover:underline">
                      {name}
                    </Link>
                  ) : (
                    name
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}
      </Card>

      <Card title="Trip inputs">
        <div className="space-y-3">
          {profile.people.map((p, i) => (
            <SpecNumberEditor
              key={p.id}
              label={p.label}
              spec={p.weightLb}
              onChange={(s) => {
                const people = [...profile.people];
                people[i] = { ...p, weightLb: s };
                setProfile({ ...profile, people });
              }}
            />
          ))}
          <div className="grid grid-cols-3 gap-3">
            <NumberField label="Water (gal)" value={profile.waterGal} onChange={(v) => setProfile({ ...profile, waterGal: v })} />
            <NumberField label="Extra fuel (gal)" value={profile.extraFuelGal} onChange={(v) => setProfile({ ...profile, extraFuelGal: v })} />
            <NumberField label="Other (lb)" value={profile.otherLb} onChange={(v) => setProfile({ ...profile, otherLb: v })} />
          </div>
          <label className="flex min-h-11 items-center gap-3">
            <input
              type="checkbox"
              className="h-5 w-5"
              checked={profile.towing}
              onChange={(e) => setProfile({ ...profile, towing: e.target.checked })}
            />
            <span>Towing the boat this trip</span>
          </label>
          <label className="flex min-h-11 items-center gap-3">
            <input
              type="checkbox"
              className="h-5 w-5"
              checked={profile.includeWishlist}
              onChange={(e) => setProfile({ ...profile, includeWishlist: e.target.checked })}
            />
            <span>Include wishlist gear (plan for the full setup)</span>
          </label>
        </div>
      </Card>

      <Card title="Limits">
        <ul className="space-y-2 text-sm">
          <li className="flex items-center justify-between">
            <span>Payload ({vehicle.payloadLb.value ?? '—'} lb)</span>
            <StatusChip status={vehicle.payloadLb.status} />
          </li>
          <li className="flex items-center justify-between">
            <span>Roof limit ({vehicle.roofLimitLb.value ?? '—'} lb)</span>
            <StatusChip status={vehicle.roofLimitLb.status} />
          </li>
          <li className="flex items-center justify-between">
            <span>Tow rating ({vehicle.towRatingLb.value ?? '—'} lb)</span>
            <StatusChip status={vehicle.towRatingLb.status} />
          </li>
        </ul>
        <Link to="/settings" className="mt-3 inline-block min-h-11 content-center font-semibold text-brand">
          Edit vehicle &amp; trailer specs in Settings
        </Link>
      </Card>
    </>
  );
}

const statusColor: Record<LimitStatus, string> = {
  ok: 'text-ok',
  near: 'text-warn',
  over: 'text-bad',
  unknown: 'text-ink-2',
};

function Gauge({ label, usedLb, limitLb, status, note }: { label: string; usedLb: number; limitLb: number | null; status: LimitStatus; note?: string }) {
  return (
    <div className="rounded-xl bg-surface-2 p-2 text-center">
      <p className="text-sm text-ink-2">{label}</p>
      <p className={`text-lg font-bold ${statusColor[status]}`}>{fmt(usedLb)}</p>
      <p className="text-xs text-ink-2">of {limitLb === null ? '—' : `${fmt(limitLb)} lb`}</p>
      {note && <p className="text-xs text-ink-2">({note})</p>}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between">
      <dt className="text-ink-2">{label}</dt>
      <dd className="font-semibold">{value}</dd>
    </div>
  );
}

function NumberField({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-semibold text-ink-2">{label}</span>
      <input
        className={inputClass}
        type="number"
        step="any"
        inputMode="decimal"
        min={0}
        value={value}
        onChange={(e) => {
          const n = Number(e.target.value);
          onChange(Number.isFinite(n) ? Math.max(0, n) : 0);
        }}
      />
    </label>
  );
}
