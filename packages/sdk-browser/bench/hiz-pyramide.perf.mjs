// C2 : la pyramide Hi-Z du chemin par image.
import { hizBuildPyramid, hizFootprintFar, hizOccluded } from '../../sdk-core/index.ts';
import { buildHizPyramid } from '../hizDepth.ts';
import { hizRejects, hizTestRect, HIZ_TEST_VALUES } from '../hizOcclusion.ts';
import { rasterVisibility } from '../visibilityRaster.ts';
import { graine, mesure, stress, rapport } from '../../sdk-core/bench/mesure.mjs';
import { camera, coupe, rectangles } from './scenes.mjs';
import { cameraMoteur } from '../cameraFixture.ts';

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

function cas(width, height, pages, seed) {
  const cam = camera(6, 0.1, width / height),
    viewport = [width, height];
  const depth = rasterVisibility(pages, cameraMoteur(cam), viewport).depth;
  const alea = graine(seed),
    bounds = [];
  const count = width >= 1280 ? 4000 : width >= 33 ? 200 : 2;
  const rects = rectangles({ count, seed, width, height });
  for (let i = 0; i < rects.length; i++) {
    const [minX, minY, maxX, maxY, clipsNear] = rects[i];
    bounds.push({ minX, minY, maxX, maxY, clipsNear, nearestDepth: alea() * 0.9 + 0.05 });
  }
  return { depth, width, height, bounds, complet: false };
}

function passeReference(entree) {
  const pyramid = referenceBuild(entree.depth, entree.width, entree.height);
  let niveaux = null;
  if (entree.complet) {
    let total = 0;
    for (const level of pyramid.levels) total += level.length * level[0].length;
    niveaux = new Float64Array(total);
    let at = 0;
    for (const level of pyramid.levels)
      for (let y = 0; y < level.length; y++)
        for (let x = 0; x < level[y].length; x++) niveaux[at++] = level[y][x];
  }
  const verdicts = new Uint8Array(entree.bounds.length);
  for (let i = 0; i < entree.bounds.length; i++)
    verdicts[i] = referenceRejects(pyramid, entree.bounds[i]) ? 1 : 0;
  return { niveaux, verdicts };
}

const reprise = new Map();
function passeOptimisee(entree) {
  const cle = `${entree.width}x${entree.height}`;
  const existante = reprise.get(cle);
  const pyramid = buildHizPyramid(entree.depth, entree.width, entree.height, existante);
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
const plein = (entree) => ({ ...entree, complet: true });

const resHiz = await mesure({
  nom: 'C2 pyramide Hi-Z',
  fichier: 'packages/sdk-browser/hizDepth.ts',
  cas: [
    { nom: '1280×720, tous les niveaux', entree: plein(image), taille: 921600, mesure: false },
    { nom: '33×19, tous les niveaux', entree: plein(impaire), taille: 627, mesure: false },
    { nom: '1×1, tous les niveaux', entree: plein(unique), taille: 1, mesure: false },
    { nom: '1280×720, 4 000 rectangles', entree: image, taille: 921600 },
    { nom: '33×19, tailles impaires', entree: impaire, taille: 627 },
    { nom: '1×1', entree: unique, taille: 1 },
  ],
  calcul: passeOptimisee,
  attendu: passeReference,
  options: { chauffe: 3, tours: 20, budgetMs: 1500 },
});

await stress({
  nom: 'buildHizPyramid extremes',
  calcul: (e) => buildHizPyramid(e.depth, e.width, e.height),
  extremes: [{ nom: '1x1', entree: { depth: new Float32Array(1), width: 1, height: 1 } }],
});

rapport('hiz-c', [resHiz], 'C2 a été mesuré et son écart est décrit');
