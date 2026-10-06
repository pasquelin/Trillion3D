import { Mesh } from '../../../packages/sdk-core/src/world/object/mesh.ts'
import * as G from '../../../packages/sdk-browser/src/host/graph/graph.fixture.ts'
import { surfaceOf } from '../../../packages/sdk-browser/src/page/surface.ts'
import { asHostLibrary, type HostMesh } from '../../../packages/sdk-browser/src/host/resources.ts'
import { surfaceColorAttachments } from '../../../packages/sdk-browser/src/webgpu/pages/prepare/attachments.ts'
import { deplaceInstance } from '../../../packages/sdk-browser/src/backend/autonomous/instancePose.ts'
import { createPageDraws } from '../../../packages/sdk-browser/src/backend/autonomous/pageDraws.ts'
import type { SurfaceBuffer } from '../../../packages/sdk-browser/src/scene/surfaceBuffer.ts'
import type {
  PageRec,
  ClusterRoot,
} from '../../../packages/sdk-browser/src/page/selection/types.ts'
import { measure, rapport } from '../../core/index.ts'
import { referenceAttachments, referenceUpdateInstance } from '../../oracles/browser/view-frame.ts'
import { Geometry } from '../../../packages/sdk-core/src/world/geometry/geometry.ts'
const DUMMY_TEXTURE = {} as GPUTexture
const buildSurfaces = (): SurfaceBuffer => {
  const views: GPUTextureView[] = [0, 1, 2, 3].map(() => ({}) as GPUTextureView)
  return {
    ...{ version: 1, width: 1, height: 1, allocationBytes: 0, hasSubsurface: false },
    ...{ baseMetal: DUMMY_TEXTURE, normalRough: DUMMY_TEXTURE, emissiveAo: DUMMY_TEXTURE },
    ...{ flags: DUMMY_TEXTURE, subsurface: DUMMY_TEXTURE, subsurfaceView: {} as GPUTextureView },
    ...{ hasEmissiveAo: true, receiver: DUMMY_TEXTURE, receiverView: {} as GPUTextureView },
    views: () => views,
    dispose: () => {},
  }
}
const small = buildSurfaces(),
  large = buildSurfaces()
const disposed: SurfaceBuffer = {
  ...buildSurfaces(),
  views: () => {
    throw new Error('SURFACE_DISPOSED')
  },
}
/** Each target's descriptors, or the error it refused with, in an array the wrapper keeps: the
 *  timed call stores references only, copied untimed by `readAttachments`. */
type Attachments = (GPURenderPassColorAttachment | null)[]
type Descriptors = (Attachments | string)[]
const eachAttachments = (fn: (surfaces: SurfaceBuffer) => Attachments) => {
  const output: Descriptors = []
  return (input: SurfaceBuffer[]) => {
    output.length = input.length
    for (let i = 0; i < input.length; i++) {
      try {
        output[i] = fn(input[i])
      } catch (error) {
        output[i] = error instanceof Error ? error.message : String(error)
      }
    }
    return output
  }
}
const readAttachments = (_: SurfaceBuffer[], output: Descriptors) =>
  output.map((item) =>
    typeof item === 'string'
      ? item
      : item.map((a) => a && { ...a, clearValue: [...(a.clearValue as number[])] }),
  )

const steadyFrames: SurfaceBuffer[] = []
for (let i = 0; i < 2000; i++) steadyFrames.push(small)
const resized = [small, small, large, large, small, disposed, large]

const DUMMY_ATTRIBUTES: G.Geometry['attributes'] = {}
const DUMMY_BOUNDS: number[] = [0, 0, 0]
const emptyMesh = () => new Mesh(new Geometry(), [])
/** A record with the host mesh its draw state carries (#1234). */
type Page = PageRec & { mesh?: HostMesh }
const pageOf = (mesh?: HostMesh): Page => ({
  ...{ id: 0, url: '', clusterId: '', triangles: 0, indexBytes: 0, depthLayer: 0 },
  min: DUMMY_BOUNDS,
  max: DUMMY_BOUNDS,
  attributes: DUMMY_ATTRIBUTES,
  material: surfaceOf([]),
  declaration: [],
  renderOrder: 0,
  mesh,
})
const instanceOf = (pages: number) => {
  const baseRoots: ClusterRoot<PageRec>[] = [],
    clones: Page[] = [],
    roots: ClusterRoot<PageRec>[] = []
  for (let i = 0; i < 10; i++) {
    baseRoots.push({ world: new G.Matrix4().makeScale(1 + i, 2, 3), pages: [] })
    roots.push({ world: new G.Matrix4(), pages: [] })
  }
  // Page `i` is placed by root `i % 10`: its mesh moves with that root (`deplaceInstance`).
  for (let i = 0; i < pages; i++) {
    clones.push(pageOf(i % 3 ? emptyMesh() : undefined))
    roots[i % 10].pages.push(clones[i])
  }
  const draws = createPageDraws(roots)
  for (const rec of clones) draws.drawing(rec).mesh = rec.mesh
  return { baseRoots, instance: { pages: clones, roots, draws } }
}
/** Two equal instances: the engine moves one, the oracle the other, so neither reads the
 *  other's writes as its own. */
const twoInstances = (pages: number) => ({ engine: instanceOf(pages), oracle: instanceOf(pages) })
const smallInstance = twoInstances(100),
  largeInstance = twoInstances(5000)
/** The engine's sixteen doubles, built once: the timed call allocates nothing of its own. */
const transformation = new Float64Array(
  new G.Matrix4().makeRotationY(0.7).multiply(new G.Matrix4().makeTranslation(3, -1, 2)).elements,
)

type Instance = ReturnType<typeof instanceOf>
type Instances = ReturnType<typeof twoInstances>

/** What a displacement leaves, read untimed: each page mesh's matrix, then each root's world. */
const readInstance = (_: Instances, { instance }: Instance) => {
  const output: number[] = []
  for (const rec of instance.pages) output.push(...(rec.mesh?.matrix.elements ?? []))
  for (const root of instance.roots) output.push(...Array.from(root.world.elements))
  return Float64Array.from(output)
}

const resAttachments = await measure({
  name: 'surface attachments',
  fichier: 'packages/sdk-browser/src/webgpu/pages/prepare/attachments.ts',
  cas: [
    { name: '2 000 frames without resize', input: steadyFrames, size: 2000 },
    { name: 'resizes and a disposed target', input: resized, size: 7 },
  ],
  calculation: eachAttachments(surfaceColorAttachments),
  expected: eachAttachments(referenceAttachments),
  lecture: readAttachments,
  options: { tours: 100, budgetMs: 1500 },
})

const resInstance = await measure({
  name: 'instance displacement',
  fichier: 'packages/sdk-browser/src/backend/autonomous/instancePose.ts',
  cas: [
    { name: '5 000 pages', input: largeInstance, size: 5000 },
    { name: '100 pages', input: smallInstance, size: 100 },
  ],
  calculation: ({ engine }: Instances) => {
    deplaceInstance(engine.instance, engine.baseRoots, transformation, engine.instance.draws)
    return engine
  },
  expected: ({ oracle }: Instances) => {
    referenceUpdateInstance(
      asHostLibrary<Parameters<typeof referenceUpdateInstance>[0]>(oracle.instance),
      asHostLibrary<Parameters<typeof referenceUpdateInstance>[1]>(oracle.baseRoots),
      transformation,
    )
    return oracle
  },
  lecture: readInstance,
  options: { tours: 100, budgetMs: 1500 },
})

rapport(
  'cadre-vue',
  [resAttachments, resInstance],
  'F10 and F12 yield the exact same descriptors and matrices',
)
