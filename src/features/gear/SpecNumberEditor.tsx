import { StatusChip, inputClass } from '../../components/ui';
import type { SpecNumber, SpecStatus } from '../../model/schemas';

export function numOrNull(v: string): number | null {
  if (v.trim() === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Editor for a `SpecNumber`: a value plus how much we trust it. */
export function SpecNumberEditor({
  label,
  spec,
  onChange,
  unit = 'lb',
}: {
  label: string;
  spec: SpecNumber;
  onChange: (s: SpecNumber) => void;
  unit?: string;
}) {
  return (
    <fieldset className="rounded-xl border border-line p-3">
      <legend className="px-1 text-sm font-semibold text-ink-2">
        {label} <StatusChip status={spec.status} />
      </legend>
      <div className="grid grid-cols-2 gap-3">
        <input
          aria-label={`${label} value`}
          className={inputClass}
          inputMode="decimal"
          type="number"
          step="any"
          min={0}
          placeholder={unit}
          value={spec.value ?? ''}
          onChange={(e) => onChange({ ...spec, value: numOrNull(e.target.value) })}
        />
        <select
          aria-label={`${label} confidence`}
          className={inputClass}
          value={spec.status}
          onChange={(e) => onChange({ ...spec, status: e.target.value as SpecStatus })}
        >
          <option value="verified">Verified</option>
          <option value="verify">Needs verifying</option>
          <option value="estimate">Estimate</option>
        </select>
      </div>
      {(spec.note || spec.source) && (
        <p className="mt-2 text-sm text-ink-2">
          {spec.note}
          {spec.source && <span className="block">Source: {spec.source}</span>}
        </p>
      )}
    </fieldset>
  );
}
