import { wgslProgram } from '../../../../math/src/wgsl/assemble.ts'
import { wgslBlock, type WgslDecl } from '../../../../math/src/wgsl/decl.ts'
import { unitOrZero } from '../../../../math/src/wgsl/inverseTranspose.ts'
import { faceNormal } from '../../../../math/src/wgsl/geometry.ts'
import { interleavedGradientNoise } from '../../../../math/src/wgsl/sampling.ts'
import { unitToSigned3 } from '../../../../math/src/wgsl/reals.ts'
import { octDecode, octEncode } from '../../../../math/src/wgsl/octahedral.ts'
import { worldMatrix3 } from '../../../../math/src/wgsl/matrix.ts'
import { SHADE_BINDINGS } from '../../gpu/bind/bindLayout.ts'
import { COTANGENT_FRAME_WGSL } from '../../geometry/cluster/cotangentFrameWgsl.ts'
import { ORM_LAW_WGSL } from '../ormWgsl.ts'
import { PT_VIEW_WGSL } from './viewWgsl.ts'
import { TILE_NOISE_WGSL } from '../../materials/texture/samplingFootprint.ts'
import {
  COLOR_SAMPLE_WGSL,
  DATA_SAMPLE_WGSL,
  TILE_POOL_WGSL,
  tileDeclarations,
} from '../../materials/virtual/wgsl.ts'
import { TILE_REQUEST_WGSL } from '../../materials/virtual/requestWgsl.ts'
import { materialTableWgsl } from '../../materials/table/materialWgsl.ts'
import { EMISSIVE_AO_FLAG_WGSL } from '../../materials/surface/surfaceEmission.ts'
import {
  MODEL_FLAG,
  UNLIT_FLAG,
  modelFlag,
  subsurfaceOpacityOfModel,
  subsurfaceProfileOfModel,
} from '../../materials/surface/surfaceModelWord.ts'
import {
  shadingModelOfModel,
  shadingUnlitOfModel,
} from '../../materials/surface/shadingModelCode.ts'
import {
  NORMAL_VIEW_COLOR_WGSL,
  SURFACE_MODEL_SHADE_WGSL,
} from '../../materials/surface/surfaceModel.ts'
import {
  PIXEL_MODEL,
  pixelModelFlag,
  pixelModelOf,
  quantise8,
  quantise8x2,
} from '../../materials/surface/pixelModel.ts'
import { specularFlag, specularOfFlags } from '../../materials/surface/surfaceSpecular.ts'
import { SUBSURFACE_FLAG } from '../../materials/surface/subsurface.ts'
import { PHYSICAL_SURFACE_FLAG } from '../../materials/surface/physicalLobes.ts'
import type { CompiledGraph } from '../../materials/graph/compile.ts'
import { MATERIAL_CLASS_WGSL } from '../../visibility/shader/materialClass.ts'
import { SURFACE_OUT_WGSL } from '../../visibility/shader/shadeOutputsWgsl.ts'
import { PAGE_INFO_STRUCT_WGSL } from '../../visibility/shader/pageWgsl.ts'
import { SHADE_UNI_WGSL } from '../../visibility/shader/pixelTriangleWgsl.ts'
import { SHADE_REQUEST_WGSL } from '../../visibility/shader/request.ts'
import {
  SURFACE_NORMALS,
  SURFACE_READS,
  SURFACE_TAIL,
  type ShadeOptions,
} from '../../visibility/shader/shadeWgsl.ts'
import { shadeGraph, type ShadeGraph } from '../../visibility/shader/shadeGraphWgsl.ts'
import { heldOutputs, outputCall } from '../../materials/graph/outputsOf.ts'
import { CHANNEL_SETS_WGSL, physicalCoreWgsl } from '../../visibility/shader/physicalWgsl.ts'
import {
  PT_HIT_MATERIAL_VECS,
  ptHitMaterialStride,
  PT_HIT_MATERIAL_WGSL,
  PT_IOR_RANGE,
  PT_MATERIAL_FLAG,
} from './hitMaterialWgsl.ts'
import { PT_HIT_KIND, PT_HIT_WGSL } from './hitRecordWgsl.ts'
import { PT_RIS_WGSL } from './risWgsl.ts'
import { strongIntegerHash } from '../sobolScramblingWgsl.ts'
import { PT_QUEUE_WGSL } from './queueWgsl.ts'
import { PT_LIGHT_STRUCT_WGSL } from './lightsWgsl.ts'
import { PT_LIGHT_TABLE_STRUCT } from './lightTable.ts'
import { PT_SHADING_ENERGY_WGSL } from './thinGlassWgsl.ts'
import { SURFACE_F0_WGSL } from '../../materials/surface/surfaceSpecular.ts'
import { luminance } from '../../../../math/src/wgsl/color.ts'

/** The bindings of the hits' shade in its group 1: the path tracer's parameters, the queue of paths, the hits it reads and the materials it writes. */
export const PT_SHADE_PATHS = {
  view: 0,
  queue: 1,
  hits: 2,
  materials: 3,
  /** Only where the hit chooses among closures: the paths' states (the ray's direction) and the lights' buffer (the energy table). */
  states: 4,
  lights: 5,
} as const

export const PT_SHADE_ENTRY = 'ptShadeHits'

/**
 * The lobes of a hit, where the resolve stores them in a target: kept in the hit's private record, the path tracer reads them from there. The reads the resolve makes of the other texture sets of
 * a page are none (the hit's triangle has one), and the lobes' flag bits are the resolve's.
 */
const PHYSICAL_HIT_WGSL = wgslBlock(
  'PHYSICAL_HIT_WGSL',
  [
    physicalCoreWgsl('HAS_SAMPLING'),
    CHANNEL_SETS_WGSL,
    materialTableWgsl(SHADE_BINDINGS.material),
    specularFlag,
  ],
  `var<private> hitLobes:PhysicalLobes;
fn mapCoord(m:Material,i:u32)->PhysicalCoord{return physicalCoords[mapChannel(m.channels,i)];}
fn physicalOtherUvs(page:PageInfo,h:u32,k:vec3u,bary:vec3f,dx:vec3f,dy:vec3f,used:u32){}
fn physicalLobes(pixel:vec2f,N:vec3f,coatBase:vec3f,e1:vec3f,e2:vec3f,screenFace:f32,coatFace:f32,tangents:CotangentFrame,stored:bool,curvature:f32)->u32{
 var v=physicalValues(N,coatBase,e1,e2,screenFace,coatFace,tangents,stored);
 v.coatRough=max(v.coatRough,curvature);
 let specular=select(0u,specularFlag(v.specular),v.specular>=0.0);
 if(physicalLobeless(v)){return specular;}
 hitLobes=v;
 return ${PHYSICAL_SURFACE_FLAG}u|specular;
}`,
)

/**
 * What the resolve's text reads of a triangle and of a page, for a hit: the triangle's corners rebuilt from the hit (`shadeHit`), the page's record made of the hit's material and flags, and the
 * functions of the resolve that read a page's geometry stood in for — the vertex colour is the hit's, the tangents are never stored (the frame is built from the texture coordinates). The
 * barycentric weights are the hit's own (see `shadeHit`).
 */
const HIT_STAND_INS = wgslBlock(
  'HIT_STAND_INS',
  [COTANGENT_FRAME_WGSL],
  `struct PixelTriangle{p0:vec4f,p1:vec4f,p2:vec4f,w0:vec4f,w1:vec4f,w2:vec4f,n0:vec3f,n1:vec3f,n2:vec3f,uva:vec2f,uvb:vec2f,uvc:vec2f,iw:vec3f,h:u32,k:vec3u,}
var<private> hitColour:vec4f;
var<private> hitVolume:vec4f;
var<private> hitAttenuation:vec3f;
var<private> thinOut:vec3f;
var<private> thinOpacity:f32;
var<private> shadeProbe:u32;
const SHADE_STAGE:u32=0u;
fn emptySurface()->SurfaceOut{return SurfaceOut(vec4f(0.0),vec4f(0.0),vec4f(0.0),0u,0u);}
fn pageColor(page:PageInfo,h:u32,k:u32)->vec4f{return hitColour;}
fn storedTangentFrame(page:PageInfo,h:u32,k:vec3u,bary:vec3f,n0:vec3f,n1:vec3f,n2:vec3f,world3:mat3x3f,side:f32)->CotangentFrame{return CotangentFrame(vec3f(1.0,0.0,0.0),vec3f(0.0,1.0,0.0));}
fn worldWindingKept(page:PageInfo)->bool{return true;}`,
)

/** The head of the hit's shade: the resolve's locals made from the hit (`PtHit`), to which the resolve's own text follows. */
const HIT_HEAD =
  () => `/** The surface of the hit h of the path at pixel, as the resolve gives a pixel its own. */
fn shadeHit(h:PtHit,pixel:vec2f)->SurfaceOut{
 let pos=vec4f(pixel+vec2f(0.5),0.0,1.0);
 tileNoise=interleavedGradientNoise(pos.xy,f32(uni.frameIndex&7u));
 var page:PageInfo;
 page.material=h.material;
 page.flags=h.flags;
 page.world=mat4x4f(vec4f(1.0,0.0,0.0,0.0),vec4f(0.0,1.0,0.0,0.0),vec4f(0.0,0.0,1.0,0.0),vec4f(0.0,0.0,0.0,1.0));
 let m=materialAt(page.material);
 hitVolume=vec4f(m.transmission,m.invIor,m.thickness,m.opacity);
 hitAttenuation=m.attenuation;
 let b1=h.bary.x;let b2=h.bary.y;
 let bary=vec3f(1.0-b1-b2,b1,b2);
 hitColour=h.colour;
 let eye=uni.eye;
 let corner=h.position+eye-b1*h.edge1-b2*h.edge2;
 var t:PixelTriangle;
 t.w0=vec4f(corner,1.0);t.w1=vec4f(corner+h.edge1,1.0);t.w2=vec4f(corner+h.edge2,1.0);
 t.n0=h.normal;t.n1=h.normal;t.n2=h.normal;
 let uva=h.uv-b1*h.uvEdge1-b2*h.uvEdge2;
 t.uva=uva;t.uvb=uva+h.uvEdge1;t.uvc=uva+h.uvEdge2;
 t.iw=vec3f(1.0);t.h=0u;t.k=vec3u(0u);
 let w0=t.w0;let w1=t.w1;let w2=t.w2;
 let c0=vec4f(0.0,0.0,0.0,1.0);let c1=c0;let c2=c0;
 let area=1.0;
 // The weights' steps, one unit of the unit screen triangle right and down: the hit's neighbours span the whole triangle.
 let stepX=vec3f(-1.0,1.0,0.0);let stepY=vec3f(-1.0,0.0,1.0);
 var rgb=m.baseColor;
 var uv=select(vec2f(0.0),h.uv,h.attributed);
 var ddx=vec2f(0.0);
 var ddy=vec2f(0.0);
`

/** The conversion of the resolve's surface to the path tracer's material record, and the entry that shades the hits of one class. */
const hitEntry = (
  opacity: string,
  weighted: boolean,
) => `fn ptMaterialOfSurface(s:SurfaceOut,model:u32)->PtHitMaterial{
 var m:PtHitMaterial;
 let flags=s.flags;
 let kind=flags&7u;
 let unlit=kind==${UNLIT_FLAG}u||kind==3u;
 m.base=select(s.baseMetal.rgb,vec3f(0.0),unlit);
 m.metallic=select(s.baseMetal.a,0.0,unlit);
 m.specular=select(specularOfFlags(flags),0.0,kind==${MODEL_FLAG.diffuse}u||unlit);
 m.roughness=s.normalRough.w;
 m.normal=s.normalRough.xyz;
 m.emission=select(s.emissiveAo.rgb,s.baseMetal.rgb,unlit);
 m.opacity=saturate(hitVolume.w);
 m.model=model;
 m.ior=clamp(1.0/max(hitVolume.y,1.0e-3),${PT_IOR_RANGE.min}.0,${PT_IOR_RANGE.max}.0);
 m.fuzz=0.0;
 m.transmission=saturate(hitVolume.x);
 m.attenuation=hitAttenuation;
 m.thickness=hitVolume.z;
 m.fuzzColor=vec3f(0.0);
 // The thin target holds a colour for a subsurface or skin pixel (added to the diffuse) and for a plain material with a thin transmission (a two-sided leaf); the profile, eye and hair keep an index there.
 let leaf=!unlit&&model==0u&&(flags&${SUBSURFACE_FLAG}u)!=0u;
 let scattering=!unlit&&(model==${PIXEL_MODEL.subsurface}u||model==${PIXEL_MODEL.skin}u);
 m.flags=select(0u,${PT_MATERIAL_FLAG.scatters}u,!unlit)|select(0u,${PT_MATERIAL_FLAG.foliage}u,leaf)|select(0u,${PT_MATERIAL_FLAG.subsurface}u,scattering);
 m.subsurface=select(vec3f(0.0),thinOut,leaf||scattering);
 m.depth=thinOpacity;
 if((flags&${PHYSICAL_SURFACE_FLAG}u)!=0u){m.fuzz=hitLobes.cloth;m.fuzzColor=hitLobes.fuzz;}
 return m;
}
override HIT_CLASS:u32=0u;
@compute @workgroup_size(64,1,1)
fn ${PT_SHADE_ENTRY}(@builtin(workgroup_id) wg:vec3u,@builtin(num_workgroups) n:vec3u,@builtin(local_invocation_index) lane:u32){
 let bounce=ptView.flags.w;
 let at=(wg.y*n.x+wg.x)*64u+lane;
 if(at>=ptRoundCount(bounce)){return;}
 let index=atomicLoad(&ptQueue[ptRoundList(bounce)+at]);
 let head=ptHits[index*6u+5u];
 if(ptHitKind(head)!=${PT_HIT_KIND.surface}u||ptHitClass(head)!=HIT_CLASS){return;}
 let h=ptUnpackHit(array<vec4u,6>(ptHits[index*6u],ptHits[index*6u+1u],ptHits[index*6u+2u],ptHits[index*6u+3u],ptHits[index*6u+4u],head));
 let pixel=vec2f(ptView.tile.xy+vec2u(index%ptView.tile.z,index/ptView.tile.z));
 thinOut=vec3f(0.0);
 thinOpacity=0.0;${
   weighted
     ? `
 hitSlabView=-ptStates[index*8u+3u].xyz;
 // The draw that chooses the slab: a hash of the path's place, the sample and the bounce, the round included (a ray that went through a surface chooses again).
 hitSlabRand=f32(strongIntegerHash(strongIntegerHash(index+ptView.seeds.x*0x9e3779b1u)^(bounce*0x85ebca6bu+u32(ptView.sampling.z)*0xc2b2ae35u)))*2.3283064e-10;
 hitSlabWeight=1.0;`
     : ''
 }
 let surface=shadeHit(h,pixel);
${opacity} let packed=ptPackHitMaterial(ptMaterialOfSurface(surface,pixelModelOf(surface.flags)));
 for(var k=0u;k<${PT_HIT_MATERIAL_VECS}u;k++){ptMaterials[index*${ptHitMaterialStride(weighted)}u+k]=packed[k];}${
   weighted
     ? `\n ptMaterials[index*${ptHitMaterialStride(weighted)}u+${PT_HIT_MATERIAL_VECS}u]=vec4u(bitcast<u32>(hitSlabWeight),0u,0u,0u);`
     : ''
 }
}`

/** The declarations of the hits' shade: the bindings of the resolve it keeps (the maps' pools, sampler, uniform and the surfaces' records), the paths' own, and the class's overrides. */
const shadeHitDecl = (request: WgslDecl) =>
  wgslBlock(
    `SHADE_HIT_DECL(${request.name})`,
    [
      PAGE_INFO_STRUCT_WGSL,
      SHADE_UNI_WGSL,
      SURFACE_OUT_WGSL,
      MATERIAL_CLASS_WGSL,
      materialTableWgsl(SHADE_BINDINGS.material),
      PHYSICAL_HIT_WGSL,
      HIT_STAND_INS,
      TILE_POOL_WGSL,
      COLOR_SAMPLE_WGSL,
      DATA_SAMPLE_WGSL,
      TILE_REQUEST_WGSL,
      request,
      SURFACE_MODEL_SHADE_WGSL,
      PT_VIEW_WGSL,
      PT_HIT_WGSL,
      PT_HIT_MATERIAL_WGSL,
    ],
    `${tileDeclarations(SHADE_BINDINGS.color, 'color')}
@group(0) @binding(${SHADE_BINDINGS.sampler}) var mapsSampler:sampler;
@group(0) @binding(${SHADE_BINDINGS.uniform}) var<uniform> uni:ShadeUni;
${tileDeclarations(SHADE_BINDINGS.data, 'data')}
@group(1) @binding(${PT_SHADE_PATHS.view}) var<uniform> ptView:PtView;
@group(1) @binding(${PT_SHADE_PATHS.queue}) var<storage,read_write> ptQueue:array<atomic<u32>>;
@group(1) @binding(${PT_SHADE_PATHS.hits}) var<storage,read> ptHits:array<vec4u>;
@group(1) @binding(${PT_SHADE_PATHS.materials}) var<storage,read_write> ptMaterials:array<vec4u>;`,
  )

/**
 * What the hit's choice of a slab among the closures of its material reads and gives: the random number it draws by, the direction to the eye the ray came along, and the weight of the one chosen (the light of
 * the slab is multiplied by it; one where the material has one closure). A slab is chosen by the coverage the tops leave it times the colour it sends back (`hitSlabAlbedo`, its diffuse colour under what the
 * specular lobe keeps, plus the specular lobe's albedo at the angle of the ray, summed over the channels), as the reference weighs the slabs it chooses among.
 */
const SLAB_CHOICE_WGSL = wgslBlock(
  'SLAB_CHOICE_WGSL',
  [
    PT_RIS_WGSL,
    strongIntegerHash,
    PT_LIGHT_STRUCT_WGSL,
    PT_SHADING_ENERGY_WGSL,
    SURFACE_F0_WGSL,
    luminance,
  ],
  `${PT_LIGHT_TABLE_STRUCT}
@group(1) @binding(${PT_SHADE_PATHS.states}) var<storage,read> ptStates:array<vec4f>;
@group(1) @binding(${PT_SHADE_PATHS.lights}) var<storage,read> directLights:PtLightTable;
var<private> hitSlabRand:f32;
var<private> hitSlabWeight:f32;
var<private> hitSlabView:vec3f;
fn hitSlabAlbedo(rgb:vec3f,metal:f32,rough:f32,n:vec3f,specular:f32)->f32{
 surfaceSpecular=specular;
 let f0=surfaceF0(rgb,metal);
 let f90=saturate(dot(f0,vec3f(1.0/3.0))*50.0);
 let e=shadingEnergyPair(rough,saturate(dot(n,hitSlabView)));
 let spec=f0*e.x+(vec3f(f90)-f0)*e.y;
 let colour=(1.0-luminance(spec))*rgb*(1.0-metal)+spec;
 return colour.x+colour.y+colour.z;
}`,
)

/** A hit keeps no closure target: in place of the closure writer's coverages and stores it adds the emission of the closures past the first. */
const withoutClosureTail = (g: ShadeGraph, weighted: boolean): ShadeGraph =>
  g.closures
    ? {
        ...g,
        closures: {
          ...g.closures,
          after: weighted ? g.closures.choice : g.closures.emission,
          store: '',
        },
      }
    : g

/**
 * THE SHADE OF THE HITS OF ONE CLASS OF SURFACES (`ptShadeHits`): the resolve's own text — its maps, factors, graph, normal map and lobes, in its order — run at a hit of a ray
 * in place of a pixel of the image (`shadeHit`: the head that makes the resolve's locals from `PtHit`, then `SURFACE_READS`, `SURFACE_NORMALS` and `SURFACE_TAIL` of `shadeWgsl.ts`), and its surface
 * stored as the path tracer's material record (`ptMaterialOfSurface`, `PtHitMaterial`). The hit sees the surface as the resolve would see it with the texture coordinate and the vertex
 * colour interpolated at the hit, no derivative (the texture is read at its finest, as the reference's path tracer reads it), the shading normal the triangle carries (turned to the ray's side, so the resolve's face test is one), and a
 * normal map's frame built from the texture coordinates (no tangents are stored). The pass runs over the paths of the bounce (the queue's list) and shades those whose hit is a surface of its class
 * (HIT_CLASS, its class key); where the view's pixels hold several closures (`weighted`) a material of several has the hit choose one of them by resampling on their weights and the record carries the weight of the choice (`ptHitMaterialStride`); the features of the class are the resolve's overrides (CLASS_KEY), the graph's program, if any, its own module.
 */
export const shadeHitProgram = (graph?: CompiledGraph, weighted = false) => {
  const o: ShadeOptions = {
    voxel: false,
    displaced: false,
    // A hit shades the first closure of a material of several (its blend and normal stay, the closure writer's coverages and stores, which need the resolve's own locals and declarations, do not) and adds the emission of the others, as the reference's hit sums the emission of every BSDF weighed by its coverage (PathTracingMaterialHitShader.usf:385-389).
    graph: graph && withoutClosureTail(shadeGraph(graph), weighted),
    screenFace: '1.0',
  }
  const body = HIT_HEAD() + SURFACE_READS(o) + SURFACE_NORMALS(o) + SURFACE_TAIL(o)
  // A blended surface's graph gives the opacity the hit lets light through by, in place of the record's.
  const opacity = graph?.functions.opacity
    ? ` hitVolume.w=${heldOutputs(graph, outputCall(graph, 'mgPixel,mgGiven')).opacity};\n`
    : ''
  return wgslProgram(`${body}\n${hitEntry(opacity, weighted)}`, [
    ...(weighted ? [SLAB_CHOICE_WGSL] : []),
    shadeHitDecl(o.graph ? o.graph.request : SHADE_REQUEST_WGSL),
    ...(o.graph ? [o.graph.decl] : []),
    NORMAL_VIEW_COLOR_WGSL,
    PT_QUEUE_WGSL,
    modelFlag,
    pixelModelFlag,
    pixelModelOf,
    quantise8x2,
    quantise8,
    octEncode,
    octDecode,
    subsurfaceOpacityOfModel,
    subsurfaceProfileOfModel,
    shadingModelOfModel,
    shadingUnlitOfModel,
    specularFlag,
    specularOfFlags,
    EMISSIVE_AO_FLAG_WGSL,
    ORM_LAW_WGSL,
    worldMatrix3,
    unitOrZero,
    interleavedGradientNoise,
    TILE_NOISE_WGSL,
    faceNormal,
    unitToSigned3,
  ])
}
