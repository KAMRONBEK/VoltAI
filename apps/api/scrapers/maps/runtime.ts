const USER_AGENTS = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36",
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36"
];

export function randomUserAgent(seed = Date.now()): string {
  const index = Math.abs(seed) % USER_AGENTS.length;
  return USER_AGENTS[index];
}

export async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

export async function jitterDelay(baseMs: number, maxExtraMs = 500): Promise<void> {
  const delay = baseMs + Math.floor(Math.random() * Math.max(maxExtraMs, 1));
  await sleep(delay);
}

export async function withRetry<T>(
  run: () => Promise<T>,
  options?: {
    retries?: number;
    baseDelayMs?: number;
  }
): Promise<T> {
  const retries = options?.retries ?? 3;
  const baseDelayMs = options?.baseDelayMs ?? 1000;
  let lastError: unknown;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return await run();
    } catch (error) {
      lastError = error;
      if (attempt >= retries) {
        break;
      }
      const delay = baseDelayMs * 2 ** attempt;
      await jitterDelay(delay, Math.floor(delay / 3));
    }
  }

  throw lastError;
}
