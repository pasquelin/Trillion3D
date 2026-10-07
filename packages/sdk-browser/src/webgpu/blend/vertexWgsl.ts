import { VERTEX_LISTS_WGSL, VERTEX_READS_WGSL, vsOutWgsl } from './vertexReadsWgsl.ts'
import * as itemFlags from '../../visibility/buffer.ts'
import * as surfaceModel from '../../scene/surfaceModel.ts'
import { NORMAL_TRANSFORM_WGSL } from '../../lighting/standardLighting.ts'
import { TRIANGLE_PALETTE_WGSL } from '../../diagnostic/trianglePalette.ts'
import { PAGE_GEOMETRY_WGSL, PAGE_UV1_WGSL } from '../../visibility/shader/pageGeometryWgsl.ts'
import { WATER_MAX_ITEMS, WATER_RANK_SHIFT } from '../water/rank.ts'
import { INSTANCE_CULL_SHIFT, INSTANCE_ITEM_MASK } from './runs.ts'
import { FACING_DROP, FACING_SHIFT, FACING_WGSL } from './facing.ts'
import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { uniteOuZero } from '../../../../math/src/wgsl/inverseTranspose.ts'

/** A lobed program's two UV sets of the vertex: the second where the item names a record and its
 *  geometry carries one — a fragment reads it only under a record (`blendPhysicalBegin`). */
const UV_PAIR = `let uv0=pageUv(page,h,v);var uv1=uv0;
 if(it.physical!=0u&&pageHasUv1(page,h)){uv1=pageUv1(page,h,v,normalTexels());}
 out.uv=vec4f(uv0,uv1);`

/** What a lobed program's vertex stage adds (`blendVertexWgsl`): the second UV set beside the
 *  first, the item's physical word beside its ids and in its page, and their reads. */
const LAYOUTS = {
  lobed: {
    uv: 'vec4f',
    ids: 'vec4u',
    word: ',it.physical',
    page: 'page.physical=it.physical;',
    read: [PAGE_UV1_WGSL],
    write: UV_PAIR,
  },
  lobeless: {
    uv: 'vec2f',
    ids: 'vec3u',
    word: '',
    page: '',
    read: [],
    write: 'out.uv=pageUv(page,h,v);',
  },
}

/**
 * The vertex stage of the transparent runs and all it reads: the view, the item records, the
 * paged geometry and the plan's instances. Every module that draws the runs starts from it — the
 * blend and water stages (`shader.ts`), so each draws the
 * same fragments; only their fragment stages differ.
 *
 * With `lobes`, a lobed program's (`physicalWgsl.ts`): `uv` carries the second UV set in its last
 * two lanes (`pageUv1`, the first where the geometry has none) and `ids` the item's physical word
 * in its fourth — no varying more, a fragment stage reading its front face holding fifteen of the
 * sixteen WebGPU guarantees. Without, the stage as it was, word for word.
 */
export const blendVertexWgsl = (lobes: boolean) => {
  const layout = LAYOUTS[lobes ? 'lobed' : 'lobeless']
  return wgslBlock(
    `blendVertexWgsl(${lobes})`,
    [
      PAGE_GEOMETRY_WGSL,
      NORMAL_TRANSFORM_WGSL,
      uniteOuZero,
      VERTEX_READS_WGSL,
      ...layout.read,
      VERTEX_LISTS_WGSL,
      vsOutWgsl(layout.uv, layout.ids),
      TRIANGLE_PALETTE_WGSL,
      FACING_WGSL,
    ],
    blendVertexStage(layout),
  )
}

/** The paged cluster's span, the corners of its triangle and its facing; a padding lane reads none. */
const VERTEX_PAGE = ` var count=it.indexCount-slot.y;
 var clusterId=0u;
 if((flags&${itemFlags.FLAG_PAGED}u)!=0u){
  let span=clusterSpans[slot.y];
  page.pageOffset=span.x;page.deformOutput=span.z;page.deformCount=span.w;
  count=span.y;
  clusterId=clusterDiagnostic[slot.y];
 }
 // A padding lane past the cluster's corners reads nothing, not even the page header.
 var h:ClusterHeader;
 var corners=vec3u(0u);var facing=0u;
 if(local<count){
  h=pageHeader(page);
  corners=pageTriangle(page,h,local/3u);
  if(cull!=0u){facing=vertexFacing(cull,it.world,page,h,corners);}
 }
 out.water=(it.flags>>${WATER_RANK_SHIFT}u)|(facing<<${FACING_SHIFT}u);`

/** The corner's colour, position, diagnostics and frame. */
const VERTEX_CORNER = ` let v=corners[local%3u];
 // The material colour times the vertex colour, alpha included, as the forward path reads it.
 if((flags&${itemFlags.FLAG_HAS_COLOR}u)!=0u){out.color*=pageColor(page,h,v);}
 let p=pagePosition(page,h,v);
 let world=it.world*vec4f(p,1.0);
 out.position=uni.viewProj*world;out.view=world.xyz;
 // A line quad widens on screen (\`lineClip\`), along the direction its corner's normal carries.
 if(it.lineWidth>0.0){out.position=lineClip(out.position,uni.viewProj*(it.world*vec4f(pageNormal(page,h,v),0.0)),it.lineWidth,uni.viewport,uni.pixelRatio);}
 // A sprite's quad turns to face the camera (\`spriteAt\`), about its origin.
 if(it.sprite.y!=0.0){let s=spriteAt(uni.viewProj,it.world,p.xy,it.sprite);out.position=uni.viewProj*s;out.view=s.xyz;}
 out.tri=0u;
 out.diagId=0u;
 if((flags&${itemFlags.FLAG_DIAGNOSTIC_CLUSTER_VIEWS}u)!=0u){out.diagId=clusterId;}
 if((flags&${itemFlags.FLAG_DIAGNOSTIC_WIREFRAME}u)!=0u){
  let a=triangleHash(corners.x);let b=triangleHash(corners.y);let c=triangleHash(corners.z);
  out.tri=a^((b<<1u)|(b>>31u))^((c<<2u)|(c>>30u));
 }
 let corner=local%3u;
 out.bary=select(select(vec3f(0.0,0.0,1.0),vec3f(0.0,1.0,0.0),corner==1u),vec3f(1.0,0.0,0.0),corner==0u);
 out.normal=vec4f(vec3f(0.0),out.normal.w);
 if((flags&${itemFlags.FLAG_HAS_NORMAL}u)!=0u){out.normal=vec4f(xformNormal(it.world,pageNormal(page,h,v)),out.normal.w);}
 out.tangent=vec4f(vec3f(0.0),out.tangent.w);out.bitangent=vec4f(vec3f(0.0),out.bitangent.w);
 if((flags&${itemFlags.FLAG_BACK}u)!=0u){out.normal=vec4f(-out.normal.xyz,out.normal.w);}
 // A page stores no tangent: an item that reads one reads it as floats, and a quantized one never
 // carries the flag (\`prepare.ts\`), its frame rebuilt from the screen (\`shaderSurface.ts\`).
 if((flags&${itemFlags.FLAG_HAS_TANGENT}u)!=0u){
  let t=vertT(page.vertexBase,v);
  out.tangent=vec4f(uniteOuZero((it.world*vec4f(t.xyz,0.0)).xyz),out.tangent.w);
  if((flags&${itemFlags.FLAG_BACK}u)!=0u){out.tangent=vec4f(-out.tangent.xyz,out.tangent.w);}
  out.bitangent=vec4f(uniteOuZero(cross(out.normal.xyz,out.tangent.xyz)*t.w),out.bitangent.w);
 }`

/**
 * The vertex stage of a layout (`LAYOUTS`). An instance draws a paged cluster compaction kept, or a
 * piece of indices of an unpaged primitive, as the list plan expansion wrote it (`expandWgsl.ts`),
 * both read through `pageGeometryWgsl.ts`. The rank of the first instance of the call is read in
 * the high bits of the vertex index, and the local rank of the vertex in the low: the indirect
 * argument of a slice starts at vertex base << vertexShift. That is what lets a whole slice fit in
 * ONE call, with nothing to bind between two plan entries — firstInstance would say the same, but
 * WebGPU only opens it to an indirect call under an extension.
 */
const blendVertexStage = ({
  uv,
  ids,
  word,
  page,
  write,
}: (typeof LAYOUTS)['lobed']) => `@vertex fn vs(@builtin(vertex_index) vertexIndex:u32,@builtin(instance_index) instance:u32)->VSOut{
 var out:VSOut;
 let slot=planInstances[(vertexIndex>>uni.vertexShift)+instance];
 let it=items[slot.x&${INSTANCE_ITEM_MASK}u];
 let cull=slot.x>>${INSTANCE_CULL_SHIFT}u;
 let local=vertexIndex&((1u<<uni.vertexShift)-1u);
 let flags=(it.flags&${WATER_MAX_ITEMS}u)|uni.viewFlags;
 out.color=it.color;
 out.ids=${ids}(it.mapIndex,flags|(u32(it.emissive.w)<<${surfaceModel.MODEL_SHIFT}u),it.emissiveIndex${word});
 out.maps=vec4u(it.roughIndex,it.metalIndex,it.normalIndex,it.aoIndex);
 out.alphaAo=vec4f(it.alphaTest,it.aoIntensity,it.dash);
 out.pbr=vec4f(it.roughness,it.metalness,it.normalScale);
 out.emissive=vec4f(it.emissive.xyz,it.subsurface.w);
 out.normal.w=it.subsurface.x;out.tangent.w=it.subsurface.y;out.bitangent.w=it.subsurface.z;
 var page:PageInfo;
 page.flags=flags;page.vertexBase=it.vertexBase;page.pageOffset=slot.y;page.deform=it.deform;page.packedBase=it.deformInput;page.deformOutput=it.deformOutput;${page}
${VERTEX_PAGE}
 if(local>=count||facing==${FACING_DROP}u){out.position=vec4f(0.0,0.0,2.0,1.0);out.color=vec4f(0.0);out.uv=${uv}(0.0);out.view=vec3f(0.0);out.normal=vec4f(vec3f(0.0,0.0,1.0),out.normal.w);out.tangent=vec4f(vec3f(0.0),out.tangent.w);out.bitangent=vec4f(vec3f(0.0),out.bitangent.w);out.tri=0u;out.bary=vec3f(0.0);out.diagId=0u;return out;}
${VERTEX_CORNER}
 ${write}
 return out;
}`
