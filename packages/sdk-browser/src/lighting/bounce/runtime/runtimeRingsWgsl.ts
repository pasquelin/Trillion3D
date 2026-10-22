import { wgslF32 } from '../../../../../math/src/wgsl/number.ts'
import { wgslBlock } from '../../../../../math/src/wgsl/decl.ts'
import { rayBoxSpan, rayInverseDirection } from '../../../../../math/src/wgsl/geometry.ts'
import { NO_INDEX } from '../../../../../math/src/wgsl/constants.ts'
import { runtimeSceneWgsl } from './runtimeSceneWgsl.ts'
import { sceneKey, type SceneBindings } from '../sceneBindings.ts'

/** How far behind the end of a ring the next one starts, in metres: a triangle test rejects a hit within 1e-4 of
 *  its origin (`rayTriangleDistance`), so two rings that met end to end would leave a surface there in neither. */
const RING_SEAM = 2e-4

const RT_RINGS_TEXT = `
const RT_SEAM:f32=${wgslF32(RING_SEAM)};
/** The windows of a ringed walk (\`rtLayersOver\`; \`on\`: a walk with windows, though it holds none). Its \`count\` rings:
 *  each the stretch of the walk from \`begins[k]\` to \`ends[k]\` (distances from the walk's origin, the ends growing),
 *  entered where the one before left off at the soonest, and the units and triangle tests each ring may spend. A detail window
 *  ahead of them, from \`detail.w\` to \`detail.x\` (zero: none), \`detail.y\` the fade of its hits by the distance of
 *  the walk from the eye (its window is not walked at one), \`detail.z\` the noise they are taken against, the
 *  units and tests it may spend. */
struct RtRings{begins:vec4f,ends:vec4f,count:u32,work:u32,tests:u32,on:bool,detail:vec4f,detailWork:u32,detailTests:u32,}
fn rtNoRings()->RtRings{return RtRings(vec4f(0.0),vec4f(0.0),0u,0u,0u,false,vec4f(0.0),0u,0u);}
/** What the nearest surface of a layer is over the rings (\`rtNearest\`): the hit, whether it is an exhausted detail
 *  walk's stop, what spent the first window that was, the units the windows spent. */
struct RtNearest{hit:RtHit,stopped:bool,cause:u32,work:u32,}
/** A window begins: nothing spent, the budget of its own. */
fn rtWindow(work:u32,tests:u32){rtWork=0u;rtTests=0u;rtCause=0u;rtBudget=work;rtTestBudget=tests;}
/** Whether the detail window's result, \`at\` along the walk (a surface found, or the reach of a walk that spent its
 *  budget), is a hit: its fade, by the distance of the walk from the eye or by how far into the window it lies, under the
 *  noise it is taken against. */
fn rtDetailTaken(at:f32,rings:RtRings)->bool{
 let fade=max(rings.detail.y,saturate((at-0.7*rings.detail.x)/(0.3*rings.detail.x)));
 return fade<rings.detail.z;
}
/** The nearest surface of the layer that starts at \`start\`, \`done\` along the walk and \`left\` from its end, over the
 *  windows of \`rings\`, in order. The detail window's result, a surface found or a budget spent, is a hit by
 *  noise against its fade; refused, the rings go on from where it stopped. Then each ring, from where the one
 *  before left off: the first that finds a surface answers it (its distance from \`start\`), one that spends its
 *  budget having found none is skipped. A ring starts \`RT_SEAM\` behind its beginning, so that no surface lies between
 *  two; none is walked past the box of the placement tree's root. */
fn rtNearest(start:vec3f,direction:vec3f,left:f32,done:f32,rings:RtRings)->RtNearest{
 var out=RtNearest(RtHit(left,0u,0u,false),false,0u,0u);
 var begin=0.0;
 let detailBegin=max(rings.detail.w-done,0.0);
 let detailEnd=min(rings.detail.x-done,left);
 if(detailEnd>detailBegin&&rings.detail.y<1.0){
  let back=max(detailBegin-RT_SEAM,0.0);
  rtWindow(rings.detailWork,rings.detailTests);
  let hit=rtScene(start+direction*back,direction,detailEnd-back);
  out.work+=rtWork;
  if(rtSpent()){out.cause=rtWhy();}
  begin=detailEnd;
  if(hit.found||rtSpent()){
   let at=back+select(rtReached,hit.distance,hit.found);
   if(rtDetailTaken(done+at,rings)){
    out.hit=RtHit(hit.distance+back,hit.placement,hit.triangle,hit.found);
    out.stopped=!hit.found;
    return out;
   }
   begin=at;
  }
 }
 var inside=vec2f(0.0,left);
 if(rtProxy.treeRoot!=NO_INDEX){
  inside=rayBoxSpan(rtTreeLow(rtProxy.treeRoot),rtTreeHigh(rtProxy.treeRoot),start,rayInverseDirection(direction));
 }
 for(var k=0u;k<rings.count;k++){
  let lo=max(max(rings.begins[k]-done,begin),inside.x);
  let end=min(min(rings.ends[k]-done,left),inside.y);
  if(end<=lo){continue;}
  let back=max(lo-RT_SEAM,0.0);
  rtWindow(rings.work,rings.tests);
  let hit=rtScene(start+direction*back,direction,end-back);
  out.work+=rtWork;
  if(rtSpent()&&out.cause==0u){out.cause=rtWhy();}
  if(hit.found){out.hit=RtHit(hit.distance+back,hit.placement,hit.triangle,true);return out;}
  begin=end;
 }
 return out;
}
`

/**
 * The windows of a ringed walk (`rtLayersOver`) and the nearest surface of a layer over them (`rtNearest`): a
 * detail window ahead, the rings after it, each walked on a budget of its own; the caller's the windows, the
 * tracer's the walk of each.
 */
export const runtimeRingsWgsl = (scene: SceneBindings) =>
  wgslBlock(
    `runtimeRingsWgsl(${sceneKey(scene)})`,
    [runtimeSceneWgsl(scene), rayBoxSpan, rayInverseDirection, NO_INDEX],
    RT_RINGS_TEXT,
  )
