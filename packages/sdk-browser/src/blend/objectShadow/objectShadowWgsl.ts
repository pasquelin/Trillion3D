import { TWO_PI } from '../../../../math/src/wgsl/constants.ts'
import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { wgslModule } from '../../../../math/src/wgsl/assemble.ts'
import { clipDirective, type Clipping } from '../../gpu/core/clipDistances.ts'
import { BLEND_BINDINGS } from '../../gpu/bind/bindLayout.ts'
import { materialTableWgsl } from '../../materials/table/materialWgsl.ts'
import { NO_WPO, type WpoSet } from '../../materials/graph/wpoProgram.ts'
import type { SurfaceProgram } from '../../materials/graph/surfaceProgram.ts'
import { NO_VERTEX_WORDS, type CloudVertexText } from '../cloudVertexText.ts'
import { blendVertexWgsl, cutBlendByPixel } from '../vertexWgsl.ts'
import { BLEND_MAPS_WGSL } from '../mapsWgsl.ts'
import { stageSurface } from '../stageOptions.ts'
import { FACING_MATERIAL_MASK } from '../facing.ts'
import { WORDS } from '../vertexReadsWgsl.ts'
import { BLEND_LOBELESS_WGSL } from '../physicalWgsl.ts'
import { BLEND_FRAGMENT_KEPT_WGSL } from '../frontStageWgsl.ts'
import { GRAPH_FLAG, waterOf } from '../graphWgsl.ts'
import { withWaterBody } from '../water/waterBodyLane.ts'
import { WATER_EXCLUSION_WGSL } from '../water/waterExclusionTable.ts'

/** The group the translucent object shadow stage's own resources are bound in, after the blend's items group, and its two bindings (the draw's uniform and the materials). */
const OBJECT_SHADOW_DRAW_GROUP = 1
export const OBJECT_SHADOW_DRAW_BINDING = 0
export const OBJECT_SHADOW_MATERIALS_BINDING = 1
/** The vec4s one material of the per-material table holds (`osMaterials`): density scale, start offset, self shadow density scale, second density scale; second opacity, backscattering exponent; extinction. */
export const OBJECT_SHADOW_MATERIAL_VECS = 3
/** The words of one draw's uniform: the world-to-light clip matrix, then the normalized depth's scale (`x`), whether the depth is clamped
 *  to the subject's near end (`y`, a directional light) and the scale a material's start offset (centimetres) becomes a normalized depth by (`z`). */
export const OBJECT_SHADOW_DRAW_FLOATS = 16 + 4

/**
 * THE VERTEX STAGE'S HOOK OF THE TRANSLUCENT OBJECT SHADOW DEPTH PASS: once a vertex has its place, it is laid out by the subject's frame in the
 * light (`osDraw.clip`, the world in metres to the clip of the light's inner frame) with the depth left unclipped, as the pass's own: the casters
 * between the subject's depth bounds are all drawn, the depth is the fragment's to write. A subject draws its own caster's range of the
 * instance list alone, so no vertex is gated.
 */
const OBJECT_SHADOW_VERTEX: CloudVertexText = {
  ...NO_VERTEX_WORDS,
  key: ', objectShadow',
  declared: [
    wgslBlock(
      'OBJECT_SHADOW_DRAW_WGSL',
      [],
      `struct ObjectShadowDraw{
 clip:mat4x4f,
 depth:vec4f,
}
@group(${OBJECT_SHADOW_DRAW_GROUP}) @binding(${OBJECT_SHADOW_DRAW_BINDING}) var<uniform> osDraw:ObjectShadowDraw;
@group(${OBJECT_SHADOW_DRAW_GROUP}) @binding(${OBJECT_SHADOW_MATERIALS_BINDING}) var<storage,read> osMaterials:array<vec4f>;`,
    ),
  ],
  vertexLanes: `let osClip=osDraw.clip*vec4f(out.view,1.0);
 out.position=vec4f(osClip.xy,0.5*osClip.w,osClip.w);
 `,
}

/**
 * THE TRANSLUCENT OBJECT SHADOW DEPTH STAGE (`fsObjectShadow`), the fragment that adds a translucent surface's opacity into a subject's two
 * coefficient targets, in a module of its own (`blendObjectShadowShader`): the blend's vertex stage laid out by the subject's frame
 * (`OBJECT_SHADOW_VERTEX`), its material reads, no light. A fragment the blend would keep contributes its density, the surface's opacity (the
 * base map's alpha times the material's) times the material's translucent shadow density, as the integrated density
 * `-2 ln(max(1 - density, 0.00001))` (a coverage in the sense of a Fourier series, so that layers add): `x` of the first target is that
 * integral at depth 0, the others its cosines then sines at the first three harmonics of the normalized depth, which the projection
 * (`objectShadowProjectWgsl.ts`) reads back. The depth is the one the projection reads a receiver at: 0 at the subject's near end, one minus the
 * clip depth scaled by the subject's range. The targets add: any number of layers on a pixel, in any order.
 */
const objectShadowStageWgsl = (
  graphs: readonly SurfaceProgram[],
  cut: CloudVertexText | undefined,
) =>
  wgslBlock(
    `objectShadowStageWgsl(${graphs.length ? 'graphs' : ''}${cut ? ', exclusion volumes' : ''})`,
    [
      TWO_PI,
      stageSurface(false, graphs),
      materialTableWgsl(BLEND_BINDINGS.material),
      BLEND_FRAGMENT_KEPT_WGSL,
      BLEND_LOBELESS_WGSL,
      ...(cut ? [WATER_EXCLUSION_WGSL, ...cut.declared] : []),
    ],
    `struct ObjectShadowOut{
 @location(0) cosines:vec4f,
 @location(1) sines:vec4f,
}
@fragment fn fsObjectShadow(in:VSOut,@builtin(front_facing) front:bool)->ObjectShadowOut{
 let g=blendGrads(in);
 let base=blendBase(in,g);
 let record=materialAt(in.${WORDS.material}&${FACING_MATERIAL_MASK}u);
 let thin=record.transmission>0.0;
 if(!blendFragmentKept(in,base,thin,front)${cut ? `||((g.graph.flags&${GRAPH_FLAG.water}u)!=0u&&waterExcluded(in.view,waterBodyRank(in)))` : ''}){discard;return ObjectShadowOut(vec4f(0.0),vec4f(0.0));}
 let mine=in.${WORDS.material}&${FACING_MATERIAL_MASK}u;
 let scales=osMaterials[mine*${OBJECT_SHADOW_MATERIAL_VECS}u];
 let density=blendAlpha(in,base)*scales.x;
 let clip=osDraw.clip*vec4f(in.view,1.0);
 let forward=1.0-clip.z*osDraw.depth.x;
 let depth=select(forward,max(forward,0.000001),osDraw.depth.y>0.5)+scales.y*osDraw.depth.z;
 let integrated=-2.0*log(max(1.0-density,0.00001));
 let waves=TWO_PI*vec3f(1.0,2.0,3.0)*depth;
 return ObjectShadowOut(vec4f(integrated,integrated*cos(waves)),vec4f(0.0,integrated*sin(waves)));
}`,
  )

/** Whether the stage is the variant that cuts the water: the world holds an exclusion volume and some graph is a water's (`waterOf`). */
export const cutsWater = (exclusion: boolean, graphs: readonly SurfaceProgram[]) =>
  exclusion && waterOf(graphs)

/** The translucent object shadow stage's module (`fsObjectShadow`): the blend's vertex stage laid out by a subject's frame, its maps, and the stage;
 *  with `graphs`, the programs of the graphs its items wear, `offsets` those that move their vertices; with `exclusion` (a world that holds a water exclusion
 *  volume) and a water among the graphs (`cutsWater`), the variant that does not draw the water's surface inside a volume that excludes its body, as the
 *  water's own stages do (`waterExcluded`, the body's lane of the vertex stage). Without it the text is the same as ever. */
export const blendObjectShadowShader = (
  clipping?: Clipping,
  graphs: readonly SurfaceProgram[] = [],
  offsets: WpoSet = NO_WPO,
  exclusion = false,
) => {
  const words = cutsWater(exclusion, graphs)
    ? withWaterBody(OBJECT_SHADOW_VERTEX, { clouds: false, fog: false }, false)
    : undefined
  return cutBlendByPixel(
    wgslModule(
      blendVertexWgsl(false, clipping, words ?? OBJECT_SHADOW_VERTEX, offsets),
      BLEND_MAPS_WGSL,
      objectShadowStageWgsl(graphs, words),
      ...clipDirective(clipping),
    ),
    clipping,
  )
}
