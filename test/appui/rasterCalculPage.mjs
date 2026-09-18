// Côté page de la preuve « le raster de calcul est étanche » : la même scène rendue par le raster
// matériel, puis par le raster de calcul (variante `raster-calcul`), et les deux images comparées
// pixel à pixel. Chaque carreau du bâtisseur est deux triangles qui partagent une diagonale, dans
// deux clusters distincts : c'est l'arête partagée par excellence, sous toutes les pentes. Un
// carreau de plus traverse le plan proche, pour que la coupe et ses éclats soient de la partie.
//
// Ce qui est permis entre les deux images : la silhouette seule — un pixel dont un voisin est du
// fond dans l'image matérielle, là où les deux règles de remplissage peuvent différer d'un pixel.
// Un pixel qui diffère AU MILIEU d'un carreau est une fissure ou un triangle parasite.
import * as THREE from 'three';
import { webgpuPagesBackend } from '../../packages/sdk-browser/webgpuPages.ts';
import { ouvrirAppareil } from '../justesse/appareilWebgpu.mjs';
import {
  VIEWPORT,
  batisseur,
  cameraFace,
  carre,
  image,
  libere,
  moteur,
} from './preuveSceneCommune.mjs';

/** Des carreaux inclinés sous des angles qui ne se répètent pas, plus un qui traverse le plan proche. */
function sceneCarreaux() {
  const bati = batisseur();
  const material = new THREE.MeshBasicMaterial({ color: 0x20c040, side: THREE.DoubleSide });
  for (let i = 0; i < 12; i++) {
    const mesh = new THREE.Mesh(carre(0.45), material);
    mesh.name = `carreau-${i}`;
    mesh.position.set(((i % 4) - 1.5) * 0.7, (Math.floor(i / 4) - 1) * 0.7, -0.2 * (i % 3));
    mesh.rotation.set(0.3 * i, 0.17 * i, 0.61 * i);
    bati.source.add(mesh);
    bati.ajoute(mesh, 'exact-clusters', 0.45);
  }
  // Un carreau de face, non tourné, dont les coins tombent sur des coins de pixels : sa diagonale à
  // 45° passe par le CENTRE de chaque pixel qu'elle traverse. Un pixel exactement sur une arête
  // partagée est celui que deux règles inclusives peuvent laisser à personne : la fissure pointillée.
  const face = new THREE.Mesh(carre(24 / 30.73571403153866), material);
  face.name = 'face';
  face.position.set(0, 0, 0.6);
  bati.source.add(face);
  bati.ajoute(face, 'exact-clusters', 0.8);
  // Un carreau immense derrière les autres, dont les sommets tombent à des milliers de pixels hors de
  // l'image et dont la diagonale la traverse : c'est là que des poids dérivés arrondissent assez
  // pour ouvrir une fissure entre ses deux triangles.
  const immense = new THREE.Mesh(carre(60), material);
  immense.name = 'immense';
  immense.position.set(1.3, -0.8, -1.5);
  immense.rotation.set(0.05, 0.02, 0.35);
  bati.source.add(immense);
  bati.ajoute(immense, 'exact-clusters', 60);
  // Un grand carreau dont un coin passe derrière l'œil : la caméra est en z = 3, le plan proche en
  // z = 2,9 ; incliné de 60°, il traverse ce plan au milieu de l'image.
  const proche = new THREE.Mesh(carre(3), material);
  proche.name = 'proche';
  proche.position.set(0, -2.2, 2.95);
  proche.rotation.set(0, Math.PI / 3, 0);
  bati.source.add(proche);
  bati.ajoute(proche, 'exact-clusters', 3);
  return bati.fini();
}

const estFond = (pixels, i) => pixels[i] === 0 && pixels[i + 1] === 0 && pixels[i + 2] === 0;

/** Vrai quand l'un des huit voisins du pixel `i` est du fond dans `pixels` : une silhouette. */
function silhouette(pixels, i) {
  const [largeur, hauteur] = VIEWPORT,
    p = i / 4,
    x = p % largeur,
    y = Math.floor(p / largeur);
  for (let dy = -1; dy <= 1; dy++)
    for (let dx = -1; dx <= 1; dx++) {
      const xx = x + dx,
        yy = y + dy;
      if (xx < 0 || yy < 0 || xx >= largeur || yy >= hauteur) continue;
      if (estFond(pixels, (yy * largeur + xx) * 4)) return true;
    }
  return false;
}

/** Les pixels qui diffèrent, séparés entre silhouette et intérieur, et les intérieurs listés. */
function compare(materiel, calcul) {
  let silhouettes = 0;
  const interieurs = [];
  for (let i = 0; i < materiel.length; i += 4) {
    if (
      materiel[i] === calcul[i] &&
      materiel[i + 1] === calcul[i + 1] &&
      materiel[i + 2] === calcul[i + 2]
    )
      continue;
    if (silhouette(materiel, i) || silhouette(calcul, i)) silhouettes++;
    else interieurs.push((i / 4) % VIEWPORT[0], Math.floor(i / 4 / VIEWPORT[0]));
  }
  return { silhouettes, interieurs };
}

async function rendu(device, onDiag, options) {
  const scene = sceneCarreaux();
  const { backend, canvas } = moteur(webgpuPagesBackend, scene, device, onDiag, {
    maxResidentPages: 32,
    ...options,
  });
  try {
    await backend.prepare();
    const camera = cameraFace(0);
    // Deux images : la première pose l'historique d'occulteurs, la seconde joue les deux moitiés.
    await image(backend, camera);
    const { pixels, metriques } = await image(backend, camera);
    return { pixels: pixels.slice(), metriques };
  } finally {
    libere(backend, canvas, scene);
  }
}

export async function executer() {
  const appareil = await ouvrirAppareil();
  if (!appareil) return { indisponible: 'aucun adaptateur WebGPU' };
  const { device, erreurs } = appareil;
  const evenements = [],
    onDiag = (e) => evenements.push(e);
  try {
    const materiel = await rendu(device, onDiag, {});
    // Les deux façons de confier des triangles au calcul : toute la coupe, ou les petits seuls —
    // le partage de la référence, où chaque triangle a exactement un des deux rasters.
    const variantes = {};
    for (const variante of ['raster-calcul', 'raster-hybride']) {
      const calcul = await rendu(device, onDiag, {
        diagnosticDetail: 'trace',
        diagnosticGpuVariant: variante,
      });
      variantes[variante] = {
        clusters: calcul.metriques.clusters,
        ...compare(materiel.pixels, calcul.pixels),
      };
    }
    let couverts = 0;
    for (let i = 0; i < materiel.pixels.length; i += 4)
      if (!estFond(materiel.pixels, i)) couverts++;
    const info = await appareil.fermer();
    return {
      adaptateur: info.court,
      couverts,
      clusters: materiel.metriques.clusters,
      variantes,
      evenements,
      erreurs,
    };
  } catch (error) {
    return { erreur: String(error) + (error?.stack ?? ''), evenements, erreurs };
  }
}
