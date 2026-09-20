// Page side of the material proof: each fixture rendered by the Three witness and by the WebGPU
// engine, both from `dist/`, then read at the same points. The witness is drawn the way the
// explorer draws a Three-rendered engine — sRGB output, ACES once a light exists, identity
// without one — and the engine presents into its own canvas and answers `capture()`.
//
// This module is SERVED to the harness page (mount `/test/`) and imported by its URL, since the
// evaluated function is serialised and cannot reach a module of its own.
import * as THREE from 'three';
import { batisseur, cameraFace, engine, image, libere } from './preuveSceneCommune.mjs';
import { creer, appliquer } from '/mesure/pageTemoin.mjs';
import { CLEAR_COLOR, SIZE, SUN, fixtures } from './materialFixtures.mjs';

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
  const bati = batisseur();
  const material = fixture.material();
  const mesh = new THREE.Mesh(square(fixture), material);
  if (fixture.back) mesh.rotation.y = Math.PI;
  bati.source.add(mesh);
  bati.ajoute(mesh, material.transparent ? 'clustered-blend' : 'exact-clusters', 1);
  if (fixture.behind !== undefined) {
    const back = new THREE.Mesh(
      new THREE.PlaneGeometry(4, 4),
      new THREE.MeshBasicMaterial({ color: fixture.behind }),
    );
    back.position.z = -1;
    bati.source.add(back);
    bati.ajoute(back, 'exact-clusters', 2);
  }
  if (fixture.lit) bati.source.add(sun);
  return bati.fini();
}

/** RGB at `(x, y)` of a bottom-left RGBA image of `SIZE` columns. */
const rgbAt = (pixels, [x, y]) =>
  Array.from(pixels.subarray((y * SIZE + x) * 4, (y * SIZE + x) * 4 + 3));

/** The witness image of a prepared scene, drawn by the display chain of a Three engine. */
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

/** The engine image of a prepared scene, held: rendered until `frameHeld`, eight frames at most. */
async function engineImage(webgpuPagesBackend, scene, device, sceneLights, camera, events) {
  const { backend, canvas } = engine(webgpuPagesBackend, scene, device, (e) => events.push(e), {
    viewport: [SIZE, SIZE],
    clearColor: CLEAR_COLOR,
    sceneLights,
  });
  try {
    await backend.prepare();
    let frame = await image(backend, camera);
    for (let n = 1; n < 8 && !frame.metriques.frameHeld; n++) frame = await image(backend, camera);
    return { pixels: frame.pixels, held: frame.metriques.frameHeld, dataUrl: canvas.toDataURL() };
  } finally {
    libere(backend, canvas, scene);
  }
}

/**
 * Runs every fixture on both engines. Returns, per fixture, the RGB read at each point on each
 * side, the engine's diagnostics, and both images as data URLs for the run folder.
 */
export async function run({ sdkUrl, coreUrl }) {
  const { referenceBackend, webgpuPagesBackend } = await import(sdkUrl);
  const { createSceneLightStore } = await import(coreUrl);
  const adapter = await navigator.gpu?.requestAdapter();
  if (!adapter) return { unavailable: 'no WebGPU adapter' };
  const device = await adapter.requestDevice();
  const errors = [];
  device.addEventListener('uncapturederror', (event) => errors.push(event.error.message));
  const { renderer, canvas } = witnessRenderer();
  const camera = cameraFace();
  const results = [];
  try {
    for (const fixture of fixtures) {
      const sun = creer(SUN);
      appliquer(sun, SUN, 0);
      const sceneLights = createSceneLightStore();
      if (fixture.lit) sceneLights.add(SUN);
      const events = [];
      const witness = witnessImage(referenceBackend, sceneOf(fixture, sun), renderer, camera);
      const witnessUrl = canvas.toDataURL();
      const engineSide = await engineImage(
        webgpuPagesBackend,
        sceneOf(fixture, sun),
        device,
        sceneLights,
        camera,
        events,
      );
      results.push({
        name: fixture.name,
        tolerance: fixture.tolerance,
        reason: fixture.reason,
        held: engineSide.held,
        events,
        samples: fixture.points.map((point) => ({
          point,
          witness: rgbAt(witness, point),
          engine: rgbAt(engineSide.pixels, point),
        })),
        images: { witness: witnessUrl, engine: engineSide.dataUrl },
      });
    }
  } catch (error) {
    return { error: String(error) + (error?.stack ?? ''), results, errors };
  } finally {
    renderer.dispose();
    canvas.remove();
  }
  await device.queue.onSubmittedWorkDone();
  const info = adapter.info;
  device.destroy();
  return {
    results,
    errors,
    gpu: `${info.vendor} ${info.architecture}`,
    userAgent: navigator.userAgent,
  };
}
