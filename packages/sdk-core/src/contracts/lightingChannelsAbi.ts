/**
 * THE LIGHTING CHANNELS, written once and read by every carrier of them: an object and a light each
 * hold three channels, and a light lights an object's surface only where they share one (an object and
 * a light with the default share the first, so the default lights as it always did). They act on the
 * direct lighting of the opaque surfaces, of the translucent surfaces lit in the forward pass, and on
 * the shadows the lights cast (a caster in no channel of the light casts none of its own into that
 * light's maps); the translucency lighting volume, the fog and the indirect lighting do not read them.
 *
 * - the public form is `{ channel0, channel1, channel2 }`, each true or false (`LightingChannels`),
 *   channel 0 alone by default (`DEFAULT_LIGHTING_CHANNELS`); a mask with no channel at all is legal and
 *   lights nothing, or is lit by nothing;
 * - the engine's form is the three bits of a mask, channel `n` the bit `n` (`lightingChannelMask`);
 * - the carriers hold the mask stored (`storedLightingChannels`): its first bit turned over, so that a
 *   word never written (all zero) says the default, as the pixel's, the light's and the object's do.
 *
 * Every shift, in whatever word a carrier holds the three bits, is that carrier's own, next to the
 * bits beside them; no carrier restates a count or a mask.
 */

/** The names of the channels, in the order of the bits of their mask. */
export const LIGHTING_CHANNEL_NAMES = ['channel0', 'channel1', 'channel2'] as const
/** The channels a light and an object each hold. */
// A literal, held to the names' count by its type: a count read off the list is a property read a bundle that reads no channel cannot drop.
export const LIGHTING_CHANNEL_COUNT: (typeof LIGHTING_CHANNEL_NAMES)['length'] = 3

/** An object's or a light's lighting channels: each true where the object or light is in the channel. */
export type LightingChannels = {
  readonly [name in (typeof LIGHTING_CHANNEL_NAMES)[number]]: boolean
}

/** The mask of every channel: the bits of the channels a word holds. */
export const ALL_LIGHTING_CHANNELS_MASK = (1 << LIGHTING_CHANNEL_COUNT) - 1
/** The mask of the default: channel 0 alone. */
export const DEFAULT_LIGHTING_CHANNELS_MASK = 1

/** The channels of each mask, one frozen object a mask: what a getter hands out, so that no reader
 *  edits the channels of the object by writing into what it read. */
const BY_MASK: readonly Readonly<LightingChannels>[] = /* @__PURE__ */ Array.from(
  { length: ALL_LIGHTING_CHANNELS_MASK + 1 },
  (_, mask) =>
    Object.freeze(
      Object.fromEntries(
        LIGHTING_CHANNEL_NAMES.map((name, bit) => [name, (mask & (1 << bit)) !== 0]),
      ),
    ) as LightingChannels,
)

/** The default channels: channel 0 alone. */
export const DEFAULT_LIGHTING_CHANNELS: Readonly<LightingChannels> = /* @__PURE__ */ (() =>
  BY_MASK[DEFAULT_LIGHTING_CHANNELS_MASK]!)()

/** The mask of `channels`: channel `n` is bit `n`. */
export const lightingChannelMask = (channels: LightingChannels) =>
  LIGHTING_CHANNEL_NAMES.reduce((mask, name, bit) => mask | (channels[name] ? 1 << bit : 0), 0)

/** The channels of `mask`, the one frozen object that says them. */
const lightingChannelsOfMask = (mask: number) => BY_MASK[mask & ALL_LIGHTING_CHANNELS_MASK]!

/** The mask stored (and the stored mask, the same operation back): the default's bit turned over, so
 *  that zero is the default. */
export const storedLightingChannels = (mask: number) => mask ^ DEFAULT_LIGHTING_CHANNELS_MASK

/** The stored mask of `channels`: what a carrier of an object's channels holds. */
export const storedChannelsOf = (channels: LightingChannels) =>
  storedLightingChannels(lightingChannelMask(channels))

/** Whether `value` is a channel set: an object with the three names, each true or false, and no other. */
export function isLightingChannels(value: unknown): value is LightingChannels {
  if (typeof value !== 'object' || value === null) return false
  const keys = Object.keys(value)
  return (
    keys.length === LIGHTING_CHANNEL_COUNT &&
    LIGHTING_CHANNEL_NAMES.every(
      (name) => typeof (value as Record<string, unknown>)[name] === 'boolean',
    )
  )
}

/** What a set of lighting channels is, for the refusal of one that is not. */
export const LIGHTING_CHANNELS_EXPECTED = '{ channel0, channel1, channel2 }, each true or false'

/** Why `value` is no set of lighting channels, or `undefined`. */
export const lightingChannelsRefusal = (property: string, value: unknown) =>
  isLightingChannels(value) ? undefined : `${property} is ${LIGHTING_CHANNELS_EXPECTED}`

/** `channels` as the one frozen set that says it: what a carrier of the channels holds, so that equal sets
 *  are the same value. */
export const internLightingChannels = (channels: LightingChannels) =>
  lightingChannelsOfMask(lightingChannelMask(channels))
