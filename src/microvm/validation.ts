/** Validate bounded integer resources consistently across VM providers. */
export function validateVmCapacity(provider: string, limits: readonly (readonly [string, number, number])[]): void {
  for (const [label, value, maximum] of limits) {
    if (!Number.isSafeInteger(value) || value < 1 || value > maximum) throw new Error(`Invalid ${provider} ${label}`);
  }
}
