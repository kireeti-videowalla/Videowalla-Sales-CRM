type Level = 'debug' | 'info' | 'warn' | 'error';

const LEVELS: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const threshold = LEVELS[(process.env.LOG_LEVEL as Level) ?? 'info'] ?? LEVELS.info;

function emit(level: Level, scope: string, message: string, meta?: Record<string, unknown>) {
  if (LEVELS[level] < threshold) return;
  const line = {
    ts: new Date().toISOString(),
    level,
    scope,
    message,
    ...(meta ?? {}),
  };
  const out = level === 'error' || level === 'warn' ? console.error : console.log;
  out(JSON.stringify(line));
}

export function createLogger(scope: string) {
  return {
    debug: (m: string, meta?: Record<string, unknown>) => emit('debug', scope, m, meta),
    info: (m: string, meta?: Record<string, unknown>) => emit('info', scope, m, meta),
    warn: (m: string, meta?: Record<string, unknown>) => emit('warn', scope, m, meta),
    error: (m: string, meta?: Record<string, unknown>) => emit('error', scope, m, meta),
  };
}

export type Logger = ReturnType<typeof createLogger>;

/** Never leak stack traces or provider payloads to the browser. */
export function safeErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  return 'Unexpected error';
}

export function errorDetail(err: unknown): { message: string; stack?: string } {
  if (err instanceof Error) return { message: err.message, stack: err.stack };
  return { message: String(err) };
}
