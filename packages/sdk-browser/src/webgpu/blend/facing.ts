import { WATER_RANK_SHIFT } from '../water/surfaceWgsl.ts';

/**
 * The cull an entry's pipeline no longer does (plan.ts, VERTEX CULL): mode 1 drops the front
 * faces, mode 2 the back ones, as the pipelines' cullMode would with frontFace ccw.
 *
 * The facing is the sign of the clip-space determinant of the triangle's three corners (x, y, w),
 * the sign of its projected area. The vertex stage only trusts that sign when it is certain: every
 * corner ahead of the eye (w > 0) and the determinant larger than its own rounding. Then it drops
 * the triangle whole, or keeps it and tells the fragment stage nothing. Any other triangle — flat,
 * a sliver whose float sign might disagree with the hardware's snapped facing, one crossing the
 * eye plane, a NaN — is kept, and carries its mode to the fragment stage, which discards on the
 * hardware's own `front_facing`: the one facing the rasteriser uses. Every triangle is thus drawn
 * by exactly one of the two sides — never by both, never by neither.
 *
 * The tolerance comes from float precision alone: the six products of the determinant and their
 * sum round within eight f32 units (2^-23 each) of the sum of their absolute values; a margin of
 * 2^10 over that covers the position the rasteriser receives being contracted differently from
 * the one read here. A doubtful triangle only costs the fragments of its discarded side.
 */
const FACING_TOLERANCE = 8 * 2 ** -23 * 2 ** 10;
/** What `vertexFacing` answers besides a mode: the vertex stage drops the triangle. */
export const FACING_DROP = 3;
/** The mode the fragment applies rides above the water rank, in the same flat word. */
export const FACING_SHIFT = WATER_RANK_SHIFT;

type Corner = readonly [x: number, y: number, w: number];

/**
 * CPU model of `vertexFacing`: 0 keeps the triangle with nothing left to decide, `FACING_DROP`
 * drops it, `cull` keeps it for the fragment stage to decide.
 */
export function vertexFacing(cull: number, [a, b, c]: readonly [Corner, Corner, Corner]): number {
  const terms = [
    a[0] * b[1] * c[2],
    -a[0] * c[1] * b[2],
    -b[0] * a[1] * c[2],
    b[0] * c[1] * a[2],
    c[0] * a[1] * b[2],
    -c[0] * b[1] * a[2],
  ];
  const area = terms.reduce((sum, term) => sum + term, 0);
  const bound = terms.reduce((sum, term) => sum + Math.abs(term), 0);
  const ahead = a[2] > 0 && b[2] > 0 && c[2] > 0;
  if (!ahead || !(Math.abs(area) > FACING_TOLERANCE * bound)) return cull;
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
 var ahead=true;
 for(var k=0u;k<3u;k++){
  let id=vertexBase+indices[triangle+k];
  c[k]=(uni.viewProj*(world*vec4f(positions[id*3u],positions[id*3u+1u],positions[id*3u+2u],1.0))).xyw;
  ahead=ahead&&c[k].z>0.0;
 }
 let t0=c[0].x*c[1].y*c[2].z;let t1=-c[0].x*c[2].y*c[1].z;let t2=-c[1].x*c[0].y*c[2].z;
 let t3=c[1].x*c[2].y*c[0].z;let t4=c[2].x*c[0].y*c[1].z;let t5=-c[2].x*c[1].y*c[0].z;
 let area=t0+t1+t2+t3+t4+t5;
 let bound=abs(t0)+abs(t1)+abs(t2)+abs(t3)+abs(t4)+abs(t5);
 if(!ahead||!(abs(area)>${FACING_TOLERANCE}*bound)){return cull;}
 if(cull==1u){return select(0u,${FACING_DROP}u,area>=0.0);}
 return select(0u,${FACING_DROP}u,area<0.0);
}
fn facingDiscarded(mode:u32,front:bool)->bool{return (mode==1u&&front)||(mode==2u&&!front);}
`;
