export type FetchWithTimeoutOptions = RequestInit & {
  fetch?: typeof fetch;
  timeoutMs?: number;
};

export async function fetchWithTimeout(
  input: Parameters<typeof fetch>[0],
  options: FetchWithTimeoutOptions = {}
): Promise<Response> {
  const {
    fetch: fetchImpl = globalThis.fetch,
    timeoutMs = 10_000,
    signal,
    ...init
  } = options;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(new Error(`Safe402 probe timed out after ${timeoutMs}ms.`)), timeoutMs);

  if (signal) {
    if (signal.aborted) {
      controller.abort(signal.reason);
    } else {
      signal.addEventListener("abort", () => controller.abort(signal.reason), { once: true });
    }
  }

  try {
    return await fetchImpl(input, {
      ...init,
      signal: controller.signal
    });
  } finally {
    clearTimeout(timeout);
  }
}
