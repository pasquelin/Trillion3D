import { computeBufferEntry, computeUniformEntry } from '../../gpu/core/computeBindings.ts'
import { ORDER_BINDING } from './orderWgsl.ts'

/** Words of one dispatch's uniform (`OrderUni`), at its dynamic offset. */
export const ORDER_UNI_WORDS = 16

/** Group-0 layout entries of the order kernel, read from its bindings (`ORDER_BINDING`): the uniform at its
 *  dynamic offset, then its five storage buffers. */
export function blendOrderBindEntries(): GPUBindGroupLayoutEntry[] {
  return [
    computeUniformEntry(ORDER_BINDING.uni, {
      hasDynamicOffset: true,
      minBindingSize: ORDER_UNI_WORDS * 4,
    }),
    computeBufferEntry(ORDER_BINDING.plan, 'storage'),
    computeBufferEntry(ORDER_BINDING.keyed, 'read-only-storage'),
    computeBufferEntry(ORDER_BINDING.frame, 'read-only-storage'),
    computeBufferEntry(ORDER_BINDING.sorted, 'storage'),
    computeBufferEntry(ORDER_BINDING.placed, 'storage'),
  ]
}
