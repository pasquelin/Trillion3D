import { ATLAS_SLOTS_WGSL, COLOR_ALPHA_WGSL, atlasTextures } from './webgpuAtlasWgsl.ts';
import {
  EDGE_WGSL,
  MASK_KEEP_WGSL,
  PAGE_INFO_STRUCT_WGSL,
  VIS_UNIFORMS_WGSL,
} from './visibilityPageWgsl.ts';
import { SMALL_BINDINGS } from './webgpuBindLayout.ts';
import { RASTER_TRI_WGSL } from './gpuRasterTriWgsl.ts';
import { COMPUTE_TAKES_WGSL } from './gpuRasterContract.ts';
import { RASTER_PIXEL_WGSL } from './gpuRasterPixelWgsl.ts';
import { rasterKernels } from './gpuRasterKernelsWgsl.ts';
import { DEPTH_CLEAR } from './depthConvention.ts';
import { wgslFloat } from './gpuPartitionMargins.ts';

/**
 * Le raster de calcul de la part de la coupe opaque et masquée que le partage lui donne — les petits
 * triangles, ou toute la coupe : il écrit un tampon de visibilité — une profondeur et un identifiant
 * cluster/triangle par pixel — que la résolution matérielle plein écran fond ensuite dans la texture
 * d'identifiants, la profondeur et le niveau zéro de la pyramide que le raster matériel a ouverts.
 * Les surfaces à mélange et à transmission gardent leur passe.
 *
 * Un matériau à masque fait son test alpha ICI, sur le niveau de carte déjà résident : la découpe de
 * la silhouette est donc la même dans l'image et dans les ombres, qui appliquent `maskKeep` au même
 * seuil sur les mêmes coordonnées.
 */
const PAGE_INFO = `${PAGE_INFO_STRUCT_WGSL}
${VIS_UNIFORMS_WGSL}`;

export const rasterSource = (capacity: number, listBase: number) => `${PAGE_INFO}
@group(0) @binding(${SMALL_BINDINGS.indices}) var<storage,read> indices:array<u32>;
@group(0) @binding(${SMALL_BINDINGS.positions}) var<storage,read> positions:array<f32>;
@group(0) @binding(${SMALL_BINDINGS.pages}) var<storage,read> pages:array<PageInfo>;
@group(0) @binding(${SMALL_BINDINGS.hizFlags}) var<storage,read> hizFlags:array<u32>;
@group(0) @binding(${SMALL_BINDINGS.uniform}) var<uniform> uni:Uniforms;
@group(0) @binding(${SMALL_BINDINGS.uvs}) var<storage,read> uvs:array<f32>;
${atlasTextures(SMALL_BINDINGS.maps, 'maps')}
@group(0) @binding(${SMALL_BINDINGS.sampler}) var mapsSampler:sampler;
// Un seul tampon de travail : d'abord les deux attachements que le raster résout — la profondeur,
// puis les identifiants un écran plus loin —, et à partir de LIST les deux listes de triangles,
// leurs comptes, les lancements qu'ils impliquent, puis une ligne et un triangle par entrée.
@group(0) @binding(${SMALL_BINDINGS.work}) var<storage,read_write> work:array<atomic<u32>>;
const LIST:u32=${listBase}u;
@group(0) @binding(${SMALL_BINDINGS.selectionMask}) var<storage,read> selectionMask:array<u32>;
@group(0) @binding(${SMALL_BINDINGS.colorSlots}) var<storage,read> colorSlots:array<vec2u>;
${ATLAS_SLOTS_WGSL}
${COLOR_ALPHA_WGSL}
fn pixelCount()->u32{return u32(uni.viewport.x)*u32(uni.viewport.y);}
// Le produit \`viewProj * world\` et le determinant de la partie lineaire ne dependent que de la page :
// ils sont calcules une fois pour la page et relus tels quels par chacun de ses triangles. Les memes
// operandes dans le meme ordre donnent la meme valeur flottante qu'un calcul par triangle.
fn pageTransform(page:PageInfo)->mat4x4f{return uni.viewProj*page.world;}
fn pageWinding(page:PageInfo)->f32{return determinant(mat3x3f(page.world[0].xyz,page.world[1].xyz,page.world[2].xyz));}
fn vertex(vp:mat4x4f,vertexBase:u32,index:u32)->vec4f{
 let base=(vertexBase+index)*3u;
 return vp*vec4f(positions[base],positions[base+1u],positions[base+2u],1.0);
}
fn uv(page:PageInfo,index:u32)->vec2f{let base=(page.vertexBase+index)*2u;return vec2f(uvs[base],uvs[base+1u]);}
${EDGE_WGSL}
${COMPUTE_TAKES_WGSL}
${MASK_KEEP_WGSL}
${RASTER_TRI_WGSL}
${RASTER_PIXEL_WGSL}
${rasterKernels(capacity)}`;

/**
 * La résolution matérielle plein écran : un triangle qui couvre l'écran relit le tampon de travail
 * et reverse chaque pixel dans les attachements que les consommateurs lisaient déjà — identifiants
 * en `r32uint`, profondeur du tampon de profondeur, profondeur linéaire du niveau zéro de la
 * pyramide. Aucun consommateur ne change : c'est le producteur qui a changé.
 *
 * `hiz` sert entre les deux moitiés de l'image : la pyramide a besoin de la profondeur des
 * occulteurs avant que le moindre identifiant n'ait été départagé, elle n'écrit donc que le niveau
 * zéro et le tampon de profondeur. `one` et `two` closent l'image, quand la profondeur est
 * définitive et l'identifiant choisi. Toutes passent le test de profondeur contre ce que le raster
 * matériel a déjà posé : c'est là que les deux producteurs se fondent, pixel par pixel.
 */
export const RESOLVE = `${VIS_UNIFORMS_WGSL}
@group(0) @binding(0) var<storage,read> frame:array<u32>;
@group(0) @binding(1) var<uniform> uni:Uniforms;
@vertex fn vs(@builtin(vertex_index) i:u32)->@builtin(position) vec4f{return vec4f(f32(i32(i&1u)*4-1),f32(i32(i>>1u)*4-1),0.0,1.0);}
struct One{@location(0) id:u32,@builtin(frag_depth) depth:f32,}
struct Two{@location(0) id:u32,@location(1) hiz:f32,@builtin(frag_depth) depth:f32,}
struct Hiz{@location(0) hiz:f32,@builtin(frag_depth) depth:f32,}
fn offset(pos:vec4f)->u32{return u32(pos.y)*u32(uni.viewport.x)+u32(pos.x);}
fn pixelCount()->u32{return u32(uni.viewport.x)*u32(uni.viewport.y);}
@fragment fn one(@builtin(position) pos:vec4f)->One{let i=offset(pos);let id=frame[pixelCount()+i];if(id==0xffffffffu){discard;}return One(id,bitcast<f32>(frame[i]));}
@fragment fn two(@builtin(position) pos:vec4f)->Two{let i=offset(pos);let id=frame[pixelCount()+i];if(id==0xffffffffu){discard;}let depth=bitcast<f32>(frame[i]);return Two(id,depth,depth);}
@fragment fn hiz(@builtin(position) pos:vec4f)->Hiz{let d=bitcast<f32>(frame[offset(pos)]);if(d<=${wgslFloat(DEPTH_CLEAR)}){discard;}return Hiz(d,d);}`;
