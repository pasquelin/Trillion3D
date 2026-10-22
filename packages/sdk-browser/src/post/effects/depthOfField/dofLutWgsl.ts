import { wgslProgram } from '../../../../../math/src/wgsl/assemble.ts'
import { wgslBlock } from '../../../../../math/src/wgsl/decl.ts'
import { PI, TWO_PI } from '../../../../../math/src/wgsl/constants.ts'
import { DOF_COC_WGSL, DOF_PARAMS_WGSL } from './dofCommonWgsl.ts'
import { BOKEH_LUT_SIZE, GROUP, LUT_FORMAT } from './dofLayout.ts'

/** The table pass's binding: the table written. */
export const LUT_BINDINGS = { lut: 2 } as const
/** The tables' kinds, as the pipeline constant `FORMAT` reads them: the factor from a circle's radius
 *  to the bokeh's edge, the distance of a full-size pixel from the bokeh's centre in circle units,
 *  the position of each gather sample. */
export const LUT_FORMATS = { edge: 0, fullSize: 1, gather: 2 } as const

/** The table pass's overrides and output, and the functions of the diaphragm's shape: the factor to its
 *  edge along a direction, the ring and slot a texel stands for, the position of a gather sample. */
const LUT_SHAPE_WGSL = wgslBlock(
  'LUT_SHAPE_WGSL',
  [DOF_PARAMS_WGSL, DOF_COC_WGSL, PI, TWO_PI],
  `override FORMAT:u32=0u;
override ROUNDED:bool=false;
@group(0) @binding(${LUT_BINDINGS.lut}) var lutOut:texture_storage_2d<${LUT_FORMAT},write>;
fn edgeFactor(angle:f32)->f32{
 let blades=view.bokeh.x;
 let id=floor(angle/TWO_PI*blades);
 let alpha=angle-(id+0.5)*TWO_PI/blades;
 if(!ROUNDED){return view.bokeh.w/cos(alpha);}
 let b=2.0*view.blade.y*cos(alpha);
 let c=view.blade.y*view.blade.y-view.blade.x*view.blade.x;
 return (-b+sqrt(b*b-4.0*c))*0.5;
}
fn ringOf(c:vec2f)->vec2f{
 var dial=c;
 var id=0.0;
 for(var i=0;i<3;i++){
  if(dial.x<0.0||dial.y<0.0){dial=vec2f(dial.y,-dial.x);id+=1.0;}
 }
 let radius=max(abs(dial.x),abs(dial.y));
 var slot=id*2.0*radius;
 if(dial.x>dial.y){slot+=dial.y;}else{slot+=2.0*radius-dial.x;}
 return vec2f(radius,slot);
}
fn bladePosition(ring:vec2f)->vec2f{
 let blades=view.bokeh.x;
 let count=max(1.0,ring.x*8.0);
 let angle=((ring.y+fract(ring.x*0.5))/count)*TWO_PI+PI;
 let edge=floor(angle/TWO_PI*blades);
 let along=fract(angle/TWO_PI*blades);
 if(!ROUNDED){
  let a0=edge*TWO_PI/blades-view.bokeh.y;
  let a1=a0+TWO_PI/blades;
  return view.bokeh.z*mix(vec2f(cos(a0),sin(a0)),vec2f(cos(a1),sin(a1)),along);
 }
 let beta=asin(view.bokeh.z/view.blade.x*sin(PI/blades));
 let across=beta*(along*2.0-1.0);
 let local=vec2f(view.blade.x*cos(across)-view.blade.y,view.blade.x*sin(across));
 let turn=(edge+0.5)*TWO_PI/blades-view.bokeh.y;
 return vec2f(local.x*cos(turn)-local.y*sin(turn),local.x*sin(turn)+local.y*cos(turn));
}`,
)

/**
 * The bokeh tables (`BOKEH_LUT_SIZE` texels a side): the shape of the diaphragm — `view.bokeh` and
 * `view.blade` — tabulated so that a pass reads it by an offset's direction.
 * - `edge` (centred on the table's origin): for the direction of a texel, the factor that takes a
 *   circle's radius to the bokeh's edge along it: straight blades, a corner to a corner; rounded
 *   ones, the root of the blade's circle (`ROUNDED`) — the table the scatter and the slight out of
 *   focus read;
 * - `fullSize`: for each texel, its distance from the centre — the squeeze applied — in circle
 *   units, divided by that factor: what the recombine compares the circle of a neighbour to;
 * - `gather`: for the `(ring, sample)` a texel stands for — the square ring of the table, the
 *   sample's place on it —, the position of the gather's sample on the blade's edge, the ring's
 *   radius times the unit position and the squeeze's inverse in x.
 */
export const bokehLutShader = () =>
  wgslProgram(
    `@compute @workgroup_size(${GROUP},${GROUP})
fn buildLut(@builtin(global_invocation_id) gid:vec3u){
 if(any(gid.xy>=vec2u(${BOKEH_LUT_SIZE}u))){return;}
 var rel=vec2f(gid.xy);
 if(FORMAT==0u){
  rel=rel+0.5;
  if(rel.x>${BOKEH_LUT_SIZE / 2}.0){rel.x=rel.x-${BOKEH_LUT_SIZE}.0;}
  if(rel.y>${BOKEH_LUT_SIZE / 2}.0){rel.y=rel.y-${BOKEH_LUT_SIZE}.0;}
 }else{
  rel=rel-${BOKEH_LUT_SIZE / 2}.0;
 }
 var out=vec4f(0.0);
 let angle=atan2(rel.y,rel.x)+view.bokeh.y+PI;
 if(FORMAT==0u){out.x=edgeFactor(angle);}
 if(FORMAT==1u){
  var factor=edgeFactor(angle);
  if(all(rel==vec2f(0.0))){factor=1.0;}
  out.x=0.5*length(rel*vec2f(view.lens.x,1.0))/factor;
 }
 if(FORMAT==2u){
  let ring=ringOf(rel);
  let place=bladePosition(ring)*ring.x;
  out=vec4f(place.x*view.lens.y,place.y,0.0,0.0);
 }
 textureStore(lutOut,vec2i(gid.xy),out);
}`,
    [LUT_SHAPE_WGSL, DOF_PARAMS_WGSL, DOF_COC_WGSL, PI, TWO_PI],
  )
