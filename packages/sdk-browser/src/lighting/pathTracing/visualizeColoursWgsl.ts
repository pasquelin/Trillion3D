import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { hueToRgb } from '../../../../math/src/wgsl/color.ts'
import { PATH_TRACING_VISUALIZE_MODES } from '../../../../sdk-core/src/contracts/pathTracingOptions.ts'
import { PIXEL_MODEL } from '../../materials/surface/pixelModel.ts'
import { PT_HIT_WGSL } from './hitRecordWgsl.ts'
import { PT_LIGHT_GRID_WGSL } from './lightGridWgsl.ts'
import { PT_CAPTURE } from './viewWgsl.ts'

/** The number of the view `name` in `PATH_TRACING_VISUALIZE_MODES`, as the shader writes it. */
export const visualizeMode = (name: (typeof PATH_TRACING_VISUALIZE_MODES)[number]) =>
  `${PATH_TRACING_VISUALIZE_MODES.indexOf(name)}u`

/** The views whose value only the trace knows, with the field it keeps in the hit (`PT_CAPTURE`). */
export const PT_CAPTURED_VIEW = {
  TriangleID: PT_CAPTURE.triangle,
  InstanceID: PT_CAPTURE.instance,
  ClusterID: PT_CAPTURE.cluster,
  LightingChannelMask: PT_CAPTURE.channels,
} as const

/**
 * THE COLOURS THE VIEWS OF THE PAYLOAD DRAW WITH: the ramp from blue to red (`ptRamp`) and the colour of a count (`ptCountColour`, pink past the count the ramp ends at), the colour of a hash (the
 * position's cell and the light grid's list), the anisotropy (green for a positive value, blue for a negative one, in the gamma the raster's view of it uses), the lighting channels (a channel the object holds is full, the others a tenth),
 * the three ten-bit fields of a hash (the instance, triangle and cluster views), the colour of the shading model a hit is (`ptModelColour`), the tangent the texture coordinates give a triangle (`ptWorldTangent`: the direction
 * of the growing first coordinate, none where the triangle has no coordinates), and the views that need a little shading to be read (`ptShowNeedsShading`).
 */
export const PT_VISUALIZE_COLOURS_WGSL = wgslBlock(
  'PT_VISUALIZE_COLOURS_WGSL',
  [hueToRgb, PT_HIT_WGSL, PT_LIGHT_GRID_WGSL],
  `fn ptRamp(t:f32)->vec3f{return (0.75*t+0.25)*saturate(vec3f(2.0)-abs(vec3f(4.0,2.0,0.0)-4.0*t));}
fn ptCountColour(n:u32)->vec3f{
 let most=max(ptGridParams.visualizeMax,1u);
 if(n>most){return vec3f(1.0,0.1,1.0);}
 return ptRamp(saturate(f32(n)/f32(most)));
}
fn ptHash32(v:u32)->u32{
 var x=v;
 x^=x>>16u;x*=0x7feb352du;x^=x>>15u;x*=0x846ca68bu;x^=x>>16u;
 return x;
}
fn ptHashColour(h:u32)->vec3f{return hueToRgb(f32(h&0xffffffu)*5.96046447754e-08);}
fn ptAnisotropyColour(a:f32)->vec3f{return vec3f(0.0,pow(saturate(a),2.2),pow(saturate(-a),2.2));}
fn ptChannelColour(mask:u32)->vec3f{return select(vec3f(0.1),vec3f(1.0),(vec3u(mask)&vec3u(1u,2u,4u))!=vec3u(0u));}
fn ptFieldsColour(bits:u32)->vec3f{return vec3f((vec3u(bits)>>vec3u(0u,10u,20u))&vec3u(1023u))*(1.0/1023.0);}
fn ptModelColour(model:u32,glass:bool,thin:bool,leaf:bool)->vec3f{
 if(glass){return select(vec3f(1.0,0.1,0.1),vec3f(1.0,0.8,0.3),thin);}
 if(leaf){return vec3f(0.2,0.2,0.8);}
 if(model==${PIXEL_MODEL.hair}u){return vec3f(0.6,0.1,0.5);}
 if(model==${PIXEL_MODEL.eye}u){return vec3f(0.3,1.0,1.0);}
 return vec3f(0.1,1.0,0.1);
}
fn ptWorldTangent(h:PtHit)->vec3f{
 let det=h.uvEdge1.x*h.uvEdge2.y-h.uvEdge2.x*h.uvEdge1.y;
 if(!h.attributed||abs(det)<1.0e-20){return vec3f(0.0);}
 let t=(h.edge1*h.uvEdge2.y-h.edge2*h.uvEdge1.y)/det;
 return select(vec3f(0.0),normalize(t),dot(t,t)>0.0);
}
fn ptShowNeedsShading(m:u32)->bool{
 return m==${visualizeMode('ShadingModel')}||m==${visualizeMode('LightingChannelMask')}||m==${visualizeMode('WorldPosition')}||m==${visualizeMode('LightGridCount')}||m==${visualizeMode('LightGridAxis')}||m==${visualizeMode('LightGridListHash')}||m==${visualizeMode('LightGridSingular')}||m==${visualizeMode('HitKind')}||m==${visualizeMode('BackfacingNormal')}||m==${visualizeMode('TriangleID')}||m==${visualizeMode('InstanceID')}||m==${visualizeMode('ClusterID')};
}`,
)
