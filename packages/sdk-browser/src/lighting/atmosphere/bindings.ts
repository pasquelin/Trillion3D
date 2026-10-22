import type { CloudShadowSet } from './cloudShadowRead.ts'
import type { AirResources } from './resources.ts'

/** The virtual shadow maps the air's lights shade it with (`AirBindings.shadow`): the buffers the
 *  fog's volume binds as well. */
export interface AirShadowMaps {
  pageTable: GPUBuffer
  projectionData: GPUBuffer
  uniforms: GPUBuffer
  pool: GPUBuffer
  view: GPUBuffer
}

/** Whether two sets of shadow maps are the same buffers. */
export const sameShadowMaps = (a: AirShadowMaps | undefined, b: AirShadowMaps | undefined) =>
  a === b ||
  (!!a &&
    !!b &&
    a.pageTable === b.pageTable &&
    a.projectionData === b.projectionData &&
    a.uniforms === b.uniforms &&
    a.pool === b.pool &&
    a.view === b.view)

/** Whether two sets of the clouds' shade name the same block and maps (the sampler is the tables'). */
export const sameCloudShadow = (a: CloudShadowSet | undefined, b: CloudShadowSet | undefined) =>
  a === b ||
  (!!a && !!b && a.block === b.block && a.maps[0] === b.maps[0] && a.maps[1] === b.maps[1])

/**
 * THE GROUPS OF THE AIR'S PASSES over one light buffer and one set of shadow maps: each pass's
 * binding group, made again when either is replaced. The tables, the sampler and the frame's and the
 * capture's buffers are the resources' own, shared by every group; `cloudShadow` is the clouds' shade the
 * groups of the programs that march the air with the lights read. The passes the clouds ask for
 * (the haze apart, the haze around a capture) have their groups made when first used.
 */
export function airGroupsOver(
  resources: AirResources,
  buffer: GPUBuffer,
  maps: AirShadowMaps,
  cloudShadow: CloudShadowSet,
) {
  const { tables, sampler, frameBuffer, pass, group, shape } = resources
  const air = { buffer },
    frame = { buffer: frameBuffer },
    transmittance = tables.transmittance.view,
    multiScatter = tables.multiScatter.view
  const shadow = {
    pageTable: { buffer: maps.pageTable },
    projectionData: { buffer: maps.projectionData },
    shadowUniforms: { buffer: maps.uniforms },
    shadowPool: { buffer: maps.pool },
    shadowView: { buffer: maps.view },
  }
  const clouds = {
    cloudShadow: { buffer: cloudShadow.block },
    cloudShadowMap0: cloudShadow.maps[0],
    cloudShadowMap1: cloudShadow.maps[1],
  }
  const tabled = { air, transmittance, multiScatter, sampler }
  const over = (
    name: Parameters<typeof pass>[0],
    resourcesOf: Record<string, GPUBindingResource>,
  ) => {
    const { program, layout } = pass(name)
    return group(program, layout, resourcesOf)
  }
  const lazy: { separate?: GPUBindGroup; capture360?: GPUBindGroup } = {}
  return {
    buffer,
    maps: { ...maps },
    cloudShadow,
    transmittance: shape.transmittance.on
      ? over('transmittance', { air, table: transmittance })
      : undefined,
    multiScatter: over('multiScatter', { air, table: multiScatter, transmittance, sampler }),
    publish: over('publish', { air, transmittance, sampler }),
    skyView: over('skyView', {
      ...tabled,
      table: tables.skyView.view,
      frame,
      ...shadow,
      ...clouds,
    }),
    haze: over('haze', { ...tabled, frame, ...shadow, ...clouds }),
    distantSky: over('distantSky', tabled),
    skyRays: over('skyRays', { ...tabled, frame }),
    /** The haze that keeps the haze's light and the air's apart. */
    get separate() {
      return (lazy.separate ??= over('hazeSeparate', {
        ...tabled,
        frame,
        ...shadow,
        ...clouds,
        volumes: { buffer: resources.volumes },
      }))
    },
    /** The haze around the capture's place. */
    get capture360() {
      return (lazy.capture360 ??= over('capture360', {
        ...tabled,
        frame,
        volumes: { buffer: resources.volumes },
      }))
    },
  }
}

/** The groups of the air's passes over one light buffer (`airGroupsOver`). */
export type AirGroups = ReturnType<typeof airGroupsOver>
