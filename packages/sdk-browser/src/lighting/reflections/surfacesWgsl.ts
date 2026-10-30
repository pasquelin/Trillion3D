import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { fourRooksJitter } from '../../../../math/src/wgsl/sampling.ts'
import { HIZ_OPAQUE_LAYER } from '../../visibility/hiz/gpu/pyramidTexture.ts'
import { LOBES_DECODE_WGSL } from '../direct/lobesWgsl.ts'
import { lobeRoughness } from '../lobeAxisWgsl.ts'
import { PHYSICAL_SURFACE_FLAG } from '../../materials/surface/physicalLobes.ts'
import { REFLECTION_TRACE_BINDINGS as B } from './trace/traceBindings.ts'
import { REFLECTION_GROUP, reflectionBindingsWgsl, reflectionFrontWgsl } from './viewLayout.ts'
import { REFLECTION_CONSTANTS_WGSL } from './constantsWgsl.ts'
import { REFLECTION_RAY_FORMAT } from './grids.ts'

/**
 * THE SURFACE THE REFLECTIONS READ, one reading for every kernel (`trace/trace.ts`): a group binds one of
 * each pixel's two surfaces (`trace/traceEncode.ts`) — the opaque one's targets, or the transparents' front
 * one's (`frontLayer.ts`) — and its flags, normal and roughness and lobes are read from it alike. Only
 * the depth differs: `layer` 0 is the opaque one the Hi-Z holds, 1 the front pass's own; every kernel
 * passes its layer as a constant. `reflectionGridSize`: the grid's extent over the drawn size
 * (`ReflectionView.grid`, `grids.ts`), a texel a block of `reflectionBlock()` pixels (the level's row), what every
 * grid kernel bounds its texels by — a texel past the extent is none; `reflectionViewport`: the drawn
 * size, what every pixel kernel bounds its pixels by. `reflectionBlockPixel`: the `k`-th pixel of a
 * texel's block, row by row, the one order of a block's pixels. `reflectionJitter`: the pixel of a
 * texel's block this image traces, the tile jitter: none for a block of one pixel across; for a block of two pixels across and one down
 * (the checkerboard), the texel's row plus the frame index, modulo two, picks the column; for a block of two both ways, the texel's
 * cell in its 2 × 2 group plus the frame index, modulo four, picks one of the four rooks — every image the four texels
 * of a group stand for four rows and four columns. `reflectionPickedPixel`: the pixel a grid texel stands for this image — its
 * block's jitter pixel, held to the viewport, a block cut by the viewport's edge still standing for a pixel inside it —, which the ray
 * generation (`generateRays`, `trace/trace.ts`) casts from and the resolve finds again. The texel's ray is `surfaceRays`'s texels
 * (`REFLECTION_RAY_DEPTH`, `REFLECTION_RAY_DIRECTION`, `REFLECTION_RAY_CONE`, `REFLECTION_RAY_DISTANCE`), which the ray generation writes as storage and every
 * kernel after it reads, the resolve sampled (`surfaceRaysRead`): the depth of the picked pixel, negative where the texel casts no ray
 * (`reflectionRayTraces`), and the ray's direction and its cone angle, the inverse of its pdf, negative for a pixel of a first-person
 * object (`reflectionRayAt`, `reflectionRayStored`, `reflectionPdfOfCone`).
 * `reflectingPixelAt`: the surface `layer` at pixel `coord` as every kernel opens it —
 * its point, unit normal, direction to the eye and roughness, its depth as the view stores it (`z`,
 * `surfaceDepthAt`), its surface flags (`flags`), and the lobe it traces (`topN`, `top`):
 * its clear coat's normal and roughness where it carries one, its own elsewhere, the top layer — the
 * sharpest lobe the pixel shows, the one a ray is worth spending on —,
 * its physical lobes decoded (`lobesAt`) where `flags` carry them, none elsewhere. `surfaceTopAt`: that
 * lobe alone, its normal and roughness, of a pixel no kernel opens whole — a neighbour whose ray it
 * reuses; `surfaceTopRawAt`, the same with the roughness unbiased, which the temporal accumulation reads. The roughness of the lobe traced (\`top\`, the second's \`w\`) is biased toward a mirror by the setting
 * (\`reflectionSmoothed\`); the base roughness \`rough\`, which the lights read, is not.
 */
export const REFLECTION_SURFACES_WGSL = wgslBlock(
  'REFLECTION_SURFACES_WGSL',
  [
    reflectionFrontWgsl(REFLECTION_GROUP),
    reflectionBindingsWgsl(REFLECTION_GROUP),
    REFLECTION_CONSTANTS_WGSL,
    LOBES_DECODE_WGSL,
    lobeRoughness,
    fourRooksJitter,
  ],
  `@group(0) @binding(${B.flags}) var surfaceFlags:texture_2d<u32>;
@group(0) @binding(${B.normals}) var surfaceNormals:texture_2d<f32>;
@group(0) @binding(${B.lobes}) var surfaceLobes:texture_2d<u32>;
@group(0) @binding(${B.rays}) var surfaceRays:texture_storage_2d_array<${REFLECTION_RAY_FORMAT},read_write>;
@group(0) @binding(${B.raysRead}) var surfaceRaysRead:texture_2d_array<u32>;
/** The layers of the ray texture (\`REFLECTION_RAY_LAYERS\`): the depth of the pixel the texel casts from, an \`f32\`'s bits, then the ray's
 *  direction (two halves) and its third half with the cone angle, then the furthest the ray goes in metres, an f32's bits, zero for the view's longest
 *  ray, negative where the ray reads the radiance cache beyond it (reflectionStoredRay). */
const REFLECTION_RAY_DEPTH:i32=0;
const REFLECTION_RAY_DIRECTION:i32=1;
const REFLECTION_RAY_CONE:i32=2;
const REFLECTION_RAY_DISTANCE:i32=3;
/** The depth a tracing tile's clear leaves in the texels it empties: a negative one, no ray. */
const REFLECTION_NO_RAY_DEPTH:f32=-1.0;
fn surfaceFlagsAt(coord:vec2i)->u32{return textureLoad(surfaceFlags,coord,0).r;}
fn surfaceNormalAt(coord:vec2i)->vec4f{return textureLoad(surfaceNormals,coord,0);}
fn surfaceLobesAt(coord:vec2i)->vec4u{return textureLoad(surfaceLobes,coord,0);}
fn surfaceDepthAt(layer:u32,coord:vec2i)->f32{
 if(layer==0u){return textureLoad(hizDepth,coord,${HIZ_OPAQUE_LAYER},0).r;}
 return reflectionFrontDepth(coord);
}
/** The world point of the surface \`layer\` at pixel \`coord\`, at its centre. */
fn surfacePointAt(layer:u32,coord:vec2i)->vec3f{
 return worldAt(vec2f(coord)+vec2f(0.5),surfaceDepthAt(layer,coord));
}
/** A roughness \`r\` of a lobe the reflections trace, biased toward a mirror by the setting (\`ReflectionView.lobe.w\`): a smoothstep of it
 *  up to the bias, itself above; unchanged where the bias is none. */
fn reflectionSmoothed(r:f32)->f32{
 let bias=reflectionView.lobe.w;
 if(!(bias>0.0)){return r;}
 let x=saturate(r/bias);
 return r*x*x*(3.0-2.0*x);
}
/** The physical lobes' texel of the pixel \`coord\` of flags \`flags\`: all zero where the flags carry none, so that no coat, no skew and no cloth is read from it. */
fn surfaceLobeWordsAt(coord:vec2i,flags:u32)->vec4u{
 if((flags&${PHYSICAL_SURFACE_FLAG}u)==0u){return vec4u(0u);}
 return surfaceLobesAt(coord);
}
/** Whether the pixel \`coord\` of flags \`flags\` carries a clear coat (\`surfaceTopOf\` traces the coat's lobe where it does). */
fn surfaceCoatedAt(coord:vec2i,flags:u32)->bool{
 return packedCoat(surfaceLobeWordsAt(coord,flags)).x>0.0;
}
/** The lobe a pixel of lobes' texel \`w\` and surface \`normal\` (its roughness in \`w\`) traces, the one choice of it: its clear coat's normal and
 *  roughness where the texel carries a coat, the surface's own elsewhere. */
fn surfaceTopOf(w:vec4u,normal:vec4f)->vec4f{
 let coat=packedCoat(w);
 if(coat.x>0.0){return vec4f(lobeOctDecode(w.y),coat.y);}
 return vec4f(normalize(normal.xyz),normal.a);
}
/** The lobe the pixel \`coord\` of flags \`flags\` traces: its normal and its roughness as the material gives it, which the accumulation reads. */
fn surfaceTopRawAt(coord:vec2i,flags:u32)->vec4f{
 return surfaceTopOf(surfaceLobeWordsAt(coord,flags),surfaceNormalAt(coord));
}
/** The same lobe with its roughness biased (\`reflectionSmoothed\`), as the rays are drawn, resolved and filtered. */
fn surfaceTopAt(coord:vec2i,flags:u32)->vec4f{
 let top=surfaceTopRawAt(coord,flags);
 return vec4f(top.xyz,reflectionSmoothed(top.w));
}
fn reflectionGridSize()->vec2u{return reflectionView.grid.xy;}
fn reflectionViewport()->vec2u{return vec2u(view.viewport.xy);}
fn reflectionBlockPixel(g:vec2u,k:u32)->vec2u{
 let block=reflectionBlock();
 return g*block+vec2u(k%block.x,k/block.x);
}
fn reflectionJitter(g:vec2u)->vec2u{
 let block=reflectionBlock();
 let turn=reflectionView.temporal.z;
 if(block.x<2u){return vec2u(0u);}
 if(block.y<2u){return vec2u((g.y+turn)%2u,0u);}
 return fourRooksJitter(g,turn);
}
/** The pixel of grid texel \`g\`'s block picked this image: its jitter pixel, held to the viewport. */
fn reflectionPickedPixel(g:vec2u)->vec2u{
 return min(g*reflectionBlock()+reflectionJitter(g),reflectionViewport()-vec2u(1u));
}
/** The ray of grid texel \`g\`: its direction in \`xyz\` and its cone angle, signed, in \`w\`, from the words of the layers that hold them. */
fn reflectionRayOf(direction:u32,cone:u32)->vec4f{return vec4f(unpack2x16float(direction),unpack2x16float(cone));}
/** The words of a ray of direction \`R\` and signed cone angle \`cone\`, the layers' order. */
fn reflectionRayWords(R:vec3f,cone:f32)->vec2u{return vec2u(pack2x16float(R.xy),pack2x16float(vec2f(R.z,cone)));}
/** Grid texel \`g\`'s ray as a kernel that does not write it reads it, sampled. */
fn reflectionRayAt(g:vec2i)->vec4f{
 return reflectionRayOf(textureLoad(surfaceRaysRead,g,REFLECTION_RAY_DIRECTION,0).r,textureLoad(surfaceRaysRead,g,REFLECTION_RAY_CONE,0).r);
}
/** The depth of the pixel grid texel \`g\` casts from, as a kernel that does not write it reads it, sampled. */
fn reflectionRayDepth(g:vec2i)->f32{return bitcast<f32>(textureLoad(surfaceRaysRead,g,REFLECTION_RAY_DEPTH,0).r);}
/** The pdf of a ray of cone angle \`cone\`: its inverse. */
fn reflectionPdfOfCone(cone:f32)->f32{return 1.0/abs(cone);}
/** Whether a texel whose picked pixel's depth is \`depth\` casts a ray this image: it does where the depth is positive. */
fn reflectionRayTraces(depth:f32)->bool{return depth>0.0;}
struct ReflectingPixel{P:vec3f,N:vec3f,V:vec3f,rough:f32,topN:vec3f,top:f32,z:f32,flags:u32,}
fn reflectingPixelAt(layer:u32,coord:vec2i,flags:u32)->ReflectingPixel{
 let z=surfaceDepthAt(layer,coord);
 let P=worldAt(vec2f(coord)+vec2f(0.5),z);
 let normal=surfaceNormalAt(coord);
 let N=normalize(normal.xyz);
 let V=viewToEye(P);
 let w=surfaceLobeWordsAt(coord,flags);
 lobes.on=false;
 if((flags&${PHYSICAL_SURFACE_FLAG}u)!=0u){lobesAt(w,1.0,N,V,normal.a);}
 let raw=surfaceTopOf(w,normal);
 let top=vec4f(raw.xyz,reflectionSmoothed(raw.w));
 if(lobes.on&&lobes.coat>0.0){
  // The coat's lobe is the one traced: its roughness biased where it is read, so its ray is drawn from the lobe the tile test counted.
  // The pixel's lobes carry the biased roughness whole: the width the coat's light reads (\`coatAlpha\`, floored as \`setLobes\` floors it) follows it,
  // the facing (\`coatNoV\`) does not depend on it.
  lobes.coatRough=top.w;
  let coatFloor=lobeRoughness(lobes.coatRough);lobes.coatAlpha=coatFloor*coatFloor;
 }
 return ReflectingPixel(P,N,V,normal.a,top.xyz,top.w,z,flags);
}
/** A ray's origin and the normal of the lobe it traces, which the scene stage alone needs of its pixel: the point from the depth and the top lobe's normal, none of the
 *  lobes decoded (\`lobesAt\`), the roughness or the eye. */
struct ReflectingPoint{P:vec3f,topN:vec3f,}
fn reflectingPointAt(layer:u32,coord:vec2i)->ReflectingPoint{
 return ReflectingPoint(surfacePointAt(layer,coord),surfaceTopRawAt(coord,surfaceFlagsAt(coord)).xyz);
}`,
)
