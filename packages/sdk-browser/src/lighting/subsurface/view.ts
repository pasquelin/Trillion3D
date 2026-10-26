import { ledgerAdmitted } from '../../gpu/core/deviceLedger.ts'
import { retire } from '../../gpu/core/frameRetire.ts'
import { textureBytesOf } from '../../gpu/core/textureBytes.ts'
import { createWebgpuBindIdentity, type WebgpuBindIdentity } from '../../gpu/bind/bindIdentity.ts'
import { ceilDiv } from '../../../../math/src/scalar/integers.ts'
import { SUBSURFACE_PASS } from '../../diagnostic/stage/passLabels.ts'
import {
  SSS_ARGS,
  SSS_COLOUR_FORMAT,
  SSS_IDS_FORMAT,
  SSS_PARAMS_BYTES,
  SSS_TILE_TYPES,
} from './layout.ts'
import type { SubsurfaceViewSpec } from './plan.ts'

/** The textures a view holds: the setup (every mip, and one view of each), the two scattering targets, the quality history's pair, the
 *  profile ids and the recombined image. */
export interface SubsurfaceTextures {
  readonly setup: GPUTextureView
  readonly setupMips: readonly GPUTextureView[]
  readonly pass1: GPUTextureView
  readonly pass2: GPUTextureView
  readonly history: readonly [GPUTextureView, GPUTextureView] | undefined
  readonly ids: GPUTextureView | undefined
  readonly recombined: GPUTextureView
}

/** The buffers: the lists' counts, the lists, the masks, the arguments of the dispatches and of the draws, the uniform. */
interface SubsurfaceBuffers {
  readonly counts: GPUBuffer
  readonly lists: GPUBuffer
  readonly masks: GPUBuffer
  readonly dispatch: GPUBuffer
  readonly draw: GPUBuffer
  readonly params: GPUBuffer
}

/**
 * A VIEW'S SUBSURFACE RESOURCES, made for a spec (`ensureSubsurfaceView`) and kept while the spec holds: its textures and buffers, the
 * bind groups over the resources the image names (`identity`, one set for each it has met) and the bytes it holds. Held on the view's
 * GPU state, counted in its bytes.
 */
export interface SubsurfaceView {
  readonly spec: SubsurfaceViewSpec
  readonly textures: SubsurfaceTextures
  readonly buffers: SubsurfaceBuffers
  readonly identity: WebgpuBindIdentity
  groups: unknown[]
  readonly bytes: number
  dispose(): void
}

const STORED = () => GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING

/** The textures of `spec`, asked of `make` (name, size, format, usage, mips). */
function texturesOf(
  spec: SubsurfaceViewSpec,
  make: (
    name: string,
    size: readonly number[],
    format: GPUTextureFormat,
    usage: number,
    mips?: number,
  ) => GPUTexture,
): SubsurfaceTextures {
  const { sub } = spec
  const stored = (name: string, mips = 1) => make(name, sub, SSS_COLOUR_FORMAT, STORED(), mips)
  const recombined = make(
    'recombined',
    spec.scene,
    SSS_COLOUR_FORMAT,
    GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
  )
  const setup = stored('setup', spec.mips)
  const history = spec.history ? ([stored('history 0'), stored('history 1')] as const) : undefined
  const ids = spec.ids ? make('ids', sub, SSS_IDS_FORMAT(spec.tier1), STORED()) : undefined
  return {
    setup: setup.createView(),
    setupMips: Array.from({ length: spec.mips }, (_, level) =>
      setup.createView({ baseMipLevel: level, mipLevelCount: 1 }),
    ),
    pass1: stored('pass 1').createView(),
    pass2: stored('pass 2').createView(),
    history: history && [history[0].createView(), history[1].createView()],
    ids: ids?.createView(),
    recombined: recombined.createView(),
  }
}

/** The bytes a view of `spec` holds: the textures, counted over descriptors, and the buffers. */
export function subsurfaceViewBytes(spec: SubsurfaceViewSpec) {
  let bytes = 0
  texturesOf(spec, (_name, size, format, _usage, mips = 1) => {
    bytes += textureBytesOf({ size: [...size], format, mipLevelCount: mips }) ?? 0
    return { createView: () => undefined } as unknown as GPUTexture
  })
  return bytes + buffersBytes(spec)
}

const buffersWords = (spec: SubsurfaceViewSpec) => ({
  counts: 4 * 2,
  lists: SSS_TILE_TYPES * spec.capacity,
  masks: 3 * ceilDiv(spec.capacity, 32),
  dispatch: SSS_ARGS.entries * 3,
  draw: SSS_TILE_TYPES * 4,
  params: SSS_PARAMS_BYTES / 4,
})
const buffersBytes = (spec: SubsurfaceViewSpec) =>
  Object.values(buffersWords(spec)).reduce((sum, words) => sum + Math.max(16, words * 4), 0)

/** The view of `spec`, made on `device`. */
function makeView(device: GPUDevice, spec: SubsurfaceViewSpec, bytes: number): SubsurfaceView {
  const made: { destroy(): void }[] = []
  const texture = (
    name: string,
    size: readonly number[],
    format: GPUTextureFormat,
    usage: number,
    mipLevelCount = 1,
  ) => {
    const created = device.createTexture({
      label: `${SUBSURFACE_PASS} ${name}`,
      size: [...size],
      format,
      usage,
      mipLevelCount,
    })
    made.push(created)
    return created
  }
  const words = buffersWords(spec)
  const { STORAGE, COPY_DST, INDIRECT, UNIFORM } = GPUBufferUsage
  const buffer = (name: keyof typeof words, usage: number) => {
    const created = device.createBuffer({
      label: `${SUBSURFACE_PASS} ${name}`,
      size: Math.max(16, words[name] * 4),
      usage,
    })
    made.push(created)
    return created
  }
  const textures = texturesOf(spec, texture)
  const buffers: SubsurfaceBuffers = {
    counts: buffer('counts', STORAGE | COPY_DST),
    lists: buffer('lists', STORAGE),
    masks: buffer('masks', STORAGE | COPY_DST),
    dispatch: buffer('dispatch', STORAGE | INDIRECT),
    draw: buffer('draw', STORAGE | INDIRECT),
    params: buffer('params', UNIFORM | COPY_DST),
  }
  return {
    spec,
    textures,
    buffers,
    identity: createWebgpuBindIdentity(4),
    groups: [],
    bytes,
    dispose: () =>
      retire(device, { destroy: () => made.forEach((resource) => resource.destroy()) }),
  }
}

/**
 * The view of `spec`: `held` while it is made for the same, else made, `held` given back — made where the device's budget leaves room
 * (`ledgerAdmitted`); none where it does not, with the reason.
 */
export function ensureSubsurfaceView(
  held: SubsurfaceView | undefined,
  device: GPUDevice,
  spec: SubsurfaceViewSpec,
): { view?: SubsurfaceView; why?: string } {
  if (held && held.spec.key === spec.key) return { view: held }
  const asked = subsurfaceViewBytes(spec)
  const { value, why } = ledgerAdmitted(device, {
    held,
    asked,
    what: 'the subsurface scattering',
    make: () => makeView(device, spec, asked),
  })
  return { view: value, why }
}
