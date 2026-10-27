import { FLAG_DIAGNOSTIC_VIEW } from '../../visibility/types.ts'
import { declaredLightingSplitWgsl } from '../../lighting/direct/declaredLightingWgsl.ts'
import type { ContractKey } from '../../lighting/deferred/contractCuts.ts'
import { DEFAULT_TRANSLUCENT_SCENE, translucentLitKey, type TranslucentScene } from '../shader.ts'
import {
  stageLabel,
  stageLobes,
  stageOptions,
  stageSurface,
  type StageOptions,
} from '../stageOptions.ts'
import type { SurfaceProgram } from '../../materials/graph/surfaceProgram.ts'
import { NO_VERTEX_READS, type VertexReads } from '../cloudVertexText.ts'
import {
  DISPLAY_MASK_GROUP,
  DISPLAY_ROUTE_WGSL,
  displayMaskWgsl,
} from '../display/displayFilter.ts'
import { DISTORTION_WGSL } from './distortionWgsl.ts'
import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { transmitStagesWgsl } from './transmitStagesWgsl.ts'

/** The dual blend, one pass for the thin layer's two effects on the destination: what is added,
 *  then the destination's per-channel multiply; the alpha takes the layer's grey coverage over the
 *  target's (`greyCoverage`, the fallback's rule). The modulation pass draws the same layers again for the multiply
 *  alone (`fsTransmitModulate`), a plain blend by its own colour, with the request beside it: no light is read for a
 *  colour its blend drops. */
const transmitDualWgsl = (o: StageOptions) =>
  wgslBlock(
    `TRANSMIT_DUAL_WGSL(${stageLabel(o)})`,
    [transmitStagesWgsl(o)],
    `struct TransmitDual{@location(0) @blend_src(0) add:vec4f,@location(0) @blend_src(1) mul:vec4f,}
// The two sources of \`add\` and \`mul\`: the light laid with the layer's grey coverage, the multiply.
@fragment fn fsTransmitDual(in:VSOut,@builtin(front_facing) front:bool)->TransmitDual{${o.shade.entry}
 let t=transmitFragment(in,front);
 return TransmitDual(vec4f(t.add,greyCoverage(t.mul)),vec4f(t.mul,1.0));
}
// The modulation pass's draw of the same layers: the multiply, which its blend takes the destination by
// (\`src\`: no second source), adding nothing, and the request.
struct Modulated{@location(0) mul:vec4f,@location(1) request:u32,}
@fragment fn fsTransmitModulate(in:VSOut,@builtin(front_facing) front:bool)->Modulated{${o.shade.entry}
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
 * those of the blend module of the same `scene` (`TranslucentScene`: the project switch `translucentRectLights`, and whether the
 * scene holds a surface whose material asks for contact shadows): the stages then set that ask before they light.
 */
export const transmitWgsl = (
  key: Partial<ContractKey>,
  dual: boolean,
  graphs?: readonly SurfaceProgram[],
  reads: VertexReads = NO_VERTEX_READS,
  marks = false,
  scene: TranslucentScene = DEFAULT_TRANSLUCENT_SCENE,
) => {
  const lit = translucentLitKey(key, scene)
  const o = stageOptions(lit, graphs, reads, marks)
  return wgslBlock(
    `transmitWgsl(${dual}, ${stageLabel(o)})`,
    [
      stageSurface(stageLobes(o), graphs),
      declaredLightingSplitWgsl(lit),
      DISPLAY_ROUTE_WGSL,
      displayMaskWgsl(DISPLAY_MASK_GROUP),
      DISTORTION_WGSL,
      dual ? transmitDualWgsl(o) : transmitStagesWgsl(o),
    ],
    '',
  )
}
