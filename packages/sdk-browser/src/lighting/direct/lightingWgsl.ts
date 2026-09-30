import { residentProxyWgsl } from '../../bounce/nodeWgsl.ts';
import { directLightWgsl } from './lightWgsl.ts';
import { LIGHT_SETTINGS } from '../../../../sdk-core/src/index.ts';
import { SUN_WINDOW } from '../../../../sdk-core/src/scene/light-shadow/virtual.ts';
import { RECT_SHADING_WGSL } from './rectLightWgsl.ts';
import { irradianceShader } from '../../../../sdk-core/src/scene/core/irradianceBasis.ts';
import { SURFACE_MODEL_LIGHT_WGSL } from '../../scene/surfaceModel.ts';
import { declaredLightWgsl, sliceLightingWgsl } from './lightLoopWgsl.ts';
import { directLightSamplingWgsl } from './lightSamplingWgsl.ts';
import { directShadowWgsl } from './shadowWgsl.ts';
import { sunFarShadowWgsl, SUN_FAR_PROXY_BINDING } from '../../gpu/shadow/sunFarShadowWgsl.ts';
import { INVERSE_PI } from '../shaderConstants.ts';
import { FOG_WGSL } from '../fogShader.ts';

/** Shadow bindings of the opaque resolve: records and page table, the request buffer, and the
 *  transmittance layer's two textures — on the numbers the water composite reads them at too. */
export const CONTRACT_SHADOW_BINDINGS = {
  data: 8,
  requests: 14,
  transmittance: 18,
  translucentDepth: 19,
};

/** A cell's list of lights — what the resolves walk, and the shadow demand pass
 *  (`../../webgpu/shadow/demandWgsl.ts`). */
export const TILE_SLICE_WGSL = `
/** Where the lights of the cell whose record starts at \`base\` start in the view's pool, and how
 *  many (#1369). \`TILE_NO_SLICE\` when the pool had no room: every declared light of the scene. */
fn cellSlice(base:u32)->vec2u{
 let first=tileLights[base+1u];
 return vec2u(first,select(tileLights[base]&~TILE_SHADOWED,directLights.count,first==TILE_NO_SLICE));
}`;
/**
 * Base of the two lighting passes: contract types, shadow reads, and the contribution of a
 * single declared light at the point, its shadow included — the engine's only lighting
 * formula. The two loops below differ only by the light list they walk, never by the
 * physics or the surface type. A light out of range, or fully in shadow, yields exactly zero.
 *
 * The sun shadow beyond the last clipmap level is part of it: both passes bind the resident
 * proxy and fire the same ray. The parameters are the **ranks** of the bindings, which the
 * layouts number differently, and the right to write: the two count counters of the far ray,
 * and the shadow requests — the opaque resolve asks for the pages it reads; the blend and water
 * passes read what it asked for, and keep their early depth reject.
 */
const lightingBase = (
  proxyBinding: number,
  shadowBinding: number,
  requestBinding: number | null,
  transmittanceBinding: number,
  pages: number,
  narrow = false,
  shadowed = true,
  rects = true,
) => `
${directLightWgsl(narrow ? LIGHT_SETTINGS.tileLights : undefined)}
${residentProxyWgsl(proxyBinding, requestBinding !== null)}
${sunFarShadowWgsl(requestBinding !== null)}
${directShadowWgsl(shadowBinding, requestBinding, transmittanceBinding, pages)}
${SURFACE_MODEL_LIGHT_WGSL}
${RECT_SHADING_WGSL}
${FOG_WGSL}
var<private> thinSubsurface:vec3f=vec3f(0.0);
/** Thin two-sided diffuse transmission: projected back irradiance, normalized over a hemisphere.
 * Material contract: Epic public Two Sided Foliage; this is our Lambert implementation. */
fn thinTransmission(cosine:f32,energy:f32)->f32{return max(-cosine,0.0)*energy*${INVERSE_PI};}
${declaredLightWgsl(shadowed, rects)}
/** The environment's irradiance at the normal N (\`packages/sdk-core/src/scene/core/environment.ts\`), on the diffuse lobe:
 *  what an ambient, a sky over a ground or a probe gives a surface, never shadowed. */
fn environmentLighting(rgb:vec3f,metal:f32,N:vec3f,ao:f32)->vec3f{
 let e=directLights.environment;
 let E=${irradianceShader((k) => `e[${k}].rgb`, 'N')};
 return rgb*(1.0-metal)*max(E,vec3f(0.0))*ao*${INVERSE_PI};
}
${TILE_SLICE_WGSL}${sliceLightingWgsl(!shadowed)}`;

/**
 * Resolve of the direct-lighting contract in the visibility buffer. The pixel loop is bounded
 * by the list of its cell of the light grid, never by the scene light count (X2); Lambert and GGX
 * come from `standardLighting`, the only reference implementation; attenuation is physical and
 * cancels at range.
 *
 * No light without a declared source (P6): there is no ambient term here, no constant sky, no
 * lighting written in the scene. A surface that no declared light reaches is exactly zero,
 * and a windowless corridor stays black in full daylight.
 *
 * `view.viewport.w` is the rank of a SAMPLED image — a moving one that temporal antialiasing
 * accumulates — and zero for every other: a still image, which converges to the exact sum,
 * and an image that does not accumulate, which is never noisy. At zero the loop is the one
 * over every light of the cell, character for character; so is it on a sampled image whose cell
 * lists no shadowed light (#1249), a flag the grid pass writes once in the cell's count.
 *
 * `narrow` is the resolve of a scene of at most `TILE_LIGHTS` lights (#849): its light array is
 * that long. Without `shadowed`, the resolve of a scene no light of which holds a shadow slot: the
 * same sums with no shadow code compiled in (`declaredLightWgsl`, #1249) and the range reject in
 * its loop (`sliceLightingWgsl`). Without `rects`, the resolve of a scene that holds no rectangle
 * light: the same sums with no rectangle code in the light loop (`declaredLightWgsl`, #1369).
 */
export const directLightingWgsl = (
  narrow = false,
  pages = SUN_WINDOW,
  shadowed = true,
  rects = true,
) => `
${lightingBase(SUN_FAR_PROXY_BINDING, CONTRACT_SHADOW_BINDINGS.data, CONTRACT_SHADOW_BINDINGS.requests, CONTRACT_SHADOW_BINDINGS.transmittance, pages, narrow, shadowed, rects)}
${directLightSamplingWgsl(rects)}
/** The record of the pixel's cell at depth \`z\`, \`TILE_NO_SLICE\` with no list: no light, or past
 *  the grid. The surface reads it once, for its shadow setup and its lighting (#1369). */
fn pixelCell(pixel:vec2f,z:f32)->u32{
 if(u32(view.lightParams.x)==0u){return TILE_NO_SLICE;}
 return gridCell(pixel,z,vec2u(view.lightParams.yz));
}
/** Whether a shadow is read in the cell: its list holds a light with a shadow slot, the high bit
 *  of its count. Never in the program with no shadow code. */
fn cellShadowed(cell:u32)->bool{${shadowed ? 'return cell!=TILE_NO_SLICE&&(tileLights[cell]&TILE_SHADOWED)!=0u;' : 'return false;'}}
/** Contribution of the contract lights to the pixel, light by light of its cell's list;
 *  \`shadowed\` is \`cellShadowed(cell)\`. The full sum has this one call site: a list the draw
 *  refuses — short, long, or with no room in the pool — takes it, as a still image does. */
fn contractLighting(rgb:vec3f,metal:f32,rough:f32,N:vec3f,V:vec3f,P:vec3f,ao:f32,pixel:vec2f,cell:u32,shadowed:bool)->vec3f{
 if(cell==TILE_NO_SLICE){return vec3f(0.0);}
 let slice=cellSlice(cell);
 let rank=u32(view.viewport.w);
 if(rank==0u||!shadowed||slice.x==TILE_NO_SLICE||!sampledList(slice.y)){return sliceLighting(rgb,metal,rough,N,V,P,ao,slice);}
 return sampledSliceLighting(rgb,metal,rough,N,V,P,ao,slice,rank,pixel);
}`;
export const DIRECT_LIGHTING_WGSL = directLightingWgsl();

/**
 * Declared lights that light a blend surface, taken from the list of the cell its own depth `z`
 * falls in (#1369): a blend surface drawn in front of its pixel's opaque, or against the sky,
 * finds the lights of the cell it stands in, never those of the opaque behind it.
 *
 * The loop stays **exact**, and its sum is that of the loop over every light, bit for bit:
 * a light absent from the list meets no point of the cell, so `declaredLight` would have returned
 * exactly `vec3f(0.0)`, and removing a zero from a float sum does not change it. What changes is
 * the number of lights walked, hence the number of shadow-atlas reads.
 *
 * With no list — a device that could not fit the grid pass, or a pixel past the grid —, the loop
 * falls back on the declared lights, every one of them.
 */
export const declaredLightingWgsl = (
  proxyBinding: number,
  shadowBinding: number,
  transmittanceBinding: number,
  pages = SUN_WINDOW,
) => `
${lightingBase(proxyBinding, shadowBinding, null, transmittanceBinding, pages)}
fn declaredLighting(rgb:vec3f,metal:f32,rough:f32,N:vec3f,V:vec3f,P:vec3f,ao:f32,pixel:vec2f,z:f32)->vec3f{
 let cell=gridCell(pixel,z,vec2u(uni.lightTiles));
 if(cell==TILE_NO_SLICE){return sliceLighting(rgb,metal,rough,N,V,P,ao,vec2u(TILE_NO_SLICE,directLights.count));}
 return sliceLighting(rgb,metal,rough,N,V,P,ao,cellSlice(cell));
}`;
