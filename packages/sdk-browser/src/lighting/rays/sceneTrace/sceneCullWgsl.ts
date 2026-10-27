import { wgslConsts } from '../../../../../math/src/wgsl/consts.ts'
import { wgslProgram } from '../../../../../math/src/wgsl/assemble.ts'
import { NO_INDEX } from '../../../../../math/src/wgsl/constants.ts'
import { transformHalfExtent } from '../../../../../math/src/wgsl/geometry.ts'
import { computeBufferEntry, computeUniformEntry } from '../../../gpu/core/computeBindings.ts'
import { FLAT_INDEX_WGSL, WORKGROUP_THREADS_WGSL } from '../../../gpu/dispatch/grid.ts'
import { markReachWgsl, reachUnboundedWgsl } from '../../../deformation/halfFloat.ts'
import {
  DRAW_SPHERE_RADIUS_WGSL,
  OUTSIDE_DRAW_DISTANCES_WGSL,
} from '../../../geometry/dag/shader/drawDistanceWgsl.ts'
import {
  DRAW_DISTANCE_MARK,
  DRAW_FAR_WORD,
  DRAW_INSTANCE_MARK,
  DRAW_NEAR_WORD,
  MARK_WORD,
  ROOT_WORD,
} from '../../../geometry/dag/frameTable.ts'
import { DAG_READ_TABLES_WGSL } from '../../../geometry/dag/shader/bindings.ts'
import { worldAtEyeWgsl } from '../../../geometry/dag/shader/worldPoseWgsl.ts'
import { sceneTraceParamsWgsl } from './sceneTraceWgsl.ts'

/** The culling modes (`rayTracingCulling`): none, the objects behind the camera by distance and solid angle, all objects
 *  by distance and solid angle, all objects by distance or solid angle. */
export const SCENE_CULL_MODE = {
  disabled: 0,
  behindCameraByDistanceAndSolidAngle: 1,
  distanceAndSolidAngle: 2,
  distanceOrSolidAngle: 3,
} as const

/** The bits of the parameters' `cullFlags`: the distance to an object taken to its box rather than its sphere
 *  (`rayTracingCullingUseDistanceToBox`), the least draw distance of a primitive tested
 *  (`rayTracingCullingUseMinDrawDistance`), and the draw distances of the instances of an instanced mesh tested, as the
 *  cut tests them while the host's switch is on (`cutDrawDistanceCulling`). */
export const SCENE_CULL_FLAGS = {
  distanceToBox: 1,
  minDrawDistance: 2,
  instanceDrawDistance: 4,
} as const

/** The pass's own group: the scene trace's parameters, and the table whose words at `stParams.cullWord` it writes. */
const SCENE_CULL_GROUP = 1
export const SCENE_CULL_BINDING = { params: 0, culled: 1 } as const

/** The layout entries of the pass's own group (`SCENE_CULL_GROUP`); the cut's tables are group 0 (`dagReadLayoutEntries`). */
export const sceneCullLayoutEntries = (): GPUBindGroupLayoutEntry[] => [
  computeUniformEntry(SCENE_CULL_BINDING.params),
  computeBufferEntry(SCENE_CULL_BINDING.culled, 'storage'),
]

/** The entry point of the pass. */
export const SCENE_CULL_ENTRY = 'cullPlacements'

/**
 * THE SCENE TRACE'S CULLING OF THE PLACEMENTS, one thread a placement, once an image: the placements the rays can meet
 * are chosen on the GPU for the image, as the instances of a ray tracing scene are, so that no ray tests it. A placement
 * is left out (a nonzero word at `stParams.cullWord` + its rank in the table, which `stEnter` reads) when it is culled,
 * in this order:
 *  - as a primitive (`scCullBounds`, the test of a primitive's bounds): its bounds are the box of its root, grown by the
 *    deformation's reach, carried to the world — the box's centre and half extents, its sphere the box's half diagonal at
 *    the world's greatest axis scale, held to the half diagonal of the box the world makes of it;
 *  - as an instance (`scCullInstance`, the test of the instance buffer's build): the sphere of the box's half diagonal at
 *    the world's scale along each axis, by the modes 2 and 3 alone; and, where it is still seen, an instance of an
 *    instanced mesh that names its draw distances outside them from its centre, both scaled by the view's
 *    `viewDistanceScale`, as the cut tests them (`outsideDrawDistance`): a far distance of 0 names no end, and the switch
 *    \`SCENE_CULL_FLAGS.instanceDrawDistance\` off tests none.
 * A mode 0 culls nothing, a mode 1 only what lies behind the camera by the first test, a mode 2 what is both far and small
 * and a mode 3 what is far or small (`SCENE_CULL_MODE`). An object is far when its distance to the eye (to its box, or to
 * its sphere, by `SCENE_CULL_FLAGS.distanceToBox`) exceeds `cullRadius`, and small when the square of its sphere's radius
 * over the square of the distance to its centre is under `culledTanAngleSq`. A placement of unbounded reach, parked
 * or without a record is culled by neither: its bounds are not known.
 *
 * The eye is the origin of the placements' worlds (`worldsWorldAtEye`); the view's direction is `stParams.viewDirection`.
 */
export const SCENE_CULL_WGSL = wgslProgram(
  `${wgslConsts({
    SC_ROOT_WORD: ROOT_WORD,
    SC_MARK_WORD: MARK_WORD,
    SC_NEAR_WORD: DRAW_NEAR_WORD,
    SC_FAR_WORD: DRAW_FAR_WORD,
    SC_DRAW_DISTANCE: DRAW_DISTANCE_MARK,
    SC_DRAW_INSTANCE: DRAW_INSTANCE_MARK,
    SC_BOX_DISTANCE: SCENE_CULL_FLAGS.distanceToBox,
    SC_MIN_DRAW: SCENE_CULL_FLAGS.minDrawDistance,
    SC_INSTANCE_DRAW: SCENE_CULL_FLAGS.instanceDrawDistance,
    SC_MODE_DISABLED: SCENE_CULL_MODE.disabled,
    SC_MODE_DISTANCE_AND_ANGLE: SCENE_CULL_MODE.distanceAndSolidAngle,
    SC_MODE_DISTANCE_OR_ANGLE: SCENE_CULL_MODE.distanceOrSolidAngle,
  })}
@group(${SCENE_CULL_GROUP}) @binding(${SCENE_CULL_BINDING.culled}) var<storage,read_write> stCulled:array<u32>;
/** The squared distance from the eye, the origin, to the box of centre \`centre\` and half extents \`extent\`. */
fn scBoxDistanceSq(centre:vec3f,extent:vec3f)->f32{
 let gap=max(abs(centre)-extent,vec3f(0.0));
 return dot(gap,gap);
}
/** Whether a primitive of bounds \`centre\`, \`extent\` (the box) and \`radius\` (the sphere), its least draw distance
 *  \`minDrawDistance\`, is culled by the mode of \`stParams\`: always so when it is nearer than that distance (where the
 *  switch is on), far (mode 3) or far and small (modes 1 and 2), small (mode 3). A mode 1 considers the objects behind
 *  the camera, or nearer than their least draw distance, alone. */
fn scCullBounds(centre:vec3f,extent:vec3f,radius:f32,minDrawDistance:f32)->bool{
 let mode=stParams.cullMode;
 if(mode==SC_MODE_DISABLED){return false;}
 let lengthSq=dot(centre,centre);
 let minDraw=(stParams.cullFlags&SC_MIN_DRAW)!=0u;
 let nearEnough=lengthSq<minDrawDistance*minDrawDistance;
 if(mode<SC_MODE_DISTANCE_AND_ANGLE&&!(dot(stParams.viewDirection,centre)< -radius||(minDraw&&nearEnough))){return false;}
 let distanceToSphere=max(sqrt(lengthSq)-radius,0.0);
 let distanceSq=select(distanceToSphere*distanceToSphere,scBoxDistanceSq(centre,extent),(stParams.cullFlags&SC_BOX_DISTANCE)!=0u);
 let farEnough=distanceSq>stParams.cullRadius*stParams.cullRadius;
 let small=radius*radius/lengthSq<stParams.culledTanAngleSq;
 let orMode=mode==SC_MODE_DISTANCE_OR_ANGLE;
 if(minDraw&&nearEnough){return true;}
 if(orMode&&farEnough){return true;}
 if(orMode&&small){return true;}
 return farEnough&&small;
}
/** Whether an instance of world \`world\`, its box of centre \`centre\` and half extents \`extent\` in the world, \`half\`
 *  in its own space, is culled: by the modes 2 (far and small) and 3 (far or small) alone, the sphere of the box's half
 *  diagonal at the world's scale along each axis; seen so, outside the draw distances \`drawDistances\` (nearest, farthest,
 *  0 for none) from its centre. */
fn scCullInstance(world:mat4x4f,centre:vec3f,half:vec3f,extent:vec3f,drawDistances:vec2f)->bool{
 let mode=stParams.cullMode;
 if(mode<SC_MODE_DISTANCE_AND_ANGLE){return false;}
 let radius=length(half*vec3f(length(world[0].xyz),length(world[1].xyz),length(world[2].xyz)));
 let lengthSq=dot(centre,centre);
 let distance=sqrt(lengthSq);
 let distanceToSphere=max(distance-radius,0.0);
 let distanceSq=select(distanceToSphere*distanceToSphere,scBoxDistanceSq(centre,extent),(stParams.cullFlags&SC_BOX_DISTANCE)!=0u);
 let visibleDistance=distanceSq<=stParams.cullRadius*stParams.cullRadius;
 let visibleAngle=radius*radius/lengthSq>=stParams.culledTanAngleSq;
 let visible=select(visibleDistance||visibleAngle,visibleDistance&&visibleAngle,mode==SC_MODE_DISTANCE_OR_ANGLE);
 return !visible||outsideDrawDistances(distance,0.0,drawDistances.x,drawDistances.y,stParams.viewDistanceScale);
}
/** Whether placement \`w\` is left out of the image: as a primitive, then as an instance. */
fn scCulled(w:u32)->bool{
 let root=framesWord(w,SC_ROOT_WORD);
 if(root==NO_INDEX){return false;}
 let mark=framesWord(w,SC_MARK_WORD);
 if(reachUnbounded(mark)){return false;}
 let world=worldsWorldAtEye(w,stParams.eyeXY,stEyeZ());
 let reach=vec3f(markReach(mark));
 let low=nodesLow(root)-reach;
 let high=nodesHigh(root)+reach;
 let half=(high-low)*0.5;
 let centre=(world*vec4f((low+high)*0.5,1.0)).xyz;
 let extent=transformHalfExtent(world,half);
 // The draw distances a placement names: the least of a primitive's, both of an instance of an instanced mesh's.
 // A placement that names none reads no word of them.
 let instance=(mark&SC_DRAW_INSTANCE)!=0u;
 var near=0.0;
 var drawDistances=vec2f(0.0);
 if((mark&SC_DRAW_DISTANCE)!=0u){
  if(!instance){near=bitcast<f32>(framesWord(w,SC_NEAR_WORD));}
  else if((stParams.cullFlags&SC_INSTANCE_DRAW)!=0u){drawDistances=vec2f(bitcast<f32>(framesWord(w,SC_NEAR_WORD)),bitcast<f32>(framesWord(w,SC_FAR_WORD)));}
 }
 return scCullBounds(centre,extent,drawSphereRadius(world,half),near)||scCullInstance(world,centre,half,extent,drawDistances);
}
@compute @workgroup_size(WORKGROUP_THREADS) fn ${SCENE_CULL_ENTRY}(@builtin(global_invocation_id) g:vec3u,@builtin(num_workgroups) n:vec3u){
 let w=flatIndex(g,n,WORKGROUP_THREADS);
 if(w>=stParams.placements){return;}
 stCulled[stParams.cullWord+w]=select(0u,1u,scCulled(w));
}`,
  [
    sceneTraceParamsWgsl(SCENE_CULL_GROUP, SCENE_CULL_BINDING.params),
    DAG_READ_TABLES_WGSL,
    worldAtEyeWgsl('worlds'),
    FLAT_INDEX_WGSL,
    WORKGROUP_THREADS_WGSL,
    transformHalfExtent,
    markReachWgsl,
    reachUnboundedWgsl,
    DRAW_SPHERE_RADIUS_WGSL,
    OUTSIDE_DRAW_DISTANCES_WGSL,
    NO_INDEX,
  ],
)
