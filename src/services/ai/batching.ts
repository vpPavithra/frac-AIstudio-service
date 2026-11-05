/**
 * Splits items into batches of `size` and runs up to `parallel` batches at once (spec 5.3b, 5.5),
 * keeping the original order in the result. `onBatchDone` fires after each batch with the number of
 * items done so far, for progress and for saving partial results.
 */
export async function runInBatches<T, R>(
  items: T[],
  size: number,
  parallel: number,
  worker: (batch: T[]) => Promise<R[]>,
  onBatchDone: (results: R[], itemsDone: number) => Promise<void>,
): Promise<R[]> {
  const batches: T[][] = [];
  for (let i = 0; i < items.length; i += size) batches.push(items.slice(i, i + size));

  const results: R[][] = new Array(batches.length);
  let next = 0;
  let itemsDone = 0;
  const lane = async () => {
    while (next < batches.length) {
      const index = next++;
      results[index] = await worker(batches[index]);
      itemsDone += batches[index].length;
      await onBatchDone(results[index], itemsDone);
    }
  };
  await Promise.all(Array.from({ length: Math.min(parallel, batches.length) }, lane));
  return results.flat();
}
