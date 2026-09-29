import {
  SAMPLE_ANISOTROPY_SHIFT,
  SAMPLE_MAG_HALF,
  SAMPLE_MAG_NEAREST,
  SAMPLE_MIN_NEAREST,
  SAMPLE_MIP_NEAREST,
  SAMPLE_MIP_NONE,
} from './sampling.ts';

/** Shared footprint, mip selection and bounded anisotropic tap rule of both texture backends. */
const ANISOTROPY_SLACK = 0.01;
export const SAMPLING_FOOTPRINT_WGSL = `struct TileRead{uv:vec2f,axis:vec2f,lod:f32,taps:u32,nearest:bool,}
fn tapOffset(i:u32,n:u32)->f32{return (f32(i)+0.5)/f32(n)-0.5;}
/**
 * How a footprint reads a texture with a filter word, its coordinate and derivatives already
 * transformed. The level is the GPU's — the log of the longer gradient —; with \`aniso\`, the
 * hardware rule (EXT_texture_filter_anisotropic): N taps, the elongation rounded up within the
 * grant, at log2(Pmax / N). It is clamped to the texture's levels, then
 * rounded (\`nearest\` mip) or pinned to 0 (no mip). Magnification — a level at or under GL's
 * threshold, 0.5 with \`SAMPLE_MAG_HALF\`, 0 otherwise — reads level 0 with the magnification
 * filter, anything else the minification one: decided on that lowered level, as the spec does.
 */
fn tileRead(s:TileSlot,uv:vec2f,ddx:vec2f,ddy:vec2f,aniso:bool)->TileRead{
 let px=ddx*s.size;let py=ddy*s.size;
 let granted=((s.sampling>>${SAMPLE_ANISOTROPY_SHIFT}u)&15u)+1u;
 var raw=atlasLod(px,py);
 var taps=1u;var axis=vec2f(0.0);
 if(aniso&&granted>1u){
  let lx=dot(px,px);let ly=dot(py,py);
  let ratio=min(sqrt(max(lx,ly)/max(min(lx,ly),1e-20)),f32(granted));
  taps=select(1u,u32(ceil(ratio-${ANISOTROPY_SLACK})),ratio>${1 + ANISOTROPY_SLACK});
  raw-=log2(f32(taps));
  axis=select(vec2f(0.0),select(ddy,ddx,lx>=ly),taps>1u);
 }
 let mag=raw<=select(0.0,0.5,(s.sampling&${SAMPLE_MAG_HALF}u)!=0u);
 var lod=clamp(raw,0.0,f32(s.last));
 if(mag||(s.sampling&${SAMPLE_MIP_NONE}u)!=0u){lod=0.0;}
 else if((s.sampling&${SAMPLE_MIP_NEAREST}u)!=0u){lod=floor(lod+0.5);}
 let nearest=(s.sampling&select(${SAMPLE_MIN_NEAREST}u,${SAMPLE_MAG_NEAREST}u,mag))!=0u;
 return TileRead(uv,axis,lod,taps,nearest);
}
`;
