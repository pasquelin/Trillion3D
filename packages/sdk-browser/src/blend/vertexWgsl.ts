import {
  BLEND_GIVEN_UP_WGSL,
  TRI_CHANNELS_SHIFT,
  TRI_GIVEN_UP_SHIFT,
  VERTEX_LISTS_WGSL,
  VERTEX_READS_WGSL,
  vsOutWgsl,
} from './vertexReadsWgsl.ts'
import * as itemFlags from '../visibility/types.ts'
import * as surfaceModel from '../materials/surface/surfaceModel.ts'
import { NORMAL_TRANSFORM_WGSL } from '../lighting/standardLighting.ts'
import { DIAGNOSTIC_VIEWS } from '../visibility/shader/shadeMode.ts'
import { DIAGNOSTIC_PALETTE_WGSL } from '../diagnostic/colors.ts'
import { PAGE_GEOMETRY_WGSL } from '../visibility/shader/pageGeometryWgsl.ts'
import { PAGE_UV_SET_WGSL } from '../visibility/shader/pageUvSetWgsl.ts'
import { MAP_CHANNEL_WGSL } from '../visibility/shader/physicalWgsl.ts'
import { SURFACE_MAP_FIELDS } from '../visibility/materialType.ts'
import { INSTANCE_CULL_SHIFT, INSTANCE_ITEM_MASK } from './runs.ts'
import { FACING_DROP, FACING_MATERIAL_MASK, FACING_SHIFT, FACING_WGSL } from './facing.ts'
import { ITEM_FLAG_BITS, ITEM_HISTORY_SHIFT, ITEM_HLOD } from './items.ts'
import { clipReturn, clipReturnType, cutByPixel, type Clipping } from '../gpu/core/clipDistances.ts'
import { planeDistance } from '../../../math/src/wgsl/geometry.ts'
import { wgslBlock, wgslFn } from '../../../math/src/wgsl/decl.ts'
import { unitOrZero } from '../../../math/src/wgsl/inverseTranspose.ts'
import { lowBits } from '../../../math/src/wgsl/integer.ts'
import { cornerBarycentric } from '../../../math/src/wgsl/barycentric.ts'

/** The diagnostic view a transparent fragment draws (`DIAGNOSTIC_VIEWS`), out of its frame flags
 *  (`DIAGNOSTIC_CODE_SHIFT`): zero in the image. */
const BLEND_DIAGNOSTIC_CODE_WGSL = wgslBlock(
  'BLEND_DIAGNOSTIC_CODE_WGSL',
  [],
  `fn blendDiagnosticCode(flags:u32)->u32{return (flags>>${itemFlags.DIAGNOSTIC_CODE_SHIFT}u)&${itemFlags.DIAGNOSTIC_CODE_MASK}u;}`,
)

/** The texture set past the first that the least map of a channels word reading one names
 *  (`channelsOf`, glTF's `texCoord`), 0 for none: the one set past the first a transparent vertex
 *  carries (its varyings hold two sets). */
const CHANNELS_ALT_WGSL = wgslFn(
  'channelsAlt',
  [MAP_CHANNEL_WGSL],
  `fn channelsAlt(channels:u32)->u32{
 var alt=0u;
 for(var i=16u;i>0u;i--){
  let s=mapChannel(channels,i-1u);
  if(s!=0u){alt=s;}
 }
 return alt;
}`,
)

/** The maps of a channels word that read a set past the first, one bit a map in
 *  `SURFACE_MAP_FIELDS` order (what a fragment tests, `blendUv`). */
const CHANNELS_READ_WGSL = wgslFn(
  'channelsRead',
  [MAP_CHANNEL_WGSL],
  `fn channelsRead(channels:u32)->u32{
 var read=0u;
 for(var i=0u;i<${SURFACE_MAP_FIELDS.length}u;i++){
  if(mapChannel(channels,i)!=0u){read|=1u<<i;}
 }
 return read;
}`,
)

/** A lobed program's two UV sets of the vertex: the first, and the set its surface's maps or its
 *  lobes' maps read past it (`channelsAlt`, the record's `channels`, glTF's `texCoord`) where its
 *  geometry stores it — the only fragments that read it (`blendPhysicalBegin`, `blendUv`), every
 *  map past the first set reading this one —, and the maps that read it in `tri`
 *  (`TRI_CHANNELS_SHIFT`). All are read with the record the stage reads already (`materialAt`). */
const UV_PAIR = `let uv0=pageUv(page,h,v);var uv1=uv0;
 var alt=channelsAlt(m.channels);
 if(alt==0u&&m.lobes!=0u){alt=channelsAlt(physicalAt(m.lobes).channels);}
 if(alt!=0u&&pageHasUvSet(page,h,alt)){uv1=pageUvSet(page,h,v,alt,normalTexels());}
 out.uv=vec4f(uv0,uv1);out.tri|=channelsRead(m.channels)<<${TRI_CHANNELS_SHIFT}u;`

/** What a lobed program's vertex stage adds (`blendVertexWgsl`): the second UV set beside the
 *  first, the item's material word beside its ids and in its page, and their reads. */
const LAYOUTS = {
  lobed: {
    uv: 'vec4f',
    ids: 'vec4u',
    word: ',it.material',
    page: 'page.material=it.material;',
    read: [PAGE_UV_SET_WGSL, CHANNELS_ALT_WGSL, CHANNELS_READ_WGSL],
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
 * blend stages (`shader.ts`), so each draws the same fragments; only their fragment stages differ.
 *
 * With `lobes`, a lobed program's (`physicalWgsl.ts`): `uv` carries a second UV set in its last
 * two lanes (`pageUvSet`, the first where the geometry has none) and `ids` the item's material word
 * in its fourth — no varying more, a fragment stage reading its front face holding fifteen of the
 * sixteen WebGPU guarantees. Without `clipping`, the stage as it was, word for word: the text of a
 * session whose project switch is off. Cutting at the view's plane by distance, the stage returns the struct
 * that carries the distance of its vertex to the plane (`vsOutWgsl`); by pixel, `blendClipped` tells
 * a fragment stage the pixel behind it (`../gpu/core/clipDistances.ts`).
 */
export const blendVertexWgsl = (lobes: boolean, clipping?: Clipping) => {
  const layout = LAYOUTS[lobes ? 'lobed' : 'lobeless']
  return wgslBlock(
    `blendVertexWgsl(${lobes}${clipping ? `, ${clipping}` : ''})`,
    [
      PAGE_GEOMETRY_WGSL,
      NORMAL_TRANSFORM_WGSL,
      unitOrZero,
      VERTEX_READS_WGSL,
      ...layout.read,
      VERTEX_LISTS_WGSL,
      vsOutWgsl(layout.uv, layout.ids, clipping),
      DIAGNOSTIC_PALETTE_WGSL,
      BLEND_DIAGNOSTIC_CODE_WGSL,
      BLEND_GIVEN_UP_WGSL,
      FACING_WGSL,
      lowBits,
      cornerBarycentric,
      ...(clipping ? [planeDistance] : []),
    ],
    `${blendVertexStage(layout, clipping)}${clipping === 'pixel' ? BLEND_CLIPPED : ''}`,
  )
}

/** The cluster's span, the corners of its triangle and its facing; a padding lane reads none. */
const VERTEX_PAGE = ` let span=clusterSpans[slot.y];
 page.pageOffset=span.x;page.deformOutput=span.z;page.deformCount=span.w;
 let count=span.y;
 // A padding lane past the cluster's corners reads nothing, not even the page header.
 var h:ClusterHeader;
 var corners=vec3u(0u);var facing=0u;
 if(local<count){
  h=pageHeader(page);
  corners=pageTriangle(page,h,local/3u);
  if(cull!=0u){facing=vertexFacing(cull,it.world,page,h,corners);}
 }
 out.material=(it.material&${FACING_MATERIAL_MASK}u)|(facing<<${FACING_SHIFT}u);`

/** The corner's colour, position, diagnostics and frame. */
const VERTEX_CORNER = ` let v=corners[local%3u];
 // The material colour times the vertex colour, alpha included, as the forward path reads it.
 if((flags&${itemFlags.FLAG_HAS_COLOR}u)!=0u){out.color*=pageColor(page,h,v);}
 let p=pagePosition(page,h,v);
 let world=it.world*vec4f(p,1.0);
 out.position=uni.viewProj*world;out.view=world.xyz;
 // A line quad widens on screen (\`lineClip\`), along the direction its corner's normal carries.
 if(m.lineWidth>0.0){out.position=lineClip(out.position,uni.viewProj*(it.world*vec4f(pageNormal(page,h,v),0.0)),m.lineWidth,uni.viewport,uni.pixelRatio);}
 // A sprite's quad turns to face the camera (\`spriteAt\`), about its origin.
 if(m.sprite.y!=0.0){let s=spriteAt(uni.viewProj,it.world,p.xy,m.sprite);out.position=uni.viewProj*s;out.view=s.xyz;}
 // The triangle's rank, and above it the item's history share code (\`TRI_GIVEN_UP_SHIFT\`).
 out.tri=(local/3u)|(((it.flags>>${ITEM_HISTORY_SHIFT}u)&${itemFlags.HISTORY_SHARE_MASK}u)<<${TRI_GIVEN_UP_SHIFT}u);
 // The diagnostic views' cluster word and triangle (\`diagnosticColor\`), the opaque resolve's:
 // the screen-error view's word turned to the cluster's world error, which needs the item's world.
 // Read in a diagnostic view alone: a test of the image's view flags, the same for every lane.
 if((uni.viewFlags&${itemFlags.FLAG_DIAGNOSTIC_VIEW}u)!=0u){
  out.diagId=clusterDiagnostic[slot.y];
  // The HLOD view's word, of a placement drawn as an HLOD level (\`ITEM_HLOD\`).
  if(blendDiagnosticCode(uni.viewFlags)==${DIAGNOSTIC_VIEWS.hlod.code}u){out.diagId=diagnosticDrawnAs(out.diagId,(it.flags>>${ITEM_HLOD.shift}u)&${ITEM_HLOD.mask}u);}
  if(blendDiagnosticCode(uni.viewFlags)==${DIAGNOSTIC_VIEWS['screen-error'].code}u){out.diagId=bitcast<u32>(diagnosticWorldError(out.diagId,it.world));}
 }
 out.bary=cornerBarycentric(local%3u);
 out.normal=vec4f(vec3f(0.0),out.normal.w);
 if((flags&${itemFlags.FLAG_HAS_NORMAL}u)!=0u){out.normal=vec4f(xformNormal(it.world,pageNormal(page,h,v)),out.normal.w);}
 out.tangent=vec4f(vec3f(0.0),out.tangent.w);out.bitangent=vec4f(vec3f(0.0),out.bitangent.w);
 if((flags&${itemFlags.FLAG_BACK}u)!=0u){out.normal=vec4f(-out.normal.xyz,out.normal.w);}
 // An item that reads a tangent reads its page's stored one or its source's floats (\`pageTangent\`);
 // one without carries no flag (\`prepare.ts\`), its frame rebuilt from the screen (\`shaderSurface.ts\`).
 if((flags&${itemFlags.FLAG_HAS_TANGENT}u)!=0u){
  let t=pageTangent(page,h,v);
  out.tangent=vec4f(unitOrZero((it.world*vec4f(t.xyz,0.0)).xyz),out.tangent.w);
  if((flags&${itemFlags.FLAG_BACK}u)!=0u){out.tangent=vec4f(-out.tangent.xyz,out.tangent.w);}
  out.bitangent=vec4f(unitOrZero(cross(out.normal.xyz,out.tangent.xyz)*t.w),out.bitangent.w);
 }`

/**
 * The vertex stage of a layout (`LAYOUTS`). An instance draws a cluster compaction kept, as the
 * list plan expansion wrote it (`expand/expandWgsl.ts`), read through `pageGeometryWgsl.ts`. The rank of
 * the first instance of the call is read in the high bits of the vertex index, and the local rank
 * of the vertex in the low: the indirect argument of a slice starts at vertex base << vertexShift.
 * That is what lets a whole slice fit in ONE call, with nothing to bind between two plan entries —
 * firstInstance would say the same, but WebGPU only opens it to an indirect call under an
 * extension.
 */
const blendVertexStage = (
  { ids, word, page, write }: (typeof LAYOUTS)['lobed'],
  clipping?: Clipping,
) => `@vertex fn vs(@builtin(vertex_index) vertexIndex:u32,@builtin(instance_index) instance:u32)->${clipReturnType('VSOut', clipping)}{
 var out:VSOut;
 let slot=planInstances[(vertexIndex>>uni.vertexShift)+instance];
 let it=items[slot.x&${INSTANCE_ITEM_MASK}u];
 let cull=slot.x>>${INSTANCE_CULL_SHIFT}u;
 let local=vertexIndex&lowBits(uni.vertexShift);
 let flags=(it.flags&${ITEM_FLAG_BITS}u)|uni.viewFlags;
 var page:PageInfo;
 page.flags=flags;page.vertexBase=it.vertexBase;page.deform=it.deform;${page}
${VERTEX_PAGE}
 // A padding or dropped lane leaves the clip volume; every output but \`material\` and the normal
 // stays zero, as declared.
 if(local>=count||facing==${FACING_DROP}u){out.position=vec4f(0.0,0.0,2.0,1.0);out.normal=vec4f(0.0,0.0,1.0,0.0);return ${clipReturn('VSOut', clipping, 'out', '1.0')};}
 // Its surface's record (\`materialAt\`): its factors, maps, model and fog, read once a drawn
 // vertex, never by a padding or dropped lane.
 let m=materialAt(it.material);
 out.color=vec4f(m.baseColor,m.opacity);
 out.ids=${ids}(m.mapIndex,flags|(m.model<<${surfaceModel.MODEL_SHIFT}u),m.emissiveIndex${word});
 out.maps=vec4u(m.roughnessIndex,m.metalnessIndex,m.normalIndex,m.aoIndex);
 out.alphaAo=vec4f(m.alphaTest,m.aoIntensity,m.dash);
 // The second normal factor of the frame the item's normal map is read in (\`frameNormalScaleY\`).
 out.pbr=vec4f(m.roughness,m.metalness,m.normalScale,select(m.normalScaleY,m.tangentNormalScaleY,(it.flags&${itemFlags.FLAG_HAS_TANGENT}u)!=0u));
 out.emissive=vec4f(m.emissive,f32(m.subsurfaceMap));
 out.normal.w=m.subsurface.x;out.tangent.w=m.subsurface.y;out.bitangent.w=m.subsurface.z;
${VERTEX_CORNER}
 ${write}
 return ${clipReturn('VSOut', clipping, 'out', 'planeDistance(uni.clipPlane,out.view)')};
}`

/** Whether a fragment of a module that cuts by pixel lies behind the view's plane, from its world
 *  position (\`view\`); a distance of zero is kept. */
const BLEND_CLIPPED = `
fn blendClipped(in:VSOut)->bool{return planeDistance(uni.clipPlane,in.view)<0.0;}
`

/** `code`, a blend module, as it cuts at the view's plane (`clipping`): by pixel, each fragment entry
 *  leaves the pixel behind it (`blendClipped`); as it is by distance, or not at all. */
export const cutBlendByPixel = (code: string, clipping?: Clipping) =>
  cutByPixel(code, 'VSOut', 'if(blendClipped(in)){discard;}', clipping)
