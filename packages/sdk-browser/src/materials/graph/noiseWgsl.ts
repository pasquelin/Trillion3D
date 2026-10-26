import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { wgslF32 } from '../../../../math/src/wgsl/number.ts'
import { rand3dPcg16 } from '../../../../math/src/wgsl/sampling.ts'

/** The twelve directions of the edges' midpoints of a cube: no component, or one, is 0, the others ±1. */
const EDGES = [
  [0, 1, 1],
  [1, 0, 1],
  [1, 1, 0],
  [0, 1, -1],
  [1, 0, -1],
  [1, -1, 0],
  [0, -1, 1],
  [-1, 0, 1],
  [-1, 1, 0],
  [0, -1, -1],
  [-1, 0, -1],
  [-1, -1, 0],
]

/** A table of the edge directions, `middle` the value of the component that is 0. */
const table = (name: string, middle: number) =>
  `var<private> ${name}:array<vec3f,12>=array<vec3f,12>(${EDGES.map(
    (edge) => `vec3f(${edge.map((c) => wgslF32(c === 0 ? middle : c)).join(',')})`,
  ).join(',')});`

/** The component of a direction a byte of 136 over 255 stands for in a map held between -1 and 1: the
 *  table of the maps' directions has it where the table of the volume's has exactly 0. */
const MAP_MIDDLE = Math.fround(Math.fround(136 / 255) * 2 - 1)

/** The bits of the stream position of a texel's direction: the map's last texel is the 16384th value
 *  of the stream, the volume's the 3375th. */
const MAP_STREAM_BITS = 15,
  VOLUME_STREAM_BITS = 12
const STREAM_BITS = Math.max(MAP_STREAM_BITS, VOLUME_STREAM_BITS)

/** The step of the linear congruential stream `s' = 196314165·s + 907633515` taken 2^i times at once,
 *  `s'' = mul·s + add` in 32 bits, for each `i` below `STREAM_BITS`: the n-th value of the stream is
 *  found by composing the steps of the set bits of n (`mgNoiseDraw`). */
const STREAM_STEPS = (() => {
  const steps: { mul: number; add: number }[] = []
  let mul = 196314165,
    add = 907633515
  for (let i = 0; i < STREAM_BITS; i++) {
    steps.push({ mul, add })
    add = (Math.imul(mul, add) + add) >>> 0
    mul = Math.imul(mul, mul) >>> 0
  }
  return steps
})()

/** One of the steps' words as a private table. */
const steps = (name: string, word: 'mul' | 'add') =>
  `var<private> ${name}:array<u32,${STREAM_BITS}>=array<u32,${STREAM_BITS}>(${STREAM_STEPS.map((step) => `${step[word]}u`).join(',')});`

/**
 * THE NOISE FUNCTIONS of a `noise` node, six of them, each from -1 to 1, and the sum of their levels
 * (`mgNoise`). Four are made of a lattice of points whose values are hashed (`rand3dPcg16`, a
 * multiply-add step and six rounds of multiplications of the three coordinates, the top sixteen bits
 * kept): a gradient noise (`mgNoiseGradientAlu`, the three bits of the hash choosing the signs of a
 * direction) and a value noise (`mgNoiseValueAlu`, a residue of a square) over a cubic lattice, a
 * distance to the nearest jittered point (`mgNoiseVoronoi`, 8, 16, 27 or 32 cells searched), and a
 * gradient noise over the tetrahedra of a skewed lattice (`mgNoiseSimplex`). The other two read a
 * lattice's directions from a picture the engine does not hold: a map of 128 by 128 directions, the
 * lattice laid on it with a shear of 17 and 89 for each step of the third coordinate
 * (`mgNoiseGradientTex`, `mgNoiseSimplex`), and a volume of 15 cubed directions that repeats
 * (`mgNoiseFast`). Each direction is a choice among the twelve edges by a value of a linear
 * congruential stream (`mgNoiseDraw`, the stream's n-th value found by composing the steps of its set
 * bits) that fills the
 * picture in reading order, so a texel is found without the picture.
 */
export const NOISE_WGSL = wgslBlock(
  'MG_NOISE_WGSL',
  [rand3dPcg16],
  `${table('mgNoiseMapEdges', MAP_MIDDLE)}
${table('mgNoiseVolumeEdges', 0)}
${steps('mgNoiseStepMul', 'mul')}
${steps('mgNoiseStepAdd', 'add')}
const MG_NOISE_PRIMES=vec3f(19.0,47.0,101.0);
const MG_NOISE_SHEAR=vec2f(17.0,89.0);
fn mgNoiseRamp(t:vec3f)->vec3f{return t*t*t*(t*(t*6.0-15.0)+10.0);}
fn mgNoiseWrap(v:vec3f,tiling:bool,repeat:f32)->vec3f{return select(v,fract(v/repeat)*repeat,tiling);}
fn mgNoiseCorner(k:i32)->vec3f{return vec3f(f32(k&1),f32((k>>1)&1),f32(k>>2));}
fn mgNoiseBlend(c:array<f32,8>,w:vec3f)->f32{
 let i=mix(mix(c[0],c[1],w.x),mix(c[2],c[3],w.x),w.y);
 let j=mix(mix(c[4],c[5],w.x),mix(c[6],c[7],w.x),w.y);
 return mix(i,j,w.z);
}
fn mgNoiseSeed(iv:vec3f,o:vec3f,tiling:bool,repeat:f32)->f32{
 let wrapped=dot(MG_NOISE_PRIMES,mgNoiseWrap(iv+o,true,repeat));
 let plain=dot(iv,MG_NOISE_PRIMES)+o.x*19.0+o.y*47.0+o.z*101.0;
 return select(plain,wrapped,tiling);
}
fn mgNoiseGradientAlu(v:vec3f,tiling:bool,repeat:f32)->f32{
 let fv=fract(v);let iv=floor(v);
 var c:array<f32,8>;
 for(var k=0;k<8;k++){
  let o=mgNoiseCorner(k);
  let bits=rand3dPcg16(vec3i(i32(mgNoiseSeed(iv,o,tiling,repeat)),0,0)).x;
  let dir=vec3f(f32(bits&0x8000u),f32(bits&0x4000u),f32(bits&0x2000u))*vec3f(1.0/16384.0,1.0/8192.0,1.0/4096.0)-1.0;
  c[k]=dot(dir,fv-o);
 }
 return mgNoiseBlend(c,mgNoiseRamp(fv));
}
fn mgNoiseResidue(seed:f32)->f32{
 var s=fract(seed/4093.0);
 s=fract(s*s*4093.0);
 return fract(s*s*4093.0);
}
fn mgNoiseValueAlu(v:vec3f,tiling:bool,repeat:f32)->f32{
 let fv=fract(v);let iv=floor(v);
 var c:array<f32,8>;
 for(var k=0;k<8;k++){c[k]=mgNoiseResidue(mgNoiseSeed(iv,mgNoiseCorner(k),tiling,repeat))*2.0-1.0;}
 return mgNoiseBlend(c,mgNoiseRamp(fv));
}
fn mgNoiseDraw(n:u32,seed:u32,bits:i32)->u32{
 var a=1u;var c=0u;
 for(var i=0;i<bits;i++){
  if(((n>>u32(i))&1u)==1u){c=mgNoiseStepMul[i]*c+mgNoiseStepAdd[i];a=mgNoiseStepMul[i]*a;}
 }
 let m=(a*seed+c)>>9u;
 return u32(f32(m)*(1.0/8388608.0)*12.0);
}
fn mgNoiseMap(at:vec2f)->vec3f{
 let t=vec2i(floor(at+0.5))&vec2i(127);
 return mgNoiseMapEdges[mgNoiseDraw(u32((t.y<<7u)|t.x)+1u,12345u,${MAP_STREAM_BITS})];
}
fn mgNoiseGradientTex(v:vec3f,repeat:f32)->f32{
 let fv=fract(v);
 let i0=mgNoiseWrap(floor(v),true,repeat);
 let i1=mgNoiseWrap(i0+1.0,true,repeat);
 var c:array<f32,8>;
 for(var k=0;k<8;k++){
  let o=mgNoiseCorner(k);
  let lattice=select(i0.xy,i1.xy,o.xy>vec2f(0.5));
  let layer=select(i0.z,i1.z,o.z>0.5);
  c[k]=dot(mgNoiseMap(lattice+layer*MG_NOISE_SHEAR),fv-o);
 }
 return mgNoiseBlend(c,mgNoiseRamp(fract(fv)));
}
fn mgNoiseSimplex(p:vec3f)->f32{
 let skewed=p+vec3f(dot(p,vec3f(1.0/3.0)));
 let base=floor(skewed);let local=skewed-base;
 let high=max(local.x,max(local.y,local.z));let low=min(local.x,min(local.y,local.z));
 let corners=array<vec3f,4>(
  base,base+vec3f(1.0),
  base+select(vec3f(0.0),vec3f(1.0),local==vec3f(high)),
  base+select(vec3f(0.0),vec3f(1.0),local!=vec3f(low)));
 var sum=0.0;
 for(var k=0;k<4;k++){
  let q=corners[k];
  let d=p-(q-vec3f(dot(q,vec3f(1.0/6.0))));
  var w=saturate(0.6-dot(d,d));
  w=w*w;w=w*w;
  sum+=dot(mgNoiseMap(q.xy+q.z*MG_NOISE_SHEAR),d)*w;
 }
 return 32.0*sum;
}
fn mgNoiseVolume(c:vec3i)->vec4f{
 let s=c%vec3i(15);
 let g=mgNoiseVolumeEdges[mgNoiseDraw(u32(s.x+s.y*15+s.z*225)+1u,4660u,${VOLUME_STREAM_BITS})];
 return vec4f(g,dot(g,vec3f(c)));
}
fn mgNoiseFast(p:vec3f)->f32{
 let at=fract(p/15.0)*15.0;
 let u=fract(at);let whole=at-u;let f=mgNoiseRamp(u);
 var sum=vec4f(0.0);
 for(var k=0;k<8;k++){
  let o=mgNoiseCorner(k);
  let w=select(1.0-f,f,o>vec3f(0.5));
  sum+=mgNoiseVolume(vec3i(whole)+vec3i(o))*(w.x*w.y*w.z);
 }
 return dot(at,sum.xyz)-sum.w;
}
fn mgNoiseJitter(cell:vec3f,quality:i32)->vec3f{
 let r=vec3f(rand3dPcg16(vec3i(cell)))/65535.0-0.5;
 if(quality<=2){return normalize(r)*0.2588;}
 if(quality==3){return normalize(r)*0.3090;}
 return r;
}
fn mgNoiseNearest(best:f32,cell:vec3f,o:vec3f,at:vec3f,quality:i32)->f32{
 let d=at-(o+mgNoiseJitter(cell,quality));
 return min(best,dot(d,d));
}
fn mgNoiseVoronoi(v:vec3f,quality:i32,tiling:bool,repeat:f32)->f32{
 let fv=fract(v);let fv2=fract(v+0.5);let iv=floor(v);let iv2=floor(v+0.5);
 var best=100.0;
 if(quality==3){
  for(var k=0;k<27;k++){
   let o=vec3f(f32(k%3-1),f32((k/3)%3-1),f32(k/9-1));
   best=mgNoiseNearest(best,mgNoiseWrap(iv2+o,tiling,repeat),o,fv2,quality);
  }
 }else{
  for(var k=0;k<8;k++){
   let o=mgNoiseCorner(k);
   best=mgNoiseNearest(best,mgNoiseWrap(iv+o,tiling,repeat),o,fv,quality);
   if(quality==2){best=mgNoiseNearest(best,mgNoiseWrap(iv2+o,tiling,repeat)+467.0,o,fv2,quality);}
  }
 }
 if(quality>=4){
  for(var k=0;k<8;k++){
   let o=vec3f(select(-1.0,2.0,(k&1)==1),f32((k>>1)&1),f32(k>>2));
   best=mgNoiseNearest(best,mgNoiseWrap(iv+o,tiling,repeat),o,fv,quality);
   best=mgNoiseNearest(best,mgNoiseWrap(iv+o.yzx,tiling,repeat),o.yzx,fv,quality);
   best=mgNoiseNearest(best,mgNoiseWrap(iv+o.zxy,tiling,repeat),o.zxy,fv,quality);
  }
 }
 return sqrt(best)*2.0-1.0;
}
fn mgNoiseOne(kind:i32,p:vec3f,quality:i32,tiling:bool,repeat:f32)->f32{
 if(kind==0){return mgNoiseSimplex(p);}
 if(kind==1){return mgNoiseGradientTex(p,repeat);}
 if(kind==2){return mgNoiseFast(p);}
 if(kind==3){return mgNoiseGradientAlu(p,tiling,repeat);}
 if(kind==4){return mgNoiseValueAlu(p,tiling,repeat);}
 return mgNoiseVoronoi(p,quality,tiling,repeat);
}
fn mgNoise(position:vec3f,scale:f32,quality:i32,kind:i32,turbulence:bool,levels:i32,low:f32,high:f32,levelScale:f32,filterWidth:f32,tiling:bool,repeatSize:f32)->f32{
 var p=position*scale;var width=filterWidth*scale;
 var sum=0.0;var weight=1.0;var repeat=repeatSize;
 for(var i=0;i<levels;i++){
  weight*=saturate(1.0-width);
  let n=mgNoiseOne(kind,p,quality,tiling,repeat);
  sum+=select(n,abs(n),turbulence)*weight;
  p*=levelScale;repeat*=levelScale;weight*=1.0/levelScale;width*=levelScale;
 }
 if(!turbulence){sum=sum*0.5+0.5;}
 return low+(high-low)*sum;
}`,
)
