// Ce que les scènes des preuves navigateur partagent : un carré indexé, le plus petit DAG légal
// qui le décrit, et la caméra de face. Rien n'y nomme une scène du banc — le moteur ne voit que des
// passes et des matériaux, comme pour n'importe quelle scène importée.
import * as THREE from 'three';
import { ouvrirAppareil } from '../../packages/sdk-browser/bench/justesse/appareilWebgpu.mjs';

export const VIEWPORT = [96, 96];

/** Un carré indexé de demi-côté `demi` dans le plan `z = 0`, ses deux triangles déjà bornés. */
export function carre(demi) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    'position',
    new THREE.Float32BufferAttribute(
      [-demi, -demi, 0, demi, -demi, 0, demi, demi, 0, -demi, demi, 0],
      3,
    ),
  );
  geometry.setIndex([0, 1, 2, 0, 2, 3]);
  geometry.computeBoundingBox();
  return geometry;
}

/**
 * Le bâtisseur d'une scène préparée : chaque maillage ajouté devient une primitive de deux clusters
 * de niveau 0 que rien ne remplace — le plus petit DAG légal —, un triangle chacun.
 */
export function batisseur() {
  const source = new THREE.Group(),
    indices = new Map(),
    associations = new Map(),
    primitives = [],
    geometries = [],
    materials = [];
  return {
    source,
    ajoute(mesh, pass, demi) {
      const rang = primitives.length,
        rayon = demi * Math.SQRT2;
      const pages = [0, 1].map((id) => ({
        id,
        url: `carreau-${rang}-${id}`,
        count: 3,
        bytes: 12,
        sha256: 'preuve',
        min: [-demi, -demi, 0],
        max: [demi, demi, 0],
        role: 'exact',
        start: id * 3,
        level: 0,
        lodError: 0,
        sphere: [0, 0, 0, rayon],
        parentError: null,
        parentSphere: null,
        group: null,
        source: null,
      }));
      primitives.push({
        mesh: rang,
        primitive: 0,
        pass,
        clusterStrategy: 'dag-groups',
        pages,
        structure: { version: 1, roots: [0, 1], groups: [] },
      });
      const triangles = mesh.geometry.index.array;
      for (const page of pages)
        indices.set(page.url, new Uint32Array(triangles.slice(page.start, page.start + 3)));
      associations.set(mesh, { meshes: rang, primitives: 0 });
      geometries.push(mesh.geometry);
      materials.push(mesh.material);
    },
    fini() {
      source.updateMatrixWorld(true);
      return {
        source,
        metadata: { errorModel: 'dag-group-qem-v1', clusterStrategy: 'dag-groups', primitives },
        indices,
        associations,
        geometries,
        materials,
      };
    },
  };
}

/** La caméra des preuves : de face, translatée sur `x` sans changer d'axe optique — une glissade
 *  pure, où la parallaxe seule sépare le proche du lointain. */
export function cameraFace(x = 0) {
  const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 100);
  camera.position.set(x, 0, 3);
  camera.lookAt(x, 0, 0);
  camera.updateMatrixWorld(true);
  return camera;
}

/** Le moteur WebGPU réel monté sur une scène bâtie, avec sa propre toile. `options` complète le
 *  contexte de l'hôte — `stageProfile: true` pour lire les compteurs publics par étape. */
export function moteur(webgpuPagesBackend, scene, device, onDiagnostic, options = {}) {
  const canvas = document.createElement('canvas');
  document.body.append(canvas);
  const backend = webgpuPagesBackend({
    source: scene.source,
    metadata: scene.metadata,
    indices: scene.indices,
    associations: scene.associations,
    gpuDevice: device,
    gpuCanvas: canvas,
    maxResidentPages: 16,
    viewport: [...VIEWPORT],
    clearColor: 0x000000,
    diagnosticDetail: 'summary',
    onDiagnostic,
    ...options,
  });
  return { backend, canvas };
}

/** Rend une image et relit ses pixels et ses compteurs publics. La borne d'image est refermée comme
 *  le fait un hôte : c'est elle qui publie les compteurs par étape. */
export async function image(backend, camera) {
  backend.render(camera);
  backend.cpuFrameEnd?.();
  await backend.flush();
  return { pixels: backend.capture(), metriques: backend.metrics() };
}

/** Les compteurs publics d'une étape du profil, ou `null` quand l'hôte ne l'a pas demandé. */
export function comptesEtape(backend, etape) {
  const profil = backend.stageProfile?.();
  return profil?.stages?.find((entree) => entree.stage === etape)?.counts ?? null;
}

/** Libère la scène et le moteur d'une preuve. */
export function libere(backend, canvas, scene) {
  backend.dispose();
  canvas.remove();
  for (const g of scene.geometries) g.dispose();
  for (const m of scene.materials) m.dispose();
}

/** Combien de quadruplets RGBA diffèrent entre deux images de même taille. */
export function difference(a, b) {
  let n = 0;
  for (let i = 0; i < a.length; i += 4)
    if (a[i] !== b[i] || a[i + 1] !== b[i + 1] || a[i + 2] !== b[i + 2] || a[i + 3] !== b[i + 3])
      n++;
  return n;
}

/** Le nombre de pixels qui portent le rouge du carreau plutôt que le bleu du fond. */
export function redCount(pixels) {
  let n = 0;
  for (let i = 0; i < pixels.length; i += 4)
    if (pixels[i] > 110 && pixels[i] > pixels[i + 2] + 40) n++;
  return n;
}

/**
 * L'enveloppe commune d'une preuve à deux passes (paginée, non paginée) : ouvre l'appareil, exécute
 * `sequence(device, pagine, evenements)` pour chacune, referme l'appareil. `sequence` porte toute la
 * mise en scène propre à la preuve ; cette fonction ne porte que ce que chaque preuve à deux passes
 * répète à l'identique.
 */
export async function executerPasses(sequence) {
  const appareil = await ouvrirAppareil();
  if (!appareil) return { indisponible: 'aucun adaptateur WebGPU' };
  const { device, erreurs } = appareil;
  const evenements = [],
    passes = {};
  try {
    for (const pagine of [false, true])
      passes[pagine ? 'pagine' : 'non-pagine'] = await sequence(device, pagine, evenements);
  } catch (error) {
    return { erreur: String(error) + (error?.stack ?? ''), passes, evenements, erreurs };
  }
  const info = await appareil.fermer();
  return { adaptateur: info.court, passes, evenements, erreurs };
}
