// What the engine-proof scenes share: an indexed square, the smallest legal DAG
// that describes it, and the face-on camera. Nothing names a bench scene — the engine
// only sees passes and materials, as for any imported scene.
import * as G from '../../../packages/sdk-browser/src/host/graph/graph.fixture.ts'
import type {
  EngineContext,
  EngineDiagnostic,
  EngineFactory,
  Engine,
} from '../../../packages/sdk-browser/src/engine/types.ts'
import { DAG } from '../../../packages/sdk-browser/src/engine/pagesEngine.fixture.ts'
import { webgpuPagesEngine } from '../../../packages/sdk-browser/src/webgpu/pages/pages.ts'
import type {
  ClusterManifest,
  ClusterStructure,
  Page,
  Primitive,
} from '../../../packages/sdk-core/src/index.ts'
import { graphDraws } from '../../../packages/sdk-browser/src/page/selection/drawSource.ts'
import { manifestCulling } from '../../../packages/sdk-browser/src/gpu/dag/culling.fixture.ts'

export const VIEWPORT: [number, number] = [96, 96]

/** An indexed square of half-side `half` in the plane `z = 0`, its two triangles already bounded. */
export function square(half: number): G.Geometry {
  const geometry = new G.Geometry()
  geometry.setAttribute(
    'position',
    G.floatAttribute([-half, -half, 0, half, -half, 0, half, half, 0, -half, half, 0], 3),
  )
  geometry.setIndex(G.indices([0, 1, 2, 0, 2, 3]))
  geometry.computeBoundingBox()
  return geometry
}

/** Builder of a prepared scene: each added mesh becomes a primitive of two level-0 clusters that
 *  nothing replaces — the smallest legal DAG — one triangle each, with the culling hierarchy the
 *  compiler writes (`manifestCulling`). `place` adds a square of half-side `half` (`square`, or a
 *  lit plane's `geometry`) wearing `surface`, at `position`, turned by `turn`, drawn in `pass`. */
export function batisseur() {
  const source = new G.Group(),
    indices = new Map<string, Uint32Array>(),
    associations = new Map<G.Object3D, { meshes?: number; primitives?: number }>(),
    primitives: Primitive[] = [],
    geometries: G.Geometry[] = [],
    materials: G.GraphSurface[] = []
  const builder = {
    source,
    place(
      surface: G.GraphSurface,
      pass: string,
      half: number,
      [x, y, z]: readonly number[] = [0, 0, 0],
      turn: Partial<Record<'x' | 'y' | 'z', number>> = {},
      geometry = square(half),
    ) {
      const mesh = G.mesh(geometry, surface)
      mesh.position.set(x, y, z)
      mesh.rotation.set(turn.x ?? 0, turn.y ?? 0, turn.z ?? 0)
      source.add(mesh)
      builder.add(mesh, pass, half)
      return mesh
    },
    add(mesh: G.HostMesh, pass: string, half: number) {
      const rank = primitives.length,
        radius = half * Math.SQRT2
      const pages: Page[] = [0, 1].map((id) => ({
        id,
        url: `carreau-${rank}-${id}`,
        count: 3,
        bytes: 12,
        sha256: 'proof',
        min: [-half, -half, 0],
        max: [half, half, 0],
        role: 'exact',
        start: id * 3,
        level: 0,
        lodError: 0,
        sphere: [0, 0, 0, radius],
        parentError: null,
        parentSphere: null,
        group: null,
        source: null,
      }))
      primitives.push({
        mesh: rank,
        primitive: 0,
        pass,
        clusterStrategy: 'dag-groups',
        pages,
        structure: { version: 1, roots: [0, 1], groups: [] } satisfies ClusterStructure,
        culling: manifestCulling(pages),
      })
      const triangles = mesh.geometry.index!.array
      for (const page of pages)
        indices.set(page.url, new Uint32Array(triangles.slice(page.start, page.start! + 3)))
      associations.set(mesh, { meshes: rank, primitives: 0 })
      geometries.push(mesh.geometry)
      materials.push(mesh.material as G.GraphSurface)
    },
    fini() {
      source.updateMatrixWorld(true)
      // The identity fields are not read by this rig: `DAG` and these placeholders are the minimal
      // manifest of the engine's own scene fixtures (`pagesEngine.fixture.ts`).
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
      }
      return {
        source,
        metadata,
        indices,
        associations,
        draws: graphDraws(source, associations),
        geometries,
        materials,
      }
    },
  }
  return builder
}

/** A prepared scene as `batisseur().fini()` returns it. */
export type ScenePreparee = ReturnType<ReturnType<typeof batisseur>['fini']>

/** A host-library matrix, column-major, ready for `setTransform`. */
export const toApiMatrix = (matrix: G.Matrix4): Float32Array => new Float32Array(matrix.elements)

/** The proofs camera: face-on, translated on `x` without changing the optical axis — a pure
 *  slide, where parallax alone separates near from far. */
export function cameraFace(x = 0): G.Camera {
  const camera = G.perspectiveCamera(55, 1, 0.1, 100)
  camera.position.set(x, 0, 3)
  camera.lookAt(x, 0, 0)
  camera.updateMatrixWorld(true)
  return camera
}

/** The real WebGPU engine mounted on a built scene, with its own canvas. `options` completes the
 *  host context — `stageProfile: true` to read the public per-stage counters. Proofs here compare
 *  images pixel for pixel and wait for a held image in a few frames: temporal antialiasing is off,
 *  except for the proof that chooses it. `factory` is another revision's engine, to compare two. */
export function engine(
  scene: ScenePreparee,
  device: GPUDevice,
  onDiagnostic: (diagnostic: EngineDiagnostic) => void,
  options: Partial<EngineContext> = {},
  factory: EngineFactory = webgpuPagesEngine,
): { backend: Engine; canvas: HTMLCanvasElement } {
  const canvas = document.createElement('canvas')
  document.body.append(canvas)
  const backend = factory({
    source: scene.source,
    metadata: scene.metadata,
    indices: scene.indices,
    draws: scene.draws,
    gpuDevice: device,
    gpuCanvas: canvas,
    maxResidentPages: 16,
    viewport: [...VIEWPORT],
    clearColor: 0x000000,
    diagnosticDetail: 'summary',
    temporalAntialiasing: false,
    onDiagnostic,
    ...options,
  })
  return { backend, canvas }
}

/** Releases the engine of a proof and its scene: geometries, materials and their textures; the
 *  engine's dispose, which may finish later, is returned. */
export function release(backend: Engine, canvas: HTMLCanvasElement, scene: ScenePreparee) {
  const disposed = backend.dispose()
  canvas.remove()
  releaseScene(scene)
  return disposed
}

/** Releases a prepared scene: its geometries, its materials and their textures. */
export function releaseScene(scene: ScenePreparee): void {
  for (const g of scene.geometries) g.dispose()
  for (const m of scene.materials) {
    // A material's texture-valued properties are untyped in the witness library: narrowed here.
    for (const value of Object.values(m) as unknown[]) {
      const texture = value as { isTexture?: boolean; dispose?: () => void } | undefined
      if (texture?.isTexture) texture.dispose?.()
    }
    m.dispose()
  }
}
