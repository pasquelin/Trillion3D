import { clusterDecodeWgsl } from '../../cluster/decodeWgsl.ts';
import { FLAG_CLUSTER_PAGE, FLAG_HAS_COLOR } from '../types.ts';
import { PAGE_UV_WGSL, PAGE_VERTEX_WGSL } from './pageWgsl.ts';
import { LINE_CLIP_WGSL, LINE_DASH_WGSL } from './lineWgsl.ts';
import { SPRITE_WGSL } from './spriteWgsl.ts';
import { VERTEX_COLOR_WGSL } from '../../webgpu/core/vertexColors.ts';

const QUANTIZED = `(page.flags&${FLAG_CLUSTER_PAGE}u)!=0u`;

/**
 * The geometry of a cluster as every page-geometry pass reads it — visibility raster, compute
 * raster, shadow depth, surface resolve.
 *
 * A row whose pool slot holds a quantized cluster page (`FLAG_CLUSTER_PAGE`, `docs/FORMAT.md`)
 * decodes its corners and its vertices from those words in place, with the shared routines of
 * `../../cluster/decodeWgsl.ts`: nothing of that cluster is ever uploaded as floats. A primitive the
 * compiler gave no geometry page — a transparent clustered mesh, a cache that predates the
 * format — keeps the source buffers it always read, and its rows carry the bit at zero. Both
 * paths are written here once, so no pass can read one geometry and another pass the other.
 *
 * The header is decoded once per invocation and passed down: it is twenty-one words of the page
 * and a handful of shifts, and a vertex stage that read it per corner would pay it three times a
 * triangle. `pageHeader` of a row that is not quantized costs nothing and returns zeroes.
 *
 * Vertex colours: quantized on the page, at the tail of the source UV buffer otherwise
 * (`../../webgpu/core/vertexColors.ts`). The resolve multiplies the base colour by them, and the
 * rasters cut a masked row at its base map alpha times the vertex alpha (`pageMaskAlpha`), as the
 * reference multiplies the diffuse alpha by the vertex colour before its alpha test.
 *
 * The text declares no binding: the pass that includes it declares `indices`, `positions`, `uvs`
 * and the camera uniform `uni`, whose `viewProj`, `viewport` and `pixelRatio` the screen routines
 * read (`pageLine`, `pageSprite`) — even a pass that never calls them, since a device refuses a
 * module with an unresolved name (`../../gpu/core/engineShaders.test.ts`).
 */
export const PAGE_GEOMETRY_WGSL = `${PAGE_VERTEX_WGSL}
${PAGE_UV_WGSL}
${LINE_CLIP_WGSL}
${LINE_DASH_WGSL}
${SPRITE_WGSL}
${clusterDecodeWgsl('indices')}
fn pageHeader(page:PageInfo)->ClusterHeader{
 var h:ClusterHeader;
 if(${QUANTIZED}){h=clusterHeader(page.pageOffset);}
 return h;
}
/** Local vertex index of a corner of the page, three per triangle. */
fn pageCorner(page:PageInfo,h:ClusterHeader,corner:u32)->u32{
 if(${QUANTIZED}){return clusterIndex(h,page.pageOffset,corner);}
 return indices[page.pageOffset+corner];
}
/** Position of a page vertex in the primitive's local space. */
fn pagePosition(page:PageInfo,h:ClusterHeader,vertex:u32)->vec3f{
 if(${QUANTIZED}){return clusterPosition(h,page.pageOffset,vertex);}
 return vertPos(page.vertexBase,vertex);
}
/** Clip position \`clip\` of a corner of a line page (\`page.lineWidth\` above zero), widened on
 *  screen (\`lineClip\`); \`vp\` takes the page's local space to clip space. A line page is a
 *  quantized page the world cut at run time: a row without one keeps no direction, and no width. */
fn pageLine(page:PageInfo,h:ClusterHeader,vertex:u32,vp:mat4x4f,clip:vec4f)->vec4f{
 var along=vec3f(0.0);
 if(${QUANTIZED}){along=clusterNormal(h,page.pageOffset,vertex);}
 return lineClip(clip,vp*vec4f(along,0.0),page.lineWidth,uni.viewport.xy,uni.pixelRatio);
}
/** World position of a corner \`p\` of a sprite page (\`page.sprite.y\` not zero): its quad turned
 *  to face the camera (\`spriteAt\`). The camera raster draws it, the resolve rebuilds it, the
 *  shadow passes never draw it: the reference's sprite casts no shadow. */
fn pageSprite(page:PageInfo,p:vec3f)->vec4f{return spriteAt(uni.viewProj,page.world,p.xy,page.sprite);}
/** Clip position of a page vertex under \`vp\`: every raster's, a line page's widened on screen,
 *  a sprite page's turned to the camera. */
fn pageClip(vp:mat4x4f,page:PageInfo,h:ClusterHeader,vertex:u32)->vec4f{
 if(page.sprite.y!=0.0){return uni.viewProj*pageSprite(page,pagePosition(page,h,vertex));}
 let clip=vp*vec4f(pagePosition(page,h,vertex),1.0);
 if(page.lineWidth>0.0){return pageLine(page,h,vertex,vp,clip);}
 return clip;
}
/** First texture coordinate of a page vertex. */
fn pageUv(page:PageInfo,h:ClusterHeader,vertex:u32)->vec2f{
 if(${QUANTIZED}){return clusterUv(h,page.pageOffset,vertex);}
 return vertUv(page.vertexBase,vertex);
}
${VERTEX_COLOR_WGSL}
/** Vertex colour of a page vertex. */
fn pageColor(page:PageInfo,h:ClusterHeader,vertex:u32)->vec4f{
 if(${QUANTIZED}){return clusterColor(h,page.pageOffset,vertex);}
 return vertColor(page.vertexBase+vertex);
}
/** Alpha a vertex brings to the cutout: its colour's when the row reads its colours, else one. */
fn pageMaskAlpha(page:PageInfo,h:ClusterHeader,vertex:u32)->f32{
 if((page.flags&${FLAG_HAS_COLOR}u)!=0u){return pageColor(page,h,vertex).w;}
 return 1.0;
}`;

/**
 * Vertex normal of a page, which the surface resolve alone reads: octahedral on the page,
 * three floats on the source buffer. Declared after `vertN` (`shadeDeclWgsl.ts`),
 * which supplies the second half.
 */
export const PAGE_NORMAL_WGSL = `fn pageNormal(page:PageInfo,h:ClusterHeader,vertex:u32)->vec3f{
 if(${QUANTIZED}){return clusterNormal(h,page.pageOffset,vertex);}
 return vertN(page.vertexBase,vertex);
}`;
