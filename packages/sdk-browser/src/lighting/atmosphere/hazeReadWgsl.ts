import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { ATMOSPHERE_SLOT } from '../../../../sdk-core/src/scene/core/atmospherePack.ts'
import { VIEW_SLOT } from './layout.ts'

/** The words of a cell as four numbers: two half floats a word, or a 32-bit float each. */
export const HAZE_UNPACK_WGSL = wgslBlock(
  'HAZE_UNPACK_WGSL',
  [],
  `
fn hazeUnpack(a:vec2u,b:vec2u,full:bool)->vec4f{
 if(full){return vec4f(bitcast<f32>(a.x),bitcast<f32>(a.y),bitcast<f32>(b.x),bitcast<f32>(b.y));}
 let x=unpack2x16float(a.x);
 let y=unpack2x16float(a.y);
 return vec4f(x.x,x.y,y.x,y.y);
}`,
)

/**
 * The trilinear read of a volume of the haze, named `name`, whose cell `index` is the function
 * `name`Words(index, full)'s: `nameAt(uvw, size, full)`, the cells around the point blended, the
 * cells beyond the volume's edges taken as its edge's.
 */
export const hazeReadFunctions = (name: string) => `
fn ${name}Cell(cell:vec3i,size:vec3f,full:bool)->vec4f{
 let c=clamp(cell,vec3i(0),vec3i(size)-vec3i(1));
 return ${name}Words((u32(c.z)*u32(size.y)+u32(c.y))*u32(size.x)+u32(c.x),full);
}
fn ${name}At(uvw:vec3f,size:vec3f,full:bool)->vec4f{
 let p=uvw*size-0.5;
 let base=floor(p);
 let f=p-base;
 let c=vec3i(base);
 let near0=mix(mix(${name}Cell(c,size,full),${name}Cell(c+vec3i(1,0,0),size,full),f.x),mix(${name}Cell(c+vec3i(0,1,0),size,full),${name}Cell(c+vec3i(1,1,0),size,full),f.x),f.y);
 let near1=mix(mix(${name}Cell(c+vec3i(0,0,1),size,full),${name}Cell(c+vec3i(1,0,1),size,full),f.x),mix(${name}Cell(c+vec3i(0,1,1),size,full),${name}Cell(c+vec3i(1,1,1),size,full),f.x),f.y);
 return mix(near0,near1,f.z);
}`

/** The weight a volume's cell at `depth` kilometres past the haze's start is read with, and the
 *  coordinate along its depth: the slices' squared spread, faded in over the first half slice and
 *  over `fadeInv`'s reciprocal distance. */
export const HAZE_WEIGHT_WGSL = wgslBlock(
  'HAZE_WEIGHT_WGSL',
  [],
  `
fn hazeWeight(depth:f32,volume:vec4f,fadeInv:f32)->vec2f{
 let w=min(sqrt(depth/volume.w),1.0);
 let slice=w*volume.z;
 var weight=select(1.0,saturate(slice*slice*2.0),slice<0.70710678);
 weight*=saturate(depth*fadeInv);
 return vec2f(w,weight);
}`,
)

/**
 * The function `name`(P, eye, ...) that reads a volume of the haze with the reader `reader`
 * (`hazeReadFunctions`): the volume's cell for the point `P` seen from `eye` — its pixel, by the
 * view-projection the volume was built with, and its distance past `start` —, light and
 * transmittance faded in over `fade`'s reciprocal distance. `extra` declares more parameters the
 * expressions `start` and `fade` read; `validity` says whether the volume was built.
 */
export const viewHazeFunction = (spec: {
  name: string
  reader: string
  extra?: string
  start: string
  fade: string
  validity: string
}) => `
fn ${spec.name}(P:vec3f,eye:vec3f${spec.extra ?? ''})->vec4f{
 let none=vec4f(0.0,0.0,0.0,1.0);
 if(${spec.validity}){return none;}
 let clip=mat4x4f(directLights.atmosphereView[${VIEW_SLOT.projection}],directLights.atmosphereView[${VIEW_SLOT.projection + 1}],directLights.atmosphereView[${VIEW_SLOT.projection + 2}],directLights.atmosphereView[${VIEW_SLOT.projection + 3}])*vec4f(P,1.0);
 if(clip.w<=0.0){return none;}
 let uv=vec2f(clip.x/clip.w*0.5+0.5,0.5-clip.y/clip.w*0.5);
 let volume=directLights.atmosphereView[${VIEW_SLOT.volume}];
 let flags=directLights.atmosphereView[${VIEW_SLOT.flags}];
 let depth=max(0.0,length(P-eye)*0.001-(${spec.start}));
 if(flags.y!=0.0&&depth<=0.0){return none;}
 let at=hazeWeight(depth,volume,${spec.fade});
 let haze=${spec.reader}At(vec3f(uv,at.x),volume.xyz,flags.x!=0.0);
 return vec4f(haze.rgb*at.y,1.0-at.y*(1.0-haze.a));
}`

/**
 * What every surface reads of the haze (`aerialPerspective`): the light the air scatters into the
 * way to the point `P` seen from `eye`, and the transmittance — `(0, 0, 0, 1)` where there is no
 * air or the image has no volume. The cell is the point's pixel (the view-projection the volume was
 * built with, in the view's block) and its distance past the haze's start, by the slices' squared
 * spread; a surface nearer than the first slice, or than the start, is faded to no haze, both light
 * and transmittance. It reads the light buffer by `directLights`, as the fog does, so a program
 * that is fogged is hazed.
 *
 * The volume's size, its length and the way its cells are packed are the view block's
 * (`VIEW_SLOT.volume`, `VIEW_SLOT.flags`), written with the volume: the programs that read it are
 * written once, whatever the quality settings made of the volume. A surface at or before the haze's
 * start skips the read where the settings ask it (`aerialDepthTest`), which changes nothing it
 * would have read, the weight being nought there.
 */
export const HAZE_READ_WGSL = wgslBlock(
  'HAZE_READ_WGSL',
  [HAZE_UNPACK_WGSL, HAZE_WEIGHT_WGSL],
  `
/** Whether the haze on the opaque surfaces is marched for each pixel (\`opaqueHazeProgram\`), not read
 *  from the volume: the surfaces' resolve then lays none (\`foggedOpaque\`). */
fn opaqueHazeMarched()->bool{return directLights.atmosphereView[${VIEW_SLOT.flags}].w!=0.0;}
fn hazeWords(index:u32,full:bool)->vec4f{
 let at=select(index,index*2u,full);
 return hazeUnpack(directLights.aerial[at],directLights.aerial[select(at,at+1u,full)],full);
}${hazeReadFunctions('haze')}${viewHazeFunction({
    name: 'aerialPerspective',
    reader: 'haze',
    start: `directLights.atmosphere[${ATMOSPHERE_SLOT.scatteredFactor}].w`,
    fade: '100000.0',
    validity: `directLights.atmosphereView[${VIEW_SLOT.haze}].w==0.0`,
  })}
`,
)
