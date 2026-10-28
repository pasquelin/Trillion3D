import { wgslProgram } from '../../../../math/src/wgsl/assemble.ts'
import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { TV_FRAME_WGSL, TV_TEXEL_WGSL } from './frameWgsl.ts'
import { TRANSLUCENCY_WORKGROUP, VOLUME_FORMAT } from './layout.ts'

/** Where the filters bind what they read and write, in group 0: the frame, the texture the injection wrote, a volume
 *  read (`volume`: the image before's for the temporal pass, the temporal pass's for the blur — a stand-in
 *  where the blur reads the injected light) and the volume written (`written`), all of the one layout (`VOLUME_FORMAT`). */
export const FILTER_BINDING = {
  frame: 0,
  injected: 1,
  volume: 2,
  written: 3,
  marks: 4,
  historyMarks: 5,
} as const
const b = FILTER_BINDING

/**
 * THE TWO FILTERS OF THE INJECTED LIGHT, in this order, each one thread a cell of either cascade, writing their result into the
 * texture the surfaces sample (`VOLUME_FORMAT`: the ambient light's four channels in one slab, the directional light's three in the next, `tvSlab`).
 *
 * `temporalMain`, where the temporal filter is on: the injected light is blended with the cell of the volume of the image
 * before that lies at the same point (the previous cascade's box, the cell the point falls in, `HistoryCoord`) by the
 * history's weight, none where the history has no such cell (the point is outside the previous cascade, the camera cut it) and,
 * in the outer cascade, fading with the border (`tvBorder`) so that the border cells, which light everything past the volume,
 * take no history. The history was written multiplied by the pre-exposure of its own image: brought to this one by the
 * ratio the frame holds. What it writes — before the blur — is the history of the image after.
 *
 * `spatialMain`, the blur where it is on, the default: each cell is the mean of eight trilinear reads of the light it
 * takes — the temporal filter's where that ran, the injected light else — a half cell either side of its centre along
 * each axis, which is its 3 × 3 × 3 neighbours weighed 1, 2, 1 along each axis (a quarter, a half, a quarter), the cascade's
 * edge held (a read past it takes the edge cell). The injection is one cell a light's cell, so the blur hides the cells'
 * squares. With the blur off it only packs the light it takes.
 *
 * Where the cells are marked (`tv.marks.x`, `translucencyVolumeMarkVoxels`) both filters write nothing but zero in a cell the dilated marks leave
 * empty, and the temporal filter takes no history from a cell the image before's marks left empty (`tv.marks.y`: it was never lit).
 */
const FILTER_WGSL = wgslBlock(
  'FILTER_WGSL',
  [TV_FRAME_WGSL, TV_TEXEL_WGSL],
  `
/** The cell \`c\` of cascade \`cascade\` held to the cascade, in the slab of \`kind\` of the stacked texture. */
fn tvAt(cascade:u32,kind:u32,c:vec3i)->vec3i{
 let dim=i32(tv.mode.x);
 let k=clamp(c,vec3i(0),vec3i(dim-1));
 return vec3i(k.xy,k.z+i32(tvSlab(cascade,kind))*dim);
}
/** The light of cell \`c\` of cascade \`cascade\` in the volume \`t\`. */
fn tvLoad(t:texture_3d<f32>,cascade:u32,c:vec3i)->TvTexel{
 return TvTexel(textureLoad(t,tvAt(cascade,0u,c),0),textureLoad(t,tvAt(cascade,1u,c),0).xyz);
}
/** The light \`t\` written to cell \`cell\` of cascade \`cascade\`. */
fn tvStore(cascade:u32,cell:vec3u,t:TvTexel){
 let dim=tv.mode.x;
 textureStore(tvWritten,vec3u(cell.xy,cell.z+tvSlab(cascade,0u)*dim),t.ambient);
 textureStore(tvWritten,vec3u(cell.xy,cell.z+tvSlab(cascade,1u)*dim),vec4f(t.directional,0.0));
}
/** The injected light of cell \`c\` of cascade \`cascade\`. */
fn tvInjected(cascade:u32,c:vec3i)->TvTexel{return tvLoad(tvInjectedIn,cascade,c);}
/** The light the blur takes at cell \`c\` of cascade \`cascade\`: the temporal filter's volume where that ran (\`mode.w\`), the injected light else. */
fn tvBlurred(cascade:u32,c:vec3i)->TvTexel{
 if(tv.mode.w!=0u){return tvLoad(tvVolume,cascade,c);}
 return tvInjected(cascade,c);
}
/** Whether cell \`c\` of cascade \`cascade\`, inside it, is marked in \`marks\`: the stacked marks hold the cascades one after the other along the depth. */
fn tvMarkedIn(marks:texture_3d<u32>,cascade:u32,c:vec3i)->bool{
 return textureLoad(marks,vec3i(c.xy,c.z+i32(cascade*tv.mode.x)),0).x!=0u;
}
/** A cell of no light, which the filters write where a cell is not marked. */
fn tvEmpty()->TvTexel{return TvTexel(vec4f(0.0),vec3f(0.0));}
/** The weight of the cell \`offset\` away along one axis in the blur: a quarter, a half, a quarter. */
fn tvBlurWeight(offset:i32)->f32{return select(0.25,0.5,offset==0);}
@compute @workgroup_size(${TRANSLUCENCY_WORKGROUP},${TRANSLUCENCY_WORKGROUP},${TRANSLUCENCY_WORKGROUP})
fn temporalMain(@builtin(global_invocation_id) id:vec3u){
 let dim=tv.mode.x;
 if(id.x>=dim||id.y>=dim||id.z>=dim*2u){return;}
 let cascade=id.z/dim;
 let cell=vec3i(i32(id.x),i32(id.y),i32(id.z%dim));
 if(tv.marks.x!=0u&&!tvMarkedIn(tvMarks,cascade,cell)){
  tvStore(cascade,vec3u(id.xy,id.z%dim),tvEmpty());
  return;
 }
 var value=tvInjected(cascade,cell);
 if(tv.mode.z!=0u){
  let P=tvCellPoint(cascade,vec3f(cell));
  // Floored: a point up to a cell before the previous volume is outside it (the reference truncates toward zero, which would read its first cell there).
  let history=vec3i(floor((P-tv.prevCorner[cascade].xyz)/tv.prevScale[cascade].w));
  let dimension=i32(dim);
  var alpha=1.0;
  if(any(history<vec3i(0))||any(history>=vec3i(dimension))){alpha=0.0;}
  // A cell the image before left unmarked was not lit: no history.
  else if(tv.marks.y!=0u&&!tvMarkedIn(tvHistoryMarks,cascade,history)){alpha=0.0;}
  if(cascade==1u){alpha*=tvBorder(cascade,(vec3f(cell)+vec3f(0.5))/f32(dim));}
  if(alpha>0.0){
   var past=tvLoad(tvVolume,cascade,history);
   past.ambient=vec4f(past.ambient.rgb*tv.weights.y,past.ambient.a);
   past.directional*=tv.weights.y;
   let share=tv.weights.z*alpha;
   value.ambient=mix(value.ambient,past.ambient,share);
   value.directional=mix(value.directional,past.directional,share);
  }
 }
 tvStore(cascade,vec3u(id.xy,id.z%dim),value);
}
@compute @workgroup_size(${TRANSLUCENCY_WORKGROUP},${TRANSLUCENCY_WORKGROUP},${TRANSLUCENCY_WORKGROUP})
fn spatialMain(@builtin(global_invocation_id) id:vec3u){
 let dim=tv.mode.x;
 if(id.x>=dim||id.y>=dim||id.z>=dim*2u){return;}
 let cascade=id.z/dim;
 let cell=vec3i(i32(id.x),i32(id.y),i32(id.z%dim));
 if(tv.marks.x!=0u&&!tvMarkedIn(tvMarks,cascade,cell)){
  tvStore(cascade,vec3u(id.xy,id.z%dim),tvEmpty());
  return;
 }
 var value=tvEmpty();
 if(tv.mode.y!=0u){
  for(var z=-1;z<=1;z++){for(var y=-1;y<=1;y++){for(var x=-1;x<=1;x++){
   let w=tvBlurWeight(x)*tvBlurWeight(y)*tvBlurWeight(z);
   let t=tvBlurred(cascade,cell+vec3i(x,y,z));
   value.ambient+=t.ambient*w;
   value.directional+=t.directional*w;
  }}}
 }else{
  value=tvBlurred(cascade,cell);
 }
 tvStore(cascade,vec3u(id.xy,id.z%dim),value);
}`,
)

/** The filters' program: its two entry points, \`temporalMain\` and \`spatialMain\`. */
export const FILTER_PROGRAM = wgslProgram(
  `@group(0) @binding(${b.frame}) var<uniform> tv:TranslucencyFrame;
@group(0) @binding(${b.injected}) var tvInjectedIn:texture_3d<f32>;
@group(0) @binding(${b.volume}) var tvVolume:texture_3d<f32>;
@group(0) @binding(${b.written}) var tvWritten:texture_storage_3d<${VOLUME_FORMAT},write>;
@group(0) @binding(${b.marks}) var tvMarks:texture_3d<u32>;
@group(0) @binding(${b.historyMarks}) var tvHistoryMarks:texture_3d<u32>;
`,
  [FILTER_WGSL],
)
