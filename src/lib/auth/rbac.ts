import type { UserRole } from '@prisma/client';

/**
 * Permission catalogue. Every server action and route handler checks against
 * this table — the UI hiding a button is never the security boundary.
 */
export const PERMISSIONS = [
  'leads.view.all',
  'leads.view.assigned',
  'leads.assign',
  'leads.move_stage',
  'leads.set_do_not_contact',
  'leads.clear_do_not_contact',
  'notes.create',
  'notes.edit_own',
  'contact.log_attempt',
  'followups.create',
  'followups.complete',
  'meetings.create',
  'shifts.manage_own',
  'shifts.view.all',
  'activity.view.all',
  'activity.view.own',
  'sprints.view.all',
  'sprints.view.own',
  'sprints.approve',
  'sprints.override_targets',
  'reports.view.all',
  'reports.view.own',
  'settings.manage',
  'users.manage',
  'integrations.manage',
  'scoring.manage',
  'sources.manage',
  'jobs.manage',
  'audit.view',
] as const;

export type Permission = (typeof PERMISSIONS)[number];

const OWNER_PERMISSIONS: Permission[] = [...PERMISSIONS];

const SALES_REP_PERMISSIONS: Permission[] = [
  'leads.view.assigned',
  'leads.move_stage',
  'leads.set_do_not_contact',
  'notes.create',
  'notes.edit_own',
  'contact.log_attempt',
  'followups.create',
  'followups.complete',
  'meetings.create',
  'shifts.manage_own',
  'activity.view.own',
  'sprints.view.own',
  'reports.view.own',
];

const MANAGER_PERMISSIONS: Permission[] = [
  'leads.view.all',
  'shifts.view.all',
  'activity.view.all',
  'sprints.view.all',
  'reports.view.all',
];

const ROLE_PERMISSIONS: Record<UserRole, Permission[]> = {
  OWNER: OWNER_PERMISSIONS,
  SALES_REP: SALES_REP_PERMISSIONS,
  MANAGER: MANAGER_PERMISSIONS,
};

export function permissionsFor(role: UserRole): Permission[] {
  return ROLE_PERMISSIONS[role] ?? [];
}

export function can(role: UserRole, permission: Permission): boolean {
  return permissionsFor(role).includes(permission);
}

export function canAny(role: UserRole, permissions: Permission[]): boolean {
  return permissions.some((p) => can(role, p));
}

export const ROLE_LABELS: Record<UserRole, string> = {
  OWNER: 'Owner / Admin',
  SALES_REP: 'Sales representative',
  MANAGER: 'Manager (view only)',
};

/** Landing page per role after sign-in. */
export function defaultRouteFor(role: UserRole): string {
  switch (role) {
    case 'SALES_REP':
      return '/this-week';
    case 'MANAGER':
      return '/overview';
    default:
      return '/overview';
  }
}
