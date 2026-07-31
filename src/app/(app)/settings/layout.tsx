import { requireRole } from '@/lib/auth/session';
import { NavLinks } from '@/components/nav-links';
import { PageHeader } from '@/components/ui';

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
      <PageHeader title="Settings" subtitle={<>Everything the automation uses is editable here. Nothing that matters is hard-coded.</>} />
      <div className="rounded-card border border-hairline bg-white px-3 py-2 shadow-card">
        <NavLinks items={SETTINGS_NAV} />
      </div>
      {children}
    </div>
  );
}
