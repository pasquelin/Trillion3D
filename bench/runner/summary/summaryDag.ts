// The DAG stalls of the measured cache, in `resume.md`: per side, the compiler's stall table
// (`worstStalls`, the ten primitives that kept the most level-0 triangles as roots, with the cause
// it named), as the engine's `dag-warnings` diagnostic carries it, in the compiler's order.
import type { PrimitiveDagStall } from '../../../packages/sdk-core/src/index.ts';
import type { Report } from '../report/types.ts';

/** The `dag-warnings` diagnostic a side recorded, as `measurePage.ts` keeps it. */
interface DagWarnings {
  stalled?: PrimitiveDagStall[];
}

/** One section: a table per side, or a line saying the side's cache has no stalled primitive. */
export function stalls(report: Report) {
  const lines = [
    '## DAG stalls',
    '',
    "The compiler's stall table: the primitives with a stalled DAG group that kept the most",
    'level-0 triangles as roots, in its order. The cause is decided by rerunning the stalled',
    'reduction with its locks lifted, then with its seams welded, never by a threshold.',
    '',
  ];
  for (const side of Object.keys(report.sides)) {
    const recorded = report.series
      .map((serie) => serie.sides[side]?.dagWarnings as DagWarnings | null | undefined)
      .find((warnings) => warnings?.stalled);
    const table = recorded?.stalled ?? [];
    if (!table.length) {
      lines.push(`- ${side}: no stall recorded`, '');
      continue;
    }
    lines.push(
      `### ${side}`,
      '',
      '| mesh/primitive | level-0 triangles kept as roots | cause | seam | locked | islands |',
      '|---|---|---|---|---|---|',
      ...table.map(
        (w) =>
          `| ${w.mesh}/${w.primitive} | ${w.rootTriangles} | ${w.cause ?? '—'} ` +
          `| ${w.seamVertices} | ${w.lockedVertices} | ${w.uvIslands} |`,
      ),
      '',
    );
  }
  return lines;
}
