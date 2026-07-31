import { requireRole } from '@/lib/auth/session';
import { NavLinks } from '@/components/nav-links';

export const dynamic = 'force-dynamic';

const SETTINGS_NAV = [
  { href: '/settings', label: 'General' },
  { href: '/settings/discovery', label: 'Discovery' },
  { href: '/settings/pipeline', label: 'Kanban & outcomes' },
  { href: '/settings/scoring', label: 'Scoring' },
  { href: '/settings/sprint', label: 'Sprint & shifts' },
  { href: '/settings/followups', label: 'Follow-ups' },
  { href: '/settings/integrations', label: 'Integrations' },
  { href: '/settings/automation', label: 'Automation' },
];

export default async function SettingsLayout({ children }: { children: React.ReactNode }) {
  await requireRole('OWNER');

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold text-ink-900">Settings</h1>
        <p className="mt-0.5 text-sm text-ink-500">
          Everything the automation uses is editable here. Nothing that matters is hard-coded.
        </p>
      </div>
      <div className="rounded-xl border border-ink-200 bg-white px-3 py-2 shadow-sm">
        <NavLinks items={SETTINGS_NAV} />
      </div>
      {children}
    </div>
  );
}
