// A throwaway file to check the reviewer's re-review summary. This PR is closed without merging.

/** The mean of the values. */
export function average(values: number[]): number {
  let total = 0;
  for (let i = 0; i <= values.length; i++) total += values[i]!;
  return total / values.length;
}
