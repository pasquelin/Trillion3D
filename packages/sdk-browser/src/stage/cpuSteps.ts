import type { StageAdd } from './profiler.ts';

/**
 * The CPU side of the per-stage profile (`mapping.ts` holds the GPU side, by pass label):
 * deposit a frame's CPU bounds onto their stages. `null` marks a bound that is not deposited: a
 * sum, which would count a second time what its parts already deposited.
 */
export function addCpuSteps(
  stages: ReadonlyArray<string | null>,
  row: ArrayLike<number>,
  add: StageAdd,
) {
  for (let i = 0; i < stages.length; i++) {
    const stage = stages[i];
    if (stage) add(stage, row[i]);
  }
}

/**
 * An ordered declaration of an engine's CPU bounds: for each, the public name and the
 * profile stage it deposits to — `null` for a sum, which is not deposited, or it would
 * count a second time what its parts already deposited. Names, stages and write indices
 * all come from the same table: they can no longer silently misalign.
 */
export function cpuStepTable<Table extends ReadonlyArray<readonly [string, string | null]>>(
  table: Table,
): {
  names: readonly string[];
  stages: ReadonlyArray<string | null>;
  /** Index of a bound in the profile row, read by its name and never written by hand. */
  at: Record<Table[number][0], number>;
} {
  return {
    names: table.map(([name]) => name),
    stages: table.map(([, stage]) => stage),
    // `fromEntries` cannot yield literal keys: the declared name carries them.
    at: Object.fromEntries(table.map(([name], index) => [name, index])) as Record<
      Table[number][0],
      number
    >,
  };
}
