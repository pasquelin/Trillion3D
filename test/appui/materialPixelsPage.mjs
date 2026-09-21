// Page side of the material proof: each fixture rendered by the Three witness and by the WebGPU
// engine, both from `dist/`, then read at the same points. The witness is drawn the way the
// explorer draws a Three-rendered engine — sRGB output, ACES once a light exists, identity
// without one — and the engine presents into its own canvas and answers `capture()`.
//
// This module is SERVED to the harness page (mount `/test/`) and imported by its URL, since the
// evaluated function is serialised and cannot reach a module of its own.
import * as THREE from 'three';
import { batisseur, cameraFace, engine, jusquaTenue, libere } from './preuveSceneCommune.mjs';
import { ouvrirAppareil } from '../justesse/appareilWebgpu.mjs';
import { creer, appliquer } from '/mesure/pageTemoin.mjs';
import { SIZE, SUN, fixtures } from './materialFixtures.mjs';

/** Background the page and both engines clear to, so an uncovered pixel is one colour. */
const CLEAR_COLOR = 0x2a303c;

/** The witness renderer, configured as the explorer configures its own. */
function witnessRenderer() {
  const canvas = document.createElement('canvas');
  document.body.append(canvas);
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false });
  renderer.setPixelRatio(1);
  renderer.setSize(SIZE, SIZE, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMappingExposure = 1;
  return { renderer, canvas };
}

/** The fixture's square: a lit one carries normals, a normal-mapped one its tangents. */
function square(fixture) {
  const geometry = new THREE.PlaneGeometry(2, 2);
  if (fixture.tangents)
    geometry.setAttribute(
      'tangent',
      new THREE.Float32BufferAttribute(Array.from({ length: 4 }, () => [1, 0, 0, 1]).flat(), 4),
    );
  return geometry;
}

/** The prepared scene of one fixture: its square, what stands behind it, and the sun when lit. */
function sceneOf(fixture, sun) {
  const builder = batisseur();
  const material = fixture.material();
  const mesh = new THREE.Mesh(square(fixture), material);
  if (fixture.back) mesh.rotation.y = Math.PI;
  builder.source.add(mesh);
  builder.ajoute(mesh, material.transparent ? 'clustered-blend' : 'exact-clusters', 1);
  if (fixture.behind !== undefined) {
    const back = new THREE.Mesh(
      new THREE.PlaneGeometry(4, 4),
      new THREE.MeshBasicMaterial({ color: fixture.behind }),
    );
    back.position.z = -1;
    builder.source.add(back);
    builder.ajoute(back, 'exact-clusters', 2);
  }
  if (fixture.lit) builder.source.add(sun);
  return builder.fini();
}

/** RGB at `(x, y)` of a bottom-left RGBA image of `SIZE` columns. */
const rgbAt = (pixels, [x, y]) =>
  Array.from(pixels.slice((y * SIZE + x) * 4, (y * SIZE + x) * 4 + 3));

/** The witness image of a prepared scene, drawn by the display chain of a Three engine; the
 *  witness copies the source's meshes and lights, so the scene is left for the engine. */
function witnessImage(referenceBackend, scene, renderer, camera) {
  const backend = referenceBackend({ source: scene.source, clearColor: CLEAR_COLOR });
  renderer.toneMapping = backend.sceneLit() ? THREE.ACESFilmicToneMapping : THREE.NoToneMapping;
  backend.render(camera);
  renderer.render(backend.scene, camera);
  const pixels = new Uint8Array(SIZE * SIZE * 4);
  const gl = renderer.getContext();
  gl.readPixels(0, 0, SIZE, SIZE, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
  backend.dispose();
  return pixels;
}

/** The engine image of a prepared scene, held when the engine holds it, the last rendered one
 *  otherwise; releases the scene. */
async function engineImage(webgpuPagesBackend, scene, device, sceneLights, camera, events) {
  const { backend, canvas } = engine(webgpuPagesBackend, scene, device, (e) => events.push(e), {
    clearColor: CLEAR_COLOR,
    sceneLights,
  });
  try {
    await backend.prepare();
    const { tenue, rendue } = await jusquaTenue(backend, camera);
    return { pixels: tenue ?? rendue, held: tenue !== null, dataUrl: canvas.toDataURL() };
  } finally {
    libere(backend, canvas, scene);
  }
}

/** One fixture on both engines: the readings at its points, the engine's diagnostics, both images. */
async function compare(fixture, sides) {
  const { referenceBackend, webgpuPagesBackend, device, renderer, canvas, camera, stores } = sides;
  const events = [];
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
        b = rgbAt(engineSide.pixels, point);
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

/** Runs every fixture on both engines and returns their readings, or what stopped the run. */
export async function run({ sdkUrl, coreUrl }) {
  const { referenceBackend, webgpuPagesBackend } = await import(sdkUrl);
  const { createSceneLightStore } = await import(coreUrl);
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
  const sides = {
    referenceBackend,
    webgpuPagesBackend,
    device,
    renderer,
    canvas,
    camera,
    sun,
    stores,
  };
  const results = [];
  let error = null;
  try {
    for (const fixture of fixtures) results.push(await compare(fixture, sides));
  } catch (failure) {
    error = String(failure) + (failure?.stack ?? '');
  } finally {
    renderer.dispose();
    canvas.remove();
  }
  const info = await gpu.fermer();
  return { error, results, errors, gpu: info.court, userAgent: navigator.userAgent };
}
