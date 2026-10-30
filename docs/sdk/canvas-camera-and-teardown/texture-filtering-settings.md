# Texture filtering settings

`world.textureFiltering` holds the settings of the anisotropic filtering, each also a `createWorld`
option: the most reads a texture takes along the longer axis of its footprint. A texture that asks for
less (`Texture.anisotropy`, 8 for a new one; the `maximum` detail asks 16) keeps its own; one that
asks for more is held to the ceiling. A write names the settings it changes, `null` one's default; a
value of another kind is refused by name. They are render settings of the textures group: the quality
presets write them (below), the page's value holds over a preset, and a write applies from the next
image.

| Setting | Takes | Default |
| --- | --- | --- |
| `textureMaxAnisotropy` | A whole number from 1 to 16: the ceiling of the sampler the clouds' textures, the only ones not streamed by tile, are read through; `1` turns their anisotropic filtering off | `8` |
| `virtualTextureMaxAnisotropy` | A whole number from 1 to 16, held to the power of two at or below it: the ceiling of the reads and of the tile requests of every map of a material; a lower one reads fewer taps | `8` |
| `virtualTextureAnisotropicFiltering` | `true` / `false`: `false` reads a streamed texture ONCE per sample, at the level of the footprint's longer axis moved toward the shorter by the elongation (up to the ceiling's logarithm), picked among the two levels it straddles by a per-pixel, per-image noise, the tiles asked being that level's; `true` takes as many taps along the footprint as the elongation asks, up to the ceiling. The same at every quality preset | `false` |

| Quality preset | `smooth` | `balanced` | `fine` | `max` | `cinematic` |
| --- | --- | --- | --- | --- | --- |
| `textureMaxAnisotropy` | `1` | `2` | `4` | `8` | `8` |
| `virtualTextureMaxAnisotropy` | `4` | `4` | `8` | `8` | `8` |

The streamed textures' ceiling bounds what a pixel asks to stream as much as what it reads: a surface
seen at a grazing angle is read at a coarser level when the ceiling is low, and asks for fewer tiles.
The headers of the textures are written again when it moves; the clouds' textures' sampler is made
again.

```js
const world = createWorld('viewer', { virtualTextureMaxAnisotropy: 4 })
world.textureFiltering = { virtualTextureMaxAnisotropy: 16 } // sharper at a slant, from the next image
world.textureFiltering = { textureMaxAnisotropy: 1 } // the clouds' textures read isotropic
world.textureFiltering = { virtualTextureAnisotropicFiltering: true } // taps along the footprint, as many as the elongation asks
world.textureFiltering = { virtualTextureMaxAnisotropy: null, textureMaxAnisotropy: null } // defaults
```

The explorer's tool `trillion3d_set_texture_filtering` writes one setting at a time (`field`, `value`).
