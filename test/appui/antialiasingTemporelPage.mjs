// Page side of the "temporal antialiasing" proof: the real WebGPU engine on a scene of two
// opaque tiles — a full-frame blue background and a rotated red tile, whose edges are oblique —
// rendered with and without temporal accumulation: at rest, under a camera pan, then after a
// move of the tile.
// Nothing internal is read: `setTransform` on one side, reread pixels and `frameHeld` on the other.
import * as THREE from 'three';
import { webgpuPagesBackend } from '../../packages/sdk-browser/webgpuPages.ts';
import {
  VIEWPORT,
  batisseur,
  carre,
  cameraFace,
  image,
  libere,
  engine,
  versApi,
} from './preuveSceneCommune.mjs';
import { ouvrirAppareil } from '../justesse/appareilWebgpu.mjs';

/** Maximum images rendered before giving up waiting for frame hold. */
const PLAFOND = 64;

/** The background and the red tile, the latter rotated by a third of a radian: its edges are oblique. */
function scene() {
  const bati = batisseur();
  const fond = new THREE.Mesh(carre(4), new THREE.MeshBasicMaterial({ color: 0x1b3a5c }));
  fond.name = 'fond';
  fond.position.z = -2;
  bati.source.add(fond);
  bati.ajoute(fond, 'exact-clusters', 4);
  const rouge = new THREE.Mesh(carre(0.6), new THREE.MeshBasicMaterial({ color: 0xff2020 }));
  rouge.name = 'carre';
  rouge.rotation.z = 0.33;
  bati.source.add(rouge);
  bati.ajoute(rouge, 'exact-clusters', 0.6);
  return bati.fini();
}

/** Renders until the image is held; returns the last RENDERED image, the held one, and the count. */
async function jusquaTenue(backend, camera) {
  let rendue,
    rendues = 0;
  for (let i = 0; i < PLAFOND; i++) {
    const { pixels, metriques } = await image(backend, camera);
    if (metriques.frameHeld) return { rendue, tenue: Array.from(pixels), rendues };
    rendue = Array.from(pixels);
    rendues++;
  }
  return { rendue, tenue: null, rendues };
}

/** The tile's move: the same rotation, pushed 0.5 on `x`. */
const deplace = () => versApi(new THREE.Matrix4().makeRotationZ(0.33).setPosition(0.5, 0, 0));

/** A full run: at rest, then after a move. `temporel` picks the option. */
async function executionComplete(device, evenements, temporel) {
  const s = scene(),
    propres = [];
  const { backend, canvas } = engine(
    webgpuPagesBackend,
    s,
    device,
    (e) => {
      propres.push(e);
      evenements.push(e);
    },
    { temporalAntialiasing: temporel },
  );
  const camera = cameraFace();
  try {
    await backend.prepare();
    const arret = await jusquaTenue(backend, camera);
    // Pan: the camera slides about two thirds of a pixel per frame, for sixteen frames.
    // Nothing is held; the last rendered image is the one we reread.
    let panoramique;
    for (let i = 1; i <= 16; i++) {
      const glissee = cameraFace(0.02 * i);
      panoramique = Array.from((await image(backend, glissee)).pixels);
    }
    backend.setTransform('carre', deplace());
    const deplacement = await jusquaTenue(backend, camera);
    const capacites = propres.find((e) => e.phase === 'render-capabilities')?.context ?? null;
    return { arret, panoramique, deplacement, capacites };
  } finally {
    libere(backend, canvas, s);
  }
}

export async function executer() {
  const appareil = await ouvrirAppareil();
  if (!appareil) return { indisponible: 'no WebGPU adapter' };
  const { device, erreurs } = appareil;
  const evenements = [];
  try {
    const sans = await executionComplete(device, evenements, false);
    const avec = await executionComplete(device, evenements, true);
    const temoin = await executionComplete(device, evenements, true);
    const info = await appareil.fermer();
    return {
      adaptateur: info.court,
      viewport: VIEWPORT,
      sans,
      avec,
      temoin,
      evenements: evenements.filter((e) => /failed|error|unavailable/.test(e.phase)),
      erreurs,
    };
  } catch (error) {
    return { erreur: String(error) + (error?.stack ?? ''), evenements, erreurs };
  }
}
