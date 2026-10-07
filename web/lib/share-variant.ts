export function selectShareVariant<T>(
  snapshot: unknown,
  currentVariants: Record<string, unknown> | null | undefined,
  variantName: string,
  isValid: (candidate: unknown) => candidate is T,
): T | null {
  const candidate = snapshot == null ? currentVariants?.[variantName] : snapshot;
  return isValid(candidate) ? candidate : null;
}
