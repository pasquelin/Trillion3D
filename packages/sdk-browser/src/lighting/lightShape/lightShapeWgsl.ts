import { frameAround } from '../../../../math/src/wgsl/basis.ts'
import { hsvToRgb } from '../../../../math/src/wgsl/color.ts'
import { wgslProgram } from '../../../../math/src/wgsl/assemble.ts'
import { mixWord } from '../../../../math/src/wgsl/sampling.ts'
import { VIEW_WGSL, WORLD_AT_WGSL } from '../deferred/worldAtWgsl.ts'

/**
 * THE LIGHT SHAPES' WIREFRAMES (`frame.ts`): the vertex stage of each kind of light deforms its mesh (`meshes.ts`) to the light's reach from the
 * instance's record, four `vec4f`: `place` (the light's place, its range), `axis` (where it points, the cosine of a spot's outer cone), `up` (a
 * rectangle's height axis, the cosine of its barn doors' angle) and `size` (a rectangle's half width and half height, its barn doors' length, the
 * light's rank). The fragment stage colours the light by a hue from a hash of its rank, and gives it the opacity of the fade the view's switch
 * runs (the shapes of the lights far from the eye appearing first), times the share of a metre the surface behind it lies deeper than it.
 */

/** Where the bindings lie in group 0: the view, the scene's depth, and the switch's figures. */
export const LIGHT_SHAPE_BINDINGS = { view: 0, depth: 1, fade: 2 } as const

/** The entries of the vertex stages, by kind of light. */
export const LIGHT_SHAPE_ENTRIES = {
  point: 'pointShape',
  spot: 'spotShape',
  rect: 'rectShape',
} as const
export const LIGHT_SHAPE_FRAGMENT = 'lightShapeColour'

/** The floats of the switch's block: the view-projection (clip from the world), then the toggle time and the time of the image, then the fade's inverse duration and the delay's inverse distance, the longest delay and the opacity at full. */
export const LIGHT_SHAPE_FADE_FLOATS = 24

/** The floats of an instance's record. */
export const LIGHT_SHAPE_INSTANCE_FLOATS = 16

/** The sine and cosine of the angle the rectangle's barn doors open to, and their length in metres, where the light names none: the reference's defaults, 88 degrees and 20 centimetres. */
export const DEFAULT_BARN_DOOR_DEGREES = 88
export const DEFAULT_BARN_DOOR_LENGTH = 0.2

/** The metres a share of the opacity is lost over where a shape comes within reach of the surface behind it. */
const DEPTH_FADE_METRES = 1

export const lightShapeShader = () =>
  wgslProgram(
    `@group(0) @binding(${LIGHT_SHAPE_BINDINGS.view}) var<uniform> view:View;
@group(0) @binding(${LIGHT_SHAPE_BINDINGS.depth}) var sceneDepth:texture_depth_2d;
struct Fade{viewProjection:mat4x4f,toggle:vec4f,figures:vec4f,}
@group(0) @binding(${LIGHT_SHAPE_BINDINGS.fade}) var<uniform> fade:Fade;
struct ShapeIn{@location(0) local:vec3f,@location(1) place:vec4f,@location(2) axis:vec4f,@location(3) up:vec4f,@location(4) size:vec4f,}
struct ShapeOut{@builtin(position) position:vec4f,@location(0) @interpolate(flat) rank:u32,}
fn shapeOut(world:vec3f,rank:f32)->ShapeOut{
 var out:ShapeOut;
 out.position=fade.viewProjection*vec4f(world,1.0);
 out.rank=u32(rank);
 return out;
}
fn safeNormalize(v:vec3f)->vec3f{
 let l2=dot(v,v);
 return v*select(0.0,inverseSqrt(l2),l2>1e-8);
}
@vertex fn ${LIGHT_SHAPE_ENTRIES.point}(shape:ShapeIn)->ShapeOut{
 return shapeOut(shape.local*shape.place.w+shape.place.xyz,shape.size.w);
}
@vertex fn ${LIGHT_SHAPE_ENTRIES.spot}(shape:ShapeIn)->ShapeOut{
 let angle=acos(shape.axis.w)*shape.local.x;
 var at=vec3f(cos(angle),shape.local.yz*sin(angle))*shape.place.w;
 at=select(at,vec3f(0.0),shape.local.x>1.0001);
 let frame=frameAround(shape.axis.xyz);
 return shapeOut(shape.place.xyz+at.x*shape.axis.xyz+at.y*frame.x+at.z*frame.y,shape.size.w);
}
@vertex fn ${LIGHT_SHAPE_ENTRIES.rect}(shape:ShapeIn)->ShapeOut{
 let width=shape.size.x*2.0;
 let height=shape.size.y*2.0;
 let cosBarn=shape.up.w;
 let sinBarn=sqrt(1.0-cosBarn*cosBarn);
 let forward=vec3f(1.0,0.0,0.0);
 let normalised=shape.local*2.0;
 let baseRect=shape.local*vec3f(0.0,width,height);
 let barnRect=baseRect+vec3f(cosBarn,sinBarn*normalised.yz)*shape.size.z;
 // The barn doors' rectangle is projected onto the sphere of the light's range along the ray from the base through it.
 var ray=barnRect+baseRect;
 let a=dot(ray,ray);
 let b=-2.0*dot(ray,baseRect);
 let c=dot(baseRect,baseRect)-shape.place.w*shape.place.w;
 let t=(-b+sqrt(b*b-4.0*a*c))/(2.0*a);
 let outer=-baseRect+ray*t;
 // Turned about the axis across the forward direction by the share of the angle between them the first coordinate gives.
 ray=normalize(outer);
 let between=acos(dot(ray,forward))*normalised.x;
 let rotation=safeNormalize(cross(ray,forward));
 var at=outer*cos(between)+cross(rotation,outer)*sin(between);
 at=select(at,barnRect,normalised.x<-0.0001);
 let widthAxis=cross(shape.up.xyz,shape.axis.xyz);
 return shapeOut(shape.place.xyz+at.x*shape.axis.xyz+at.y*widthAxis+at.z*shape.up.xyz,shape.size.w);
}
@fragment fn ${LIGHT_SHAPE_FRAGMENT}(@builtin(position) pixel:vec4f,@location(0) @interpolate(flat) rank:u32)->@location(0) vec4f{
 let random=f32(mixWord(rank))*2.3283064365386963e-10;
 let P=worldAt(pixel.xy,pixel.z);
 // The distance in centimetres, as the delay's range is.
 let far=length(P-view.camera.xyz)*100.0;
 let visualize=fade.toggle.x>0.0;
 let delay=select(0.0,saturate(1.0-far*fade.figures.y)*fade.figures.z,visualize);
 var alpha=saturate((fade.toggle.y-delay-abs(fade.toggle.x))*fade.figures.x);
 alpha=select(1.0-alpha,alpha,visualize)*fade.figures.w;
 // The depth fade: nothing where the surface lies nearer the eye than the shape, the whole opacity a metre deeper.
 let z=textureLoad(sceneDepth,vec2i(pixel.xy),0);
 let opaque=fade.viewProjection*vec4f(worldAt(pixel.xy,z),1.0);
 let behind=select(3.0e38,opaque.w,z>0.0);
 alpha*=saturate((behind-1.0/pixel.w)/${DEPTH_FADE_METRES}.0);
 return vec4f(hsvToRgb(vec3f(random,1.0,1.0)),alpha);
}`,
    [VIEW_WGSL, WORLD_AT_WGSL, frameAround, hsvToRgb, mixWord],
  )
