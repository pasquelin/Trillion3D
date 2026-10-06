// The animation folder's face: what a clip is (`./clip.ts`), what plays it (`./mixer.ts`), the
// family that names both (`./family.ts`), a skeleton and the wind clip that poses one
// (`./skeleton.ts`, `./wind.ts`). Every name is re-exported from the module that defines it, so a
// reader here is sent to the definition; and no module in the folder imports this one, so nothing
// has to reach back through the barrel to find a name that lives beside it.
export type { Clip, Track, TrackBinding, TrackKind } from './clip.ts'
export { Action, Mixer, advanceMixers } from './mixer.ts'
export { animation } from './family.ts'
export { Skeleton } from './skeleton.ts'
export type { WindOptions } from './wind.ts'
