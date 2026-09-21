// Page side of the water-pass proof: the real WebGPU engine (`webgpuPagesBackend`), a real device,
// a real reread image. A transmissive tile in front of an opaque ground, or of nothing, rendered
// through the water pass and read at its centre; nothing internal is inspected.
import * as THREE from 'three';
import { webgpuPagesBackend } from '../../packages/sdk-browser/webgpuPages.ts';
import {
  VIEWPORT,
  batisseur,
  carre,
  cameraFace,
  difference,
  engine,
  image,
  libere,
} from './preuveSceneCommune.mjs';
import { ouvrirAppareil } from '../justesse/appareilWebgpu.mjs';
import { BACKGROUND, CASES, GROUND, WATER } from './waterPassCases.mjs';

function scene(pagine, kase) {
  const bati = batisseur();
  const fond = new THREE.Mesh(
    carre(4),
    new THREE.MeshBasicMaterial({
      color: new THREE.Color(...GROUND.color),
      side: THREE.DoubleSide,
    }),
  );
  fond.name = 'fond';
  fond.position.set(kase.groundX, 0, -GROUND.depth);
  bati.source.add(fond);
  bati.ajoute(fond, 'exact-clusters', 4);
  const eau = new THREE.Mesh(
    carre(1),
    Object.assign(
      new THREE.MeshPhysicalMaterial({
        color: new THREE.Color(...WATER.tint),
        transparent: true,
        opacity: 1,
        side: THREE.DoubleSide,
        roughness: 0.05,
      }),
      {
        transmission: kase.transmission,
        ior: WATER.ior,
        thickness: kase.thickness,
        attenuationDistance: WATER.attenuationDistance,
        attenuationColor: new THREE.Color(...WATER.attenuationColor),
      },
    ),
  );
  eau.name = 'eau';
  bati.source.add(eau);
  bati.ajoute(eau, pagine ? 'clustered-blend' : 'shared-blend', 1);
  return bati.fini();
}

/** RGB read at the tile's centre. Bottom-left origin, like `capture`. */
function centre(pixels) {
  const [w, h] = VIEWPORT,
    i = ((h >> 1) * w + (w >> 1)) * 4;
  return [pixels[i], pixels[i + 1], pixels[i + 2]];
}

/** One case: four frames of the same pose. The centre of each, the draws, and whether the last
 *  was held — a still scene must end with no work at all. */
async function cas(device, pagine, kase, evenements) {
  const s = scene(pagine, kase);
  const { backend, canvas } = engine(webgpuPagesBackend, s, device, (e) => evenements.push(e), {
    clearColor: BACKGROUND,
  });
  try {
    await backend.prepare();
    const camera = cameraFace();
    const frames = [];
    for (let i = 0; i < 4; i++) {
      const { pixels, metriques } = await image(backend, camera);
      frames.push({
        centre: centre(pixels),
        draws: metriques.transparentDrawCalls,
        held: metriques.frameHeld,
        moved: frames.length ? difference(frames[frames.length - 1].pixels, pixels) : 0,
        pixels,
      });
    }
    return {
      name: kase.name,
      pagine,
      centre: frames[0].centre,
      moved: frames.map((f) => f.moved),
      drawsFirst: frames[0].draws,
      drawsLast: frames[frames.length - 1].draws,
      heldLast: frames[frames.length - 1].held,
    };
  } finally {
    libere(backend, canvas, s);
  }
}

export async function executer() {
  const appareil = await ouvrirAppareil();
  if (!appareil) return { indisponible: 'no WebGPU adapter' };
  const { device, erreurs } = appareil;
  const evenements = [],
    cases = [];
  try {
    for (const pagine of [false, true])
      for (const kase of CASES) cases.push(await cas(device, pagine, kase, evenements));
  } catch (error) {
    return { erreur: String(error) + (error?.stack ?? ''), cases, evenements, erreurs };
  }
  const info = await appareil.fermer();
  return { adaptateur: info.court, cases, evenements, erreurs };
}
