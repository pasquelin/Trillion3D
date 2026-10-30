import { layerBody, layerEntry } from './sceneEntry.ts'
import { wgslStruct } from '../../../math/src/wgsl/decl.ts'
import { FLAG_DIAGNOSTIC_VIEW } from '../visibility/types.ts'
import type { CloudVertexText } from './cloudVertexText.ts'

/**
 * THE STAGES A LAYER SHARES, whether it is a blend or a transmissive one: the request the modulation
 * pass of the dual blend writes for the layers it does not multiply by, and the responsiveness pass's mark. Each is written once for the prologue of its kind
 * (`blendLayer`, `transmitSurface`: both give `kept` and the surface `s`), with the entry point named
 * for the kind, `fs<Kind>Coverage` and `fs<Kind>Responsive`.
 */

/** The request stage's output: the request, beside the colour target the pass holds at location 0 with
 *  an empty write mask (`marksTargets`), which it leaves unwritten. */
export const COVERED = wgslStruct(
  'Covered',
  [],
  'struct Covered{@location(0) unwritten:vec4f,@location(1) request:u32,}',
)

/** The responsiveness pass's output, with the pixel depth offset's depth where `depth` holds. */
export const marked = (depth: boolean) =>
  wgslStruct(
    depth ? 'MarkedDepth' : 'Marked',
    [],
    `struct ${depth ? 'MarkedDepth' : 'Marked'}{@location(0) responsive:f32,${depth ? '@builtin(frag_depth) depth:f32,' : ''}}`,
  )

/** The derivatives and the layer's prologue (`prologue`, a call of `in`, `front` and the gradients
 *  `g`), after which a rejected fragment returns `rejected`. */
const layerHead = (prologue: string, rejected: string) => ` let deltas=fwidth(in.bary);
 let g=blendGrads(in);
 let layer=${prologue}(in,front,g);
 if(!layer.kept){discard;return ${rejected};}`

/** The request stage `fs<kind>Coverage`, for the layers the modulation pass of the dual blend (`drawModulation`)
 *  does not multiply by, where the colour pass holds one target alone and writes no request: the layer's
 *  request, no light read; a diagnostic view keeps its colour's discards. */
export const coverageStageText = (kind: string, prologue: string, shade: CloudVertexText) =>
  `// The layer's request, for the modulation pass of the dual blend (\`drawModulation\`), where the colour pass
// holds one target alone: the colour pass's request, no light read; a diagnostic view keeps its
// colour's discards.
${layerEntry(`fs${kind}Coverage`, 'Covered', shade.entry)}
${layerBody(`fs${kind}Coverage`, 'Covered')}{
${layerHead(prologue, 'Covered(vec4f(0.0),0u)')}
 if((in.ids.y&${FLAG_DIAGNOSTIC_VIEW}u)!=0u){_=blendDiagnosticOut(in,layer.s,deltas);}
 return Covered(vec4f(0.0),layer.s.request);
}
`

/** The responsiveness stage `fs<kind>Responsive` (`drawResponsive`): the mark the layer's surface leaves
 *  in the temporal pass (`blendResponsive`) at `opacity`, in the pass of its own, which tests the depth
 *  against the opaque scene's — the pixel depth offset's where `depth` holds. A diagnostic view marks
 *  by its colour's coverage with `coverage`, else not at all. */
export const responsiveStageText = (
  kind: string,
  prologue: string,
  opacity: string,
  coverage: boolean,
  shade: CloudVertexText,
  depth: boolean,
) => {
  const out = depth ? 'MarkedDepth' : 'Marked'
  return `// The responsiveness the layer leaves in the temporal pass (\`blendResponsive\`), in the pass of its own
// (\`drawResponsive\`) which tests the depth${depth ? ' the pixel depth offset moves the pixel to' : ''} against the opaque scene's; a diagnostic view leaves
// ${coverage ? "the mark of its colour's coverage" : 'none'}.
${layerEntry(`fs${kind}Responsive`, out, shade.entry)}
${layerBody(`fs${kind}Responsive`, out)}{
${layerHead(prologue, `${out}(0.0${depth ? ',0.0' : ''})`)}
 var opacity=${opacity};
 if((in.ids.y&${FLAG_DIAGNOSTIC_VIEW}u)!=0u){opacity=${coverage ? 'blendDiagnosticOut(in,layer.s,deltas).color.a' : '0.0'};${coverage ? '' : '_=blendDiagnosticOut(in,layer.s,deltas);'}}
 return ${out}(blendResponsive(in,opacity)${depth ? ',blendPushedDepth(in,g)' : ''});
}
`
}
