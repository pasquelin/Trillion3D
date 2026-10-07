import {
  ADMISSION_ERROR_BITS,
  ADMISSION_ERROR_MAX,
  ADMISSION_FLOOR,
  ADMISSION_LEVEL_MAX,
  ADMISSION_SCALE,
  AHEAD_ERROR_MAX,
  REQUEST_AHEAD,
  REQUEST_AHEAD_ERROR_BITS,
  REQUEST_AHEAD_SCALE,
  REQUEST_DUE_STEPS,
  REQUEST_PRIORITY_SCALE,
  REQUEST_STEP_MAX,
} from './request.ts'
import { CLUSTER_LEVEL_SHIFT, CLUSTER_ROOT_CHILD } from './clusterFlags.ts'
import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { DAG_INF } from './shader/infDecl.ts'

/**
 * The quantization of `request.ts` in WGSL, mirrored bit for bit by `request.fixture.ts`. WGSL `log2` and JavaScript `Math.log2` need not return the same
 * last bit, so rounding may split two neighbouring steps: the published order remains that of
 * the errors, only the boundary between two steps is floating. That is why the proof compares
 * ORDERS and not words.
 */
export const DAG_REQUEST_WGSL = wgslBlock(
  'DAG_REQUEST_WGSL',
  [DAG_INF],
  `const REQUEST_AHEAD:u32=${REQUEST_AHEAD}u;
fn errorStep(pixels:f32,scale:f32,top:i32)->u32{
 if(!(pixels>0.0)){return 0u;}
 if(pixels>=INF){return u32(top);}
 return u32(clamp(i32(round(log2(1.0+pixels)*scale)),0,top));
}
fn quantizePriority(pixels:f32)->u32{return errorStep(pixels,${REQUEST_PRIORITY_SCALE}.0,${REQUEST_STEP_MAX});}
/** \`quantizeAdmission\`: the minimum capacity's pages first, then the coarser level, then the
 *  larger error (\`request.ts\`), from the cluster's flags. */
fn admissionPriority(flags:u32,pixels:f32)->u32{
 let level=min(flags>>${CLUSTER_LEVEL_SHIFT}u,${ADMISSION_LEVEL_MAX}u);
 return select(0u,${ADMISSION_FLOOR}u,(flags&${CLUSTER_ROOT_CHILD}u)!=0u)|(level<<${ADMISSION_ERROR_BITS}u)|errorStep(pixels,${ADMISSION_SCALE},${ADMISSION_ERROR_MAX});
}
/** A camera request's priority: by error, or by admission when the pool cannot hold the cut. */
fn cameraPriority(flags:u32,pixels:f32)->u32{
 if(views[0u].admitByLevel!=0u){return admissionPriority(flags,pixels);}
 return quantizePriority(pixels);
}
/** \`quantizeAheadPriority\`: the deadline's step, the sooner the higher, then the error's. */
fn aheadPriority(pixels:f32,due:f32)->u32{
 let late=u32(clamp(floor(due*${REQUEST_DUE_STEPS}.0),0.0,${REQUEST_DUE_STEPS - 1}.0));
 return REQUEST_AHEAD|((${REQUEST_DUE_STEPS - 1}u-late)<<${REQUEST_AHEAD_ERROR_BITS}u)|errorStep(pixels,${REQUEST_AHEAD_SCALE}.0,${AHEAD_ERROR_MAX});
}
fn requestRank(priority:u32)->u32{return priority^REQUEST_AHEAD;}
`,
)
