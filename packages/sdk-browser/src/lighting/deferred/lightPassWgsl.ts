/**
 * THE DIRECT LIGHT, AS TWO PASSES OVER THE TILES OF THE LIT SURFACES (`tileClass.ts`), added to the
 * lit image:
 * - the sun's pass: the directional lights — every one of the scene's, by their ranks in the light
 *   buffer (`sunRanks`) — on every pixel of the tile, their shadows read in the frame's mask, their light and the clouds' shade on them;
 * - the local lights' pass: the lights of the pixel's cell of the light grid (`cellSlice`), the
 *   directional ones left to the sun's pass.
 * One light term, `declaredLight`, serves both, and the blend: only the loop around it differs. A
 * pass has a program for each class of tile, which holds the code its pixels need and no more
 * (`CLASS_CUTS`): a tile of plain physical surfaces runs no diffuse or toon model, no thin
 * transmission, no lobe.
 */
import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { MODEL_FLAG } from '../../materials/surface/surfaceModelWord.ts'
import {
  DEFERRED_BINDINGS,
  DEFERRED_CLOUD_SHADOW_BINDINGS,
  DEFERRED_CONTACT_BEND_BINDINGS,
  DEFERRED_LIGHT_FUNCTION_BINDINGS,
  DEFERRED_LIGHT_PROFILE_BINDINGS,
  DEFERRED_TOON_TABLES,
} from './bindings.ts'
import { variantLabel, type ContractKey } from './contractCuts.ts'
import { SCREEN_OCCLUSION_WGSL } from './ambientOcclusionWgsl.ts'
import {
  CLASS_CUTS,
  DEFERRED_CONTACT_SCENE_WGSL,
  LIT_CHANNELS_WGSL,
  LIT_PIXEL_WGSL,
  SUBSURFACE_BINDING_WGSL,
  litCutOf,
  closureTail,
  CLOSURE_READ_WGSL,
  litPixelStatements,
} from './litSurfaceWgsl.ts'
import { FURNACE_WGSL, furnaceCoatWgsl, furnaceEntries } from './furnaceWgsl.ts'
import { TILE_VERTEX_WGSL } from './tilePass.ts'
import type { TileClass } from './tileClass.ts'
import { DECLARED_TERM_TEXT, SHADING_TEXT } from '../direct/lightLoopWgsl.ts'
import { TOON_APPLY_WGSL } from '../direct/toonModelWgsl.ts'
import { TOON_DATA_BINDINGS } from './bindings.ts'
import { PIXEL_MODEL } from '../../materials/surface/pixelModel.ts'
import { LOBES_TARGET_WGSL } from '../direct/lobesWgsl.ts'
import { lightingBase, pixelCellWgsl, type LightingBindings } from '../direct/lightingWgsl.ts'
import { CONTRACT_SHADOW_BINDINGS } from '../direct/shadowBindings.ts'
import { SIMPLE_HEADER } from '../../../../sdk-core/src/scene/light/fields.ts'
import { LOCAL_SHADOWED_WGSL } from '../direct/shadowSlice.ts'
import { PER_LIGHT_RECORD_WGSL } from '../shadows/vsm/projection/perLightRecord.ts'

/** The light buffer. */
export const LIGHTS_BINDING_WGSL = wgslBlock(
  'LIGHTS_BINDING_WGSL',
  [],
  `@group(0) @binding(${DEFERRED_BINDINGS.lights}) var<storage,read> directLights:DirectLights;`,
)
/** The light grid's lists. */
export const TILES_BINDING_WGSL = wgslBlock(
  'TILES_BINDING_WGSL',
  [],
  `@group(0) @binding(${DEFERRED_BINDINGS.tiles}) var<storage,read> tileLights:array<u32>;`,
)
/** The light's record, a uniform read at a dynamic offset: the draw of one light (`perLightPassWgsl.ts`, and the local lights' pass for one
 *  light, `localPassWgsl` with the loop `one`). */
export const PER_LIGHT_RECORD_BINDING_WGSL = wgslBlock(
  'PER_LIGHT_RECORD_BINDING_WGSL',
  [PER_LIGHT_RECORD_WGSL],
  `@group(0) @binding(${DEFERRED_BINDINGS.perLightRecord}) var<uniform> perLight:PerLightRecord;`,
)
/** The ranks of the directional lights in the light buffer, after their count: the sun pass's
 *  list, in the place of a cell's. */
const SUN_RANKS_BINDING_WGSL = wgslBlock(
  'SUN_RANKS_BINDING_WGSL',
  [],
  `@group(0) @binding(${DEFERRED_BINDINGS.sunRanks}) var<storage,read> sunRanks:array<u32>;`,
)

/** What the sun's pass binds for its light terms: the suns' mask, the
 *  light functions and the clouds' shade. */
const SUN_BINDINGS: LightingBindings = {
  vsmSunMask: CONTRACT_SHADOW_BINDINGS.vsmSunMask,
  lightFunction: DEFERRED_LIGHT_FUNCTION_BINDINGS,
  cloudShadow: DEFERRED_CLOUD_SHADOW_BINDINGS,
  toon: DEFERRED_TOON_TABLES,
}
/** The local lights' pass: no clouds' shade — the air's lights are directional. */
const LOCAL_BINDINGS: LightingBindings = {
  vsmSunMask: CONTRACT_SHADOW_BINDINGS.vsmSunMask,
  vsmMask: CONTRACT_SHADOW_BINDINGS.vsmMask,
  maskFallback: CONTRACT_SHADOW_BINDINGS.fallback,
  lightFunction: DEFERRED_LIGHT_FUNCTION_BINDINGS,
  lightProfile: DEFERRED_LIGHT_PROFILE_BINDINGS,
  toon: DEFERRED_TOON_TABLES,
}
/** The view of the shadows sums the suns of the cell too, so its program reads the sun's distance-field
 *  shadow as the sun's pass does. */
const VISIBILITY_BINDINGS: LightingBindings = {
  ...LOCAL_BINDINGS,
}

/** The bindings `bindings` with the screen-space contact shadows' array (`contactShadowMethod` 1) where the pass holds contact shadow
 *  code (`ContractKey.contactless`): the lights of the pass find their layer in it. */
export const withContactBend = (bindings: LightingBindings, key: ContractKey): LightingBindings =>
  key.contactless ? bindings : { ...bindings, contactBend: DEFERRED_CONTACT_BEND_BINDINGS }

/** The bindings `bindings` with the volumes' shadows' buffer (`ContractKey.volumeShadow`): the lights of the pass multiply their share by the
 *  transmittance of the volumes toward them. */
export const withVolumeShadow = (bindings: LightingBindings, key: ContractKey): LightingBindings =>
  key.volumeShadow ? { ...bindings, volumeShadow: DEFERRED_BINDINGS.volumeShadow } : bindings

/** The strands' samples' lighting (`../../hair/hairLightWgsl.ts`): the local lights' bindings with the sun's distance-field
 *  shadow and the clouds' shade the suns of the cell are lit with, so that a strand reads what a surface reads; the masks
 *  bound at the shadows' ranks are the strands' own. */
export const HAIR_LIGHT_BINDINGS: LightingBindings = {
  ...VISIBILITY_BINDINGS,
  cloudShadow: DEFERRED_CLOUD_SHADOW_BINDINGS,
}

/** The sum of the directional lights of the scene on a pixel, in the order of their ranks. */
const SUN_LOOP_WGSL = wgslBlock(
  'SUN_LOOP_WGSL',
  [],
  `
fn sunLighting(rgb:vec3f,metal:f32,rough:f32,N:vec3f,V:vec3f,P:vec3f,ao:f32)->vec3f{
 var result=vec3f(0.0);
 ${SHADING_TEXT()}
 for(var index=1u;index<=sunRanks[0];index++){
  result+=${DECLARED_TERM_TEXT('sunRanks[index]')};
 }
 return result;
}`,
)

/** What the local lights' loop walks of a cell's list: every light but the directional ones (`all`); `unbatched`, but the shadowed local
 *  lights as well, which the per-light draw lights (`perLightPassWgsl.ts`) — a light is lit by this loop or by its own draw, never both;
 *  `one`, no walk: the one light of the draw's record, its rank in the record, its shadow read in the packed mask as the whole loop reads it. */
export type LocalLoop = 'all' | 'unbatched' | 'one'

const LOCAL_LOOP_SKIPS: Record<'all' | 'unbatched', string> = {
  all: '',
  unbatched: `
  if(lightHasLocalShadow(rank)){continue;}`,
}

/** The sum of the lights of a cell's list on a pixel, those `LocalLoop` names, in the order of their ranks; the light of a draw's record alone for `one`. */
const localLoopWgsl = Object.fromEntries(
  (['all', 'unbatched', 'one'] as const).map((loop) => [
    loop,
    wgslBlock(
      `LOCAL_LOOP_${loop.toUpperCase()}_WGSL`,
      loop === 'unbatched'
        ? [LOCAL_SHADOWED_WGSL]
        : loop === 'one'
          ? [PER_LIGHT_RECORD_BINDING_WGSL]
          : [],
      loop === 'one'
        ? `
fn localLighting(rgb:vec3f,metal:f32,rough:f32,N:vec3f,V:vec3f,P:vec3f,ao:f32,slice:vec2u)->vec3f{
 ${SHADING_TEXT()}
 return ${DECLARED_TERM_TEXT('perLight.rank')};
}`
        : `
fn localLighting(rgb:vec3f,metal:f32,rough:f32,N:vec3f,V:vec3f,P:vec3f,ao:f32,slice:vec2u)->vec3f{
 var result=vec3f(0.0);
 ${SHADING_TEXT()}
 // The walk of the simple lights alone starts at the first of them, not at the head of the scene's.
 for(var index=select(0u,firstSimpleIndex(slice),classicSimpleOnly);index<slice.y;index++){
  let rank=listedLight(slice,index);
  if(!listedDrawn(slice,rank)){continue;}
  if(isSun(directLights.items[rank])){continue;}${LOCAL_LOOP_SKIPS[loop]}
  result+=${DECLARED_TERM_TEXT()};
 }
 return result;
}`,
    ),
  ]),
) as Record<LocalLoop, ReturnType<typeof wgslBlock>>

/** The record of the pixel's cell of the light grid (`pixelCellWgsl`), the list the pass reads of it, and
 *  the cell the masks are read at. */
const PIXEL_CELL = `
 let record=pixelCell(pixel.xy,z);
 let cell=cellSlice(record);
 vsmMaskAt(coord,record);`

/**
 * THE TOON DATA a pass of lights writes beside the light, where the program holds it (`ContractKey.toonData`): the diffuse light of the pixel's toon
 * light terms, unramped and pre-exposed, and their weight and weighted cosine (`toonLightOut`), added to two more targets of the lit image's pass
 * as the light is added to the image; the pass after the lights reads them (`toonMain`). `litOut` is a pass's result: the light, and that data.
 */
export const TOON_DATA_OUT_WGSL = wgslBlock(
  'TOON_DATA_OUT_WGSL',
  [],
  `
struct LitOut{@location(0) light:vec4f,@location(1) toon0:vec4f,@location(2) toon1:vec2f,}
fn litOut(light:vec4f)->LitOut{
 let exposure=view.preExposure.x;
 return LitOut(light,vec4f(toonDiffuse*exposure,0.0),vec2f(toonWeight,toonWeightedNoL)*exposure);
}`,
)

/** The toon data the pass after the lights reads (`toonMain`): the diffuse light and the weights, in the group after the pass's own. */
const TOON_DATA_READ_WGSL = wgslBlock(
  'TOON_DATA_READ_WGSL',
  [],
  `
@group(1) @binding(${TOON_DATA_BINDINGS.diffuse}) var toonData0:texture_2d<f32>;
@group(1) @binding(${TOON_DATA_BINDINGS.weights}) var toonData1:texture_2d<f32>;`,
)

/** The type of a pass's result, with its location when it is the light alone, and how it makes it from the light `light`: the light alone, or with the toon data (`TOON_DATA_OUT_WGSL`). */
export const resultOf = (data: boolean) => (data ? 'LitOut' : '@location(0) vec4f')
export const resultFrom = (data: boolean, light: string) => (data ? `litOut(${light})` : light)

/**
 * The key of the lights a pass lights, for the class `tileClass`: the lobes are the class's
 * (`CLASS_CUTS`), whatever the frame's key says of the lobes — the key says whether the program holds
 * the class —, and the sun's pass holds no rectangle code.
 */
export const keyOfClass = (key: ContractKey, tileClass: TileClass, rect: boolean): ContractKey => ({
  ...key,
  rectless: key.rectless || !rect,
  lobeless: !CLASS_CUTS[tileClass].lobes,
})

/**
 * What the passes that light a pixel by a light's term list beside their light loop (the sun's, the local lights' and the per-light draw), for
 * the class `tileClass` under the key `lights`: the `cut` of the class, the `head` before the loop's own bindings (the pixel, its occlusion,
 * its lighting channels and the contact scene where the program holds them) and the `tail` after the loop (the thin transmission's and
 * the lobes' targets where the class holds them).
 */
export function litPassImports(lights: ContractKey, tileClass: TileClass) {
  const cut = litCutOf(tileClass, lights)
  return {
    cut,
    head: [
      LIT_PIXEL_WGSL,
      SCREEN_OCCLUSION_WGSL,
      ...(cut.channels ? [LIT_CHANNELS_WGSL] : []),
      ...(cut.closures ? [CLOSURE_READ_WGSL] : []),
      ...(lights.contactless ? [] : [DEFERRED_CONTACT_SCENE_WGSL]),
    ],
    tail: [
      ...(cut.thin ? [SUBSURFACE_BINDING_WGSL] : []),
      ...(cut.lobes ? [LOBES_TARGET_WGSL] : []),
    ],
  }
}

/**
 * The sun's pass for the tiles of `tileClass`, under the key `key`'s cuts of shadow code
 * (`unshadowed`) and list width (`narrow`): the entry `sunMain`, which adds the pre-exposed light of
 * the scene's directional lights to the pixel, nothing where it is lit by none. With `furnace`, the program of the shading furnace test
 * (`furnaceWgsl.ts`) over the same bindings: its entries in place of `sunMain`.
 */
export function sunPassWgsl(key: ContractKey, tileClass: TileClass, furnace = false) {
  const lights = keyOfClass(key, tileClass, false)
  const { cut, head, tail } = litPassImports(lights, tileClass)
  const data = !!cut.toonData && !furnace
  return wgslBlock(
    `sunPassWgsl(${variantLabel(lights)}, ${tileClass}${furnace ? ', furnace' : ''})`,
    [
      lightingBase(withVolumeShadow(withContactBend(SUN_BINDINGS, lights), lights), lights, {
        narrow: key.narrow,
        environment: false,
        slices: false,
        cut,
      }),
      ...head,
      LIGHTS_BINDING_WGSL,
      SUN_RANKS_BINDING_WGSL,
      TILE_VERTEX_WGSL,
      SUN_LOOP_WGSL,
      ...tail,
      ...(data ? [TOON_DATA_OUT_WGSL] : []),
      ...(furnace ? [furnaceCoatWgsl(!!cut.lobes), FURNACE_WGSL] : []),
    ],
    furnace
      ? furnaceEntries(cut)
      : `
@fragment fn sunMain(@builtin(position) pixel:vec4f)->${resultOf(data)}{${litPixelStatements(cut)}
 vsmMaskAt(coord);${closureTail(
   cut,
   'lightOut(sunLighting(albedo,base.a,normal.a,N,V,P,screenOcclusionAt(coord)))',
   (light) => `\n return ${resultFrom(data, light)};`,
 )}
}`,
  )
}

/**
 * The local lights' pass for the tiles of `tileClass`, under the key's cuts: the entry `localMain`,
 * which adds the pre-exposed light of the lights of the pixel's cell to the pixel, those `loop` names (`LocalLoop`). The program of the
 * `single` class (the models, no lobe) holds `toonMain` besides where the program writes the toon data (`ContractKey.toonData`, `toonUnifiedDiffuse`),
 * which the pass after the lights draws the tiles of the toon pixels with: the toon data every light's draw added (`TOON_DATA_OUT_WGSL`) read, the ramp
 * applied once to the sum of the diffuse light (`toonApplyDiffuse`); and `visibilityMain`, which the view of the shadows
 * (`LIT_VIEWS`) draws the tiles of every class with: it sums every light of the cell, the directional
 * ones too, as a shadow catcher reads them (`MODEL_FLAG.shadow`, `CATCHER_SHADOWED`) and shows the
 * share of their light the shadows let through, white
 * where no shadowed light reaches.
 */
const SAMPLED_LIGHT_BINDING_WGSL = wgslBlock(
  'SAMPLED_LIGHT_BINDING_WGSL',
  [],
  `@group(0) @binding(${DEFERRED_BINDINGS.sampledLight}) var sampledLight:texture_2d<f32>;`,
)

/** The body of the local lights' pass where the sampled lighting lights them (`ContractKey.sampled`): no walk of the scene's lights, the light the sampled lighting left for
 *  the pixel, un-exposed to go through `lightOut`'s pre-exposure again, and its scattering luminance in `scatterLuma`; and the walk of the simple lights it leaves
 *  to this pass (not `sampledTakes`, the setting `sampledSimpleLights`), where the image has any. */
const sampledLocalBody = (data: boolean) => `
 let left=textureLoad(sampledLight,coord,0);
 let exposure=max(view.preExposure.x,1e-20);
 scatterLuma=left.a/exposure;
 var lit=left.rgb/exposure;
 if((directLights.simpleBits>>${SIMPLE_HEADER.classicShift}u)!=0u){
  classicSimpleOnly=true;${PIXEL_CELL}
  lit+=localLighting(albedo,base.a,normal.a,N,V,P,screenOcclusionAt(coord),cell);
 }
 return ${resultFrom(data, 'lightOut(lit)')};`

export function localPassWgsl(
  key: ContractKey,
  tileClass: TileClass,
  { loop = 'all' }: { loop?: LocalLoop } = {},
) {
  const lights = keyOfClass(key, tileClass, true)
  const { cut, head, tail } = litPassImports(lights, tileClass)
  const visibility = cut.models && !cut.lobes && loop === 'all'
  const data = !!cut.toonData
  // The sampled lighting lights no light by the loop: the one light of a draw is read from the loop alone.
  const sampled = key.sampled && loop !== 'one'
  return wgslBlock(
    `localPassWgsl(${variantLabel(lights)}, ${tileClass}${loop === 'all' ? '' : `, ${loop}`})`,
    [
      lightingBase(
        withVolumeShadow(
          withContactBend(visibility ? VISIBILITY_BINDINGS : LOCAL_BINDINGS, lights),
          lights,
        ),
        lights,
        {
          narrow: key.narrow,
          environment: false,
          cut,
          // The loop skips the directional lights, the air's alone; the shadows' view sums them.
          airTint: visibility,
        },
      ),
      pixelCellWgsl(),
      ...head,
      LIGHTS_BINDING_WGSL,
      TILES_BINDING_WGSL,
      TILE_VERTEX_WGSL,
      localLoopWgsl[loop],
      ...(visibility && data ? [TOON_APPLY_WGSL, TOON_DATA_READ_WGSL] : []),
      ...(data ? [TOON_DATA_OUT_WGSL] : []),
      ...(sampled ? [SAMPLED_LIGHT_BINDING_WGSL] : []),
      ...tail,
    ],
    `
@fragment fn localMain(@builtin(position) pixel:vec4f)->${resultOf(data)}{${litPixelStatements(cut)}${
      sampled
        ? sampledLocalBody(data)
        : `${PIXEL_CELL}${closureTail(
            cut,
            'lightOut(localLighting(albedo,base.a,normal.a,N,V,P,screenOcclusionAt(coord),cell))',
            (light) => `\n return ${resultFrom(data, light)};`,
          )}`
    }
}${
      visibility && data
        ? `
@fragment fn toonMain(@builtin(position) pixel:vec4f)->@location(0) vec4f{${litPixelStatements(cut)}
 if(pixelModelId!=${PIXEL_MODEL.toon}u){discard;}
 return vec4f(toonApplyDiffuse(textureLoad(toonData0,coord,0).rgb,textureLoad(toonData1,coord,0).rg),0.0);
}`
        : ''
    }${
      visibility
        ? `
@fragment fn visibilityMain(@builtin(position) pixel:vec4f)->@location(0) vec4f{${litPixelStatements(cut)}
 surfaceModel=${MODEL_FLAG.shadow}u;${PIXEL_CELL}
 let seen=sliceLighting(albedo,base.a,normal.a,N,V,P,screenOcclusionAt(coord),cell);
 return vec4f(vec3f(select(1.0,seen.x/seen.y,seen.y>0.0)),0.0);
}`
        : ''
    }`,
  )
}
