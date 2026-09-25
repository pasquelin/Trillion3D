// Proof by the real engine: a wanted page that is not yet resident does not throw away GPU
// selection. The scene's residency budget is too small for its leaves, so the kernel asks for
// missing pages and the cut climbs to the resident ancestor.
//
// Before the fix, such a frame raised `GPU_COVERAGE_INCOMPLETE` and GPU selection was abandoned
// for the whole session: `cpuSelectMs` went from `null` to a duration without the host being
// told. The proof requires both halves: GPU cut still chooses (`cpuSelectMs` null) and no
// fallback has been declared (`gpuSelectionFallback` false).
//
//   node --experimental-strip-types tests/browser/renders/held-gpu-cut.browser.ts
import assert from 'node:assert/strict';
import {
  preuveDansLaPage,
  preuveSaine,
  type ResultatPagePreuve,
} from '../support/enginePageProof.ts';

interface ImageCoupeGpuTenue {
  i: number;
  cpuSelectMs: number | null;
  gpuSelectionFallback: boolean;
  uncoveredTriangles: number;
  residentPages: number;
  clusters: number;
}

interface Resultat extends ResultatPagePreuve {
  adaptateur?: string;
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
  assert.equal(image.uncoveredTriangles, 0, `frame ${image.i}: hole in coverage`);
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
