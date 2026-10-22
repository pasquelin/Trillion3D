import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { ATMOSPHERE_SLOT } from '../../../../sdk-core/src/scene/core/atmospherePack.ts'
import { AERIAL_VOLUME, VIEW_SLOT } from './layout.ts'

const SIZE = `vec3f(${AERIAL_VOLUME.width}.0,${AERIAL_VOLUME.height}.0,${AERIAL_VOLUME.slices}.0)`

/**
 * What every surface reads of the haze (`aerialPerspective`): the light the air scatters into the
 * way to the point `P` seen from `eye`, and the transmittance — `(0, 0, 0, 1)` where there is no
 * air or the image has no volume. The cell is the point's pixel (the view-projection the volume was
 * built with, in the view's block) and its distance past the haze's start, by the slices' squared
 * spread; a surface nearer than the first slice, or than the start, is faded to no haze, both light
 * and transmittance. It reads the light buffer by `directLights`, as the fog does, so a program
 * that is fogged is hazed.
 */
export const HAZE_READ_WGSL = wgslBlock(
  'HAZE_READ_WGSL',
  [],
  `
fn hazeCell(cell:vec3i)->vec4f{
 let c=clamp(cell,vec3i(0),vec3i(${AERIAL_VOLUME.width - 1},${AERIAL_VOLUME.height - 1},${AERIAL_VOLUME.slices - 1}));
 let word=directLights.aerial[(u32(c.z)*${AERIAL_VOLUME.height}u+u32(c.y))*${AERIAL_VOLUME.width}u+u32(c.x)];
 let a=unpack2x16float(word.x);
 let b=unpack2x16float(word.y);
 return vec4f(a.x,a.y,b.x,b.y);
}
fn hazeAt(uvw:vec3f)->vec4f{
 let p=uvw*${SIZE}-0.5;
 let base=floor(p);
 let f=p-base;
 let c=vec3i(base);
 let near0=mix(mix(hazeCell(c),hazeCell(c+vec3i(1,0,0)),f.x),mix(hazeCell(c+vec3i(0,1,0)),hazeCell(c+vec3i(1,1,0)),f.x),f.y);
 let near1=mix(mix(hazeCell(c+vec3i(0,0,1)),hazeCell(c+vec3i(1,0,1)),f.x),mix(hazeCell(c+vec3i(0,1,1)),hazeCell(c+vec3i(1,1,1)),f.x),f.y);
 return mix(near0,near1,f.z);
}
fn aerialPerspective(P:vec3f,eye:vec3f)->vec4f{
 let none=vec4f(0.0,0.0,0.0,1.0);
 if(directLights.atmosphereView[${VIEW_SLOT.haze}].w==0.0){return none;}
 let clip=mat4x4f(directLights.atmosphereView[${VIEW_SLOT.projection}],directLights.atmosphereView[${VIEW_SLOT.projection + 1}],directLights.atmosphereView[${VIEW_SLOT.projection + 2}],directLights.atmosphereView[${VIEW_SLOT.projection + 3}])*vec4f(P,1.0);
 if(clip.w<=0.0){return none;}
 let uv=vec2f(clip.x/clip.w*0.5+0.5,0.5-clip.y/clip.w*0.5);
 let depth=max(0.0,length(P-eye)*0.001-directLights.atmosphere[${ATMOSPHERE_SLOT.scatteredFactor}].w);
 let w=min(sqrt(depth/${AERIAL_VOLUME.depthKm}.0),1.0);
 let slice=w*${AERIAL_VOLUME.slices}.0;
 var weight=select(1.0,saturate(slice*slice*2.0),slice<0.70710678);
 weight*=saturate(depth*100000.0);
 let haze=hazeAt(vec3f(uv,w));
 return vec4f(haze.rgb*weight,1.0-weight*(1.0-haze.a));
}
`,
)
