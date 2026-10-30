import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { wgslProgram } from '../../../../math/src/wgsl/assemble.ts'
import { wgslF32 } from '../../../../math/src/wgsl/number.ts'
import { FULLSCREEN_VERTEX } from '../../gpu/shader/fullscreenTriangle.ts'
import { SURFACE_MODEL_MASK } from '../../materials/surface/surfaceModelWord.ts'
import { SURFACE_WORDS } from '../../materials/surface/surfaceOutputs.ts'
import { fogOverModules, fogOverText } from './fogPassWgsl.ts'

/**
 * THE FOG DRAWN INTO TEXTURES OF ITS OWN, and laid over the image by a last pass: the composition
 * (`fogSeparateMain`) writes, per pixel, the fog's light plus the share of the lit image the
 * scattering takes (the colour texture, whose alpha is the transmittance of the clouds, 1 until
 * they are composed into it) and the side texture (the width of the fog's point spread, and the
 * transmittance left once the scattered share is taken from the image); the blur chain
 * (`BLUR_CODE`) builds the colour texture's mips; the upsample (`fogUpsampleMain`) reads the mip
 * the width and the fog's coverage name and lays it over the image. The width of the spread is
 * the standard deviation of the point spread of a medium of the fog's extinction over the depth of
 * the pixel (Premoze et al.), for a uniform phase function and an albedo of 1.
 */

/** The side texture's channels: the width of the spread and the transmittance left. */
export const SEPARATE_SIDE_FORMAT = 'rg16float' as const
/** The largest finite half float: the width of the spread of an infinite medium. */
const HALF_MAX = 65504
/** The depth a pixel no surface drew is taken at, metres: so far that the medium is infinite. */
const SKY_DEPTH = 1e7

/** The composition's group 1: the lit image the scattering takes a share of, and the amount's scale
 *  and power (`x`, `y`). */
export const SEPARATE_COMPOSE_BINDINGS = { sceneColor: 0, scatter: 1 } as const

const composeText = `
@group(1) @binding(${SEPARATE_COMPOSE_BINDINGS.sceneColor}) var sceneColor:texture_2d<f32>;
@group(1) @binding(${SEPARATE_COMPOSE_BINDINGS.scatter}) var<uniform> scatter:vec4f;
struct SeparateOut{@location(0) fog:vec4f,@location(1) side:vec4f}

// The depth of the point along the view: the clip depth, or, in an orthographic view, the distance
// from the near plane.
fn separateDepth(at:vec3f,pixel:vec2f)->f32{
 if(view.camera.w==0.0){return length(at-worldAt(pixel,1.0));}
 let m=view.viewProjection;
 return dot(vec4f(m[0].w,m[1].w,m[2].w,m[3].w),vec4f(at,1.0));
}

// The width of the point spread of a medium: absorption and scattering per metre over the depth s.
fn spreadWidth(absorption:f32,scattering:f32,s:f32)->f32{
 if(absorption==0.0&&scattering==0.0){return 0.0;}
 let a=2.0*absorption/(3.0*s);
 let b=4.0/(3.0*s*s*s*scattering);
 if(a+b==0.0){return ${wgslF32(HALF_MAX)};}
 return min(sqrt(0.5/(a+b)),${wgslF32(HALF_MAX)});
}

@fragment fn fogSeparateMain(@builtin(position) pixel:vec4f)->SeparateOut{
 let over=fogOverPixel(pixel);
 let coord=vec2i(pixel.xy);
 let flag=textureLoad(words,coord,${SURFACE_WORDS.flags},0).r&${SURFACE_MODEL_MASK}u;
 var s=${wgslF32(SKY_DEPTH)};
 if(flag!=0u){s=separateDepth(worldAt(pixel.xy,textureLoad(depth,coord,0)),pixel.xy);}
 let transmittance=over.a;
 let depth=max(s,0.001);
 let extinction=-log(max(1e-7,transmittance))/depth;
 let scattering=extinction;
 let absorption=extinction-scattering;
 let coverage=saturate(1.0-transmittance);
 let base=saturate(coverage*scatter.x);
 let amount=select(pow(base,scatter.y),1.0,scatter.y==0.0);
 let scene=textureLoad(sceneColor,coord,0).rgb;
 var out:SeparateOut;
 out.fog=vec4f(preExposed(over.rgb)+transmittance*amount*scene,1.0);
 out.side=vec4f(spreadWidth(absorption,scattering,depth),transmittance*saturate(1.0-amount),0.0,0.0);
 return out;
}`

/** The composition's program: the fog of a pixel (`fogOverPixel`) and what the scattering takes of the image. */
export const separateComposeWgsl = (localFog: boolean) =>
  wgslBlock(
    `separateComposeWgsl(${localFog})`,
    [...fogOverModules(localFog), FULLSCREEN_VERTEX],
    `${fogOverText}${composeText}`,
  )

/** The composition's entry point. */
export const SEPARATE_COMPOSE_ENTRY = 'fogSeparateMain'
/** The upsample's entry point. */
export const SEPARATE_UPSAMPLE_ENTRY = 'fogUpsampleMain'

/** The upsample's bindings: the colour texture with its mips, the side texture, the sampler, and
 *  the spread's scale (`x`), the last mip (`y`) and the share of the texture the rect drawn covers
 *  (`zw`). */
export const SEPARATE_UPSAMPLE_BINDINGS = { colour: 0, side: 1, sampler: 2, look: 3 } as const

const B = SEPARATE_UPSAMPLE_BINDINGS
const upsampleText = `
@group(0) @binding(${B.colour}) var fogColour:texture_2d<f32>;
@group(0) @binding(${B.side}) var fogSide:texture_2d<f32>;
@group(0) @binding(${B.sampler}) var fogSampler:sampler;
@group(0) @binding(${B.look}) var<uniform> look:vec4f;

@fragment fn ${SEPARATE_UPSAMPLE_ENTRY}(@builtin(position) pos:vec4f)->@location(0) vec4f{
 let data=textureLoad(fogSide,vec2i(pos.xy),0).xy;
 // The transmittance is the unblurred one, as the fog's light does not scatter it; the mip is read
 // by the fog's coverage, the spread's scale and the width.
 let coverage=saturate(1.0-data.y);
 let mip=coverage*look.x*min(max(log2(data.x/2.0),1.0),look.y);
 // The texture may be larger than the rect drawn (its origin the rect's): a read stays half a texel of
 // its mip inside the rect, as the edge of a texture of the rect's size would hold it. The rect drawn
 // at a level is the first level's shifted right by it (never under a texel), as the blur chain draws it.
 let dims=vec2f(textureDimensions(fogColour));
 let uv=pos.xy/dims;
 let inner=0.5/dims;
 let reach=0.5*exp2(mip)/dims;
 let level=exp2(ceil(mip));
 let rect=floor(round(look.zw*dims)/level);
 let share=max(rect,vec2f(1.0))/max(floor(dims/level),vec2f(1.0));
 let cloud=textureSampleLevel(fogColour,fogSampler,clamp(uv,inner,max(inner,look.zw-inner)),0.0).a;
 let colour=textureSampleLevel(fogColour,fogSampler,clamp(uv,reach,max(reach,share-reach)),mip).rgb;
 // No medium (width 0): the colour is what the clouds composed, unfaded.
 let fade=select(saturate(data.x),1.0,data.x<=0.0);
 return vec4f(colour*fade,data.y*cloud);
}`

/** The upsample's program: a fullscreen draw whose output is blended over the image (light added, image
 *  multiplied by the alpha). */
export const separateUpsampleWgsl = wgslProgram(upsampleText, [FULLSCREEN_VERTEX])

/** The blur chain's bindings: the uniform (`blur`: `x` the blur scale, `y` the blend share, `z` the most
 *  luminance a texel holds, `w` the level; `drawn`: the size of the rect drawn at the level written
 *  `xy` and at the level the step reads beside it `zw` — the one above, the same, the one below), the
 *  texture read, the sampler and the level written. */
export const SEPARATE_BLUR_BINDINGS = { look: 0, source: 1, sampler: 2, level: 3 } as const
/** The blur chain's entry points: the 4x4 box down, the 5x5 filter of a level, and the blend of a
 *  filtered level with the next coarser one. */
export const SEPARATE_BLUR_ENTRIES = ['downsampleMain', 'filterMain', 'blendMain'] as const
/** Texels a thread group covers along each axis. */
export const SEPARATE_BLUR_GROUP = 8

/** The 5x5 Gaussian of the filter, as nine bilinear taps: each tap is the weighted mean offset of the
 *  texels it gathers (2x2 blocks, then the edge blocks), and its weight their sum. */
const GAUSSIAN_5X5 = [
  [0.00366, 0.01465, 0.02564, 0.01465, 0.00366],
  [0.01465, 0.05861, 0.09523, 0.05861, 0.01465],
  [0.02564, 0.09523, 0.15018, 0.09523, 0.02564],
  [0.01465, 0.05861, 0.09523, 0.05861, 0.01465],
  [0.00366, 0.01465, 0.02564, 0.01465, 0.00366],
]
/** The blocks of the 5x5 kernel the taps gather: [first column, first row, columns, rows]. */
const TAP_BLOCKS = [
  [0, 0, 2, 2],
  [2, 0, 2, 2],
  [4, 0, 1, 2],
  [0, 2, 2, 2],
  [2, 2, 2, 2],
  [4, 2, 1, 2],
  [0, 4, 2, 1],
  [2, 4, 2, 1],
  [4, 4, 1, 1],
] as const

/** The nine taps (x offset, y offset, weight) of the filter. */
export function gaussianTaps() {
  return TAP_BLOCKS.map(([x0, y0, width, height]) => {
    let weight = 0,
      x = 0,
      y = 0
    for (let j = 0; j < height; j++)
      for (let i = 0; i < width; i++) {
        const w = GAUSSIAN_5X5[y0 + j][x0 + i]
        x += (x0 + i - 2) * w
        y += (y0 + j - 2) * w
        weight += w
      }
    return [x / weight, y / weight, weight] as const
  })
}

const L = SEPARATE_BLUR_BINDINGS
const blurText = `
struct BlurLook{blur:vec4f,drawn:vec4f}
@group(0) @binding(${L.look}) var<uniform> look:BlurLook;
@group(0) @binding(${L.source}) var source:texture_2d<f32>;
@group(0) @binding(${L.sampler}) var tap:sampler;
@group(0) @binding(${L.level}) var level:texture_storage_2d<rgba16float,write>;
const TAPS=array<vec3f,9>(${gaussianTaps()
  .map((t) => `vec3f(${t.map(wgslF32).join(',')})`)
  .join(',')});

// A read of the source at texel coordinates p, held half a texel inside the rect drawn there.
fn tapAt(p:vec2f,high:vec2f)->vec4f{
 return textureSampleLevel(source,tap,clamp(p,vec2f(0.5),high)/vec2f(textureDimensions(source)),0.0);
}

@compute @workgroup_size(${SEPARATE_BLUR_GROUP},${SEPARATE_BLUR_GROUP},1)
fn downsampleMain(@builtin(global_invocation_id) id:vec3u){
 let at=vec2i(id.xy);
 if(any(at>=vec2i(look.drawn.xy))){return;}
 // A 4x4 box centred on the texel, from four bilinear taps.
 let centre=(vec2f(at)+0.5)*2.0;
 let high=look.drawn.zw-vec2f(0.5);
 var sum=vec4f(0.0);
 sum+=tapAt(centre+vec2f(-1.0,-1.0)*look.blur.x,high);
 sum+=tapAt(centre+vec2f(-1.0,1.0)*look.blur.x,high);
 sum+=tapAt(centre+vec2f(1.0,1.0)*look.blur.x,high);
 sum+=tapAt(centre+vec2f(1.0,-1.0)*look.blur.x,high);
 textureStore(level,at,sum*0.25);
}

@compute @workgroup_size(${SEPARATE_BLUR_GROUP},${SEPARATE_BLUR_GROUP},1)
fn filterMain(@builtin(global_invocation_id) id:vec3u){
 let at=vec2i(id.xy);
 if(any(at>=vec2i(look.drawn.xy))){return;}
 let high=look.drawn.xy-vec2f(0.5);
 var sum=vec4f(0.0);
 for(var i=0;i<9;i++){
  sum+=min(vec4f(look.blur.z),tapAt(vec2f(at)+0.5+TAPS[i].xy*look.blur.x,high))*TAPS[i].z;
 }
 textureStore(level,at,sum);
}

@compute @workgroup_size(${SEPARATE_BLUR_GROUP},${SEPARATE_BLUR_GROUP},1)
fn blendMain(@builtin(global_invocation_id) id:vec3u){
 let at=vec2i(id.xy);
 if(any(at>=vec2i(look.drawn.xy))){return;}
 // The filtered level and the next coarser one, read from the whole filtered chain: the pixel's place
 // in the rect drawn at this level is its place in the rect drawn at the coarser one.
 let here=textureLoad(source,at,i32(look.blur.w));
 let coarserDrawn=look.drawn.zw;
 let place=clamp((vec2f(at)+0.5)/look.drawn.xy*coarserDrawn,vec2f(0.5),coarserDrawn-vec2f(0.5));
 let coarser=textureSampleLevel(source,tap,place/vec2f(textureDimensions(source,i32(look.blur.w)+1)),look.blur.w+1.0);
 textureStore(level,at,mix(here,coarser,look.blur.y));
}`

/** The blur chain's whole shader. */
export const SEPARATE_BLUR_CODE = wgslProgram(blurText, [])
