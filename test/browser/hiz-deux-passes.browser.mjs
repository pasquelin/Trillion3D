// Proof on the real engine: the two-phase Hi-Z withdraws what the previous image's pyramid
// hides, and a still view under the antialiasing jitter converges to a held image.
//
// A wall and a slab behind it. Seen beside the wall, the slab is drawn and becomes an occluder;
// hidden behind it, its rows are withdrawn from the occluders by the previous pyramid,
// rejected by this image's (`hizRejectedClusters > 0`), and the image is held within the
// limit — which the jitter forbade while a row could trade halves every image. Every held
// image equals a fresh engine's at the same pose, pixel for pixel, temporal antialiasing on.
//
//   node --experimental-strip-types test/browser/hiz-deux-passes.browser.mjs
import assert from 'node:assert/strict';
import { preuveDansLaPage, preuveSaine } from '../appui/preuvePageMoteur.mjs';

const resultat = await preuveDansLaPage('hizDeuxPassesPage.mjs', 'hizDeuxPasses', 'Two-phase Hi-Z');
console.log(
  JSON.stringify(
    { adaptateur: resultat.adaptateur ?? null, etapes: resultat.etapes, erreurs: resultat.erreurs },
    null,
    2,
  ),
);
preuveSaine(resultat);

const [visible, cachee, revenue] = resultat.etapes;
for (const etape of resultat.etapes) {
  assert.ok(etape.images !== null, `at x=${etape.x}, the still view was never held`);
  assert.equal(
    etape.ecart,
    0,
    `at x=${etape.x}, the held image differs from a fresh engine's on ${etape.ecart} pixels`,
  );
  assert.ok(etape.lignes > 0, `at x=${etape.x}, the partition processed no row`);
}
assert.ok(visible.dalle > 0, 'beside the wall, the slab is seen');
assert.equal(cachee.dalle, 0, 'behind the wall, the slab is hidden');
assert.ok(revenue.dalle > 0, 'beside the wall again, the slab is seen again');
// Rows drawn beside the wall, then hidden: only the previous pyramid's withdrawal takes an
// occluder to the tested half — no rank changed page here — and this image's pyramid then
// rejects it. A history that only ever grows would have kept the slab an occluder, drawn behind
// the wall and never tested. The withdrawal itself lasts one image and the counters are sampled
// one image in fifteen: `retires` is reported, the rejection it leads to is what is asserted.
assert.equal(visible.rejetees, 0, 'beside the wall, nothing is hidden and nothing rejected');
assert.ok(cachee.rejetees > 0, 'behind the wall, the rows drawn before were never rejected');
