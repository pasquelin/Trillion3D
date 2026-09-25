// Proof by the real engine: a wanted page that is not yet resident does not throw away GPU
// selection. The scene's residency budget is too small for its leaves, so the kernel asks for
// missing pages and the cut climbs to the resident ancestor.
//
// Before the fix, such a frame raised `GPU_COVERAGE_INCOMPLETE` and GPU selection was abandoned
// for the whole session: `cpuSelectMs` went from `null` to a duration without the host being
// told. The proof requires both halves: GPU cut still chooses (`cpuSelectMs` null) and no
// fallback has been declared (`gpuSelectionFallback` false).
//
// No hole (#483 rule 1): on every frame, the cut the engine draws covers each leaf of the strip
// exactly once — a leaf covered by nothing is a hole, one covered twice is overdraw. The check reads
// the drawn cut, not a counter, so it fails on a hole: dropping the `!childResident` term of the
// cut rule (`page/cut/rule.ts`, WGSL) leaves the leaves the budget refuses uncovered.
//
//   node --experimental-strip-types tests/browser/renders/held-gpu-cut.browser.ts
import assert from 'node:assert/strict';
import { coverFault } from '../../../packages/sdk-browser/src/page/cut/cutRule.fixture.ts';
import {
  preuveDansLaPage,
  preuveSaine,
  type ResultatPagePreuve,
} from '../support/enginePageProof.ts';

interface ImageCoupeGpuTenue {
  i: number;
  cpuSelectMs: number | null;
  gpuSelectionFallback: boolean;
  drawn: string[];
  residentPages: number;
  clusters: number;
}

interface Resultat extends ResultatPagePreuve {
  adaptateur?: string;
  pages?: { url: string; units: [number, number] }[];
  images?: ImageCoupeGpuTenue[];
}

const resultat = (await preuveDansLaPage(
  'heldGpuCutPage.ts',
  'coupeGpuTenue',
  'GPU cut held despite a missing page',
)) as Resultat;
console.log(
  JSON.stringify(
    { adaptateur: resultat.adaptateur ?? null, images: resultat.images, erreurs: resultat.erreurs },
    null,
    2,
  ),
);
preuveSaine(resultat);

const images = resultat.images ?? [];
assert.equal(images.length, 30, 'the proof measures thirty frames after load');
const strip = { leaves: 4, pages: resultat.pages ?? [] };
const rankOf = new Map(strip.pages.map((page, rank) => [page.url, rank]));
/** The first leaf the drawn cut covers zero times or twice, or -1. */
const rank = (url: string) => {
  const found = rankOf.get(url);
  if (found === undefined) throw new Error(`drawn page ${url} is not a page of the strip`);
  return found;
};
const hole = (drawn: readonly string[]) => coverFault(strip, drawn.map(rank));
// The check bites: a cut missing one of its pages, or drawing a page with its ancestor, fails it.
const first = images[0]?.drawn ?? [];
assert.ok(first.length > 0, 'the first frame draws a cut');
assert.notEqual(hole(first.slice(1)), -1, 'a missing page must read as a hole');
assert.notEqual(
  hole([...first, 'root']),
  -1,
  'a page drawn with its ancestor must read as overdraw',
);
for (const image of images) {
  assert.equal(
    image.cpuSelectMs,
    null,
    `frame ${image.i}: the CPU cut chose (${image.cpuSelectMs} ms), ` +
      'so GPU selection was thrown away',
  );
  assert.equal(
    image.gpuSelectionFallback,
    false,
    `frame ${image.i}: the engine declares a fallback to the CPU cut`,
  );
  assert.equal(hole(image.drawn), -1, `frame ${image.i}: leaf not covered once by ${image.drawn}`);
  // The proof only holds if residency is the bottleneck: otherwise no ancestor stands in for a
  // missing page and it is empty of meaning. The budget holds fewer pages than the DAG counts.
  assert.ok(image.residentPages <= 2, `frame ${image.i}: ${image.residentPages} resident pages`);
  assert.ok(image.clusters > 0, `frame ${image.i}: empty cut`);
}
// Fallback is not only absent from the counters: it would also have been announced.
assert.ok(
  !(resultat.evenements ?? []).some((e) => e.phase === 'gpu-selection-fallback'),
  JSON.stringify(resultat.evenements),
);
