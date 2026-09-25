import { clusterDecodeWgsl } from '../../cluster/decodeWgsl.ts';
import { FLAG_CLUSTER_PAGE } from '../types.ts';
import { PAGE_UV_WGSL, PAGE_VERTEX_WGSL } from './pageWgsl.ts';
import { LINE_CLIP_WGSL } from './lineWgsl.ts';

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
 */
export const PAGE_GEOMETRY_WGSL = `${PAGE_VERTEX_WGSL}
${PAGE_UV_WGSL}
${LINE_CLIP_WGSL}
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
 return lineClip(clip,vp*vec4f(along,0.0),page.lineWidth,uni.viewport.xy);
}
/** Clip position of a page vertex under \`vp\`: every raster's, a line page's widened on screen. */
fn pageClip(vp:mat4x4f,page:PageInfo,h:ClusterHeader,vertex:u32)->vec4f{
 let clip=vp*vec4f(pagePosition(page,h,vertex),1.0);
 if(page.lineWidth>0.0){return pageLine(page,h,vertex,vp,clip);}
 return clip;
}
/** First texture coordinate of a page vertex. */
fn pageUv(page:PageInfo,h:ClusterHeader,vertex:u32)->vec2f{
 if(${QUANTIZED}){return clusterUv(h,page.pageOffset,vertex);}
 return vertUv(page.vertexBase,vertex);
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
