'use client';

import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useState, useTransition } from 'react';
import { moveTicketQuickAction } from '@/app/actions/tickets';
import { Alert, Badge } from './ui';

export type KanbanCard = {
  id: string;
  reference: string;
  companyName: string;
  headline: string;
  score: number;
  priority: string;
  assigneeName: string | null;
  city: string | null;
  attemptCount: number;
  isCarryover: boolean;
  nextFollowUpAt: string | null;
};

export type KanbanColumn = {
  key: string;
  name: string;
  color: string;
  requiredFields: string[];
  cards: KanbanCard[];
  total: number;
};

/**
 * Drag-and-drop Kanban using the native HTML5 API — no drag library, so the
 * board stays fast and has no dependency to keep current.
 *
 * A stage with required fields cannot be entered by dragging alone; the user is
 * told what is missing and sent to the ticket where the form can collect it.
 */
export function KanbanBoard({ columns, canMove }: { columns: KanbanColumn[]; canMove: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [overColumn, setOverColumn] = useState<string | null>(null);
  const [error, setError] = useState<{ message: string; missing?: string[]; ticketId?: string } | null>(null);

  function handleDrop(stageKey: string) {
    const ticketId = draggingId;
    setDraggingId(null);
    setOverColumn(null);
    if (!ticketId || !canMove) return;

    const column = columns.find((c) => c.key === stageKey);
    if (column?.cards.some((card) => card.id === ticketId)) return;

    setError(null);
    startTransition(async () => {
      const result = await moveTicketQuickAction(ticketId, stageKey);
      if (result.error) {
        setError({ message: result.error, missing: result.missing, ticketId });
      } else {
        router.refresh();
      }
    });
  }

  return (
    <div className="space-y-3">
      {error && (
        <Alert tone="warn" title="This stage needs more information">
          {error.message}
          {error.missing?.length ? (
            <ul className="mt-1 list-inside list-disc">
              {error.missing.map((m) => (
                <li key={m}>{m}</li>
              ))}
            </ul>
          ) : null}
          {error.ticketId && (
            <Link href={`/leads/${error.ticketId}`} className="mt-1 inline-block font-medium underline">
              Open the lead to fill it in
            </Link>
          )}
        </Alert>
      )}

      <div className="flex gap-3 overflow-x-auto pb-4">
        {columns.map((column) => (
          <div
            key={column.key}
            className={`kanban-column flex w-[280px] shrink-0 flex-col rounded-card border border-hairline bg-white/60 ${
              overColumn === column.key ? 'drag-over' : ''
            }`}
            onDragOver={(e) => {
              if (!canMove) return;
              e.preventDefault();
              setOverColumn(column.key);
            }}
            onDragLeave={() => setOverColumn((c) => (c === column.key ? null : c))}
            onDrop={(e) => {
              e.preventDefault();
              handleDrop(column.key);
            }}
          >
            <div className="flex items-center justify-between gap-2 border-b border-hairline px-4 py-3">
              <div className="flex items-center gap-2">
                <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: column.color }} />
                <span className="display text-[13px] font-semibold text-ink-800">{column.name}</span>
              </div>
              <span className="tnum rounded-full bg-ink-100 px-2 py-0.5 text-[11px] text-ink-600">{column.total}</span>
            </div>

            <div className="flex-1 space-y-2 p-2">
              {column.cards.length === 0 && (
                <p className="px-2 py-10 text-center text-[12px] text-ink-400">Empty</p>
              )}

              {column.cards.map((card) => (
                <article
                  key={card.id}
                  draggable={canMove}
                  onDragStart={() => setDraggingId(card.id)}
                  onDragEnd={() => {
                    setDraggingId(null);
                    setOverColumn(null);
                  }}
                  className={`kanban-card rounded-card border border-hairline bg-white p-3.5 shadow-card ${
                    draggingId === card.id ? 'dragging' : ''
                  } ${pending ? 'pointer-events-none opacity-70' : ''}`}
                >
                  <Link href={`/leads/${card.id}`} className="block">
                    <div className="flex items-start justify-between gap-2">
                      <span className="text-[13px] font-medium leading-snug text-ink-900">{card.companyName}</span>
                      <span className="tnum shrink-0 text-[12px] font-semibold text-ink-500">{card.score}</span>
                    </div>
                    <p className="mt-1 line-clamp-2 text-[12px] leading-snug text-ink-500">{card.headline}</p>
                    <div className="mt-2 flex flex-wrap items-center gap-1">
                      {card.priority === 'PRIORITY' && <Badge tone="info">Priority</Badge>}
                      {card.isCarryover && <Badge tone="warn">Carryover</Badge>}
                      {card.attemptCount > 0 && (
                        <Badge tone="neutral">
                          {card.attemptCount} attempt{card.attemptCount === 1 ? '' : 's'}
                        </Badge>
                      )}
                      {card.city && <span className="text-[11px] text-ink-400">{card.city}</span>}
                    </div>
                  </Link>
                </article>
              ))}

              {column.total > column.cards.length && (
                <p className="px-2 py-1 text-center text-xs text-ink-400">
                  +{column.total - column.cards.length} more
                </p>
              )}
            </div>
          </div>
        ))}
      </div>

      {!canMove && (
        <p className="text-xs text-ink-500">You have view-only access, so cards cannot be moved.</p>
      )}
    </div>
  );
}
