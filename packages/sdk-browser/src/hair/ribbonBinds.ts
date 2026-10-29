import { createWebgpuBindIdentity } from '../gpu/bind/bindIdentity.ts'
import { bufferEntries } from '../gpu/core/computeBindings.ts'

/** What a pass reads of an instance drawn in an image. */
export interface DrawnInstance {
  /** The control points of the instance's group: the segments its ribbons are drawn from. */
  readonly pointCount: number
  /** The bind group 0 of `pipeline`: the group's points and tangents and the instance's block. */
  group(pipeline: GPUComputePipeline | GPURenderPipeline): GPUBindGroup
}

/**
 * The bind groups 0 of an instance, one for each pipeline that draws it: a group's points and tangents and the instance's block are for good,
 * so a pipeline's group is made at its first draw and kept as long as the pipeline is (the count of pipelines that take turns is the passes'
 * own, not held here).
 */
export function instanceGroups(
  device: GPUDevice,
  points: GPUBuffer,
  tangents: GPUBuffer,
  uniform: GPUBuffer,
): DrawnInstance['group'] {
  const groups = new WeakMap<object, GPUBindGroup>()
  return (pipeline) => {
    let held = groups.get(pipeline)
    if (!held) {
      held = device.createBindGroup({
        layout: pipeline.getBindGroupLayout(0),
        entries: bufferEntries([points, tangents, uniform]),
      })
      groups.set(pipeline, held)
    }
    return held
  }
}

/**
 * Bind groups kept while the pipeline they are made for and the resources they name stay the same
 * (`createWebgpuBindIdentity`, the engine's one bind-group cache): `depth` is how many pipelines
 * take turns with the resources, each its own group (the pipelines' layouts are their own,
 * `'auto'`). The returned reader gives the group of `pipeline` over `a`, `b` and `c`, made by `make`
 * when one of them moved; it allocates nothing. The reader belongs to the resources it binds: it is
 * made with them and goes when they do.
 */
export function boundGroups<A, B, C, D = undefined>(
  depth: number,
  make: (
    device: GPUDevice,
    pipeline: GPUComputePipeline | GPURenderPipeline,
    a: A,
    b: B,
    c: C,
    d: D,
  ) => GPUBindGroup,
) {
  const identity = createWebgpuBindIdentity(depth)
  const groups: GPUBindGroup[] = []
  return (
    device: GPUDevice,
    pipeline: GPUComputePipeline | GPURenderPipeline,
    a: A,
    b: B,
    c: C,
    d?: D,
  ) => {
    const { next } = identity
    next[0] = pipeline
    next[1] = a
    next[2] = b
    next[3] = c
    next[4] = d
    if (identity.moved()) groups[identity.slot] = make(device, pipeline, a, b, c, d as D)
    return groups[identity.slot]!
  }
}
