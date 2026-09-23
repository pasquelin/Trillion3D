// Proof by the real engine: the compute raster yields the same image as the hardware raster, to
// the silhouette, whether it takes the whole cut (`raster-calcul`) or small triangles alone
// (`raster-hybride`). Twelve tilted tiles, each two triangles that share a diagonal in two
// distinct clusters, a face-on tile whose 45° diagonal goes through pixel centres, a huge tile
// whose diagonal crosses the image from vertices thousands of pixels off-screen, and a tile that
// crosses the near plane.
//
// The rule: zero pixels outside the silhouette band — no crack between two neighbouring
// triangles, no stray triangle, no triangle neither raster would have taken.
//
//   node --experimental-strip-types tests/browser/renders/watertight-compute-raster.browser.ts
import assert from 'node:assert/strict';
import {
  preuveDansLaPage,
  preuveSaine,
  type ResultatPagePreuve,
} from '../support/enginePageProof.ts';

interface Releve {
  clusters: number;
  interieurs: unknown[];
  silhouettes: number;
}

interface Resultat extends ResultatPagePreuve {
  adaptateur?: string;
  couverts: number;
  clusters: number;
  variantes: Record<string, Releve>;
}

const resultat = (await preuveDansLaPage(
  'computeRasterPage.ts',
  'rasterCalcul',
  'Watertight compute raster',
)) as Resultat;
console.log(
  JSON.stringify(
    {
      adaptateur: resultat.adaptateur ?? null,
      couverts: resultat.couverts,
      clusters: resultat.clusters,
      variantes: resultat.variantes,
      erreurs: resultat.erreurs,
    },
    null,
    2,
  ),
);
preuveSaine(resultat);
assert.ok(resultat.couverts > 1000, `the scene covers only ${resultat.couverts} pixels`);
assert.equal(resultat.clusters, 30);
for (const [variante, releve] of Object.entries(resultat.variantes)) {
  assert.equal(releve.clusters, 30, `${variante}: both engines draw the same cut`);
  assert.deepEqual(
    releve.interieurs,
    [],
    `${variante}: ${releve.interieurs.length} pixel(s) differ outside the silhouette band — crack, stray triangle, or a triangle neither raster took`,
  );
  // The silhouette may differ by one pixel where the two fill rules do not coincide;
  // it cannot differ more than its own perimeter.
  assert.ok(
    releve.silhouettes < resultat.couverts / 8,
    `${variante}: ${releve.silhouettes} silhouette pixels differ of ${resultat.couverts} covered`,
  );
}
const silhouettes = Object.values(resultat.variantes).map((releve) => releve.silhouettes);
console.log(
  `OK: ${resultat.couverts} pixels covered, 0 interior difference under both variants, silhouettes ${silhouettes.join(' / ')} — ${resultat.adaptateur}`,
);
