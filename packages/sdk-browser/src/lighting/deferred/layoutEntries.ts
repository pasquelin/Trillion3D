import { reflectionCaptureLayoutEntries } from '../reflectionCapture/compositeWgsl.ts'
import {
  DEFERRED_BINDINGS,
  DEFERRED_CLOUD_SHADOW_BINDINGS,
  DEFERRED_CAPTURE_BINDINGS,
  DEFERRED_SKY_LIGHT_BINDINGS,
} from './bindings.ts'
import { cloudShadowLayoutEntries } from '../atmosphere/cloudShadowRead.ts'
import { skyLightReadLayoutEntries } from '../../modules/sky/skyLight/read.ts'
import { lightFunctionLayoutEntry } from '../lightFunction/bindings.ts'
import { lightProfileLayoutEntries } from '../lightProfile/profileBindings.ts'
import { SUBSURFACE_TARGET } from '../../materials/surface/subsurface.ts'
import { PHYSICAL_LOBES_TARGET } from '../../materials/surface/physicalLobes.ts'
import { CONTRACT_SHADOW_BINDINGS } from '../direct/shadowBindings.ts'
import { VSM_SUN_MASK_FORMAT } from '../shadows/vsm/projection/maskFormat.ts'
import { REFLECTION_TARGET } from '../reflections/weight.ts'
import { SCREEN_PROBE_FORMATS } from '../bounce/screen/screenProbeLayout.ts'
import {
  computeBufferEntry,
  computeSamplerEntry,
  computeStorageTextureEntry,
  computeTextureEntry,
  computeUniformEntry,
} from '../../gpu/core/computeBindings.ts'
import { PER_LIGHT_RECORD_BINDING_BYTES } from '../shadows/vsm/projection/perLightRecord.ts'
import { fogReadLayoutEntries } from '../fog/read.ts'
import { FOG_PASS_BINDINGS } from '../fog/fogPassWgsl.ts'

/**
 * THE LAYOUTS OF THE LIGHTING'S PASSES, one for each: a pass binds what it reads and nothing else,
 * each at its number in `DEFERRED_BINDINGS`, so that the sixteen sampled textures, the eight storage
 * buffers and the four storage textures a stage is guaranteed (`gpu/core/stageLimits.test.ts`) are
 * spent pass by pass, not by the sum of them all. A pass of the tiles (`tilePass.ts`) reads the view in
 * its vertex stage too, and the tile lists there alone. The passes of one frame are described
 * where they are made (`litProgram.ts`, `colourPass.ts`, `../fog/fogPass.ts`).
 */
/** `GPUShaderStage.VERTEX` and `.FRAGMENT`, written in the clear: the layouts are also read from Node, without that global. */
const vertex = 1
const fragment = 2

/** The surface's layers and the scene's depth: what a pass reads of the pixel it lights. */
const pixelEntries = (): GPUBindGroupLayoutEntry[] => [
  computeTextureEntry(DEFERRED_BINDINGS.colours, 'unfilterable-float', '2d-array', fragment),
  computeTextureEntry(DEFERRED_BINDINGS.emissiveAo, 'unfilterable-float', '2d', fragment),
  computeTextureEntry(DEFERRED_BINDINGS.words, 'uint', '2d-array', fragment),
  computeTextureEntry(DEFERRED_BINDINGS.depth, 'depth', '2d', fragment),
]

/** The view's uniform and the tile lists a pass of the tiles draws from. */
const tileEntries = (): GPUBindGroupLayoutEntry[] => [
  computeBufferEntry(DEFERRED_BINDINGS.view, 'uniform', vertex | fragment),
  computeBufferEntry(DEFERRED_BINDINGS.tileList, 'read-only-storage', vertex),
]

/** The target classes whose pixels may be thin or carry lobes read (`CLASS_CUTS`): the thin
 *  transmission's, the lobes'; read-only storage textures, none of the sixteen sampled ones spent. A cloth's sheen table is
 *  in the light buffer (`../sheenLtcWgsl.ts`). */
const surfaceTargets = (lobes: boolean): GPUBindGroupLayoutEntry[] => [
  SUBSURFACE_TARGET.layoutEntry(),
  ...(lobes ? [PHYSICAL_LOBES_TARGET.layoutEntry()] : []),
]

/** What a pass of direct light reads of the shadows and the light functions: the frame's suns' mask (a read-only
 *  storage texture: the lit pass has no sampled texture to spare), the light functions' atlas. */
const shadowEntries = (): GPUBindGroupLayoutEntry[] => [
  computeStorageTextureEntry(
    CONTRACT_SHADOW_BINDINGS.vsmSunMask,
    VSM_SUN_MASK_FORMAT,
    'read-only',
    '2d-array',
    fragment,
  ),
  lightFunctionLayoutEntry(DEFERRED_BINDINGS.lightFunctionAtlas, fragment),
]

/** What the local lights' pass reads of the shadows beside it: the local lights' mask, the shadowed lights'
 *  grid its lanes are found in, and the maps a light past the mask's lanes is read from
 *  (`vsmSampleMapLocal`): the shadow uniforms, page table, projection data and pool, and the projection's
 *  view. */
const localMaskEntries = (): GPUBindGroupLayoutEntry[] => [
  computeTextureEntry(CONTRACT_SHADOW_BINDINGS.vsmMask, 'uint', '2d', fragment),
  computeBufferEntry(DEFERRED_BINDINGS.vsmLightGrid, 'read-only-storage', fragment),
  computeBufferEntry(DEFERRED_BINDINGS.vsmUniforms, 'uniform', fragment),
  computeBufferEntry(DEFERRED_BINDINGS.vsmPageTable, 'read-only-storage', fragment),
  computeBufferEntry(DEFERRED_BINDINGS.vsmProjectionData, 'read-only-storage', fragment),
  computeBufferEntry(DEFERRED_BINDINGS.vsmPool, 'read-only-storage', fragment),
  computeBufferEntry(DEFERRED_BINDINGS.vsmView, 'uniform', fragment),
]

/** The screen-space ambient occlusion the image drew (`ambientOcclusion`): what a pass of lights and the passes of the surface's indirect
 *  light read it by (`SCREEN_OCCLUSION_WGSL`). */
const occlusionEntry = () =>
  computeTextureEntry(DEFERRED_BINDINGS.ambientOcclusion, 'unfilterable-float', '2d', fragment)

/** The light buffer. */
const lightsEntry = () =>
  computeBufferEntry(DEFERRED_BINDINGS.lights, 'read-only-storage', fragment)

/** The surface colour pass: the surface's layers, the view, and the ambient occlusion its emission
 *  goes under. */
export const colourLayoutEntries = (): GPUBindGroupLayoutEntry[] => [
  ...pixelEntries().filter((entry) => entry.binding !== DEFERRED_BINDINGS.depth),
  computeBufferEntry(DEFERRED_BINDINGS.view, 'uniform', fragment),
  occlusionEntry(),
]

/** The unlit view's pass: the surface's layers and the view. */
export const unlitLayoutEntries = (): GPUBindGroupLayoutEntry[] => [
  ...pixelEntries().filter((entry) => entry.binding !== DEFERRED_BINDINGS.depth),
  computeBufferEntry(DEFERRED_BINDINGS.view, 'uniform', fragment),
]

/** The screen-space contact shadows' array and the ranks of its layers, which a pass of lights reads where its program holds contact shadow
 *  code (`ContractKey.contactless`); none otherwise. */
const contactBendEntries = (contact: boolean): GPUBindGroupLayoutEntry[] =>
  contact
    ? [
        computeTextureEntry(
          DEFERRED_BINDINGS.contactBend,
          'unfilterable-float',
          '2d-array',
          fragment,
        ),
        computeUniformEntry(DEFERRED_BINDINGS.contactBendRanks, {}, fragment),
      ]
    : []

/** The shadows the heterogeneous volumes cast, which a pass of lights reads where its program holds their read (`ContractKey.volumeShadow`);
 *  none otherwise. */
const volumeShadowEntry = (volume: boolean): GPUBindGroupLayoutEntry[] =>
  volume ? [computeBufferEntry(DEFERRED_BINDINGS.volumeShadow, 'read-only-storage', fragment)] : []

/** The sun's pass: the light buffer and the ranks of the directional lights in it, the shadows,
 *  the clouds' shade, and, where the program holds contact shadow code (`contact`), the screen-space
 *  contact shadows. */
export const sunLayoutEntries = (
  lobes: boolean,
  contact = false,
  volume = false,
): GPUBindGroupLayoutEntry[] => [
  ...pixelEntries(),
  ...tileEntries(),
  lightsEntry(),
  computeBufferEntry(DEFERRED_BINDINGS.sunRanks, 'read-only-storage', fragment),
  ...shadowEntries(),
  ...cloudShadowLayoutEntries(DEFERRED_CLOUD_SHADOW_BINDINGS, fragment),
  occlusionEntry(),
  ...contactBendEntries(contact),
  ...volumeShadowEntry(volume),
  ...surfaceTargets(lobes),
]

/** The light profiles' atlas and sampler, which a pass of local lights reads where the scene has a profiled light
 *  (`ContractKey.profileless`); none otherwise, so a scene with none spends no sampled texture nor sampler on them. */
const profileEntries = (profiled: boolean): GPUBindGroupLayoutEntry[] =>
  profiled
    ? lightProfileLayoutEntries(
        {
          atlas: DEFERRED_BINDINGS.lightProfileAtlas,
          sampler: DEFERRED_BINDINGS.lightProfileSampler,
          rectAtlas: DEFERRED_BINDINGS.rectAtlas,
          rectSampler: DEFERRED_BINDINGS.rectAtlasSampler,
        },
        fragment,
      )
    : []

/** The local lights' pass: the light buffer and the grid's lists, the shadows, the light profiles where the scene has
 *  any. */
export const localLayoutEntries = (
  lobes: boolean,
  profiled = false,
  contact = false,
  sampled = false,
  volume = false,
): GPUBindGroupLayoutEntry[] => [
  ...pixelEntries(),
  ...tileEntries(),
  lightsEntry(),
  computeBufferEntry(DEFERRED_BINDINGS.tiles, 'read-only-storage', fragment),
  ...shadowEntries(),
  ...localMaskEntries(),
  occlusionEntry(),
  ...profileEntries(profiled),
  ...contactBendEntries(contact),
  ...(sampled
    ? [computeTextureEntry(DEFERRED_BINDINGS.sampledLight, 'unfilterable-float', '2d', fragment)]
    : []),
  ...volumeShadowEntry(volume),
  ...surfaceTargets(lobes),
]

/** The strands' samples' lighting (`../../hair/hairLightWgsl.ts`): the local lights' group and the clouds' shade, which the
 *  suns of a cell are lit with. */
export const hairLayoutEntries = (
  lobes: boolean,
  profiled = false,
  contact = false,
  sampled = false,
  volume = false,
): GPUBindGroupLayoutEntry[] => [
  ...localLayoutEntries(lobes, profiled, contact, sampled, volume),
  ...cloudShadowLayoutEntries(DEFERRED_CLOUD_SHADOW_BINDINGS, fragment),
]

/** The per-light draw (`perLightPassWgsl.ts`): the light buffer, the light functions' atlas, the mask of the
 *  light it lights (an array a layer a light), the screen's occlusion and the light's record, a uniform read at
 *  a dynamic offset. */
export const perLightLayoutEntries = (
  lobes: boolean,
  profiled = false,
  contact = false,
  volume = false,
): GPUBindGroupLayoutEntry[] => [
  ...pixelEntries(),
  ...tileEntries(),
  lightsEntry(),
  lightFunctionLayoutEntry(DEFERRED_BINDINGS.lightFunctionAtlas, fragment),
  computeTextureEntry(DEFERRED_BINDINGS.perLightMask, 'unfilterable-float', '2d-array', fragment),
  occlusionEntry(),
  computeUniformEntry(
    DEFERRED_BINDINGS.perLightRecord,
    { hasDynamicOffset: true, minBindingSize: PER_LIGHT_RECORD_BINDING_BYTES },
    fragment,
  ),
  ...profileEntries(profiled),
  ...contactBendEntries(contact),
  ...volumeShadowEntry(volume),
  ...surfaceTargets(lobes),
]

/** The ambient cubemap's cube, its sampler and its colour, which the indirect pass reads where the image sets a cube
 *  (`ContractKey.cubeless`); none otherwise, so an image with none spends no sampled texture nor sampler on them. */
const cubemapEntries = (cubed: boolean): GPUBindGroupLayoutEntry[] =>
  cubed
    ? [
        computeTextureEntry(DEFERRED_BINDINGS.ambientCube, 'float', 'cube', fragment),
        computeSamplerEntry(DEFERRED_BINDINGS.ambientCubeSampler, 'filtering', fragment),
        computeUniformEntry(DEFERRED_BINDINGS.ambientCubeColour, {}, fragment),
      ]
    : []

/**
 * The indirect pass: the light buffer (the environment's light), the ambient occlusion, the light the
 * volumetric lightmap gives the pixels, the reflection the trace wrote, the sky light's cubes and harmonics. The bounce program adds the probe grid, its atlas
 * and what the screen probes left of the pixels' indirect light — a sampled texture of words read by
 * load —; the program that applies the sky light's distance-field occlusion adds the bent normals,
 * packed in a buffer, and the uniform that describes them; the program of an image with an ambient cubemap adds the cube.
 */
export const indirectLayoutEntries = ({
  bounce,
  skyShadowing,
  lobes,
  cubed = false,
  capsule = false,
  captured = false,
}: {
  bounce: boolean
  skyShadowing: boolean
  lobes: boolean
  cubed?: boolean
  capsule?: boolean
  captured?: boolean
}): GPUBindGroupLayoutEntry[] => [
  ...pixelEntries(),
  ...tileEntries(),
  lightsEntry(),
  occlusionEntry(),
  computeTextureEntry(DEFERRED_BINDINGS.volumetricLight, 'unfilterable-float', '2d', fragment),
  REFLECTION_TARGET.layoutEntry(),
  ...skyLightReadLayoutEntries(DEFERRED_SKY_LIGHT_BINDINGS, fragment),
  ...(bounce
    ? [
        computeTextureEntry(DEFERRED_BINDINGS.screenIndirect, 'uint', '2d', fragment),
        computeStorageTextureEntry(
          DEFERRED_BINDINGS.screenShortRangeGi,
          SCREEN_PROBE_FORMATS.shortRangeGi,
          'read-only',
          '2d',
          fragment,
        ),
      ]
    : []),
  ...(skyShadowing
    ? [
        computeBufferEntry(DEFERRED_BINDINGS.dfaoBent, 'read-only-storage', fragment),
        computeBufferEntry(DEFERRED_BINDINGS.dfaoRead, 'uniform', fragment),
      ]
    : []),
  ...(capsule
    ? [computeBufferEntry(DEFERRED_BINDINGS.capsuleIndirect, 'read-only-storage', fragment)]
    : []),
  ...cubemapEntries(cubed),
  ...(captured ? reflectionCaptureLayoutEntries(DEFERRED_CAPTURE_BINDINGS, fragment) : []),
  ...surfaceTargets(lobes),
]

/** The layout of the fog behind the water: the fog pass's, and the scene without the water's linear depth. */
export function fogBehindWaterLayoutEntries(localFog: boolean): GPUBindGroupLayoutEntry[] {
  return [
    ...heightFogLayoutEntries(localFog),
    computeTextureEntry(DEFERRED_BINDINGS.waterLinearDepth, 'unfilterable-float', '2d', fragment),
  ]
}

/** The fog pass's layout: the surface's flags and the depth, the view, the light buffer, the fog's cubemap,
 *  volume, light shafts' mask, local fog volumes' lists and sampler, and the haze's volume. */
export function heightFogLayoutEntries(localFog: boolean): GPUBindGroupLayoutEntry[] {
  return [
    computeTextureEntry(DEFERRED_BINDINGS.words, 'uint', '2d-array', fragment),
    computeTextureEntry(DEFERRED_BINDINGS.depth, 'depth', '2d', fragment),
    computeBufferEntry(DEFERRED_BINDINGS.view, 'uniform', fragment),
    computeBufferEntry(DEFERRED_BINDINGS.lights, 'read-only-storage', fragment),
    ...fogReadLayoutEntries(FOG_PASS_BINDINGS(localFog), fragment),
    computeTextureEntry(DEFERRED_BINDINGS.hazeVolume, 'float', '3d', fragment),
  ]
}
