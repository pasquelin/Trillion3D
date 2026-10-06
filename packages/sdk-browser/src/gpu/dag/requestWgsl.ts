import {
  AHEAD_ERROR_MAX,
  REQUEST_AHEAD,
  REQUEST_AHEAD_ERROR_BITS,
  REQUEST_AHEAD_SCALE,
  REQUEST_DUE_STEPS,
  REQUEST_PAGE_BITS,
  REQUEST_PRIORITY_SCALE,
  REQUEST_STEP_MAX,
} from './request.ts'

/**
 * The quantization of `request.ts` in WGSL, mirrored bit for bit by `request.fixture.ts`. WGSL `log2` and JavaScript `Math.log2` need not return the same
 * last bit, so rounding may split two neighbouring steps: the published order remains that of
 * the errors, only the boundary between two steps is floating. That is why the proof compares
 * ORDERS and not words.
 */
export const DAG_REQUEST_WGSL = `const PAGE_BITS:u32=${REQUEST_PAGE_BITS}u;
const REQUEST_AHEAD:u32=${REQUEST_AHEAD}u;
fn errorStep(pixels:f32,scale:f32,top:i32)->u32{
 if(!(pixels>0.0)){return 0u;}
 if(pixels>=INF){return u32(top);}
 return u32(clamp(i32(round(log2(1.0+pixels)*scale)),0,top));
}
fn quantizePriority(pixels:f32)->u32{return errorStep(pixels,${REQUEST_PRIORITY_SCALE}.0,${REQUEST_STEP_MAX});}
/** \`quantizeAheadPriority\`: the deadline's step, the sooner the higher, then the error's. */
fn aheadPriority(pixels:f32,due:f32)->u32{
 let late=u32(clamp(floor(due*${REQUEST_DUE_STEPS}.0),0.0,${REQUEST_DUE_STEPS - 1}.0));
 return REQUEST_AHEAD|((${REQUEST_DUE_STEPS - 1}u-late)<<${REQUEST_AHEAD_ERROR_BITS}u)|errorStep(pixels,${REQUEST_AHEAD_SCALE}.0,${AHEAD_ERROR_MAX});
}
fn packRequest(page:u32,priority:u32)->u32{return (priority<<PAGE_BITS)|page;}
fn requestPage(word:u32)->u32{return word&((1u<<PAGE_BITS)-1u);}
fn requestWordRank(word:u32)->u32{return (word>>PAGE_BITS)^REQUEST_AHEAD;}
`
