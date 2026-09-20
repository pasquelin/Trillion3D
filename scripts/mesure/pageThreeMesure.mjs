// What the Three witnesses — bare (`pageThreeNu.mjs`) and with levels of detail (`pageThreeLod.mjs`)
// — measure the same: the same glTF scene loaded by Three, contract lights placed in Three
// (sun as `DirectionalLight` with ONE shadow map covering the model, point lights as
// `PointLight` with their shadow cube), ACES and sRGB like the engine, and the same
// measurement loop. Served to the page (mount `/mesure/`), it imports only `three` from
// `/vendor/three/` — never from the engine.
//
// What it measures: the CPU time of `render`, the wall time of a synchronised frame
// (`render` then a pixel read, which waits for the GPU — `gl.finish` waits for nothing in
// Chrome; one duration, never a sum), the rAF interval in a profile loop, the calls and
// triangles of `renderer.info`, the geometry and texture bytes it holds, preparation
// and the network, and its capture for the pixel delta. No per-pass GPU time: WebGL does
// not expose it in Chrome, and the reading says so with `null`.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { lampe, octets } from './pageThreeNuScene.mjs';
import { positionLampeMobile, posterCapture, reseauDepuis } from './pageMesure.mjs';

function placer(camera, pose, aspect) {
  camera.fov = pose.fov;
  camera.aspect = aspect;
  camera.near = pose.near;
  camera.far = pose.far;
  camera.position.fromArray(pose.position);
  camera.lookAt(pose.target[0], pose.target[1], pose.target[2]);
  camera.updateProjectionMatrix();
}

/** Triangles of indexed geometries under `racine`, each geometry counted once. */
function trianglesUniques(racine) {
  const geometries = new Set();
  racine.traverse((o) => {
    if (o.isMesh && o.geometry?.index) geometries.add(o.geometry);
  });
  let total = 0;
  for (const g of geometries) total += g.index.count / 3;
  return total;
}

/**
 * One view, one threshold (ignored: Three has no threshold), the capture. Same contract as `measureView`.
 * `preparer(racine, options)` retouches the loaded graph before shadows and compilation — that
 * is where the level-of-detail witness replaces its meshes — and returns extra metrics to
 * publish; without it, the scene stays as Three read it.
 */
export async function mesurerThree(options, preparer) {
  if ((options.instances ?? 1) !== 1)
    return { erreur: 'the Three witness does not place instances' };
  const canvas = document.createElement('canvas');
  document.body.append(canvas);
  const lost = (globalThis.incidentsGpu = []);
  canvas.addEventListener('webglcontextlost', () => lost.push('webglcontextlost'), false);
  performance.setResourceTimingBufferSize(1_000_000);
  const resourcesBefore = performance.getEntriesByType('resource').length;
  const preparationStart = performance.now();
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: false,
    preserveDrawingBuffer: true,
    powerPreference: 'high-performance',
  });
  renderer.setPixelRatio(1);
  renderer.setSize(options.width, options.height, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1;
  renderer.setClearColor(0x2a303c, 1);
  const shadows = options.lights?.some((l) => l.castsShadow !== false) === true;
  renderer.shadowMap.enabled = shadows;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  const scene = new THREE.Scene();
  const gltf = await new GLTFLoader().loadAsync(options.gltfUrl);
  scene.add(gltf.scene);
  const uniqueTriangles = trianglesUniques(gltf.scene);
  const temoin = await preparer?.(gltf.scene, options);
  gltf.scene.traverse((o) => {
    if (!o.isMesh) return;
    o.castShadow = o.receiveShadow = shadows;
    // glTF materials are two-sided: projecting both makes every thin wall shadow
    // itself and darkens the scene. Back face alone is Three's usual setting.
    if (o.material) o.material.shadowSide = THREE.BackSide;
  });
  const box = new THREE.Box3().setFromObject(gltf.scene);
  const lampes = new Map();
  for (const light of options.lights ?? []) {
    const objets = lampe(light, box, shadows);
    lampes.set(light.id, objets[0]);
    scene.add(...objets);
  }
  const camera = new THREE.PerspectiveCamera();
  const poser = (pose) => placer(camera, pose, options.width / options.height);
  poser(options.pose);
  await renderer.compileAsync(scene, camera);
  renderer.render(scene, camera);
  const preparationMs = performance.now() - preparationStart;
  const gl = renderer.getContext();
  const moving = options.moving;
  const moveLight = (frame) => {
    if (moving) lampes.get(moving.id)?.position.fromArray(positionLampeMobile(moving, frame));
  };
  let current = options.pose;
  const poseAt = (frame) =>
    (current = options.poses ? options.poses[frame % options.poses.length] : options.pose);
  const unPixel = new Uint8Array(4);
  const attendre = () => gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, unPixel);
  for (let i = 0; i < options.warmup; i++) renderer.render(scene, camera);
  attendre();
  const cpuFrameMs = [];
  const rafIntervalMs = [];
  let previousRaf = null;
  for (let i = 0; i < options.frames; i++) {
    const now = await new Promise((done) => requestAnimationFrame(done));
    if (previousRaf !== null && i > 2) rafIntervalMs.push(now - previousRaf);
    previousRaf = now;
    moveLight(i);
    poser(poseAt(i));
    const t = performance.now();
    renderer.render(scene, camera);
    cpuFrameMs.push(performance.now() - t);
  }
  poser(current);
  renderer.render(scene, camera);
  const info = renderer.info;
  const memoire = octets(scene);
  // The capture, bottom-to-top rows as WebGL reads them and as `explorer.capture()`
  // returns them: the bench server flips them when encoding the PNG, and compares the buffers as-is.
  const w = canvas.width,
    h = canvas.height;
  const rgba = new Uint8Array(w * h * 4);
  gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, rgba);
  const response = await posterCapture(options.captureFile, rgba, w, h);
  const network = reseauDepuis(resourcesBefore);
  const metrics = {
    drawCalls: info.render.calls,
    drawnTriangles: info.render.triangles,
    selectedTriangles: null,
    uncoveredTriangles: null,
    geometryAllocationBytes: memoire.geometrie,
    textureResidentBytes: memoire.textures,
    texturePoolBytes: null,
    geometries: memoire.geometries,
    programs: info.programs?.length ?? null,
    lightsActive: lampes.size,
    frameHeld: false,
    // Triangles of the scene as Three read it, each geometry counted once: the
    // witness's bytes per triangle are measured on that.
    uniqueTriangles,
    // What the witness preparation publishes (its levels of detail), flattened.
    ...temoin,
  };
  renderer.dispose();
  canvas.remove();
  return {
    cpuFrameMs,
    cpuSelectMs: [],
    gpuFrameMs: [],
    syncFrameMs: [],
    rafIntervalMs,
    importedLights: null,
    lampesTemoin: { nombre: lampes.size, ombres: shadows, ids: [...lampes.keys()], nu: true },
    shadowAtlas: null,
    movingNode: null,
    stageProfile: null,
    gpuPassSamples: [],
    selection: { source: null, ids: [] },
    metrics,
    preparationMs,
    network,
    mathBatch: null,
    size: { width: w, height: h },
    lost,
    captureStatus: response.status,
  };
}
