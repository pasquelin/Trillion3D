/**
 * The DEADLINE of a request ahead of the camera: the share of the horizon before the camera
 * needs the page, 0 now, 1 at the horizon. The host serves the requests ahead soonest first
 * (`requestWgsl.ts`, `aheadPriority`), behind every visible one.
 *
 * Read from the two frusta the cut already holds in the primitive's space, the camera's and the view
 * ahead's (`../core/aheadView.ts`), whose planes pair up rank by rank: the view ahead is the camera's
 * swept over the horizon. A box outside a camera plane by `outside` and inside its plane ahead by
 * `inside` crosses it at `outside / (outside + inside)` of the horizon, the plane's sweep taken as
 * even; it is needed once it has crossed every plane, the latest of them. A page already inside the
 * camera frustum — asked for by the view ahead for its detail — is due now. Nothing is tuned: the
 * horizon and the sweep are the camera's own motion.
 *
 * One formula, in WGSL for the kernel (`shader/aheadWgsl.ts`) and in TypeScript for the oracle
 * (`aheadDue.fixture.ts`), each distance over its plane's normal length: a primitive's scale moves
 * no deadline.
 */

/** The WGSL, on the planes `dagPrepare` left in `frames` (`shader/primitiveWgsl.ts`): the
 *  camera's in its row — `slotOf` under view 0, whatever view `vi` names when the view ahead asks —,
 *  those ahead behind it. The two views share their far plane's kind (`../core/aheadView.ts`). */
export const DAG_AHEAD_DUE_WGSL = `fn cameraPlanes(w:u32)->u32{return rowOf(w)*FRAME;}
fn planeReach(p:vec4f,bmin:vec3f,bmax:vec3f)->f32{
 let n=length(p.xyz);if(!(n>0.0)){return 0.0;}
 let c=vec3f(select(bmin.x,bmax.x,p.x>0.0),select(bmin.y,bmax.y,p.y>0.0),select(bmin.z,bmax.z,p.z>0.0));
 return (dot(p.xyz,c)+p.w)/n;
}
fn aheadDue(w:u32,bmin:vec3f,bmax:vec3f)->f32{
 let now=cameraPlanes(w);let later=aheadPlanes(w);let skip=select(6u,FAR_PLANE,farless());
 var due=0.0;
 for(var i=0u;i<6u;i++){
  if(i==skip){continue;}
  let outside=-planeReach(frames[now+i],bmin,bmax);
  if(outside>0.0){due=max(due,outside/(outside+max(planeReach(frames[later+i],bmin,bmax),0.0)));}
 }
 return due;
}
`
