'use client';

import { useEffect, useState, useTransition } from 'react';
import { Alert, Button } from './ui';
import {
  endShiftAction,
  pauseShiftAction,
  resumeShiftAction,
  startShiftAction,
} from '@/app/actions/shifts';

function formatDuration(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

export function ShiftControls({
  isActive,
  isPaused,
  activeSeconds,
}: {
  isActive: boolean;
  isPaused: boolean;
  activeSeconds: number;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [showEnd, setShowEnd] = useState(false);
  const [showPause, setShowPause] = useState(false);

  // The authoritative elapsed time lives on the server; this only animates the
  // display between renders so the rep sees the clock move.
  const [ticks, setTicks] = useState(0);
  useEffect(() => {
    if (!isActive) return;
    const id = setInterval(() => setTicks((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, [isActive]);

  const displaySeconds = activeSeconds + (isActive ? ticks : 0);

  const run = (fn: () => Promise<{ error: string | null; warnings?: string[] }>) => {
    setError(null);
    startTransition(async () => {
      const result = await fn();
      setError(result.error);
      setWarnings(result.warnings ?? []);
      if (!result.error) {
        setShowEnd(false);
        setShowPause(false);
      }
    });
  };

  return (
    <div className="rounded-xl border border-ink-200 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="text-xs font-medium uppercase tracking-wide text-ink-500">
            {isActive ? 'Shift running' : isPaused ? 'Shift paused' : 'No shift running'}
          </div>
          <div className="tnum mt-1 text-3xl font-semibold text-ink-900" aria-live="polite">
            {formatDuration(displaySeconds)}
          </div>
          <div className="mt-0.5 text-xs text-ink-500">Active time this shift</div>
        </div>

        <div className="flex flex-wrap gap-2">
          {!isActive && !isPaused && (
            <Button size="lg" disabled={pending} onClick={() => run(startShiftAction)}>
              {pending ? 'Starting…' : 'Start shift'}
            </Button>
          )}
          {isActive && (
            <>
              <Button variant="secondary" disabled={pending} onClick={() => setShowPause((v) => !v)}>
                Pause
              </Button>
              <Button variant="secondary" disabled={pending} onClick={() => setShowEnd((v) => !v)}>
                End shift
              </Button>
            </>
          )}
          {isPaused && (
            <>
              <Button disabled={pending} onClick={() => run(resumeShiftAction)}>
                {pending ? 'Resuming…' : 'Resume'}
              </Button>
              <Button variant="secondary" disabled={pending} onClick={() => setShowEnd((v) => !v)}>
                End shift
              </Button>
            </>
          )}
        </div>
      </div>

      {showPause && (
        <form
          className="mt-4 flex flex-wrap items-end gap-2 border-t border-ink-200 pt-4"
          action={(fd) => run(() => pauseShiftAction({ error: null }, fd))}
        >
          <div className="min-w-[220px] flex-1">
            <label className="block text-xs font-medium text-ink-700" htmlFor="pause-reason">
              Reason for the break (optional)
            </label>
            <input
              id="pause-reason"
              name="reason"
              className="mt-1 block w-full rounded-lg border-0 px-3 py-2 text-sm ring-1 ring-inset ring-ink-300 focus:ring-2 focus:ring-brand-500"
              placeholder="Lunch, meeting, interruption…"
            />
          </div>
          <Button type="submit" variant="secondary" disabled={pending}>
            Pause shift
          </Button>
        </form>
      )}

      {showEnd && (
        <form
          className="mt-4 flex flex-wrap items-end gap-2 border-t border-ink-200 pt-4"
          action={(fd) => run(() => endShiftAction({ error: null }, fd))}
        >
          <div className="min-w-[220px] flex-1">
            <label className="block text-xs font-medium text-ink-700" htmlFor="end-note">
              End-of-shift note (optional)
            </label>
            <input
              id="end-note"
              name="note"
              className="mt-1 block w-full rounded-lg border-0 px-3 py-2 text-sm ring-1 ring-inset ring-ink-300 focus:ring-2 focus:ring-brand-500"
              placeholder="Anything the owner should know"
            />
          </div>
          <Button type="submit" disabled={pending}>
            End shift
          </Button>
        </form>
      )}

      {error && (
        <div className="mt-3">
          <Alert tone="bad">{error}</Alert>
        </div>
      )}
      {warnings.length > 0 && (
        <div className="mt-3">
          <Alert tone="warn" title="Shift ended, with gaps">
            <ul className="list-inside list-disc">
              {warnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          </Alert>
        </div>
      )}
    </div>
  );
}
