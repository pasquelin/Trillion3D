import { wgslBlock, wgslFn } from '../../../../../math/src/wgsl/decl.ts'
import { DRAW_DISTANCE_MARK, DRAW_FAR_WORD, DRAW_NEAR_WORD } from '../frameTable.ts'
import { TREE_DRAW_FAR, TREE_DRAW_NEAR } from '../nodeLayout.ts'

/**
 * THE DRAW DISTANCE: an object that names the distances it is drawn at (`DagRoot.drawDistance`,
 * `DrawDistanceSettings` in `../../../../../sdk-core/src/contracts/objectOptions.ts`) is drawn
 * nowhere else, by every pass that decides what a view shows of it — the camera's cut, the sun's
 * casters, the rays' scene.
 *
 * `outsideDrawDistances` is the one arithmetic: the squared distance from the main view's eye to
 * the centre of the object's bounds, under the nearest distance's square or over the farthest's,
 * both multiplied by the view's scale first (`cutViewDistanceScale`). A farthest distance of 0
 * names none, and the nearest alone never culls.
 *
 * The camera's cut tests a placement first, before any other test of its root (`levelWgsl.ts`,
 * `testRoot`), by its mark word's bit (`DRAW_DISTANCE_MARK`) before it reads a distance word: a
 * placement that names none costs no load. `cutDrawDistanceCulling` turns the cull off
 * (`CULL_DRAW_DISTANCE_OFF`), as does a packing no placement of which names a distance
 * (`../uniforms.ts`).
 *
 * A group of the placement tree, up to `TREE_SPAN` placements, holds the nearest and the farthest
 * distance of its placements, fitted with its box (`../tree/treeRefitWgsl.ts`; `TREE_DRAW_NEAR`,
 * `TREE_DRAW_FAR`), both 0 when one placement is drawn at every distance. It is tested before its
 * box is (`placementTreeWgsl.ts`, `testCell`) and conservatively: its box's centre, nearer or
 * farther by the half diagonal, must lie out of the distances for the group to be culled.
 * Distances whose squares leave nothing between them name no draw distance for a group: its
 * placements' own tests still cull. A cell above the groups holds none (no refit writes its
 * words), so it is never culled by distance; a cut in one pass (`OCCLUSION_TWO_PASS` off) tests
 * its placements alone. The post pass tests none again: what it holds passed them in the main
 * pass, the eye unchanged.
 */

/** Whether an object whose bounds' centre lies `squared` (squared) from the main view's eye is out
 *  of its distances, `near` to `far` times `scale`: nearer or farther. None — never out — for a
 *  `far` of 0 or less. */
export const OUTSIDE_DRAW_DISTANCES_WGSL = wgslFn(
  'outsideDrawDistances',
  [],
  `fn outsideDrawDistances(squared:f32,near:f32,far:f32,scale:f32)->bool{
 if(far<=0.0){return false;}
 let lo=near*scale;let hi=far*scale;
 return squared<lo*lo||squared>hi*hi;
}`,
)

export const DAG_DRAW_DISTANCE_WGSL = wgslBlock(
  'DAG_DRAW_DISTANCE_WGSL',
  [OUTSIDE_DRAW_DISTANCES_WGSL],
  `/** Whether placement \`w\`, its mark word \`mark\` and its root's bounds \`node\`'s, is out of its draw
 *  distance: the centre of its bounds, at its pose at the eye. None for a placement whose mark says
 *  it names none, or when the host turned the cull off. */
fn outsideDrawDistance(w:u32,mark:u32,node:CullNode)->bool{
 if((mark&${DRAW_DISTANCE_MARK}u)==0u||cullOff(CULL_DRAW_DISTANCE_OFF)){return false;}
 let centre=(preparedPose(w)*vec4f(0.5*(node.minimum+node.maximum),1.0)).xyz;
 return outsideDrawDistances(dot(centre,centre),bitcast<f32>(framesWord(w,${DRAW_NEAR_WORD}u)),bitcast<f32>(framesWord(w,${DRAW_FAR_WORD}u)),views[0u].viewDistanceScale);
}
/** Whether node \`t\` of the placement tree, its world box \`low\`–\`high\` in the render frame, can
 *  hold no point within the draw distances its placements name: its box's centre, nearer or farther
 *  than they are by the box's half diagonal, as every placement's own test is made at a point of
 *  it. A group's alone, a cell's words being zero. Made by the main pass of a cut in two passes
 *  alone. */
fn outsideGroupDrawDistance(t:u32,low:vec3f,high:vec3f)->bool{
 if(cullOff(CULL_DRAW_DISTANCE_OFF)||(views[0u].occlusion&OCCLUSION_TWO_PASS)==0u){return false;}
 let far=bitcast<f32>(treeWord(t,${TREE_DRAW_FAR}u));
 if(far<=0.0){return false;}
 let scale=views[0u].viewDistanceScale;
 let lo=bitcast<f32>(treeWord(t,${TREE_DRAW_NEAR}u))*scale;let hi=far*scale;
 if(lo*lo>=hi*hi){return false;}
 let centre=0.5*(low+high);let radius=length(0.5*(high-low));
 let reach=length(centre);
 let nearest=max(0.0,reach-radius);let farthest=reach+radius;
 return farthest*farthest<lo*lo||nearest*nearest>hi*hi;
}
`,
)
