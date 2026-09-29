import { SAMPLING_FOOTPRINT_WGSL } from '../../texture/samplingFootprint.ts';
import { SAMPLE_WRAP_SHIFT } from '../../texture/sampling.ts';
import { WRAP_S_MIRROR } from '../../visibility/wrapModes.ts';

/** The existing virtual-texture footprint rule, translated without changing its arithmetic. */
const types: Record<string, string> = {
  px: 'vec2',
  py: 'vec2',
  granted: 'uint',
  raw: 'float',
  taps: 'uint',
  axis: 'vec2',
  lx: 'float',
  ly: 'float',
  ratio: 'float',
  mag: 'bool',
  lod: 'float',
  nearest: 'bool',
};
const footprint = SAMPLING_FOOTPRINT_WGSL.replace(
  /\b(?:let|var) (\w+)=/g,
  (_, name: string) => `${types[name]} ${name}=`,
)
  .replace(
    /struct (\w+)\{([^}]+)\}/g,
    (_, name, body: string) => `struct ${name}{${body.replace(/(\w+):(\w+),/g, '$2 $1;')}};`,
  )
  .replace(
    /fn (\w+)\(([^)]*)\)->(\w+)\{/g,
    (_, name, args: string, result) =>
      `${result} ${name}(${args.replace(/(\w+):(\w+)/g, '$2 $1')}){`,
  )
  .replace(/var (\w+):(\w+)/g, '$2 $1')
  .replace(/\bvec2f\b/g, 'vec2')
  .replace(/\bf32\b/g, 'float')
  .replace(/\bu32\b/g, 'uint')
  .replace(/\bselect\(/g, 'footSelect(');

/** Four independent native-size data images in one array; padded texels are never sampled.
 * Exact integer wrapping is applied to each bilinear corner, including repeat seams. */
export const PHYSICAL_MAPS_GLSL = `
uniform highp sampler2DArray physicalMaps;
uniform ivec4 physicalMapInfo[4];
uniform mat3 physicalMapUv[4];
uniform ivec4 physicalMapChannels,physicalMapLayer;
struct TileSlot{vec2 size;uint sampling;uint last;};
float footSelect(float a,float b,bool c){return c?b:a;}
uint footSelect(uint a,uint b,bool c){return c?b:a;}
vec2 footSelect(vec2 a,vec2 b,bool c){return c?b:a;}
float atlasLod(vec2 x,vec2 y){return 0.5*log2(max(max(dot(x,x),dot(y,y)),1e-20))+mipBias;}
${footprint}
int physicalIndex(int p,int size,uint mode){
 if(mode==0u)return clamp(p,0,size-1);
 int period=mode==${WRAP_S_MIRROR}u?size*2:size;
 int q=((p%period)+period)%period;
 return mode==${WRAP_S_MIRROR}u&&q>=size?period-1-q:q;
}
vec4 physicalTexel(int image,ivec2 p,int level,ivec2 size,uint wrap){
 p=ivec2(physicalIndex(p.x,size.x,wrap&3u),physicalIndex(p.y,size.y,(wrap>>2u)&3u));
 return texelFetch(physicalMaps,ivec3(p,physicalMapLayer[image]),level);
}
vec4 physicalLevel(int image,vec2 uv,int level,bool nearest){
 ivec4 info=physicalMapInfo[image];ivec2 size=max(info.xy>>level,ivec2(1));
 uint wrap=uint(info.w)>>${SAMPLE_WRAP_SHIFT}u;
 vec2 p=uv*vec2(size);
 if(nearest)return physicalTexel(image,ivec2(floor(p)),level,size,wrap);
 vec2 center=p-0.5;ivec2 a=ivec2(floor(center));vec2 f=fract(center);
 return mix(mix(physicalTexel(image,a,level,size,wrap),physicalTexel(image,a+ivec2(1,0),level,size,wrap),f.x),
 mix(physicalTexel(image,a+ivec2(0,1),level,size,wrap),physicalTexel(image,a+ivec2(1),level,size,wrap),f.x),f.y);
}
vec4 physicalMap(int image){
 ivec4 info=physicalMapInfo[image];
 if(info.x==0)return vec4(1.0);
 vec2 uv=mapUv(physicalMapUv[image],sourceUv(physicalMapChannels[image]));
 TileSlot slot=TileSlot(vec2(info.xy),uint(info.w),uint(info.z));
 TileRead rule=tileRead(slot,uv,dFdx(uv),dFdy(uv),true);
 int low=int(floor(rule.lod)),high=min(low+1,info.z);
 vec4 sum=vec4(0.0);
 for(uint tap=0u;tap<rule.taps;tap++){
  vec2 at=uv+rule.axis*tapOffset(tap,rule.taps);
  vec4 value=physicalLevel(image,at,low,rule.nearest);
  if(high!=low&&fract(rule.lod)>0.0)value=mix(value,physicalLevel(image,at,high,rule.nearest),fract(rule.lod));
  sum+=value;
 }
 return sum/float(rule.taps);
}
`;
