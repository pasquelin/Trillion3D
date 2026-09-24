// Page side of the material proof: each fixture rendered by its pair of renderers — the Three
// witness and the WebGPU engine unless it names WebGL2 —, all from `dist/`, then read at the same
// points. The witness is drawn the way the explorer draws a Three-rendered engine — sRGB output,
// ACES once a light exists, identity without one — and each engine presents into its own canvas.
//
// This module is SERVED to the harness page (mount `/tests/`) and imported by its URL, since the
// evaluated function is serialised and cannot reach a module of its own.
import * as THREE from 'three';
import * as G from '../../../packages/sdk-browser/src/host/graph/graph.fixture.ts';
import { cameraFace, releaseScene } from './sharedSceneProof.ts';
import { ouvrirAppareil } from '../probes/webgpuDevice.ts';
import { fixtures } from './materialFixtures.ts';
import { SUN, WITNESS_PAIR, type Fixture, type Renderer } from './materialFixtureShape.ts';
import {
  witnessRenderer,
  sceneOf,
  rgbAt,
  witnessImage,
  engineImage,
  webgl2Image,
  CLEAR_COLOR,
} from './materialPixelsRender.ts';
import type {
  BackendFactory,
  BackendDiagnostic,
} from '../../../packages/sdk-browser/src/backend/types.ts';
import type * as Witnesses from '../../../bench/witnesses/measurement.ts';
import type * as Engine from '../../../packages/sdk-browser/src/measurement/measurement.ts';
import type * as SdkCore from '../../../packages/sdk-core/src/index.ts';

interface Sides {
  referenceBackend: BackendFactory;
  webgpuPagesBackend: BackendFactory;
  autonomousPagesBackend: BackendFactory;
  device: GPUDevice;
  renderer: THREE.WebGLRenderer;
  canvas: HTMLCanvasElement;
  camera: G.GraphCamera;
  sun: G.GraphNode;
  stores: { none: SdkCore.SceneLightStore; sun: SdkCore.SceneLightStore };
}

interface Reading {
  point: number[];
  reference: number[];
  engine: number[];
  gap: number;
}

interface Comparison {
  name: string;
  /** The reference, then the renderer read against it. */
  pair: readonly [Renderer, Renderer];
  difference: number[];
  reason: string;
  held: boolean;
  events: BackendDiagnostic[];
  samples: Reading[];
  /** Pixels where the engine shows the background and the reference a surface (`behind`). */
  holes?: number;
  /** Each renderer's image, by its name. */
  images: Record<string, string>;
}

/** The display background, one 8-bit step either way per channel. */
const CLEAR_RGB = [16, 8, 0].map((shift) => (CLEAR_COLOR >> shift) & 255);
const isClear = (pixels: ArrayLike<number>, i: number) =>
  CLEAR_RGB.every((c, k) => Math.abs(pixels[i + k] - c) <= 1);

/** Pixels where `engine` shows the background and `reference` does not. */
function holesOf(reference: ArrayLike<number>, engine: ArrayLike<number>) {
  let holes = 0;
  for (let i = 0; i < reference.length; i += 4)
    if (isClear(engine, i) && !isClear(reference, i)) holes++;
  return holes;
}

/** One fixture drawn by one renderer, on a scene of its own the renderer releases. */
async function drawn(
  renderer: Renderer,
  fixture: Fixture,
  sides: Sides,
  events: BackendDiagnostic[],
): Promise<{ pixels: ArrayLike<number>; held: boolean; dataUrl: string }> {
  const scene = sceneOf(fixture, sides.sun);
  const { camera } = sides;
  const lights = fixture.lit ? sides.stores.sun : sides.stores.none;
  if (renderer === 'webgl2')
    return webgl2Image(sides.autonomousPagesBackend, scene, lights, camera);
  if (renderer === 'webgpu') {
    const { pixels, held, dataUrl } = await engineImage(
      sides.webgpuPagesBackend,
      scene,
      sides.device,
      lights,
      camera,
      events,
    );
    return { pixels: pixels ?? [], held, dataUrl };
  }
  const pixels = witnessImage(sides.referenceBackend, scene, sides.renderer, camera);
  releaseScene(scene);
  return { pixels, held: true, dataUrl: sides.canvas.toDataURL() };
}

/** One fixture on its pair of renderers: the readings at its points, the engine's diagnostics,
 *  both images. */
async function compare(fixture: Fixture, sides: Sides): Promise<Comparison> {
  const events: BackendDiagnostic[] = [];
  const pair = fixture.pair ?? WITNESS_PAIR;
  const reference = await drawn(pair[0], fixture, sides, events);
  const engine = await drawn(pair[1], fixture, sides, events);
  const { name, difference, reason } = fixture;
  return {
    name,
    pair,
    difference,
    reason,
    held: reference.held && engine.held,
    events,
    samples: fixture.points.map((point) => {
      const a = rgbAt(reference.pixels, point),
        b = rgbAt(engine.pixels, point);
      return {
        point,
        reference: a,
        engine: b,
        gap: Math.max(...a.map((c, i) => Math.abs(c - b[i]))),
      };
    }),
    holes: fixture.behind !== undefined ? holesOf(reference.pixels, engine.pixels) : undefined,
    images: { [pair[0]]: reference.dataUrl, [pair[1]]: engine.dataUrl },
  };
}

interface RunResult {
  unavailable?: string;
  error?: string | null;
  results?: Comparison[];
  errors?: string[];
  gpu?: string;
  userAgent?: string;
}

/** Runs every fixture on both engines and returns their readings, or what stopped the run. */
export async function run({
  sdkUrl,
  engineUrl,
  coreUrl,
}: {
  sdkUrl: string;
  engineUrl: string;
  coreUrl: string;
}): Promise<RunResult> {
  const { referenceBackend } = (await import(sdkUrl)) as typeof Witnesses;
  const { webgpuPagesBackend, autonomousPagesBackend } = (await import(engineUrl)) as typeof Engine;
  const { createSceneLightStore } = (await import(coreUrl)) as typeof SdkCore;
  const gpu = await ouvrirAppareil();
  if (!gpu) return { unavailable: 'no WebGPU adapter' };
  const { device, erreurs: errors } = gpu;
  const { renderer, canvas } = witnessRenderer();
  // The sun of the witness and the stores of the engine, built once: a light added to another
  // scene moves there, and an unlit fixture reads the empty store.
  const sun = G.directionalLight(new G.Color(SUN.color), SUN.intensity);
  const [dx, dy, dz] = SUN.direction ?? [0, -1, 0];
  sun.position.set(-dx, -dy, -dz);
  sun.target!.position.set(0, 0, 0);
  const stores = { none: createSceneLightStore(), sun: createSceneLightStore() };
  stores.sun.add(SUN);
  const camera = cameraFace();
  const sides: Sides = {
    referenceBackend,
    webgpuPagesBackend,
    autonomousPagesBackend,
    device,
    renderer,
    canvas,
    camera,
    sun,
    stores,
  };
  const results: Comparison[] = [];
  let error: string | null = null;
  try {
    for (const fixture of fixtures) results.push(await compare(fixture, sides));
  } catch (failure) {
    const trace = failure instanceof Error ? (failure.stack ?? '') : '';
    error = String(failure) + trace;
  } finally {
    renderer.dispose();
    canvas.remove();
  }
  const info = await gpu.fermer();
  return { error, results, errors, gpu: info.court, userAgent: navigator.userAgent };
}
