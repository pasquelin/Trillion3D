// What `pnpm run test:mutation` reports once Stryker is done: the score, the mutants each test file
// kills, the test files that kill none and the source files keeping the most surviving mutants.

/** The fields of a Stryker mutant result the summary reads. */
export type MutantOutcome = {
  fileName: string;
  status: string;
  killedBy?: readonly string[];
  location?: { start: { line: number } };
  mutatorName?: string;
  replacement?: string;
};

export type MutationSummary = {
  /** Detected (killed or timed out) over detected plus undetected (survived or not covered), %. */
  score: number;
  detected: number;
  undetected: number;
  /** Mutants each test file kills, every test file listed, 0 included. */
  kills: Map<string, number>;
  /** Test files that kill no mutant. */
  idle: string[];
  /** Source files by number of surviving or uncovered mutants, most first. */
  survivors: { file: string; count: number; mutants: MutantOutcome[] }[];
};

const DETECTED = new Set(['Killed', 'Timeout']);
const UNDETECTED = new Set(['Survived', 'NoCoverage']);

/** Reads `mutants` against `testFiles`, the test files the run was given. */
export function summarizeMutation(
  mutants: readonly MutantOutcome[],
  testFiles: readonly string[],
): MutationSummary {
  const kills = new Map(testFiles.map((file) => [file, 0]));
  const left = new Map<string, MutantOutcome[]>();
  let detected = 0;
  let undetected = 0;
  for (const mutant of mutants) {
    if (DETECTED.has(mutant.status)) detected++;
    if (UNDETECTED.has(mutant.status)) {
      undetected++;
      const list = left.get(mutant.fileName);
      if (list) list.push(mutant);
      else left.set(mutant.fileName, [mutant]);
    }
    for (const test of new Set(mutant.killedBy ?? [])) kills.set(test, (kills.get(test) ?? 0) + 1);
  }
  const total = detected + undetected;
  return {
    score: total ? (100 * detected) / total : 0,
    detected,
    undetected,
    kills,
    idle: [...kills].filter(([, count]) => count === 0).map(([file]) => file),
    survivors: [...left]
      .map(([file, list]) => ({ file, count: list.length, mutants: list }))
      .sort((a, b) => b.count - a.count || a.file.localeCompare(b.file)),
  };
}

/** The summary as Markdown: score, idle test files, the `top` files with most survivors. */
export function mutationMarkdown(summary: MutationSummary, top = 10): string {
  const lines = [
    `Mutation score: ${summary.score.toFixed(2)} % (${summary.detected} detected, ${summary.undetected} undetected)`,
    '',
    `Test files that kill no mutant: ${summary.idle.length}`,
    ...summary.idle.map((file) => `- ${file}`),
    '',
    `Source files with the most surviving mutants (top ${top}):`,
    '',
    '| File | Surviving |',
    '| --- | --- |',
    ...summary.survivors.slice(0, top).map(({ file, count }) => `| ${file} | ${count} |`),
  ];
  return `${lines.join('\n')}\n`;
}
