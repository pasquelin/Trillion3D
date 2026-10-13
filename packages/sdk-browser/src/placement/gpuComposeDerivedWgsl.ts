/**
 * What the compose passes derive from a composed world besides the words of the row itself
 * (`gpuComposeWgsl.ts`), each the CPU's to the word — the doubles it derives them in, rounded where
 * it rounds them: the root's world box, the eight corners of a row the Hi-Z test projects, and the
 * detail words the shadows' levels are judged by. They read what a world does not change from a
 * row's inputs (`composedRowInputs.ts`), twenty-four doubles a row, the declarations the
 * program holds:
 *
 *   inputs    array<vec2u>   a row's inputs, `INPUT_DOUBLES` doubles each
 *   corners   array<u32>     `CORNER_VALUES` words a row, the Hi-Z corners
 *   lods      array<u32>     `ROW_LOD_FLOATS` words a row, the shadow detail
 *   rootBoxes array<vec2u>   six doubles a root, its world box
 *
 * An affine world — its last row `(0, 0, 0, 1)`, as every product of the poses a node tree makes
 * is — takes the corners' divide by `w` as the CPU does: it is 1.
 */
import { wgslBlock } from '../../../math/src/wgsl/decl.ts'
import {
  dAdd,
  dLess,
  dMax,
  dMin,
  dMul,
  dSqrt,
  dSub,
  splitDouble,
} from '../../../math/src/wgsl/double.ts'
import { fromF32, toF32 } from '../../../math/src/wgsl/f32.ts'
import { FINITE_SENTINEL } from '../../../math/src/wgsl/constants.ts'
import { STRETCH_DOUBLE_WGSL } from './gpuStretchWgsl.ts'
import { CORNER_VALUES } from '../gpu/partition/contract.ts'
import { ROW_LOD_FLOATS } from '../webgpu/shadow/rowLodWords.ts'
import { INPUT_LOD, ROW_INPUT_DOUBLES } from './composedRowPack.ts'

/** `m[i]·x + m[4+i]·y + m[8+i]·z + m[12+i]`, summed left to right: the axis `i` of
 *  `transformAffinePoint`. */
const AFFINE_WGSL = wgslBlock(
  'AFFINE_WGSL',
  [dAdd, dMul],
  `
fn affineAxis(w:array<vec2u,16>,i:u32,x:vec2u,y:vec2u,z:vec2u)->vec2u{
 return dAdd(dAdd(dAdd(dMul(w[i],x),dMul(w[4u+i],y)),dMul(w[8u+i],z)),w[12u+i]);
}`,
)

const BASE = `let at=row*${ROW_INPUT_DOUBLES}u;`

/** The eight corners of row `row`'s box at `world`, as `packPageCorners` writes them: corner `k`
 *  takes the maximum on `x` when bit 0 of `k` is set, on `y` for bit 1, on `z` for bit 2. */
export const CORNERS_WGSL = wgslBlock(
  'CORNERS_WGSL',
  [splitDouble, AFFINE_WGSL],
  `
fn composeCorners(row:u32,world:array<vec2u,16>){
 ${BASE}
 let out=row*${CORNER_VALUES}u;
 var p:array<vec2u,3>;
 for(var k=0u;k<8u;k++){
  for(var axis=0u;axis<3u;axis++){
   p[axis]=inputs[at+6u+axis];
   if(((k>>axis)&1u)!=0u){p[axis]=inputs[at+9u+axis];}
  }
  for(var axis=0u;axis<3u;axis++){
   let s=splitDouble(affineAxis(world,axis,p[0],p[1],p[2]));
   corners[out+k*6u+axis]=s.x;
   corners[out+k*6u+3u+axis]=s.y;
  }
 }
}`,
)

/** The box of bounds `lo` and `hi` carried by `world`, its eight corners folded in `boxTransform`'s
 *  order: six doubles, an empty box left as it is. */
export const CARRIED_BOX_WGSL = wgslBlock(
  'CARRIED_BOX_WGSL',
  [AFFINE_WGSL, dMin, dMax, dLess],
  `
fn carriedBox(world:array<vec2u,16>,lo:array<vec2u,3>,hi:array<vec2u,3>)->array<vec2u,6>{
 var out:array<vec2u,6>;
 for(var a=0u;a<3u;a++){out[a]=lo[a];out[3u+a]=hi[a];}
 if(dLess(hi[0],lo[0])||dLess(hi[1],lo[1])||dLess(hi[2],lo[2])){return out;}
 var low:array<vec2u,3>;
 var high:array<vec2u,3>;
 var p:array<vec2u,3>;
 for(var axis=0u;axis<3u;axis++){
  low[axis]=vec2u(0x7ff00000u,0u);
  high[axis]=vec2u(0xfff00000u,0u);
 }
 for(var k=0u;k<8u;k++){
  for(var axis=0u;axis<3u;axis++){
   p[axis]=lo[axis];
   if(((k>>axis)&1u)!=0u){p[axis]=hi[axis];}
  }
  for(var axis=0u;axis<3u;axis++){
   let v=affineAxis(world,axis,p[0],p[1],p[2]);
   low[axis]=dMin(low[axis],v);
   high[axis]=dMax(high[axis],v);
  }
 }
 for(var a=0u;a<3u;a++){out[a]=low[a];out[3u+a]=high[a];}
 return out;
}`,
)

/** The world box of root `rank`: its local box (`rootInputs`, six doubles from `at`) carried by
 *  `world`. */
export const WORLD_BOX_WGSL = wgslBlock(
  'WORLD_BOX_WGSL',
  [CARRIED_BOX_WGSL],
  `
fn composeBox(rank:u32,at:u32,world:array<vec2u,16>){
 var lo:array<vec2u,3>;
 var hi:array<vec2u,3>;
 for(var a=0u;a<3u;a++){lo[a]=rootInputs[at+a];hi[a]=rootInputs[at+3u+a];}
 let box=carriedBox(world,lo,hi);
 for(var k=0u;k<6u;k++){rootBoxes[rank*6u+k]=box[k];}
}`,
)

/** Row `row`'s detail words at `world` (`applyRowLod`): the errors and their centres by the stretch of
 *  the world, the radii, the radius of the root's world box, the residency folded in. */
export const LOD_WGSL = wgslBlock(
  'LOD_WGSL',
  [splitDouble, AFFINE_WGSL, STRETCH_DOUBLE_WGSL, dSqrt, dMul, dAdd, dSub, FINITE_SENTINEL],
  `
fn lodCentre(o:u32,at:u32,world:array<vec2u,16>,src:u32,low:u32){
 for(var axis=0u;axis<3u;axis++){
  let s=splitDouble(affineAxis(world,axis,inputs[at+src],inputs[at+src+1u],inputs[at+src+2u]));
  lods[o+low-8u+axis]=s.x;
  lods[o+low+axis]=s.y;
 }
}
fn composeLod(row:u32,rank:u32,world:array<vec2u,16>){
 let at=row*${ROW_INPUT_DOUBLES}u+${INPUT_LOD}u;
 let o=row*${ROW_LOD_FLOATS}u;
 for(var k=0u;k<${ROW_LOD_FLOATS}u;k++){lods[o+k]=0u;}
 lods[o+7u]=bitcast<u32>(FINITE_SENTINEL);
 let flags=inputs[at+10u].x;
 if((flags&16u)!=0u){
  let a=rootBoxes[rank*6u];let b=rootBoxes[rank*6u+1u];let c=rootBoxes[rank*6u+2u];
  let dx=dSub(rootBoxes[rank*6u+3u],a);
  let dy=dSub(rootBoxes[rank*6u+4u],b);
  let dz=dSub(rootBoxes[rank*6u+5u],c);
  let s=dAdd(dAdd(dMul(dx,dx),dMul(dy,dy)),dMul(dz,dz));
  lods[o+18u]=toF32(dMul(dSqrt(s),vec2u(0x3fe00000u,0u)));
 }
 if((flags&1u)==0u){return;}
 let scale=maxStretchOf(world);
 if((flags&2u)!=0u){lods[o+3u]=toF32(dMul(inputs[at+8u],scale));}
 lodCentre(o,at,world,0u,8u);
 lods[o+16u]=toF32(dMul(inputs[at+3u],scale));
 if((flags&4u)==0u){lods[o+7u]=0u;return;}
 if((flags&8u)!=0u){
  lodCentre(o+4u,at,world,4u,8u);
  lods[o+7u]=toF32(dMul(inputs[at+9u],scale));
  lods[o+17u]=toF32(dMul(inputs[at+7u],scale));
 }
}`,
)
