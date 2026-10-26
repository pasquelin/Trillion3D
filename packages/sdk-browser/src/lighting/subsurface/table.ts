import {
  PROFILE_TABLE_WIDTH,
  buildProfileTable,
} from '../../../../sdk-core/src/lighting/subsurfaceProfile/table.ts'
import type { SubsurfaceProfile } from '../../../../sdk-core/src/lighting/subsurfaceProfile/profile.ts'
import { SUBSURFACE_PASS } from '../../diagnostic/stage/passLabels.ts'
import { SSS_COLOUR_FORMAT } from './layout.ts'

/** The profile table on the GPU: a row a profile, the default skin's first, each value a half float of its sixteen-bit code over 65535
 *  — what a device that cannot store the codes as normalised integers reads —, one texture for the profiles it was made from. */
export interface ProfileTable {
  readonly view: GPUTextureView
  readonly bytes: number
  /** The profiles' revision it was made for. */
  readonly revision: number
  /** The channel that steers the sampled scattering it was made for (`buildProfileTable`). */
  readonly samplingChannel: number
  destroy(): void
}

const halvesMade = new WeakMap<
  readonly SubsurfaceProfile[],
  { revision: number; samplingChannel: number; halves: Uint16Array }
>()

/** The table of `profiles` as its half floats (`buildProfileTable`), made once for a revision of them and a sampling channel: what the GPU table is made from
 *  and the lights' rows (`litRows.ts`). */
export function profileHalves(
  profiles: readonly SubsurfaceProfile[],
  revision: number,
  samplingChannel: number,
) {
  const made = halvesMade.get(profiles)
  if (made?.revision === revision && made.samplingChannel === samplingChannel) return made.halves
  const halves = buildProfileTable(profiles, samplingChannel)
  halvesMade.set(profiles, { revision, samplingChannel, halves })
  return halves
}

/** The table of `profiles` (at most 255), made on `device`. */
export function createProfileTable(
  device: GPUDevice,
  profiles: readonly SubsurfaceProfile[],
  revision: number,
  samplingChannel: number,
): ProfileTable {
  const halves = profileHalves(profiles, revision, samplingChannel)
  const rows = halves.length / (PROFILE_TABLE_WIDTH * 4)
  const texture = device.createTexture({
    label: `${SUBSURFACE_PASS} profiles`,
    size: [PROFILE_TABLE_WIDTH, rows],
    format: SSS_COLOUR_FORMAT,
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
  })
  device.queue.writeTexture(
    { texture },
    halves as Uint16Array<ArrayBuffer>,
    { bytesPerRow: PROFILE_TABLE_WIDTH * 8 },
    [PROFILE_TABLE_WIDTH, rows],
  )
  return {
    view: texture.createView(),
    bytes: halves.byteLength,
    revision,
    samplingChannel,
    destroy: () => texture.destroy(),
  }
}
