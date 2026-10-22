import { wgslProgram } from '../../../../math/src/wgsl/assemble.ts'
import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { FULLSCREEN_VERTEX } from '../deferred/shaders.ts'
import { AO_COMMON_WGSL, vec2Table } from './commonWgsl.ts'
import { AO_QUALITY_SHAPES, AO_SAMPLE_SETS, type AoQualityShape } from './tables.ts'

/** What a program of the search is compiled for: the shader quality (the samples, their steps, the quad blur), whether it
 *  reads the setup texture in place of the surfaces (the coarser passes), whether it blends a coarser result in, and
 *  whether it is the last pass, which fades, raises and weighs the occlusion by the setting. */
export interface AoShape {
  quality: number
  fromSetup: boolean
  upsample: boolean
  last: boolean
}

/** The shape of the pass `kind` at `quality`, with or without a coarser result to blend in. */
export const aoShapeOf = (kind: 'step' | 'final', quality: number, upsample: boolean): AoShape => ({
  quality,
  fromSetup: kind === 'step',
  upsample,
  last: kind === 'final',
})

/** The key two shapes agree on when they compile the same program. */
export const aoShapeKey = (s: AoShape) =>
  `${s.quality}${s.fromSetup ? 's' : 'g'}${s.upsample ? 'u' : 'n'}${s.last ? 'l' : 'm'}`

/** The samples a pass takes: the coarser passes read the six-point set whatever the quality, the last the quality's own. */
const samplesOf = (shape: AoShape, quality: AoQualityShape) =>
  AO_SAMPLE_SETS[shape.fromSetup ? 3 : quality.sampleSet]

/** The taps of the upsample: nine neighbours of the coarser texture for a pass that reads the setup, four for the last. */
const tapsOf = (shape: AoShape): readonly (readonly [number, number])[] =>
  shape.fromSetup
    ? [-1, 0, 1].flatMap((y) => [-1, 0, 1].map((x) => [x, y] as const))
    : [
        [-0.5, 0.5],
        [0.5, 0.5],
        [-0.5, -0.5],
        [0.5, -0.5],
      ]

/** The wedge of one sample: the two points it takes either side of the centre, their depths at a level of the pyramid, and
 *  each's cosine of the angle from the surface's normal, never under 0 nor over 1. */
const WEDGE_WGSL = wgslBlock(
  'AO_WEDGE_WGSL',
  [AO_COMMON_WGSL],
  `
fn aoWedge(centre:vec2f,offset:vec2f,position:vec3f,scaled:vec3f,invFov:vec3f,lod:f32)->vec2f{
 let sideL=centre+offset;
 let sideR=centre-offset;
 let zL=aoPyramidDepth(sideL,lod);
 let zR=aoPyramidDepth(sideR,lod);
 let deltaL=(vec3f(sideL*zL,zL)-position)*invFov;
 let deltaR=(vec3f(sideR*zR,zR)-position)*invFov;
 return vec2f(saturate(dot(deltaL,scaled)/max(dot(deltaL,deltaL),1e-12)),saturate(dot(deltaR,scaled)/max(dot(deltaR,deltaR),1e-12)));
}`,
)

/** The coarser result at a pixel: the taps of the coarser texture, each weighed by how near its depth is and
 *  how alike its normal, their mean (a tap of a texel the coarser pass left is weighed by its own depth). */
const upsampleWgsl = (shape: AoShape) =>
  wgslBlock(
    `aoUpsample(${shape.fromSetup})`,
    [AO_COMMON_WGSL],
    `
${vec2Table('aoTap', tapsOf(shape))}
fn aoUpsample(depth:f32,uv:vec2f,normal:vec3f)->f32{
 let lowInverse=vec2f(1.0)/ao.low.xy;
 let first=0.5*lowInverse;
 let last=(ao.low.zw-vec2f(0.5))*lowInverse;
 var total=0.0001;
 var weights=0.0001;
 for(var i=0u;i<${tapsOf(shape).length}u;i++){
  let at=clamp(uv+aoTap(i)*lowInverse,first,last);
  let value=textureLoad(lowerAo,vec2i(floor(at*ao.low.xy)),0).r;
  let near=textureLoad(setupTex,vec2i(floor(at*ao.upper.xy)),0);
  let similar=saturate(1.0-abs(near.a*AO_DEPTH_SCALE-depth)*0.003);
  let weight=similar*saturate(dot(near.xyz*2.0-vec3f(1.0),normal));
  total+=value*weight;
  weights+=weight;
 }
 return total/weights;
}`,
  )

/** What the search leaves of a pixel before the quad blur: its occlusion, depth and view-space normal's x and y. */
const SAMPLE_WGSL = wgslBlock(
  'AO_SAMPLE_WGSL',
  [],
  'struct AoSample{value:f32,depth:f32,normal:vec2f,}',
)

/**
 * The search of a pixel: its depth and normal, from the setup texture or from the surfaces; the point lifted
 * off its surface along the normal by the bias, in the clip-like space the reference works in (a screen position
 * times the depth, over the projection's scale); the noise's direction scaled by the radius, turning the
 * samples; for each sample of the set, `STEPS` steps outward along its direction, each reading the two points
 * either side of the centre and keeping, as the horizon rises, the largest cosine of either side; the squared
 * share of the sky each side leaves, its weight the number of steps that found a side; the sums' mean, blended
 * with the coarser result, and, in the last pass, faded with the distance, raised to the power and weighed by the
 * intensity. The last pass leaves a pixel beyond the fade's end at 1 without a read.
 */
const searchBlock = (shape: AoShape, quality: AoQualityShape) => {
  const samples = samplesOf(shape, quality)
  const read = shape.fromSetup
    ? `let packed=textureLoad(setupTex,p,0);
 let depth=packed.a*AO_DEPTH_SCALE;
 let worldNormal=packed.xyz*2.0-vec3f(1.0);`
    : `let depth=aoSceneDepth(p);
 let worldNormal=aoSurfaceNormal(p);`
  const active = shape.last ? 'depth*ao.fade.x+ao.fade.y<1.0' : 'true'
  const tail = shape.last
    ? ` value=mix(value,1.0,saturate(depth*ao.fade.x+ao.fade.y));
  value=1.0-(1.0-pow(abs(value),ao.shape.x))*ao.shape.z;`
    : ''
  const deps = [
    AO_COMMON_WGSL,
    SAMPLE_WGSL,
    WEDGE_WGSL,
    ...(shape.upsample ? [upsampleWgsl(shape)] : []),
  ]
  return wgslBlock(
    `aoSearch(${aoShapeKey(shape)})`,
    deps,
    `
${vec2Table('aoSampleOffset', samples)}
fn aoSearch(p:vec2i)->AoSample{
 let size=ao.rects.xy;
 let screen=vec2f((f32(p.x)+0.5)/size.x*2.0-1.0,1.0-(f32(p.y)+0.5)/size.y*2.0);
 ${read}
 let viewNormal=aoSafeNormalize(vec3f(dot(worldNormal,ao.right.xyz),dot(worldNormal,ao.up.xyz),dot(worldNormal,ao.forward.xyz)),vec3f(0.0,0.0,1.0));
 var value=1.0;
 if(${active}){
  let fovFix=vec3f(ao.lens.x,ao.lens.y,1.0);
  let invFov=vec3f(1.0)/fovFix;
  let actual=ao.radius.x*mix(depth,1.0,ao.radius.y);
  var position=vec3f(screen*depth,depth);
  position+=ao.shape.y*depth*ao.radius.z*(viewNormal*fovFix);
  let direction=aoNoise(p)*actual;
  let fovXY=fovFix.xy*(1.0/position.z);
  let base=vec4f(direction,-direction.y,direction.x)*vec4f(fovXY,fovXY);
  let centre=position.xy/position.z;
  let scaled=viewNormal*(0.08*mix(depth,1000.0,ao.radius.y));
  var sums=vec2f(0.0001);
  for(var i=0u;i<${samples.length}u;i++){
   let offset=aoSampleOffset(i);
   let along=offset.x*base.xy+offset.y*base.zw;
   var horizon=vec3f(0.0);
   for(var k=0u;k<${quality.steps}u;k++){
    let fraction=f32(k+1u)/${quality.steps}.0;
    let lod=log2(max(ao.radius.w*fraction*(f32(i)+0.5)/${samples.length}.0,1e-30));
    let side=aoWedge(centre,fraction*along,position,scaled,invFov,lod);
    horizon=vec3f(max(horizon.xy,side),1.0);
   }
   let open=vec2f(1.0)-horizon.xy;
   sums+=vec2f(open.x*open.x*horizon.z,horizon.z);
   sums+=vec2f(open.y*open.y*horizon.z,horizon.z);
  }
  value=sums.x/sums.y;
  ${shape.upsample ? 'value=mix(value,aoUpsample(depth,(vec2f(p)+vec2f(0.5))/ao.rects.zw,worldNormal),ao.shape.w);' : ''}
 ${tail}
 }
 return AoSample(value,depth,viewNormal.xy);
}`,
  )
}

/** The blur among the four pixels of a quad: each pixel keeps itself and takes its two neighbours of the quad
 *  (read by the fine derivatives), weighed by how alike their normals are, the normals rebuilt from their x and y. */
const QUAD_BLUR_WGSL = wgslBlock(
  'AO_QUAD_BLUR_WGSL',
  [SAMPLE_WGSL],
  `
fn aoReconstruct(xy:vec2f)->vec3f{return vec3f(xy,sqrt(max(1.0-dot(xy,xy),0.0)));}
fn aoQuadBlur(s:AoSample,p:vec2i)->f32{
 let centre=vec4f(s.value,s.depth,s.normal);
 let dx=dpdxFine(centre);
 let dy=dpdyFine(centre);
 let odd=vec2f(f32(p.x&1),f32(p.y&1))*2.0-vec2f(1.0);
 let sideX=centre-dx*odd.x;
 let sideY=centre-dy*odd.y;
 let own=aoReconstruct(centre.zw);
 let weightX=saturate(pow(saturate(dot(own,aoReconstruct(sideX.zw))),4.0));
 let weightY=saturate(pow(saturate(dot(own,aoReconstruct(sideY.zw))),4.0));
 return (centre.x+weightX*sideX.x+weightY*sideY.x)/(1.0+weightX+weightY);
}`,
)

/**
 * A pass of the search, as a fragment program (`aoOcclusion`): the occlusion of the pixel it draws in the red channel,
 * blurred among its quad where the quality asks. Compiled for `shape`.
 */
export function aoOcclusionShader(shape: AoShape) {
  const quality = AO_QUALITY_SHAPES[shape.quality]
  return wgslProgram(
    `
@fragment fn aoOcclusion(@builtin(position) at:vec4f)->@location(0) vec4f{
 let p=vec2i(floor(at.xy));
 let s=aoSearch(p);
 return vec4f(${quality.quadBlur ? 'aoQuadBlur(s,p)' : 's.value'},0.0,0.0,1.0);
}`,
    [searchBlock(shape, quality), ...(quality.quadBlur ? [QUAD_BLUR_WGSL] : []), FULLSCREEN_VERTEX],
  )
}

/** Every shape a pass can be compiled for: each quality, the step with or without a coarser result, the last pass with or without. */
export const AO_SHAPES: readonly AoShape[] = AO_QUALITY_SHAPES.flatMap((_, quality) =>
  (['step', 'final'] as const).flatMap((kind) =>
    [false, true].map((upsample) => aoShapeOf(kind, quality, upsample)),
  ),
)

/** The text of every program of the search, by shape (the engine's shader checks read them). */
export const AO_SHADERS: Readonly<Record<string, string>> = Object.fromEntries(
  AO_SHAPES.map((shape) => [aoShapeKey(shape), aoOcclusionShader(shape)] as const),
)
