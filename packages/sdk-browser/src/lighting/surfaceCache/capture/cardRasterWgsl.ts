import { wgslProgram } from '../../../../../math/src/wgsl/assemble.ts'
import { wgslConsts } from '../../../../../math/src/wgsl/consts.ts'
import { wgslFn } from '../../../../../math/src/wgsl/decl.ts'
import { FLAT_INDEX_WGSL, WORKGROUP_THREADS_WGSL } from '../../../gpu/dispatch/grid.ts'
import { SMALL_BINDINGS } from '../../../gpu/bind/bindLayout.ts'
import { PAGE_INFO_STRUCT_WGSL, VIS_UNIFORMS_WGSL } from '../../../visibility/shader/pageWgsl.ts'
import { PAGE_GEOMETRY_WGSL } from '../../../visibility/shader/pageGeometryWgsl.ts'
import { FLAG_DOUBLE } from '../../../visibility/types.ts'
import { visTriangle } from '../../../visibility/visWords.ts'
import { MODE_DEPTH, MODE_ID, rasterEntry } from '../../../visibility/raster/contract.ts'
import { RASTER_TRI_WGSL } from '../../../visibility/raster/triWgsl.ts'
import {
  VIS_KEY_WGSL,
  pixelOffset,
  visWorkDeclaration,
  visWriteWgsl,
} from '../../../visibility/raster/pixelWgsl.ts'
import {
  clusterRasterKernels,
  type ClusterRasterTarget,
} from '../../../visibility/raster/clusterWgsl.ts'
import { VISIBLE_LAYOUT_WGSL } from '../../../geometry/dag/visible/layout.ts'
import { VIRTUAL_PAGE_SIZE } from '../../../../../sdk-core/src/lighting/surfaceCache/cardResolution.ts'
import { CAPTURE_FORMATS } from '../layout.ts'
import {
  CARD_TABLE_HEAD,
  CARD_VIEW,
  CARD_VIEW_READ_WGSL,
  CARD_VIEW_WORDS,
} from './cardViewTable.ts'

/**
 * THE RASTER OF THE CARDS' VIEWS: the engine's software raster of clusters
 * (`../../../visibility/raster/clusterWgsl.ts`), a group a decoded cluster — one record for each view
 * that draws a cluster (`cardDescentWgsl.ts`), its view the rank its row names in `depthBias`
 * (`cardRows`) —, writing the visibility buffer by the camera's own rule (`visWriteWgsl`: the depth
 * phase, `MODE_DEPTH`, then the identifier phase, `MODE_ID`, which writes the greatest identifier
 * among the nearest). What differs from the camera's is the target (`ClusterRasterTarget`):
 *  - the row is the thread group's own rank, the rows the table's head holds (`lists`);
 *  - a corner is placed by the view of its row on the picture of its page (`rasterViewport` is the
 *    picture's size, the box a triangle keeps the whole of it: `rasterSpan`), and a pixel joins the
 *    atlas's buffer at the picture's place (`rect`);
 *  - a card is captured as its surface is, whichever side of a triangle faces the view: no face is
 *    culled (`cardSides`);
 *  - the view's box is the card's volume: a pixel of a depth outside [0, 1] is not drawn, the depth
 *    being the engine's reversed depth, 1 at the card's outer face and 0 at its inner one.
 * The bindings are the camera raster's (`rasterLayoutEntries`), its `lists` the table of views, its
 * uniform's viewport the atlas.
 */
const cardTarget = (): ClusterRasterTarget => ({
  item: 'groupRow=select(NONE,at,at<lists[0]);',
  itemOwn: `cardRowView=cardViewOf(pages[row].depthBias);
 cardFrame=vec2f(cardRowView.rect.zw);`,
  frame: 'let vp=cardRowView.viewProj*page.world;\n let det=1.0;',
  clip: (v) => `vp*vec4f(pagePosition(page,h,${v}),1.0)`,
  setupPage: 'cardSides(page)',
  triangle: '',
  masked: 'false',
  entries: `@compute @workgroup_size(WORKGROUP_THREADS) fn ${rasterEntry(MODE_DEPTH)}(@builtin(workgroup_id) g:vec3u,@builtin(local_invocation_index) lane:u32,@builtin(num_workgroups) n:vec3u){clusterGroup(g,lane,n,${MODE_DEPTH}u);}
@compute @workgroup_size(WORKGROUP_THREADS) fn ${rasterEntry(MODE_ID)}(@builtin(workgroup_id) g:vec3u,@builtin(local_invocation_index) lane:u32,@builtin(num_workgroups) n:vec3u){clusterGroup(g,lane,n,${MODE_ID}u);}`,
})

const CARD_FRAME = wgslFn('rasterViewport', [], 'fn rasterViewport()->vec2f{return cardFrame;}')
/** The widest box a triangle keeps in a card's picture: the whole of a page, 128 pixels, less the first. */
const CARD_BOX = wgslFn('rasterSpan', [], `fn rasterSpan()->i32{return ${VIRTUAL_PAGE_SIZE};}`)

/** The view of a row, from the table of views (`lists`, behind its head). */
const viewText = `struct CardRasterView{viewProj:mat4x4f,rect:vec4u,}
var<private> cardRowView:CardRasterView;
var<private> cardFrame:vec2f;
${wgslConsts({ CARD_TABLE_HEAD, CARD_VIEW_WORDS })}
fn cardWord(v:u32,k:u32)->u32{return lists[CARD_TABLE_HEAD+v*CARD_VIEW_WORDS+k];}
fn cardViewOf(v:u32)->CardRasterView{return CardRasterView(cardMatrix(v),cardRect(v));}
/** The page the setup reads its sides from: two-sided, no face is culled. */
fn cardSides(page:PageInfo)->PageInfo{var p=page;p.flags|=${FLAG_DOUBLE}u;return p;}
`

/** The pixel stage: the fragment of a triangle of the card's picture, joining the atlas's buffer. */
const pixelText = `
fn writePixel(t:Tri,pixel:vec2i,c:vec3f,mode:u32){
 if(pixel.x>t.maxPixel.x||pixel.y>t.maxPixel.y){return;}
 let plane=t.depth.x+t.depth.y*c.y+t.depth.z*c.z;
 // The view's volume is the card's: nothing before its outer face nor behind its inner one.
 if(!(plane>0.0&&plane<=1.0)){return;}
 let page=pages[t.row];
 let key=visKey(plane,0u);
 let offset=pixelOffset(vec2u(pixel)+cardRowView.rect.xy);
 let ids=mode==${MODE_ID}u;
 if(!visPasses(offset,key,ids)){return;}
 visWrite(offset,key,page.packedBase|visTriangle(t.triangle),ids);
}
`

/**
 * The raster's program; `subgroups` the device's subgroup operations. The capture draws every
 * surface through the fixed-function path — the programmable raster is off, as the reference's capture
 * turns it off —: no alpha mask cuts a row (`cardTarget`: no row is masked) and no world position offset
 * moves a vertex (`pageWpoLocal` stays its default of zero), whatever graphs the session holds.
 */
export const cardRasterSource = (subgroups = false) =>
  wgslProgram(
    `@group(0) @binding(${SMALL_BINDINGS.indices}) var<storage,read> indices:array<u32>;
@group(0) @binding(${SMALL_BINDINGS.positions}) var<storage,read> positions:array<f32>;
@group(0) @binding(${SMALL_BINDINGS.pages}) var<storage,read> pages:array<PageInfo>;
@group(0) @binding(${SMALL_BINDINGS.uniform}) var<uniform> uni:Uniforms;
@group(0) @binding(${SMALL_BINDINGS.uvs}) var<storage,read> uvs:array<f32>;
${visWorkDeclaration(false, SMALL_BINDINGS.work)}
// The table of views (\`cardViewTable.ts\`): the rows the image holds, then the views.
@group(0) @binding(${SMALL_BINDINGS.lists}) var<storage,read> lists:array<u32>;
${viewText}${pixelText}${clusterRasterKernels(subgroups, cardTarget())}`,
    [
      PAGE_INFO_STRUCT_WGSL,
      VIS_UNIFORMS_WGSL,
      PAGE_GEOMETRY_WGSL,
      RASTER_TRI_WGSL,
      CARD_FRAME,
      CARD_BOX,
      CARD_VIEW_READ_WGSL,
      VIS_KEY_WGSL,
      visWriteWgsl(false),
      pixelOffset,
      visTriangle,
      FLAT_INDEX_WGSL,
      WORKGROUP_THREADS_WGSL,
    ],
  )

/** The entry points of the rows' kernel and of the export. */
export const CARD_ROWS_ENTRY = 'cardRows'
export const CARD_EXPORT_ENTRY = 'cardExport'
export const CARD_EXPORT_VIEWS_ENTRY = 'cardExportViews'

/**
 * THE ROWS' VIEWS: once the decode made a row of every cluster the cull listed, each row takes the
 * view that draws it — the tag its record held — in its `depthBias`, a word the passes after the
 * decode do not read for a card (the layers of coplanar surfaces are the camera's). Group 0: the
 * list of visible clusters, the decoded rows (written). A thread a record.
 */
export const cardRowsSource = () =>
  wgslProgram(
    `@group(0) @binding(0) var<storage,read> visible:array<u32>;
@group(0) @binding(1) var<storage,read_write> pages:array<PageInfo>;
@compute @workgroup_size(WORKGROUP_THREADS) fn ${CARD_ROWS_ENTRY}(@builtin(global_invocation_id) id:vec3u,@builtin(num_workgroups) n:vec3u){
 let v=flatIndex(id,n,WORKGROUP_THREADS);
 if(v>=visible[VIS_SW]){return;}
 pages[v].depthBias=visible[VISIBLE_HEADER_WORDS+VISIBLE_RECORD_WORDS*v+2u];
}`,
    [PAGE_INFO_STRUCT_WGSL, VISIBLE_LAYOUT_WGSL, FLAT_INDEX_WGSL, WORKGROUP_THREADS_WGSL],
  )

/**
 * THE EXPORT: the visibility buffer's two planes — the depth keys, then the identifiers — turned into the
 * capture atlas's textures over the rectangle of each view: the identifier of the nearest triangle
 * (`ids`, 0 where none) and its depth. A second entry writes each view's record into the identifier
 * texture's rows past the atlas (`pixelTriangleWgsl.ts`, `cardViewAt`). Group 0: the buffer, the table of
 * views, the two textures written, the atlas's side. Dispatch: 16 × 16 workgroups of 8 × 8 a view, the
 * views along z; the second entry one workgroup a view.
 */
export const cardExportSource = () =>
  wgslProgram(
    `@group(0) @binding(0) var<storage,read> work:array<u32>;
@group(0) @binding(1) var<storage,read> lists:array<u32>;
@group(0) @binding(2) var capIds:texture_storage_2d<${CAPTURE_FORMATS.ids},write>;
@group(0) @binding(3) var capDepth:texture_storage_2d<${CAPTURE_FORMATS.depth},write>;
@group(0) @binding(4) var<uniform> atlas:vec4u;
${wgslConsts({ CARD_TABLE_HEAD, CARD_VIEW_WORDS, RECT_AT: CARD_VIEW.at.rect })}
@compute @workgroup_size(8,8) fn ${CARD_EXPORT_ENTRY}(@builtin(workgroup_id) wid:vec3u,@builtin(local_invocation_id) lid:vec3u){
 let base=CARD_TABLE_HEAD+wid.z*CARD_VIEW_WORDS+RECT_AT;
 let rect=vec4u(lists[base],lists[base+1u],lists[base+2u],lists[base+3u]);
 let p=wid.xy*8u+lid.xy;
 if(p.x>=rect.z||p.y>=rect.w){return;}
 let at=rect.xy+p;
 let offset=at.y*atlas.x+at.x;
 let key=work[offset];
 let id=work[atlas.x*atlas.x+offset];
 textureStore(capIds,at,vec4u(id,0u,0u,0u));
 textureStore(capDepth,at,vec4f(bitcast<f32>(key),0.0,0.0,0.0));
}
@compute @workgroup_size(32) fn ${CARD_EXPORT_VIEWS_ENTRY}(@builtin(workgroup_id) wid:vec3u,@builtin(local_invocation_id) lid:vec3u){
 if(lid.x>=CARD_VIEW_WORDS){return;}
 textureStore(capIds,vec2u(lid.x,atlas.x+wid.x),vec4u(lists[CARD_TABLE_HEAD+wid.x*CARD_VIEW_WORDS+lid.x],0u,0u,0u));
}`,
    [],
  )
