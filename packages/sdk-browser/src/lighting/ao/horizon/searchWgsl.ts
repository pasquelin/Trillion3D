import { wgslProgram } from '../../../../../math/src/wgsl/assemble.ts'
import { PI } from '../../../../../math/src/wgsl/constants.ts'
import { wgslBlock } from '../../../../../math/src/wgsl/decl.ts'
import { fastAcos } from '../../../../../math/src/wgsl/geometry.ts'
import { interleavedGradientNoise } from '../../../../../math/src/wgsl/sampling.ts'
import { wgslF32 } from '../../../../../math/src/wgsl/number.ts'
import { FULLSCREEN_VERTEX } from '../../../gpu/shader/fullscreenTriangle.ts'
import { AO_SURFACE_WGSL } from '../commonWgsl.ts'
import { HORIZON_BINDINGS, HORIZON_PARAMS } from './layout.ts'
import { HORIZON_MAX_PIXEL_RADIUS, HORIZON_QUALITY_SHAPES } from './tables.ts'

/** What a program of the search is compiled for: the shader quality (the steps along a direction and where they start in the
 *  depth pyramid) and whether it reads the surfaces' own normals rather than the depth's. */
export interface HorizonShape {
  quality: number
  normals: boolean
  /** What names the program (`horizonShapeKey`), made with the shape: a frame builds no string for it. */
  readonly key: string
}

/** The shape of the search at `quality`, with the surfaces' own normals or the depth's. */
export const horizonShapeOf = (quality: number, normals: boolean): HorizonShape => ({
  quality,
  normals,
  key: `${quality}${normals ? 'n' : 'd'}`,
})

/** The key two shapes agree on when they compile the same program. */
export const horizonShapeKey = (shape: HorizonShape) => shape.key

/**
 * WHAT EVERY HORIZON PROGRAM DECLARES: the uniform (`HorizonParams`, named `view`) and the image's surfaces
 * (`AO_SURFACE_WGSL`), with the depth in centimetres at a position of the picture (`hzDepthCm`). A position in the picture is
 * `uv`, from 0 to 1 over the drawn view, y down.
 */
export const HORIZON_COMMON_WGSL = wgslBlock(
  'HORIZON_COMMON_WGSL',
  [AO_SURFACE_WGSL],
  `${HORIZON_PARAMS.wgsl}
@group(0) @binding(${HORIZON_BINDINGS.params}) var<uniform> view:HorizonParams;
fn hzDepthCm(uv:vec2f)->f32{return aoSceneDepth(aoPixelAt(uv));}`,
)

/** The temporal turn of the directions and the offsets of the steps, from the image's rank (`view.angles`). */
const NOISE_WGSL = wgslBlock(
  'HORIZON_NOISE_WGSL',
  [PI, interleavedGradientNoise],
  `fn hzRandom(pixel:vec2i)->vec3f{
 let x=u32(pixel.x);
 let y=16384u-u32(pixel.y);
 let noise=interleavedGradientNoise(vec2f(f32(x),f32(y)),0.0);
 let tex=vec2f(cos(noise*PI),sin(noise*PI));
 let offset=0.25*f32((y-x)&3u);
 let turned=vec2f(dot(tex,vec2f(view.angles.x,-view.angles.y)),dot(tex,vec2f(view.angles.y,view.angles.x)));
 return vec3f(turned,fract(offset+view.angles.z));
}`,
)

/**
 * THE SEARCH (`hzSearch`): along a direction, each side of the pixel, a few steps up the depth pyramid, the highest horizon
 * the depth shows, as the cosine of its angle from the view vector. A step is `max(radius · (i + phase), i + 1)` pixels out and
 * reads the pyramid at the level its rank asks (the quality's first level, one more at the second step, two more
 * from the fourth); a sample past the falloff is left out, and the one that follows a higher horizon sinks the horizon
 * towards it by the share the thickness leaves. The angles of the two sides, from the cosines.
 */
const searchBlock = (taps: number, biasLevel: number) =>
  wgslBlock(
    `HORIZON_SEARCH(${taps},${biasLevel})`,
    [HORIZON_COMMON_WGSL, fastAcos],
    `const HZ_TAPS:u32=${taps}u;
const HZ_BIAS_LEVEL:i32=${biasLevel};
fn hzHorizon(best:f32,uv:vec2f,level:i32,pos:vec3f,viewDir:vec3f,atten:f32)->f32{
 let z=aoPyramidDepthAt(uv*view.lens.zw,f32(level));
 let v=aoViewPos(uv,z)-pos;
 let lenSq=dot(v,v);
 let fall=saturate(lenSq*atten);
 if(fall>=1.0){return best;}
 let angle=mix(dot(v,viewDir)*inverseSqrt(lenSq+0.0001),best,fall);
 return select(mix(angle,best,view.search.y),angle,angle>best);
}
fn hzSearch(base:vec2f,dir:vec2f,radius:f32,phase:f32,pos:vec3f,viewDir:vec3f,atten:f32)->vec2f{
 var best=vec2f(-1.0);
 for(var i=1u;i<=HZ_TAPS;i++){
  let fi=f32(i);
  let along=dir*max(radius*(fi+phase),fi+1.0)*vec2f(1.0,-1.0);
  var level=HZ_BIAS_LEVEL;
  if(i==2u){level+=1;}
  if(i>3u){level+=2;}
  best.x=hzHorizon(best.x,base+along,level,pos,viewDir,atten);
  best.y=hzHorizon(best.y,base-along,level,pos,viewDir,atten);
 }
 return vec2f(fastAcos(clamp(best.x,-1.0,1.0)),fastAcos(clamp(best.y,-1.0,1.0)));
}`,
  )

/**
 * THE INNER INTEGRAL (`hzIntegral`): the two horizon angles of a direction, in the plane of the direction and the view
 * vector, against the surface's normal projected into that plane — the angle of the projection from the view vector, the
 * horizons held to the normal's hemisphere —, the cosine-weighted share of the sky the horizons leave, times the length of the
 * projection.
 */
const INTEGRAL_WGSL = wgslBlock(
  'HORIZON_INTEGRAL_WGSL',
  [HORIZON_COMMON_WGSL, fastAcos, PI],
  `fn hzIntegral(angles:vec2f,dir:vec2f,viewDir:vec3f,normal:vec3f)->f32{
 let planeNormal=normalize(cross(vec3f(dir,0.0),viewDir));
 let perp=cross(viewDir,planeNormal);
 let proj=normal-planeNormal*dot(normal,planeNormal);
 let len=length(proj)+0.000001;
 let cosAng=dot(proj,perp)/len;
 let gamma=fastAcos(cosAng)-0.5*PI;
 let cosGamma=dot(proj,viewDir)/len;
 let sinGamma=cosAng*-2.0;
 let ax=gamma+max(-angles.x-gamma,-0.5*PI);
 let ay=gamma+min(angles.y-gamma,0.5*PI);
 return len*0.25*((ax*sinGamma+cosGamma-cos(2.0*ax-gamma))+(ay*sinGamma+cosGamma-cos(2.0*ay-gamma)));
}`,
)

/** The reach of the search in pixels: the radius over the pixel's depth, at least one step a tap and at most `HORIZON_MAX_PIXEL_RADIUS`. */
const REACH = `max(min(view.search.x*view.search.z/pos.z,${wgslF32(HORIZON_MAX_PIXEL_RADIUS)}),f32(HZ_TAPS))`

/**
 * THE SEARCH AND THE INTEGRAL OF A PIXEL (`hzCombine`), one program of the shape: the point and its normal; the pixel's
 * directions, turned by the noise, each searched on both sides and integrated, rotated by the angle between two for the
 * next; their mean over the half turn, normalised to 1 for a sky in the open; and the fade towards 1 with the distance.
 * A pixel past the fade's end is 1 and unread.
 */
export const horizonCombineShader = (shape: HorizonShape) => {
  const { taps, biasLevel } = HORIZON_QUALITY_SHAPES[shape.quality]
  return wgslProgram(
    `
@fragment fn hzCombineMain(@builtin(position) at:vec4f)->@location(0) vec4f{
 let p=vec2i(floor(at.xy));
 let uv=(vec2f(p)+vec2f(0.5))/view.rects.xy+vec2f(0.125)/view.lens.zw;
 let depth=hzDepthCm(uv);
 if(depth>view.fade.z){return vec4f(1.0,0.0,0.0,1.0);}
 let pos=aoViewPos(uv,depth);
 let normal=${shape.normals ? 'aoToView(aoSurfaceNormal(aoPixelAt(uv)))' : 'aoDepthNormal(uv,pos)'};
 let viewDir=normalize(-pos);
 let reach=${REACH}/(f32(HZ_TAPS)+1.0);
 let random=hzRandom(p);
 var dir=random.xy;
 var phase=random.z;
 var sum=0.0;
 let count=u32(view.angles.w);
 for(var a=0u;a<count;a++){
  let angles=hzSearch(uv,dir/view.lens.zw,reach,phase,pos,viewDir,view.search.w);
  sum+=hzIntegral(angles,dir,viewDir,normal);
  dir=vec2f(dir.x*view.delta.y-dir.y*view.delta.x,dir.x*view.delta.x+dir.y*view.delta.y);
  phase=fract(phase+0.617);
 }
 let open=sum/f32(count)*(2.0/PI);
 return vec4f(mix(open,1.0,saturate(depth*view.fade.x+view.fade.y)),0.0,0.0,1.0);
}
`,
    [searchBlock(taps, biasLevel), INTEGRAL_WGSL, NOISE_WGSL, FULLSCREEN_VERTEX],
  )
}
