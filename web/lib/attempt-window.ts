export function attemptWindowExpired(
  startedAt: string,
  timerMinutes: number,
  deadlineAt: string | null,
  now = Date.now(),
): boolean {
  if (deadlineAt) {
    const deadline = Date.parse(deadlineAt);
    if (!Number.isFinite(deadline) || now >= deadline) return true;
  }
  if (timerMinutes <= 0) return false;
  const start = Date.parse(startedAt);
  return !Number.isFinite(start) || now >= start + timerMinutes * 60_000;
}

export function canStartAttempt(deadlineAt: string | null, now = Date.now()): boolean {
  if (!deadlineAt) return true;
  const deadline = Date.parse(deadlineAt);
  return Number.isFinite(deadline) && now < deadline;
}
