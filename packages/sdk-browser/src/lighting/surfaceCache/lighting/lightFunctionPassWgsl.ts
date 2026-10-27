import { wgslProgram } from '../../../../../math/src/wgsl/assemble.ts'
import { fallbackOf } from '../../../materials/graph/program.ts'
import { tileDeclarations } from '../../../materials/virtual/wgsl.ts'
import { MAP_BINDINGS, MAP_SAMPLER_BINDING } from '../../lightFunction/mapBindings.ts'
import { KINDS } from '../../lightFunction/layout.ts'
import { STANDALONE_LIGHT_BYTES } from '../../lightFunction/entries.ts'
import type { GraphSlot } from '../../lightFunction/graphSlot.ts'
import { COLOR_SAMPLE } from '../../lightFunction/renderWgsl.ts'
import { SHADOW_TEXELS } from './layout.ts'
import {
  CM_PER_M_WGSL,
  lightingCommonWgsl,
  lightingLayersWgsl,
  surfaceTexelWgsl,
} from './commonWgsl.ts'

/**
 * THE LIGHT FUNCTIONS THE ATLAS HOLDS NO SLOT OF, evaluated apart: a light that wears a light function material but holds no slot
 * of the atlas (the atlas is off, the cache is not among its readers, or a limit left the light out: the lights the cull marks,
 * `TILE_LIGHT_STANDALONE`) has its material evaluated at each texel of the tiles that keep it, by a dispatch of its own over the
 * tiles of the direct list, before the shadow masks. A workgroup is a tile, a thread a texel; a tile that does not keep the light
 * is left at once. The texel's world point is taken to the light's axes by the light's matrix and so to the material's
 * coordinate, which every texture coordinate set of the material is given: a spot's through the tangent of its outer cone to 0 to
 * 1 across it, a point's by its direction as longitude and latitude, any other light's (a sun's, a rectangle's) by the two axes
 * across the direction as they are — the coordinate is not wrapped. The material's colour there (its emission: the graph's
 * `mgEmissive`, else the colour and map of the material) is taken to its grey (its channels weighed by 0.3333), faded to the light's
 * disabled brightness over the last fifth of its fade distance by the distance from the eye, and held to 0 to 1: the share of the
 * light the texel receives. The shares are kept as half floats, two to a word, `SCRATCH_TILE_WORDS` words a light tile,
 * `scratchAt` words into the masks' buffer (`layout.ts`), where the shadow masks (`shadowMaskWgsl.ts`) and the direct light
 * (`directWgsl.ts`) read them.
 *
 * A material that reads textures finds their footprint at the points the texels beside it (along x and along y) stand at, the
 * pass having no derivatives; a texel beside that holds no surface leaves a footprint of nothing there.
 *
 * Bindings, in group 0: 0 the parameters, 1 to 5 the colour atlas of the maps (`MAP_BINDINGS`: three pools, the page table, the
 * sampler) where the material reads a texture, 6 the tables, 7 the context, 8 and 9 the depth and normal layers, 10 the lights
 * of the tiles, 11 the masks' buffer, 12 the light's block and the material's, read at a dynamic offset a light. Five storage
 * buffers with the page table: the tables, the context, the lights of the tiles, the masks' buffer and the page table.
 */

export const LIGHT_FUNCTION_PASS_BINDINGS = {
  tables: 6,
  context: 7,
  depth: 8,
  normal: 9,
  tileLights: 10,
  masks: 11,
  given: 12,
} as const

const B = LIGHT_FUNCTION_PASS_BINDINGS

export const LIGHT_FUNCTION_PASS_ENTRY = 'lightFunctionPass'

/** What a material is evaluated from: its graph compiled for the pass (`graphStandaloneOf`), or its colour, with a map when it has
 *  one. */
export interface LightFunctionPassProgram {
  readonly graph?: GraphSlot
  readonly mapped: boolean
}

/** The bytes of a plain material's block: its colour and the slot of its map. */
const PLAIN_BYTES = 16

/** Whether the program reads a texture of the colour atlas of the maps. */
export const lightFunctionPassMapped = (p: LightFunctionPassProgram) =>
  p.graph ? p.graph.textured : p.mapped

/** The bytes of the block a light and its material take in the pass's uniform. */
export const lightFunctionPassBytes = (p: LightFunctionPassProgram) =>
  STANDALONE_LIGHT_BYTES + (p.graph?.bytes ?? PLAIN_BYTES)

/** The structure of the block (the light's, then the material's) and the colour the material gives at a coordinate. */
function materialText(p: LightFunctionPassProgram) {
  if (!p.graph)
    return {
      given: `struct Given{light:LightBlock,colour:vec3f,map:u32,}`,
      colour: `fn materialColour(uv:vec2f,right:vec2f,below:vec2f)->vec3f{
 var colour=given.colour;
${p.mapped ? ' colour*=colorSample(given.map,uv,right-uv,below-uv,true).rgb;' : ''}
 return colour;
}`,
    }
  const c = p.graph.compiled
  const emission = c.functions.emissive
  const neighbours = p.graph.textured
    ? ` mgNeighbour[0]=ctx;mgNeighbour[1]=ctx;
 mgNeighbour[0].uvs=array<vec2f,8>(${Array(8).fill('right').join(',')});
 mgNeighbour[1].uvs=array<vec2f,8>(${Array(8).fill('below').join(',')});
`
    : ''
  return {
    given: `struct Given{light:LightBlock,head:vec4f,values:${c.values},}`,
    colour: `fn materialColour(uv:vec2f,right:vec2f,below:vec2f)->vec3f{
 var ctx:MgContext;
 ctx.uvs=array<vec2f,8>(${Array(8).fill('uv').join(',')});
 ctx.time=given.head.x;
 ctx.realTime=given.head.y;
${neighbours} return ${emission ? `${emission}(ctx,given.values)` : fallbackOf('emissive').code};
}`,
  }
}

/** The pass's program for a material. */
export function lightFunctionPassWgsl(p: LightFunctionPassProgram) {
  const material = materialText(p)
  const mapped = lightFunctionPassMapped(p)
  const maps = mapped
    ? `${tileDeclarations(MAP_BINDINGS, 'color')}
@group(0) @binding(${MAP_SAMPLER_BINDING}) var mapsSampler:sampler;
`
    : ''
  return wgslProgram(
    `const LF_PI:f32=3.14159265358979;
const LF_POINT:u32=${KINDS.point}u;
const LF_SPOT:u32=${KINDS.spot}u;
@group(0) @binding(${B.tileLights}) var<storage,read> tileLights:array<u32>;
@group(0) @binding(${B.masks}) var<storage,read_write> masks:array<u32>;
${maps}/** A light's block: the rows of the matrix that takes a world point to its axes, then the tangent of a spot's outer cone, the fade
 *  distance and the disabled brightness, then the light's rank and its kind's. */
struct LightBlock{toLight:array<vec4f,4>,shape:vec4f,ids:vec4u,}
${material.given}
@group(0) @binding(${B.given}) var<uniform> given:Given;
var<workgroup> shares:array<f32,${SHADOW_TEXELS}>;
/** The coordinate of the material at the point \`P\` (metres): the point in the light's axes, as the light vector with its x and z swapped
 *  so that xy lie across the light's direction. */
fn lightFunctionUv(P:vec3f)->vec2f{
 let placed=P.x*given.light.toLight[0]+P.y*given.light.toLight[1]+P.z*given.light.toLight[2]+given.light.toLight[3];
 let v=vec3f(placed.z,placed.y,placed.x)/placed.w;
 if(given.light.ids.y==LF_SPOT){return v.xy/(v.z*given.light.shape.x)*0.5+0.5;}
 if(given.light.ids.y==LF_POINT){
  let unit=normalize(v);
  return vec2f((atan2(unit.y,unit.x)+LF_PI)/(2.0*LF_PI),acos(clamp(unit.z,-1.0,1.0))/LF_PI);
 }
 return v.xy;
}
${material.colour}
/** The share of the light the texel at \`P\` receives: the grey of the material's colour, faded to the disabled brightness by the
 *  distance from the eye, held to 0 to 1. */
fn lightFunctionShare(colour:vec3f,P:vec3f)->f32{
 let fade=given.light.shape.y;
 let alpha=saturate((fade-length(lp.eye.xyz-P))/(fade*0.2));
 return saturate(mix(given.light.shape.z,dot(colour,vec3f(0.3333)),alpha));
}
@compute @workgroup_size(8,8,1)
fn ${LIGHT_FUNCTION_PASS_ENTRY}(@builtin(workgroup_id) group:vec3u,@builtin(num_workgroups) n:vec3u,@builtin(local_invocation_id) at:vec3u,@builtin(local_invocation_index) lane:u32){
 let tile=flatGroup(group,n);
 if(tile>=ctxListed(LG_LIST_DIRECT)){return;}
 let first=tile*(lp.maxLights+1u);
 let lights=tileLights[first];
 // The place of the light in the tile's list; the same for the whole workgroup, which leaves at once where the tile keeps none.
 var k=lights;
 for(var i=0u;i<lights;i++){
  let listed=tileLights[first+1u+i];
  if(tileLightStandalone(listed)&&tileLightRank(listed)==given.light.ids.x){k=i;break;}
 }
 if(k==lights){return;}
 let packed=ctxTile(LG_LIST_DIRECT,tile);
 let page=tilePage(packed);
 let origin=tileCoordOf(packed)*LG_TILE+at.xy;
 let texel=surfaceTexel(page,origin);
 var share=0.0;
 if(texel.valid){
  let P=texel.position/CM_PER_M;
  let uv=lightFunctionUv(P);
  var right=uv;
  var below=uv;
${
  mapped
    ? `  let beside=surfaceTexel(page,origin+vec2u(1u,0u));
  if(beside.valid){right=lightFunctionUv(beside.position/CM_PER_M);}
  let under=surfaceTexel(page,origin+vec2u(0u,1u));
  if(under.valid){below=lightFunctionUv(under.position/CM_PER_M);}
`
    : ''
}  let given_colour=materialColour(uv,right,below);
  share=lightFunctionShare(select(vec3f(0.0),given_colour,given_colour==given_colour),P);
 }
 shares[lane]=share;
 workgroupBarrier();
 if(lane<SCRATCH_TILE_WORDS){
  masks[scratchWordOf(tile*lp.maxLights+k,2u*lane)]=pack2x16float(vec2f(shares[2u*lane],shares[2u*lane+1u]));
 }
}`,
    [
      ...(p.graph ? [p.graph.compiled.wgsl] : mapped ? [COLOR_SAMPLE] : []),
      lightingCommonWgsl({ tables: B.tables, context: { binding: B.context, access: 'read' } }),
      surfaceTexelWgsl(lightingLayersWgsl(B.depth, B.normal)),
      CM_PER_M_WGSL,
    ],
  )
}
