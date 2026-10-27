import { wgslConsts } from '../../../../math/src/wgsl/consts.ts'
import { wgslProgram } from '../../../../math/src/wgsl/assemble.ts'
import { inverseTranspose3, unitOrZero } from '../../../../math/src/wgsl/inverseTranspose.ts'
import { FLAT_INDEX_WGSL, WORKGROUP_THREADS_WGSL } from '../../gpu/dispatch/grid.ts'
import {
  PLACEMENT_TREE_WALK_WGSL,
  placementTreeCast,
  TREE_STEPS,
} from '../../geometry/dag/tree/treeWalkWgsl.ts'
import { HIT_CUT, HIT_FOUND, RAY_HIT, RAY_RECORD } from './rayRecord.ts'
import { RAY_PLACEMENT_WGSL } from './rayPlacementWgsl.ts'

/**
 * THE RAY QUERY (`rayQuery.ts`): one thread a ray, the nearest triangle it meets of what the engine
 * draws. Level 1 is the placement tree the cut refits (`../../geometry/dag/placement/placementTree.ts`), read in
 * its record table as the culling reads it, walked by the engine's one walk of it
 * (`placementTreeCast`) on its world boxes, grown by how near a line the ray meets it, from the
 * ray's origin rounded to single precision — a packing too small for a tree tries its placements in
 * turn. Level 2 is each placement met: its hierarchy, its pages and their triangles, in its own
 * space from the ray's exact origin (`rayPlacementWgsl.ts`). One dispatch reads every placement,
 * each table a record table whatever the world's size. The hit is written at the ray's rank: the
 * placement, the page and the triangle met, the distance, and the face normal brought to the world
 * by the inverse transpose of the placement's world, as its winding turns it — what the host turns
 * into an intersection (`rayQueue.ts`).
 */
export const RAY_QUERY_WGSL = wgslProgram(
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
  bitcast<f32>(query[at+${RAY_RECORD.at.reach}u]),
  bitcast<f32>(query[at+${RAY_RECORD.at.lineReach}u]));
}
/** Ray \`k\`'s hit, written at its rank (\`rayRecord.ts\`): the nearest it met, its face normal
 *  brought to the world, unit, and whether its walk was cut short. */
fn rqAnswer(k:u32,best:RqHit){
 let at=params.hitWord+k*RQ_HIT_WORDS;
 query[at+${RAY_HIT.at.flags}u]=select(0u,RQ_FOUND,best.found)|select(0u,RQ_CUT,rqCut);
 if(!best.found){return;}
 let normal=unitOrZero(inverseTranspose3(worldsLinear(best.placement),best.normal));
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
 rqCut=false;
 var best=RqHit(ray.reach,0u,0u,0u,vec3f(0.0),false);
${placementTreeCast({
  eyeXY: 'ray.eyeXY',
  eyeZ: 'ray.eyeZ',
  direction: 'ray.direction',
  placements: 'params.placements',
  root: 'params.treeRoot',
  table: 'tree',
  enter: 'best=rqEnter(w,ray,best);',
  stop: '',
  visit: '',
  steps: 'RQ_TREE_STEPS',
  cut: 'rqCut=true;',
  grow: 'ray.lineReach',
})}
 rqAnswer(k,best);
}`,
  [
    FLAT_INDEX_WGSL,
    WORKGROUP_THREADS_WGSL,
    PLACEMENT_TREE_WALK_WGSL,
    RAY_PLACEMENT_WGSL,
    inverseTranspose3,
    unitOrZero,
  ],
)
