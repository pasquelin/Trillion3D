// filling the visbuffer. The reference is `packages/sdk-browser/src/visibility/raster.ts` copied as-is — two
// divisions and four products per pixel — and the candidate evaluates the same weights in
// affine form: one division per triangle, constant steps per column and per row. The candidate
// was rejected and its commit reverted; the bench keeps it so the reason for rejection stays
// reproducible. A test checks that the copied reference is what the package rasterizes today,
// otherwise the comparison would say nothing.
import test from 'node:test';
import assert from 'node:assert/strict';
import { rasterVisibility } from '../../../packages/sdk-browser/src/visibility/raster.ts';
import { fillAffine, fillReference } from './support/rasterBuffer.ts';
import { rasterWith } from './support/rasterFrameLoop.ts';
import { quadrillage } from './support/scenesCut.ts';
import { compteur, ecart, mesure, note, rapport, stress } from '../../core/index.ts';
import { camera, coupe } from './support/scenes.ts';
import { cameraMoteur } from '../../../packages/sdk-browser/src/camera/camera.fixture.ts';
import type { EngineCamera } from '../../../packages/sdk-browser/src/camera/world.ts';
import type { VisPage } from '../../../packages/sdk-browser/src/visibility/types.ts';

interface FrameInput {
  pages: VisPage[];
  cam: EngineCamera;
  image: [number, number];
}

interface FrameOutput {
  ids: Uint32Array;
  depth: Float32Array;
}

/** Delta of a frame: how many pixels change identifier, how many change depth. */
function differencesImage(attendu: FrameOutput, obtenu: FrameOutput, name: string) {
  const c = compteur();
  for (let i = 0; i < attendu.ids.length; i++) {
    if (attendu.ids[i] !== obtenu.ids[i]) {
      c.nombre++;
      c.premier ??= `${name} identifier [${i}]: ${attendu.ids[i]} ≠ ${obtenu.ids[i]}`;
    }
    // An identifier is an integer: only depth has a delta counted in ULPs.
    note(c, attendu.depth[i], obtenu.depth[i], `${name} depth [${i}]`, 32);
  }
  return c;
}

// The host camera of the set, and the engine camera derived from it: posed once, never per lap.
const hote = camera(6, 0.1, 16 / 9),
  hoteCarre = camera(3, 0.1, 1);
const cam = cameraMoteur(hote);
const image: [number, number] = [1280, 720];
const carre = cameraMoteur(hoteCarre);
const grande: FrameInput = {
  pages: coupe({ pages: 400, triangles: 24, hostile: true, seed: 7 }),
  cam,
  image,
};
const rase: FrameInput = {
  pages: coupe({ pages: 24, triangles: 24, hostile: true, seed: 23, size: 2.2 }),
  cam,
  image,
};
const vide: FrameInput = { pages: [], cam, image };
const diagonale: FrameInput = { pages: quadrillage(1, 1), cam: carre, image: [64, 64] };
const damier: FrameInput = { pages: quadrillage(8, 0.25), cam: carre, image };
const GRAINES = [11, 37, 97];
const autresGraines: FrameInput[] = GRAINES.map((seed) => ({
  pages: coupe({ pages: 120, triangles: 24, hostile: true, seed, size: 0.5 }),
  cam,
  image,
}));

const tour =
  <Sortie>(fn: (pages: VisPage[], cam: EngineCamera, viewport: [number, number]) => Sortie) =>
  (input: FrameInput) =>
    fn(input.pages, input.cam, input.image);

const resC1 = await mesure({
  name: 'affine visbuffer candidate against perspective',
  fichier: 'packages/sdk-browser/src/visibility/raster.ts',
  cas: [
    { name: '1280×720, 9 600 triangles including degenerates', input: grande, size: 9600 },
    { name: '1280×720, grazing triangles and behind the camera', input: rase, size: 576 },
    { name: 'no pages', input: vide, size: 0 },
    { name: '64×64, shared diagonal at pixel centre', input: diagonale, size: 2 },
    { name: '1280×720, 64 checkerboard quads', input: damier, size: 128 },
    ...autresGraines.map((input, i) => ({
      name: `seed ${GRAINES[i]}, 2 880 triangles`,
      input,
      size: 2880,
      mesure: false,
    })),
  ],
  calcul: tour(rasterWith(fillAffine)),
  attendu: tour(rasterWith(fillReference)),
  // The candidate was rejected: giving a delta comparator tells the foundation to quantify what
  // it moves instead of demanding an equality that does not hold.
  differences: differencesImage,
  options: { chauffe: 2, tours: 12, budgetMs: 3000 },
});

// `ecart` compares the two buffers value by value and names the first faulty pixel; it is
// `deepEqual`, on a million pixels, that cost too much.
test('the copied reference is what the package rasterizes today', () => {
  const copie = tour(rasterWith(fillReference));
  const inputs = [grande, rase, diagonale, damier, ...autresGraines];
  for (let i = 0; i < inputs.length; i++)
    assert.equal(ecart(tour(rasterVisibility)(inputs[i]), copie(inputs[i]), `frame ${i}`), null);
});

await stress({
  name: 'rasterVisibility extremes',
  calcul: (e) => rasterVisibility(e.pages, e.cam, e.image),
  extremes: [{ name: 'empty', input: vide }],
});

rapport('raster-tampon', [resC1], 'C1 was measured and its delta from the reference is quantified');
