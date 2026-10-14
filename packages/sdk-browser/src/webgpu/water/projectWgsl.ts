import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { dAdd, dDiv, dMul, dSub } from '../../../../math/src/wgsl/double.ts'
import { dIsNan, dIsZero, dNan } from '../../../../math/src/wgsl/doubleWords.ts'
import { dBelow, dMathMax, dMathMin } from '../../../../math/src/wgsl/doubleOrder.ts'
import { dCeil, dFloor, dFromU32, dIsFinite } from '../../../../math/src/wgsl/doubleRound.ts'
import { FRAME_HEAD_WGSL } from '../blend/frameHead.ts'
import { WATER_DOUBLES_WGSL, WATER_ENCLOSE_WGSL } from './encloseWgsl.ts'

/**
 * THE SCREEN RECTANGLE OF A BOX, IN EMULATED DOUBLES: the CPU's `project` of the water bounds
 * (`waterRect.fixture.ts`) — the box's enclosure under the projection, its eight corners through
 * `projectCornersInto` (`../../hiz/projection.fixture.ts`: the view depth against the near plane,
 * the clip `w`, the divided coordinates, floor and ceil of their pixels), then each side pushed out
 * by the enclosure's error and one pixel, clamped to the target — operation for operation, so the
 * rectangle is the CPU's to the bit. A refused one (a corner at or behind the near plane, a refused enclosure, a non-finite
 * side) returns a NaN first side. The enclosure of the last box projected stays in `projectNdc`,
 * where the backdrop's reconstruction starts from it, as the CPU's scratch does.
 */
export const WATER_PROJECT_WGSL = wgslBlock(
  'WATER_PROJECT_WGSL',
  [
    WATER_DOUBLES_WGSL,
    WATER_ENCLOSE_WGSL,
    FRAME_HEAD_WGSL,
    dAdd,
    dDiv,
    dMul,
    dSub,
    dIsNan,
    dIsZero,
    dNan,
    dBelow,
    dMathMax,
    dMathMin,
    dCeil,
    dFloor,
    dFromU32,
    dIsFinite,
  ],
  `var<private> projectNdc:array<vec2u,6>;
/** A corner's coordinate as \`boxCornersInto\` writes it under the identity: a zero as \`+0\`. */
fn waterCorner(v:vec2u)->vec2u{return select(v,D_ZERO,dIsZero(v));}
/** Row \`row\` of the view, in doubles, at \`(x, y, z, 1)\`. */
fn waterViewRow(row:u32,x:vec2u,y:vec2u,z:vec2u)->vec2u{
 let a=dMul(frameDouble(FRAME_VIEW+2u*row),x);
 let b=dMul(frameDouble(FRAME_VIEW+2u*(4u+row)),y);
 let c=dMul(frameDouble(FRAME_VIEW+2u*(8u+row)),z);
 return dAdd(dAdd(dAdd(a,b),c),frameDouble(FRAME_VIEW+2u*(12u+row)));
}
/** \`projectCornersInto\`'s pixel bounds of the box's corners, floor then ceil; a NaN first bound
 *  when a corner reaches the near plane or has no positive finite clip \`w\`. */
fn waterCorners(box:array<vec2u,6>,e:array<vec2u,16>)->array<vec2u,4>{
 var out:array<vec2u,4>;
 out[0]=dNan();
 let form=frame[FRAME_VIEW_FORM];
 let near=frameDouble(FRAME_NEAR);
 var lowX=D_INFINITY;
 var lowY=D_INFINITY;
 var highX=vec2u(D_INFINITY.x|0x80000000u,0u);
 var highY=highX;
 for(var i=0u;i<8u;i++){
  let x=waterCorner(select(box[0],box[3],(i&1u)!=0u));
  let y=waterCorner(select(box[1],box[4],(i&2u)!=0u));
  let z=waterCorner(select(box[2],box[5],(i&4u)!=0u));
  let viewZ=waterViewRow(2u,x,y,z);
  var depth=viewZ;
  if((form&VIEW_AFFINE)==0u){
   let vd=waterViewRow(3u,x,y,z);
   if(vd.x!=D_ONE.x||vd.y!=D_ONE.y){depth=dMul(viewZ,dDiv(D_ONE,vd));}
  }
  let ahead=vec2u(depth.x^0x80000000u,depth.y);
  if(!dIsNan(ahead)&&!dIsNan(near)&&!dBelow(near,ahead)){return out;}
  let cw=waterRow(e,3u,x,y,z);
  if(!dBelow(D_ZERO,cw)||!dIsFinite(cw)){return out;}
  let ndcX=dDiv(waterRow(e,0u,x,y,z),cw);
  let ndcY=dDiv(waterRow(e,1u,x,y,z),cw);
  if(dBelow(ndcX,lowX)){lowX=ndcX;}
  if(dBelow(highX,ndcX)){highX=ndcX;}
  if(dBelow(ndcY,lowY)){lowY=ndcY;}
  if(dBelow(highY,ndcY)){highY=ndcY;}
 }
 let width=dFromU32(frame[FRAME_WIDTH]);
 let height=dFromU32(frame[FRAME_HEIGHT]);
 out[0]=dFloor(dMul(dAdd(dMul(lowX,D_HALF),D_HALF),width));
 out[1]=dFloor(dMul(dSub(D_ONE,dAdd(dMul(highY,D_HALF),D_HALF)),height));
 out[2]=dCeil(dMul(dAdd(dMul(highX,D_HALF),D_HALF),width));
 out[3]=dCeil(dMul(dSub(D_ONE,dAdd(dMul(lowY,D_HALF),D_HALF)),height));
 return out;
}
/** The CPU's \`project\`: the pixel rectangle \`x0, y0, x1, y1\` of the box under \`e\`. */
fn waterProject(box:array<vec2u,6>,e:array<vec2u,16>)->array<vec2u,4>{
 var rect:array<vec2u,4>;
 rect[0]=dNan();
 projectNdc=waterEnclose(box,e);
 if(dIsNan(projectNdc[0])){return rect;}
 let p=waterCorners(box,e);
 if(dIsNan(p[0])){return rect;}
 let width=dFromU32(frame[FRAME_WIDTH]);
 let height=dFromU32(frame[FRAME_HEIGHT]);
 let dx=dAdd(dCeil(dAdd(dDiv(dMul(encloseError[0],width),D_TWO),dMul(D_ROUND,width))),D_ONE);
 let dy=dAdd(dCeil(dAdd(dDiv(dMul(encloseError[1],height),D_TWO),dMul(D_ROUND,height))),D_ONE);
 rect[0]=dMathMax(D_ZERO,dMathMin(dSub(width,D_ONE),dSub(p[0],dx)));
 rect[1]=dMathMax(D_ZERO,dMathMin(dSub(height,D_ONE),dSub(p[1],dy)));
 rect[2]=dMathMax(D_ONE,dMathMin(width,dAdd(p[2],dx)));
 rect[3]=dMathMax(D_ONE,dMathMin(height,dAdd(p[3],dy)));
 for(var k=0u;k<4u;k++){
  if(!dIsFinite(rect[k])){
   rect[0]=dNan();
   return rect;
  }
 }
 return rect;
}`,
)
