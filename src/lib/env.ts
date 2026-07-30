import { z } from 'zod';

/**
 * Only three variables are genuinely required to boot. Everything else is an
 * integration credential that the owner supplies later through Settings, and
 * whose absence must surface as an honest "not configured" state rather than a
 * crash or a fake success.
 */
const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  SESSION_SECRET: z.string().min(32, 'SESSION_SECRET must be at least 32 characters'),
  ENCRYPTION_KEY: z
    .string()
    .regex(/^[0-9a-fA-F]{64}$/, 'ENCRYPTION_KEY must be 64 hex characters (32 bytes)'),
  APP_URL: z.string().url().default('http://localhost:3000'),
  CRON_SECRET: z.string().optional(),

  // Optional integration credentials. Prefer configuring these in Settings —
  // env vars act as a bootstrap/fallback for deployment environments.
  ANTHROPIC_API_KEY: z.string().optional(),
  ANTHROPIC_MODEL: z.string().default('claude-opus-5'),
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_MODEL: z.string().default('gpt-4o-mini'),
  AI_PROVIDER: z.enum(['anthropic', 'openai', 'rules', 'auto']).default('auto'),

  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  GOOGLE_REDIRECT_URI: z.string().optional(),
  GOOGLE_PLACES_API_KEY: z.string().optional(),

  SMTP_URL: z.string().optional(),
  SMTP_FROM: z.string().optional(),

  WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(20).default(3),
  WORKER_POLL_MS: z.coerce.number().int().min(200).max(60_000).default(2_000),
});

export type Env = z.infer<typeof schema>;

let cached: Env | null = null;

export function getEnv(): Env {
  if (cached) return cached;
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  cached = parsed.data;
  return cached;
}

export const isProduction = () => getEnv().NODE_ENV === 'production';
