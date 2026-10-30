import { ceilDiv } from '../../../../math/src/scalar/integers.ts'
import { PI } from '../../../../math/src/wgsl/constants.ts'
import { wgslProgram } from '../../../../math/src/wgsl/assemble.ts'
import { VOLUMETRIC_IRRADIANCE_WGSL } from '../deferred/volumetricLightWgsl.ts'
import { UNLIT_FLAG } from '../../materials/surface/surfaceModelWord.ts'
import { volumetricLightmapWgsl } from './sampleWgsl.ts'

/** The words of a draw's uniform (`Viewer`): the view-projection, then the eye, the right, the up and the parameters, a vector each. */
export const VISUALIZE_VIEWER_WORDS = 32
/** The billboards one instance draws: the draw's call shape is a few instances' worth of quads each, not a quad an instance. */
export const VISUALIZE_QUADS_PER_INSTANCE = 8
/** The indices of one instance's quads, two triangles of the quad's four corners a quad (corner bit 0 is the right, bit 1 the top). */
export const visualizeQuadIndices = () =>
  Uint16Array.from({ length: VISUALIZE_QUADS_PER_INSTANCE * 6 }, (_, at) => {
    const corner = [0, 1, 2, 2, 1, 3][at % 6]!
    return Math.floor(at / 6) * 4 + corner
  })
/** The instances that draw `cells` samples: their quads are drawn eight to an instance. */
export const visualizeInstances = (cells: number) =>
  ceilDiv(Math.min(cells, 0x7fffffff >>> 2), VISUALIZE_QUADS_PER_INSTANCE)

/**
 * THE SAMPLES OF THE VOLUMETRIC LIGHTMAP AS SPHERES: a quad a sample of the finest density (the indirection texels times the brick side, a side
 * each), eight quads an instance, the quad being the vertex index over four and its corner the two low bits; the sample's brick is found as the lookup does (`vlmBrickUvs`), and a sample the brick does not hold (the fraction of its position in the brick
 * is not a whole sample) draws nothing. A sphere's radius is a fraction of the world size of its brick, kept at least a share of the screen; the fragment
 * intersects the eye's ray with the sphere, lights it with the harmonics of the sample along the normal, and fades to the ambient light where the
 * sphere is too small on the screen to be told. The output is an unlit surface: its colour for the base layer and the unlit flag for the words; the depth is the billboard's own.
 *
 *   viewer   uniform  group 0: the view-projection at the eye, the eye, the camera's right (w the projection's horizontal scale),
 *                     its up (w the radius scale), the parameters (x the least screen fraction, y the grey of the spheres)
 *   lightmap          group 1, from 0: the lightmap (`volumetricLightmapWgsl`)
 */
export const VLM_VISUALIZE_WGSL = wgslProgram(
  `
struct Viewer{viewProj:mat4x4f,eye:vec4f,right:vec4f,up:vec4f,params:vec4f,}
@group(0) @binding(0) var<uniform> viewer:Viewer;
struct Sphere{
 @builtin(position) position:vec4f,
 @location(0) @interpolate(flat) brickUvs:vec3f,
 @location(1) @interpolate(flat) fade:f32,
 @location(2) @interpolate(flat) centre:vec3f,
 @location(3) @interpolate(flat) radius:f32,
 @location(4) spot:vec3f,
}
@vertex fn vlmVisualizeVs(@builtin(vertex_index) vertex:u32,@builtin(instance_index) instance:u32)->Sphere{
 let brickSide=vlmView.scale.w;
 let cells=vec3u(vlmView.indirectionSize.xyz*brickSide);
 let slot=instance*${VISUALIZE_QUADS_PER_INSTANCE}u+vertex/4u;
 let cell=vec3u(slot%cells.x,(slot/cells.x)%cells.y,slot/(cells.x*cells.y));
 let texel=vec3f(cell)/brickSide;
 let brick=vec4f(textureLoad(vlmIndirection,vec3i(texel)));
 let local=fract(texel/brick.w)*brickSide;
 var out:Sphere;
 out.brickUvs=(brick.xyz*(brickSide+1.0)+local+0.5)*vlmView.texelSize.xyz;
 let world=(vec3f(cell)/vec3f(cells)-vlmView.offset.xyz)/vlmView.scale.xyz;
 let centre=world-viewer.eye.xyz;
 let voxel=1.0/(vlmView.indirectionSize.x*vlmView.scale.x);
 let scale=viewer.right.w;
 let distance=length(centre);
 var size=brick.w*voxel*viewer.up.w*scale/distance;
 out.fade=saturate(size*100.0-0.01);
 size=max(size,viewer.params.x*sqrt(brick.w));
 out.radius=size*distance/scale;
 out.centre=centre;
 let corner=vertex&3u;
 let offset=vec2f(select(-1.0,1.0,(corner&1u)!=0u),select(-1.0,1.0,((corner>>1u)&1u)!=0u))*out.radius*sqrt(2.0);
 out.spot=centre+offset.x*viewer.right.xyz+offset.y*viewer.up.xyz;
 out.position=viewer.viewProj*vec4f(out.spot,1.0);
 // A sample the brick does not hold, or that is not resident, draws a degenerate triangle.
 // The last instance's quads past the last sample are degenerate too.
 if(!all(abs(local-round(local))<vec3f(0.01))||slot>=cells.x*cells.y*cells.z){out.position=vec4f(0.0);}
 return out;
}
struct Shaded{@location(0) colour:vec4f,@location(1) flags:u32,}
@fragment fn vlmVisualizeFs(in:Sphere)->Shaded{
 // The ray from the eye (the origin) through the billboard's point against the sphere: the nearer root.
 let ray=in.spot;
 let a=dot(ray,ray);
 let b=-2.0*dot(ray,in.centre);
 let c=dot(in.centre,in.centre)-in.radius*in.radius;
 let discriminant=b*b-4.0*a*c;
 if(discriminant<0.0){discard;}
 let hit=(-b-sqrt(discriminant))/(2.0*a);
 if(hit<0.0){discard;}
 let normal=normalize(hit*ray-in.centre);
 let sh=vlmSh3(in.brickUvs);
 let sphere=volumetricIrradiance(sh,normal)/PI;
 let ambient=vec3f(sh.r0.x,sh.g0.x,sh.b0.x)/PI;
 // The colour of an unlit surface: the lighting pass lays the exposure over it.
 let light=mix(ambient,sphere,in.fade)*viewer.params.y;
 return Shaded(vec4f(light,1.0),${UNLIT_FLAG}u);
}`,
  [volumetricLightmapWgsl(1, 0), VOLUMETRIC_IRRADIANCE_WGSL, PI],
)
