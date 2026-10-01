/**
 * THE CARD PROGRAM ON WEBGL2 (#1336): the impostor drawn as a masked surface lit by the WebGL2
 * path's one lighting formula, as the reference draws its impostor material in the forward base
 * pass of its mobile renderer. The vertex stage reads the card's record (`CARD_FLOATS`, the WebGPU
 * card's layout, `impostor/cards.ts`) from a float texture by its instance, takes its four corners —
 * turned to the camera on the CPU by the shared `spriteAt` (`impostor/card.ts`) — and derives once
 * per card what every pixel shares, as `card_vs` does (`webgpu/impostor/cardWgsl.ts`). The fragment
 * stage is the cluster program's own (`CLUSTER_FRAGMENT`, or its effect-chain variant) with only
 * its surface read replaced: the three frames blended (`impostorGlsl.ts`), the coverage cut, the
 * depth where the mesh's surface would be (the depth offset, `gl_FragDepth`), and the blended
 * colour, normal and ORM handed to the same `shade`, reflections, fog and output.
 */
import { CARD_COVERAGE_CUT, CARD_FLOATS } from '../../impostor/cards.ts';
import {
  IMPOSTOR_TAP_GLSL,
  IMPOSTOR_VIEW_CARD_GLSL,
} from '../../visibility/shader/impostorGlsl.ts';
import { core } from '../../impostor/borrowed.ts';

/** Texels of one card record: four floats each. */
export const CARD_TEXELS = CARD_FLOATS / 4;

/** The card records, `LIGHT_ROW_TEXELS` a row as every float texture of the path, and the image's
 *  view: read by both stages. */
const cardRecordGlsl = () => `uniform highp sampler2D impostorCards;uniform mat4 cardView;
vec4 cardRecord(int card,int k){int t=card*${CARD_TEXELS}+k;return texelFetch(impostorCards,ivec2(t%${core.LIGHT_ROW_TEXELS},t/${core.LIGHT_ROW_TEXELS}),0);}
mat4 cardMatrix(int card,int k){return mat4(cardRecord(card,k),cardRecord(card,k+1),cardRecord(card,k+2),cardRecord(card,k+3));}`;

/** What the vertex stage hands each pixel: the corner in object space, pivot-relative, then the
 *  card's own, flat — its record, the eye and radius, the weights and mip, the three frames, their
 *  capture planes. */
const CARD_VARYINGS = `vec3 cardPoint;flat VARY int cardIndex;flat VARY vec4 cardEyeRadius,cardWeightsLod,cardAb,cardCell;
flat VARY vec3 cardX0,cardX1,cardX2,cardN0,cardN1,cardN2;`;
const varyings = (way: 'in' | 'out') => `${way} ${CARD_VARYINGS.replaceAll('VARY', way)}`;

/** The card's vertex stage: card `firstCard + gl_InstanceID`, corner by `gl_VertexID`. */
export const cardVertex = () => `#version 300 es
precision highp float;precision highp int;
uniform mat4 projectionMatrix;uniform vec3 cardEye;uniform int firstCard;
${cardRecordGlsl()}
${varyings('out')}
${IMPOSTOR_VIEW_CARD_GLSL}
void main(){
 int order[6]=int[6](0,1,2,0,2,3);
 int i=firstCard+gl_InstanceID;
 vec3 p=cardRecord(i,order[gl_VertexID]).xyz;
 mat4 m=cardMatrix(i,8);vec4 shape=cardRecord(i,12);vec3 pivot=cardRecord(i,13).xyz;
 vec3 eye=(m*vec4(cardEye,1.0)).xyz-pivot;
 float frames=shape.y;float hemi=shape.z;
 ImpView k=impView(eye,frames,hemi);
 cardN0=impFrameNormal(k.a,frames,hemi);cardN1=impFrameNormal(k.b,frames,hemi);cardN2=impFrameNormal(k.c,frames,hemi);
 cardX0=impFrameX(cardN0);cardX1=impFrameX(cardN1);cardX2=impFrameX(cardN2);
 cardPoint=(m*vec4(p,1.0)).xyz-pivot;cardIndex=i;cardEyeRadius=vec4(eye,shape.x);
 cardWeightsLod=vec4(k.w,shape.w);cardAb=vec4(k.a,k.b);cardCell=vec4(k.c,1.0/frames,0.0);
 gl_Position=projectionMatrix*(cardView*vec4(p,1.0));
}`;

/** The cluster fragment's inputs, which the card computes instead of interpolating. */
const CLUSTER_INPUTS =
  'in vec3 toEye;in vec3 viewNormal;vec3 viewPosition;in vec2 texcoord0;in vec2 texcoord1;in vec4 vertexColor;';
/** The three atlas maps' samplers, in `ATLAS_MAPS` order, as `impostorGlsl.ts` reads them. */
export const ATLAS_SAMPLERS = ['impostorColour', 'impostorNormalDepth', 'impostorOrm'] as const;
const cardInputs =
  () => `vec3 toEye;vec3 viewNormal;vec3 viewPosition;vec2 texcoord0;vec2 texcoord1;vec4 vertexColor;
uniform sampler2D ${ATLAS_SAMPLERS.join(',')};
${cardRecordGlsl()}
${varyings('in')}
${IMPOSTOR_TAP_GLSL}`;

/** The card's surface at this pixel, then what the cluster program's shading reads of it: the view
 *  position and depth of the blended surface point, its colour, metal, roughness (floored and
 *  widened by the normal's curvature as every surface of the path), view normal and occlusion. */
const cardSurface = () => `void main(){
 vec3 eye=cardEyeRadius.xyz;float radius=cardEyeRadius.w;float lod=cardWeightsLod.w;float cell=cardCell.z;
 vec3 ray=normalize(cardPoint-eye);
 ImpBlend b=impBlend(impTap(cardAb.xy,cardX0,cardN0,eye,ray,radius,cell,lod),impTap(cardAb.zw,cardX1,cardN1,eye,ray,radius,cell,lod),
  impTap(cardCell.xy,cardX2,cardN2,eye,ray,radius,cell,lod),cardWeightsLod.xyz,lod);
 if(b.colour.a<${CARD_COVERAGE_CUT})discard;
 vec4 viewPoint=cardView*(cardMatrix(cardIndex,4)*vec4(b.point+cardRecord(cardIndex,13).xyz,1.0));
 vec4 clip=projectionMatrix*viewPoint;gl_FragDepth=clip.z/clip.w*0.5+0.5;
 viewPosition=viewPoint.xyz;toEye=-viewPosition;texcoord0=texcoord1=vec2(0.0);vertexColor=vec4(1.0);
 vec4 base=vec4(b.colour.rgb,1.0);float metal=clamp(b.orm.z,0.0,1.0);
 vec3 N=normalize(mat3(cardView)*(transpose(mat3(cardMatrix(cardIndex,8)))*b.normal));viewNormal=N;
 float rough=min(max(b.orm.y,${core.ROUGHNESS_FLOOR})+geometryRoughness(N),1.0);
 coatNormal=N;physicalFrame(N);thinSubsurface=vec3(0.0);
 float p=-projectionMatrix[2][3];vec3 V=normalize(vec3(0.0,0.0,1.0-p)-viewPosition*p);float ao=b.orm.x;
`;

/** The card's fragment stage of the cluster fragment program, `linear` its effect-chain variant:
 *  its inputs and surface read replaced, the rest — lighting, reflections, fog, output — its own. */
export const cardFragment = (linear: boolean) =>
  core.variant(
    core.variant(
      linear ? core.CLUSTER_LINEAR_FRAGMENT : core.CLUSTER_FRAGMENT,
      CLUSTER_INPUTS,
      cardInputs(),
    ),
    'void main(){',
    cardSurface(),
    'vec3 rgb=lit?shade(',
  );
