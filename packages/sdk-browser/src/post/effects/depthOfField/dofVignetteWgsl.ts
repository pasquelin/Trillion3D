import { wgslBlock } from '../../../../../math/src/wgsl/decl.ts'
import { DOF_PARAMS_WGSL } from './dofCommonWgsl.ts'

/**
 * The lens barrel and the matte box, which occlude a bokeh at the edge of the image (cat's eye) and
 * the panels in front of it: a bokeh's aperture is projected onto the barrel's far end, once per
 * sprite group, and each of its pixels is tested against it (`dofScatterWgsl.ts`).
 * - `projectCylinder`: for a bokeh of radius `coc` centred at clip position `clip`, the centre of its
 *   aperture on the barrel's end and the scale from a pixel's offset to it, as a packed pair —
 *   the centre as two half floats, the scale as a float;
 * - `projectFlag`: a matte box flag's edge on the barrel's end along the object's direction, as two
 *   packed pairs of half floats: a point of it and its direction;
 * - `vignetteData`: both, for the sprite group at texel `texel` of the setup accumulation (its place in
 *   the gather's texels, `circleRatio`) and a circle `coc` in the gather's texels: the two `vec4u` the
 *   draw list keeps, the barrel then the three flags;
 * - `hitCylinder`: a pixel's place on the barrel's end and its visibility through the barrel (0 to 1,
 *   the edge soft); `hitFlag`: its visibility past a flag (a sharp ramp of 128).
 */
export const DOF_VIGNETTE_WGSL = wgslBlock(
  'DOF_VIGNETTE_WGSL',
  [DOF_PARAMS_WGSL],
  `
struct Barrel{at:vec2f,visible:f32}
fn projectCylinder(coc:f32,clip:vec2f)->vec2u{
 let depth=view.lens.w/(1.0-(coc/(view.coc.x*view.basis.x)));
 let atEnd=mix(view.optics.z*0.5,0.0,view.barrel.x/depth);
 let factor=-1.0*atEnd/abs(coc);
 let centre=clip*(view.optics.xy*0.5)*(view.barrel.y/view.optics.w)*-1.0;
 return vec2u(pack2x16float(centre),bitcast<u32>(factor));
}
fn projectFlag(direction:vec3f,flag:u32)->vec2u{
 let angles=view.matteAngles[flag];
 let span=view.matteSizes[flag].y;
 let reach=view.barrel.x-angles.y*span;
 let point=vec3f(angles.w*reach,angles.z*reach,view.barrel.y+span*angles.x);
 let along=(span*angles.x)/direction.z;
 let onEnd=(point-direction*along).xy;
 let normal=vec3f(angles.w*angles.x,angles.z*angles.x,angles.y);
 return vec2u(pack2x16float(onEnd),pack2x16float(vec2f(normal.y,-normal.x)));
}
fn vignetteData(texel:vec2u,coc:f32)->array<vec4u,2>{
 let draw=(vec2f(texel&vec2u(0xfffffffeu))+0.5)*circleRatio();
 let clip=(draw/vec2f(view.gather.xy))*2.0-1.0;
 let direction=normalize(-vec3f(clip*(view.optics.xy*0.5),-view.optics.w));
 let barrel=projectCylinder(coc,clip);
 return array<vec4u,2>(
  vec4u(barrel,projectFlag(direction,0u)),
  vec4u(projectFlag(direction,1u),projectFlag(direction,2u)));
}
fn hitCylinder(offset:vec2f,data:vec2u)->Barrel{
 let at=unpack2x16float(data.x)+offset*bitcast<f32>(data.y);
 let radius=view.barrel.x;
 return Barrel(at,saturate(radius*radius-dot(at,at)));
}
fn hitFlag(at:vec2f,data:vec2u)->f32{
 let delta=at-unpack2x16float(data.x);
 let edge=unpack2x16float(data.y);
 return saturate((delta.x*edge.y-delta.y*edge.x)*128.0);
}`,
)
