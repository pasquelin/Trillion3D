import test from 'node:test';
import assert from 'node:assert/strict';
import { IDENTITY_MATRIX4 } from '../sdk-core/index.ts';
import {
  beginTaaFrame,
  createTaaFrameState,
  dropTaaHistory,
  encodeTaaPass,
  taaRenderMatrix,
  taaSettled,
} from './taaFrame.ts';
import { TAA_STILL_FRAMES } from './taaJitter.ts';
import type { WebgpuPagesRuntime } from './webgpuPagesRuntime.ts';
import type { EngineCamera } from './cameraWorld.ts';
import type { TaaInputs } from './temporalAntialiasing.ts';

/** Le strict nécessaire d'un moteur : la passe factice, ses entrées, la caméra et les révisions. */
function runtime() {
  const encoded: unknown[] = [],
    uniforms: Float32Array[] = [];
  const output = { output: true } as unknown as GPUTextureView;
  const temporal = {
    uniform: {} as GPUBuffer,
    motion: {
      buffer: {} as GPUBuffer,
      moved: false,
      updates: [] as boolean[],
      resets: 0,
      update(_eye: ArrayLike<number>, scan: boolean) {
        this.updates.push(scan);
      },
      reset() {
        this.resets++;
      },
    },
    frame: createTaaFrameState(),
    inputs: {} as TaaInputs,
    checkpoint() {},
    replay: () => false,
    encode(_encoder: unknown, inputs: unknown) {
      encoded.push(inputs);
      return output;
    },
  };
  const rt = {
    gpu: { temporal, targetSize: [64, 32], depthView: { depth: true }, hdrView: { hdr: true } },
    vis: { visView: { ids: true }, pageTable: { pages: true } },
    run: { diagnostic: 'beauty', gpuDrawCalls: 0, gate: { revisions: { scene: 1 } } },
    capture: { secondaryCamera: undefined },
  } as unknown as WebgpuPagesRuntime;
  const device = {
    queue: {
      writeBuffer(_buffer: unknown, _offset: number, data: Float32Array) {
        uniforms.push(Float32Array.from(data));
      },
    },
  } as unknown as GPUDevice;
  const cam = { viewProjection: IDENTITY_MATRIX4, eye: [0, 0, 0] } as unknown as EngineCamera;
  const hdr = rt.gpu.hdrView!;
  /** Une image entière : entrée, matrice de rendu, passe ; rend l'uniforme écrit, ou `null`. */
  const frame = (quiet: boolean) => {
    beginTaaFrame(rt, cam, quiet);
    taaRenderMatrix(rt, cam);
    const before = uniforms.length;
    encodeTaaPass(rt, device, {} as GPUCommandEncoder, cam, hdr);
    return uniforms.length > before ? uniforms[uniforms.length - 1] : null;
  };
  return { rt, cam, temporal, encoded, frame };
}

test("sans accumulation cette image, la matrice de rendu est celle de la caméra et la composition lit l'image éclairée", () => {
  const { rt, cam, encoded, frame } = runtime();
  rt.capture.secondaryCamera = {} as never;
  assert.equal(frame(false), null);
  assert.equal(taaRenderMatrix(rt, cam), cam.viewProjection);
  assert.equal(encoded.length, 0);
  rt.capture.secondaryCamera = undefined;
  rt.run.diagnostic = 'screen-error' as never;
  assert.equal(frame(false), null);
  assert.equal(taaRenderMatrix(rt, cam), cam.viewProjection);
  // Sans passe gréée du tout, l'image est tenue comme avant le lot.
  rt.gpu.temporal = undefined;
  assert.equal(taaSettled(rt), true);
});

test('une image accumulée avance la gigue, écrit l’uniforme et rend la cible écrite', () => {
  const { rt, cam, temporal, encoded, frame } = runtime();
  let u = frame(false)!;
  assert.notEqual(
    taaRenderMatrix(rt, cam),
    cam.viewProjection,
    'la matrice de rendu porte la gigue',
  );
  assert.equal(encoded.length, 1);
  assert.equal(
    temporal.motion.resets,
    1,
    "la première image n'a pas d'historique : les poses sont prises",
  );
  // Sans historique, `params.y` vaut 0 ; l'image suivante l'a, et personne n'a bougé (`params.z`).
  assert.equal(u[37], 0);
  u = frame(false)!;
  assert.equal(u[37], 1);
  assert.equal(u[38], 0);
  assert.deepEqual(
    temporal.motion.updates,
    [false],
    'scène inchangée : aucune comparaison de poses',
  );
  assert.equal(temporal.frame.sample, 2);
  // Les neuf poids du filtre somment à un.
  let sum = 0;
  for (let k = 0; k < 9; k++) sum += u[40 + k];
  assert.ok(Math.abs(sum - 1) < 1e-5);
  // Un changement de scène fait comparer les poses, et un placement qui a bougé se dit à la passe.
  rt.run.gate.revisions.scene++;
  temporal.motion.moved = true;
  u = frame(false)!;
  assert.deepEqual(temporal.motion.updates, [false, true]);
  assert.equal(u[38], 1);
});

test('la tenue attend un plein cycle d’images calmes, moyennées uniformément depuis une phase fixe', () => {
  const { rt, temporal, frame } = runtime();
  // Trois images en mouvement : accumulation exponentielle à un huitième, la gigue avance.
  for (let i = 0; i < 3; i++) frame(false);
  assert.equal(temporal.frame.sample, 3);
  assert.equal(Math.fround(frame(false)![36]), Math.fround(1 / 8));
  assert.equal(taaSettled(rt), false);
  // Première image calme : l'historique est abandonné, la gigue repart de zéro.
  let u = frame(true)!;
  assert.equal(u[37], 0, 'sans historique : la passe rend l’image courante filtrée');
  assert.equal(temporal.frame.sample, 1, 'phase zéro rejouée');
  assert.equal(temporal.frame.stillFrames, 1);
  // Les suivantes pèsent 1/k : la seizième donne la moyenne uniforme de seize images.
  u = frame(true)!;
  assert.equal(u[37], 1);
  assert.equal(Math.fround(u[36]), Math.fround(1 / 2));
  for (let k = 3; k < TAA_STILL_FRAMES; k++) u = frame(true)!;
  assert.equal(Math.fround(u[36]), Math.fround(1 / (TAA_STILL_FRAMES - 1)));
  assert.equal(taaSettled(rt), false, 'une image avant le cycle complet, rien n’est tenu');
  u = frame(true)!;
  assert.equal(Math.fround(u[36]), Math.fround(1 / TAA_STILL_FRAMES));
  assert.equal(taaSettled(rt), true);
  // Quelque chose bouge : le compte repart, l'historique reste et se mêle à un huitième.
  u = frame(false)!;
  assert.equal(temporal.frame.stillFrames, 0);
  assert.equal(u[37], 1);
  assert.equal(Math.fround(u[36]), Math.fround(1 / 8));
  assert.equal(taaSettled(rt), false);
  // Des cibles réallouées perdent l'historique et le compte.
  for (let i = 0; i < TAA_STILL_FRAMES; i++) frame(true);
  assert.equal(taaSettled(rt), true);
  dropTaaHistory(rt);
  assert.equal(temporal.frame.hasHistory, false);
  assert.equal(taaSettled(rt), false);
});

// Une image de convergence — la barrière qui rerend la même pose pour montrer les tuiles arrivées —
// rejoue la dernière image ordinaire : même gigue, même calme, au lieu d'accumuler une fois de plus.
test('une image de convergence rejoue la dernière image ordinaire au lieu d’avancer la gigue', () => {
  const { rt, temporal, frame } = runtime();
  let replayed = 0,
    checkpoints = 0;
  temporal.checkpoint = () => {
    checkpoints++;
  };
  temporal.replay = () => {
    replayed++;
    return true;
  };
  frame(false);
  assert.equal(checkpoints, 1, 'une image ordinaire retient d’où elle part');
  assert.equal(replayed, 0);
  rt.run.textureConverging = true;
  frame(false);
  assert.equal(replayed, 1, 'une image de convergence rejoue');
  assert.equal(checkpoints, 1, 'et ne retient rien de neuf');
  // Le calme rejoué est celui de l'image de référence, pas celui que les tuiles ont troublé.
  assert.equal(temporal.frame.stillFrames, 1);
});
