import Link from 'next/link';
import type { ReactNode } from 'react';

/** Small, dependency-free primitives. Kept plain so the UI stays fast and legible. */

export function Card({
  children,
  className = '',
  title,
  subtitle,
  action,
}: {
  children?: ReactNode;
  className?: string;
  title?: ReactNode;
  subtitle?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <section className={`rounded-xl border border-ink-200 bg-white shadow-sm ${className}`}>
      {(title || action) && (
        <header className="flex items-start justify-between gap-4 border-b border-ink-200 px-5 py-3">
          <div>
            {title && <h2 className="text-sm font-semibold text-ink-900">{title}</h2>}
            {subtitle && <p className="mt-0.5 text-xs text-ink-500">{subtitle}</p>}
          </div>
          {action}
        </header>
      )}
      {children}
    </section>
  );
}

export function Stat({
  label,
  value,
  sub,
  tone = 'default',
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  tone?: 'default' | 'good' | 'warn' | 'bad';
}) {
  const toneClass =
    tone === 'good'
      ? 'text-emerald-600'
      : tone === 'warn'
        ? 'text-amber-600'
        : tone === 'bad'
          ? 'text-red-600'
          : 'text-ink-900';
  return (
    <div className="rounded-xl border border-ink-200 bg-white px-4 py-3 shadow-sm">
      <div className="text-xs font-medium uppercase tracking-wide text-ink-500">{label}</div>
      <div className={`tnum mt-1 text-2xl font-semibold ${toneClass}`}>{value}</div>
      {sub && <div className="mt-0.5 text-xs text-ink-500">{sub}</div>}
    </div>
  );
}

export function Progress({
  value,
  max,
  label,
  showNumbers = true,
}: {
  value: number;
  max: number;
  label?: string;
  showNumbers?: boolean;
}) {
  const pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;
  const tone = pct >= 100 ? 'bg-emerald-500' : pct >= 60 ? 'bg-brand-500' : pct >= 30 ? 'bg-amber-500' : 'bg-red-400';
  return (
    <div>
      {(label || showNumbers) && (
        <div className="mb-1 flex items-baseline justify-between text-xs">
          {label && <span className="font-medium text-ink-700">{label}</span>}
          {showNumbers && (
            <span className="tnum text-ink-500">
              {value} / {max}
            </span>
          )}
        </div>
      )}
      <div
        className="h-2 w-full overflow-hidden rounded-full bg-ink-200"
        role="progressbar"
        aria-valuenow={value}
        aria-valuemin={0}
        aria-valuemax={max}
        aria-label={label ?? 'Progress'}
      >
        <div className={`h-full rounded-full ${tone}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

export function Badge({
  children,
  tone = 'neutral',
  title,
}: {
  children: ReactNode;
  tone?: 'neutral' | 'good' | 'warn' | 'bad' | 'info' | 'estimate';
  title?: string;
}) {
  const tones: Record<string, string> = {
    neutral: 'bg-ink-100 text-ink-700 ring-ink-200',
    good: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
    warn: 'bg-amber-50 text-amber-700 ring-amber-200',
    bad: 'bg-red-50 text-red-700 ring-red-200',
    info: 'bg-blue-50 text-blue-700 ring-blue-200',
    // Deliberately distinct so an estimate never reads as a verified fact.
    estimate: 'bg-violet-50 text-violet-700 ring-violet-200',
  };
  return (
    <span
      title={title}
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${tones[tone]}`}
    >
      {children}
    </span>
  );
}

export function EmptyState({
  title,
  body,
  action,
}: {
  title: string;
  body?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-12 text-center">
      <p className="text-sm font-semibold text-ink-700">{title}</p>
      {body && <p className="max-w-md text-sm text-ink-500">{body}</p>}
      {action}
    </div>
  );
}

export function Button({
  children,
  type = 'button',
  variant = 'primary',
  size = 'md',
  className = '',
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  size?: 'sm' | 'md' | 'lg';
}) {
  const variants: Record<string, string> = {
    primary: 'bg-brand-600 text-white hover:bg-brand-700 disabled:bg-ink-300',
    secondary: 'bg-white text-ink-800 ring-1 ring-inset ring-ink-300 hover:bg-ink-50',
    ghost: 'text-ink-600 hover:bg-ink-100',
    danger: 'bg-red-600 text-white hover:bg-red-700',
  };
  const sizes: Record<string, string> = {
    sm: 'px-2.5 py-1 text-xs',
    md: 'px-3.5 py-2 text-sm',
    lg: 'px-5 py-3 text-base',
  };
  return (
    <button
      type={type}
      className={`inline-flex items-center justify-center gap-1.5 rounded-lg font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${variants[variant]} ${sizes[size]} ${className}`}
      {...rest}
    >
      {children}
    </button>
  );
}

export function LinkButton({
  href,
  children,
  variant = 'secondary',
  size = 'md',
}: {
  href: string;
  children: ReactNode;
  variant?: 'primary' | 'secondary' | 'ghost';
  size?: 'sm' | 'md';
}) {
  const variants: Record<string, string> = {
    primary: 'bg-brand-600 text-white hover:bg-brand-700',
    secondary: 'bg-white text-ink-800 ring-1 ring-inset ring-ink-300 hover:bg-ink-50',
    ghost: 'text-ink-600 hover:bg-ink-100',
  };
  const sizes: Record<string, string> = { sm: 'px-2.5 py-1 text-xs', md: 'px-3.5 py-2 text-sm' };
  return (
    <Link
      href={href}
      className={`inline-flex items-center justify-center gap-1.5 rounded-lg font-medium transition-colors ${variants[variant]} ${sizes[size]}`}
    >
      {children}
    </Link>
  );
}

export function Field({
  label,
  hint,
  children,
  required,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
  required?: boolean;
}) {
  return (
    <label className="block">
      <span className="block text-sm font-medium text-ink-700">
        {label}
        {required && <span className="ml-0.5 text-red-500">*</span>}
      </span>
      {hint && <span className="mt-0.5 block text-xs text-ink-500">{hint}</span>}
      <div className="mt-1">{children}</div>
    </label>
  );
}

export const inputClass =
  'block w-full rounded-lg border-0 px-3 py-2 text-sm text-ink-900 shadow-sm ring-1 ring-inset ring-ink-300 placeholder:text-ink-400 focus:ring-2 focus:ring-inset focus:ring-brand-500';

export function Alert({
  tone = 'info',
  title,
  children,
}: {
  tone?: 'info' | 'warn' | 'bad' | 'good';
  title?: string;
  children: ReactNode;
}) {
  const tones: Record<string, string> = {
    info: 'border-blue-200 bg-blue-50 text-blue-900',
    warn: 'border-amber-200 bg-amber-50 text-amber-900',
    bad: 'border-red-200 bg-red-50 text-red-900',
    good: 'border-emerald-200 bg-emerald-50 text-emerald-900',
  };
  return (
    <div className={`rounded-lg border px-4 py-3 text-sm ${tones[tone]}`} role="status">
      {title && <p className="font-semibold">{title}</p>}
      <div className={title ? 'mt-0.5' : ''}>{children}</div>
    </div>
  );
}

/**
 * Renders an estimated value with its provenance. Used everywhere revenue,
 * headcount or contact details are displayed so an estimate is never mistaken
 * for a verified fact.
 */
export function EstimatedValue({
  value,
  confidence,
  source,
  checkedAt,
  verified,
}: {
  value: ReactNode;
  confidence: string;
  source?: string | null;
  checkedAt?: Date | null;
  verified?: boolean;
}) {
  if (value === null || value === undefined || value === '') {
    return <span className="text-sm text-ink-400">Not available</span>;
  }
  const tone = verified ? 'good' : confidence === 'HIGH' ? 'info' : 'estimate';
  const label = verified ? 'Verified' : `${confidence.charAt(0)}${confidence.slice(1).toLowerCase()} confidence`;
  const tooltip = [
    verified ? 'Verified value' : 'Estimated value — not confirmed',
    source ? `Source: ${source}` : null,
    checkedAt ? `Checked: ${checkedAt.toLocaleDateString('en-CA')}` : null,
  ]
    .filter(Boolean)
    .join('\n');

  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="text-sm text-ink-900">{value}</span>
      <Badge tone={tone} title={tooltip}>
        {label}
      </Badge>
    </span>
  );
}

export function formatMoney(cents: number | bigint | null | undefined, currency = 'CAD'): string {
  if (cents === null || cents === undefined) return '—';
  const value = Number(cents) / 100;
  return new Intl.NumberFormat('en-CA', {
    style: 'currency',
    currency,
    maximumFractionDigits: value >= 1000 ? 0 : 2,
  }).format(value);
}

export function formatPercent(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—';
  return `${Math.round(value * 100)}%`;
}
