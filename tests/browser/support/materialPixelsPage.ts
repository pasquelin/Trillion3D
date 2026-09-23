// Page side of the material proof: each fixture rendered by the Three witness and by the WebGPU
// engine, both from `dist/`, then read at the same points. The witness is drawn the way the
// explorer draws a Three-rendered engine — sRGB output, ACES once a light exists, identity
// without one — and the engine presents into its own canvas and answers `capture()`.
//
// This module is SERVED to the harness page (mount `/test/`) and imported by its URL, since the
// evaluated function is serialised and cannot reach a module of its own.
import * as THREE from 'three';
import { cameraFace } from './preuveSceneCommune.ts';
import { ouvrirAppareil } from '../probes/appareilWebgpu.ts';
import { creer, appliquer } from '/mesure/pageTemoin.ts';
import { SUN, fixtures, type Fixture } from './materialFixtures.ts';
import {
  witnessRenderer,
  sceneOf,
  rgbAt,
  witnessImage,
  engineImage,
} from './materialPixelsRendu.ts';
import type {
  BackendFactory,
  BackendDiagnostic,
} from '../../../packages/sdk-browser/backendTypes.ts';
import type * as SdkBrowser from '../../../packages/sdk-browser/measurement.ts';
import type * as SdkCore from '../../../packages/sdk-core/src/index.ts';

interface Sides {
  referenceBackend: BackendFactory;
  webgpuPagesBackend: BackendFactory;
  device: GPUDevice;
  renderer: THREE.WebGLRenderer;
  canvas: HTMLCanvasElement;
  camera: THREE.PerspectiveCamera;
  sun: THREE.Object3D;
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
  images: { witness: string; engine: string };
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
  const sun = creer(SUN);
  appliquer(sun, SUN, 0);
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
