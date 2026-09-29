/**
 * The DEADLINE of a request ahead of the camera (#488): the share of the horizon before the camera
 * needs the page, 0 now, 1 at the horizon. The host serves the requests ahead soonest first
 * (`request.ts`, `quantizeAheadPriority`), behind every visible one.
 *
 * Read from the two frusta the cut already holds in the primitive's space, the camera's and the view
 * ahead's (`../core/aheadView.ts`), whose planes pair up rank by rank: the view ahead is the camera's
 * swept over the horizon. A box outside a camera plane by `outside` and inside its plane ahead by
 * `inside` crosses it at `outside / (outside + inside)` of the horizon, the plane's sweep taken as
 * even; it is needed once it has crossed every plane, the latest of them. A page already inside the
 * camera frustum — asked for by the view ahead for its detail — is due now. Nothing is tuned: the
 * horizon and the sweep are the camera's own motion.
 *
 * One formula, in TypeScript for the oracle (`oracle/oracle.ts`) and in WGSL for the kernel
 * (`shader/aheadWgsl.ts`), each distance over its plane's normal length: a primitive's scale moves
 * no deadline.
 */

/** Signed distance to plane `at` of `planes` of the box corner furthest along its normal: negative
 *  outside. A plane with no normal — one no box leaves — reads zero. */
function planeReach(
  planes: ArrayLike<number>,
  at: number,
  min: ArrayLike<number>,
  max: ArrayLike<number>,
) {
  const nx = planes[at],
    ny = planes[at + 1],
    nz = planes[at + 2],
    length = Math.hypot(nx, ny, nz);
  if (!(length > 0)) return 0;
  const x = nx > 0 ? max[0] : min[0],
    y = ny > 0 ? max[1] : min[1],
    z = nz > 0 ? max[2] : min[2];
  return (nx * x + ny * y + nz * z + planes[at + 3]) / length;
}

/** The deadline of the box `min`–`max`: the latest crossing of a camera plane, over the six. A plane
 *  that reads as no number — an infinite far plane — is never crossed late. */
export function aheadDue(
  camera: ArrayLike<number>,
  ahead: ArrayLike<number>,
  min: ArrayLike<number>,
  max: ArrayLike<number>,
) {
  let due = 0;
  for (let at = 0; at < 24; at += 4) {
    const outside = -planeReach(camera, at, min, max);
    if (!(outside > 0)) continue;
    const inside = planeReach(ahead, at, min, max);
    due = Math.max(due, outside / (outside + (inside > 0 ? inside : 0)));
  }
  return due;
}

/** WGSL mirror, on the planes `dagPrepare` left in `frames` (`shader/primitiveWgsl.ts`). */
export const DAG_AHEAD_DUE_WGSL = `fn planeReach(p:vec4f,bmin:vec3f,bmax:vec3f)->f32{
 let n=length(p.xyz);if(!(n>0.0)){return 0.0;}
 let c=vec3f(select(bmin.x,bmax.x,p.x>0.0),select(bmin.y,bmax.y,p.y>0.0),select(bmin.z,bmax.z,p.z>0.0));
 return (dot(p.xyz,c)+p.w)/n;
}
fn aheadDue(w:u32,bmin:vec3f,bmax:vec3f)->f32{
 let now=slotOf(w)*FRAME;let later=aheadPlanes(w);let skip=select(6u,FAR_PLANE,farless());
 var due=0.0;
 for(var i=0u;i<6u;i++){
  if(i==skip){continue;}
  let outside=-planeReach(frames[now+i],bmin,bmax);
  if(outside>0.0){due=max(due,outside/(outside+max(planeReach(frames[later+i],bmin,bmax),0.0)));}
 }
 return due;
}
`;
