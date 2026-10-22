import type { GlobalFieldRead } from '../view.ts'
import type { MeshFieldScene } from '../meshFieldScene.ts'
import { namedEntries } from '../../../gpu/core/computeBindings.ts'
import { sameValues } from '../../../../../math/src/matrix/matrixElements.ts'
import { hizDepthBindEntries } from '../../../visibility/hiz/gpu/pyramidTexture.ts'
import type { HizDepth } from '../../../visibility/hiz/gpu/types.ts'
import { DFAO_BINDING as B } from './layout.ts'
import type { DfaoPrograms } from './pipelines.ts'
import type { DfaoProgram } from './layouts.ts'
import type { DfaoView } from './view.ts'

/** The meshes' fields as the passes bind them (`meshFieldWgsl`, from `B.objects`): the scene's entries, the generation that
 *  says they changed, and the meshes in it. */
export type DfaoObjects = Pick<MeshFieldScene, 'bindEntries' | 'generation' | 'count'>

/** What the passes of an image read of the frame. */
export interface DfaoSources {
  depth: HizDepth
  surfaceNormals: GPUTextureView
  vectors: GPUTextureView
  field: GlobalFieldRead | undefined
  objects: DfaoObjects | undefined
}

/** The groups of the passes made over `sources`, for the history at `parity`. */
export type DfaoGroups = Record<string, GPUBindGroup>

const whole = (buffer: GPUBuffer) => ({ buffer })

/** The meshes' bindings (`meshFieldWgsl`) of a pass: all seven, or the bounds and the data alone. */
const objectEntries = (objects: DfaoObjects, all: boolean) => {
  const entries = objects.bindEntries(B.objects)
  return all ? entries : entries.slice(1, 3)
}

type Resources = Partial<Record<keyof typeof B, GPUBindingResource>>

/** The groups of the passes that read what the view holds and `sources` name, with the history texture `read` read and
 *  `write` written: those whose sources are absent are left out. */
function makeGroups(
  device: GPUDevice,
  programs: DfaoPrograms,
  view: DfaoView,
  sources: DfaoSources,
  [read, write]: readonly [GPUTextureView, GPUTextureView],
) {
  const { layouts, sampler } = programs
  const group = (name: DfaoProgram, ...entries: GPUBindGroupEntry[][]) =>
    device.createBindGroup({
      label: `Trillion3D distance-field occlusion ${name}`,
      layout: layouts[name],
      entries: [{ binding: B.params, resource: whole(view.params) }, ...entries.flat()],
    })
  const named = (resources: Resources) => namedEntries(B, resources)
  const grid = { normals: view.normals.view }
  const visibility = { visibility: whole(view.visibility) }
  const tiles = {
    tileAxis: whole(view.tileAxis),
    tileRanges: whole(view.tileRanges),
    tileCounts: whole(view.tileCounts),
    tileOffsets: whole(view.tileOffsets),
    tileData: whole(view.tileData),
  }
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
    tileCones: group(
      'tileCones',
      named({ ...grid, tileAxis: tiles.tileAxis, tileRanges: tiles.tileRanges }),
    ),
    startOffsets: group(
      'startOffsets',
      named({
        objectArgs: whole(view.objectArgs),
        tileCounts: tiles.tileCounts,
        tileOffsets: tiles.tileOffsets,
        tileData: tiles.tileData,
        tileArgs: whole(view.tileArgs),
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
  const culled = whole(view.culledObjects)
  made.coneObjects = group(
    'coneObjects',
    named({ ...grid, ...visibility, tileData: tiles.tileData }),
    objectEntries(objects, true),
  )
  made.cullObjects = group(
    'cullObjects',
    objectEntries(objects, false),
    named({ culledObjects: culled, objectArgs: whole(view.objectArgs) }),
  )
  made.scatter = group(
    'scatter',
    named({ culledObjects: culled, ...tiles }),
    objectEntries(objects, true),
  )
  return made
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
