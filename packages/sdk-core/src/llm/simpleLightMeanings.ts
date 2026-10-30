import type { SimpleLightField } from '../contracts/simpleLightOptions.ts'

/** What the settings of the simple lights mean (`../contracts/simpleLightOptions.ts`). */
export const SIMPLE_LIGHT_MEANINGS: Readonly<Record<SimpleLightField, string>> = {
  allowSimpleLights:
    'Whether the simple lights the host hands to an image (particle and effect lights the scene does not hold) are taken; true by default. Off, an image lights nothing by them.',
  hairSimpleLights: 'Whether the hair strands are lit by the simple lights; true by default.',
  sampledSimpleLights:
    'Which simple lights the sampled lighting takes, where a view lights with it: 0 none (the classic pass lights them all), 1 the ones whose entry sets allowSampledLighting (the default; an entry allows none by default, so none), 2 all.',
}
