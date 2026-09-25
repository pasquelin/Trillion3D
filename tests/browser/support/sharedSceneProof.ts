// What the browser-proof scenes share: an indexed square, the smallest legal DAG
// that describes it, and the face-on camera. Nothing names a bench scene — the engine
// only sees passes and materials, as for any imported scene.
import * as G from '../../../packages/sdk-browser/src/host/graph/graph.fixture.ts';
import type {
  BackendContext,
  BackendDiagnostic,
  BackendFactory,
  RenderBackend,
} from '../../../packages/sdk-browser/src/backend/types.ts';
import { DAG } from '../../../packages/sdk-browser/src/backend/pagesBackend.fixture.ts';
import type {
  ClusterManifest,
  ClusterStructure,
  Page,
  Primitive,
} from '../../../packages/sdk-core/src/index.ts';

export const VIEWPORT: [number, number] = [96, 96];

/** An indexed square of half-side `demi` in the plane `z = 0`, its two triangles already bounded. */
export function carre(demi: number): G.Geometry {
  const geometry = new G.Geometry();
  geometry.setAttribute(
    'position',
    G.floatAttribute([-demi, -demi, 0, demi, -demi, 0, demi, demi, 0, -demi, demi, 0], 3),
  );
  geometry.setIndex(G.indices([0, 1, 2, 0, 2, 3]));
  geometry.computeBoundingBox();
  return geometry;
}

/**
 * Builder of a prepared scene: each added mesh becomes a primitive of two level-0
 * clusters that nothing replaces — the smallest legal DAG — one triangle each.
 */
export function batisseur() {
  const source = new G.Group(),
    indices = new Map<string, Uint32Array>(),
    associations = new Map<G.Object3D, { meshes?: number; primitives?: number }>(),
    primitives: Primitive[] = [],
    geometries: G.Geometry[] = [],
    materials: G.GraphSurface[] = [];
  return {
    source,
    ajoute(mesh: G.GraphMesh, pass: string, demi: number) {
      const rang = primitives.length,
        rayon = demi * Math.SQRT2;
      const pages: Page[] = [0, 1].map((id) => ({
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
      const structure: ClusterStructure = { version: 1, roots: [0, 1], groups: [] };
      primitives.push({
        mesh: rang,
        primitive: 0,
        pass,
        clusterStrategy: 'dag-groups',
        pages,
        structure,
      });
      const triangles = mesh.geometry.index!.array;
      for (const page of pages)
        indices.set(page.url, new Uint32Array(triangles.slice(page.start, page.start! + 3)));
      associations.set(mesh, { meshes: rang, primitives: 0 });
      geometries.push(mesh.geometry);
      materials.push(mesh.material as G.GraphSurface);
    },
    fini() {
      source.updateMatrixWorld(true);
      // The identity fields (`schema`, `status`, `key`, `scope`, the triangle/node counts) are
      // not read by this rig; `DAG` and these placeholders are the same minimal manifest the
      // engine's own scene fixtures use (`packages/sdk-browser/src/backend/pagesBackend.fixture.ts`).
      const metadata: ClusterManifest = {
        ...DAG,
        schema: 1,
        status: 'ready',
        key: 'proof-scene',
        scope: 'slice',
        sourceTriangles: primitives.length,
        selectedTriangles: primitives.length,
        selectedNodes: 0,
        totalNodes: primitives.length,
        primitives,
      };
      return {
        source,
        metadata,
        indices,
        associations,
        geometries,
        materials,
      };
    },
  };
}

/** A prepared scene as `batisseur().fini()` returns it. */
export type ScenePreparee = ReturnType<ReturnType<typeof batisseur>['fini']>;

/** A host-library matrix, column-major, ready for `setTransform`. */
export const versApi = (matrice: G.Matrix4): Float32Array => new Float32Array(matrice.elements);

/** The proofs camera: face-on, translated on `x` without changing the optical axis — a pure
 *  slide, where parallax alone separates near from far. */
export function cameraFace(x = 0): G.GraphCamera {
  const camera = G.perspectiveCamera(55, 1, 0.1, 100);
  camera.position.set(x, 0, 3);
  camera.lookAt(x, 0, 0);
  camera.updateMatrixWorld(true);
  return camera;
}

/** The real WebGPU engine mounted on a built scene, with its own canvas. `options` completes
 *  the host context — `stageProfile: true` to read the public per-stage counters. Proofs
 *  here compare images pixel for pixel and wait for a held image in a few frames:
 *  temporal antialiasing is off, except for the proof that chooses it. */
export function engine(
  webgpuPagesBackend: BackendFactory,
  scene: ScenePreparee,
  device: GPUDevice,
  onDiagnostic: (diagnostic: BackendDiagnostic) => void,
  options: Partial<BackendContext> = {},
): { backend: RenderBackend; canvas: HTMLCanvasElement } {
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

/** Public counters of a profile stage, or `null` when the host did not ask for it. */
export function comptesEtape(
  backend: RenderBackend,
  etape: string,
): Readonly<Record<string, number>> | null {
  const profil = backend.stageProfile?.();
  return profil?.stages?.find((input) => input.stage === etape)?.counts ?? null;
}

/** Releases the engine of a proof and its scene: geometries, materials and their textures. */
export function libere(
  backend: RenderBackend,
  canvas: HTMLCanvasElement,
  scene: ScenePreparee,
): void {
  backend.dispose();
  canvas.remove();
  releaseScene(scene);
}

/** Releases a prepared scene: its geometries, its materials and their textures. */
export function releaseScene(scene: ScenePreparee): void {
  for (const g of scene.geometries) g.dispose();
  for (const m of scene.materials) {
    // A material's texture-valued properties are not typed generically by three.js: read as
    // `unknown` and narrow at this one boundary.
    const valeurs: unknown[] = Object.values(m);
    for (const valeur of valeurs) {
      const texture = valeur as { isTexture?: boolean; dispose?: () => void } | undefined;
      if (texture?.isTexture) texture.dispose?.();
    }
    m.dispose();
  }
}
