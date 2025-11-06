const DEFAULT_LIST_TIMEOUT_MS = 30_000;
const DEFAULT_CALL_TIMEOUT_MS = 60_000;

// parseTimeout reads timeout values from strings while honoring defaults.
export function parseTimeout(raw: string | undefined, fallback: number): number {
  if (!raw) {
    return fallback;
  }
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return parsed;
}

export const LIST_TIMEOUT_MS = parseTimeout(process.env.MCPORTER_LIST_TIMEOUT, DEFAULT_LIST_TIMEOUT_MS);

// resolveCallTimeout decides the call timeout based on environment overrides.
export function resolveCallTimeout(override?: number): number {
  if (typeof override === 'number' && Number.isFinite(override) && override > 0) {
    return override;
  }
  return parseTimeout(process.env.MCPORTER_CALL_TIMEOUT, DEFAULT_CALL_TIMEOUT_MS);
}

// withTimeout races a promise against a timeout to avoid hangs.
export function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  // Race the original promise with a timeout to keep CLI responsive.
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    return promise;
  }
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error('Timeout'));
    }, timeoutMs);

    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}
