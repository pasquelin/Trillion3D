import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { HIZ_OPAQUE_LAYER } from '../../visibility/hiz/gpu/pyramidTexture.ts'
import { LOBES_DECODE_WGSL } from '../direct/lobesWgsl.ts'
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
 * texel's block this image traces, the tile jitter: none for a block of one pixel; for a block of two, the texel's
 * cell in its 2 × 2 group plus the image's turn, modulo four, picks one of the four rooks — every image the four texels
 * of a group stand for four rows and four columns. `reflectionTracedPixel`: the pixel a grid texel stands for this image — the
 * classification's pick (`tiles.ts`), told in the texel's ray word (`rayPack`), which the
 * classification writes and the screen stage writes its ray into beside it (`surfaceRays`, storage);
 * every kernel after them reads it sampled (`surfaceRaysRead`, `reflectionRayWord`), one view of the
 * same texture. `reflectingPixelAt`: the surface `layer` at pixel `coord` as every kernel opens it —
 * its point, unit normal, direction to the eye and roughness, its depth as the view stores it (`z`,
 * `surfaceDepthAt`), and the lobe it traces (`topN`, `top`):
 * its clear coat's normal and roughness where it carries one, its own elsewhere, the top layer — the
 * sharpest lobe the pixel shows, the one a ray is worth spending on —,
 * its physical lobes decoded (`lobesAt`) where `flags` carry them, none elsewhere. `surfaceTopAt`: that
 * lobe alone, its normal and roughness, of a pixel no kernel opens whole — a neighbour whose ray it
 * reuses.
 */
export const REFLECTION_SURFACES_WGSL = wgslBlock(
  'REFLECTION_SURFACES_WGSL',
  [
    reflectionFrontWgsl(REFLECTION_GROUP),
    reflectionBindingsWgsl(REFLECTION_GROUP),
    REFLECTION_CONSTANTS_WGSL,
    LOBES_DECODE_WGSL,
  ],
  `@group(0) @binding(${B.flags}) var surfaceFlags:texture_2d<u32>;
@group(0) @binding(${B.normals}) var surfaceNormals:texture_2d<f32>;
@group(0) @binding(${B.lobes}) var surfaceLobes:texture_2d<u32>;
@group(0) @binding(${B.rays}) var surfaceRays:texture_storage_2d<${REFLECTION_RAY_FORMAT},read_write>;
@group(0) @binding(${B.raysRead}) var surfaceRaysRead:texture_2d<u32>;
/** The traced bit of a ray's word (\`rayPack\`): over the picked pixel's rank in its block, set
 *  where that pixel traces this image. */
const REFLECTION_TRACED:u32=16u;
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
/** The lobe the pixel \`coord\` of flags \`flags\` traces: its normal and roughness. */
fn surfaceTopAt(coord:vec2i,flags:u32)->vec4f{
 let normal=surfaceNormalAt(coord);
 if((flags&${PHYSICAL_SURFACE_FLAG}u)!=0u){
  let w=surfaceLobesAt(coord);
  let coat=packedCoat(w);
  if(coat.x>0.0){return vec4f(lobeOctDecode(w.y),coat.y);}
 }
 return vec4f(normalize(normal.xyz),normal.a);
}
fn reflectionGridSize()->vec2u{return reflectionView.grid.xy;}
fn reflectionViewport()->vec2u{return vec2u(view.viewport.xy);}
fn reflectionBlockPixel(g:vec2u,k:u32)->vec2u{
 let block=reflectionBlock();
 return g*block+vec2u(k%block,k/block);
}
fn reflectionJitter(g:vec2u)->vec2u{
 if(reflectionBlock()==1u){return vec2u(0u);}
 let index=((g.x&1u)+2u*(g.y&1u)+reflectionView.temporal.x)%4u;
 return vec2u(select(0u,1u,(index&2u)!=0u),select(1u,0u,(index&1u)!=0u));
}
/** Grid texel \`g\`'s ray word (\`rayPack\`): its block's picked pixel, its ray's direction. */
fn reflectionRayWord(g:vec2u)->u32{return textureLoad(surfaceRaysRead,vec2i(g),0).r;}
/** Whether the picked pixel of a texel of ray word \`w\` casts a ray this image. */
fn reflectionWordTraces(w:u32)->bool{return (w&REFLECTION_TRACED)!=0u;}
/** The pixel of grid texel \`g\`'s block picked this image, its ray word \`w\`. */
fn reflectionTracedOf(g:vec2u,w:u32)->vec2u{return reflectionBlockPixel(g,w&(REFLECTION_TRACED-1u));}
fn reflectionTracedPixel(g:vec2u)->vec2u{return reflectionTracedOf(g,reflectionRayWord(g));}
struct ReflectingPixel{P:vec3f,N:vec3f,V:vec3f,rough:f32,topN:vec3f,top:f32,z:f32,}
fn reflectingPixelAt(layer:u32,coord:vec2i,flags:u32)->ReflectingPixel{
 let z=surfaceDepthAt(layer,coord);
 let P=worldAt(vec2f(coord)+vec2f(0.5),z);
 let normal=surfaceNormalAt(coord);
 let N=normalize(normal.xyz);
 let V=viewToEye(P);
 lobes.on=false;
 if((flags&${PHYSICAL_SURFACE_FLAG}u)!=0u){lobesAt(surfaceLobesAt(coord),1.0,N,V,normal.a);}
 var top=vec4f(N,normal.a);
 if(lobes.on&&lobes.coat>0.0){top=vec4f(lobes.coatN,lobes.coatRough);}
 return ReflectingPixel(P,N,V,normal.a,top.xyz,top.w,z);
}`,
)
