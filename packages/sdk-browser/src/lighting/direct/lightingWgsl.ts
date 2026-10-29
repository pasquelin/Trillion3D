import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { vsmTraceKindsOf } from '../shadows/vsm/trace/traceWgsl.ts'
import { directLightWgsl, LIGHT_GRID_WGSL } from './lightWgsl.ts'
import { lightUndrawn } from './lightReachWgsl.ts'
import { LIGHT_SETTINGS } from '../../../../sdk-core/src/scene/light/contracts.ts'
import { irradianceShader } from '../../../../sdk-core/src/scene/core/irradianceBasis.ts'
import { SURFACE_MODEL_LIGHT_WGSL } from '../../materials/surface/surfaceModel.ts'
import {
  airTintLabel,
  declaredLightWgsl,
  sliceLightingWgsl,
  type LightCut,
} from './lightLoopWgsl.ts'
import {
  type VsmConsumerBindings,
  type VsmMaskReadBindings,
  type VsmTraceBindings,
  vsmBindingsLabel,
  vsmTraceBindingsLabel,
} from './shadowBindings.ts'
import {
  raysLabel,
  type ContactBendBindings,
  type ContactRays,
} from '../contactShadow/contactShadowWgsl.ts'
import { directShadowWgsl, translucentShadowLabel, type TranslucentShadow } from './shadowWgsl.ts'
import { type ContractKey, variantLabel } from '../deferred/contractCuts.ts'
import { lambertDiffuse } from '../../../../math/src/wgsl/lighting.ts'
import { INVERSE_PI } from '../../../../math/src/wgsl/constants.ts'
import { fogBlockOf } from '../fog/readWgsl.ts'
import {
  lightFunctionBindingsLabel,
  lightFunctionReadWgsl,
  NO_LIGHT_FUNCTION_WGSL,
  type LightFunctionBindings,
} from '../lightFunction/readWgsl.ts'
import { fogBindingsLabel, type FogResourceBindings } from '../fog/readWgsl.ts'
import { lightProfileOfWgsl, NO_LIGHT_PROFILE_WGSL } from '../lightProfile/lightProfileWgsl.ts'
import {
  lightProfileBindingsLabel,
  type LightProfileBindings,
} from '../lightProfile/lightProfileText.ts'
import {
  cloudShadowReadWgsl,
  NO_CLOUD_SHADOW_WGSL,
  type CloudShadowBindings,
} from '../atmosphere/cloudShadowRead.ts'
import {
  LOBELESS_LIGHTING_WGSL,
  LOBELESS_MODELS_LIGHTING_WGSL,
  LOBELESS_RECT_WGSL,
  LOBES_LIGHTING_WGSL,
  LOBES_RECT_WGSL,
} from './lobesWgsl.ts'

/** A cell's list of lights over the grid the buffer `grid` holds — the view's light grid, `tileLights`,
 *  by default: what the resolves walk, and the virtual shadow maps' marking pass
 *  (`../shadows/vsm/markingWgsl.ts`). A pass that reads the shadowed lights' grid alone, which holds the
 *  view's grid head and records (`../shadows/vsm/projection/lightGridWgsl.ts`), reads its cells there. */
export const tileSliceWgsl = (grid = 'tileLights') =>
  wgslBlock(
    grid === 'tileLights' ? 'TILE_SLICE_WGSL' : `TILE_SLICE_WGSL_${grid}`,
    [LIGHT_GRID_WGSL, lightUndrawn],
    `
/** Where the lights of the cell whose record starts at \`base\` start in the view's pool, and how
 *  many (#1369). The one rule of a missing list, for every reader: \`TILE_NO_SLICE\` — no grid this
 *  image, or a cell the pool had no room for — walks every declared light
 *  of the scene, a light no list holds reaching no point of the cell, so the sum is the listed one.
 *  The view's grid never lacks a list: a column past its pool keeps the lights it got. */
fn cellSlice(base:u32)->vec2u{
 if(base==TILE_NO_SLICE){return vec2u(TILE_NO_SLICE,directLights.count);}
 let first=${grid}[base+1u];
 return vec2u(first,select(${grid}[base]&~TILE_SHADOWED,directLights.count,first==TILE_NO_SLICE));
}
/** The rank of a slice's \`index\`th light: the list's word, or, from \`TILE_NO_SLICE\`, every light in
 *  turn. */
fn listedLight(slice:vec2u,index:u32)->u32{
 if(slice.x==TILE_NO_SLICE){return index;}
 return ${grid}[slice.x+index];
}
/** Whether the walk of \`slice\` takes light \`rank\`: a list holds the lights the view draws alone, the walk of every light
 *  (\`TILE_NO_SLICE\`) leaves out the ones its kind word says it does not (\`lightUndrawn\`), so that both give a point the same lights. */
fn listedDrawn(slice:vec2u,rank:u32)->bool{
 return slice.x!=TILE_NO_SLICE||!lightUndrawn(directLights.items[rank]);
}
/** The first word of the record of the cell holding a pixel at depth \`z\`, \`cells\` the grid's
 *  columns across and down; \`TILE_NO_SLICE\` with no grid, a pixel past the grid reading its last
 *  column. The slice map the image's grid was listed by heads the buffer. */
fn gridCell(pixel:vec2f,z:f32,cells:vec2u)->u32{
 if(cells.x==0u||cells.y==0u){return TILE_NO_SLICE;}
 let column=min(vec2u(pixel)/TILE_SIZE,cells-vec2u(1u));
 let map=bitcast<vec3f>(vec3u(${grid}[0],${grid}[1],${grid}[2]));
 return GRID_HEAD+((column.y*cells.x+column.x)*GRID_SLICES+gridSlice(z,map))*TILE_STRIDE;
}`,
  )
export const TILE_SLICE_WGSL = tileSliceWgsl()
/**
 * A pixel's cell of the light grid, read by the local lights' pass (`../deferred/lightPassWgsl.ts`) and the
 * virtual shadow maps' marking pass (`../shadows/vsm/markingWgsl.ts`), both on the deferred view (#1369).
 */
export const pixelCellWgsl = () =>
  wgslBlock(
    'pixelCellWgsl',
    [],
    `
/** The record of the pixel's cell at depth \`z\` on the deferred view's grid, \`TILE_NO_SLICE\` with
 *  no list (\`cellSlice\`): the view's columns are zero on an image whose lists were not encoded.
 *  The pass reads it once, for its lights. */
fn pixelCell(pixel:vec2f,z:f32)->u32{return gridCell(pixel,z,vec2u(view.lightParams.yz));}`,
  )
/**
 * The **ranks** of the bindings a lighting program reads, which the layouts number differently.
 * The opaque lit passes read the virtual shadow maps' masks at `vsmSunMask` and `vsmMask`; the blend pass, without them, traces its
 * fragments over the virtual shadow maps `vsm` with `trace` (`directShadowWgsl`'s unless given).
 */
export type LightingBindings = {
  /** The suns' mask (a layer a sun) the pass reads: its presence makes a mask read of the shadows. */
  vsmSunMask?: number
  /** The local lights' mask the pass reads beside it, and, with it, where the maps are bound that a light
   *  past the mask's lanes is read from (`vsmSampleMapLocal`). A pass that walks no local light has
   *  none. */
  vsmMask?: number
  maskFallback?: VsmMaskReadBindings
  vsm?: VsmConsumerBindings
  /** Where the shadows the heterogeneous volumes cast are bound (`beerShadowReadWgsl`): each shadowed light's share is multiplied by the
   *  transmittance of the volumes toward it; left out, a program reads none. */
  volumeShadow?: number
  trace?: VsmTraceBindings
  /** The binding of the per-light draw's mask, an array a layer a light (`directShadowWgsl`, `pass: 'perLight'`): the
   *  shadow of the one light the draw lights is its layer, no other shadow read. */
  perLightMask?: number
  /** Where the fog's cubemap, volume and frame are bound (`fogBlockOf`); left out, a program holds
   *  no fog: the passes that light a surface and lay no fog over it. */
  fog?: FogResourceBindings
  /** Where the light functions' atlas and table are bound and the eye their fade is measured from
   *  (`lightFunctionReadWgsl`); left out, a program reads none: every light is unchanged. */
  lightFunction?: LightFunctionBindings
  /** Where the clouds' shade of the air's lights is bound (`cloudShadowReadWgsl`); left out, a program
   *  reads none: every light is unshaded (`NO_CLOUD_SHADOW_WGSL`). */
  cloudShadow?: CloudShadowBindings
  /** Where the light profiles' atlas and sampler are bound (`lightProfileOfWgsl`); left out, a program reads none:
   *  every light is unchanged (`NO_LIGHT_PROFILE_WGSL`). With the key's `profileless` the light term holds no profile
   *  read at all. */
  lightProfile?: LightProfileBindings
  /** The bindings of the screen-space contact shadows' array and of its layers' ranks (`contactBendWgsl`): a light with a layer in it takes its contact shadow from it. */
  contactBend?: ContactBendBindings
}

/** The bindings as a block name reads them, in their declared order, the defaults resolved. */
export const bindingsLabel = ({
  vsmSunMask,
  vsmMask,
  maskFallback,
  vsm,
  volumeShadow,
  trace,
  fog,
  lightFunction,
  cloudShadow,
  lightProfile,
  contactBend,
  perLightMask,
}: LightingBindings) =>
  `${vsmSunMask ?? null} ${vsmMask ?? null}${maskFallback ? ` + ${maskFallback.lightGrid} ${vsmBindingsLabel(maskFallback.vsm)} ${maskFallback.view}` : ''}, ${vsm ? vsmBindingsLabel(vsm) : null}${volumeShadow === undefined ? '' : ` volume ${volumeShadow}`}, ${trace ? vsmTraceBindingsLabel(trace) : null}, ${fog ? fogBindingsLabel(fog) : null}, ${lightFunctionBindingsLabel(lightFunction)}, ${cloudShadow ? `cloud ${cloudShadow.group}:${cloudShadow.block}` : null}${lightProfile ? `, profile ${lightProfileBindingsLabel(lightProfile)}` : ''}${contactBend ? `, contact bend ${contactBend.array} ${contactBend.ranks}` : ''}${perLightMask === undefined ? '' : `, per-light mask ${perLightMask}`}`

/**
 * The state a surface is lit through, and what a program does with the thin two-sided surface:
 * `thinSubsurface`, the transmission colour of the pixel (zero where it is not thin),
 * `thinScreenBack`, the irradiance at its back that the screen probes left in the pixel (`screenBackAt`,
 * `../bounce/screen/indirectWgsl.ts`) with its alpha 1 where they answered, or 2 with their front irradiance where the level gathers no
 * light at the back — set by the pass that reads them, zero in any other —, `thinCubeBack`, the irradiance the ambient cubemap gives its back
 * (`ambientCubemapBack`) — set by the pass that reads the cube, zero in any other —, and `thinSurface`, the one test every term of its back reads.
 */
export const THIN_SURFACE_WGSL = wgslBlock(
  'THIN_SURFACE_WGSL',
  [],
  `
var<private> thinSubsurface:vec3f=vec3f(0.0);
var<private> thinScreenBack:vec4f=vec4f(0.0);
var<private> thinCubeBack:vec3f=vec3f(0.0);
/** Whether the surface is thin and two-sided, the one test every term of its back reads. */
fn thinSurface()->bool{return any(thinSubsurface!=vec3f(0.0));}`,
)

/**
 * The light a surface gets from the environment, and the one sum of a lit surface. The program that
 * lists it reads the light buffer by `directLights`, and lists the answers it asks of the probes and
 * the lobes: `environmentSky`, `indirectIrradiance`, `clothDiffuse`.
 */
export const ENVIRONMENT_LIGHTING_WGSL = wgslBlock(
  'ENVIRONMENT_LIGHTING_WGSL',
  [THIN_SURFACE_WGSL, lambertDiffuse, INVERSE_PI],
  `
/** The environment's irradiance at the normal N (\`packages/sdk-core/src/scene/core/environment.ts\`):
 *  what an ambient, a sky over a ground or a probe gives a surface, never shadowed. */
fn environmentIrradiance(N:vec3f)->vec3f{
 let e=directLights.environment;
 return max(${irradianceShader((k) => `e[${k}].rgb`, 'N')},vec3f(0.0));
}
/** The diffuse light of a surface lit by \`irradiance\` (\`lambertDiffuse\`), on the pixel's diffuse colour (\`clothDiffuse\`: a
 *  cloth's fuzz added to it): the one sum of every source of the surface's diffuse light, the environment's and the
 *  ambient cubemap's. */
fn environmentLightingFrom(rgb:vec3f,metal:f32,irradiance:vec3f,ao:f32)->vec3f{
 let d=clothDiffuse(rgb,metal);
 return lambertDiffuse(d.rgb,d.w,irradiance,ao);
}
/** The environment's diffuse light on a surface: its irradiance and, in a program that reads no probes, the sky
 *  light's (\`environmentSky\`) — in one that does, the probes carry the sky (\`indirectIrradiance\`). */
fn environmentLighting(rgb:vec3f,metal:f32,N:vec3f,ao:f32)->vec3f{
 return environmentLightingFrom(rgb,metal,environmentIrradiance(N)+environmentSky(N),ao);
}
/** A thin two-sided surface's back, the one sum of it: the light the probes give and the environment's,
 *  lit from \`-N\` on its subsurface colour (\`lambertDiffuse\`); the probes' light is the screen probes'
 *  where they left one in the pixel (\`thinScreenBack\`, a black back kept black), else the world's
 *  (\`indirectIrradiance\`: a pass with no bounce answers zero); a level that gathers no back light folds the
 *  subsurface colour, over pi, into the front diffuse instead. Zero on any other surface. */
fn thinBack(N:vec3f,P:vec3f,ao:f32)->vec3f{
 if(!thinSurface()){return vec3f(0.0);}
 if(thinScreenBack.a==2.0){
  return lambertDiffuse(thinSubsurface*INVERSE_PI,0.0,thinScreenBack.rgb,1.0)+lambertDiffuse(thinSubsurface*INVERSE_PI,0.0,environmentIrradiance(N)+environmentSky(N)+thinCubeBack,ao);
 }
 var probes=thinScreenBack.rgb;
 if(thinScreenBack.a==0.0){probes=indirectIrradiance(P,-N);}
 return lambertDiffuse(thinSubsurface,0.0,probes+environmentIrradiance(-N)+environmentSky(-N)+thinCubeBack,ao);
}
/** The lit surface, one sum for every pass that lights one (the indirect light's pass, the translucent
 *  surfaces): its declared \`lights\`, its \`bounce\` and \`environment\` under the coat
 *  the \`reflection\` and what it \`emissive\`ly gives, added in this order, then a
 *  thin two-sided surface's back (\`thinBack\`) at the point \`P\` of normal \`N\`. A pass with no
 *  bounce gives zero. */
fn litSurface(lights:vec3f,bounce:vec3f,environment:vec3f,reflection:vec3f,emissive:vec3f,N:vec3f,P:vec3f,ao:f32)->vec3f{
 return lights+bounce+environment+reflection+emissive+thinBack(N,P,ao);
}`,
)

/** The shadow read of a pass: the per-light mask's, the shadow maps' own, or the sun and local masks'. */
const shadowReadOf = (
  bindings: LightingBindings,
  key: Partial<ContractKey>,
  translucentShadow: TranslucentShadow | undefined,
) =>
  directShadowWgsl(
    bindings.perLightMask !== undefined
      ? { pass: 'perLight', mask: bindings.perLightMask, volumeShadow: bindings.volumeShadow }
      : bindings.vsmSunMask === undefined
        ? {
            vsm: bindings.vsm,
            trace: bindings.trace,
            kinds: vsmTraceKindsOf(key),
            ...translucentShadow,
          }
        : {
            pass: 'mask',
            sun: bindings.vsmSunMask,
            local: bindings.vsmMask,
            volumeShadow: bindings.volumeShadow,
            fallback: bindings.maskFallback,
          },
  )

/**
 * Base of the lighting passes: contract types, shadow reads, and the contribution of a
 * single declared light at the point, its shadow included — the engine's only lighting
 * formula. The loops differ only by the light list they walk, never by the
 * physics or the surface type. A light out of range, or fully in shadow, yields exactly zero.
 * What `key` leaves out is not compiled (`ContractKey`); `narrow`, the opaque lit passes' alone;
 * `translucentShadow`, a blend pass's alone: how its fragments read a light's shadow
 * (`directShadowWgsl`), the defaults unless given. `environment`, whether the base holds the
 * environment's light and the surface's sum (`ENVIRONMENT_LIGHTING_WGSL`), which a pass of direct
 * light alone does not need; `slices`, whether it holds the walk of a cell's list of lights
 * (`TILE_SLICE_WGSL`, `sliceLighting`), which the pass of the sun does not; `cut`, what the light term
 * holds of the surface models (`LightCut`), the whole term unless given; `rays`, the contact shadows' rays the pass casts
 * (`ContactRays`; `asked` for a translucent pass, whose contact shadows are the ray of the surface whose material asks alone;
 * `declaredLightWgsl`).
 */
export const lightingBase = (
  bindings: LightingBindings,
  key: Partial<ContractKey>,
  {
    narrow = false,
    translucentShadow,
    environment = true,
    slices = true,
    cut,
    airTint = true,
    rays,
  }: {
    narrow?: boolean
    translucentShadow?: TranslucentShadow
    environment?: boolean
    slices?: boolean
    cut?: LightCut
    airTint?: boolean
    rays?: ContactRays
  } = {},
) =>
  wgslBlock(
    `lightingBase(${bindingsLabel(bindings)}, ${variantLabel(key)}, ${narrow}${translucentShadowLabel(translucentShadow)}${environment ? '' : ', direct light only'}${slices ? '' : ', no lists'}${cut ? `, ${cut.models}, ${cut.thin}` : ''}${airTintLabel(airTint)}${rays ? raysLabel(rays) : ''})`,
    [
      SURFACE_MODEL_LIGHT_WGSL,
      ...(key.lobeless
        ? [(cut?.models ?? true) ? LOBELESS_MODELS_LIGHTING_WGSL : LOBELESS_LIGHTING_WGSL]
        : [LOBES_LIGHTING_WGSL]),
      // A rectless program compiles no rectangle shading at all.
      ...(key.rectless ? [] : [key.lobeless ? LOBELESS_RECT_WGSL : LOBES_RECT_WGSL]),
      lambertDiffuse,
      directLightWgsl(narrow ? LIGHT_SETTINGS.tileLights : undefined),
      shadowReadOf(bindings, key, translucentShadow),
      ...(bindings.fog ? [fogBlockOf(bindings.fog)] : []),
      bindings.lightFunction
        ? lightFunctionReadWgsl(bindings.lightFunction)
        : NO_LIGHT_FUNCTION_WGSL,
      bindings.cloudShadow ? cloudShadowReadWgsl(bindings.cloudShadow) : NO_CLOUD_SHADOW_WGSL,
      ...(key.profileless
        ? []
        : [
            bindings.lightProfile
              ? lightProfileOfWgsl(bindings.lightProfile)
              : NO_LIGHT_PROFILE_WGSL,
          ]),
      declaredLightWgsl(key, { cut, airTint, rays, bend: bindings.contactBend }),
      ...(slices ? [TILE_SLICE_WGSL, sliceLightingWgsl('surface', cut?.models ?? true)] : []),
      THIN_SURFACE_WGSL,
      ...(environment ? [ENVIRONMENT_LIGHTING_WGSL] : []),
    ],
    '',
  )
