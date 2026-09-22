/**
 * The clear colour, unpacked in one place.
 *
 * Every backend receives it as a single packed integer of three sRGB bytes, and three different
 * readers need it as components: the render pass that clears the colour target, the lighting
 * view that composes over it, and the display graph the engine publishes, whose `background` a
 * host reads in linear. They differ in what they do with the channels, never in how the byte
 * triple is taken apart, so the taking apart lives here.
 */

/** The three sRGB channels of a packed clear colour, plus the opaque alpha a clear writes. */
export function clearValueOf(clearColor: number) {
  return {
    r: ((clearColor >> 16) & 0xff) / 0xff,
    g: ((clearColor >> 8) & 0xff) / 0xff,
    b: (clearColor & 0xff) / 0xff,
    a: 1,
  };
}

/** `#rrggbb` of three bytes: how a colour is written for a person to read. */
export const rgbHex = (red: number, green: number, blue: number) =>
  `#${[red, green, blue].map((channel) => channel.toString(16).padStart(2, '0')).join('')}`;
