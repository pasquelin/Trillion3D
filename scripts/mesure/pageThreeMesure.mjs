// Ce que les témoins Three — nu (`pageThreeNu.mjs`) et à niveaux de détail (`pageThreeLod.mjs`)
// — mesurent pareil : la même scène glTF chargée par Three, les lampes du contrat posées en Three
// (soleil en `DirectionalLight` avec UNE carte d'ombre couvrant le modèle, ponctuelles en
// `PointLight` avec leur cube d'ombre), ACES et sRGB comme le moteur, et la même boucle de mesure.
// Servi à la page (montage `/mesure/`), n'importe que `three` depuis `/vendor/three/` — jamais du
// moteur.
//
// Ce qu'il mesure : le temps processeur de `render`, le temps mur d'une image synchronisée
// (`render` puis la lecture d'un pixel, qui attend la carte — `gl.finish` n'attend rien dans
// Chrome ; une seule durée, jamais une somme), l'intervalle rAF en boucle de profil, les appels et
// triangles de `renderer.info`, les octets de géométrie et de textures qu'il tient, la préparation
// et le réseau, et sa capture pour l'écart en pixels. Aucun temps GPU par passe : WebGL ne l'expose
// pas dans Chrome, et le relevé le dit par `null`.
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

/** Les triangles des géométries indexées de `racine`, chaque géométrie comptée une fois. */
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
 * Une vue, un seuil (ignoré : Three n'a pas de seuil), la capture. Même contrat que `measureView`.
 * `preparer(racine, options)` retouche le graphe chargé avant les ombres et la compilation — c'est
 * là que le témoin à niveaux de détail remplace ses maillages — et rend les métriques à publier
 * en plus ; sans lui, la scène reste telle que Three l'a lue.
 */
export async function mesurerThree(options, preparer) {
  if ((options.instances ?? 1) !== 1) return { erreur: 'le témoin Three ne pose pas d’instances' };
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
    // Les matériaux du glTF sont à deux faces : en projeter les deux fait s'ombrer chaque mur
    // mince lui-même et noircit la scène. La face arrière seule est le réglage usuel de Three.
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
  const cpuFrameMs = [],
    syncFrameMs = [];
  for (let i = 0; i < options.frames; i++) {
    moveLight(i);
    poser(poseAt(i));
    const t = performance.now();
    renderer.render(scene, camera);
    cpuFrameMs.push(performance.now() - t);
    attendre();
    syncFrameMs.push(performance.now() - t);
  }
  // La cadence réelle : une image par rAF, comme une application ; plafonnée par l'affichage. Les
  // deux premiers intervalles absorbent la file laissée par la boucle mesurée et ne sont pas relevés.
  const rafIntervalMs = [];
  let previous = null;
  for (let i = 0; i < options.profileFrames; i++) {
    moveLight(i);
    poser(poseAt(i));
    renderer.render(scene, camera);
    const now = await new Promise((done) => requestAnimationFrame(done));
    if (previous !== null && i > 2) rafIntervalMs.push(now - previous);
    previous = now;
  }
  poser(current);
  renderer.render(scene, camera);
  const info = renderer.info;
  const memoire = octets(scene);
  // La capture, lignes du bas vers le haut comme WebGL les lit et comme `explorer.capture()` les
  // rend : le serveur du banc les remet à l'endroit en encodant le PNG, et compare les tampons tels quels.
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
    textureBudgetBytes: null,
    textureLayers: memoire.images,
    geometries: memoire.geometries,
    programs: info.programs?.length ?? null,
    lightsActive: lampes.size,
    frameHeld: false,
    // Les triangles de la scène telle que Three l'a lue, chaque géométrie comptée une fois : les
    // octets par triangle du témoin se mesurent dessus.
    uniqueTriangles,
    // Ce que la préparation du témoin publie (ses niveaux de détail), à plat.
    ...temoin,
  };
  renderer.dispose();
  canvas.remove();
  return {
    cpuFrameMs,
    cpuSelectMs: [],
    gpuFrameMs: [],
    syncFrameMs,
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
