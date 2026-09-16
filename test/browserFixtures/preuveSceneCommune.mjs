// Ce que les scènes des preuves navigateur partagent : un carré indexé, le plus petit DAG légal
// qui le décrit, et la caméra de face. Rien n'y nomme une scène du banc — le moteur ne voit que des
// passes et des matériaux, comme pour n'importe quelle scène importée.
import * as THREE from 'three';

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

/** Le moteur WebGPU réel monté sur une scène bâtie, avec sa propre toile. */
export function moteur(webgpuPagesBackend, scene, device, onDiagnostic) {
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
  });
  return { backend, canvas };
}

/** Rend une image et relit ses pixels et ses compteurs publics. */
export async function image(backend, camera) {
  backend.render(camera);
  await backend.flush();
  return { pixels: backend.capture(), metriques: backend.metrics() };
}

/** Libère la scène et le moteur d'une preuve. */
export function libere(backend, canvas, scene) {
  backend.dispose();
  canvas.remove();
  for (const g of scene.geometries) g.dispose();
  for (const m of scene.materials) m.dispose();
}
