import { wgslProgram } from '../../../../../../math/src/wgsl/assemble.ts'
import { bitAt, bitIsSet, byteOf } from '../../../../../../math/src/wgsl/integer.ts'
import { VIS_BINDINGS } from '../../../../gpu/bind/bindLayout.ts'
import {
  SHADOW_TILE_POOL_WGSL,
  dataSampleWgsl,
  tileDeclarations,
} from '../../../../materials/virtual/wgsl.ts'
import {
  PAGE_GEOMETRY_WGSL,
  PAGE_NORMAL_WGSL,
} from '../../../../visibility/shader/pageGeometryWgsl.ts'
import {
  PAGE_BINDING,
  PAGE_INFO_WGSL,
  normalAtlasWgsl,
} from '../../../../visibility/shader/pageWgsl.ts'
import { FLAG_DOUBLE } from '../../../../visibility/types.ts'
import { TESS_BINDINGS as B } from '../../../../visibility/tessellation/bindings.ts'
import { ARG_VISIBLE, PATCH_WORDS } from '../../../../visibility/tessellation/contract.ts'
import { DICE_PATCH_WGSL, DISPLACE_UV } from '../../../../visibility/tessellation/diceSetupWgsl.ts'
import { pointDisplacement } from '../../../../visibility/tessellation/domainWgsl.ts'
import { PATTERN_PLAIN_WGSL } from '../../../../visibility/tessellation/patchWgsl.ts'
import { TESS_READ_PLAIN_WGSL } from '../../../../visibility/tessellation/queueWgsl.ts'
import { visTriangle } from '../../../../visibility/visWords.ts'
import { VSM_CONSTANTS_WGSL } from '../constants.ts'
import { VSM_PROJECTION_DATA_WGSL } from '../projection/projectionDataWgsl.ts'
import { VSM_CASTER_PROJECTION_WGSL } from '../render/renderCasterWgsl.ts'
import { VSM_RENDER_OUT_WGSL, VSM_RENDER_RASTER_VERTEX_SPECS } from '../render/renderRasterWgsl.ts'
import { vsmBindingsWgsl } from '../resources.ts'
import type { VsmLayout } from '../layout.ts'
import { VSM_TESS_VIEW_WGSL } from './shadowViewWgsl.ts'

/**
 * THE SHADOW MAPS' DRAW OF THE PATCHES, the vertex stage of a hardware raster into the same dummy
 * attachment as the casters' tiers (`../render/renderRasterWgsl.ts`), its fragment stage theirs
 * (`vsmRenderFs`, a module of its own: `VsmRenderOut` is the one interface). One instance a visible
 * patch (`vsmTessSplit` listed them), `3 × the most triangles of a pattern` vertices an instance
 * (`vsmTessDrawArgs`): vertex k of an instance is corner `k % 3` of triangle `k / 3` of the pattern
 * the patch's edge factors pick — the factors, the pattern and the dicing are the image's
 * (`dicePatch`, `diceVertex`) over the map's view —, a triangle past the pattern's dropped. Each
 * vertex dices on its own: the same barycentric point of the same patch is the same displaced point
 * whichever triangle asks for it, so neighbours meet. The point is pushed along its normal by the
 * displacement, the least one where the fade has not left it whole (`pointDisplacement`), then
 * placed on the pair's page as a caster's corner is (`vsmRenderVs`): same swap of a back face, a
 * two-sided row's second copy swapped once more, same emitter envelope. A masked row is not
 * tessellated here — the map's vertex stage binds the eight storage buffers a device holds at
 * least, with none to spare for the colour atlas — and draws as its triangles.
 *
 * Group 0 the shadow page group (`../../casters/pageGroup.ts`), 1 the pairs and the projections
 * (`makeRaster`), 2 the tessellation's: its uniform, its `tess` buffer, the data atlas and its
 * sampler (`TESS_PROGRAMS.shadowRaster`).
 */
export const vsmTessellatedVertexWgsl = (layout: VsmLayout) =>
  wgslProgram(
    /* wgsl */ `
${PAGE_BINDING.indices}
${PAGE_BINDING.positions}
${PAGE_BINDING.pages}
@group(0) @binding(${VIS_BINDINGS.uv}) var<storage,read> uvs:array<f32>;
@group(1) @binding(0) var<storage,read> vsmRenderPairs:array<vec4u>;
@group(2) @binding(${B.tessUniform}) var<uniform> tu:TessUni;
@group(2) @binding(${B.tess}) var<storage,read> tess:array<u32>;
${tileDeclarations(B.data, 'data', 2)}
@group(2) @binding(${B.sampler}) var mapsSampler:sampler;
@vertex fn vsmTessellatedVs(@builtin(vertex_index) vertexIndex:u32,@builtin(instance_index) instance:u32)->VsmRenderOut{
 var out:VsmRenderOut;
 out.position=vsmRenderNan();out.row=0u;out.uv=vec2f(0.0);out.dest=vec2u(0u);out.fromEmitter=vec4f(0.0);out.masked=0u;
 if(instance>=min(tw(tu.args+${ARG_VISIBLE}u),tu.maxVisible)){return out;}
 let piece=loadPatch(tu.visible+instance*${PATCH_WORDS}u);
 let pair=vsmRenderPairs[piece.x>>8u];
 let page=pages[pair.x];
 let h=pageHeaderFor(page,true);
 let rec=displacementOf(page);
 let corners=pageTriangle(page,h,visTriangle(piece.x));
 let raw=vsmProjectionData[pair.y&0xFFFFu];
 let view=vsmTessView(raw,(pair.y>>16u)&7u);
 let d=dicePatch(page,rec,piece,view,pageTrianglePositions(page,h,corners),
  mat3x3f(pageNormal(page,h,corners.x),pageNormal(page,h,corners.y),pageNormal(page,h,corners.z)),
  mat3x2f(displaceUv(page,h,corners.x,rec.map.y),displaceUv(page,h,corners.y,rec.map.y),displaceUv(page,h,corners.z,rec.map.y)));
 let n=patternTriangles(d.pattern);
 let t=vertexIndex/3u;
 if(t>=select(n,2u*n,(page.flags&${FLAG_DOUBLE}u)!=0u)){return out;}
 let second=t>=n;
 var corner=vertexIndex%3u;
 if(corner!=0u&&bitIsSet(pair.y,22u)!=second){corner=3u-corner;}
 let c=patternCorners(d.pattern,select(t,t-n,second));
 let at=diceVertex(d,rec,view,select(select(c.z,c.y,corner==1u),c.x,corner==0u));
 let world=at.point.world+at.point.normal*pointDisplacement(at.point,at.height,rec.scale,d.fade,true);
 let shifted=vsmRenderShifted(raw,world);
 out.row=pair.x;
 out.dest=vec2u(pair.w,bitAt(pair.y,21u));
 out.fromEmitter=vec4f(shifted,select(raw.emitterSize,0.0,raw.lightViewToClip[3][3]>=1.0));
 let clip=vsmRenderClip(raw,shifted,bitIsSet(pair.y,20u));
 let mipLevel=(pair.y>>16u)&7u;
 let s=f32(VSM_LEVEL0_TEXELS>>mipLevel)/f32(VSM_PAGE_TEXELS/2u);
 let vPage=vec2f(f32(byteOf(pair.z,0u)),f32(byteOf(pair.z,1u)));
 out.position=vec4f(clip.x*s-clip.w*(2.0*vPage.x+1.0),clip.w*(2.0*vPage.y+1.0)-clip.y*s,clip.z,clip.w);
 return out;
}
`,
    [
      VSM_RENDER_OUT_WGSL,
      PAGE_INFO_WGSL,
      VSM_CASTER_PROJECTION_WGSL,
      VSM_CONSTANTS_WGSL,
      VSM_PROJECTION_DATA_WGSL,
      vsmBindingsWgsl(1, VSM_RENDER_RASTER_VERTEX_SPECS, layout),
      PAGE_GEOMETRY_WGSL,
      PAGE_NORMAL_WGSL,
      normalAtlasWgsl(VIS_BINDINGS.normals),
      DISPLACE_UV,
      SHADOW_TILE_POOL_WGSL,
      dataSampleWgsl(SHADOW_TILE_POOL_WGSL),
      TESS_READ_PLAIN_WGSL,
      PATTERN_PLAIN_WGSL,
      DICE_PATCH_WGSL,
      pointDisplacement,
      VSM_TESS_VIEW_WGSL,
      visTriangle,
      byteOf,
      bitAt,
      bitIsSet,
    ],
  )
