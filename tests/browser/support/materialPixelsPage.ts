// Page side of the material proof: each fixture rendered by the Three witness and by the WebGPU
// engine, both from `dist/`, then read at the same points. The witness is drawn the way the
// explorer draws a Three-rendered engine — sRGB output, ACES once a light exists, identity
// without one — and the engine presents into its own canvas and answers `capture()`.
//
// This module is SERVED to the harness page (mount `/tests/`) and imported by its URL, since the
// evaluated function is serialised and cannot reach a module of its own.
import * as THREE from 'three';
import * as G from '../../../packages/sdk-browser/src/host/graph/graph.fixture.ts';
import { cameraFace } from './sharedSceneProof.ts';
import { ouvrirAppareil } from '../probes/webgpuDevice.ts';
import { SUN, fixtures, type Fixture } from './materialFixtures.ts';
import {
  witnessRenderer,
  sceneOf,
  rgbAt,
  witnessImage,
  engineImage,
  CLEAR_COLOR,
} from './materialPixelsRender.ts';
import type {
  BackendFactory,
  BackendDiagnostic,
} from '../../../packages/sdk-browser/src/backend/types.ts';
import type * as SdkBrowser from '../../../bench/witnesses/measurement.ts';
import type * as SdkCore from '../../../packages/sdk-core/src/index.ts';

interface Sides {
  referenceBackend: BackendFactory;
  webgpuPagesBackend: BackendFactory;
  device: GPUDevice;
  renderer: THREE.WebGLRenderer;
  canvas: HTMLCanvasElement;
  camera: G.GraphCamera;
  sun: G.GraphNode;
  stores: { none: SdkCore.SceneLightStore; sun: SdkCore.SceneLightStore };
}

interface Reading {
  point: number[];
  witness: number[];
  engine: number[];
  gap: number;
}

interface Comparison {
  name: string;
  difference: number[];
  reason: string;
  holds?: boolean;
  held: boolean;
  events: BackendDiagnostic[];
  samples: Reading[];
  /** Pixels where the engine shows the background and the witness a surface (`behind`). */
  holes?: number;
  images: { witness: string; engine: string };
}

/** The display background, one 8-bit step either way per channel. */
const CLEAR_RGB = [16, 8, 0].map((shift) => (CLEAR_COLOR >> shift) & 255);
const isClear = (pixels: ArrayLike<number>, i: number) =>
  CLEAR_RGB.every((c, k) => Math.abs(pixels[i + k] - c) <= 1);

/** Pixels where `engine` shows the background and `witness` does not. */
function holesOf(witness: ArrayLike<number>, engine: ArrayLike<number>) {
  let holes = 0;
  for (let i = 0; i < witness.length; i += 4)
    if (isClear(engine, i) && !isClear(witness, i)) holes++;
  return holes;
}

/** One fixture on both engines: the readings at its points, the engine's diagnostics, both images. */
async function compare(fixture: Fixture, sides: Sides): Promise<Comparison> {
  const { referenceBackend, webgpuPagesBackend, device, renderer, canvas, camera, stores } = sides;
  const events: BackendDiagnostic[] = [];
  const scene = sceneOf(fixture, sides.sun);
  const witness = witnessImage(referenceBackend, scene, renderer, camera);
  const witnessUrl = canvas.toDataURL();
  const lights = fixture.lit ? stores.sun : stores.none;
  const engineSide = await engineImage(webgpuPagesBackend, scene, device, lights, camera, events);
  const { name, difference, reason, holds } = fixture;
  return {
    name,
    difference,
    reason,
    holds,
    held: engineSide.held,
    events,
    samples: fixture.points.map((point) => {
      const a = rgbAt(witness, point),
        b = rgbAt(engineSide.pixels ?? [], point);
      return {
        point,
        witness: a,
        engine: b,
        gap: Math.max(...a.map((c, i) => Math.abs(c - b[i]))),
      };
    }),
    holes: fixture.behind !== undefined ? holesOf(witness, engineSide.pixels ?? []) : undefined,
    images: { witness: witnessUrl, engine: engineSide.dataUrl },
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
  coreUrl,
}: {
  sdkUrl: string;
  coreUrl: string;
}): Promise<RunResult> {
  const { referenceBackend, webgpuPagesBackend } = (await import(sdkUrl)) as typeof SdkBrowser;
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
