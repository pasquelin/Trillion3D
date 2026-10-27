// The small layout most shadow tests run their programs over: seven full maps, three of them the suns',
// the receiver cover made for the suns' maps (`coverMode`).
import { vsmLayout } from './layout.ts'

export const SUNS_LAYOUT = vsmLayout({ coverMode: 'suns', fullMapCapacity: 7, sunMapCapacity: 3 })
