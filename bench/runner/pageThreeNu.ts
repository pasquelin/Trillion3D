// The BARE Three.js witness: a naive render of the same scene, with nothing of the SDK. This
// module is SERVED to the page (`/mesure/` mount) and imports only `three`, from `/vendor/three/`,
// hence from the bench's dev dependencies — never from the engine. The day the Three adapters
// leave `packages/`, this page does not move: that is what makes it independent.
//
// What it renders: the source glTF loaded as-is, Three's `MeshStandardMaterial`, everything drawn
// every frame with no selection and no streaming, the contract lights placed in Three. What it
// does not render, named: no cascades, no temporal antialiasing, no bounce, no instances, no
// level of detail. The measurement loop and what it records are in `pageThreeMesure.ts`.
import { mesurerThree } from './pageThreeMesure.ts';
import type { MeasureViewOptions } from './mesureOptions.ts';

/** One view, one threshold (ignored: Three has none), the capture. Same contract as `measureView`. */
export const measureView = (options: MeasureViewOptions) => mesurerThree(options);
