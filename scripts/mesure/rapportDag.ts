// The DAG stalls of the measured cache, in `resume.md`: the primitives with a stalled group, ten
// per side, ranked by the level-0 triangles they left as roots, with the cause the compiler named.
import type { PrimitiveDagStall } from '../../packages/sdk-core/index.ts';
import type { Report } from './report/types.ts';

/** Rows per side: the same ten the compiler tells on stderr at the end of a cook. */
const WORST = 10;

/** The `dag-warnings` diagnostic a side recorded, as `pageMesure.ts` keeps it. */
interface DagWarnings {
  stalled?: PrimitiveDagStall[];
}

/** One section: a table per side, or a line saying the side's cache has no stalled primitive. */
export function stalls(report: Report) {
  const lines = [
    '## DAG stalls',
    '',
    'Primitives with a stalled DAG group, as the compiler named them: the cause is decided by',
    'rerunning the stalled reduction with its locks lifted, then with its seams welded, never by',
    'a threshold.',
    '',
  ];
  for (const side of Object.keys(report.sides)) {
    const recorded = report.series
      .map((serie) => serie.sides[side]?.avertissementsDag as DagWarnings | null | undefined)
      .find((warnings) => warnings?.stalled);
    // A stable sort on the cache order, as the compiler's: ties keep the first primitive.
    const worst = [...(recorded?.stalled ?? [])]
      .sort((a, b) => b.rootTriangles - a.rootTriangles)
      .slice(0, WORST);
    if (!worst.length) {
      lines.push(`- ${side}: no primitive stalled`, '');
      continue;
    }
    lines.push(
      `### ${side}`,
      '',
      '| mesh/primitive | level-0 triangles kept as roots | cause | seam | locked | islands |',
      '|---|---|---|---|---|---|',
      ...worst.map(
        (w) =>
          `| ${w.mesh}/${w.primitive} | ${w.rootTriangles} | ${w.cause ?? '—'} ` +
          `| ${w.seamVertices} | ${w.lockedVertices} | ${w.uvIslands} |`,
      ),
      '',
    );
  }
  return lines;
}
