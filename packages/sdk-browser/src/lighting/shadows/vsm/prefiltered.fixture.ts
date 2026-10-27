// The sets the prefiltered distant shadow's tests share: the same capacities, with the feature (`ON`)
// and without (`OFF`).
import { vsmLayout, type VsmLayout } from './layout.ts'

export const MAPS = {
  coverMode: 'suns' as const,
  fullMapCapacity: 127,
  sunMapCapacity: 35,
  poolPages: 256,
}
export const OFF: VsmLayout = vsmLayout(MAPS)
export const ON: VsmLayout = vsmLayout({ ...MAPS, prefilteredDistant: true })
