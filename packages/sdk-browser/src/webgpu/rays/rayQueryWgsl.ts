import { wgslConsts } from '../../../../math/src/wgsl/consts.ts'
import { wgslProgram } from '../../../../math/src/wgsl/assemble.ts'
import { toF32 } from '../../../../math/src/wgsl/f32.ts'
import { rayInverseDirection } from '../../../../math/src/wgsl/geometry.ts'
import {
  invTranspose3Apply,
  invTranspose3Prep,
  unitOrZero,
} from '../../../../math/src/wgsl/inverseTranspose.ts'
import { FLAT_INDEX_WGSL, WORKGROUP_THREADS_WGSL } from '../../gpu/dispatch/grid.ts'
import { PLACEMENT_TREE_WALK_WGSL, placementTreeWalk } from '../../gpu/dag/treeWalkWgsl.ts'
import { HIT_CUT, HIT_FOUND, RAY_HIT, RAY_RECORD } from './rayRecord.ts'
import { RAY_PLACEMENT_WGSL } from './rayPlacementWgsl.ts'
import { rayCountWgsl } from './rayCountWgsl.ts'

/** Steps the walk of the placement tree may take: a child a step, the members of every group a ray
 *  meets — a dense field along the ray included. */
const TREE_STEPS = 1 << 16

/**
 * THE RAY QUERY (`rayQuery.ts`): one thread a ray, the nearest triangle it meets of what the
 * engine draws. Level 1 is the placement tree the cut refits (`../../gpu/dag/placementTree.ts`),
 * read in its record table as the culling reads it, walked by the engine's one walk of it
 * (`placementTreeWalk`) on its world boxes, from the ray's
 * origin rounded to single precision — a packing too small for a tree tries its placements in turn.
 * Level 2 is each placement met: its hierarchy, its pages and their triangles, in its own space
 * from the ray's exact origin (`rayPlacementWgsl.ts`). One dispatch reads every placement, each
 * table a record table whatever the world's size. The hit is written at the ray's rank: the placement, the page and the triangle met, the distance, and the
 * face normal brought to the world by the inverse transpose of the placement's world, as its
 * winding turns it — what the host turns into an intersection (`rayQueue.ts`). `counted`, the
 * audit's kernel alone (`rayAudit.ts`), counts each ray's work and dumps the tables it read.
 */
export const rayQueryWgsl = (counted: boolean) =>
  wgslProgram(
    `${wgslConsts({
      RQ_TREE_STEPS: TREE_STEPS,
      RQ_RAY_WORDS: RAY_RECORD.words,
      RQ_HIT_WORDS: RAY_HIT.words,
      RQ_FOUND: HIT_FOUND,
      RQ_CUT: HIT_CUT,
    })}
/** Ray \`k\` of the batch, as its record lies in the query's buffer (\`rayRecord.ts\`). */
fn rqRay(k:u32)->RqRay{
 let at=params.rayWord+k*RQ_RAY_WORDS;
 let d=at+${RAY_RECORD.at.direction}u;
 return RqRay(
  vec4u(query[at+${RAY_RECORD.at.eyeXY}u],query[at+${RAY_RECORD.at.eyeXY + 1}u],query[at+${RAY_RECORD.at.eyeXY + 2}u],query[at+${RAY_RECORD.at.eyeXY + 3}u]),
  vec2u(query[at+${RAY_RECORD.at.eyeZ}u],query[at+${RAY_RECORD.at.eyeZ + 1}u]),
  query[at+${RAY_RECORD.at.filterFirst}u],
  query[at+${RAY_RECORD.at.filterWord}u],
  bitcast<vec3f>(vec3u(query[d],query[d+1u],query[d+2u])),
  bitcast<f32>(query[at+${RAY_RECORD.at.reach}u]));
}
/** Ray \`k\`'s hit, written at its rank (\`rayRecord.ts\`): the nearest it met, its face normal
 *  brought to the world, unit, and whether its walk was cut short. */
fn rqAnswer(k:u32,best:RqHit){
 let at=params.hitWord+k*RQ_HIT_WORDS;
 query[at+${RAY_HIT.at.flags}u]=select(0u,RQ_FOUND,best.found)|select(0u,RQ_CUT,rqCut);
 if(!best.found){return;}
 let normal=unitOrZero(invTranspose3Apply(invTranspose3Prep(rqLinear(best.placement)),best.normal));
 query[at+${RAY_HIT.at.placement}u]=best.placement;
 query[at+${RAY_HIT.at.page}u]=best.page;
 query[at+${RAY_HIT.at.triangle}u]=best.triangle;
 query[at+${RAY_HIT.at.normal}u]=bitcast<u32>(normal.x);
 query[at+${RAY_HIT.at.normal + 1}u]=bitcast<u32>(normal.y);
 query[at+${RAY_HIT.at.normal + 2}u]=bitcast<u32>(normal.z);
 query[at+${RAY_HIT.at.distance}u]=bitcast<u32>(best.distance);
}
@compute @workgroup_size(WORKGROUP_THREADS) fn traceRays(@builtin(global_invocation_id) g:vec3u,@builtin(num_workgroups) n:vec3u){
 let k=flatIndex(g,n,WORKGROUP_THREADS);
 if(k>=params.rays){return;}
 let ray=rqRay(k);
 // The tree's boxes are world boxes in single precision, grown past its rounding: the ray meets them
 // from its origin rounded so, its distances those of the exact origin.
 let origin=vec3f(bitcast<f32>(toF32(ray.eyeXY.xy)),bitcast<f32>(toF32(ray.eyeXY.zw)),bitcast<f32>(toF32(ray.eyeZ)));
 let inverse=rayInverseDirection(ray.direction);
 rqCut=false;
 var best=RqHit(ray.reach,0u,0u,0u,vec3f(0.0),false);
 if(params.treeRoot==NO_INDEX){
  for(var w=0u;w<params.placements;w++){best=rqEnter(w,ray,best);}
 }else{
${placementTreeWalk({
  root: 'params.treeRoot',
  word: 'treeWord',
  low: 'rqTreeLow',
  high: 'rqTreeHigh',
  member: (slot) => `treeMember(${slot})`,
  enter: 'best=rqEnter(w,ray,best);',
  stop: '',
  visit: '',
  steps: 'RQ_TREE_STEPS',
  cut: 'rqCut=true;',
})}
 }
 rqFlushCounts(k,best);
 rqAnswer(k,best);
}`,
    [
      FLAT_INDEX_WGSL,
      WORKGROUP_THREADS_WGSL,
      PLACEMENT_TREE_WALK_WGSL,
      RAY_PLACEMENT_WGSL,
      toF32,
      rayInverseDirection,
      invTranspose3Prep,
      invTranspose3Apply,
      unitOrZero,
    ],
  )

/** The shipped trace: its counters empty (`rayCountWgsl.ts`). */
export const RAY_QUERY_WGSL = rayQueryWgsl(false)
