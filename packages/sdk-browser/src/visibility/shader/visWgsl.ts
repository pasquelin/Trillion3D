import { PAGE_BINDING, PAGE_INFO_WGSL, PAGE_LOOKUP_WGSL, maskKeepWgsl } from './pageWgsl.ts'
import { PAGE_GEOMETRY_WGSL, PAGE_SCREEN_WGSL, UV_READ } from './pageGeometryWgsl.ts'
import {
  COLOR_SAMPLE_WGSL,
  TILE_POOL_WGSL,
  maskAlphaWgsl,
  materialDeclarations,
} from '../../webgpu/tile/wgsl.ts'
import { VIS_BINDINGS } from '../../webgpu/core/bindLayout.ts'
import { HIZ_REJECTED_WGSL } from '../../gpu/partition/contract.ts'
import { COMPUTE_ALL, COMPUTE_TAKES_WGSL } from '../../gpu/raster/contract.ts'
import { wgslProgram } from '../../../../math/src/wgsl/assemble.ts'
import { NO_INDEX } from '../../../../math/src/wgsl/constants.ts'
import type { WgslDecl } from '../../../../math/src/wgsl/decl.ts'

/** The vertex stage of the hardware raster: `hiz` also drops a page whose slot the Hi-Z test rejected
 *  (`HIZ_REJECTED_WGSL`), before a vertex reads a word of it. */
const visVertex = (name: string, hiz: boolean) => {
  const hizDrop = hiz
    ? ' if(hizRejected(page.hizSlot)){out.position=vec4f(0.0,0.0,2.0,1.0);out.id=0u;return out;}\n'
    : ''
  return `@vertex fn ${name}(@builtin(vertex_index) vertexIndex:u32,@builtin(instance_index) instanceIndex:u32)->VSOut{
 var out:VSOut;
 let at=drawBatch(instanceIndex);let pageIndex=at.x;let corner=at.y+vertexIndex;
 let page=pages[pageIndex];
 out.instance=pageIndex;out.tc=vec3f(0.0);
${hizDrop} if(hardwareIdle(page,corner)){out.position=vec4f(0.0,0.0,2.0,1.0);out.id=0u;return out;}
 let h=pageHeaderFor(page,pageSurfaceRead(page));
 let id=hardwareCorner(page,h,corner);
 if(id==NO_INDEX){out.position=vec4f(0.0,0.0,2.0,1.0);out.id=0u;return out;}
 let p=pagePosition(page,h,id);
 let world=page.world*vec4f(p,1.0);
 out.position=uni.viewProj*world;
 if(page.lineWidth>0.0){out.position=pageLine(page,h,id,uni.viewProj*page.world,out.position);}
 if(page.sprite.y!=0.0){out.position=uni.viewProj*pageSprite(page,p);}
 out.id=page.packedBase|((corner/3u)&0xffu);
 if((page.flags&${UV_READ}u)==${UV_READ}u){out.tc=vec3f(pageUv(page,h,id),0.0);}
 if((page.flags&128u)!=0u){out.tc.z=pageMaskAlpha(page,h,id);}
 return out;
}
`
}

/**
 * Hardware raster of the visibility buffer, producer of the opaque and masked image. Under the
 * compute share (`uni.computeSpan`), it leaves to the compute raster the triangles that
 * one takes — the same predicate, read on the same vertices — and draws all the others; at
 * zero, it draws the whole cut without reading one more vertex.
 */
export const visShader = ({ diagnostic }: { diagnostic?: WgslDecl } = {}) =>
  wgslProgram(
    `${PAGE_BINDING.indices}
${PAGE_BINDING.positions}
${PAGE_BINDING.pages}
@group(0) @binding(${VIS_BINDINGS.flags}) var<storage, read> hizFlags:array<u32>;
${PAGE_BINDING.uniforms}
${materialDeclarations()}
${PAGE_BINDING.instances}
${PAGE_BINDING.slotOffsets}
// \`tc\` is the UV and, on a masked row, the vertex alpha of its cutout: one interpolant, as the UV
// alone was.
struct VSOut{@builtin(position) position:vec4f,@location(0) @interpolate(flat) id:u32,@location(1) @interpolate(flat) instance:u32,@location(2) tc:vec3f,}
/** True when this vertex belongs to no triangle of the page, or when the compute raster draws
 *  the whole cut: neither case reads a page word, so neither decodes the page header. */
fn hardwareIdle(page:PageInfo,vertexIndex:u32)->bool{
 return vertexIndex>=page.indexCount||uni.computeSpan>=${COMPUTE_ALL};
}
/** The page corner this vertex draws, or none (\`NO_INDEX\`) when hardware leaves its triangle to
 *  the compute raster, which takes it: without a share, only the vertex's own corner is decoded,
 *  with one, its triangle once, which the test and the corner both read. */
fn hardwareCorner(page:PageInfo,h:ClusterHeader,vertexIndex:u32)->u32{
 if(uni.computeSpan<=0.0){return pageCorner(page,h,vertexIndex);}
 let corners=pageTriangle(page,h,vertexIndex/3u);let ia=corners.x;let ib=corners.y;let ic=corners.z;
 let vp=uni.viewProj*page.world;
 if(computeTakes(pageClip(vp,page,h,ia),pageClip(vp,page,h,ib),pageClip(vp,page,h,ic))){return NO_INDEX;}
 return corners[vertexIndex%3u];
}
${visVertex('vis_vs', false)}${visVertex('vis_hiz_vs', true)}struct VisHizOut{@location(0) id:u32,@location(1) depth:f32,}
@fragment fn vis_hiz_fs(in:VSOut)->VisHizOut{
 var out:VisHizOut;
 let gx=dpdx(in.tc.xy);let gy=dpdy(in.tc.xy);
 if(!maskKeep(pages[in.instance],in.tc.xy,in.tc.z,gx,gy)){discard;}
 out.id=in.id;out.depth=in.position.z;return out;
}
// The stage above for a slot that holds no cutout row (no \`FLAG_MASK\`): \`maskKeep\` keeps every
// pixel of such a row, so it writes the same words without reading its page or discarding, and a
// tile GPU's hidden-surface removal resolves its overdraw before it runs (#831).
@fragment fn vis_hiz_opaque_fs(in:VSOut)->VisHizOut{var out:VisHizOut;out.id=in.id;out.depth=in.position.z;return out;}
`,
    [
      PAGE_INFO_WGSL,
      HIZ_REJECTED_WGSL,
      TILE_POOL_WGSL,
      COLOR_SAMPLE_WGSL,
      PAGE_LOOKUP_WGSL,
      PAGE_SCREEN_WGSL,
      maskKeepWgsl(maskAlphaWgsl(false)),
      PAGE_GEOMETRY_WGSL,
      COMPUTE_TAKES_WGSL,
      NO_INDEX,
      ...(diagnostic ? [diagnostic] : []),
    ],
  )

/** The raster's module without a diagnostic stage: what production compiles. */
export const VIS_SHADER = visShader()
