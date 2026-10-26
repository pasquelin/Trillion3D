// One octahedral map for every caller (`packages/math/src/wgsl/octahedral.ts`), one fold
// (`octFold`): on Dawn, the lobes' pack (`surface/physicalLobes.ts`) returns, bit for bit, what its
// own formula returned before it shared the map — kept below as `develop` wrote it. The decode is
// the packed page normals' (`cluster/decodeWgsl.ts`) and the compiler's `oct_decode`: the lower
// half folded per axis in one rounding, `1 − |other|` on its side. The lobes' unpack takes it too:
// its lower half, which added `−z` to each axis in a second rounding, moves by at most `ROUNDINGS`
// units of 2^-24 per component against `develop`'s decode, and no component's 8-bit unorm by more
// than one step (class 1). A million directions of every octant, on and off the axes, at lengths
// from 2^-8 to 2^7; a million lobe words. The zero vector, which no caller encodes, is left out.
//
//   node bench/dawn/proofs.ts tests/gpu/math/octahedral-fold.gpu.ts
import test from 'node:test'
import assert from 'node:assert/strict'
import { computeOnDawn } from '../../kit/device/computeRun.ts'
import { LOBE_PACK_WGSL } from '../../../packages/sdk-browser/src/materials/surface/physicalLobes.ts'
import { wgslProgram } from '../../../packages/math/src/wgsl/assemble.ts'
import { hashUnit } from '../../../packages/math/src/wgsl/sampling.ts'

/** The codec as `develop` wrote it, its own fold; the decode folded per axis, as the compiler's
 *  `oct_decode` writes it. */
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
fn foldedPerAxis(e:vec2f)->vec3f{
 var x=e.x;var y=e.y;
 let z=1.0-abs(x)-abs(y);
 if(z<0.0){
  let fx=(1.0-abs(y))*select(-1.0,1.0,x>=0.0);let fy=(1.0-abs(x))*select(-1.0,1.0,y>=0.0);
  x=fx;y=fy;
 }
 return normalize(vec3f(x,y,z));
}
}`

const THREADS = 1 << 20

/**
 * The most a decode's component may move against `develop`'s, in units of 2^-24 — half an ulp of
 * one, the most one rounding moves a value in [0.5, 1]: before normalizing, `develop`'s fold rounds
 * x and y three times where the per-axis fold rounds once (4 units apart at most, z the same);
 * normalizing a point of the octahedron, of length 1/√3 at least, scales that by √3 at most (10);
 * each decode's own `normalize` rounds a few units more. An absolute bound, never an ulp count of
 * the component: where the exact component is zero — `|e.y| = 1` —, the per-axis fold returns 0 and
 * `develop`'s a rounding's residue of either sign, millions of the component's own ulps apart.
 */
const ROUNDINGS = 32

/** Per thread: a direction (one of the 26 axis and diagonal ones first, then hashed ones) and a lobe
 *  word; the encode's and the decode's differing results counted in their own counters, then the
 *  decode against `develop`'s: the largest distance of a component in units of 2^-24, and the
 *  largest step of a component's 8-bit unorm. A component `develop` left exactly zero encodes
 *  127.5, a step's edge: a rounding's residue moves it by one. */
const SHADER = wgslProgram(
  `${DEVELOP_WGSL}
@group(0) @binding(0) var<storage,read_write> differ:array<atomic<u32>,4>;
fn same3(a:vec3f,b:vec3f)->bool{return all(bitcast<vec3u>(a)==bitcast<vec3u>(b));}
fn tally(k:u32,same:bool){if(!same){atomicAdd(&differ[k],1u);}}
fn apart(a:vec3f,b:vec3f)->u32{let d=abs(a-b);return u32(ceil(max(d.x,max(d.y,d.z))*exp2(24.0)));}
fn unorm8(n:vec3f)->vec3i{let w=pack4x8unorm(vec4f(n*0.5+0.5,0.0));return vec3i(vec3u(w,w>>8u,w>>16u)&vec3u(255u));}
fn moved(now:vec3f,was:vec3f){
 atomicMax(&differ[2u],apart(now,was));
 let step=abs(unorm8(now)-unorm8(was));
 atomicMax(&differ[3u],u32(max(step.x,max(step.y,step.z))));
}
@compute @workgroup_size(64) fn main(@builtin(global_invocation_id) id:vec3u){
 let i=id.x;
 var v=vec3f(hashUnit(i*3u),hashUnit(i*3u+1u),hashUnit(i*3u+2u))*2.0-1.0;
 if(i<27u){v=vec3f(f32(i%3u),f32((i/3u)%3u),f32(i/9u))-1.0;}
 let word=select(i*2654435761u,reverseBits(i),(i&1u)==1u);
 tally(1u,same3(lobeOctDecode(word),foldedPerAxis(unpack2x16snorm(word))));
 moved(lobeOctDecode(word),wasLobeDecode(word));
 if(i==13u){return;}
 let n=normalize(v);
 tally(0u,lobeOctEncode(n)==wasLobeEncode(n));
}`,
  [hashUnit, LOBE_PACK_WGSL],
)

test('the lobes’ pack returns, bit for bit, its own fold or the per-axis decode', async () => {
  const { values, errors } = await computeOnDawn(SHADER, 16, THREADS / 64, { words: 'u32' })
  assert.deepEqual(errors, [])
  const names = ['lobe encode', 'lobe decode']
  assert.deepEqual(
    Object.fromEntries(names.map((name, k) => [name, values[k]])),
    Object.fromEntries(names.map((name) => [name, 0])),
  )
  const [lobeApart, lobeStep] = values.slice(2)
  assert.ok(lobeApart <= ROUNDINGS, `lobe decode moved ${lobeApart} · 2^-24 from develop's`)
  assert.ok(lobeStep <= 1, 'an 8-bit unorm moves one step at most')
})
