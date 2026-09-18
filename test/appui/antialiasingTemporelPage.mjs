// Côté page de la preuve « antialiasing temporel » : le vrai moteur WebGPU sur une scène de deux
// carreaux opaques — un fond bleu plein cadre et un carreau rouge tourné, dont les bords sont
// obliques —, rendu avec et sans accumulation temporelle : à l'arrêt, sous un panoramique de
// caméra, puis après un déplacement du carreau.
// Rien d'interne n'est lu : `setTransform` d'un côté, les pixels relus et `frameHeld` de l'autre.
import * as THREE from 'three';
import { webgpuPagesBackend } from '../../packages/sdk-browser/webgpuPages.ts';
import {
  VIEWPORT,
  batisseur,
  carre,
  cameraFace,
  image,
  libere,
  moteur,
  versApi,
} from './preuveSceneCommune.mjs';
import { ouvrirAppareil } from '../justesse/appareilWebgpu.mjs';

/** Images rendues au plus avant d'abandonner l'attente de la tenue. */
const PLAFOND = 64;

/** Le fond et le carreau rouge, celui-ci tourné d'un tiers de radian : ses bords sont obliques. */
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

/** Rend jusqu'à ce que l'image soit tenue ; rend la dernière image RENDUE, la tenue, et le compte. */
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

/** Le déplacement du carreau : la même rotation, poussée de 0,5 sur `x`. */
const deplace = () => versApi(new THREE.Matrix4().makeRotationZ(0.33).setPosition(0.5, 0, 0));

/** Une exécution complète : à l'arrêt, puis après déplacement. `temporel` choisit l'option. */
async function executionComplete(device, evenements, temporel) {
  const s = scene(),
    propres = [];
  const { backend, canvas } = moteur(
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
    // Panoramique : la caméra glisse d'environ deux tiers de pixel par image, seize images durant.
    // Rien n'est tenu ; la dernière image rendue est celle qu'on relit.
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
  if (!appareil) return { indisponible: 'aucun adaptateur WebGPU' };
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
