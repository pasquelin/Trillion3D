import { createWebgpuBindIdentity } from '../gpu/bind/bindIdentity.ts'

/** What a pass reads of an instance drawn in an image. */
export interface DrawnInstance {
  /** The control points of the instance's group: the segments its ribbons are drawn from. */
  readonly pointCount: number
  /** The bind group 0 of `pipeline`: the group's points and tangents and the instance's block. */
  group(pipeline: GPUComputePipeline | GPURenderPipeline): GPUBindGroup
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
