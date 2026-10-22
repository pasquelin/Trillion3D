import { wgslBlock } from '../../../../../math/src/wgsl/decl.ts'
import { wgslProgram } from '../../../../../math/src/wgsl/assemble.ts'
import { wgslConsts } from '../../../../../math/src/wgsl/consts.ts'
import { wgslF32 } from '../../../../../math/src/wgsl/number.ts'
import { SCREEN_PROBE_CONSTANTS } from '../../../../../sdk-core/src/bounce/screenProbeLevels.ts'
import { atlasEntry } from '../atlas.ts'
import { CACHE_PDF_WORDS } from '../cache/cacheLayout.ts'
import { CACHE_WORDS_WGSL } from '../cache/cacheWordsWgsl.ts'
import { bounceBindingsWgsl } from '../gridWgsl.ts'
import { spCommon, spParams } from './commonWgsl.ts'
import { spProbes } from './probesWgsl.ts'
import { bindingTable } from './screenProbeLayout.ts'

/** The scatter's bindings: the probes' records, the cosine lobes of the pixels each stands for, the radiance cache's importance
 *  functions, the cascades. */
export const SCATTER_BINDINGS = bindingTable({
  params: [0, 'uniform'],
  info: [1, 'float'],
  normal: [2, 'float'],
  counts: [3, 'buffer-read'],
  brdf: [4, 'buffer-read'],
  pdf: [5, 'buffer'],
  bounceGrid: [6, 'uniform'],
})
/** The atlas of the cascades' probes, which the scatter's layout adds (`atlasEntry`). */
export const SCATTER_PROBES = 7
export const scatterEntries = () => [...SCATTER_BINDINGS.entries, atlasEntry(SCATTER_PROBES)]

const B = SCATTER_BINDINGS.at

/**
 * THE SCATTER OF THE PIXELS' IMPORTANCE into the world probes that will be read for them: a workgroup a screen probe, a thread
 * of the first axis for each of the eight probes of the radiance cache round the probe's point (the level that covers it, the
 * cells beside the point, those that hold a probe), the second axis over the ten words of a probe's importance function: the nine
 * coefficients of the mean of the cosine lobes the screen probe stands for (`screenData`'s `brdf`), in fixed point, added atomically, and
 * a count of one. The cache's own update reads their mean (`cachePdfAt`, `cacheTilesWgsl.ts`) to refine its maps where the pixels
 * look; it cleared the functions of the probes it traces before this ran.
 */
const SCATTER_WGSL_BLOCK = wgslBlock(
  'SCATTER_WGSL',
  [],
  `@group(0) @binding(${B.brdf}) var<storage,read> brdfSh:array<f32>;
@group(0) @binding(${B.pdf}) var<storage,read_write> cachePdf:array<atomic<i32>>;
${wgslConsts({ SP_PDF_WORDS: CACHE_PDF_WORDS })}
const SP_PDF_SCALE:f32=${wgslF32(SCREEN_PROBE_CONSTANTS.radiancePdfScale)};
@compute @workgroup_size(8,8)
fn scatterPdf(@builtin(workgroup_id) group:vec3u,@builtin(local_invocation_id) local:vec3u){
 let probe=spProbeOrDead(group.xy);
 if(probe.depth<=0.0){return;}
 let cover=cacheCoverage(probe.P);
 if(!cover.valid){return;}
 let corner=vec3i(floor(probe.P/bounce.levels[cover.level].spacing-vec3f(0.5)));
 let cell=corner+vec3i(vec3u(local.x&1u,(local.x>>1u)&1u,(local.x>>2u)&1u));
 let slot=cacheSlotOf(cover.level,cell);
 if(slot==0u){return;}
 let index=spIndexOf(group.xy);
 for(var k=local.y;k<SP_PDF_WORDS;k+=8u){
  let value=select(1.0,brdfSh[index*9u+k]*SP_PDF_SCALE,k<9u);
  atomicAdd(&cachePdf[(slot-1u)*SP_PDF_WORDS+k],i32(value));
 }
}`,
)

/** The scatter's program over `samples` of a tile. */
export const scatterShader = (samples: readonly [number, number]) =>
  wgslProgram(spParams(B.params), [
    bounceBindingsWgsl(0, B.bounceGrid, SCATTER_PROBES),
    spCommon(samples),
    spProbes(B.info, B.normal, B.counts),
    CACHE_WORDS_WGSL,
    SCATTER_WGSL_BLOCK,
  ])
