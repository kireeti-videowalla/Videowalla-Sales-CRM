import Link from 'next/link';
import type { ReactNode } from 'react';

/**
 * The design system.
 *
 * Principles, applied consistently so the product reads as one thing:
 *  - One accent colour. Everything else is neutral. Colour appears only when it
 *    carries meaning — a threshold crossed, a state that needs attention.
 *  - Hierarchy comes from type weight, size and whitespace, not from boxes,
 *    borders and competing tints.
 *  - Numbers are tabular and large; their labels are small and quiet. The
 *    figure is the content, the label is the caption.
 *  - Hairline borders and soft, shallow shadows. Nothing heavy.
 */

export function Card({
  children,
  className = '',
  title,
  subtitle,
  action,
  flush = false,
}: {
  children?: ReactNode;
  className?: string;
  title?: ReactNode;
  subtitle?: ReactNode;
  action?: ReactNode;
  /** Removes the header's bottom rule for cards whose body supplies its own. */
  flush?: boolean;
}) {
  return (
    <section
      className={`rounded-card border border-hairline bg-white shadow-card ${className}`}
    >
      {(title || action) && (
        <header
          className={`flex items-start justify-between gap-4 px-6 py-4 ${
            flush ? '' : 'border-b border-hairline'
          }`}
        >
          <div className="min-w-0">
            {title && <h2 className="display text-[15px] font-semibold text-ink-900">{title}</h2>}
            {subtitle && <p className="mt-1 text-[13px] leading-relaxed text-ink-500">{subtitle}</p>}
          </div>
          {action && <div className="shrink-0">{action}</div>}
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
      ? 'text-good-600'
      : tone === 'warn'
        ? 'text-warn-600'
        : tone === 'bad'
          ? 'text-bad-600'
          : 'text-ink-900';
  return (
    <div>
      <div className="text-[11px] font-medium uppercase tracking-[0.06em] text-ink-500">{label}</div>
      <div className={`tnum display mt-1.5 text-[26px] font-semibold leading-none ${toneClass}`}>
        {value}
      </div>
      {sub && <div className="mt-1.5 text-[12px] leading-snug text-ink-500">{sub}</div>}
    </div>
  );
}

/** Stat grid with hairline dividers instead of nested boxes. */
export function StatRow({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={`grid divide-y divide-hairline sm:divide-y-0 sm:divide-x [&>*]:px-6 [&>*]:py-5 ${className}`}
    >
      {children}
    </div>
  );
}

export function Progress({
  value,
  max,
  label,
  showNumbers = true,
  size = 'md',
}: {
  value: number;
  max: number;
  label?: string;
  showNumbers?: boolean;
  size?: 'sm' | 'md';
}) {
  const hasTarget = max > 0;
  const pct = hasTarget ? Math.min(100, Math.round((value / max) * 100)) : 0;
  const tone =
    pct >= 100 ? 'bg-good-600' : pct >= 60 ? 'bg-brand-500' : pct >= 30 ? 'bg-warn-600' : 'bg-bad-600';
  return (
    <div>
      {(label || showNumbers) && (
        <div className="mb-2 flex items-baseline justify-between gap-3">
          {label && <span className="truncate text-[13px] font-medium text-ink-700">{label}</span>}
          {showNumbers && (
            <span className="tnum shrink-0 text-[12px] text-ink-500">
              {value}
              {/* No target set is stated plainly rather than shown as "/ 0". */}
              <span className="text-ink-400">{hasTarget ? ` / ${max}` : ' · no target'}</span>
            </span>
          )}
        </div>
      )}
      <div
        className={`w-full overflow-hidden rounded-full bg-ink-200 ${size === 'sm' ? 'h-1' : 'h-1.5'}`}
        role="progressbar"
        aria-valuenow={value}
        aria-valuemin={0}
        aria-valuemax={max}
        aria-label={label ?? 'Progress'}
      >
        <div
          className={`h-full rounded-full transition-[width] duration-500 ease-out ${tone}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

export function Badge({
  children,
  tone = 'neutral',
  title,
  dot = false,
}: {
  children: ReactNode;
  tone?: 'neutral' | 'good' | 'warn' | 'bad' | 'info' | 'estimate';
  title?: string;
  dot?: boolean;
}) {
  const tones: Record<string, string> = {
    neutral: 'bg-ink-100 text-ink-600',
    good: 'bg-good-50 text-good-600',
    warn: 'bg-warn-50 text-warn-600',
    bad: 'bg-bad-50 text-bad-600',
    info: 'bg-brand-50 text-brand-700',
    // Visually distinct so an estimate never reads as a verified fact.
    estimate: 'bg-ink-100 text-ink-500',
  };
  const dots: Record<string, string> = {
    neutral: 'bg-ink-400',
    good: 'bg-good-600',
    warn: 'bg-warn-600',
    bad: 'bg-bad-600',
    info: 'bg-brand-500',
    estimate: 'bg-ink-400',
  };
  return (
    <span
      title={title}
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium leading-none ${tones[tone]}`}
    >
      {dot && <span className={`h-1.5 w-1.5 rounded-full ${dots[tone]}`} />}
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
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-16 text-center">
      <p className="display text-[15px] font-semibold text-ink-800">{title}</p>
      {body && <p className="max-w-md text-[13px] leading-relaxed text-ink-500">{body}</p>}
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}

const BUTTON_BASE =
  'inline-flex items-center justify-center gap-1.5 rounded-full font-medium transition-all duration-150 active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-40 disabled:active:scale-100';

const BUTTON_VARIANTS: Record<string, string> = {
  primary: 'bg-brand-600 text-white hover:bg-brand-700 shadow-sm',
  secondary: 'bg-white text-ink-800 ring-1 ring-inset ring-hairline hover:bg-ink-50 shadow-sm',
  ghost: 'text-ink-600 hover:bg-ink-100',
  danger: 'bg-bad-600 text-white hover:brightness-110 shadow-sm',
};

const BUTTON_SIZES: Record<string, string> = {
  sm: 'px-3 py-1.5 text-[12px]',
  md: 'px-4 py-2 text-[13px]',
  lg: 'px-6 py-3 text-[15px]',
};

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
  return (
    <button
      type={type}
      className={`${BUTTON_BASE} ${BUTTON_VARIANTS[variant]} ${BUTTON_SIZES[size]} ${className}`}
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
  className = '',
}: {
  href: string;
  children: ReactNode;
  variant?: 'primary' | 'secondary' | 'ghost';
  size?: 'sm' | 'md';
  className?: string;
}) {
  return (
    <Link
      href={href}
      className={`${BUTTON_BASE} ${BUTTON_VARIANTS[variant]} ${BUTTON_SIZES[size]} ${className}`}
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
      <span className="block text-[13px] font-medium text-ink-800">
        {label}
        {required && <span className="ml-1 text-bad-600">*</span>}
      </span>
      {hint && <span className="mt-0.5 block text-[12px] leading-snug text-ink-500">{hint}</span>}
      <div className="mt-1.5">{children}</div>
    </label>
  );
}

export const inputClass =
  'block w-full rounded-control border-0 bg-white px-3.5 py-2.5 text-[13px] text-ink-900 shadow-sm ring-1 ring-inset ring-hairline transition-shadow placeholder:text-ink-400 focus:ring-2 focus:ring-inset focus:ring-brand-500';

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
    info: 'bg-brand-50 text-brand-700',
    warn: 'bg-warn-50 text-warn-600',
    bad: 'bg-bad-50 text-bad-600',
    good: 'bg-good-50 text-good-600',
  };
  return (
    <div className={`rounded-control px-4 py-3 text-[13px] leading-relaxed ${tones[tone]}`} role="status">
      {title && <p className="font-semibold">{title}</p>}
      <div className={title ? 'mt-1 opacity-90' : ''}>{children}</div>
    </div>
  );
}

/** Page heading. Used at the top of every screen for a consistent entry point. */
export function PageHeader({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="display-lg text-[28px] font-semibold leading-tight text-ink-900">{title}</h1>
        {subtitle && <p className="mt-1.5 text-[14px] text-ink-500">{subtitle}</p>}
      </div>
      {action && <div className="flex shrink-0 gap-2">{action}</div>}
    </div>
  );
}

/**
 * Renders an estimated value with its provenance, so an estimate is never
 * mistaken for a verified fact.
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
    return <span className="text-[13px] text-ink-400">Not available</span>;
  }
  const tone = verified ? 'good' : confidence === 'HIGH' ? 'info' : 'estimate';
  const label = verified ? 'Verified' : `${confidence.charAt(0)}${confidence.slice(1).toLowerCase()}`;
  const tooltip = [
    verified ? 'Verified value' : 'Estimated — not confirmed',
    source ? `Source: ${source}` : null,
    checkedAt ? `Checked: ${checkedAt.toLocaleDateString('en-CA')}` : null,
  ]
    .filter(Boolean)
    .join('\n');

  return (
    <span className="inline-flex items-center gap-2">
      <span className="text-[13px] text-ink-900">{value}</span>
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
