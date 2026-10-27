import { wgslBlock } from '../../../../../math/src/wgsl/decl.ts'
import { wgslProgram } from '../../../../../math/src/wgsl/assemble.ts'
import { wgslConsts } from '../../../../../math/src/wgsl/consts.ts'
import { octWrapBorder } from '../../../../../math/src/wgsl/octahedral.ts'
import { SP_TARGET_DITHER, spCommon, spParams } from './commonWgsl.ts'
import { SP_QUANTIZE } from './gatherWgsl.ts'
import { spProbes } from './probesWgsl.ts'
import { SCREEN_PROBE_FORMATS as F, bindingTable, gatherMipSide } from './screenProbeLayout.ts'

/** The border fix-up's bindings: the probes' records, the filtered radiance read and its finest level with the border written. */
export const FIXUP_BINDINGS = bindingTable({
  params: [0, 'uniform'],
  info: [1, 'float'],
  normal: [2, 'uint'],
  counts: [3, 'buffer-read'],
  gather: [4, 'float'],
  level: [5, { store: F.radianceMip }],
})

/** A coarser level's bindings: the level before it read and the level written. */
export const MIP_BINDINGS = bindingTable({
  params: [0, 'uniform'],
  parent: [1, 'float'],
  child: [2, { store: F.radianceMip }],
})

const X = FIXUP_BINDINGS.at
const M = MIP_BINDINGS.at

/**
 * THE FINEST LEVEL OF THE FILTERED RADIANCE WITH ITS BORDER (`fixup`, `screenProbeGatherNumMips` above one): each texel of a probe's square of
 * `gatherMipSide(gather, mips, 0)` texels, the border of `2 ** (mips - 1)` texels included, holds the filtered radiance of the texel its wrap names
 * (`octWrapBorder`: a border texel is its mirror inside the octahedron), quantized as the 11-11-10 target of the reference is, dithered by a hash of the texel and
 * the frame; a probe on no lit surface holds zero. A thread a texel.
 */
const SP_FIXUP = wgslBlock(
  'SP_FIXUP',
  [octWrapBorder, SP_QUANTIZE, SP_TARGET_DITHER],
  `@group(0) @binding(${X.gather}) var gatherIn:texture_2d<f32>;
@group(0) @binding(${X.level}) var levelOut:texture_storage_2d<${F.radianceMip},write>;
@compute @workgroup_size(8,8)
fn fixup(@builtin(global_invocation_id) id:vec3u){
 let atlas=id.xy/SP_MIP_SIDE;
 if(atlas.x>=sp.grid.x||atlas.y>=sp.grid.z){return;}
 var radiance=vec3f(0.0);
 if(spProbeOrDead(atlas).depth>0.0){
  let wrapped=octWrapBorder(id.xy%SP_MIP_SIDE,SP_MIP_SIDE,SP_MIP_BORDER);
  radiance=textureLoad(gatherIn,vec2i(atlas*SP_GATHER+wrapped),0).rgb;
 }
 textureStore(levelOut,vec2i(id.xy),vec4f(spQuantize(radiance,spTargetDither(id.xy,0)),0.0));
}`,
)

/**
 * A COARSER LEVEL OF THE FILTERED RADIANCE (`mip`, the level `SP_MIP_LEVEL`): each texel is the mean of the two by two texels of the level before that lie under
 * it (a load each, no filtering), quantized as the 11-11-10 target of the reference is, dithered by a hash of the texel, the frame and the level plus thirteen. A thread
 * a texel of the level.
 */
const SP_MIP = wgslBlock(
  'SP_MIP',
  [SP_QUANTIZE, SP_TARGET_DITHER],
  `@group(0) @binding(${M.parent}) var parentIn:texture_2d<f32>;
@group(0) @binding(${M.child}) var childOut:texture_storage_2d<${F.radianceMip},write>;
@compute @workgroup_size(8,8)
fn mip(@builtin(global_invocation_id) id:vec3u){
 let atlas=id.xy/SP_MIP_CHILD;
 if(atlas.x>=sp.grid.x||atlas.y>=sp.grid.z){return;}
 let parent=SP_MIP_PARENT*atlas+(id.xy%SP_MIP_CHILD)*2u;
 var sum=vec3f(0.0);
 for(var k=0u;k<4u;k++){sum+=textureLoad(parentIn,vec2i(parent+vec2u(k&1u,k>>1u)),0).rgb;}
 let dither=spTargetDither(id.xy,i32(SP_MIP_LEVEL)+13);
 textureStore(childOut,vec2i(id.xy),vec4f(spQuantize(sum/4.0,dither),0.0));
}`,
)

/** The border fix-up's program over a gather of `gather` texels a side holding `mips` levels, and `samples` of a tile. */
export const fixupShader = (gather: number, mips: number, samples: readonly [number, number]) =>
  wgslProgram(
    `${spParams(X.params)}
${wgslConsts({
  SP_GATHER: gather,
  SP_MIP_SIDE: gatherMipSide(gather, mips, 0),
  SP_MIP_BORDER: 2 ** (mips - 1),
})}`,
    [spCommon(samples), spProbes(X.info, X.normal, X.counts), SP_FIXUP],
  )

/** The program of the level `level` of a gather of `gather` texels a side holding `mips` levels, and `samples` of a tile. */
export const mipShader = (
  gather: number,
  mips: number,
  level: number,
  samples: readonly [number, number],
) =>
  wgslProgram(
    `${spParams(M.params)}
${wgslConsts({
  SP_MIP_LEVEL: level,
  SP_MIP_PARENT: gatherMipSide(gather, mips, level - 1),
  SP_MIP_CHILD: gatherMipSide(gather, mips, level),
})}`,
    [spCommon(samples), SP_MIP],
  )
