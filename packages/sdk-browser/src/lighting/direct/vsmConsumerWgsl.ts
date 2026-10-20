import { vsmProjectionSampleWgsl } from '../shadows/vsm/projection/projectionSampleWgsl.ts'
import { VSM_CONSTANTS_WGSL } from '../shadows/vsm/constants.ts'
import { VSM_UNIFORMS_WGSL } from '../shadows/vsm/uniforms.ts'
import {
  VSM_HANDLE_WGSL,
  VSM_PAGE_ADDRESS_WGSL,
  VSM_PAGE_LOOKUP_WGSL,
  VSM_STRUCTS_WGSL,
} from '../shadows/vsm/pageTableWgsl.ts'
import {
  VSM_PROJECTION_DATA_READ_WGSL,
  VSM_PROJECTION_DATA_WGSL,
} from '../shadows/vsm/projection/projectionDataWgsl.ts'
import { VSM_NORMAL_OFFSET_WGSL } from '../shadows/vsm/trace/receiverTraceWgsl.ts'
import { perspectiveDivide } from '../../../../math/src/wgsl/projection.ts'
import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { forwardPool, vsmBindingsLabel, type VsmConsumerBindings } from './shadowBindings.ts'

/**
 * The virtual shadow maps a blend pass's fragments trace (`vsmTraceFactor`): the page table, the
 * projection data, the uniforms and the pool's first slice (`forwardPool`), sampled as the
 * projection samples them (`vsmProjectionSampleWgsl`). The host declares the projection's view
 * `vsmView` (`vsmTraceViewWgsl`).
 */
export const vsmConsumerWgsl = (b: VsmConsumerBindings) =>
  wgslBlock(
    `vsmConsumerWgsl(${vsmBindingsLabel(b)})`,
    [
      VSM_CONSTANTS_WGSL,
      VSM_UNIFORMS_WGSL,
      VSM_HANDLE_WGSL,
      VSM_STRUCTS_WGSL,
      VSM_PAGE_ADDRESS_WGSL,
      VSM_PROJECTION_DATA_WGSL,
      VSM_NORMAL_OFFSET_WGSL,
      VSM_PAGE_LOOKUP_WGSL,
      VSM_PROJECTION_DATA_READ_WGSL,
      vsmProjectionSampleWgsl(forwardPool(b.pool)),
      perspectiveDivide,
    ],
    `
@group(0) @binding(${b.uniforms}) var<uniform> vsm:VsmUniforms;
@group(0) @binding(${b.pageTable}) var<storage,read> vsmPageTable:array<u32>;
fn vsmPageTableLoad(i:u32)->u32{return vsmPageTable[i];}
@group(0) @binding(${b.projectionData}) var<storage,read> vsmProjectionData:array<VsmProjectionRecord>;`,
  )
