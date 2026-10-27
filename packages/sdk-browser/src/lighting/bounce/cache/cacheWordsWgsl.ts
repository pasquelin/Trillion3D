import { wgslBlock } from '../../../../../math/src/wgsl/decl.ts'
import { wgslF32 } from '../../../../../math/src/wgsl/number.ts'
import { equalAreaDecode, equalAreaEncode } from '../../../../../math/src/wgsl/octahedral.ts'
import { SCREEN_PROBE_CONSTANTS } from '../../../../../sdk-core/src/bounce/screenProbeLevels.ts'
import { wgslConsts } from '../../../../../math/src/wgsl/consts.ts'
import { POOL_ROW_PROBES } from '../atlas.ts'
import { BOUNCE_GRID_HEAD_WGSL } from '../gridWgsl.ts'
import { DITHER_WGSL } from '../../../post/taa/colorSpaceWgsl.ts'

/**
 * THE CACHE'S WORDS AND ITS COVERAGE, what the kernels that trace the radiance cache and the screen probes that read it
 * share (`cacheLayout.ts`): the word a texel of the raw atlas keeps beside its radiance (`cacheDepthWord`) — its low half the ray's end
 * as a probe's depth is kept: the distance the ray went, a half float held to `radianceCacheMaxHitDistance` and cut of its last
 * bit, which holds whether the surface it met is two-sided, the half's sign bit holding whether that surface faces the ray, all ones where
 * it met no surface; its high half the share of the ray that left the scene, in eight bits —, the number that dithers a light written
 * to an atlas (`cacheDither`), the nearest a probe's ray starts at (`cacheMinTrace`: its cell's diagonal), the level that covers a
 * point (`cacheCoverage`: the first whose fade at the edge of its cube, falling to nothing half a cell inside it, is more than a number the caller draws, with the distance to trace before the cache is
 * read, `minTrace`: that start and the cell's diagonal again), and the slot of the probe a cell holds (`cacheSlotOf`: the slot plus
 * one, zero where no probe holds the cell), and the square the frame's atlases give a probe by its rank in the queue (`cacheTempTileOf`). A kernel names the levels' uniform and the cell table (`bounceBindingsWgsl`) beside this block.
 */
export const CACHE_WORDS_WGSL = wgslBlock(
  'CACHE_WORDS_WGSL',
  [BOUNCE_GRID_HEAD_WGSL, equalAreaDecode, equalAreaEncode, DITHER_WGSL],
  `${wgslConsts({ POOL_ROW_SHIFT: Math.log2(POOL_ROW_PROBES), POOL_ROW_MASK: POOL_ROW_PROBES - 1 })}
const CACHE_MAX_HIT:f32=${wgslF32(SCREEN_PROBE_CONSTANTS.radianceCacheMaxHitDistance)};
const CACHE_SQRT3:f32=1.7320508;
fn cacheDepthWord(distance:f32,hit:bool,sky:f32,front:bool,twoSided:bool)->u32{
 let ended=(pack2x16float(vec2f(clamp(distance,0.0,CACHE_MAX_HIT),0.0))&0x7ffeu)|select(0u,0x8000u,front)|select(0u,1u,twoSided);
 return select(0xffffu,ended,hit)|(u32(round(saturate(sky)*255.0))<<16u);
}
fn cacheHitIs(word:u32)->bool{return (word&0xffffu)!=0xffffu;}
/** Whether the surface the ray met faces it; true where it met none. */
fn cacheFrontIs(word:u32)->bool{return (word&0x8000u)!=0u;}
/** Whether the surface the ray met is two-sided; true where it met none. */
fn cacheTwoSidedIs(word:u32)->bool{return (word&1u)!=0u;}
fn cacheDepthOf(word:u32)->f32{
 return select(CACHE_MAX_HIT,unpack2x16float(word&0x7ffeu).x,cacheHitIs(word));
}
fn cacheSkyOf(word:u32)->f32{return f32((word>>16u)&0xffu)/255.0;}
/** The number in [0, 1) that dithers the light written at the texel \`at\` of an atlas, by the image's turn: a hash of the two. */
fn cacheDither(at:vec2u)->f32{return frameRandom(vec2i(at),bounce.frame.z%8u).x;}
/** The first texel of the map of slot \`slot\` in an atlas of maps \`resolution\` texels a side. */
fn cacheTileOf(slot:u32,resolution:u32)->vec2u{
 return vec2u(slot&POOL_ROW_MASK,slot>>POOL_ROW_SHIFT)*resolution;
}
/** The first texel of the square of \`resolution\` texels the frame's atlases give the probe of rank \`rank\` in the queue, \`row\` probes along a row. */
fn cacheTempTileOf(rank:u32,resolution:u32,row:u32)->vec2u{
 return vec2u(rank%row,rank/row)*resolution;
}
/** Where the noise of the rays of the probe of \`cell\` at \`level\` starts: a hash of the cell and the level, never of its slot — the
 *  slots are given in the order the threads reached the stack, which differs from run to run —, so a scene casts the same rays every run. */
fn cacheNoiseOrigin(cell:vec3i,level:u32)->vec2u{
 var h=(bitcast<u32>(cell.x)*0x9e3779b1u)^(bitcast<u32>(cell.y)*0x85ebca6bu)^(bitcast<u32>(cell.z)*0xc2b2ae35u)^(level*0x27d4eb2fu);
 h=(h^(h>>15u))*0x2c1b3c6du;
 h=(h^(h>>12u))*0x297a2d39u;
 h^=h>>15u;
 return vec2u(h&0xffffu,h>>16u);
}
/** The nearest a ray of a probe of \`level\` starts at: its cell's diagonal, scaled by the cache's own scale (\`reach.y\`). */
fn cacheMinTrace(level:u32)->f32{
 return bounce.levels[level].spacing*CACHE_SQRT3*bounce.reach.y;
}
struct CacheCoverage{level:u32,valid:bool,minTrace:f32,}
/** The coverage of \`level\`: valid, a ray from its cell traced as far as the nearest a ray of its probes starts and the cell's diagonal. */
fn cacheCoverageOf(level:u32)->CacheCoverage{
 return CacheCoverage(level,true,cacheMinTrace(level)+bounce.levels[level].spacing*CACHE_SQRT3);
}
/** The level whose cube holds \`P\` half a cell inside its edge, and the distance a ray from there is traced before the cache is read. A level
 *  answers where the fade at the edge of its cube, one deep inside it and falling to nothing half a cell from the edge, is more than \`random\`
 *  (a number in [0, 1): zero takes every level the point is inside, a fixed half the levels whose fade is past a half, a noise spreads the change
 *  from a level to the next over the fade). */
fn cacheCoverage(P:vec3f,random:f32)->CacheCoverage{
 if(bounce.counts.w==0u){return CacheCoverage(0u,false,0.0);}
 for(var level=0u;level<CASCADE_LEVELS;level++){
  if(level>=bounce.counts.y){break;}
  if(levelEdgeFade(level,P)>random){return cacheCoverageOf(level);}
 }
 return CacheCoverage(0u,false,0.0);
}
/** The coverage \`bias\` levels coarser than the one that covers \`P\`, held to the coarsest: the level the cells that fill the view read and
 *  mark their probes in, so that they leave the finer levels to the surfaces. A bias of zero is \`cacheCoverage\`. */
fn cacheCoverageBiased(P:vec3f,bias:u32,random:f32)->CacheCoverage{
 let base=cacheCoverage(P,random);
 if(!base.valid||bias==0u){return base;}
 let level=min(base.level+bias,bounce.counts.y-1u);
 return cacheCoverageOf(level);
}
/** The slot plus one of the probe that holds \`cell\` of \`level\`, zero where none does (the cell has no slot). */
fn cacheSlotOf(level:u32,cell:vec3i)->u32{return tableEntry(cellEntry(level,probeWrap(cell)));}`,
)
