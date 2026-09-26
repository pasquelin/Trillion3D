/** The engine's types as the kit's pieces name them: types only, so the kit bundle folds in
 *  nothing of the engine; the page hands each piece the families it builds with. */
import type * as Engine from '../../../packages/sdk-browser/src/index.ts';

export type { Engine };
/** The engine families `K` a piece builds with, as the page imports them. */
export type Families<K extends keyof typeof Engine> = Pick<typeof Engine, K>;
export type Mesh = ReturnType<(typeof Engine)['object']['mesh']>;
export type Shape = Parameters<(typeof Engine)['object']['mesh']>[0];
export type Look = ReturnType<(typeof Engine)['material']['meshStandard']>;
export type Vec3 = [number, number, number];
