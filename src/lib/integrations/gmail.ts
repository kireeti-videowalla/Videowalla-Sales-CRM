import type { RawEmail } from '../ingestion/email-parser';
import { createLogger } from '../logger';
import { googleApiRequest } from './google-oauth';
import { markIntegrationSync } from './store';

const log = createLogger('gmail');

const BASE = 'https://gmail.googleapis.com/gmail/v1/users/me';

type GmailHeader = { name: string; value: string };
type GmailPart = {
  mimeType?: string;
  filename?: string;
  headers?: GmailHeader[];
  body?: { data?: string; size?: number };
  parts?: GmailPart[];
};
type GmailMessage = {
  id: string;
  threadId: string;
  internalDate?: string;
  labelIds?: string[];
  payload?: GmailPart;
};

function decodeBase64Url(data: string): string {
  return Buffer.from(data.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
}

/** Walks the MIME tree collecting the text/plain and text/html parts. */
function collectBodies(part: GmailPart | undefined, out: { text: string[]; html: string[] }): void {
  if (!part) return;
  const data = part.body?.data;
  if (data && !part.filename) {
    if (part.mimeType === 'text/plain') out.text.push(decodeBase64Url(data));
    else if (part.mimeType === 'text/html') out.html.push(decodeBase64Url(data));
  }
  for (const child of part.parts ?? []) collectBodies(child, out);
}

function headerValue(headers: GmailHeader[] | undefined, name: string): string {
  return headers?.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ?? '';
}

export type GmailLabel = { id: string; name: string; messagesTotal?: number };

export async function listLabels(): Promise<GmailLabel[]> {
  const json = await googleApiRequest<{ labels?: GmailLabel[] }>('GMAIL', `${BASE}/labels`);
  return json.labels ?? [];
}

async function resolveLabelId(labelName: string): Promise<string | null> {
  const labels = await listLabels();
  const match = labels.find((l) => l.name.toLowerCase() === labelName.toLowerCase());
  return match?.id ?? null;
}

export type FetchOptions = {
  label?: string;
  /** Gmail search syntax, e.g. `newer_than:14d`. */
  query?: string;
  maxMessages?: number;
  /** Only return messages received after this instant. */
  since?: Date | null;
};

/**
 * Fetches messages from a Gmail label. Read-only: nothing is marked read,
 * archived, modified or deleted, so the owner's mailbox is untouched.
 */
export async function fetchMessages(options: FetchOptions = {}): Promise<RawEmail[]> {
  const max = Math.min(options.maxMessages ?? 50, 200);

  const queryParts: string[] = [];
  if (options.query) queryParts.push(options.query);
  if (options.since) {
    // Gmail's `after:` takes a unix timestamp in seconds.
    queryParts.push(`after:${Math.floor(options.since.getTime() / 1000)}`);
  }

  const params = new URLSearchParams({ maxResults: String(max) });
  if (queryParts.length) params.set('q', queryParts.join(' '));

  if (options.label) {
    const labelId = await resolveLabelId(options.label);
    if (!labelId) {
      // A missing label is a configuration problem the owner must see, not a
      // silent no-op that looks like "no leads this week".
      throw new Error(`Gmail label "${options.label}" was not found in the connected mailbox.`);
    }
    params.set('labelIds', labelId);
  }

  const list = await googleApiRequest<{ messages?: Array<{ id: string }>; resultSizeEstimate?: number }>(
    'GMAIL',
    `${BASE}/messages?${params.toString()}`,
  );

  const ids = (list.messages ?? []).slice(0, max).map((m) => m.id);
  const emails: RawEmail[] = [];

  for (const id of ids) {
    try {
      const msg = await googleApiRequest<GmailMessage>('GMAIL', `${BASE}/messages/${id}?format=full`);
      const bodies = { text: [] as string[], html: [] as string[] };
      collectBodies(msg.payload, bodies);
      const headers = msg.payload?.headers;

      emails.push({
        messageId: msg.id,
        subject: headerValue(headers, 'Subject'),
        from: headerValue(headers, 'From'),
        receivedAt: msg.internalDate ? new Date(Number(msg.internalDate)) : new Date(),
        textBody: bodies.text.join('\n\n'),
        htmlBody: bodies.html.join('\n') || null,
      });
    } catch (err) {
      // One unreadable message must not abort the whole ingestion run.
      log.warn('failed to fetch gmail message', { id, err: String(err) });
    }
  }

  await markIntegrationSync('GMAIL');
  return emails;
}

export async function testGmailConnection(): Promise<{ ok: boolean; message: string }> {
  try {
    const profile = await googleApiRequest<{ emailAddress?: string; messagesTotal?: number }>(
      'GMAIL',
      `${BASE}/profile`,
    );
    const labels = await listLabels();
    return {
      ok: true,
      message: `Connected to ${profile.emailAddress ?? 'the mailbox'} — ${labels.length} labels visible.`,
    };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
}
