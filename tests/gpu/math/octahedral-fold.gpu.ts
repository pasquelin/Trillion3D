// One octahedral map for every caller (`packages/math/src/wgsl/octahedral.ts`), class 1: on Dawn,
// the lobes' pack and unpack (`scene/physicalLobes.ts`), the shadow receiver's plane both ways
// (`visibility/shader/receiverTargetWgsl.ts`) and the impostor card's direction to its grid
// (`visibility/shader/impostorWgsl.ts`) return, bit for bit, what each one's own formula returned
// before they shared it — kept below as `develop` wrote it. A million directions of every octant,
// on and off the axes, at lengths from 2^-8 to 2^7; a million lobe words; every 10-bit receiver
// cell. The zero vector, which no caller encodes, is left out.
//
//   node bench/dawn/proofs.ts tests/gpu/math/octahedral-fold.gpu.ts
import test from 'node:test'
import assert from 'node:assert/strict'
import { computeOnDawn } from '../kit/computeRun.ts'
import { LOBE_PACK_WGSL } from '../../../packages/sdk-browser/src/scene/physicalLobes.ts'
import { wgslProgram } from '../../../packages/math/src/wgsl/assemble.ts'
import { octDecode, octEncode, octEncodeHemi } from '../../../packages/math/src/wgsl/octahedral.ts'
import { hashUnit } from '../../../packages/math/src/wgsl/sampling.ts'

/** The four codecs as `develop` wrote them, each its own fold. */
const DEVELOP_WGSL = `fn wasLobeEncode(n:vec3f)->u32{
 let p=n.xy/(abs(n.x)+abs(n.y)+abs(n.z));
 let s=select(vec2f(-1.0),vec2f(1.0),p>=vec2f(0.0));
 return pack2x16snorm(select((1.0-abs(p.yx))*s,p,n.z>=0.0));
}
fn wasLobeDecode(word:u32)->vec3f{
 let e=unpack2x16snorm(word);
 var n=vec3f(e,1.0-abs(e.x)-abs(e.y));
 let t=max(-n.z,0.0);
 n=vec3f(n.xy+select(vec2f(t),vec2f(-t),n.xy>=vec2f(0.0)),n.z);
 return normalize(n);
}
fn wasReceiverOct(n:vec3f)->vec2f{
 let p=n.xy/(abs(n.x)+abs(n.y)+abs(n.z));
 return select(p,(1.0-abs(p.yx))*select(vec2f(-1.0),vec2f(1.0),p>=vec2f(0.0)),n.z<0.0);
}
fn wasReceiverUnoct(p:vec2f)->vec3f{
 var n=vec3f(p,1.0-abs(p.x)-abs(p.y));
 let k=saturate(-n.z);
 n=vec3f(n.xy+select(vec2f(k),vec2f(-k),n.xy>=vec2f(0.0)),n.z);
 return normalize(n);
}
fn wasImpSide(x:f32)->f32{return select(1.0,-1.0,x<0.0);}
fn wasImpOctEncode(d:vec3f,hemi:f32)->vec2f{
 let o=d/(abs(d.x)+abs(d.y)+abs(d.z));
 let folded=vec2f(wasImpSide(o.x)*(1.0-abs(o.z)),wasImpSide(o.z)*(1.0-abs(o.x)));
 let full=select(o.xz,folded,o.y<0.0);
 let hd=vec3f(d.x,max(d.y,0.0),d.z);
 let ho=hd/(abs(hd.x)+max(hd.y,0.0)+abs(hd.z));
 return select(full,vec2f(ho.x+ho.z,ho.z-ho.x),hemi==1.0);
}`

const THREADS = 1 << 20

/** Per thread: a direction (one of the 26 axis and diagonal ones first, then hashed ones), a lobe
 *  word, a receiver cell; each codec's differing results counted in its own counter. */
const SHADER = wgslProgram(
  `${DEVELOP_WGSL}
@group(0) @binding(0) var<storage,read_write> differ:array<atomic<u32>,6>;
fn same2(a:vec2f,b:vec2f)->bool{return all(bitcast<vec2u>(a)==bitcast<vec2u>(b));}
fn same3(a:vec3f,b:vec3f)->bool{return all(bitcast<vec3u>(a)==bitcast<vec3u>(b));}
fn tally(k:u32,same:bool){if(!same){atomicAdd(&differ[k],1u);}}
@compute @workgroup_size(64) fn main(@builtin(global_invocation_id) id:vec3u){
 let i=id.x;
 var v=vec3f(hashUnit(i*3u),hashUnit(i*3u+1u),hashUnit(i*3u+2u))*2.0-1.0;
 if(i<27u){v=vec3f(f32(i%3u),f32((i/3u)%3u),f32(i/9u))-1.0;}
 let word=select(i*2654435761u,reverseBits(i),(i&1u)==1u);
 let q=vec2f(f32(i&1023u),f32((i>>10u)&1023u))/1023.0*2.0-1.0;
 tally(4u,same3(lobeOctDecode(word),wasLobeDecode(word)));
 tally(5u,same3(octDecode(q),wasReceiverUnoct(q)));
 if(i==13u){return;}
 let n=normalize(v);
 let plane=v*exp2(f32(i%16u)-8.0);
 tally(0u,lobeOctEncode(n)==wasLobeEncode(n));
 tally(1u,same2(octEncode(plane),wasReceiverOct(plane)));
 tally(2u,same2(octEncodeHemi(n,0.0),wasImpOctEncode(n,0.0)));
 tally(3u,same2(octEncodeHemi(n,1.0),wasImpOctEncode(n,1.0)));
}`,
  [hashUnit, LOBE_PACK_WGSL, octEncode, octDecode, octEncodeHemi],
)

test('every octahedral caller returns, bit for bit, what its own fold returned', async () => {
  const { values, errors } = await computeOnDawn(SHADER, 24, THREADS / 64, { words: 'u32' })
  assert.deepEqual(errors, [])
  const names = [
    'lobe encode',
    'receiver encode',
    'impostor encode, full',
    'impostor encode, hemi',
    'lobe decode',
    'receiver decode',
  ]
  assert.deepEqual(
    Object.fromEntries(names.map((name, k) => [name, values[k]])),
    Object.fromEntries(names.map((name) => [name, 0])),
  )
})
