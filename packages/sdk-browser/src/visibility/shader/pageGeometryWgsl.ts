import { clusterDecodeWgsl } from '../../geometry/cluster/decodeWgsl.ts'
import { wgslBlock, wgslFn } from '../../../../math/src/wgsl/decl.ts'
import {
  DEFORM_ADDRESS,
  FLAG_CLUSTER_PAGE,
  FLAG_HAS_COLOR,
  FLAG_HAS_UV,
  FLAG_LINE,
  FLAG_MASK,
  FLAG_VOXEL,
  WPO_ROW_VELOCITY,
} from '../types.ts'
import { VOXEL_BRICK_CORNERS } from '../../../../sdk-core/src/page/voxelPage.ts'
import { DEFORM_VERTEX_WORDS, DEFORMED_FIELD } from '../../deformation/vertexWords.ts'
import { VOXEL_WGSL } from './voxelWgsl.ts'
import { PAGE_UV_WGSL, PAGE_VERTEX_WGSL } from './pageWgsl.ts'
import { LINE_CLIP_WGSL, LINE_DASH_WGSL } from './lineWgsl.ts'
import { SPRITE_WGSL } from './spriteWgsl.ts'
import { VERTEX_COLOR_WGSL } from '../../gpu/core/vertexColors.ts'

/** Whether a row reads a quantized cluster page (`FLAG_CLUSTER_PAGE`): every page read's branch. */
export const QUANTIZED = `(page.flags&${FLAG_CLUSTER_PAGE}u)!=0u`
/** The flags under which a vertex hands its UV on: a row that has one AND is masked, the only one
 *  whose `maskKeep` reads it (an unmasked row keeps every fragment before its first read). */
export const UV_READ = FLAG_HAS_UV | FLAG_MASK
/** Whether a row reads voxel bricks (\`FLAG_VOXEL\`, \`voxelWgsl.ts\`): its vertices are its bricks'
 *  box corners, eight a brick, its triangles their boxes', twelve a brick. */
const VOXEL = `(page.flags&${FLAG_VOXEL}u)!=0u`

/**
 * The geometry of a cluster as every page-geometry pass reads it — visibility raster, compute
 * raster, shadow depth, surface resolve, transparent draw.
 *
 * A row whose pool slot holds a quantized cluster page (`FLAG_CLUSTER_PAGE`, `docs/FORMAT.md`)
 * decodes its corners and its vertices from those words in place, with the shared routines of
 * `../../geometry/cluster/decodeWgsl.ts`: nothing of that cluster is ever uploaded as floats. A primitive the
 * compiler gave no geometry page — a cache that predates the format — keeps the source buffers it
 * always read, and its rows carry the bit at zero. Both paths are written here once, so no pass
 * can read one geometry and another pass the other.
 *
 * The header is decoded once per invocation and passed down: at most twenty-three words of the page,
 * those of the texture sets it stores alone, and the words of the table that holds its streams' offsets,
 * which are loaded, never recomputed (`clusterOffsets`). A vertex stage decodes it per corner, so it asks `pageHeaderFor`
 * for the ten words and three table words of corners and positions alone when its row draws no surface
 * attribute. `pageHeader` of a row that is not quantized costs nothing and returns zeroes.
 *
 * A row of voxel bricks (\`FLAG_VOXEL\`) builds each brick's box from its record in place
 * (\`voxelWgsl.ts\`): one more branch of the same reads, so every pass draws a brick's box as it
 * draws triangles; the voxel variants of the passes that write a depth trace its voxels in the box
 * (\`voxelHitWgsl.ts\`).
 *
 * Vertex colours: quantized on the page, at the tail of the source UV buffer otherwise
 * (`../../gpu/core/vertexColors.ts`). The resolve multiplies the base colour by them, and the
 * rasters cut a masked row at its base map alpha times the vertex alpha (`pageMaskAlpha`), as the
 * reference multiplies the diffuse alpha by the vertex colour before its alpha test.
 *
 * The text reads the geometry's buffers alone — `indices`, `positions`, `uvs`, declared by the
 * pass that includes it — and never the camera: a pass with no camera uniform, such as a decode
 * proof, compiles it as it is. What places a corner on the camera's screen is `PAGE_SCREEN_WGSL`,
 * which the camera passes add.
 */
/**
 * The offset a row's surface moves vertex `vertex` by, in the primitive's space, `local` being the
 * vertex as the page and its deformation place it: `previous` asks for the offset of the image before,
 * which the temporal pass reprojects by, the object then placed where the placement's motion `before`
 * (the previous world taken to this one, relative to the eye) says it was. A default of zero, which a
 * pass that evaluates the offsets replaces by listing its own (`wpoGraphWgsl.ts`): every page-geometry
 * pass calls it from `pagePosition`, only the ones that list the real one move a vertex.
 */
const PAGE_WPO_NONE = wgslFn(
  'pageWpoLocal',
  [],
  'fn pageWpoLocal(page:PageInfo,h:ClusterHeader,vertex:u32,local:vec3f,previous:bool,before:mat4x4f)->vec3f{return vec3f(0.0);}',
  { weak: true },
)

/** The corners, positions and deformed tail of a page, read from \`indices\` and \`positions\`. */
const PAGE_POINT_WGSL = wgslBlock(
  'PAGE_POINT_WGSL',
  [VOXEL_WGSL, PAGE_WPO_NONE],
  `/** The placement's motion of a pass that has none: the object was where it is. */
const WPO_STILL=mat4x4f(vec4f(1.0,0.0,0.0,0.0),vec4f(0.0,1.0,0.0,0.0),vec4f(0.0,0.0,1.0,0.0),vec4f(0.0,0.0,0.0,1.0));
fn pageHeader(page:PageInfo)->ClusterHeader{return pageHeaderFor(page,true);}
/** Whether a raster's corner reads a surface attribute of its page: a line's direction
 *  (\`pageLine\`), a masked row's UV and vertex alpha (\`pageUv\`, \`pageMaskAlpha\`). */
fn pageSurfaceRead(page:PageInfo)->bool{return (page.flags&${FLAG_LINE | FLAG_MASK}u)!=0u;}
/** The header a pass reads: on a quantized row, its corners and positions alone unless \`withSurface\`
 *  asks for its normals, UVs and colours too (\`clusterPointHeader\`); a vertex stage reads it per
 *  corner, so a row that draws none of them pays none of their words. */
fn pageHeaderFor(page:PageInfo,withSurface:bool)->ClusterHeader{
 var h:ClusterHeader;
 if(${QUANTIZED}){
  h=clusterPointHeader(page.pageOffset);
  if(withSurface){h=clusterSurfaceHeader(h,page.pageOffset);}
 }
 return h;
}
/** Local vertex index of a corner of the page, three per triangle. */
fn pageCorner(page:PageInfo,h:ClusterHeader,corner:u32)->u32{
 if(${VOXEL}){return voxelBoxVertex(corner);}
 if(${QUANTIZED}){return clusterIndex(h,page.pageOffset,corner);}
 return indices[page.pageOffset+corner];
}
/** Local vertex indices of triangle \`tri\` of the page: a quantized page reads its block record once. */
fn pageTriangle(page:PageInfo,h:ClusterHeader,tri:u32)->vec3u{
 if(${VOXEL}){return vec3u(voxelBoxVertex(tri*3u),voxelBoxVertex(tri*3u+1u),voxelBoxVertex(tri*3u+2u));}
 if(${QUANTIZED}){return clusterTriangle(h,page.pageOffset,tri);}
 let at=page.pageOffset+tri*3u;
 return vec3u(indices[at],indices[at+1u],indices[at+2u]);
}
/** Position of a page vertex in the primitive's local space, as the page stores it. */
fn pageRestPosition(page:PageInfo,h:ClusterHeader,vertex:u32)->vec3f{
 if(${VOXEL}){return voxelBoxCorner(page.pageOffset,vertex);}
 if(${QUANTIZED}){return clusterPosition(h,page.pageOffset,vertex);}
 return vertPos(page.vertexBase,vertex);
}
/** The offset of a row that has one at vertex \`vertex\`, placed at \`p\` (\`field\` 0, or 3 where the
 *  deformation placed it the image before); \`previous\` asks for the clocks and the camera of the
 *  image before. A brick of voxels moves rigidly, its box and the cells traced in it (\`voxelCarry\`)
 *  alike: its offset is its surface's at the centre of its box, the same at each of its corners. */
fn pageOffset(page:PageInfo,h:ClusterHeader,vertex:u32,p:vec3f,field:u32,previous:bool,before:mat4x4f)->vec3f{
 if(${VOXEL}){
  let v=vertex-vertex%${VOXEL_BRICK_CORNERS}u;
  var lo=voxelBoxCorner(page.pageOffset,v);var hi=voxelBoxCorner(page.pageOffset,v+${VOXEL_BRICK_CORNERS - 1}u);
  if(page.deformOutput!=0u){lo=pageDeformed(page,v,field);hi=pageDeformed(page,v+${VOXEL_BRICK_CORNERS - 1}u,field);}
  return pageWpoLocal(page,h,v,(lo+hi)*0.5,previous,before);
 }
 return pageWpoLocal(page,h,vertex,p,previous,before);
}
/** Position of a page vertex in the primitive's local space, as this frame deforms it
 *  (\`DEFORM_WGSL\`) and its surface's world position offset moves it: what every pass draws. */
fn pagePosition(page:PageInfo,h:ClusterHeader,vertex:u32)->vec3f{
 var p:vec3f;
 if(page.deformOutput!=0u){p=pageDeformed(page,vertex,${DEFORMED_FIELD.position}u);}else{p=pageRestPosition(page,h,vertex);}
 if(page.wpo!=0u){p+=pageOffset(page,h,vertex,p,0u,false,WPO_STILL);}
 return p;
}
/** Positions of the page vertices \`corners\` of one triangle, as \`pagePosition\` reads each. */
fn pageTrianglePositions(page:PageInfo,h:ClusterHeader,corners:vec3u)->mat3x3f{
 return mat3x3f(pagePosition(page,h,corners.x),pagePosition(page,h,corners.y),pagePosition(page,h,corners.z));
}
/** Where the last frame drew that vertex: what the temporal pass reprojects a pixel by. \`before\` is
 *  the placement's motion (previous world taken to the current one, relative to the eye). */
fn pagePreviousPosition(page:PageInfo,h:ClusterHeader,vertex:u32,before:mat4x4f)->vec3f{
 var p:vec3f;
 if(page.deformOutput!=0u){p=pageDeformed(page,vertex,${DEFORMED_FIELD.previous}u);}else{p=pageRestPosition(page,h,vertex);}
 // A row whose offset is no motion for the temporal pass was where it is.
 if(page.wpo!=0u){p+=pageOffset(page,h,vertex,p,3u,(page.wpo&${WPO_ROW_VELOCITY}u)!=0u,before);}
 return p;
}
/** A computed result, stored in the float pool: a page's own, or a float page's block. */
fn pageDeformed(page:PageInfo,vertex:u32,field:u32)->vec3f{
 let at=(page.deformOutput&${DEFORM_ADDRESS}u)-1u+vertex*${DEFORM_VERTEX_WORDS}u+field;
 return vec3f(positions[at],positions[at+1u],positions[at+2u]);
}`,
)

/** A page's texture coordinates, vertex colours and cutout alpha, read from \`uvs\`. */
const PAGE_SURFACE_WGSL = wgslBlock(
  'PAGE_SURFACE_WGSL',
  [VERTEX_COLOR_WGSL],
  `/** First texture coordinate of a page vertex. */
fn pageUv(page:PageInfo,h:ClusterHeader,vertex:u32)->vec2f{
 if(${VOXEL}){return vec2f(0.0);}
 if(${QUANTIZED}){return clusterUv(h,page.pageOffset,vertex,0u);}
 return vertUv(page.vertexBase,vertex);
}
/** Vertex colour of a page vertex. */
fn pageColor(page:PageInfo,h:ClusterHeader,vertex:u32)->vec4f{
 if(${QUANTIZED}){return clusterColor(h,page.pageOffset,vertex);}
 return vertColor(page.vertexBase+vertex);
}
/** Alpha a vertex brings to the cutout: its colour's when the row reads its colours, else one. */
fn pageMaskAlpha(page:PageInfo,h:ClusterHeader,vertex:u32)->f32{
 if((page.flags&${FLAG_HAS_COLOR}u)!=0u){return pageColor(page,h,vertex).w;}
 return 1.0;
}`,
)

/** The page geometry without its surface attributes: corners, positions and the deformed tail,
 *  which read \`indices\` and \`positions\` alone. */
export const PAGE_POINTS_WGSL = wgslBlock(
  'PAGE_POINTS_WGSL',
  [clusterDecodeWgsl('indices'), PAGE_VERTEX_WGSL, PAGE_POINT_WGSL],
  ``,
)

/** The page geometry every page-geometry pass reads (above): its points and their surface. */
export const PAGE_GEOMETRY_WGSL = wgslBlock(
  'PAGE_GEOMETRY_WGSL',
  [PAGE_POINTS_WGSL, PAGE_UV_WGSL, LINE_DASH_WGSL, PAGE_SURFACE_WGSL],
  ``,
)

/**
 * Vertex normal of a page, which the surface resolve and the transparent draw read: octahedral on the page,
 * three floats on the source buffer. Declared after `vertN` (`VERT_NORMAL_WGSL`, `pageWgsl.ts`),
 * which supplies the second half. And its tangent, where its row carries one
 * (`FLAG_HAS_TANGENT`): stored on the page around its normal (`clusterTangent`), four floats on
 * the source buffer (`vertT`), the bitangent's sign last.
 */
export const PAGE_NORMAL_WGSL = wgslBlock(
  'PAGE_NORMAL_WGSL',
  [],
  `fn pageNormal(page:PageInfo,h:ClusterHeader,vertex:u32)->vec3f{
 if(page.deformOutput!=0u){return pageDeformed(page,vertex,${DEFORMED_FIELD.normal}u);}
 if(${VOXEL}){return voxelVertexNormal(page.pageOffset,vertex);}
 if(${QUANTIZED}){return clusterNormal(h,page.pageOffset,vertex);}
 return vertN(page.vertexBase,vertex);
}
fn pageTangent(page:PageInfo,h:ClusterHeader,vertex:u32)->vec4f{
 var rest:vec4f;
 if(${QUANTIZED}){rest=clusterTangent(h,page.pageOffset,vertex);}
 else{rest=vertT(page.vertexBase,vertex);}
 if(page.deformOutput!=0u){return vec4f(pageDeformed(page,vertex,${DEFORMED_FIELD.tangent}u),rest.w);}
 return rest;
}`,
)

/**
 * A page vertex on the camera's screen, which the camera rasters and the surface resolve add after
 * `PAGE_GEOMETRY_WGSL`: a line page's corners widened by the one formula of every raster
 * (`lineClip`), a sprite page's quad turned to face the camera (`spriteAt`). It reads the camera
 * uniform `uni` — its `viewProj`, `viewport` and `pixelRatio` — which those passes declare.
 */
export const PAGE_SCREEN_WGSL = wgslBlock(
  'PAGE_SCREEN_WGSL',
  [LINE_CLIP_WGSL, SPRITE_WGSL],
  `/** A row's sprite rule and line width, its surface's (\`pageShape\`): zeros on a row of neither. */
struct PageShape{sprite:vec2f,lineWidth:f32,}
/** Clip position \`clip\` of a corner of a line page (\`width\` above zero), widened on screen
 *  (\`lineClip\`); \`vp\` takes the page's local space to clip space. A line page is one the world
 *  cut at run time, its direction its normal: this frame's result where the row deforms — a line
 *  the host rewrites, a rope its simulation moves, read from the float pool as its position is —,
 *  else its quantized page's. A row with neither keeps no direction, and no width. */
fn pageLine(page:PageInfo,h:ClusterHeader,vertex:u32,vp:mat4x4f,clip:vec4f,width:f32)->vec4f{
 var along=vec3f(0.0);
 if(page.deformOutput!=0u){along=pageDeformed(page,vertex,${DEFORMED_FIELD.normal}u);}
 else if(${QUANTIZED}){along=clusterNormal(h,page.pageOffset,vertex);}
 return lineClip(clip,vp*vec4f(along,0.0),width,uni.viewport.xy,uni.pixelRatio);
}
/** World position of a corner \`p\` of a sprite page (\`sprite.y\` not zero): its quad turned to
 *  face the camera (\`spriteAt\`). The camera raster draws it, the resolve rebuilds it, the
 *  shadow passes never draw it: a sprite casts no shadow. */
fn pageSprite(page:PageInfo,p:vec3f,sprite:vec2f)->vec4f{return spriteAt(uni.viewProj,page.world,p.xy,sprite);}
/** Clip position of a page vertex under \`vp\`: every raster's, a line page's widened on screen,
 *  a sprite page's turned to the camera. */
fn pageClip(vp:mat4x4f,page:PageInfo,h:ClusterHeader,vertex:u32,shape:PageShape)->vec4f{
 if(shape.sprite.y!=0.0){return uni.viewProj*pageSprite(page,pagePosition(page,h,vertex),shape.sprite);}
 let clip=vp*vec4f(pagePosition(page,h,vertex),1.0);
 if(shape.lineWidth>0.0){return pageLine(page,h,vertex,vp,clip,shape.lineWidth);}
 return clip;
}`,
)
