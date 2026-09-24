import { WATER_RANK_SHIFT } from '../water/surfaceWgsl.ts';

/**
 * The cull an entry's pipeline no longer does (plan.ts, VERTEX CULL): mode 1 drops the front
 * faces, mode 2 the back ones, as the pipelines' cullMode would with frontFace ccw.
 *
 * The facing is the sign of the clip-space determinant of the triangle's three corners (x, y, w),
 * the sign of its projected area. The rasteriser takes that sign on the corners it snapped to its
 * sub-pixel grid, after clipping; the vertex stage only trusts its own sign when no snapping and
 * no clipping can turn it: every corner inside the clip volume (so the triangle is not clipped),
 * the determinant larger than its own float rounding, and the area in pixels larger than any move
 * of the corners by one snapping step can change. Then it drops the triangle whole, or keeps it
 * and tells the fragment stage nothing. Any other triangle — flat, a sub-pixel sliver, one the
 * frustum clips, a NaN — is kept, and carries its mode to the fragment stage, which discards on
 * the hardware's own `front_facing`: the one facing the rasteriser uses. Every triangle is thus
 * drawn by exactly one of the two sides — never by both, never by neither.
 *
 * Float bound: the six products of the determinant and their sum round within eight f32 units
 * (2^-23 each) of the sum of their absolute values; a margin of 2^10 over that covers the position
 * the rasteriser receives being contracted differently from the one read here.
 *
 * Snapping bound: WebGPU sets no sub-pixel precision; Vulkan guarantees only four bits, D3D and
 * Metal give eight. A step of 2^-4 pixel is the coarsest grid any backend snaps to, and moving
 * each corner by at most that much on each axis changes twice the area by at most
 * `2·step·(|e1|₁ + |e2|₁) + 8·step²`, e1 and e2 the two edges from the first corner. A doubtful
 * triangle only costs the fragments of its discarded side.
 */
const FACING_TOLERANCE = 8 * 2 ** -23 * 2 ** 10;
const SNAP_STEP = 2 ** -4;
/** What `vertexFacing` answers besides a mode: the vertex stage drops the triangle. */
export const FACING_DROP = 3;
/** The mode the fragment applies rides above the water rank, in the same flat word. */
export const FACING_SHIFT = WATER_RANK_SHIFT;

type Corner = readonly [x: number, y: number, z: number, w: number];

/**
 * CPU model of `vertexFacing`, on clip-space corners and the target size in pixels: 0 keeps the
 * triangle with nothing left to decide, `FACING_DROP` drops it, `cull` keeps it for the fragment
 * stage to decide.
 */
export function vertexFacing(
  cull: number,
  corners: readonly [Corner, Corner, Corner],
  viewport: readonly [width: number, height: number],
): number {
  const [a, b, c] = corners;
  const terms = [
    a[0] * b[1] * c[3],
    -a[0] * c[1] * b[3],
    -b[0] * a[1] * c[3],
    b[0] * c[1] * a[3],
    c[0] * a[1] * b[3],
    -c[0] * b[1] * a[3],
  ];
  const area = terms.reduce((sum, term) => sum + term, 0);
  const bound = terms.reduce((sum, term) => sum + Math.abs(term), 0);
  const inside = corners.every(
    ([x, y, z, w]) => w > 0 && Math.abs(x) <= w && Math.abs(y) <= w && z >= 0 && z <= w,
  );
  const [p0, p1, p2] = corners.map(([x, y, , w]) => [
    ((x / w) * viewport[0]) / 2,
    ((y / w) * viewport[1]) / 2,
  ]);
  const e1 = [p1[0] - p0[0], p1[1] - p0[1]],
    e2 = [p2[0] - p0[0], p2[1] - p0[1]];
  const pixels = Math.abs(e1[0] * e2[1] - e1[1] * e2[0]);
  const edges = Math.abs(e1[0]) + Math.abs(e1[1]) + Math.abs(e2[0]) + Math.abs(e2[1]);
  if (
    !inside ||
    !(Math.abs(area) > FACING_TOLERANCE * bound) ||
    !(pixels > SNAP_STEP * (2 * edges + 8 * SNAP_STEP))
  )
    return cull;
  if (cull === 1) return area >= 0 ? FACING_DROP : 0;
  return area < 0 ? FACING_DROP : 0;
}

/** CPU model of `facingDiscarded`: the fragment of a doubtful triangle its side does not draw. */
export const facingDiscarded = (mode: number, front: boolean) =>
  (mode === 1 && front) || (mode === 2 && !front);

/** The two functions in WGSL; the host shader declares `indices`, `positions` and `uni` first. */
export const FACING_WGSL = `
fn vertexFacing(cull:u32,world:mat4x4f,vertexBase:u32,triangle:u32)->u32{
 var c:array<vec3f,3>;
 var p:array<vec2f,3>;
 var inside=true;
 for(var k=0u;k<3u;k++){
  let id=vertexBase+indices[triangle+k];
  let q=uni.viewProj*(world*vec4f(positions[id*3u],positions[id*3u+1u],positions[id*3u+2u],1.0));
  c[k]=q.xyw;
  p[k]=q.xy/q.w*uni.viewport*0.5;
  inside=inside&&q.w>0.0&&all(abs(q.xy)<=vec2f(q.w))&&q.z>=0.0&&q.z<=q.w;
 }
 let t0=c[0].x*c[1].y*c[2].z;let t1=-c[0].x*c[2].y*c[1].z;let t2=-c[1].x*c[0].y*c[2].z;
 let t3=c[1].x*c[2].y*c[0].z;let t4=c[2].x*c[0].y*c[1].z;let t5=-c[2].x*c[1].y*c[0].z;
 let area=t0+t1+t2+t3+t4+t5;
 let bound=abs(t0)+abs(t1)+abs(t2)+abs(t3)+abs(t4)+abs(t5);
 let e1=p[1]-p[0];let e2=p[2]-p[0];
 let pixels=abs(e1.x*e2.y-e1.y*e2.x);
 let edges=abs(e1.x)+abs(e1.y)+abs(e2.x)+abs(e2.y);
 if(!inside||!(abs(area)>${FACING_TOLERANCE}*bound)||!(pixels>${SNAP_STEP}*(2.0*edges+${8 * SNAP_STEP}))){return cull;}
 if(cull==1u){return select(0u,${FACING_DROP}u,area>=0.0);}
 return select(0u,${FACING_DROP}u,area<0.0);
}
fn facingDiscarded(mode:u32,front:bool)->bool{return (mode==1u&&front)||(mode==2u&&!front);}
`;
