// the Hi-Z pyramid of the per-frame path.
import {
  hizBuildPyramid,
  hizFootprintFar,
  hizOccluded,
} from '../../../packages/sdk-core/src/index.ts';
import { buildHizPyramid } from '../../../packages/sdk-browser/hizDepth.ts';
import {
  hizRejects,
  hizTestRect,
  HIZ_TEST_VALUES,
} from '../../../packages/sdk-browser/hizOcclusion.ts';
import { rasterVisibility } from '../../../packages/sdk-browser/visibilityRaster.ts';
import type { HizBounds, HizPyramid } from '../../../packages/sdk-browser/hizTypes.ts';
import type { ScenePage } from './support/scenes.ts';
import { graine, mesure, stress, rapport } from '../../core/index.ts';
import { camera, coupe, rectangles } from './support/scenes.ts';
import { cameraMoteur } from '../../../packages/sdk-browser/cameraFixture.ts';

function referenceRowsOf(depth: Float32Array, width: number, height: number): number[][] {
  const rows: number[][] = [];
  for (let y = 0; y < height; y++) {
    const row = new Array<number>(width);
    for (let x = 0; x < width; x++) row[x] = depth[y * width + x];
    rows.push(row);
  }
  return rows;
}
function referenceBuild(depth: Float32Array, width: number, height: number) {
  if (width < 1 || height < 1 || depth.length < width * height) throw new Error('HIZ_DEPTH_SIZE');
  return { levels: hizBuildPyramid(referenceRowsOf(depth, width, height)), width, height };
}
type ReferencePyramid = ReturnType<typeof referenceBuild>;

const scratchRejet = new Int32Array(HIZ_TEST_VALUES);
function referenceRejects(pyramid: ReferencePyramid, bounds: HizBounds, bias = 0) {
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

interface Entree {
  depth: Float32Array;
  width: number;
  height: number;
  bounds: HizBounds[];
  complet: boolean;
}

function cas(width: number, height: number, pages: ScenePage[], seed: number): Entree {
  const cam = camera(6, 0.1, width / height),
    viewport: [number, number] = [width, height];
  const depth = rasterVisibility(pages, cameraMoteur(cam), viewport).depth;
  const alea = graine(seed),
    bounds: HizBounds[] = [];
  const count = width >= 1280 ? 4000 : width >= 33 ? 200 : 2;
  const rects = rectangles({ count, seed, width, height });
  for (let i = 0; i < rects.length; i++) {
    const [minX, minY, maxX, maxY, clipsNear] = rects[i];
    bounds.push({ minX, minY, maxX, maxY, clipsNear, nearestDepth: alea() * 0.9 + 0.05 });
  }
  return { depth, width, height, bounds, complet: false };
}

function passeReference(input: Entree) {
  const pyramid = referenceBuild(input.depth, input.width, input.height);
  let niveaux: Float64Array | null = null;
  if (input.complet) {
    let total = 0;
    for (const level of pyramid.levels) total += level.length * level[0].length;
    niveaux = new Float64Array(total);
    let at = 0;
    for (const level of pyramid.levels)
      for (let y = 0; y < level.length; y++)
        for (let x = 0; x < level[y].length; x++) niveaux[at++] = level[y][x];
  }
  const verdicts = new Uint8Array(input.bounds.length);
  for (let i = 0; i < input.bounds.length; i++)
    verdicts[i] = referenceRejects(pyramid, input.bounds[i]) ? 1 : 0;
  return { niveaux, verdicts };
}

const reprise = new Map<string, HizPyramid>();
function passeOptimisee(input: Entree) {
  const cle = `${input.width}x${input.height}`;
  const existante = reprise.get(cle);
  const pyramid = buildHizPyramid(input.depth, input.width, input.height, existante);
  reprise.set(cle, pyramid);
  let niveaux: Float64Array | null = null;
  if (input.complet) {
    let total = 0;
    for (let l = 0; l < pyramid.count; l++) total += pyramid.widths[l] * pyramid.heights[l];
    niveaux = new Float64Array(total);
    for (let i = 0; i < total; i++) niveaux[i] = pyramid.data[i];
  }
  const verdicts = new Uint8Array(input.bounds.length);
  for (let i = 0; i < input.bounds.length; i++)
    verdicts[i] = hizRejects(pyramid, input.bounds[i]) ? 1 : 0;
  return { niveaux, verdicts };
}

const scene = coupe({ pages: 300, triangles: 24, hostile: true, seed: 7 });
const petite = coupe({ pages: 12, triangles: 16, hostile: true, seed: 53, size: 0.4 });
const image = cas(1280, 720, scene, 101);
const impaire = cas(33, 19, petite, 103);
const unique = cas(1, 1, petite, 107);
const plein = (input: Entree): Entree => ({ ...input, complet: true });

const resHiz = await mesure({
  name: 'Hi-Z pyramid',
  fichier: 'packages/sdk-browser/hizDepth.ts',
  cas: [
    { name: '1280×720, every level', input: plein(image), size: 921600, mesure: false },
    { name: '33×19, every level', input: plein(impaire), size: 627, mesure: false },
    { name: '1×1, every level', input: plein(unique), size: 1, mesure: false },
    { name: '1280×720, 4 000 rectangles', input: image, size: 921600 },
    { name: '33×19, odd sizes', input: impaire, size: 627 },
    { name: '1×1', input: unique, size: 1 },
  ],
  calcul: passeOptimisee,
  attendu: passeReference,
  options: { chauffe: 3, tours: 20, budgetMs: 1500 },
});

await stress({
  name: 'buildHizPyramid extremes',
  calcul: (e: { depth: Float32Array; width: number; height: number }) =>
    buildHizPyramid(e.depth, e.width, e.height),
  extremes: [{ name: '1x1', input: { depth: new Float32Array(1), width: 1, height: 1 } }],
});

rapport('hiz-pyramide', [resHiz], 'C2 was measured and its delta is described');
