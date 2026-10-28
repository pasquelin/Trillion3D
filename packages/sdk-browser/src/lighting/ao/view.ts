import { retire } from '../../gpu/core/frameRetire.ts'
import {
  countingAllocator,
  gpuAllocator,
  type ResourceAllocator,
} from '../../gpu/core/resourceAllocator.ts'
import { shapeView } from '../../gpu/core/shapeView.ts'
import { createWebgpuBindIdentity, type WebgpuBindIdentity } from '../../gpu/bind/bindIdentity.ts'
import { AMBIENT_OCCLUSION_PASS } from '../../diagnostic/stage/passLabels.ts'

/** A texture a method's passes draw into and read: its name, its size in texels and its format, and whether a compute pass
 *  writes it as a storage texture (`storage`) rather than a render pass drawing into it. */
interface AoTexture {
  readonly name: string
  readonly size: readonly [number, number]
  readonly format: GPUTextureFormat
  readonly storage?: boolean
}

/**
 * WHAT A METHOD ASKS OF A VIEW at the extent its targets are made at — never the size an image is drawn at in them, which a
 * render scale moves without remaking a thing —: the textures of its plan, and a uniform for each pass of it, `paramBytes`
 * big, written at each image, a pass drawn from a buffer of its own. Made once while the plan and the extent hold: a view
 * made for a spec is kept while it is that very object.
 */
export interface AoViewSpec {
  readonly textures: readonly AoTexture[]
  readonly passes: number
  readonly paramBytes: number
}

/**
 * A VIEW'S OCCLUSION, made for a spec (`ensureAoView`): its textures, the uniform of each pass, and the passes' bind
 * groups — one set for each of the resources the image reads that it has met (`identity`, the engine's one bind-group
 * cache), made again only where one of them moved. Held on the view's GPU state and counted in its bytes; given back
 * when the image needs it no more.
 */
export interface AoView {
  /** The spec the view was made for, or one the same as it that the plan has made since (`ensureAoView`). */
  spec: AoViewSpec
  /** The view of each texture of the plan: drawn into and read through. */
  readonly textures: Readonly<Record<string, GPUTextureView>>
  /** The uniform of each pass of the plan, in its order. */
  readonly params: readonly GPUBuffer[]
  /** The resources the groups name, and the groups made for them, by the identity's slot (`groupsOf`). */
  readonly identity: WebgpuBindIdentity
  readonly groups: GPUBindGroup[][]
  /** Bytes the textures and the uniforms hold. */
  readonly bytes: number
  /** Gives them back, destroyed once the image that names them is submitted (`retire`). */
  dispose(): void
}

/** How many of the resource sets the groups are made for a view keeps: the image's own, and another a view that
 *  alternates between two inputs comes back to. */
const KEPT_INPUTS = 2

/** The textures and the uniforms of `spec`, asked of `allocator`: the one list, made and counted. */
function allocate(allocator: ResourceAllocator, spec: AoViewSpec) {
  const drawn = GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING
  const stored = GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING
  const textures: Record<string, GPUTextureView> = {}
  for (const { name, size, format, storage } of spec.textures)
    textures[name] = allocator.texture(name, size, format, { usage: storage ? stored : drawn })
  const params = Array.from({ length: spec.passes }, (_, at) =>
    allocator.buffer(`pass ${at}`, spec.paramBytes / 4, 'uniform'),
  )
  return { textures, params }
}

/** The bytes a view of `spec` holds: the allocations themselves, counted. */
export function aoViewBytes(spec: AoViewSpec) {
  const counting = countingAllocator()
  allocate(counting, spec)
  return counting.bytes()
}

/** Whether two specs ask for the same textures and uniforms. */
function sameSpec(a: AoViewSpec, b: AoViewSpec) {
  if (a.passes !== b.passes || a.paramBytes !== b.paramBytes) return false
  if (a.textures.length !== b.textures.length) return false
  return a.textures.every(({ name, size, format, storage }, at) => {
    const other = b.textures[at]
    return (
      other.name === name &&
      other.format === format &&
      other.storage === storage &&
      other.size[0] === size[0] &&
      other.size[1] === size[1]
    )
  })
}

/** The view of `spec`: its textures, drawn into and read, and a uniform a pass. */
function makeView(device: GPUDevice, spec: AoViewSpec, bytes: number): AoView {
  const allocator = gpuAllocator(device, AMBIENT_OCCLUSION_PASS)
  const { textures, params } = allocate(allocator, spec)
  return {
    spec,
    textures,
    params,
    identity: createWebgpuBindIdentity(KEPT_INPUTS),
    groups: [],
    bytes,
    dispose: () => retire(device, allocator),
  }
}

/**
 * The view of `spec`: the one `held` while it asks for the same, else made, the old one given back — made where the device's
 * budget leaves room (`ledgerAdmitted`, the bytes the old one gives back credited); none where it does not, with the reason
 * (`why`, for the frame's metrics): the image is then lit without the occlusion. A setting that moves the plan without moving
 * what it draws into keeps the view.
 */
export function ensureAoView(
  held: AoView | undefined,
  device: GPUDevice,
  spec: AoViewSpec,
): { view?: AoView; why?: string } {
  const same = held !== undefined && (held.spec === spec || sameSpec(held.spec, spec))
  if (same) held.spec = spec
  return shapeView(held, device, {
    same,
    what: 'the ambient occlusion',
    bytes: () => aoViewBytes(spec),
    make: (asked) => makeView(device, spec, asked),
  })
}
