import { FLAG_DIAGNOSTIC_VIEW } from '../../visibility/types.ts'
import { declaredLightingSplitWgsl } from '../../lighting/direct/declaredLightingWgsl.ts'
import { type ContractKey, variantLabel } from '../../lighting/deferred/contractCuts.ts'
import { TRANSLUCENT_RECT_LIGHTS_DEFAULT, translucentLitKey } from '../shader.ts'
import { blendSurfaceWgsl } from '../shaderSurface.ts'
import { blendGraphs, depthOf, layerOf } from '../graphWgsl.ts'
import type { SurfaceProgram } from '../../materials/graph/surfaceProgram.ts'
import {
  NO_VERTEX_READS,
  cloudVertexText,
  type CloudVertexText,
  type VertexReads,
} from '../cloudVertexText.ts'
import {
  DISPLAY_MASK_GROUP,
  DISPLAY_ROUTE_WGSL,
  displayMaskWgsl,
} from '../display/displayFilter.ts'
import { DISTORTION_WGSL } from './distortionWgsl.ts'
import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { transmitStagesWgsl } from './transmitStagesWgsl.ts'
import { variantKey } from './transmitThinWgsl.ts'

/** The dual blend, one pass for the thin layer's two effects on the destination: what is added,
 *  then the destination's per-channel multiply; the alpha takes the layer's grey coverage over the
 *  target's (`greyCoverage`, the fallback's rule). The modulation pass draws the same layers again for the multiply
 *  alone (`fsTransmitModulate`), a plain blend by its own colour, with the request beside it: no light is read for a
 *  colour its blend drops. */
const transmitDualWgsl = (
  graphs: boolean,
  lobes: boolean,
  shade: CloudVertexText,
  marks: boolean,
  depth: boolean,
  layer: boolean,
) =>
  wgslBlock(
    `TRANSMIT_DUAL_WGSL(${variantKey({ graphs, lobes, shade, marks, depth, layer })})`,
    [transmitStagesWgsl(graphs, lobes, shade, marks, depth, layer)],
    `struct TransmitDual{@location(0) @blend_src(0) add:vec4f,@location(0) @blend_src(1) mul:vec4f,}
// The two sources of \`add\` and \`mul\`: the light laid with the layer's grey coverage, the multiply.
@fragment fn fsTransmitDual(in:VSOut,@builtin(front_facing) front:bool)->TransmitDual{${shade.entry}
 let t=transmitFragment(in,front);
 return TransmitDual(vec4f(t.add,greyCoverage(t.mul)),vec4f(t.mul,1.0));
}
// The modulation pass's draw of the same layers: the multiply, which its blend takes the destination by
// (\`src\`: no second source), adding nothing, and the request.
struct Modulated{@location(0) mul:vec4f,@location(1) request:u32,}
@fragment fn fsTransmitModulate(in:VSOut,@builtin(front_facing) front:bool)->Modulated{${shade.entry}
 let deltas=fwidth(in.bary);
 let t=transmitSurface(in,front,blendGrads(in));
 if(!t.kept){discard;return Modulated(vec4f(1.0),0u);}
 var mul:vec3f;
 if((in.ids.y&${FLAG_DIAGNOSTIC_VIEW}u)!=0u){mul=vec3f(1.0-blendDiagnosticOut(in,t.s,deltas).color.a);}
 else{mul=thinMul(thinLayer(in,t));}
 return Modulated(vec4f(mul,1.0),t.s.request);
}
`,
  )

/**
 * The transmissive stages of the blend module of `key` (`../shader.ts`), its lights split
 * (`declaredLightingSplitWgsl`), imported with transmission's code (`family.ts`): the
 * layer lit and composed under the single-source fallback (`fsTransmit`, `fsTransmitFiltered`), its
 * request stage (`fsTransmitCoverage`), the distortion's accumulation (`fsDistortion`) and full-screen application
 * (`FULLSCREEN_VERTEX`, `fsDistortionApply`), and with `dual` — a device granted
 * `dual-source-blending` — the dual blend itself (`fsTransmitDual`, `fsTransmitModulate`). Everything is read on the imported material —
 * `KHR_materials_transmission`, `KHR_materials_ior` — and the scene's declared sources, with the
 * engine's only lighting formula. No light of its own, no constant tuned to a scene. With
 * `reads`, the stages of a program that reads the clouds per vertex or lays the fog there (`../cloudVertexText.ts`):
 * the text it was, word for word, without; they lay the cloud layer over the fog of the thin layer.
 * With `marks`, the stages of a program whose surfaces ask for shadow reads of their own: each layer
 * sets its surface's marks from its flags before it lights (`translucentMarksFrom`). The lights are
 * those of the blend module of the same project switch `translucentRectLights` (`translucentLitKey`).
 */
export const transmitWgsl = (
  key: Partial<ContractKey>,
  dual: boolean,
  graphs?: readonly SurfaceProgram[],
  reads: VertexReads = NO_VERTEX_READS,
  marks = false,
  translucentRectLights = TRANSLUCENT_RECT_LIGHTS_DEFAULT,
) => {
  const shade = cloudVertexText(reads)
  const depth = !!graphs?.length && depthOf(graphs)
  const layer = !!graphs?.length && layerOf(graphs)
  const lit = translucentLitKey(key, translucentRectLights)
  return wgslBlock(
    `transmitWgsl(${variantLabel(lit)},${dual}${graphs?.length ? ', graphs' : ''}${shade.key}${marks ? ', surface shadow marks' : ''}${depth ? ', pushed depth' : ''}${layer ? ', layer' : ''})`,
    [
      blendSurfaceWgsl(
        !key.lobeless,
        graphs?.length ? blendGraphs(graphs, !key.lobeless) : undefined,
      ),
      declaredLightingSplitWgsl(lit),
      DISPLAY_ROUTE_WGSL,
      displayMaskWgsl(DISPLAY_MASK_GROUP),
      DISTORTION_WGSL,
      dual
        ? transmitDualWgsl(!!graphs?.length, !key.lobeless, shade, marks, depth, layer)
        : transmitStagesWgsl(!!graphs?.length, !key.lobeless, shade, marks, depth, layer),
    ],
    '',
  )
}
