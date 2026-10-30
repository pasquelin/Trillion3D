# Lighting channels

A light lights an object only if they share a **lighting channel**. There are three, `channel0`, `channel1` and `channel2`, and
every object and every light is in channel 0 alone by default, so by default every light lights every object. Both hold
`lightingChannels`, a set of three booleans (saved with the world): a whole set is written, the set read is frozen, and a set missing a
channel, or holding anything but booleans, is refused (`RangeError` for an object, `INVALID_SCENE_LIGHT` for a light). A set with no
channel is legal: an object in none is lit by no light, a light in none lights nothing.

```js
// A lamp that lights the scenery in channel 1 alone, and a prop in channels 0 and 1 that every light reaches.
const lamp = light.point({ lightingChannels: { channel0: false, channel1: true, channel2: false } })
scenery.lightingChannels = { channel0: false, channel1: true, channel2: false }
prop.lightingChannels = { channel0: true, channel1: true, channel2: false }
lamp.lightingChannels = { channel0: true, channel1: true, channel2: false } // a write reaches the lights at once
```

The channels act on the direct light of the opaque surfaces and of the see-through surfaces lit in the forward pass
(`translucencyLighting: 'forward'`, the water, the transmissive layers); the translucency lighting volume, the fog and the indirect
light do not read them. A scene whose lights and objects are all in channel 0 compiles its lighting without the test.
