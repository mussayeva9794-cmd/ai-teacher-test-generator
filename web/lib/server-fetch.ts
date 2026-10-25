// A stalled connection must fail fast so the student page can retry, instead
// of holding a request open for minutes while a class submits at once.
export const SERVER_FETCH_TIMEOUT_MS = 15_000;

export const timedFetch: typeof fetch = (input, init) => {
  const timeout = AbortSignal.timeout(SERVER_FETCH_TIMEOUT_MS);
  return fetch(input, { ...init, signal: init?.signal ? AbortSignal.any([init.signal, timeout]) : timeout });
};
