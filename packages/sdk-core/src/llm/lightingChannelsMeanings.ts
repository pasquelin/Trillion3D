import { LIGHTING_CHANNEL_NAMES } from '../contracts/lightingChannelsAbi.ts'
import type { JsonSchemaProperty } from './types.ts'

/**
 * The `lightingChannels` field of the light tool (`SceneLight.lightingChannels`,
 * `../contracts/lightingChannelsAbi.ts`): three required booleans, and what they mean as the language-model
 * tools and the site say it.
 */
export const lightingChannelsProperty = (): JsonSchemaProperty => ({
  type: 'object',
  description:
    'The lighting channels this light is in, an object { channel0, channel1, channel2 } of three booleans; channel 0 alone by default. The light lights the surfaces of an object, and its shadow holds the object as a caster, only when the object is in at least one of the same channels (Object3D.lightingChannels). They act on the direct light of opaque surfaces and of translucent surfaces lit in the forward pass; the translucency lighting volume, the fog and the indirect light do not read them.',
  properties: Object.fromEntries(
    LIGHTING_CHANNEL_NAMES.map((name) => [
      name,
      {
        type: 'boolean',
        description: `Whether the light is in ${name.replace('channel', 'channel ')}.`,
      } satisfies JsonSchemaProperty,
    ]),
  ),
  required: LIGHTING_CHANNEL_NAMES,
})
