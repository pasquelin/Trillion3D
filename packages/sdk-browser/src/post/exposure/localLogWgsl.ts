import { wgslFn } from '../../../../math/src/wgsl/decl.ts'

/**
 * `localLog(base, grey, contrast, edge, reach)`: the log2 luminance the local exposure puts a base
 * layer of log2 luminance `base` at, with no detail added. Each pair is (above middle grey, under
 * it). The base's distance from middle grey `grey` (log2) is split at a threshold, `edge`: inside
 * it the base keeps its own contrast, past it a smoothstep over `reach` stops hands the distance to
 * the scale `contrast`. The finishing's per-pixel gain (`finishWgsl.ts`) and the exposure's mean of
 * that gain over the histogram (`meterWgsl.ts`) both read it, so the two agree.
 */
export const LOCAL_LOG_WGSL = wgslFn(
  'localLog',
  [],
  `fn localLog(base:f32,grey:f32,contrast:vec2f,edge:vec2f,reach:vec2f)->f32{
 var centred=base-grey;
 let high=centred>0.0;
 let scale=select(contrast.y,contrast.x,high);
 let threshold=select(edge.y,edge.x,high);
 let span=select(reach.y,reach.x,high);
 let kept=select(min(0.0,centred+threshold),max(0.0,centred-threshold),high);
 let grown=saturate((abs(centred)-threshold)/span);
 let shift=(centred-kept)*(1.0-grown*grown*(3.0-2.0*grown));
 centred=centred-shift;
 return grey+shift+centred*scale;
}`,
)
