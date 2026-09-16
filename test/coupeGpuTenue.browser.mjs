// Preuve par le moteur réel : une page voulue qui n'est pas encore résidente ne jette pas la
// sélection GPU. Le budget de résidence de la scène est trop petit pour ses feuilles, donc le noyau
// réclame des pages absentes et la coupe monte vers l'ancêtre résident.
//
// Avant le correctif, une telle image levait `GPU_COVERAGE_INCOMPLETE` et la sélection GPU était
// abandonnée pour toute la session : `cpuSelectMs` passait de `null` à une durée sans que l'hôte en
// soit averti. La preuve exige les deux moitiés : la coupe GPU choisit encore (`cpuSelectMs` nul) et
// aucun repli n'a été déclaré (`gpuSelectionFallback` faux).
//
//   node --experimental-strip-types test/coupeGpuTenue.browser.mjs
//   (LAB_ROOT désigne `render-tech-lab` si le dépôt n'est pas son voisin.)
import assert from 'node:assert/strict';
import { preuveDansLaPage, preuveSaine } from './preuvePageMoteur.mjs';

const resultat = await preuveDansLaPage(
  'coupeGpuTenuePage.mjs',
  'coupeGpuTenue',
  'Coupe GPU tenue malgré une page absente',
);
console.log(
  JSON.stringify(
    { adaptateur: resultat.adaptateur ?? null, images: resultat.images, erreurs: resultat.erreurs },
    null,
    2,
  ),
);
preuveSaine(resultat);

const images = resultat.images ?? [];
assert.equal(images.length, 30, 'la preuve mesure trente images après le chargement');
for (const image of images) {
  assert.equal(
    image.cpuSelectMs,
    null,
    `image ${image.i} : la coupe processeur a choisi (${image.cpuSelectMs} ms), ` +
      'la sélection GPU a donc été jetée',
  );
  assert.equal(
    image.gpuSelectionFallback,
    false,
    `image ${image.i} : le moteur déclare un repli sur la coupe processeur`,
  );
  assert.equal(image.uncoveredTriangles, 0, `image ${image.i} : trou dans la couverture`);
  // La preuve ne vaut que si la résidence est bien le goulot : sinon rien n'escalade et elle est
  // vide de sens. Le budget tient moins de pages que le DAG n'en compte.
  assert.ok(image.residentPages <= 2, `image ${image.i} : ${image.residentPages} pages résidentes`);
  assert.ok(image.clusters > 0, `image ${image.i} : coupe vide`);
}
// Le repli n'est pas seulement absent des compteurs : il aurait aussi été annoncé.
assert.ok(
  !(resultat.evenements ?? []).some((e) => e.phase === 'gpu-selection-fallback'),
  JSON.stringify(resultat.evenements),
);
