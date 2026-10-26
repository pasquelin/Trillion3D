/**
 * THE DIRECT LIGHT, AS TWO PASSES OVER THE TILES OF THE LIT SURFACES (`tileClass.ts`), added to the
 * lit image:
 * - the sun's pass: the directional lights — every one of the scene's, by their ranks in the light
 *   buffer (`sunRanks`) — on every pixel of the tile, their shadows read in the frame's mask and the
 *   sun's distance-field shadow, their light and the clouds' shade on them;
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
  DEFERRED_LIGHT_FUNCTION_BINDINGS,
} from './bindings.ts'
import { variantLabel, type ContractKey } from './contractCuts.ts'
import {
  CLASS_CUTS,
  LIT_PIXEL_WGSL,
  SUBSURFACE_BINDING_WGSL,
  litPixelStatements,
} from './litSurfaceWgsl.ts'
import { TILE_VERTEX_WGSL } from './tilePass.ts'
import type { TileClass } from './tileClass.ts'
import { LOBES_TARGET_WGSL } from '../direct/lobesWgsl.ts'
import { lightingBase, pixelCellWgsl, type LightingBindings } from '../direct/lightingWgsl.ts'
import { CONTRACT_SHADOW_BINDINGS } from '../direct/shadowBindings.ts'

/** The light buffer. */
const LIGHTS_BINDING_WGSL = wgslBlock(
  'LIGHTS_BINDING_WGSL',
  [],
  `@group(0) @binding(${DEFERRED_BINDINGS.lights}) var<storage,read> directLights:DirectLights;`,
)
/** The light grid's lists. */
const TILES_BINDING_WGSL = wgslBlock(
  'TILES_BINDING_WGSL',
  [],
  `@group(0) @binding(${DEFERRED_BINDINGS.tiles}) var<storage,read> tileLights:array<u32>;`,
)
/** The ranks of the directional lights in the light buffer, after their count: the sun pass's
 *  list, in the place of a cell's. */
const SUN_RANKS_BINDING_WGSL = wgslBlock(
  'SUN_RANKS_BINDING_WGSL',
  [],
  `@group(0) @binding(${DEFERRED_BINDINGS.sunRanks}) var<storage,read> sunRanks:array<u32>;`,
)

/** What the sun's pass binds for its light terms: the suns' mask, the sun's
 *  distance-field shadow, the light functions and the clouds' shade. */
const SUN_BINDINGS: LightingBindings = {
  vsmSunMask: CONTRACT_SHADOW_BINDINGS.vsmSunMask,
  farShadowMask: DEFERRED_BINDINGS.farShadowMask,
  lightFunction: DEFERRED_LIGHT_FUNCTION_BINDINGS,
  cloudShadow: DEFERRED_CLOUD_SHADOW_BINDINGS,
}
/** The local lights' pass: no distance-field shadow of the sun, no clouds' shade — the air's lights
 *  are directional. */
const LOCAL_BINDINGS: LightingBindings = {
  vsmSunMask: CONTRACT_SHADOW_BINDINGS.vsmSunMask,
  vsmMask: CONTRACT_SHADOW_BINDINGS.vsmMask,
  maskFallback: CONTRACT_SHADOW_BINDINGS.fallback,
  lightFunction: DEFERRED_LIGHT_FUNCTION_BINDINGS,
}
/** The view of the shadows sums the suns of the cell too, so its program reads the sun's distance-field
 *  shadow as the sun's pass does. */
const VISIBILITY_BINDINGS: LightingBindings = {
  ...LOCAL_BINDINGS,
  farShadowMask: DEFERRED_BINDINGS.farShadowMask,
}

/** The sum of the directional lights of the scene on a pixel, in the order of their ranks. */
const SUN_LOOP_WGSL = wgslBlock(
  'SUN_LOOP_WGSL',
  [],
  `
fn sunLighting(rgb:vec3f,metal:f32,rough:f32,N:vec3f,V:vec3f,P:vec3f,ao:f32)->vec3f{
 var result=vec3f(0.0);
 let shading=lobeSurface(rgb,metal,rough,N,V);lobeView(shading);
 for(var index=1u;index<=sunRanks[0];index++){
  result+=declaredLight(sunRanks[index],rgb,metal,rough,N,V,P,ao,shading);
 }
 return result;
}`,
)

/** The sum of the lights of a cell's list on a pixel but the directional ones, in the order of
 *  their ranks. */
const LOCAL_LOOP_WGSL = wgslBlock(
  'LOCAL_LOOP_WGSL',
  [],
  `
fn localLighting(rgb:vec3f,metal:f32,rough:f32,N:vec3f,V:vec3f,P:vec3f,ao:f32,slice:vec2u)->vec3f{
 var result=vec3f(0.0);
 let shading=lobeSurface(rgb,metal,rough,N,V);lobeView(shading);
 for(var index=0u;index<slice.y;index++){
  let rank=listedLight(slice,index);
  if(isSunKind(directLights.items[rank].params.x)){continue;}
  result+=declaredLight(rank,rgb,metal,rough,N,V,P,ao,shading);
 }
 return result;
}`,
)

/** The record of the pixel's cell of the light grid (`pixelCellWgsl`), the list the pass reads of it, and
 *  the cell the masks are read at. */
const PIXEL_CELL = `
 let record=pixelCell(pixel.xy,z);
 let cell=cellSlice(record);
 vsmMaskAt(coord,record);`

/**
 * The key of the lights a pass lights, for the class `tileClass`: the lobes are the class's
 * (`CLASS_CUTS`), whatever the frame's key says of the lobes — the key says whether the program holds
 * the class —, and the sun's pass holds no rectangle code.
 */
const keyOfClass = (key: ContractKey, tileClass: TileClass, rect: boolean): ContractKey => ({
  ...key,
  rectless: key.rectless || !rect,
  lobeless: !CLASS_CUTS[tileClass].lobes,
})

/**
 * The sun's pass for the tiles of `tileClass`, under the key `key`'s cuts of shadow code
 * (`unshadowed`) and list width (`narrow`): the entry `sunMain`, which adds the pre-exposed light of
 * the scene's directional lights to the pixel, nothing where it is lit by none.
 */
export function sunPassWgsl(key: ContractKey, tileClass: TileClass) {
  const cut = CLASS_CUTS[tileClass]
  const lights = keyOfClass(key, tileClass, false)
  return wgslBlock(
    `sunPassWgsl(${variantLabel(lights)}, ${tileClass})`,
    [
      lightingBase(SUN_BINDINGS, lights, {
        narrow: key.narrow,
        environment: false,
        slices: false,
        cut,
      }),
      LIT_PIXEL_WGSL,
      LIGHTS_BINDING_WGSL,
      SUN_RANKS_BINDING_WGSL,
      TILE_VERTEX_WGSL,
      SUN_LOOP_WGSL,
      ...(cut.thin ? [SUBSURFACE_BINDING_WGSL] : []),
      ...(cut.lobes ? [LOBES_TARGET_WGSL] : []),
    ],
    `
@fragment fn sunMain(@builtin(position) pixel:vec4f)->@location(0) vec4f{${litPixelStatements(cut)}
 vsmMaskAt(coord);
 return lightOut(sunLighting(albedo,base.a,normal.a,N,V,P,emissive.a),lightView);
}`,
  )
}

/**
 * The local lights' pass for the tiles of `tileClass`, under the key's cuts: the entry `localMain`,
 * which adds the pre-exposed light of the lights of the pixel's cell to the pixel. The program of the
 * `single` class (the models, no lobe) holds `visibilityMain` besides, which the view of the shadows
 * (`LIT_VIEWS`) draws the tiles of every class with: it sums every light of the cell, the directional
 * ones too, as a shadow catcher reads them (`MODEL_FLAG.shadow`, `CATCHER_SHADOWED`) and shows the
 * share of their light the shadows let through, the sun's distance-field shadow among them, white
 * where no shadowed light reaches.
 */
export function localPassWgsl(key: ContractKey, tileClass: TileClass) {
  const cut = CLASS_CUTS[tileClass]
  const lights = keyOfClass(key, tileClass, true)
  const visibility = cut.models && !cut.lobes
  return wgslBlock(
    `localPassWgsl(${variantLabel(lights)}, ${tileClass})`,
    [
      lightingBase(visibility ? VISIBILITY_BINDINGS : LOCAL_BINDINGS, lights, {
        narrow: key.narrow,
        environment: false,
        cut,
        // The loop skips the directional lights, the air's alone; the shadows' view sums them.
        airTint: visibility,
      }),
      pixelCellWgsl(),
      LIT_PIXEL_WGSL,
      LIGHTS_BINDING_WGSL,
      TILES_BINDING_WGSL,
      TILE_VERTEX_WGSL,
      LOCAL_LOOP_WGSL,
      ...(cut.thin ? [SUBSURFACE_BINDING_WGSL] : []),
      ...(cut.lobes ? [LOBES_TARGET_WGSL] : []),
    ],
    `
@fragment fn localMain(@builtin(position) pixel:vec4f)->@location(0) vec4f{${litPixelStatements(cut)}${PIXEL_CELL}
 return lightOut(localLighting(albedo,base.a,normal.a,N,V,P,emissive.a,cell),lightView);
}${
      visibility
        ? `
@fragment fn visibilityMain(@builtin(position) pixel:vec4f)->@location(0) vec4f{${litPixelStatements(cut)}
 surfaceModel=${MODEL_FLAG.shadow}u;${PIXEL_CELL}
 let seen=sliceLighting(albedo,base.a,normal.a,N,V,P,emissive.a,cell);
 return vec4f(vec3f(select(1.0,seen.x/seen.y,seen.y>0.0)),0.0);
}`
        : ''
    }`,
  )
}
