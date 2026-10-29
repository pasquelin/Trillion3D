import type { HeterogeneousVolumeField } from '../../../../sdk-core/src/contracts/heterogeneousVolumeOptions.ts'
import { LIGHT_KIND } from '../../../../sdk-core/src/scene/light/contracts.ts'
import { HV_SHADOW_FACES } from './beerShadowMapWgsl.ts'

/** The bytes of the map uniform (`HvShadow`): the info words, the bounding sphere, the near distance. */
export const HV_SHADOW_BYTES = 12 * 4

/** The map of one light a frame built, for the passes that read the volumes' shadows (`hvBeerTransmittance`,
 *  `BEER_READ_WGSL`, with `uniform` as `hvShadow` and `view` as `hvBeerRead`). */
export interface HeterogeneousShadowMap {
  /** The light's rank in the light buffer and its shadow slice, the key the lit passes find it by. */
  readonly rank: number
  readonly slice: number
  readonly view: GPUTextureView
  readonly uniform: GPUBuffer
  readonly faces: number
  readonly resolution: number
  readonly directional: boolean
}

/** The texture format of the map: 16 bits a channel (precision 0) or 32. */
export const beerFormatOf = (precision: number): GPUTextureFormat =>
  precision === 1 ? 'rgba32float' : 'rgba16float'

/** The faces of a light's map: one for a directional light, a cube's six for a local one. */
const beerFacesOf = (directional: boolean) => (directional ? 1 : HV_SHADOW_FACES)

/** The uniform of a light's map. */
function packShadow(
  faces: number,
  directional: boolean,
  resolution: number,
  rank: number,
  sphere: readonly [number, number, number, number],
  near: number,
  precision: number,
) {
  const out = new ArrayBuffer(HV_SHADOW_BYTES)
  new Uint32Array(out).set([faces, directional ? 1 : 0, resolution, rank], 0)
  new Float32Array(out).set([...sphere, near, precision, 0, 0], 4)
  return out
}

/** The sphere that holds every box (each a column-major matrix to the world and the half extents and centre of its bounds). */
export function boundingSphere(
  boxes: readonly {
    toWorld: ArrayLike<number>
    centre: readonly number[]
    extent: readonly number[]
  }[],
): [number, number, number, number] {
  const corners: number[][] = []
  for (const { toWorld: m, centre, extent } of boxes)
    for (let k = 0; k < 8; k++) {
      const p = [0, 1, 2].map((i) => centre[i] + extent[i] * (k & (1 << i) ? 1 : -1))
      corners.push(
        [0, 1, 2].map((r) => m[r] * p[0] + m[4 + r] * p[1] + m[8 + r] * p[2] + m[12 + r]),
      )
    }
  const centre = [0, 1, 2].map(
    (i) => (Math.min(...corners.map((c) => c[i])) + Math.max(...corners.map((c) => c[i]))) / 2,
  )
  const radius = Math.max(
    ...corners.map((c) => Math.hypot(c[0] - centre[0], c[1] - centre[1], c[2] - centre[2])),
  )
  return [centre[0], centre[1], centre[2], radius]
}

/** A light that has a map: its rank in the light buffer, whether it is directional, its faces. */
export interface ShadowLight {
  readonly rank: number
  readonly slice: number
  readonly directional: boolean
  readonly faces: number
}

/** The setting that lets each kind of light cast a volumetric shadow (`SupportsShadowForLightType`, `HeterogeneousVolumesVoxelGridPipeline.cpp:557`). */
export const shadowLightSettingOf = (kind: number): HeterogeneousVolumeField =>
  kind === LIGHT_KIND.directional
    ? 'heterogeneousVolumesShadowsLightDirectional'
    : kind === LIGHT_KIND.point
      ? 'heterogeneousVolumesShadowsLightPoint'
      : kind === LIGHT_KIND.spot
        ? 'heterogeneousVolumesShadowsLightSpot'
        : 'heterogeneousVolumesShadowsLightRect'

/** The lights of the store that cast a shadow into the fog (the kernel skips the others): a directional light does by default. `kinds` says which kinds of
 *  light may cast a volumetric shadow (`SupportsShadowForLightType`, the `LIGHT_KIND` of the light). */
export function shadowLightsOf(
  store: {
    readonly count: number
    readonly ids: readonly string[]
    kindOf(slot: number): number
    sliceOf(slot: number): number
    light(id: string): { castsShadow?: boolean; shadowsFog?: boolean } | undefined
  },
  kinds: (kind: number) => boolean = () => true,
): ShadowLight[] {
  const lights: ShadowLight[] = []
  for (let rank = 0; rank < store.count; rank++) {
    const directional = store.kindOf(rank) === LIGHT_KIND.directional
    const record = store.light(store.ids[rank])
    const slice = store.sliceOf(rank)
    if (
      slice >= 0 &&
      kinds(store.kindOf(rank)) &&
      record?.castsShadow &&
      (record.shadowsFog ?? directional)
    )
      lights.push({ rank, slice, directional, faces: beerFacesOf(directional) })
  }
  return lights
}

/** What a build of one volume binds for the map of a light. */
export interface BeerBind {
  readonly uniform: GPUBuffer
  readonly previous: GPUTextureView
  readonly out: GPUTextureView
}

/**
 * One volume's turn at the maps of every light: for each, a dispatch that combines the volume's rays into the map the volumes
 * before it left. Two images alternate (a volume reads what the last wrote) from a third that is never written, which holds
 * nothing for the first; `built` counts the volumes done by light.
 */
export function encodeBeerBuild(c: {
  encoder: GPUCommandEncoder
  pipeline: GPUComputePipeline
  lights: readonly ShadowLight[]
  resolution: number
  built: Map<number, number>
  uniformOf(rank: number): GPUBuffer
  imageOf(key: string, size: readonly [number, number]): GPUTexture
  bindFor(beer: BeerBind): GPUBindGroup
}) {
  for (const light of c.lights) {
    const size = [c.resolution * light.faces, c.resolution] as const
    const images = [0, 1].map((k) => c.imageOf(`beer ${light.rank} ${k}`, size))
    const done = c.built.get(light.rank) ?? 0
    const previous = done ? images[(done - 1) % 2] : c.imageOf(`beer ${light.rank} empty`, size)
    const pass = c.encoder.beginComputePass({ label: 'Trillion3D heterogeneous volume shadow map' })
    pass.setPipeline(c.pipeline)
    pass.setBindGroup(
      0,
      c.bindFor({
        uniform: c.uniformOf(light.rank),
        previous: previous.createView(),
        out: images[done % 2].createView(),
      }),
    )
    pass.dispatchWorkgroups(Math.ceil(c.resolution / 8), Math.ceil(c.resolution / 8), light.faces)
    pass.end()
    c.built.set(light.rank, done + 1)
  }
}

/** The maps the builds left, to publish: a light no volume was built for has none. */
export function builtShadowMaps(
  lights: readonly ShadowLight[],
  built: ReadonlyMap<number, number>,
  resolution: number,
  uniformOf: (rank: number) => GPUBuffer,
  imageOf: (key: string, size: readonly [number, number]) => GPUTexture,
): HeterogeneousShadowMap[] {
  return lights.flatMap((light) => {
    const done = built.get(light.rank)
    if (!done) return []
    const image = imageOf(`beer ${light.rank} ${(done - 1) % 2}`, [
      resolution * light.faces,
      resolution,
    ])
    return [
      {
        rank: light.rank,
        slice: light.slice,
        view: image.createView(),
        uniform: uniformOf(light.rank),
        faces: light.faces,
        resolution,
        directional: light.directional,
      },
    ]
  })
}

/** Writes the uniform of every light's map: its faces, size and rank, the volumes' bounding sphere and the near distance. */
export function writeShadowUniforms(
  device: GPUDevice,
  lights: readonly ShadowLight[],
  uniformOf: (rank: number) => GPUBuffer,
  c: {
    resolution: number
    sphere: [number, number, number, number]
    near: number
    precision: number
  },
) {
  for (const light of lights)
    device.queue.writeBuffer(
      uniformOf(light.rank),
      0,
      packShadow(
        light.faces,
        light.directional,
        c.resolution,
        light.rank,
        c.sphere,
        c.near,
        c.precision,
      ),
    )
}
