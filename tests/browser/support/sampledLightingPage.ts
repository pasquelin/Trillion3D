// Page side of the "sampled lighting" proof: the real WebGPU engine on one lit square under
// eight contract lights — more than the samples a moving pixel shades — rendered at rest until
// held, then under a sub-pixel camera shake that keeps every image moving.
// Nothing internal is read: lights go through the host store, images through `capture`.
import * as THREE from 'three';
import { createSceneLightStore } from '../../../packages/sdk-core/src/index.ts';
import type { SceneLightStore } from '../../../packages/sdk-core/src/index.ts';
import { webgpuPagesBackend } from '../../../packages/sdk-browser/src/webgpu/pages/pages.ts';
import { VIEWPORT, batisseur, carre, cameraFace, libere, engine } from './sharedSceneProof.ts';
import { image, jusquaTenue } from './sceneImageProof.ts';
import { executerAccumulation } from './deviceProof.ts';

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
function lampes(store: SceneLightStore) {
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

/** A full run: at rest, then shaken. `temporel` picks the option. */
async function executionComplete(device: GPUDevice, evenements: unknown[], temporel: boolean) {
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
