import { wgslBlock } from '../../../../../math/src/wgsl/decl.ts'
import { wgslF32 } from '../../../../../math/src/wgsl/number.ts'
import { equalAreaDecode, equalAreaEncode } from '../../../../../math/src/wgsl/octahedral.ts'
import { SCREEN_PROBE_CONSTANTS } from '../../../../../sdk-core/src/bounce/screenProbeLevels.ts'
import { wgslConsts } from '../../../../../math/src/wgsl/consts.ts'
import { POOL_ROW_PROBES } from '../atlas.ts'
import { BOUNCE_GRID_HEAD_WGSL } from '../gridWgsl.ts'
import { CACHE_TAG_WORDS } from './cacheLayout.ts'

/**
 * THE CACHE'S WORDS AND ITS COVERAGE, what the kernels that trace the radiance cache and the screen probes that read it
 * share (`cacheLayout.ts`): the word a texel of the raw atlas keeps beside its radiance — the distance the ray went, a half float
 * held to its largest (`radianceMaxHitDistance`), the share of the ray that left the scene in eight bits and, the sign bit, up
 * where it met no surface (`cacheDepthWord`) —,
 * the nearest a probe's ray starts at (`cacheMinTrace`: its cell's diagonal), the level that covers a point (`cacheCoverage`: the
 * first whose cube holds it half a cell inside its edge, with the distance to trace before the cache is read, `minTrace`:
 * that start and the cell's diagonal again), and the slot of the probe a cell holds (`cacheSlotOf`: the slot plus one, zero
 * where no probe holds the cell). A kernel names the levels' uniform and the cell table (`bounceBindingsWgsl`) beside this block.
 */
export const CACHE_WORDS_WGSL = wgslBlock(
  'CACHE_WORDS_WGSL',
  [BOUNCE_GRID_HEAD_WGSL, equalAreaDecode, equalAreaEncode],
  `${wgslConsts({ POOL_ROW_SHIFT: Math.log2(POOL_ROW_PROBES), POOL_ROW_MASK: POOL_ROW_PROBES - 1 })}
const CACHE_MAX_HIT:f32=${wgslF32(SCREEN_PROBE_CONSTANTS.radianceMaxHitDistance)};
const CACHE_MIN_TRACE_SCALE:f32=${wgslF32(SCREEN_PROBE_CONSTANTS.radianceProbeMinTraceScale)};
const CACHE_INV_FADE:f32=${wgslF32(SCREEN_PROBE_CONSTANTS.radianceInvLevelFadeSize)};
const CACHE_SQRT3:f32=1.7320508;
fn cacheDepthWord(distance:f32,hit:bool,sky:f32)->u32{
 return (pack2x16float(vec2f(clamp(distance,0.0,CACHE_MAX_HIT),0.0))&0xffffu)|(u32(round(saturate(sky)*255.0))<<16u)|select(0x80000000u,0u,hit);
}
fn cacheHitIs(word:u32)->bool{return (word&0x80000000u)==0u;}
fn cacheDepthOf(word:u32)->f32{
 return select(CACHE_MAX_HIT,unpack2x16float(word&0xffffu).x,cacheHitIs(word));
}
fn cacheSkyOf(word:u32)->f32{return f32((word>>16u)&0xffu)/255.0;}
/** The first texel of the map of slot \`slot\` in an atlas of maps \`resolution\` texels a side. */
fn cacheTileOf(slot:u32,resolution:u32)->vec2u{
 return vec2u(slot&POOL_ROW_MASK,slot>>POOL_ROW_SHIFT)*resolution;
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
/** The nearest a ray of a probe of \`level\` starts at: its cell's diagonal. */
fn cacheMinTrace(level:u32)->f32{
 return bounce.levels[level].spacing*CACHE_SQRT3*CACHE_MIN_TRACE_SCALE;
}
struct CacheCoverage{level:u32,valid:bool,minTrace:f32,}
/** The coverage of \`level\`: valid, a ray from its cell traced as far as the nearest a ray of its probes starts and the cell's diagonal. */
fn cacheCoverageOf(level:u32)->CacheCoverage{
 return CacheCoverage(level,true,cacheMinTrace(level)+bounce.levels[level].spacing*CACHE_SQRT3);
}
/** The level whose cube holds \`P\` half a cell inside its edge, and the distance a ray from there is traced before the cache is read. */
fn cacheCoverage(P:vec3f)->CacheCoverage{
 if(bounce.counts.w==0u){return CacheCoverage(0u,false,0.0);}
 let side=f32(bounce.counts.x);
 for(var level=0u;level<CASCADE_LEVELS;level++){
  if(level>=bounce.counts.y){break;}
  let spacing=bounce.levels[level].spacing;
  let coord=P/spacing-bounce.levels[level].base;
  let bottom=saturate((coord-vec3f(0.5))*CACHE_INV_FADE);
  let top=saturate((vec3f(side-0.5)-coord)*CACHE_INV_FADE);
  let fade=min(min(bottom.x,min(bottom.y,bottom.z)),min(top.x,min(top.y,top.z)));
  if(fade>0.0){return cacheCoverageOf(level);}
 }
 return CacheCoverage(0u,false,0.0);
}
/** The coverage \`bias\` levels coarser than the one that covers \`P\`, held to the coarsest: the level the cells that fill the view read and
 *  mark their probes in, so that they leave the finer levels to the surfaces. A bias of zero is \`cacheCoverage\`. */
fn cacheCoverageBiased(P:vec3f,bias:u32)->CacheCoverage{
 let base=cacheCoverage(P);
 if(!base.valid||bias==0u){return base;}
 let level=min(base.level+bias,bounce.counts.y-1u);
 return cacheCoverageOf(level);
}
/** The slot plus one of the probe that holds \`cell\` of \`level\`, zero where none does (the cell has no slot). */
fn cacheSlotOf(level:u32,cell:vec3i)->u32{return tableEntry(cellEntry(level,probeWrap(cell)));}`,
)

/**
 * THE TAGS of the maps, at `binding` of group 0: which cell of which level a slot's final map was made for. `cacheTagOk` says whether
 * the map of the probe in slot `slot` (plus one) is the one for `cell` of `level`; a kernel that makes the maps writes the tags
 * (`write`: the buffer is read and written, else read alone).
 */
export const cacheTagsWgsl = (binding: number, write: boolean) =>
  wgslBlock(
    `cacheTagsWgsl(${binding}, ${write})`,
    [],
    `const CACHE_TAG_WORDS:u32=${CACHE_TAG_WORDS}u;
@group(0) @binding(${binding}) var<storage,${write ? 'read_write' : 'read'}> cacheTags:array<u32>;
fn cacheTagOk(slot:u32,cell:vec3i,level:u32)->bool{
 let at=(slot-1u)*CACHE_TAG_WORDS;
 let tagged=vec3u(cacheTags[at],cacheTags[at+1u],cacheTags[at+2u]);
 return all(tagged==bitcast<vec3u>(cell))&&cacheTags[at+3u]==level+1u;
}`,
  )
