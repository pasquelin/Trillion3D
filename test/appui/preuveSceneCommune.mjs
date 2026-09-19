// What the browser-proof scenes share: an indexed square, the smallest legal DAG
// that describes it, and the face-on camera. Nothing names a bench scene — the engine
// only sees passes and materials, as for any imported scene.
import * as THREE from 'three';
import { ouvrirAppareil } from '../justesse/appareilWebgpu.mjs';

export const VIEWPORT = [96, 96];

/** An indexed square of half-side `demi` in the plane `z = 0`, its two triangles already bounded. */
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
 * Builder of a prepared scene: each added mesh becomes a primitive of two level-0
 * clusters that nothing replaces — the smallest legal DAG — one triangle each.
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

/** A host-library matrix, column-major, ready for `setTransform`. */
export const versApi = (matrice) => new Float32Array(matrice.elements);

/** The proofs camera: face-on, translated on `x` without changing the optical axis — a pure
 *  slide, where parallax alone separates near from far. */
export function cameraFace(x = 0) {
  const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 100);
  camera.position.set(x, 0, 3);
  camera.lookAt(x, 0, 0);
  camera.updateMatrixWorld(true);
  return camera;
}

/** The real WebGPU engine mounted on a built scene, with its own canvas. `options` completes
 *  the host context — `stageProfile: true` to read the public per-stage counters. Proofs
 *  here compare images pixel for pixel and wait for a held image in a few frames:
 *  temporal antialiasing is off, except for the proof that chooses it. */
export function engine(webgpuPagesBackend, scene, device, onDiagnostic, options = {}) {
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
    temporalAntialiasing: false,
    onDiagnostic,
    ...options,
  });
  return { backend, canvas };
}

/** Renders a frame and rereads its pixels and public counters. The frame bound is closed as
 *  a host does: that is what publishes the per-stage counters. */
export async function image(backend, camera) {
  backend.render(camera);
  backend.cpuFrameEnd?.();
  await backend.flush();
  return { pixels: backend.capture(), metriques: backend.metrics() };
}

/** Public counters of a profile stage, or `null` when the host did not ask for it. */
export function comptesEtape(backend, etape) {
  const profil = backend.stageProfile?.();
  return profil?.stages?.find((input) => input.stage === etape)?.counts ?? null;
}

/** Releases the scene and the engine of a proof. */
export function libere(backend, canvas, scene) {
  backend.dispose();
  canvas.remove();
  for (const g of scene.geometries) g.dispose();
  for (const m of scene.materials) m.dispose();
}

/** How many RGBA quadruplets differ between two images of the same size. */
export function difference(a, b) {
  let n = 0;
  for (let i = 0; i < a.length; i += 4)
    if (a[i] !== b[i] || a[i + 1] !== b[i + 1] || a[i + 2] !== b[i + 2] || a[i + 3] !== b[i + 3])
      n++;
  return n;
}

/** True when the pixel at `i` carries the tile's red and not the background's blue. */
export const estRouge = (pixels, i) => pixels[i] > 110 && pixels[i] > pixels[i + 2] + 40;

/** The number of pixels that carry the tile's red rather than the background's blue. */
export function redCount(pixels) {
  let n = 0;
  for (let i = 0; i < pixels.length; i += 4) if (estRouge(pixels, i)) n++;
  return n;
}

/**
 * Common envelope of a two-pass proof (paged, unpaged): opens the device, runs
 * `sequence(device, pagine, evenements)` for each, closes the device. `sequence` carries all
 * staging proper to the proof; this function only carries what every two-pass proof
 * repeats identically.
 */
export async function executerPasses(sequence) {
  const appareil = await ouvrirAppareil();
  if (!appareil) return { indisponible: 'no WebGPU adapter' };
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
