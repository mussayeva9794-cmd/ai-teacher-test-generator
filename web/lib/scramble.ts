// The starting order of an ordering question, shared by the online test and
// the printed sheet. Seeded by the question id: every student and every
// printout get the same order, and it is never the correct one.

export function scrambledOrder(items: string[], seed: string): string[] {
  if (items.length < 2) return [...items];
  let state = [...`${seed}:items`].reduce((hash, char) => Math.imul(hash ^ char.charCodeAt(0), 16777619) >>> 0, 2166136261);
  const next = () => {
    state = Math.imul(state ^ (state >>> 15), 2246822507) >>> 0;
    state = Math.imul(state ^ (state >>> 13), 3266489909) >>> 0;
    return ((state ^ (state >>> 16)) >>> 0) / 4294967296;
  };
  const result = [...items];
  for (let i = result.length - 1; i > 0; i -= 1) {
    const j = Math.floor(next() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  if (result.every((item, i) => item === items[i])) result.push(result.shift()!);
  return result;
}
