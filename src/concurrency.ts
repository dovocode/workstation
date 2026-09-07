/** Map independent reads with bounded concurrency, preserving input order and draining on failure. */
export async function mapConcurrent<T, U>(items: readonly T[], transform: (item: T) => Promise<U>, limit = 4): Promise<U[]> {
  const results: U[] = new Array(items.length);
  let next = 0;
  let failed = false;
  let failure: unknown;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (!failed && next < items.length) {
      const index = next++;
      try {
        results[index] = await transform(items[index]!);
      } catch (error) {
        failed = true;
        failure = error;
      }
    }
  }));
  if (failed) throw failure;
  return results;
}
