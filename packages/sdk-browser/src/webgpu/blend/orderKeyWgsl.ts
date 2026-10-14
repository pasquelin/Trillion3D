import { KEYED_WGSL } from './keyLayout.ts'
import { FRAME_HEAD_WGSL } from './frameHead.ts'
import { dAdd, dMul, dSub } from '../../../../math/src/wgsl/double.ts'
import { NO_INDEX } from '../../../../math/src/wgsl/constants.ts'
import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'

/**
 * The paint order's keys and rule as the order kernel ranks its entries (`orderWgsl.ts`): an item's
 * key in emulated doubles, the CPU's to the bit, and which of two entries paints first. Declared
 * over the kernel's `keyed` and `frame` buffers and its `uni`, as `KEYED_WGSL` is.
 */
export const ORDER_KEY_WGSL = wgslBlock(
  'ORDER_KEY_WGSL',
  [dAdd, dSub, dMul, NO_INDEX, KEYED_WGSL, FRAME_HEAD_WGSL],
  `/** One axis of the eye-to-box-centre gap: each bound brought to the eye, then the two averaged. */
fn boxAxis(low:vec2u,high:vec2u,eye:vec2u)->vec2u{return dMul(dAdd(dSub(low,eye),dSub(high,eye)),vec2u(0x3fe00000u,0u));}
/**
 * An item's key, as \`eyeKey\` computes it on the CPU (\`order.ts\`): the square of the distance from
 * the eye to its world box centre, its world origin without a box. An own item's key is the one the
 * CPU ordered it with.
 */
fn itemKey(item:u32)->vec2u{
 let at=item*KEY_RECORD_WORDS;
 let own=keyed[at+KEY_OWN];
 if(own!=NO_INDEX){return frameDouble(uni.ownKeyBase+own*2u);}
 let ex=frameDouble(0u);
 let ey=frameDouble(2u);
 let ez=frameDouble(4u);
 var x=vec2u(0u,0u);
 var y=vec2u(0u,0u);
 var z=vec2u(0u,0u);
 if((keyed[at+KEY_FLAGS]&KEY_HAS_BOX)!=0u){
  x=boxAxis(keyedDouble(at),keyedDouble(at+6u),ex);
  y=boxAxis(keyedDouble(at+2u),keyedDouble(at+8u),ey);
  z=boxAxis(keyedDouble(at+4u),keyedDouble(at+10u),ez);
 }else{
  x=dSub(keyedDouble(at),ex);
  y=dSub(keyedDouble(at+2u),ey);
  z=dSub(keyedDouble(at+4u),ez);
 }
 return dAdd(dAdd(dMul(x,x),dMul(y,y)),dMul(z,z));
}
/** Whether \`a\` paints before \`b\`: the farther key, then the lower seed. */
fn goesFirst(a:vec4u,b:vec4u)->bool{
 if(a.x!=b.x){return a.x>b.x;}
 if(a.y!=b.y){return a.y>b.y;}
 return a.z<b.z;
}
`,
)
