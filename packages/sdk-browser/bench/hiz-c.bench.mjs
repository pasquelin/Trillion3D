// C2 : la pyramide Hi-Z du chemin par image. Référence = `hizDepth.ts:9-22` et le `hizRejectsFlat`
// de `hizOcclusion.ts` d'avant le lot C, recopiés tels quels : une ligne de `number[]` par rangée et
// par niveau, réallouée à chaque image. L'optimisée écrit tous les niveaux dans un seul
// `Float32Array` repris d'une image à l'autre. Les valeurs viennent du visbuffer, déjà en simple
// précision, et la réduction est un maximum : l'égalité attendue est bit à bit, sans tolérance.
import test from 'node:test';
import assert from 'node:assert/strict';
import { hizBuildPyramid, hizFootprintFar, hizOccluded } from '../../sdk-core/index.ts';
import { buildHizPyramid } from '../hizDepth.ts';
import { hizRejects, hizTestRect, HIZ_TEST_VALUES } from '../hizOcclusion.ts';
import { rasterVisibility } from '../visibilityRaster.ts';
import { compareC, deposeC } from './bancC.mjs';
import { graine } from '../../sdk-core/bench/banc.mjs';
import { camera, coupe, rectangles } from './scenes.mjs';

/** `hizDepth.ts:9-17` avant le lot C : une ligne de `number[]` par rangée. */
function referenceRowsOf(depth, width, height) {
  const rows = [];
  for (let y = 0; y < height; y++) {
    const row = new Array(width);
    for (let x = 0; x < width; x++) row[x] = depth[y * width + x];
    rows.push(row);
  }
  return rows;
}
function referenceBuild(depth, width, height) {
  if (width < 1 || height < 1 || depth.length < width * height) throw new Error('HIZ_DEPTH_SIZE');
  return { levels: hizBuildPyramid(referenceRowsOf(depth, width, height)), width, height };
}

const scratchRejet = new Int32Array(HIZ_TEST_VALUES);
/** `hizOcclusion.ts:119-140` avant le lot C : la pyramide lue comme un tableau de tableaux. */
function referenceRejects(pyramid, bounds, bias = 0) {
  if (
    !hizTestRect(
      bounds.minX,
      bounds.minY,
      bounds.maxX,
      bounds.maxY,
      bounds.clipsNear,
      pyramid.width,
      pyramid.height,
      pyramid.levels.length,
      scratchRejet,
    )
  )
    return false;
  const far = hizFootprintFar(
    pyramid.levels,
    scratchRejet[1],
    scratchRejet[2],
    scratchRejet[3] + 1,
    scratchRejet[4] + 1,
    scratchRejet[0],
  );
  return hizOccluded(bounds.nearestDepth, far, bias);
}

/** La profondeur d'une vraie image : fond à 1, triangles dégénérés, sommets derrière la caméra. */
function profondeur(width, height, pages, seed) {
  const depth = rasterVisibility(pages, camera(6, 0.1, width / height), [width, height]).depth;
  const alea = graine(seed);
  // Quelques valeurs hostiles que le visbuffer ne produit pas mais que la pyramide doit traverser.
  for (let i = 0; i < depth.length; i += 4099)
    depth[i] = [NaN, Infinity, -Infinity, -0, 0][Math.floor(alea() * 5)];
  return depth;
}

/** Les boîtes à classer, avec la profondeur de leur coin le plus proche. */
function boites(width, height, seed) {
  const alea = graine(seed);
  return rectangles({ count: 4000, seed, width, height }).map(([x0, y0, x1, y1, clipsNear]) => ({
    minX: x0,
    minY: y0,
    maxX: x1,
    maxY: y1,
    nearestDepth: alea(),
    clipsNear,
  }));
}

function cas(width, height, pages, seed) {
  return {
    width,
    height,
    depth: profondeur(width, height, pages, seed),
    bounds: boites(width, height, seed),
  };
}

/** Une passe : la pyramide puis les verdicts. `complet` ajoute la recopie de toutes les valeurs de
 *  la pyramide, que seule la comparaison bit à bit demande — le chronomètre ne mesure que le
 *  chemin par image, des deux côtés exactement pareil. */
function passeReference(entree) {
  const pyramid = referenceBuild(entree.depth, entree.width, entree.height);
  let niveaux = null;
  if (entree.complet) {
    let total = 0;
    for (const level of pyramid.levels) total += level.length * level[0].length;
    niveaux = new Float64Array(total);
    let at = 0;
    for (const level of pyramid.levels)
      for (const row of level) for (let x = 0; x < row.length; x++) niveaux[at++] = row[x];
  }
  const verdicts = new Uint8Array(entree.bounds.length);
  for (let i = 0; i < entree.bounds.length; i++)
    verdicts[i] = referenceRejects(pyramid, entree.bounds[i]) ? 1 : 0;
  return { niveaux, verdicts };
}

/** La pyramide plate est reprise d'un appel à l'autre : c'est ce que fait le chemin par image. */
const reprise = new Map();
function passeOptimisee(entree) {
  const cle = `${entree.width}x${entree.height}`;
  const pyramid = buildHizPyramid(entree.depth, entree.width, entree.height, reprise.get(cle));
  reprise.set(cle, pyramid);
  let niveaux = null;
  if (entree.complet) {
    let total = 0;
    for (let l = 0; l < pyramid.count; l++) total += pyramid.widths[l] * pyramid.heights[l];
    niveaux = new Float64Array(total);
    for (let i = 0; i < total; i++) niveaux[i] = pyramid.data[i];
  }
  const verdicts = new Uint8Array(entree.bounds.length);
  for (let i = 0; i < entree.bounds.length; i++)
    verdicts[i] = hizRejects(pyramid, entree.bounds[i]) ? 1 : 0;
  return { niveaux, verdicts };
}

const scene = coupe({ pages: 300, triangles: 24, hostile: true, seed: 7 });
const petite = coupe({ pages: 12, triangles: 16, hostile: true, seed: 53, taille: 0.4 });
const image = cas(1280, 720, scene, 101);
const impaire = cas(33, 19, petite, 103);
const unique = cas(1, 1, petite, 107);
/** La même entrée, avec la recopie des niveaux : elle sert à l'égalité, pas au chronomètre. */
const plein = (entree) => ({ ...entree, complet: true });

const lignes = [
  await compareC({
    calcul: 'C2 pyramide Hi-Z',
    fichier: 'packages/sdk-browser/hizDepth.ts',
    cas: [
      { nom: '1280×720, tous les niveaux', entree: plein(image), taille: 921600, mesure: false },
      { nom: '33×19, tous les niveaux', entree: plein(impaire), taille: 627, mesure: false },
      { nom: '1×1, tous les niveaux', entree: plein(unique), taille: 1, mesure: false },
      { nom: '1280×720, 4 000 rectangles', entree: image, taille: 921600 },
      { nom: '33×19, tailles impaires', entree: impaire, taille: 627 },
      { nom: '1×1', entree: unique, taille: 1 },
    ],
    reference: passeReference,
    optimisee: passeOptimisee,
    options: { chauffe: 3, tours: 30, budgetMs: 3000 },
  }),
];

test('C2 a été mesuré et son écart est décrit', () => {
  for (const ligne of lignes) {
    assert.ok(ligne.avantMs > 0, `${ligne.calcul} : aucune mesure`);
    assert.ok(ligne.identique || ligne.ecart, `${ligne.calcul} : écart non décrit`);
  }
});
deposeC('hiz-c', lignes);
