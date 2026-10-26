import { wgslBlock, wgslFn, type WgslDecl } from '../../../../math/src/wgsl/decl.ts'
import {
  invTranspose3Apply,
  invTranspose3Prep,
  unitOrZero,
} from '../../../../math/src/wgsl/inverseTranspose.ts'
import { worldMatrix3 } from '../../../../math/src/wgsl/matrix.ts'
import type { RasterProgram } from '../../materials/graph/outputProgram.ts'
import { graphLoadWgsl } from '../../materials/graph/tableValues.ts'
import {
  wpoOutput,
  wpoValues,
  wpoKey,
  type WpoAtlas,
  type WpoSet,
} from '../../materials/graph/wpoProgram.ts'
import { tileDeclarations } from '../../materials/virtual/wgsl.ts'
import { GRAPH_HEADER } from '../../materials/table/materialLayout.ts'
import { FLAG_HAS_COLOR, WPO_ROW_ALWAYS } from '../types.ts'
import { graphFrameWgsl } from './graphFrameWgsl.ts'
import { PAGE_GEOMETRY_WGSL, PAGE_NORMAL_WGSL, QUANTIZED } from './pageGeometryWgsl.ts'
import { PAGE_UV_OR_FIRST_WGSL } from './pageUvSetWgsl.ts'
import { normalAtlasWgsl } from './pageWgsl.ts'

/**
 * THE OFFSETS A MODULE MOVES VERTICES BY (`pageWpoLocal`, which `pagePosition` calls): the
 * `worldPositionOffset` function of each program the module holds (`WpoSet`), read at a vertex from
 * the values the row's surface wrote beside its record — its header texel names the program
 * (`../../materials/graph/wpoProgram.ts`) — and chosen by the program's key. The context a vertex
 * stage has of a vertex is its world position (the vertex as the page and its deformation place it,
 * not yet moved), the object's origin, the camera, its normal, its first texture coordinate set and
 * the clocks of the image (`graphFrameWgsl.ts`).
 *
 * The offset is in the world: `pageWpoLocal` holds it to the greatest offset along an axis the
 * object's surfaces name (the row's `wpoMost`), gives zero where the object does not evaluate it —
 * past its disable distance, measured from the camera to the centre of the object's bounds (the
 * row's `wpoCentre`), unless its surface always evaluates; a shadow pass has no camera distance, it
 * judges the offset by the level of the shadow map it draws (`wpoThreshold`, below) — and brings what
 * is left into the primitive's space, which the page positions are in. `previous` asks the same at
 * the clocks and the camera of the image before, the object placed where the placement's motion
 * `before` says it was; whether the offset is evaluated is the current image's decision. A value that
 * is not finite moves what it is added to to no finite place, as the vertex of any program.
 */
const programFunction = (program: RasterProgram) => {
  const { suffix, uses, set } = program
  const uv = uses.sets ? `pageUvOrFirst(page,rest,vertex,${set}u)` : 'vec2f(0.0)'
  const normal = uses.normal
    ? 'unitOrZero(invTranspose3Apply(mtx,pageNormal(page,rest,vertex)))'
    : 'vec3f(0.0,0.0,1.0)'
  // The vertex's colour where the row carries one (`FLAG_HAS_COLOR`), white where the geometry has none.
  const colour = uses.colour
    ? `select(vec4f(1.0),pageColor(page,rest,vertex),(page.flags&${FLAG_HAS_COLOR}u)!=0u)`
    : 'vec4f(1.0)'
  // A header read for the points alone has no attribute grids: this vertex reads them whole.
  const header =
    uses.sets || uses.normal || uses.colour ? ' let rest=wpoSurfaceHeader(page,h);\n' : ''
  // A vertex has no footprint: a texture is read at the finest level, its neighbours the vertex itself.
  const neighbours = uses.textures ? ' mgNeighbour[0]=ctx;mgNeighbour[1]=ctx;\n' : ''
  return `fn wpoGraph${suffix}(page:PageInfo,h:ClusterHeader,vertex:u32,local:vec3f,previous:bool,first:u32,before:mat4x4f)->vec3f{
 var eye=graphFrame.eye.xyz;var time=graphFrame.clock.x;var realTime=graphFrame.clock.y;var world=page.world;
 if(previous){eye=graphFrame.before.xyz;time=graphFrame.clock.z;realTime=graphFrame.clock.w;world=wpoPreviousWorld(page.world,before,graphFrame.eye.xyz);}
${header} let mtx=invTranspose3Prep(worldMatrix3(world));
 var ctx:MgContext;
 let uv=${uv};
 ctx.uvs=array<vec2f,8>(${Array(8).fill('uv').join(',')});
 ctx.world=(world*vec4f(local,1.0)).xyz;ctx.eye=eye;ctx.origin=world[3].xyz;
 ctx.vertexNormal=${normal};ctx.pixelNormal=ctx.vertexNormal;ctx.vertexColor=${colour};
 ctx.time=time;ctx.realTime=realTime;
${neighbours} var offset=mgWorldPositionOffset${suffix}(ctx,mgLoad${suffix}(first));
 if(page.wpoMost>0.0){offset=clamp(offset,vec3f(-page.wpoMost),vec3f(page.wpoMost));}
 return select(vec3f(0.0),mtx.scale*(offset*mtx.adj),mtx.regular);
}`
}

/** The header of a page with its attribute grids, whatever the pass read it for. */
const WPO_HEADER_WGSL = wgslBlock(
  'WPO_HEADER_WGSL',
  [],
  `fn wpoSurfaceHeader(page:PageInfo,h:ClusterHeader)->ClusterHeader{
 var surface=h;
 if(${QUANTIZED}){surface=clusterSurfaceHeader(h,page.pageOffset);}
 return surface;
}`,
)

/**
 * Whether the object's offset is evaluated at all, the object's decision: its surface always evaluates,
 * or it names no distance, or — the camera's passes — the camera is nearer the centre of its bounds
 * than the distance. A shadow pass (`wpoThreshold` not below zero, set by the pass for the shadow map
 * it draws) judges by the map's level instead: the offset is evaluated where the level's threshold,
 * the square of the distance past which a level no longer shows the motion, is not past the object's
 * (`../lighting/shadows/vsm/projection/projectionData.ts`).
 */
const WPO_ALLOWED_WGSL = wgslBlock(
  'WPO_ALLOWED_WGSL',
  [],
  `var<private> wpoThreshold:f32=-1.0;
fn wpoAllowed(page:PageInfo)->bool{
 if((page.wpo&${WPO_ROW_ALWAYS}u)!=0u||page.wpoDisableSq<=0.0){return true;}
 if(wpoThreshold>=0.0){return wpoThreshold<=page.wpoDisableSq;}
 let away=(page.world*vec4f(page.wpoCentre,1.0)).xyz-graphFrame.eye.xyz;
 return dot(away,away)<page.wpoDisableSq;
}`,
)

/** The world of the image before of a placement whose motion is `before` (the previous world taken
 *  to the current one, relative to `eye`): the offset graph reads where the object was. */
const WPO_PREVIOUS_WORLD_WGSL = wgslBlock(
  'WPO_PREVIOUS_WORLD_WGSL',
  [],
  `fn wpoPreviousWorld(world:mat4x4f,before:mat4x4f,eye:vec3f)->mat4x4f{
 let linear=mat3x3f(before[0].xyz,before[1].xyz,before[2].xyz);
 let origin=(before*vec4f(world[3].xyz-eye,1.0)).xyz+eye;
 return mat4x4f(vec4f(linear*world[0].xyz,0.0),vec4f(linear*world[1].xyz,0.0),vec4f(linear*world[2].xyz,0.0),vec4f(origin,1.0));
}`,
)

/** The colour atlas and its sampler, declared by a module that places a vertex and reads no texture
 *  otherwise (`WpoSet.atlas`). */
const wpoAtlasWgsl = ({ color, sampler }: WpoAtlas) =>
  wgslBlock(
    `wpoAtlasWgsl(${color.pages},${sampler})`,
    [],
    `${tileDeclarations(color, 'color')}
@group(0) @binding(${sampler}) var mapsSampler:sampler;`,
  )

/** The offset hook of a module that holds `wpo`: the functions of its programs, their loaders and
 *  `pageWpoLocal`, which replaces the default of no offset. */
export function wpoGraphWgsl(wpo: WpoSet): WgslDecl {
  const textured = wpo.programs.some((program) => program.uses.textures)
  if (textured && !wpo.sample)
    throw new Error('an offset reads a texture: the pass gives no colour read')
  const loaders = wpo.programs.flatMap((program) => [
    graphLoadWgsl(wpoValues(program), wpo.table),
    wpoOutput(program, wpo.sample),
  ])
  const cases = wpo.programs
    .map(
      (program) =>
        `  case ${program.key}u:{return wpoGraph${program.suffix}(page,h,vertex,local,previous,word-1u,before);}`,
    )
    .join('\n')
  const reads = wpo.programs.some((program) => program.uses.sets > 0)
  const normals = reads || wpo.programs.some((program) => program.uses.normal)
  const body = wgslBlock(
    `wpoGraphWgsl(${wpoKey(wpo)})`,
    [
      ...loaders,
      graphFrameWgsl(wpo.frame),
      ...(textured && wpo.atlas ? [wpoAtlasWgsl(wpo.atlas)] : []),
      WPO_ALLOWED_WGSL,
      WPO_PREVIOUS_WORLD_WGSL,
      invTranspose3Prep,
      invTranspose3Apply,
      worldMatrix3,
      unitOrZero,
      ...(reads ? [PAGE_GEOMETRY_WGSL, PAGE_UV_OR_FIRST_WGSL] : []),
      ...(normals ? [WPO_HEADER_WGSL, normalAtlasWgsl(wpo.normals), PAGE_NORMAL_WGSL] : []),
    ],
    wpo.programs.map(programFunction).join('\n'),
  )
  return wgslFn(
    'pageWpoLocal',
    [body],
    `fn pageWpoLocal(page:PageInfo,h:ClusterHeader,vertex:u32,local:vec3f,previous:bool,before:mat4x4f)->vec3f{
 let word=materialGraphWord(page.material);
 if(word==0u||!wpoAllowed(page)){return vec3f(0.0);}
 // The ids of the two passes' programs both start at one: the header says which pass's this is.
 let head=materialGraphHead(word);
 let key=head.x|select(0u,0x80000000u,(head.y&${GRAPH_HEADER.blend}u)!=0u);
 switch(key){
${cases}
  default:{}
 }
 return vec3f(0.0);
}`,
  )
}
