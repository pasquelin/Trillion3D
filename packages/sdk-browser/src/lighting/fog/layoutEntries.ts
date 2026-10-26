import {
  computeBufferEntry,
  computeSamplerEntry,
  computeStorageTextureEntry,
  computeTextureEntry,
  computeUniformEntry,
} from '../../gpu/core/computeBindings.ts'
import { hizDepthEntries } from '../../visibility/hiz/gpu/pyramidTexture.ts'
import { globalReadLayoutEntries } from '../distanceField/view.ts'
import { lightFunctionLayoutEntry } from '../lightFunction/bindings.ts'
import { volumetricLightmapLayoutEntries } from '../volumetricLightmap/textures.ts'
import {
  FOG_BINDING,
  FOG_GRAPH_BINDINGS,
  FOG_PROGRAM_BINDINGS,
  type FogBindings,
  type FogProgramName,
} from './bindings.ts'
import { FOG_STATIC_FORMAT } from './layout.ts'
import { FOG_VOLUME_FORMAT } from './read.ts'

/** The layout entry of each binding of the volume's programs, by name; the pyramid's three
 *  (`hizDepthEntries`) are made where a program names it. */
const ENTRY: Record<
  Exclude<keyof typeof FOG_BINDING, 'hiz' | 'field' | 'lightmap'>,
  GPUBindGroupLayoutEntry
> = {
  lights: computeBufferEntry(FOG_BINDING.lights, 'read-only-storage'),
  tiles: computeBufferEntry(FOG_BINDING.tiles, 'read-only-storage'),
  frame: computeUniformEntry(FOG_BINDING.frame),
  depth: computeTextureEntry(FOG_BINDING.depth, 'depth'),
  furthest: computeTextureEntry(FOG_BINDING.furthest, 'unfilterable-float'),
  previousFurthest: computeTextureEntry(FOG_BINDING.previousFurthest, 'unfilterable-float'),
  previousVolume: computeTextureEntry(FOG_BINDING.previousVolume, 'float', '3d'),
  sampler: computeSamplerEntry(FOG_BINDING.sampler),
  scattering: computeStorageTextureEntry(
    FOG_BINDING.scattering,
    FOG_VOLUME_FORMAT,
    'write-only',
    '3d',
  ),
  integrated: computeStorageTextureEntry(
    FOG_BINDING.integrated,
    FOG_VOLUME_FORMAT,
    'write-only',
    '3d',
  ),
  furthestOut: computeStorageTextureEntry(FOG_BINDING.furthestOut, 'r32float'),
  scatterIn: computeTextureEntry(FOG_BINDING.scatterIn, 'float', '3d'),
  cubemap: computeTextureEntry(FOG_BINDING.cubemap, 'float', 'cube'),
  pageTable: computeBufferEntry(FOG_BINDING.pageTable, 'read-only-storage'),
  projectionData: computeBufferEntry(FOG_BINDING.projectionData, 'read-only-storage'),
  shadowUniforms: computeUniformEntry(FOG_BINDING.shadowUniforms),
  shadowPool: computeBufferEntry(FOG_BINDING.shadowPool, 'read-only-storage'),
  shadowView: computeUniformEntry(FOG_BINDING.shadowView),
  voxelFrame: computeUniformEntry(FOG_BINDING.voxelFrame),
  voxelObjects: computeBufferEntry(FOG_BINDING.voxelObjects, 'read-only-storage'),
  voxelSpans: computeBufferEntry(FOG_BINDING.voxelSpans, 'storage'),
  voxelSpansRead: computeBufferEntry(FOG_BINDING.voxelSpansRead, 'read-only-storage'),
  voxelOut: computeStorageTextureEntry(FOG_BINDING.voxelOut, FOG_VOLUME_FORMAT, 'write-only', '3d'),
  voxelEmitOut: computeStorageTextureEntry(
    FOG_BINDING.voxelEmitOut,
    FOG_VOLUME_FORMAT,
    'write-only',
    '3d',
  ),
  voxelIn: computeTextureEntry(FOG_BINDING.voxelIn, 'float', '3d'),
  voxelEmitIn: computeTextureEntry(FOG_BINDING.voxelEmitIn, 'float', '3d'),
  lightFunction: lightFunctionLayoutEntry(FOG_BINDING.lightFunction),
  cloudShadow: computeUniformEntry(FOG_BINDING.cloudShadow),
  cloudShadowMap0: computeTextureEntry(FOG_BINDING.cloudShadowMap0, 'float'),
  cloudShadowMap1: computeTextureEntry(FOG_BINDING.cloudShadowMap1, 'float'),
  skyHarmonics: computeBufferEntry(FOG_BINDING.skyHarmonics, 'uniform'),
  skyParams: computeBufferEntry(FOG_BINDING.skyParams, 'uniform'),
  staticOut: computeStorageTextureEntry(
    FOG_BINDING.staticOut,
    FOG_STATIC_FORMAT,
    'write-only',
    '3d',
  ),
  staticIn: computeStorageTextureEntry(FOG_BINDING.staticIn, FOG_STATIC_FORMAT, 'read-only', '3d'),
  graphValues: computeBufferEntry(FOG_BINDING.graphValues, 'read-only-storage'),
  graphPool0: computeTextureEntry(FOG_BINDING.graphPool0, 'float', '2d-array'),
  graphPool1: computeTextureEntry(FOG_BINDING.graphPool1, 'float', '2d-array'),
  graphPool2: computeTextureEntry(FOG_BINDING.graphPool2, 'float', '2d-array'),
  graphPages: computeBufferEntry(FOG_BINDING.graphPages, 'read-only-storage'),
  graphSampler: computeSamplerEntry(FOG_BINDING.graphSampler),
  localTiles: computeBufferEntry(FOG_BINDING.localTiles, 'read-only-storage'),
}

/** The layout of the voxelisation of objects that wear a graph: the plain voxelisation's entries,
 *  then the graphs' (`FOG_GRAPH_BINDINGS`). */
export const graphLayoutEntries = (textured: boolean) => [
  ...layoutEntries('voxelize'),
  ...entriesOf(FOG_GRAPH_BINDINGS[textured ? 'textured' : 'values']),
]

/** The entries of the bindings `names` holds, none of the made-where-named kinds. */
const entriesOf = (names: FogBindings) =>
  (Object.keys(names) as Exclude<keyof typeof FOG_BINDING, 'hiz' | 'field' | 'lightmap'>[]).map(
    (n) => ENTRY[n],
  )

/** The layout of a program: the entries of what it binds. The pyramid's three, the field's six and the
 *  lightmap's eleven are made where a program names them. */
export const layoutEntries = (name: FogProgramName) =>
  (Object.keys(FOG_PROGRAM_BINDINGS[name]) as (keyof typeof FOG_BINDING)[]).flatMap((n) =>
    n === 'hiz'
      ? hizDepthEntries(FOG_BINDING.hiz, GPUShaderStage.COMPUTE)
      : n === 'field'
        ? globalReadLayoutEntries(FOG_BINDING.field)
        : n === 'lightmap'
          ? volumetricLightmapLayoutEntries(FOG_BINDING.lightmap)
          : [ENTRY[n]],
  )
