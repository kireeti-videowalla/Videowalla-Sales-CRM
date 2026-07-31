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

/**
 * The single most-used control in the product. It is deliberately the largest
 * thing on her screen: one obvious action, no hunting.
 */
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
  // display between renders so the clock visibly moves.
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

  const statusLabel = isActive ? 'On shift' : isPaused ? 'Paused' : 'Not working';
  const statusTone = isActive ? 'bg-good-600' : isPaused ? 'bg-warn-600' : 'bg-ink-300';

  return (
    <div className="overflow-hidden rounded-card border border-hairline bg-white shadow-card">
      <div className="flex flex-wrap items-center justify-between gap-6 px-6 py-7">
        <div>
          <div className="flex items-center gap-2">
            <span className={`h-2 w-2 rounded-full ${statusTone} ${isActive ? 'animate-pulse' : ''}`} />
            <span className="text-[12px] font-medium uppercase tracking-[0.06em] text-ink-500">
              {statusLabel}
            </span>
          </div>
          <div
            className="tnum display-lg mt-2 text-[44px] font-semibold leading-none text-ink-900"
            aria-live="polite"
          >
            {formatDuration(displaySeconds)}
          </div>
          <div className="mt-2 text-[13px] text-ink-500">Active time this shift</div>
        </div>

        <div className="flex flex-wrap gap-2">
          {!isActive && !isPaused && (
            <Button size="lg" disabled={pending} onClick={() => run(startShiftAction)}>
              {pending ? 'Starting…' : 'Start shift'}
            </Button>
          )}
          {isActive && (
            <>
              <Button variant="secondary" size="lg" disabled={pending} onClick={() => setShowPause((v) => !v)}>
                Pause
              </Button>
              <Button variant="secondary" size="lg" disabled={pending} onClick={() => setShowEnd((v) => !v)}>
                End shift
              </Button>
            </>
          )}
          {isPaused && (
            <>
              <Button size="lg" disabled={pending} onClick={() => run(resumeShiftAction)}>
                {pending ? 'Resuming…' : 'Resume'}
              </Button>
              <Button variant="secondary" size="lg" disabled={pending} onClick={() => setShowEnd((v) => !v)}>
                End shift
              </Button>
            </>
          )}
        </div>
      </div>

      {showPause && (
        <form
          className="flex flex-wrap items-end gap-3 border-t border-hairline bg-ink-50 px-6 py-4"
          action={(fd) => run(() => pauseShiftAction({ error: null }, fd))}
        >
          <div className="min-w-[220px] flex-1">
            <label className="block text-[12px] font-medium text-ink-700" htmlFor="pause-reason">
              Reason for the break (optional)
            </label>
            <input
              id="pause-reason"
              name="reason"
              className="mt-1.5 block w-full rounded-control border-0 bg-white px-3.5 py-2.5 text-[13px] ring-1 ring-inset ring-hairline focus:ring-2 focus:ring-brand-500"
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
          className="flex flex-wrap items-end gap-3 border-t border-hairline bg-ink-50 px-6 py-4"
          action={(fd) => run(() => endShiftAction({ error: null }, fd))}
        >
          <div className="min-w-[220px] flex-1">
            <label className="block text-[12px] font-medium text-ink-700" htmlFor="end-note">
              Anything worth noting? (optional)
            </label>
            <input
              id="end-note"
              name="note"
              className="mt-1.5 block w-full rounded-control border-0 bg-white px-3.5 py-2.5 text-[13px] ring-1 ring-inset ring-hairline focus:ring-2 focus:ring-brand-500"
              placeholder="How the shift went"
            />
          </div>
          <Button type="submit" disabled={pending}>
            End shift
          </Button>
        </form>
      )}

      {error && (
        <div className="border-t border-hairline px-6 py-4">
          <Alert tone="bad">{error}</Alert>
        </div>
      )}
      {warnings.length > 0 && (
        <div className="border-t border-hairline px-6 py-4">
          <Alert tone="warn" title="Shift ended, with gaps">
            <ul className="mt-1 list-inside list-disc">
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
