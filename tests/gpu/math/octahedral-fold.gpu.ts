// One octahedral map for every caller (`packages/math/src/wgsl/octahedral.ts`), one fold
// (`octFold`): on Dawn, the lobes' pack (`scene/physicalLobes.ts`), the shadow receiver's plane
// encode (`visibility/shader/receiverTargetWgsl.ts`) and the impostor card's direction to its grid
// and back (`visibility/shader/impostorWgsl.ts`) return, bit for bit, what each one's own formula
// returned before they shared it — kept below as `develop` wrote it. The decode is the packed
// page normals' (`cluster/decodeWgsl.ts`) and the compiler's `oct_decode`: the lower half folded
// per axis in one rounding, `1 − |other|` on its side. The lobes' unpack and the receiver's plane
// decode take it too: their lower half, which added `−z` to each axis in a second rounding, moves
// by at most `FEW_ULPS` per component against `develop`'s decode, and no component's 8-bit unorm
// moves (class 1). A million directions of every octant, on and off
// the axes, at lengths from 2^-8 to 2^7; a million lobe words; every 10-bit receiver cell and
// impostor frame. The zero vector, which no caller encodes, is left out. Straight down on the
// hemi-octahedron, where `develop` divided zero by zero, reads the zenith frame `(0, 0)`.
//
//   node bench/dawn/proofs.ts tests/gpu/math/octahedral-fold.gpu.ts
import test from 'node:test'
import assert from 'node:assert/strict'
import { computeOnDawn } from '../kit/computeRun.ts'
import { LOBE_PACK_WGSL } from '../../../packages/sdk-browser/src/scene/physicalLobes.ts'
import { wgslProgram } from '../../../packages/math/src/wgsl/assemble.ts'
import {
  octDecode,
  octDecodeHemi,
  octEncode,
  octEncodeHemi,
} from '../../../packages/math/src/wgsl/octahedral.ts'
import { hashUnit } from '../../../packages/math/src/wgsl/sampling.ts'

/** The codecs as `develop` wrote them, each its own fold; the decode folded per axis, as the
 *  compiler's `oct_decode` writes it. */
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
fn wasReceiverUnoct(p:vec2f)->vec3f{
 var n=vec3f(p,1.0-abs(p.x)-abs(p.y));
 let k=saturate(-n.z);
 n=vec3f(n.xy+select(vec2f(k),vec2f(-k),n.xy>=vec2f(0.0)),n.z);
 return normalize(n);
}
fn foldedPerAxis(e:vec2f)->vec3f{
 var x=e.x;var y=e.y;
 let z=1.0-abs(x)-abs(y);
 if(z<0.0){
  let fx=(1.0-abs(y))*select(-1.0,1.0,x>=0.0);let fy=(1.0-abs(x))*select(-1.0,1.0,y>=0.0);
  x=fx;y=fy;
 }
 return normalize(vec3f(x,y,z));
}
fn wasReceiverOct(n:vec3f)->vec2f{
 let p=n.xy/(abs(n.x)+abs(n.y)+abs(n.z));
 return select(p,(1.0-abs(p.yx))*select(vec2f(-1.0),vec2f(1.0),p>=vec2f(0.0)),n.z<0.0);
}
fn wasImpSide(x:f32)->f32{return select(1.0,-1.0,x<0.0);}
fn wasImpOctDecode(f:vec2f,hemi:f32)->vec3f{
 let hx=f.x-f.y;
 let hz=f.x+f.y-1.0;
 let hemiDir=normalize(vec3f(hx,1.0-abs(hx)-abs(hz),hz));
 let u=f*2.0-1.0;
 let y=1.0-abs(u.x)-abs(u.y);
 let folded=normalize(vec3f(wasImpSide(u.x)*(1.0-abs(u.y)),y,wasImpSide(u.y)*(1.0-abs(u.x))));
 let full=select(folded,normalize(vec3f(u.x,y,u.y)),y>=0.0);
 return select(full,hemiDir,hemi==1.0);
}
fn wasImpOctEncode(d:vec3f,hemi:f32)->vec2f{
 let o=d/(abs(d.x)+abs(d.y)+abs(d.z));
 let folded=vec2f(wasImpSide(o.x)*(1.0-abs(o.z)),wasImpSide(o.z)*(1.0-abs(o.x)));
 let full=select(o.xz,folded,o.y<0.0);
 let hd=vec3f(d.x,max(d.y,0.0),d.z);
 let ho=hd/(abs(hd.x)+max(hd.y,0.0)+abs(hd.z));
 return select(full,vec2f(ho.x+ho.z,ho.z-ho.x),hemi==1.0);
}`

const THREADS = 1 << 20

/** The most a decode's component may move, in ulps, against `develop`'s second rounding. */
const FEW_ULPS = 8

/** Per thread: a direction (one of the 26 axis and diagonal ones first, then hashed ones), a lobe
 *  word, a receiver cell; each codec's differing results counted in its own counter, then the lobe
 *  and receiver decodes against `develop`'s: the largest ulp distance of a component, and the
 *  count of normals whose 8-bit unorm moved. */
const SHADER = wgslProgram(
  `${DEVELOP_WGSL}
@group(0) @binding(0) var<storage,read_write> differ:array<atomic<u32>,12>;
fn same2(a:vec2f,b:vec2f)->bool{return all(bitcast<vec2u>(a)==bitcast<vec2u>(b));}
fn same3(a:vec3f,b:vec3f)->bool{return all(bitcast<vec3u>(a)==bitcast<vec3u>(b));}
fn tally(k:u32,same:bool){if(!same){atomicAdd(&differ[k],1u);}}
fn ordered(x:f32)->i32{let b=bitcast<i32>(x);return select(b,-(b&0x7fffffff),b<0);}
fn ulps(a:vec3f,b:vec3f)->u32{
 var m=0u;
 for(var c=0u;c<3u;c++){let d=ordered(a[c])-ordered(b[c]);m=max(m,u32(abs(d)));}
 return m;
}
fn unorm8(n:vec3f)->u32{return pack4x8unorm(vec4f(n*0.5+0.5,0.0));}
fn moved(k:u32,now:vec3f,was:vec3f){
 atomicMax(&differ[k],ulps(now,was));
 tally(k+2u,unorm8(now)==unorm8(was));
}
@compute @workgroup_size(64) fn main(@builtin(global_invocation_id) id:vec3u){
 let i=id.x;
 var v=vec3f(hashUnit(i*3u),hashUnit(i*3u+1u),hashUnit(i*3u+2u))*2.0-1.0;
 if(i<27u){v=vec3f(f32(i%3u),f32((i/3u)%3u),f32(i/9u))-1.0;}
 let word=select(i*2654435761u,reverseBits(i),(i&1u)==1u);
 let q=vec2f(f32(i&1023u),f32((i>>10u)&1023u))/1023.0*2.0-1.0;
 tally(4u,same3(lobeOctDecode(word),foldedPerAxis(unpack2x16snorm(word))));
 tally(5u,same3(octDecode(q),foldedPerAxis(q)));
 moved(8u,lobeOctDecode(word),wasLobeDecode(word));
 moved(9u,octDecode(q),wasReceiverUnoct(q));
 let f=q*0.5+0.5;
 tally(6u,same3(octDecodeHemi(f,0.0),wasImpOctDecode(f,0.0)));
 tally(7u,same3(octDecodeHemi(f,1.0),wasImpOctDecode(f,1.0)));
 if(i==13u){return;}
 let n=normalize(v);
 let plane=v*exp2(f32(i%16u)-8.0);
 tally(0u,lobeOctEncode(n)==wasLobeEncode(n));
 tally(1u,same2(octEncode(plane),wasReceiverOct(plane)));
 tally(2u,same2(octEncodeHemi(n,0.0),wasImpOctEncode(n,0.0)));
 let down=all(n.xz==vec2f(0.0))&&n.y<0.0;
 tally(3u,same2(octEncodeHemi(n,1.0),select(wasImpOctEncode(n,1.0),vec2f(0.0),down)));
}`,
  [hashUnit, LOBE_PACK_WGSL, octEncode, octDecode, octEncodeHemi, octDecodeHemi],
)

test('every octahedral caller returns, bit for bit, its own fold or the per-axis decode', async () => {
  const { values, errors } = await computeOnDawn(SHADER, 48, THREADS / 64, { words: 'u32' })
  assert.deepEqual(errors, [])
  const names = [
    'lobe encode',
    'receiver encode',
    'impostor encode, full',
    'impostor encode, hemi',
    'lobe decode',
    'receiver decode',
    'impostor decode, full',
    'impostor decode, hemi',
  ]
  assert.deepEqual(
    Object.fromEntries(names.map((name, k) => [name, values[k]])),
    Object.fromEntries(names.map((name) => [name, 0])),
  )
  const [lobeUlps, receiverUlps, lobeBytes, receiverBytes] = values.slice(8)
  assert.ok(lobeUlps <= FEW_ULPS, `lobe decode moved ${lobeUlps} ulps from develop's`)
  assert.ok(receiverUlps <= FEW_ULPS, `receiver decode moved ${receiverUlps} ulps from develop's`)
  assert.deepEqual({ lobe: lobeBytes, receiver: receiverBytes }, { lobe: 0, receiver: 0 })
})
