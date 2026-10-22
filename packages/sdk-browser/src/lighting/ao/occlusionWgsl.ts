import { wgslProgram } from '../../../../math/src/wgsl/assemble.ts'
import { DIVISOR_FLOOR } from '../../../../math/src/wgsl/constants.ts'
import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { FULLSCREEN_VERTEX } from '../deferred/shaders.ts'
import { AO_COMMON_WGSL, vec2Table } from './commonWgsl.ts'
import { AO_QUALITY_SHAPES, AO_SAMPLE_SETS, type AoQualityShape } from './tables.ts'

/** What a program of the search is compiled for: the shader quality (the samples, their steps, the quad blur), the kind
 *  of pass — a step reads the setup texture in place of the surfaces and takes the six-point set whatever the quality, the
 *  last pass reads the surfaces and fades, raises and weighs the occlusion by the settings — and whether it blends a
 *  coarser result in. */
export interface AoShape {
  quality: number
  kind: 'step' | 'final'
  upsample: boolean
}

/** The shape of the pass `kind` at `quality`, with or without a coarser result to blend in. */
export const aoShapeOf = (kind: AoShape['kind'], quality: number, upsample: boolean): AoShape => ({
  quality,
  kind,
  upsample,
})

/** The key two shapes agree on when they compile the same program. */
export const aoShapeKey = (s: AoShape) =>
  `${s.quality}${s.kind === 'step' ? 's' : 'f'}${s.upsample ? 'u' : 'n'}`

/** The taps of the upsample: nine neighbours of the coarser texture for a step, four for the last pass. */
const tapsOf = (kind: AoShape['kind']): readonly (readonly [number, number])[] =>
  kind === 'step'
    ? [-1, 0, 1].flatMap((y) => [-1, 0, 1].map((x) => [x, y] as const))
    : [
        [-0.5, 0.5],
        [0.5, 0.5],
        [-0.5, -0.5],
        [0.5, -0.5],
      ]

/**
 * The samples of a pixel's search. `aoWedge`: the two points one sample takes either side of the centre, the depth
 * each reads (`aoPyramidDepth`, one texel) and its cosine of the angle from the surface's normal, never under 0 nor over 1.
 * `aoSample`: one sample of the set, `steps` steps outward along its direction, a step keeping, as the horizon rises,
 * the larger cosine of either side; the squared share of the sky each side leaves, and the weight, 2.
 */
const WEDGE_WGSL = wgslBlock(
  'AO_WEDGE_WGSL',
  [AO_COMMON_WGSL, DIVISOR_FLOOR],
  `
fn aoWedge(centre:vec2f,offset:vec2f,position:vec3f,scaled:vec3f,invFov:vec3f,lod:f32)->vec2f{
 let sideL=centre+offset;
 let sideR=centre-offset;
 let zL=aoPyramidDepth(sideL,lod);
 let zR=aoPyramidDepth(sideR,lod);
 let deltaL=(vec3f(sideL*zL,zL)-position)*invFov;
 let deltaR=(vec3f(sideR*zR,zR)-position)*invFov;
 return vec2f(saturate(dot(deltaL,scaled)/max(dot(deltaL,deltaL),DIVISOR_FLOOR)),saturate(dot(deltaR,scaled)/max(dot(deltaR,deltaR),DIVISOR_FLOOR)));
}
fn aoSample(i:u32,count:u32,steps:u32,centre:vec2f,base:vec4f,position:vec3f,scaled:vec3f,invFov:vec3f,offset:vec2f)->vec2f{
 let along=offset.x*base.xy+offset.y*base.zw;
 var horizon=vec2f(0.0);
 for(var k=0u;k<steps;k++){
  let fraction=f32(k+1u)/f32(steps);
  let lod=log2(max(view.reach.w*fraction*(f32(i)+0.5)/f32(count),DIVISOR_FLOOR));
  horizon=max(horizon,aoWedge(centre,fraction*along,position,scaled,invFov,lod));
 }
 let open=vec2f(1.0)-horizon;
 return vec2f(dot(open,open),2.0);
}`,
)

/** The coarser result at a pixel: the taps of the coarser texture, each weighed by how near its depth is and
 *  how alike its normal, their mean (a tap of a texel the coarser pass left is weighed by its own depth). */
const upsampleBlock = (kind: AoShape['kind']) =>
  wgslBlock(
    `aoUpsample(${kind})`,
    [AO_COMMON_WGSL],
    `
${vec2Table('aoTap', tapsOf(kind))}
fn aoUpsample(depth:f32,uv:vec2f,normal:vec3f)->f32{
 let lowInverse=vec2f(1.0)/view.low.xy;
 let first=0.5*lowInverse;
 let last=(view.low.zw-vec2f(0.5))*lowInverse;
 var total=0.0001;
 var weights=0.0001;
 for(var i=0u;i<${tapsOf(kind).length}u;i++){
  let at=clamp(uv+aoTap(i)*lowInverse,first,last);
  let value=textureLoad(lowerAo,vec2i(floor(at*view.low.xy)),0).r;
  let near=textureLoad(setupTex,vec2i(floor(at*view.upper.xy)),0);
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

/** What the search reads of its pixel: its depth and its world normal, from the setup texture (a step) or the surfaces. */
const READS = {
  step: `let packed=textureLoad(setupTex,p,0);
 let depth=packed.a*AO_DEPTH_SCALE;
 let worldNormal=packed.xyz*2.0-vec3f(1.0);`,
  final: `let depth=aoSceneDepth(p);
 let worldNormal=aoSurfaceNormal(p);`,
} as const

/** The last pass's tail: the occlusion faded with the distance, raised to the power and weighed by the intensity. */
const TAIL =
  ' value=mix(value,1.0,saturate(depth*view.fade.x+view.fade.y));\n value=1.0-(1.0-pow(abs(value),view.shape.x))*view.shape.z;'

/**
 * The search of a pixel (`aoSearched`): the point lifted off its surface along the normal by the bias, in the
 * clip-like space the reference works in (a screen position times the depth, over the projection's scale); the noise's
 * direction scaled by the radius, turning the samples; the sums of every sample of the set (`aoSample`), their mean,
 * blended with the coarser result and, in the last pass, faded, raised to the power and weighed by the intensity. A pixel
 * is read from the setup texture or the surfaces (`READS`); the last pass leaves one beyond the fade's end at 1, unread.
 */
const searchBlock = (shape: AoShape, quality: AoQualityShape) => {
  const samples = AO_SAMPLE_SETS[shape.kind === 'step' ? 3 : quality.sampleSet]
  const upsample = shape.upsample
    ? ' value=mix(value,aoUpsample(depth,(vec2f(p)+vec2f(0.5))/view.rects.zw,worldNormal),view.shape.w);\n'
    : ''
  const searched = 'aoSearched(p,depth,worldNormal,viewNormal)'
  return wgslBlock(
    `aoSearch(${aoShapeKey(shape)})`,
    [WEDGE_WGSL, SAMPLE_WGSL, ...(shape.upsample ? [upsampleBlock(shape.kind)] : [])],
    `
${vec2Table('aoSampleOffset', samples)}
fn aoSearched(p:vec2i,depth:f32,worldNormal:vec3f,viewNormal:vec3f)->f32{
 let size=view.rects.xy;
 let screen=vec2f((f32(p.x)+0.5)/size.x*2.0-1.0,1.0-(f32(p.y)+0.5)/size.y*2.0);
 let fovFix=vec3f(view.lens.x,view.lens.y,1.0);
 let actual=view.reach.x*mix(depth,1.0,view.reach.y);
 var position=vec3f(screen*depth,depth);
 position+=view.shape.y*depth*view.reach.z*(viewNormal*fovFix);
 let direction=aoNoise(p)*actual;
 let fovXY=fovFix.xy*(1.0/position.z);
 let base=vec4f(direction,-direction.y,direction.x)*vec4f(fovXY,fovXY);
 let centre=position.xy/position.z;
 let scaled=viewNormal*(0.08*mix(depth,1000.0,view.reach.y));
 var sums=vec2f(0.0001);
 for(var i=0u;i<${samples.length}u;i++){
  sums+=aoSample(i,${samples.length}u,${quality.steps}u,centre,base,position,scaled,vec3f(1.0)/fovFix,aoSampleOffset(i));
 }
 var value=sums.x/sums.y;
${upsample}${shape.kind === 'final' ? TAIL : ''}
 return value;
}
fn aoSearch(p:vec2i)->AoSample{
 ${READS[shape.kind]}
 let viewNormal=aoSafeNormalize(vec3f(dot(worldNormal,view.right.xyz),dot(worldNormal,view.up.xyz),dot(worldNormal,view.forward.xyz)),vec3f(0.0,0.0,1.0));
 var value=1.0;
 ${shape.kind === 'final' ? `if(depth*view.fade.x+view.fade.y<1.0){value=${searched};}` : `value=${searched};`}
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
