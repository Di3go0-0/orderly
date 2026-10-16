/**
 * Logger JSON de una sola línea por evento. CloudWatch Logs Insights lo parsea
 * directo: `fields @timestamp, level, msg | filter level = "error"`.
 * Regla OWASP: nunca loguear tokens, contraseñas ni cuerpos completos con PII.
 */
type Level = 'debug' | 'info' | 'warn' | 'error';
const WEIGHT: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

const configured = (process.env.LOG_LEVEL ?? 'info') as Level;
const threshold = WEIGHT[configured] ?? WEIGHT.info;

let baseContext: Record<string, unknown> = {};

function emit(level: Level, msg: string, data?: Record<string, unknown>): void {
  if (WEIGHT[level] < threshold) return;
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    level,
    msg,
    ...baseContext,
    ...(data ?? {}),
  });
  if (level === 'error') console.error(line);
  else console.log(line);
}

export const logger = {
  debug: (msg: string, data?: Record<string, unknown>) => emit('debug', msg, data),
  info: (msg: string, data?: Record<string, unknown>) => emit('info', msg, data),
  warn: (msg: string, data?: Record<string, unknown>) => emit('warn', msg, data),
  error: (msg: string, data?: Record<string, unknown>) => emit('error', msg, data),
  /** Añade campos que saldrán en todas las líneas (p. ej. requestId). */
  setContext(ctx: Record<string, unknown>): void {
    baseContext = { ...baseContext, ...ctx };
  },
  clearContext(): void {
    baseContext = {};
  },
};

export function describeError(err: unknown): Record<string, unknown> {
  if (err instanceof Error) {
    return { errorName: err.name, errorMessage: err.message, stack: err.stack };
  }
  return { errorValue: String(err) };
}
