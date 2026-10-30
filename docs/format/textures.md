# Textures

Every atlas texture's mip chain: the tail in the head's column file, then one block file per level above
it. BC is the stored family: the level files are written in it (`bc7` RGBA, `bc5` for a normal map's two
channels); ASTC and ETC2/EAC (`etc2`, `eac-rg`) are written beside it on demand (`--textures-format`,
default `bc7`; a family name cooks BC and it, `all` every family), kept only where the quality gate
passes. BC is never gated: a BC7 chain is encoded once with the encoder's basic search, every mode tried
(`blocks.rs:bc7_settings`), and kept, its figures in the report. A block whose read-back flips a texel
across an alpha cutoff is encoded again (`blocks/quality/alike.rs:sided`).

A level file opens on a head of one little-endian `u32` per tile record (where its compressed bytes end,
counted from the head's end), then each record (the tile's blocks and gutter) raw DEFLATE alone: one
Range reads the head, one a tile, and the browser inflates it (`DecompressionStream`). The runtime takes
the first family the device's features allow (`browser/materials/texture/blockFormats.ts:chooseBlockFormat`);
a device with none reads the BC files and decodes them to RGBA8
(`browser/materials/texture/blockDecode.ts`).

The tails' RGBA8 texels are a file of their own beside the head page, `preview-pixels-<sha256>.bin`: the
bytes of the sidecar's pixel column, entry after entry, each entry's offset word counted in it; the
head's sidecar keeps that column empty (`binary.texturePreviewBytes` 0) and names the file in
`binary.texturePreviewPixels` (`url`, `bytes`, `sha256`), listed in `files`
(`rust/compiler/pages/manifest.rs`), since `MANIFEST_BINARY_VERSION` 22. A session reads it only when one
of its lanes pins tails made from those texels: the lossless lane, no block family, a channel pool of R8,
R16 or R32 texels, half-floats held in 32 bits or without BC6H blocks
(`browser/materials/texture/poolTail.ts:tailReadsLevels`, `textureCaches.ts:ensureLevels`). A device
sampling BC never downloads it (sponza: 1 485 476 of the head sidecar's 1 867 504 bytes). The reader
still takes version 21, whose sidecar holds the column inline.

Mip levels: the mean of the four texels of each channel (`rust/texture/reduce.rs`), the colours in linear
light for the colour atlas, alpha as it is; the levels a DDS stores are kept and the rest reduced from
the last. A 16-bit PNG is reduced from its 16-bit samples, in `f32`, each level rounded to 8 bits once
when it is written (`reduce.rs:chain_wide`), and counted (`image-depth-reduced`). The engine builds the
mips of a host texture the same way, the mean of the four texels of every channel
(`browser/materials/texture/mipsWgsl.ts`).

**Floating-point files.** A texture whose file stores floating point (OpenEXR, Radiance HDR) read as a
base colour or an emissive map is chained in `f32` and held in half-float RGBA, the atlas of word 2
(`hdr`, `rust/texture/hdr.rs`): the previews' pixel file holds its tail at eight bytes a texel, no block
family holds it (all three layout words are `lossless`), and the levels above the tail are
`hdr-<level>.rgba16f` files, tile records of half-float texels cut as the block files are
(`levels.rs:tile_records`, `HALF_CELL`). A value past the half-float range holds at its largest finite
value; a NaN reads as zero; no gate or codec touches it. The runtime holds it in the colour atlas's third
pool, `rgba16float`, where the data atlas holds its two-channel one
(`browser/materials/texture/blockFormats.ts:atlasLanes`): the sampled textures a stage binds stay within
the sixteen WebGPU guarantees. A floating image read only as a metal-roughness, normal, occlusion or
height map is not baked (`image-float-data-unsupported`).

**Naming the storage.** A texture can name how it is stored: `extras.compression` of its glTF texture,
one of `default`, `masks`, `normalmap`, `bc7`, `alpha`, `grayscale`, `displacementmap`,
`vectorDisplacementmap`, `hdr`, `hdrF32`, `halfFloat`, `singleFloat` or `hdrCompressed`
(`rust/texture/setting.rs`; a name outside the list is cooked as `default` and reported,
`texture-compression-unknown`).

- `default` and `masks` are the gated BC7 (BC5 for a normal map) above; `normalmap` and `bc7` fix the
  layout whatever reads the texture.
- `alpha` writes one channel in BC4, eight bytes a block (layout word 4, level files `bc4`, no gate).
- `grayscale` writes the red channel in eight-bit texels (layout word 5, level files `g8`), and
  `displacementmap` the alpha channel (layout word 6, level files `a8`): sixteen-byte "blocks" holding a
  4 × 4 square row by row, kept to the bit, no codec; their sidecar tails hold the RGBA8 texels the
  engine reads (the channel in RGB and opaque, or in all four).
- `vectorDisplacementmap` writes no block: the tail in RGBA8 and the source image.
- `hdr` is the half-float atlas above (a byte image is read as linear values; values hold at the
  half-float range).
- `hdrF32` keeps the four channels as 32-bit floats (layout word 7, level files `rgba32f`),
  `singleFloat` the red channel as 32-bit floats of the data atlas (word 8, `r32f`) and `halfFloat` as
  half-floats (word 9, `r16f`): files and sidecar tails of 4 × 4 squares of exact texels, row by row
  (`rust/texture/blocks/texels.rs`), the sidecar's own texels a half-float or grey copy; a one-channel
  float on a colour map is cooked as `hdr`.
- `hdrCompressed` writes a half-float chain in BC6H, unsigned RGB, sixteen-byte blocks (layout word 3 of
  the stored family, level files `bc6h` in place of `rgba16f`; its sidecar entry keeps the half-float
  pixel tail as well). A floating-point setting on a map the data atlas reads is cooked as `default`
  (`texture-compression-float-data-unsupported`).

The runtime holds the half-float lane's pool in `rgba32float` where a chain is kept so and the device has
`float32-filterable` (the engine requests it among its optional features), else in `rgba16float`, the
32-bit values cut to the half range, said once (`material-textures-float32-unfiltered`); the data atlas's
channel pool holds the float maps in `r32float` or `r16float` likewise, beside no normal map. No pool is
added: a scene picks the format of the pools it has, so the sampled textures of a stage stay as counted
below. The runtime samples BC6H blocks where the device has `texture-compression-bc` and every half-float
chain is BC6H, else decodes them to half-float texels.

The data atlas binds a fourth pool for the one-channel layouts (words 4, 5 and 6;
`browser/materials/texture/blockFormats.ts:atlasLanes`): BC4 blocks, `bc4-r-unorm`, half a byte a texel,
where the device has `texture-compression-bc` and every chain of the lane is BC4; else `r8unorm`, one
byte a texel, the BC4 blocks decoded (`blockDecodeMore.ts`) and the eight-bit blocks unpacked. The shader
reads it by the texture's tap: BC4 in R alone, `grayscale` in RGB and opaque, `displacementmap` in all
four. A colour map with one of these settings is read from the lossless pool, decoded to RGBA8 (a colour
needs the sRGB curve, which no one-channel format has). The sampled textures a stage binds count three
for the colour atlas and four for the data atlas, at most 13 in the fragment stage of the transparents,
under the sixteen WebGPU guarantees. The layout words 3 to 6 are new chains under names of their own: no
existing byte moves, the version stays.

```json
{ "textures": [{ "source": 0, "extras": { "compression": "grayscale" } }] }
```

- Version: `TEXTURE_PREVIEW_VERSION` 12 (`rust/texture.rs`, `core/contracts/writtenFormats.ts`).
- Writes `rust/texture/bake/write.rs:write_levels`, `rust/texture/levels.rs:tile_records`,
  `rust/manifest_binary/preview.rs:encode_previews`; gate `rust/texture/blocks/quality.rs`; the
  half-float cook `rust/texture/bake/half.rs:cook`.
- Reads `core/manifest/binaryPreview.ts:decodeTexturePreviews`,
  `browser/materials/texture/levelReader.ts:createTextureLevelReader`,
  `browser/materials/texture/tileRecords.ts:tileRecord`.
