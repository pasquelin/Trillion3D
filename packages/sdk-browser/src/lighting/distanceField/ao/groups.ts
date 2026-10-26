import type { GlobalFieldRead } from '../view.ts'
import type { MeshFieldScene } from '../meshFieldScene.ts'
import { namedEntries, wholeBuffer } from '../../../gpu/core/computeBindings.ts'
import { sameValues } from '../../../../../math/src/matrix/matrixElements.ts'
import { hizDepthBindEntries } from '../../../visibility/hiz/gpu/pyramidTexture.ts'
import type { HizDepth } from '../../../visibility/hiz/gpu/types.ts'
import { DFAO_BINDING as B } from './layout.ts'
import type { DfaoPrograms } from './pipelines.ts'
import type { DfaoProgram } from './layouts.ts'
import type { DfaoView } from './view.ts'

/** The meshes' fields as the passes bind them (`meshFieldWgsl`, from `B.objects`): the scene's entries, the generation that
 *  says they changed, and the meshes in it. */
type DfaoObjects = Pick<MeshFieldScene, 'bindEntries' | 'generation' | 'count'>

/** What the passes of an image read of the frame. */
export interface DfaoSources {
  depth: HizDepth
  surfaceNormals: GPUTextureView
  vectors: GPUTextureView
  field: GlobalFieldRead | undefined
  objects: DfaoObjects | undefined
}

/** The groups of the passes made over `sources`, for the history at `parity`. */
type DfaoGroups = Record<string, GPUBindGroup>

/** The meshes' bindings (`meshFieldWgsl`) of a pass: all seven, or the bounds and the data alone. */
const objectEntries = (objects: DfaoObjects, all: boolean) => {
  const entries = objects.bindEntries(B.objects)
  return all ? entries : entries.slice(1, 3)
}

type Resources = Partial<Record<keyof typeof B, GPUBindingResource>>

type GroupOf = (name: DfaoProgram, ...entries: GPUBindGroupEntry[][]) => GPUBindGroup

/** The groups that pack the image into the buffer the lit pass reads (`packWgsl.ts`): the image ends in either texture of the
 *  history, by the passes that ran, and each has its own group. */
const packGroups = (group: GroupOf, view: DfaoView) =>
  Object.fromEntries(
    view.history.map((texture, at) => [
      `pack${at}`,
      group('pack', namedEntries(B, { history: texture.view, packed: wholeBuffer(view.packed) })),
    ]),
  )

/** The group maker of the passes: their layout, the view's parameters, and the entries given. */
const groupMaker =
  (device: GPUDevice, programs: DfaoPrograms, view: DfaoView): GroupOf =>
  (name, ...entries) =>
    device.createBindGroup({
      label: `Trillion3D distance-field occlusion ${name}`,
      layout: programs.layouts[name],
      entries: [{ binding: B.params, resource: wholeBuffer(view.params) }, ...entries.flat()],
    })

/** The tile buffers of the view as the passes bind them. */
const tileBuffers = (view: DfaoView) => ({
  tileAxis: wholeBuffer(view.tileAxis),
  tileRanges: wholeBuffer(view.tileRanges),
  tileCounts: wholeBuffer(view.tileCounts),
  tileOffsets: wholeBuffer(view.tileOffsets),
  tileData: wholeBuffer(view.tileData),
})

const named = (resources: Resources) => namedEntries(B, resources)

/** The groups of the passes that read the meshes' fields: the cones, the culling and the scatter. */
function objectGroups(
  group: GroupOf,
  view: DfaoView,
  objects: DfaoObjects,
  shared: {
    grid: Resources
    visibility: Resources
    tiles: ReturnType<typeof tileBuffers>
  },
): DfaoGroups {
  const { grid, visibility, tiles } = shared
  const culled = wholeBuffer(view.culledObjects)
  return {
    coneObjects: group(
      'coneObjects',
      named({ ...grid, ...visibility, tileData: tiles.tileData }),
      objectEntries(objects, true),
    ),
    cullObjects: group(
      'cullObjects',
      objectEntries(objects, false),
      named({ culledObjects: culled, objectArgs: wholeBuffer(view.objectArgs) }),
    ),
    scatter: group(
      'scatter',
      named({ culledObjects: culled, ...tiles }),
      objectEntries(objects, true),
    ),
  }
}

/** The groups of the passes that read what the view holds and `sources` name, with the history texture `read` read and
 *  `write` written: those whose sources are absent are left out. */
function makeGroups(
  device: GPUDevice,
  programs: DfaoPrograms,
  view: DfaoView,
  sources: DfaoSources,
  [read, write]: readonly [GPUTextureView, GPUTextureView],
) {
  const { sampler } = programs
  const group = groupMaker(device, programs, view)
  const grid = { normals: view.normals.view }
  const visibility = { visibility: wholeBuffer(view.visibility) }
  const tiles = tileBuffers(view)
  const made: DfaoGroups = {
    normals: group(
      'normals',
      hizDepthBindEntries(B.depth, sources.depth),
      named({ surfaceNormals: sources.surfaceNormals, output: view.normals.view }),
    ),
    clear: group('clear', named(visibility)),
    combine: group('combine', named({ ...grid, ...visibility, output: view.cones.view })),
    upsampleOnly: group('upsampleOnly', named({ ...grid, bent: view.cones.view, output: write })),
    updateHistory: group(
      'updateHistory',
      named({
        ...grid,
        bent: view.cones.view,
        history: read,
        sampler,
        vectors: sources.vectors,
        output: write,
      }),
    ),
    filterHistory: group('filterHistory', named({ bent: write, output: read })),
    ...packGroups(group, view),
    tileCones: group(
      'tileCones',
      named({ ...grid, tileAxis: tiles.tileAxis, tileRanges: tiles.tileRanges }),
    ),
    startOffsets: group(
      'startOffsets',
      named({
        objectArgs: wholeBuffer(view.objectArgs),
        tileCounts: tiles.tileCounts,
        tileOffsets: tiles.tileOffsets,
        tileData: tiles.tileData,
        tileArgs: wholeBuffer(view.tileArgs),
      }),
    ),
  }
  if (sources.field)
    made.coneGlobal = group(
      'coneGlobal',
      named({ ...grid, ...visibility }),
      sources.field.readEntries(B.field),
    )
  const { objects } = sources
  if (!objects) return made
  return { ...made, ...objectGroups(group, view, objects, { grid, visibility, tiles }) }
}

/** What a view's groups were made over, to know again. */
interface GroupsKept {
  over: unknown[]
  made: DfaoGroups
}

/** The identity the groups of one parity of the history are made over. */
const identityOf = (sources: DfaoSources, view: DfaoView) => [
  sources.depth,
  sources.surfaceNormals,
  sources.vectors,
  sources.field?.readGeneration,
  sources.objects?.generation,
  view,
]

/**
 * The groups of the image's passes over `sources`, for the history at `parity` (the texture that holds the last
 * image, 0 or 1): kept on the view while what they name is the same, made again where a source moved. The two
 * parities each keep their own.
 */
export function dfaoGroups(
  device: GPUDevice,
  programs: DfaoPrograms,
  view: DfaoView,
  sources: DfaoSources,
  parity: 0 | 1,
) {
  const kept = ((view.groups as GroupsKept[] | undefined) ??= [])
  const over = identityOf(sources, view)
  const held = kept[parity]
  if (held && sameValues(held.over, over)) return held.made
  const textures = [view.history[0].view, view.history[1].view] as const
  const made = makeGroups(device, programs, view, sources, [textures[parity], textures[1 - parity]])
  kept[parity] = { over, made }
  return made
}
