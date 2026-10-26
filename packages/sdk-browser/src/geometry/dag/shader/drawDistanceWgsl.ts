import { wgslBlock, wgslFn } from '../../../../../math/src/wgsl/decl.ts'
import {
  DRAW_DISTANCE_MARK,
  DRAW_FAR_WORD,
  DRAW_INSTANCE_MARK,
  DRAW_NEAR_WORD,
} from '../frameTable.ts'
import { TREE_DRAW_FAR, TREE_DRAW_NEAR } from '../nodeLayout.ts'

/**
 * THE DRAW DISTANCE: an object that names the distances it is drawn at (`DagRoot.drawDistance`,
 * `DrawDistanceSettings` in `../../../../../sdk-core/src/contracts/objectOptions.ts`) is drawn
 * nowhere else, by every pass that decides what a view shows of it — the camera's cut, the sun's
 * casters, the rays' scene.
 *
 * `outsideDrawDistances` is the one arithmetic: the distance from the main view's eye to the centre
 * of the object's bounds, and the radius of the bounds' sphere about it. The object is out when its
 * nearest point is farther than the farthest distance (`far` above 0) or its farthest point nearer
 * than the nearest (`near` above 0), both distances multiplied by the view's scale first. A radius
 * of 0 tests the centre.
 *
 * Two kinds of object name a distance, and two scales multiply it. One instance of an instanced mesh
 * (`DRAW_INSTANCE_MARK`) is tested at its bounds' centre, by `cutViewDistanceScale`
 * (`viewDistanceScale`), and only while the host's switch is on (`cutDrawDistanceCulling`,
 * `CULL_DRAW_DISTANCE_OFF`). An object of its own is tested at the sphere of its bounds, by the
 * same scale times the field of view's (`primitiveDistanceScale`), whatever that switch says:
 * `drawSphereRadius` is the root box's half diagonal at the placement's scale, held to the
 * half diagonal of the box the pose makes of it, as a box's sphere is when it is transformed (an
 * uneven scale makes the first the larger). The sphere is dropped where the host turned its edge off
 * (`CULL_SPHERE_EDGE_OFF`, `cutDistanceCullToSphereEdge`).
 *
 * The camera's cut tests a placement first, before any other test of its root (`levelWgsl.ts`,
 * `testRoot`), by its mark word's bit (`DRAW_DISTANCE_MARK`) before it reads a distance word: a
 * placement that names none costs no load. A packing no placement of which names a distance says so
 * (`CULL_NO_DRAW_DISTANCES`, `../uniforms.ts`). The sun's casters are tested at the centre
 * (`vsmRenderOutsideDrawDistance`).
 *
 * A group of the placement tree, up to `TREE_SPAN` placements, holds the nearest and the farthest
 * distance of its placements, fitted with its box (`../tree/treeRefitWgsl.ts`; `TREE_DRAW_NEAR`,
 * `TREE_DRAW_FAR`), both 0 when one placement is drawn at every distance or names no farthest. It
 * is tested before its box is (`placementTreeWgsl.ts`, `testCell`) and conservatively: its box's
 * centre, nearer or farther by twice the box's half diagonal — the half diagonal for a point of
 * the box and again for the sphere of a placement about it, which the clamp of `drawSphereRadius`
 * keeps within the half diagonal of its own box —, must lie out of the distances for the group to
 * be culled, the nearest taken at the smaller of the two scales and the farthest at the larger.
 * Distances with nothing between them name no draw distance for a group: its placements' own tests
 * still cull. A group is never culled while the instances' switch is off: some of its placements
 * may be instances. A cell above the groups holds none (no refit writes its words), so it is never
 * culled by distance; a cut in one pass (`OCCLUSION_TWO_PASS` off) tests its placements alone. The
 * post pass tests none again: what it holds passed them in the main pass, the eye unchanged.
 */

/** Whether an object whose bounds' sphere, of radius `radius`, centres `distance` from the main
 *  view's eye is out of its distances, `near` to `far` times `scale`: its nearest point farther
 *  than the farthest, its farthest point nearer than the nearest. A `far` or a `near` of 0 or less
 *  names none of its end. */
export const OUTSIDE_DRAW_DISTANCES_WGSL = wgslFn(
  'outsideDrawDistances',
  [],
  `fn outsideDrawDistances(distance:f32,radius:f32,near:f32,far:f32,scale:f32)->bool{
 let closest=max(distance-radius,0.0);let furthest=distance+radius;
 return (far>0.0&&closest>far*scale)||(near>0.0&&furthest<near*scale);
}`,
)

export const DAG_DRAW_DISTANCE_WGSL = wgslBlock(
  'DAG_DRAW_DISTANCE_WGSL',
  [OUTSIDE_DRAW_DISTANCES_WGSL],
  `/** The radius of the sphere of a box of half extents \`half\`, in a placement's space, in the world \`pose\`
 *  puts it in: the half diagonal at the greatest of the lengths of the pose's rows, held to the half
 *  diagonal of the box the pose makes of it. */
fn drawSphereRadius(pose:mat4x4f,half:vec3f)->f32{
 let rows=pose[0].xyz*pose[0].xyz+pose[1].xyz*pose[1].xyz+pose[2].xyz*pose[2].xyz;
 let extent=abs(pose[0].xyz)*half.x+abs(pose[1].xyz)*half.y+abs(pose[2].xyz)*half.z;
 return min(length(half)*sqrt(max(rows.x,max(rows.y,rows.z))),length(extent));
}
/** Whether placement \`w\`, its mark word \`mark\` and its root's bounds \`node\`'s, is out of its draw
 *  distance: the sphere of its bounds, at its pose at the eye — its centre alone for an instance, or
 *  where the host turned the sphere's edge off. None for a placement whose mark says it names none,
 *  or an instance when the host turned the instances' cull off. */
fn outsideDrawDistance(w:u32,mark:u32,node:CullNode)->bool{
 if((mark&${DRAW_DISTANCE_MARK}u)==0u){return false;}
 let instance=(mark&${DRAW_INSTANCE_MARK}u)!=0u;
 if(instance&&cullOff(CULL_DRAW_DISTANCE_OFF)){return false;}
 let pose=preparedPose(w);
 let centre=(pose*vec4f(0.5*(node.minimum+node.maximum),1.0)).xyz;
 let edge=!instance&&!cullOff(CULL_SPHERE_EDGE_OFF);
 let radius=select(0.0,drawSphereRadius(pose,0.5*(node.maximum-node.minimum)),edge);
 let scale=select(cutView.primitiveDistanceScale,cutView.viewDistanceScale,instance);
 return outsideDrawDistances(length(centre),radius,bitcast<f32>(framesWord(w,${DRAW_NEAR_WORD}u)),bitcast<f32>(framesWord(w,${DRAW_FAR_WORD}u)),scale);
}
/** Whether node \`t\` of the placement tree, its world box \`low\`–\`high\` in the render frame, can
 *  hold no placement within the draw distances its placements name: its box's centre, nearer or
 *  farther than they are by twice the box's half diagonal, as every placement's own test is made at
 *  a point of it, about which its sphere reaches as far again. A group's alone, a cell's words being
 *  zero. Made by the main pass of a cut in two passes alone, and while the instances' cull is on. */
fn outsideGroupDrawDistance(t:u32,low:vec3f,high:vec3f)->bool{
 if(cullOff(CULL_DRAW_DISTANCE_OFF|CULL_NO_DRAW_DISTANCES)||(cutView.occlusion&OCCLUSION_TWO_PASS)==0u){return false;}
 let far=bitcast<f32>(treeWord(t,${TREE_DRAW_FAR}u));
 if(far<=0.0){return false;}
 let near=bitcast<f32>(treeWord(t,${TREE_DRAW_NEAR}u));
 if(near>=far){return false;}
 let scales=vec2f(cutView.viewDistanceScale,cutView.primitiveDistanceScale);
 let centre=length(0.5*(low+high));let slack=length(high-low);
 return outsideDrawDistances(centre,slack,0.0,far,max(scales.x,scales.y))||outsideDrawDistances(centre,slack,near,0.0,min(scales.x,scales.y));
}
`,
)
