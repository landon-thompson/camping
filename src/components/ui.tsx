import type { ButtonHTMLAttributes, ReactNode } from 'react';
import type { SpecStatus } from '../model/schemas';

export function Card({ title, children, action }: { title?: ReactNode; children: ReactNode; action?: ReactNode }) {
  return (
    <section className="rounded-2xl border border-line bg-surface p-4 shadow-sm">
      {(title || action) && (
        <div className="mb-3 flex items-center justify-between gap-3">
          {title && <h2 className="text-lg font-semibold">{title}</h2>}
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

type Variant = 'primary' | 'secondary' | 'ghost';

export function Button({
  variant = 'primary',
  className = '',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  const styles: Record<Variant, string> = {
    primary: 'bg-brand text-brand-ink',
    secondary: 'border border-line bg-surface-2 text-ink',
    ghost: 'text-brand underline-offset-2 hover:underline',
  };
  return (
    <button
      className={`inline-flex min-h-12 items-center justify-center gap-2 rounded-xl px-4 font-semibold disabled:opacity-50 ${styles[variant]} ${className}`}
      {...props}
    />
  );
}

export function LinkButton({ href, children, variant = 'primary' }: { href: string; children: ReactNode; variant?: Variant }) {
  const styles: Record<Variant, string> = {
    primary: 'bg-brand text-brand-ink',
    secondary: 'border border-line bg-surface-2 text-ink',
    ghost: 'text-brand',
  };
  return (
    <a
      href={href}
      className={`inline-flex min-h-12 items-center justify-center rounded-xl px-4 font-semibold ${styles[variant]}`}
    >
      {children}
    </a>
  );
}

const statusStyle: Record<SpecStatus, string> = {
  verified: 'bg-surface-2 text-ok',
  verify: 'bg-warn-bg text-warn',
  estimate: 'bg-info-bg text-info',
};
const statusLabel: Record<SpecStatus, string> = {
  verified: '✓ verified',
  verify: 'verify',
  estimate: 'estimate',
};

/** Flags numbers that aren't confirmed yet, so nothing unverified looks like fact. */
export function StatusChip({ status }: { status: SpecStatus }) {
  return (
    <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-bold uppercase tracking-wide ${statusStyle[status]}`}>
      {statusLabel[status]}
    </span>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-semibold text-ink-2">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-sm text-ink-2">{hint}</span>}
    </label>
  );
}

export const inputClass =
  'block min-h-12 w-full rounded-xl border border-line bg-surface px-3 text-base text-ink placeholder:text-ink-2/60';

export function PageTitle({ children, sub }: { children: ReactNode; sub?: ReactNode }) {
  return (
    <header className="mb-4">
      <h1 className="text-2xl font-bold">{children}</h1>
      {sub && <p className="mt-1 text-ink-2">{sub}</p>}
    </header>
  );
}
