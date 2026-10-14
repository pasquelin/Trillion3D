import { wgslBlock, wgslFn } from '../../../../math/src/wgsl/decl.ts'
import { wgslConsts } from '../../../../math/src/wgsl/consts.ts'
import { NO_INDEX } from '../../../../math/src/wgsl/constants.ts'
import { rayBoxEntry, rayInverseDirection } from '../../../../math/src/wgsl/geometry.ts'
import { WIDE_TRAVERSAL_WGSL } from '../../bounce/traceWgsl.ts'
import { DAG_READ_TABLES_WGSL } from '../../gpu/dag/shader/bindings.ts'
import { FLAT_INDEX_WGSL, WORKGROUP_THREADS_WGSL } from '../../gpu/dispatch/grid.ts'
import { RAY_PAGE_WGSL } from './rayPageWgsl.ts'
import { rayQueryBindingsWgsl } from './deformIndexWgsl.ts'

/** A ray's counters in the audit's buffer (`rayAudit.ts`): placements entered, placements passed by
 *  (filtered, the world DAG's, rootless or singular), root boxes the ray misses, nodes visited,
 *  pages tested, pages a record holds back (not drawable, or without area), triangles tested, then
 *  the best distance's bits. */
export const RAY_COUNTERS = [
  'entered',
  'passedBy',
  'rootMissed',
  'nodes',
  'pages',
  'heldBack',
  'triangles',
] as const
export const RAY_COUNT_WORDS = RAY_COUNTERS.length + 1
/** A placement's words in the audit's dump, after the rays' counters: its frame row, its root
 *  node, its world's matrix, its exact translation's texels, then the tree's top's child count. */
export const RAY_DUMP_WORDS = 8 + 24 + 16 + 8 + 1

/** What the counted kernel adds (`dumpTables`): one thread a placement, each writing what the trace
 *  reads of it where the culling reads it. */
const DUMP_WGSL = `${wgslConsts({ RQ_DUMP_WORDS: RAY_DUMP_WORDS, RQ_COUNT_WORDS: RAY_COUNT_WORDS })}
@compute @workgroup_size(WORKGROUP_THREADS) fn dumpTables(@builtin(global_invocation_id) g:vec3u,@builtin(num_workgroups) n:vec3u){
 let w=flatIndex(g,n,WORKGROUP_THREADS);
 if(w>=params.placements){return;}
 let at=params.rays*RQ_COUNT_WORDS+w*RQ_DUMP_WORDS;
 for(var k=0u;k<8u;k++){rqCounts[at+k]=framesWord(w,k);}
 let root=framesWord(w,1u);
 for(var k=0u;k<24u;k++){rqCounts[at+8u+k]=select(0u,nodesWord(root,k),root!=NO_INDEX);}
 for(var c=0u;c<4u;c++){let v=worldsMatrix(w,c);for(var k=0u;k<4u;k++){rqCounts[at+32u+c*4u+k]=v[k];}}
 for(var c=0u;c<2u;c++){let v=worldsOrigin(w,c);for(var k=0u;k<4u;k++){rqCounts[at+48u+c*4u+k]=v[k];}}
 rqCounts[at+56u]=treeWord(0u,15u);
}`

/** The counters' store, the audit's alone: each ray's counts while it runs, and the buffer they
 *  are written to with the tables' dump (`dumpTables`). */
const COUNTS_WGSL = wgslBlock(
  'RAY_COUNTS_WGSL',
  [
    DAG_READ_TABLES_WGSL,
    rayQueryBindingsWgsl(1, false),
    NO_INDEX,
    FLAT_INDEX_WGSL,
    WORKGROUP_THREADS_WGSL,
  ],
  `var<private> rqCounted:array<u32,${RAY_COUNTERS.length}>;
@group(1) @binding(4) var<storage,read_write> rqCounts:array<u32>;
${DUMP_WGSL}`,
)

/** Counter \`i\` of the ray, one more. */
const countFn = (counted: boolean) =>
  wgslFn(
    'rqCount',
    counted ? [COUNTS_WGSL] : [],
    `fn rqCount(i:u32){${counted ? 'rqCounted[i]+=1u;' : ''}}`,
  )

/** The placement's root box missed by the ray in its own space: counted. */
const countRootFn = (counted: boolean) =>
  wgslFn(
    'rqCountRoot',
    counted
      ? [WIDE_TRAVERSAL_WGSL, countFn(true), rayBoxEntry, rayInverseDirection]
      : [WIDE_TRAVERSAL_WGSL],
    `fn rqCountRoot(box:Box,o:vec3f,d:vec3f,limit:f32){${
      counted
        ? 'if(rayBoxEntry(box.low,box.high,o,rayInverseDirection(d),limit)>limit){rqCount(2u);}'
        : ''
    }}`,
  )

/** The ray's counts and its best distance, written at its rank. */
const flushFn = (counted: boolean) =>
  wgslFn(
    'rqFlushCounts',
    counted ? [RAY_PAGE_WGSL, COUNTS_WGSL] : [RAY_PAGE_WGSL],
    `fn rqFlushCounts(k:u32,best:RqHit){${
      counted
        ? `for(var i=0u;i<${RAY_COUNTERS.length}u;i++){rqCounts[k*${RAY_COUNT_WORDS}u+i]=rqCounted[i];}
 rqCounts[k*${RAY_COUNT_WORDS}u+${RAY_COUNTERS.length}u]=bitcast<u32>(best.distance);`
        : ''
    }}`,
  )

/**
 * The trace's counter hooks (\`rqCount\`, \`rqCountRoot\`, \`rqFlushCounts\`), declarations its
 * program lists: empty in the shipped kernel, which the compiler drops; counted and written per
 * ray, with the tables' dump, in the audit's kernel alone (\`rayAudit.ts\`), never in a frame.
 */
export const rayCountWgsl = (counted: boolean) => [
  countFn(counted),
  countRootFn(counted),
  flushFn(counted),
]
