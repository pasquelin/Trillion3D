import {
  computeBufferEntry,
  computeStorageTextureEntry,
  computeTextureEntry,
  computeUniformEntry,
} from '../core/computeBindings.ts'
import { HIZ_FORMAT } from './pyramidTexture.ts'

/**
 * Group-0 bindings, published under the WGSL that declares them. The production layout and the
 * GPU proofs READ them here — none copies them, so none can lag behind the shader. That lag is
 * what turned the Hi-Z occlusion proof (`tests/gpu/hiz/occlusion-test.gpu.ts`) red: its copy had
 * stopped at `@binding(4)` while `state` entered at 5.
 */
export function hizBindEntries(uniformBytes: number): GPUBindGroupLayoutEntry[] {
  return [
    computeStorageTextureEntry(0, HIZ_FORMAT, 'read-write', '2d-array'),
    computeTextureEntry(1, 'unfilterable-float', '2d-array'),
    computeUniformEntry(2, { hasDynamicOffset: true, minBindingSize: uniformBytes }),
    computeBufferEntry(3, 'read-only-storage'),
    computeBufferEntry(4, 'storage'),
    computeBufferEntry(5, 'storage'),
  ]
}

/** Group 1, the test's alone: the page table, whose Hi-Z slot word tells a row that has no
 *  verdict (never culled). The pyramid kernels bind group 0 only. */
export const HIZ_TEST_PAGES_ENTRIES: GPUBindGroupLayoutEntry[] = [
  computeBufferEntry(0, 'read-only-storage'),
]

/** Group 1 of `testHizArgs`, beside the page table of `testHiz` (binding 0): the test's dispatch
 *  arguments, written there and read as the indirect arguments of `testHiz`. The group is set for
 *  the kernel that writes them and replaced by the page table before the dispatch that reads them:
 *  an arguments buffer bound as storage in the dispatch it feeds is refused. */
export const HIZ_TEST_ARGS_ENTRIES: GPUBindGroupLayoutEntry[] = [computeBufferEntry(1, 'storage')]

/** Bytes of the test's dispatch arguments. */
export const HIZ_TEST_ARGS_BYTES = 12
