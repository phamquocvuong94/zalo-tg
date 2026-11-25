import { inspect } from 'node:util';

const TOKEN_PATTERN = /bot\d{5,}:[A-Za-z0-9_-]{20,}/g;

function currentToken(): string | undefined {
  const token = process.env.TG_TOKEN;
  return token && token.length >= 10 ? token : undefined;
}

/**
 * Strip Telegram bot tokens from text before it is logged or shown to users.
 * Telegram file/API URLs embed the token as `/bot<id>:<secret>/`, and the
 * local Bot API stores files under a directory named after the raw token.
 */
export function redactSecrets(text: string): string {
  let out = text.replace(TOKEN_PATTERN, 'bot<redacted>');
  const token = currentToken();
  if (token) out = out.split(token).join('<redacted>');
  return out;
}

function containsSecret(text: string): boolean {
  TOKEN_PATTERN.lastIndex = 0;
  if (TOKEN_PATTERN.test(text)) return true;
  const token = currentToken();
  return token !== undefined && text.includes(token);
}

/** Error → short, token-free message suitable for logs or chat. */
export function safeErrorMessage(err: unknown): string {
  return redactSecrets(err instanceof Error ? err.message : String(err));
}

/** Copy of an Error with message/stack/cause redacted (drops other props such as Axios `config`). */
function redactError(err: Error): Error {
  const errors = err instanceof AggregateError ? err.errors.map(redactLogArg) : undefined;
  const copy: Error = errors
    ? new AggregateError(errors, redactSecrets(err.message))
    : new Error(redactSecrets(err.message));
  copy.name = err.name;
  if (err.stack) copy.stack = redactSecrets(err.stack);
  if ('cause' in err && err.cause !== undefined) {
    (copy as Error & { cause?: unknown }).cause = redactLogArg(err.cause);
  }
  const code = (err as { code?: unknown }).code;
  if (code !== undefined) (copy as Error & { code?: unknown }).code = code;
  return copy;
}

/**
 * Redact a single console argument while keeping its type whenever possible,
 * so downstream formatters (terminal dashboard / TUI) still see Errors and
 * objects rather than a pre-rendered multi-line dump.
 */
export function redactLogArg(value: unknown): unknown {
  if (typeof value === 'string') return redactSecrets(value);
  if (value === null || (typeof value !== 'object' && typeof value !== 'function')) return value;
  // Console wrappers can be stacked (terminal.ts captures the early wrapper as
  // its native console), so skip objects already checked in this tick.
  if (checkedThisTick().has(value as object)) return value;
  let rendered: string;
  try {
    // Same depth console.log prints by default: anything deeper is never
    // rendered, so it cannot leak — and deep inspection of e.g. AxiosError
    // (request/socket graphs) is expensive.
    rendered = inspect(value, { depth: 2, getters: false, breakLength: Infinity });
  } catch {
    return value;
  }
  if (!containsSecret(rendered)) {
    checkedThisTick().add(value as object);
    return value;
  }
  if (value instanceof Error) return redactError(value);
  return redactSecrets(rendered);
}

let _checked: WeakSet<object> | null = null;
function checkedThisTick(): WeakSet<object> {
  if (!_checked) {
    _checked = new WeakSet();
    queueMicrotask(() => { _checked = null; });
  }
  return _checked;
}

const REDACTING = Symbol('redacting');

/**
 * Wrap console.log/warn/error so every argument is token-redacted.
 * Call again after anything that replaces console methods (e.g. the terminal
 * theme), since such a replacement drops the previous wrapper.
 */
export function installLogRedaction(): void {
  for (const method of ['log', 'warn', 'error'] as const) {
    const current = console[method] as typeof console.log & { [REDACTING]?: true };
    if (current[REDACTING]) continue;
    const orig = current.bind(console);
    const wrapped = (...args: unknown[]) => orig(...args.map(redactLogArg));
    (wrapped as typeof wrapped & { [REDACTING]?: true })[REDACTING] = true;
    console[method] = wrapped;
  }
}
