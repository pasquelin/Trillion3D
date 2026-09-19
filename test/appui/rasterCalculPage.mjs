// Page side of the proof "the compute raster is watertight": the same scene rendered by the
// hardware raster, then by the compute raster under its two variants — the whole cut, then the
// small/large split — and the images compared pixel by pixel. Each builder tile is two
// triangles that share a diagonal, in two distinct clusters: that is the shared edge par
// excellence, under every slope. One more tile crosses the near plane, so that the clip
// and its shards are part of it.
//
// What is allowed between the two images: the silhouette band of the HARDWARE image alone —
// a pixel whose neighbourhood carries both coverage and background, where two fill
// rules can differ by one pixel. The band is read on an image the compute has not
// touched: a stray triangle in the middle of the background or a crack in the middle of a
// tile fall outside the band, and count.
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
  engine,
} from './preuveSceneCommune.mjs';

/** Pixels of one world unit at this distance from the face-on camera, 55° vertical aperture. */
const pixelsParUnite = (distance) =>
  VIEWPORT[1] / 2 / Math.tan((55 / 2) * (Math.PI / 180)) / distance;

/** Tiles tilted at angles that do not repeat, plus one that crosses the near plane. */
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
  // A face-on tile, unrotated, whose corners fall on pixel corners: its 45° diagonal
  // passes through the CENTRE of each pixel it crosses. A pixel exactly on a shared
  // edge is the one two inclusive rules can leave to nobody: the dotted crack.
  const face = new THREE.Mesh(carre(24 / pixelsParUnite(3)), material);
  face.name = 'face';
  face.position.set(0, 0, 0);
  bati.source.add(face);
  bati.ajoute(face, 'exact-clusters', 0.8);
  // A huge tile behind the others, whose vertices fall thousands of pixels outside the
  // image and whose diagonal crosses it: that is where derived weights round enough
  // to open a crack between its two triangles.
  const immense = new THREE.Mesh(carre(60), material);
  immense.name = 'immense';
  immense.position.set(1.3, -0.8, -1.5);
  immense.rotation.set(0.05, 0.02, 0.35);
  bati.source.add(immense);
  bati.ajoute(immense, 'exact-clusters', 60);
  // A large tile whose one corner goes behind the eye: the camera is at z = 3, the near
  // plane at z = 2.9; tilted 60°, it crosses that plane in the middle of the image.
  const proche = new THREE.Mesh(carre(3), material);
  proche.name = 'proche';
  proche.position.set(0, -2.2, 2.95);
  proche.rotation.set(0, Math.PI / 3, 0);
  bati.source.add(proche);
  bati.ajoute(proche, 'exact-clusters', 3);
  return bati.fini();
}

const estFond = (pixels, i) => pixels[i] === 0 && pixels[i + 1] === 0 && pixels[i + 2] === 0;

/** Silhouette band of an image: a pixel whose 3×3 neighbourhood carries both background and
 *  coverage. Read on the hardware image alone. */
function bandeDeSilhouette(pixels) {
  const [largeur, hauteur] = VIEWPORT,
    bande = new Uint8Array(largeur * hauteur);
  for (let y = 0; y < hauteur; y++)
    for (let x = 0; x < largeur; x++) {
      let fond = false,
        couvert = false;
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx,
            yy = y + dy;
          if (xx < 0 || yy < 0 || xx >= largeur || yy >= hauteur) continue;
          if (estFond(pixels, (yy * largeur + xx) * 4)) fond = true;
          else couvert = true;
        }
      bande[y * largeur + x] = fond && couvert ? 1 : 0;
    }
  return bande;
}

/** Pixels that differ: counted on the band, listed as `[x, y]` outside the band. */
function compare(materiel, calcul, bande) {
  let silhouettes = 0;
  const interieurs = [];
  for (let p = 0; p < bande.length; p++) {
    const i = p * 4;
    if (
      materiel[i] === calcul[i] &&
      materiel[i + 1] === calcul[i + 1] &&
      materiel[i + 2] === calcul[i + 2]
    )
      continue;
    if (bande[p]) silhouettes++;
    else interieurs.push([p % VIEWPORT[0], Math.floor(p / VIEWPORT[0])]);
  }
  return { silhouettes, interieurs };
}

async function rendu(device, onDiag, options) {
  const scene = sceneCarreaux();
  const { backend, canvas } = engine(webgpuPagesBackend, scene, device, onDiag, {
    maxResidentPages: 32,
    ...options,
  });
  try {
    await backend.prepare();
    const camera = cameraFace(0);
    // Two frames: the first places the occluder history, the second plays both halves.
    await image(backend, camera);
    const { pixels, metriques } = await image(backend, camera);
    return { pixels: pixels.slice(), metriques };
  } finally {
    libere(backend, canvas, scene);
  }
}

export async function executer() {
  const appareil = await ouvrirAppareil();
  if (!appareil) return { indisponible: 'no WebGPU adapter' };
  const { device, erreurs } = appareil;
  const evenements = [],
    onDiag = (e) => evenements.push(e);
  try {
    const materiel = await rendu(device, onDiag, {});
    const bande = bandeDeSilhouette(materiel.pixels);
    // The two ways of handing triangles to compute: the whole cut, or small ones only —
    // the reference split, where each triangle has exactly one of the two rasters.
    const variantes = {};
    for (const variante of ['raster-calcul', 'raster-hybride']) {
      const calcul = await rendu(device, onDiag, {
        diagnosticDetail: 'trace',
        diagnosticGpuVariant: variante,
      });
      variantes[variante] = {
        clusters: calcul.metriques.clusters,
        ...compare(materiel.pixels, calcul.pixels, bande),
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
