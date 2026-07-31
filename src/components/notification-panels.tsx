'use client';

import { useTransition } from 'react';
import { markAllReadAction } from '@/app/actions/notifications';
import { Button } from './ui';

export function MarkAllReadButton() {
  const [pending, startTransition] = useTransition();
  return (
    <Button
      variant="secondary"
      size="sm"
      disabled={pending}
      onClick={() => startTransition(() => markAllReadAction())}
    >
      {pending ? 'Marking…' : 'Mark all as read'}
    </Button>
  );
}
