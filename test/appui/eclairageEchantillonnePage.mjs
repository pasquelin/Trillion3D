// Page side of the "sampled lighting" proof: the real WebGPU engine on one lit square under
// eight contract lights — more than the samples a moving pixel shades — rendered at rest until
// held, then under a sub-pixel camera shake that keeps every image moving.
// Nothing internal is read: lights go through the host store, images through `capture`.
import * as THREE from 'three';
import { createSceneLightStore } from '../../packages/sdk-core/index.ts';
import { webgpuPagesBackend } from '../../packages/sdk-browser/webgpuPages.ts';
import {
  VIEWPORT,
  batisseur,
  carre,
  cameraFace,
  image,
  libere,
  engine,
} from './preuveSceneCommune.mjs';
import { executerAccumulation } from './preuveAppareil.mjs';

/** Maximum images rendered before giving up waiting for frame hold. */
const PLAFOND = 64;
/** Moving images rendered under the shake: enough for the history to settle again. */
const SECOUSSES = 24;
/** Contract lights on a ring in front of the square: two colours, so a drawn subset of them
 *  differs from the whole in chroma, never only in brightness. */
const LAMPES = 8;

/** One grey, rough, lit square facing the camera. */
function scene() {
  const bati = batisseur();
  const plan = new THREE.Mesh(
    carre(1.2),
    new THREE.MeshStandardMaterial({ color: 0x9a9a9a, roughness: 0.7, metalness: 0 }),
  );
  plan.name = 'plan';
  bati.source.add(plan);
  bati.ajoute(plan, 'exact-clusters', 1.2);
  return bati.fini();
}

/** The ring of lights, declared to the host store as any host would. */
function lampes(store) {
  for (let i = 0; i < LAMPES; i++) {
    const angle = (i / LAMPES) * Math.PI * 2;
    store.add({
      id: `lampe-${i}`,
      kind: 'point',
      position: [Math.cos(angle) * 0.8, Math.sin(angle) * 0.8, 1.2],
      color: i % 2 ? [0.2, 0.3, 1] : [1, 0.35, 0.2],
      intensity: 1.2,
      range: 4,
      castsShadow: false,
    });
  }
}

/** Renders until the image is held; returns the held image and how many images it took. */
async function jusquaTenue(backend, camera) {
  for (let i = 0; i < PLAFOND; i++) {
    const { pixels, metriques } = await image(backend, camera);
    if (metriques.frameHeld) return { tenue: Array.from(pixels), rendues: i };
  }
  return { tenue: null, rendues: PLAFOND };
}

/** A full run: at rest, then shaken. `temporel` picks the option. */
async function executionComplete(device, evenements, temporel) {
  const s = scene(),
    store = createSceneLightStore();
  lampes(store);
  const { backend, canvas } = engine(webgpuPagesBackend, s, device, (e) => evenements.push(e), {
    temporalAntialiasing: temporel,
    sceneLights: store,
  });
  try {
    await backend.prepare();
    const arret = await jusquaTenue(backend, cameraFace());
    // The shake: a hair to the left, then to the right, a hundredth of a pixel at this
    // distance. Every image moves, none is held, and the pose never leaves the still one.
    const secousses = [];
    let tenues = 0;
    for (let i = 1; i <= SECOUSSES; i++) {
      const { pixels, metriques } = await image(backend, cameraFace(i % 2 ? 0.0003 : -0.0003));
      secousses.push(Array.from(pixels));
      if (metriques.frameHeld) tenues++;
    }
    return { arret, premiere: secousses[0], derniere: secousses[SECOUSSES - 1], tenues };
  } finally {
    libere(backend, canvas, s);
  }
}

/** Without, with, and with again as the A/A witness; the viewport and the light count. */
export async function executer() {
  const resultat = await executerAccumulation(executionComplete);
  return { viewport: VIEWPORT, lampes: LAMPES, ...resultat };
}
