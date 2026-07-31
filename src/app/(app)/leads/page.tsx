import Link from 'next/link';
import type { Prisma } from '@prisma/client';
import { requireUser } from '@/lib/auth/session';
import { prisma } from '@/lib/db';
import { formatPhone } from '@/lib/normalize';
import { DEFAULT_TIMEZONE, formatInTz } from '@/lib/time';
import { bandLabel } from '@/lib/pipeline/scoring';
import { Badge, Card, EmptyState, LinkButton, inputClass } from '@/components/ui';
import { ManualUrlPanel } from '@/components/leads-panels';

export const dynamic = 'force-dynamic';

const PAGE_SIZE = 40;

export default async function LeadsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const user = await requireUser();
  const tz = user.timezone || DEFAULT_TIMEZONE;
  const params = await searchParams;
  const page = Math.max(1, Number(params.page ?? 1) || 1);

  const [stages, industries, locations, reps] = await Promise.all([
    prisma.pipelineStage.findMany({ where: { isActive: true }, orderBy: { position: 'asc' } }),
    prisma.industry.findMany({ where: { isActive: true }, orderBy: { priority: 'asc' } }),
    prisma.location.findMany({ where: { isActive: true }, orderBy: { priority: 'asc' } }),
    prisma.user.findMany({ where: { role: 'SALES_REP' }, orderBy: { name: 'asc' } }),
  ]);

  const where: Prisma.LeadTicketWhereInput = {
    // A rep can only ever list their own leads, whatever the query string says.
    ...(user.role === 'SALES_REP' ? { assigneeId: user.id } : {}),
    ...(params.stage ? { stage: { key: params.stage } } : {}),
    ...(params.assignee
      ? params.assignee === 'unassigned'
        ? { assigneeId: null }
        : { assigneeId: params.assignee }
      : {}),
    ...(params.minScore ? { score: { gte: Number(params.minScore) || 0 } } : {}),
    ...(params.priority ? { priority: params.priority as never } : {}),
    ...(params.hasPhone === 'yes' ? { company: { normalizedPhone: { not: null } } } : {}),
    ...(params.industry ? { company: { industry: { slug: params.industry } } } : {}),
    ...(params.location ? { company: { location: { slug: params.location } } } : {}),
    ...(params.hiring === 'yes' ? { opportunity: { kind: 'HIRING_INTENT' } } : {}),
    ...(params.dnc === 'yes' ? { company: { doNotContact: true } } : {}),
    ...(params.q
      ? {
          OR: [
            { company: { name: { contains: params.q, mode: 'insensitive' } } },
            { reference: { contains: params.q, mode: 'insensitive' } },
            { opportunity: { headline: { contains: params.q, mode: 'insensitive' } } },
          ],
        }
      : {}),
  };

  const [tickets, total] = await Promise.all([
    prisma.leadTicket.findMany({
      where,
      orderBy: [{ score: 'desc' }, { createdAt: 'desc' }],
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      include: {
        company: { select: { name: true, city: true, phone: true, industryLabel: true, doNotContact: true } },
        opportunity: {
          select: {
            headline: true,
            postingAgeDays: true,
            kind: true,
            sourceRecord: { select: { kind: true } },
          },
        },
        stage: true,
        assignee: { select: { name: true } },
        primaryContact: { select: { fullName: true, phone: true } },
      },
    }),
    prisma.leadTicket.count({ where }),
  ]);

  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-ink-900">Leads</h1>
          <p className="mt-0.5 text-sm text-ink-500">{total} matching lead{total === 1 ? '' : 's'}</p>
        </div>
      </div>

      {/* --- Filters (GET form so they are shareable URLs) --------------- */}
      <Card title="Filters">
        <form className="grid gap-3 p-4 sm:grid-cols-3 lg:grid-cols-5" method="get">
          <label className="block">
            <span className="text-xs font-medium text-ink-700">Search</span>
            <input name="q" defaultValue={params.q ?? ''} className={`${inputClass} mt-1`} placeholder="Company or reference" />
          </label>
          <label className="block">
            <span className="text-xs font-medium text-ink-700">Stage</span>
            <select name="stage" defaultValue={params.stage ?? ''} className={`${inputClass} mt-1`}>
              <option value="">All stages</option>
              {stages.map((s) => (
                <option key={s.key} value={s.key}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="text-xs font-medium text-ink-700">Industry</span>
            <select name="industry" defaultValue={params.industry ?? ''} className={`${inputClass} mt-1`}>
              <option value="">All industries</option>
              {industries.map((i) => (
                <option key={i.slug} value={i.slug}>
                  {i.name}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="text-xs font-medium text-ink-700">Location</span>
            <select name="location" defaultValue={params.location ?? ''} className={`${inputClass} mt-1`}>
              <option value="">All locations</option>
              {locations.map((l) => (
                <option key={l.slug} value={l.slug}>
                  {l.name}
                </option>
              ))}
            </select>
          </label>
          {user.role !== 'SALES_REP' && (
            <label className="block">
              <span className="text-xs font-medium text-ink-700">Assigned to</span>
              <select name="assignee" defaultValue={params.assignee ?? ''} className={`${inputClass} mt-1`}>
                <option value="">Anyone</option>
                <option value="unassigned">Unassigned</option>
                {reps.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label className="block">
            <span className="text-xs font-medium text-ink-700">Minimum score</span>
            <input
              type="number"
              min={0}
              max={100}
              name="minScore"
              defaultValue={params.minScore ?? ''}
              className={`${inputClass} mt-1`}
            />
          </label>
          <label className="block">
            <span className="text-xs font-medium text-ink-700">Contact available</span>
            <select name="hasPhone" defaultValue={params.hasPhone ?? ''} className={`${inputClass} mt-1`}>
              <option value="">Any</option>
              <option value="yes">Has a phone number</option>
            </select>
          </label>
          <label className="block">
            <span className="text-xs font-medium text-ink-700">Opportunity type</span>
            <select name="hiring" defaultValue={params.hiring ?? ''} className={`${inputClass} mt-1`}>
              <option value="">Any</option>
              <option value="yes">Actively hiring</option>
            </select>
          </label>
          <div className="flex items-end gap-2">
            <button type="submit" className="rounded-lg bg-brand-600 px-3.5 py-2 text-sm font-medium text-white hover:bg-brand-700">
              Apply
            </button>
            <Link href="/leads" className="rounded-lg px-3 py-2 text-sm text-ink-600 hover:bg-ink-100">
              Clear
            </Link>
          </div>
        </form>
      </Card>

      {user.role === 'OWNER' && (
        <Card title="Add a lead manually" subtitle="Paste a company or job posting URL and the pipeline will process it.">
          <ManualUrlPanel />
        </Card>
      )}

      <Card>
        {tickets.length === 0 ? (
          <EmptyState title="No leads match these filters" body="Try widening the search or clearing the filters." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] text-sm">
              <thead className="border-b border-ink-200 text-left text-xs uppercase tracking-wide text-ink-500">
                <tr>
                  <th className="px-4 py-2 font-medium">Company</th>
                  <th className="px-4 py-2 font-medium">Opportunity</th>
                  <th className="px-4 py-2 font-medium">Contact</th>
                  <th className="px-4 py-2 font-medium">Stage</th>
                  <th className="px-4 py-2 font-medium">Assigned</th>
                  <th className="px-4 py-2 text-right font-medium">Score</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-200">
                {tickets.map((t) => (
                  <tr key={t.id} className="hover:bg-ink-50">
                    <td className="px-4 py-2">
                      <Link href={`/leads/${t.id}`} className="font-medium text-ink-900 hover:underline">
                        {t.company.name}
                      </Link>
                      <div className="text-xs text-ink-500">
                        {[t.company.city, t.company.industryLabel].filter(Boolean).join(' · ')}
                      </div>
                      {t.company.doNotContact && <Badge tone="bad">Do not contact</Badge>}
                    </td>
                    <td className="max-w-xs px-4 py-2">
                      <div className="truncate text-ink-700">{t.opportunity.headline}</div>
                      <div className="text-xs text-ink-400">
                        {t.opportunity.sourceRecord?.kind.replace(/_/g, ' ').toLowerCase()}
                        {t.opportunity.postingAgeDays !== null && ` · ${t.opportunity.postingAgeDays}d old`}
                      </div>
                    </td>
                    <td className="px-4 py-2">
                      <div className="text-ink-700">{t.primaryContact?.fullName ?? '—'}</div>
                      <div className="tnum text-xs text-ink-500">
                        {formatPhone(t.primaryContact?.phone ?? t.company.phone) || 'No phone'}
                      </div>
                    </td>
                    <td className="px-4 py-2">
                      <span
                        className="inline-flex rounded-full px-2 py-0.5 text-xs font-medium text-white"
                        style={{ backgroundColor: t.stage.color }}
                      >
                        {t.stage.name}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-ink-600">{t.assignee?.name ?? 'Unassigned'}</td>
                    <td className="px-4 py-2 text-right">
                      <div className="tnum font-semibold text-ink-900">{t.score}</div>
                      <div className="text-[11px] text-ink-400">{bandLabel(t.band)}</div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {pages > 1 && (
          <div className="flex items-center justify-between border-t border-ink-200 px-4 py-3 text-sm">
            <span className="text-ink-500">
              Page {page} of {pages}
            </span>
            <div className="flex gap-2">
              {page > 1 && (
                <LinkButton
                  size="sm"
                  href={`/leads?${new URLSearchParams({ ...params, page: String(page - 1) } as Record<string, string>)}`}
                >
                  Previous
                </LinkButton>
              )}
              {page < pages && (
                <LinkButton
                  size="sm"
                  href={`/leads?${new URLSearchParams({ ...params, page: String(page + 1) } as Record<string, string>)}`}
                >
                  Next
                </LinkButton>
              )}
            </div>
          </div>
        )}
      </Card>

      <p className="text-xs text-ink-400">
        Last refreshed {formatInTz(new Date(), tz)}
      </p>
    </div>
  );
}
