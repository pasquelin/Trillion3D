import { hizDepthBindEntries } from '../../visibility/hiz/gpu/pyramidTexture.ts'
import type { HizDepth } from '../../visibility/hiz/gpu/types.ts'
import { SSS_ARGUMENTS, SSS_BINDINGS, SSS_TEXTURES, SSS_TILES } from './layout.ts'
import type { subsurfacePrograms } from './pipelines.ts'
import type { SubsurfaceView } from './view.ts'

/** What an image needs of the frame: the device, the lit image, the surfaces' normals, base colours and flags, the data a profile pixel
 *  keeps, the depth pyramid, the profile table and the vectors of motion where the velocity stage measured them. One object the frame
 *  refills. */
export interface SubsurfaceNeeded {
  device: GPUDevice
  color: GPUTextureView
  normals: GPUTextureView
  base: GPUTextureView
  flags: GPUTextureView
  data: GPUTextureView
  depth: HizDepth
  table: GPUTextureView
  vectors: GPUTextureView | undefined
}

type Programs = ReturnType<typeof subsurfacePrograms>

/** The textures a kernel's group names, each by its binding; the ones left out are bound to a stand-in that no pass uses. */
interface Kernel {
  a?: GPUTextureView
  b?: GPUTextureView
  c?: GPUTextureView
  ids?: GPUTextureView
  out?: GPUTextureView
  history?: GPUTextureView
  idsOut?: GPUTextureView
}

/** The groups of an image's passes over the resources it names: the common one, the buffers', and one of textures for each pass —
 *  the history's states (not read, or read from one of the pair and the other written, `HistoryState`) in the passes that read it. */
export interface SubsurfaceGroups {
  common: GPUBindGroup
  tiles: GPUBindGroup
  arguments: GPUBindGroup
  none: GPUBindGroup
  rasterLists: GPUBindGroup
  clearSetup: GPUBindGroup
  clearPassOne: GPUBindGroup
  clearPassTwo: GPUBindGroup
  setupMain: GPUBindGroup
  setupPass: GPUBindGroup
  mips: GPUBindGroup[]
  sampled: GPUBindGroup[]
  variance: GPUBindGroup[]
  horizontal: GPUBindGroup
  vertical: GPUBindGroup
  recombine: GPUBindGroup
  copy: GPUBindGroup
}

/** The views of the history for the three states of an image: no history (a stand-in is read), the pair's second read and its first
 *  written, the first read and the second written. */
export const historyState = (valid: boolean, written: 0 | 1) => (valid ? 1 + written : 0)

/** The groups of `view` over `needed`, made for the resources they name (`view.identity`, kept for two lit images and the
 *  history's states), made again where one moved. */
export function subsurfaceGroups(
  view: SubsurfaceView,
  programs: Programs,
  needed: SubsurfaceNeeded,
): SubsurfaceGroups {
  const { identity } = view
  const { next } = identity
  next[0] = needed.color
  next[1] = needed.depth
  next[2] = needed.normals
  next[3] = needed.base
  next[4] = needed.flags
  next[5] = needed.data
  next[6] = needed.table
  next[7] = needed.vectors
  if (!identity.moved()) return view.groups[identity.slot] as SubsurfaceGroups
  const groups = buildGroups(view, programs, needed)
  view.groups[identity.slot] = groups
  return groups
}

/** The makers of a bind group over a program's layout. */
function groupMakers(device: GPUDevice, programs: Programs) {
  const T = SSS_TEXTURES
  const group = (layout: GPUBindGroupLayout, entries: GPUBindGroupEntry[]) =>
    device.createBindGroup({ layout, entries })
  const kernel = (k: Kernel) => {
    const out = [
      { binding: T.a, resource: k.a ?? programs.black },
      { binding: T.b, resource: k.b ?? programs.black },
      { binding: T.c, resource: k.c ?? programs.black },
      { binding: T.ids, resource: k.ids ?? programs.ids },
      { binding: T.out, resource: k.out ?? programs.sinks[0] },
      { binding: T.history, resource: k.history ?? programs.sinks[1] },
      { binding: T.idsOut, resource: k.idsOut ?? programs.idsSink },
    ]
    return group(programs.textures, out)
  }
  const raster = (a: GPUTextureView, b: GPUTextureView) =>
    group(programs.raster, [
      { binding: T.a, resource: a },
      { binding: T.b, resource: b },
    ])
  return { group, kernel, raster }
}

type GroupMakers = ReturnType<typeof groupMakers>

const bufferOf = (b: GPUBuffer) => ({ buffer: b })

/** The groups the passes share: the image's resources, the recombine and the copy, the raster lists. */
function commonGroups(
  { group, raster }: GroupMakers,
  programs: Programs,
  view: SubsurfaceView,
  needed: SubsurfaceNeeded,
) {
  const { textures, buffers } = view
  const B = SSS_BINDINGS
  return {
    common: group(programs.common, [
      { binding: B.params, resource: bufferOf(buffers.params) },
      ...hizDepthBindEntries(B.depth, needed.depth),
      { binding: B.normals, resource: needed.normals },
      { binding: B.base, resource: needed.base },
      { binding: B.flags, resource: needed.flags },
      { binding: B.data, resource: needed.data },
      { binding: B.profiles, resource: needed.table },
      { binding: B.vectors, resource: needed.vectors ?? programs.noVectors },
      { binding: B.sampler, resource: programs.sampler },
    ]),
    recombine: raster(needed.color, textures.pass2),
    copy: raster(textures.recombined, programs.black),
    rasterLists: group(programs.rasterLists, [
      { binding: SSS_TILES.lists, resource: bufferOf(buffers.lists) },
    ]),
  }
}

/** The groups of the tile lists and the indirect arguments. */
function tileGroups(
  { group }: GroupMakers,
  programs: Programs,
  buffers: SubsurfaceView['buffers'],
) {
  return {
    tiles: group(programs.tiles, [
      { binding: SSS_TILES.counts, resource: bufferOf(buffers.counts) },
      { binding: SSS_TILES.lists, resource: bufferOf(buffers.lists) },
      { binding: SSS_TILES.masks, resource: bufferOf(buffers.masks) },
    ]),
    arguments: group(programs.args, [
      { binding: SSS_ARGUMENTS.dispatch, resource: bufferOf(buffers.dispatch) },
      { binding: SSS_ARGUMENTS.draw, resource: bufferOf(buffers.draw) },
    ]),
    none: group(programs.none, []),
  }
}

/** Every group of the image. */
function buildGroups(
  view: SubsurfaceView,
  programs: Programs,
  needed: SubsurfaceNeeded,
): SubsurfaceGroups {
  const { textures, buffers } = view
  const makers = groupMakers(needed.device, programs)
  const { kernel } = makers
  const history = textures.history
  const readOf = [programs.black, history?.[1], history?.[0]]
  const writeOf = [history?.[0], history?.[0], history?.[1]]
  return {
    ...commonGroups(makers, programs, view, needed),
    ...tileGroups(makers, programs, buffers),
    clearSetup: kernel({ out: textures.setupMips[0] }),
    clearPassOne: kernel({ out: textures.pass1 }),
    clearPassTwo: kernel({ out: textures.pass2 }),
    setupMain: kernel({ a: needed.color, out: textures.setupMips[0], idsOut: textures.ids }),
    setupPass: kernel({ a: needed.color, out: textures.pass2, idsOut: textures.ids }),
    mips: textures.setupMips
      .slice(1)
      .map((out, level) => kernel({ a: textures.setupMips[level], out })),
    sampled: [0, 1, 2].map((state) =>
      kernel({ a: textures.setup, c: readOf[state], ids: textures.ids, out: textures.pass1 }),
    ),
    variance: [0, 1, 2].map((state) =>
      kernel({
        a: textures.pass1,
        b: textures.setup,
        c: readOf[state],
        out: textures.pass2,
        history: writeOf[state],
      }),
    ),
    horizontal: kernel({ a: textures.setup, ids: textures.ids, out: textures.pass1 }),
    vertical: kernel({ a: textures.pass1, ids: textures.ids, out: textures.pass2 }),
  }
}
