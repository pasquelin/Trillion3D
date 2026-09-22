// The DAG stalls of the measured cache, in `resume.md`: the primitives the compiler warned about,
// ten per side, ranked by the level-0 triangles they left as roots, with the cause it named.
import type { PrimitiveDagWarning } from '../../packages/sdk-core/index.ts';
import type { Report } from './report/types.ts';

/** Rows per side: the same ten the compiler tells on stderr at the end of a cook. */
const WORST = 10;

/** The `dag-warnings` diagnostic a side recorded, as `pageMesure.ts` keeps it. */
interface DagWarnings {
  primitives?: PrimitiveDagWarning[];
}

/** One section: a table per side, or a line saying the side's cache has no warned primitive. */
export function stalls(report: Report) {
  const lines = [
    '## DAG stalls',
    '',
    'Primitives whose DAG did not rise to one root, as the compiler named them: the cause is a',
    "property of the stalled groups' own vertices, never a threshold.",
    '',
  ];
  for (const side of Object.keys(report.sides)) {
    const recorded = report.series
      .map((serie) => serie.sides[side]?.avertissementsDag as DagWarnings | null | undefined)
      .find((warnings) => warnings?.primitives);
    const worst = [...(recorded?.primitives ?? [])]
      .sort((a, b) => (b.rootTriangles ?? 0) - (a.rootTriangles ?? 0))
      .slice(0, WORST);
    if (!worst.length) {
      lines.push(`- ${side}: no primitive warned`, '');
      continue;
    }
    lines.push(
      `### ${side}`,
      '',
      '| mesh/primitive | level-0 triangles kept as roots | cause | seam | locked | islands |',
      '|---|---|---|---|---|---|',
      ...worst.map(
        (w) =>
          `| ${w.mesh}/${w.primitive} | ${w.rootTriangles ?? '—'} | ${w.cause ?? '—'} ` +
          `| ${w.seamVertices ?? '—'} | ${w.lockedVertices ?? '—'} | ${w.uvIslands ?? '—'} |`,
      ),
      '',
    );
  }
  return lines;
}
