import { wgslProgram } from '../../../../../math/src/wgsl/assemble.ts'
import { wgslFn, wgslStruct } from '../../../../../math/src/wgsl/decl.ts'
import { linearToSrgb } from '../../../../../math/src/wgsl/color.ts'
import { CARD_TILE_SIZE } from '../../../../../sdk-core/src/lighting/surfaceCache/cardResolution.ts'
import { FULLSCREEN_VERTEX } from '../../../gpu/shader/fullscreenTriangle.ts'
import type { LightAtlasFormat } from '../../../gpu/core/lightAtlasFormat.ts'
import { VIEW_RAY_WGSL, VIEW_WGSL } from '../../deferred/worldAtWgsl.ts'
import { BOUNCE_CM_WGSL } from '../../bounce/tracedHitWgsl.ts'
import { TILE_COORD_OF } from '../lighting/commonWgsl.ts'
import { CONTEXT_AT, LIGHTING_PARAMS } from '../lighting/layout.ts'
import {
  surfaceHitBindingsFrom,
  surfaceHitCardsWgsl,
  surfaceHitWgsl,
  type SurfaceHitBindings,
} from '../hitWgsl.ts'
import { visualizeOutputOf } from '../visualizeModes.ts'
import { gpuLineColor, gpuLineSink } from './gpuLines.ts'
import { visualizeTonemapWgsl } from './visualizeTonemap.ts'

/**
 * THE CARD UNDER THE CURSOR (`surfaceCacheCursorCard`, `surfaceCacheViewCards`, `surfaceCacheViewTiles`): one thread sends the ray of the cursor's pixel through the global field and
 * reads which card, page and place of the atlas the cards give the hit (`debugCursorCard`, the found words); a thread a listed page and a listed tile of the direct update then appends the
 * boxes (`debugCardOutlines`): the cards in green, the card found in red, the tiles in yellow, the tile found in purple, and the frame of the preview; the preview is drawn by
 * `cursorCardPreviewWgsl` at the bottom left of the image. A page's tile is cut in the page's part of the card, so a card of several pages has every tile where it is.
 */

/** The bindings of the pick and outlines program: the query, the found words, the view, the lighting parameters, the update context and the lines' two buffers; the hit's reads begin at `HIT_FIRST`. */
export const CURSOR_CARD_BINDINGS = {
  query: 0,
  found: 1,
  view: 2,
  params: 3,
  context: 4,
  lines: 5,
  count: 6,
} as const
const B = CURSOR_CARD_BINDINGS
const HIT_FIRST = 8
export const cursorCardHit = (): SurfaceHitBindings => surfaceHitBindingsFrom(0, HIT_FIRST)

/** The words of the query: the cursor and the display's size, then the flags (x the cards, y the tiles, z whether the preview's light goes through the composition's table, w whether the preview is drawn, which its frame follows). */
export const CURSOR_CARD_QUERY_WORDS = 8
/** The side of the preview's longer edge in pixels. */
export const CURSOR_CARD_PREVIEW = 256
/** The found words: the card, the page, the two coordinates of the atlas place; the card all ones where none was found. */
export const CURSOR_CARD_FOUND_WORDS = 4

const NONE = '0xffffffffu'
const GREEN = gpuLineColor(0, 1, 0)
const RED = gpuLineColor(1, 0, 0)
const YELLOW = gpuLineColor(1, 1, 0)
const PURPLE = gpuLineColor(0.63, 0.13, 0.94)

const CURSOR_QUERY = wgslStruct('CursorQuery', [], 'struct CursorQuery{cursor:vec4f,flags:vec4u}')
/** The size of the preview of a card of half extent `half`: the longer edge `CURSOR_CARD_PREVIEW` pixels, the other in proportion. */
const PREVIEW_SIZE = wgslFn(
  'previewSize',
  [],
  `fn previewSize(half:vec2f)->vec2f{
 let extent=max(half,vec2f(1e-6));
 if(extent.y<extent.x){return vec2f(${CURSOR_CARD_PREVIEW}.0,floor(${CURSOR_CARD_PREVIEW}.0*extent.y/extent.x));}
 return vec2f(floor(${CURSOR_CARD_PREVIEW}.0*extent.x/extent.y),${CURSOR_CARD_PREVIEW}.0);
}`,
)
/** The query's uniform and the found words, the declarations `CURSOR_QUERY` and `PREVIEW_SIZE` the program lists. */
const queryVars = (binding: number, found: number, access: string) =>
  `@group(0) @binding(${binding}) var<uniform> query:CursorQuery;
@group(0) @binding(${found}) var<storage,${access}> found:array<u32,${CURSOR_CARD_FOUND_WORDS}>;`

/** The pick and the outlines, the hit's final light stored in the format `light`, the field's coarse mip read through the hardware's filter where
 *  `filterableMip`, as in the layout (`cursorCard.ts`). */
export const cursorCardWgsl = (light: LightAtlasFormat, filterableMip: boolean) =>
  wgslProgram(
    `${LIGHTING_PARAMS.wgsl}
${queryVars(B.query, B.found, 'read_write')}
@group(0) @binding(${B.view}) var<uniform> view:View;
@group(0) @binding(${B.params}) var<uniform> lp:LightingParams;
@group(0) @binding(${B.context}) var<storage,read> ctx:array<u32>;
@compute @workgroup_size(1) fn debugCursorCard(){
 for(var k=0u;k<${CURSOR_CARD_FOUND_WORDS}u;k++){found[k]=${NONE};}
 if(query.cursor.x<0.0||query.cursor.y<0.0||gdfView.clipmaps==0u){return;}
 let pixel=query.cursor.xy/query.cursor.zw*view.viewport.xy;
 let d=viewRay(pixel,view.viewport.xy);
 let spread=length(viewRay(pixel+vec2f(1.0,0.0),view.viewport.xy)-d);
 let start=viewRayStart(pixel,view.viewport.xy)*f32(BOUNCE_CM);
 let marched=gdfTraceRay(start,d,0.01,1048576.0,1.0,false,false,vec2u(0u),0.0);
 if(marched.hitTime<0.0){return;}
 let hit=scGlobalTaken(start,d,marched,spread,false,-1.0,false);
 if(!hit.taken.best.valid){return;}
 found[0]=hit.taken.best.card;
 found[1]=hit.taken.best.page;
 found[2]=bitcast<u32>(hit.taken.best.uv.x);
 found[3]=bitcast<u32>(hit.taken.best.uv.y);
}
fn cardQuad(card:u32,lo:vec2f,hi:vec2f,color:u32){
 let c=scCard(card);
 // The lines are relative to the eye: the eye of a perspective view, the point of the plane through it of an orthographic one.
 let eye=viewEye();
 let a=scCardWorld(c,lo,0.0)/f32(BOUNCE_CM)-eye;
 let b=scCardWorld(c,vec2f(hi.x,lo.y),0.0)/f32(BOUNCE_CM)-eye;
 let e=scCardWorld(c,hi,0.0)/f32(BOUNCE_CM)-eye;
 let f=scCardWorld(c,vec2f(lo.x,hi.y),0.0)/f32(BOUNCE_CM)-eye;
 gpuLineWorld(a,b,color);
 gpuLineWorld(b,e,color);
 gpuLineWorld(e,f,color);
 gpuLineWorld(f,a,color);
}
@compute @workgroup_size(64) fn debugCardOutlines(@builtin(global_invocation_id) id:vec3u){
 let i=id.x;
 let valid=found[0]!=${NONE};
 if(i==0u&&valid){
  cardQuad(found[0],vec2f(0.0),vec2f(1.0),${RED});
  if(query.flags.w!=0u&&scPageW(found[1],0u)!=${NONE}){
   let size=previewSize(scCard(found[0]).extent.xy);
   gpuLineRect(vec2f(0.0,query.cursor.w-size.y),vec2f(size.x,query.cursor.w),${YELLOW});
  }
 }
 if(query.flags.x!=0u&&i<ctx[${CONTEXT_AT.pagesListed}u]){
  let card=scPageW(ctx[lp.directPagesAt+i],0u);
  if(card!=${NONE}&&!(valid&&card==found[0])){cardQuad(card,vec2f(0.0),vec2f(1.0),${GREEN});}
 }
 if(i>=ctx[${CONTEXT_AT.listed}u]||(query.flags.y==0u&&!valid)){return;}
 let word=ctx[lp.directAt+i];
 let page=word&0xffffffu;
 let card=scPageW(page,0u);
 if(card==${NONE}){return;}
 let tile=vec2f(tileCoordOf(word));
 let tiles=vec2f(scPageF(page,2u),scPageF(page,3u))/${CARD_TILE_SIZE}.0;
 let part=vec4f(scPageF(page,4u),scPageF(page,5u),scPageF(page,6u),scPageF(page,7u));
 let lo=mix(part.xy,part.zw,tile/tiles);
 let hi=mix(part.xy,part.zw,(tile+vec2f(1.0))/tiles);
 if(query.flags.y!=0u){cardQuad(card,lo,hi,${YELLOW});}
 if(valid&&page==found[1]){
  let rect=vec4f(scPageF(page,8u),scPageF(page,9u),scPageF(page,10u),scPageF(page,11u));
  let at=vec2f(bitcast<f32>(found[2]),bitcast<f32>(found[3]));
  let inside=(at-rect.xy)/(rect.zw-rect.xy);
  if(all(at>=rect.xy)&&all(at<=rect.zw)&&all(floor(inside*tiles)==tile)){cardQuad(card,lo,hi,${PURPLE});}
 }
}`,
    [
      CURSOR_QUERY,
      PREVIEW_SIZE,
      VIEW_WGSL,
      VIEW_RAY_WGSL,
      TILE_COORD_OF,
      BOUNCE_CM_WGSL,
      gpuLineSink(B.lines, B.count),
      surfaceHitWgsl(cursorCardHit(), light, filterableMip),
    ],
  )

/** The bindings of the preview: the query, the found words, the colour's four from `tone`, then the cards' reads from `PREVIEW_HIT_FIRST`. */
export const CURSOR_CARD_PREVIEW_BINDINGS = { query: 0, found: 1, tone: 2 } as const
const PREVIEW_HIT_FIRST = 8
export const cursorCardPreviewHit = (mode: number, compressed: boolean): SurfaceHitBindings => ({
  ...surfaceHitBindingsFrom(0, PREVIEW_HIT_FIRST),
  visualize: mode,
  compressed,
})

/** The card found, its layer of mode `mode` (a layer mode of `visualizeModes.ts`) at the bottom left of the image, scaled to the card's proportions; read at the coarse level the pick found the card at, nothing where that page is not mapped. */
export const cursorCardPreviewWgsl = (
  light: LightAtlasFormat,
  mode: number,
  compressed: boolean,
) => {
  const P = CURSOR_CARD_PREVIEW_BINDINGS
  const output = visualizeOutputOf(mode)
  const shown =
    output === 'srgb'
      ? 'saturate(linearToSrgb(value))'
      : output === 'raw'
        ? 'saturate(value)'
        : 'saturate(visualizeTonemap(value,query.flags.z!=0u))'
  return wgslProgram(
    `${queryVars(P.query, P.found, 'read')}
@fragment fn cursorCardPreviewFs(@builtin(position) at:vec4f)->@location(0) vec4f{
 if(found[0]==${NONE}){discard;}
 let card=scCard(found[0]);
 let size=previewSize(card.extent.xy);
 let local=at.xy-vec2f(0.0,query.cursor.w-size.y);
 if(any(local<vec2f(0.0))||any(local>=size)){discard;}
 let uv=(local+vec2f(0.5))/size;
 let s=scComputeSample(card,found[0],vec2f(uv.x,1.0-uv.y)*2.0*card.extent.xy-card.extent.xy,1.0,false);
 if(!s.valid){discard;}
 let invPre=max(scF(SC_AT_INV_PRE_EXPOSURE),1e-12);
 let value=scVisualCard(card,found[0],s,scGatherBase(s.uv),s.weights,invPre);
 return vec4f(${shown},1.0);
}`,
    [
      CURSOR_QUERY,
      PREVIEW_SIZE,
      surfaceHitCardsWgsl(cursorCardPreviewHit(mode, compressed), light),
      visualizeTonemapWgsl(P.tone),
      linearToSrgb,
      FULLSCREEN_VERTEX,
    ],
  )
}
