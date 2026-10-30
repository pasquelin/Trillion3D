# Textures

Every atlas texture's mip chain: the tail in the head's column file, one block file per level above
it. BC is the stored family: level files `bc7` (RGBA) or `bc5` (normal map's two channels); ASTC and
ETC2/EAC (`etc2`, `eac-rg`) are written beside it on demand (`--textures-format`, default `bc7`; a
family name cooks BC and it, `all` every family), kept only where the quality gate passes. BC is never
gated: a BC7 chain is encoded once, every mode tried (`blocks.rs:bc7_settings`), figures in the report.
A block whose read-back flips a texel across an alpha cutoff is encoded again
(`blocks/quality/alike.rs:sided`).

A level file opens on a head of one little-endian `u32` per tile record (where its compressed bytes
end, counted from the head's end), then each record (tile's blocks and gutter) raw DEFLATE alone;
one Range reads the head, one a tile (`DecompressionStream`). The runtime takes the first family the
device allows (`browser/materials/texture/blockFormats.ts:chooseBlockFormat`); a device with none reads
the BC files and decodes to RGBA8 (`browser/materials/texture/blockDecode.ts`).

The tails' RGBA8 texels are a file beside the head page, `preview-pixels-<sha256>.bin`: the sidecar's
pixel column bytes, entry after entry, offset words counted in it. The head's sidecar keeps that
column empty (`binary.texturePreviewBytes` 0) and names the file in `binary.texturePreviewPixels`
(`url`, `bytes`, `sha256`), listed in `files` (`rust/compiler/pages/manifest.rs`), since
`MANIFEST_BINARY_VERSION` 22 (21, inline column, is still read). A session reads it only when a lane
pins tails made from those texels: the lossless lane, no block family, a channel pool of R8, R16 or
R32 texels, half-floats held in 32 bits or without BC6H blocks
(`browser/materials/texture/poolTail.ts:tailReadsLevels`, `textureCaches.ts:ensureLevels`).

Mip levels: mean of four texels per channel (`rust/texture/reduce.rs`), colours in linear light for
the colour atlas, alpha as is; DDS-stored levels are kept, the rest reduced from the last. A 16-bit
PNG is reduced in `f32`, each level rounded to 8 bits once (`reduce.rs:chain_wide`), counted
(`image-depth-reduced`). The engine builds a host texture's mips alike
(`browser/materials/texture/mipsWgsl.ts`).

**Floating-point files.** OpenEXR or Radiance HDR read as base colour or emissive map is chained in
`f32` and held in half-float RGBA, the atlas of word 2 (`hdr`, `rust/texture/hdr.rs`): the pixel file
holds its tail at eight bytes a texel, no block family holds it (all three layout words `lossless`),
levels above the tail are `hdr-<level>.rgba16f` files of half-float tile records
(`levels.rs:tile_records`, `HALF_CELL`). A value past the half-float range holds at its largest finite
value; NaN reads as zero; no gate or codec. The runtime holds it in the colour atlas's third pool,
`rgba16float`, where the data atlas holds its two-channel one
(`browser/materials/texture/blockFormats.ts:atlasLanes`). A floating image read only as
metal-roughness, normal, occlusion or height map is not baked (`image-float-data-unsupported`).

**Naming the storage.** `extras.compression` of a glTF texture: `default`, `masks`, `normalmap`,
`bc7`, `alpha`, `grayscale`, `displacementmap`, `vectorDisplacementmap`, `hdr`, `hdrF32`, `halfFloat`,
`singleFloat` or `hdrCompressed` (`rust/texture/setting.rs`; another name cooks as `default`, reported
`texture-compression-unknown`).

- `default`, `masks`: the gated BC7 (BC5 for a normal map); `normalmap`, `bc7` fix the layout whatever
  reads the texture.
- `alpha`: one channel in BC4, eight bytes a block (layout word 4, level files `bc4`, no gate).
- `grayscale`: red channel in eight-bit texels (layout word 5, `g8`); `displacementmap`: alpha channel
  (layout word 6, `a8`): sixteen-byte "blocks" of a 4 × 4 square row by row, kept to the bit, no codec;
  sidecar tails hold the RGBA8 texels the engine reads (channel in RGB and opaque, or in all four).
- `vectorDisplacementmap`: no block; tail in RGBA8 and the source image.
- `hdr`: the half-float atlas above (a byte image is read as linear values).
- `hdrF32`: four 32-bit float channels (layout word 7, `rgba32f`); `singleFloat`: red as 32-bit floats
  of the data atlas (word 8, `r32f`); `halfFloat`: as half-floats (word 9, `r16f`): 4 × 4 squares of
  exact texels, row by row (`rust/texture/blocks/texels.rs`); a one-channel float on a colour map
  cooks as `hdr`.
- `hdrCompressed`: half-float chain in BC6H, unsigned RGB, sixteen-byte blocks (layout word 3 of the
  stored family, `bc6h` in place of `rgba16f`; the sidecar entry keeps the half-float pixel tail too).
  A floating-point setting on a map the data atlas reads cooks as `default`
  (`texture-compression-float-data-unsupported`).

The half-float lane's pool is `rgba32float` where a chain is kept so and the device has
`float32-filterable`, else `rgba16float`, values cut to the half range, said once
(`material-textures-float32-unfiltered`); the data atlas's channel pool holds float maps in `r32float`
or `r16float` likewise, beside no normal map. BC6H blocks are sampled where the device has
`texture-compression-bc` and every half-float chain is BC6H, else decoded to half-float texels.

The data atlas binds a fourth pool for the one-channel layouts (words 4, 5, 6;
`blockFormats.ts:atlasLanes`): `bc4-r-unorm` where the device has `texture-compression-bc` and every
chain of the lane is BC4; else `r8unorm` (`blockDecodeMore.ts` decodes BC4, eight-bit blocks are
unpacked). The shader reads BC4 in R alone, `grayscale` in RGB and opaque, `displacementmap` in all
four. A colour map with one of these settings is read from the lossless pool, decoded to RGBA8. A
stage's sampled textures: three for the colour atlas, four for the data atlas, at most 13 in the
transparents' fragment stage (limit sixteen). Layout words 3 to 6 are new chains; the version stays.

```json
{ "textures": [{ "source": 0, "extras": { "compression": "grayscale" } }] }
```

- Version: `TEXTURE_PREVIEW_VERSION` 12 (`rust/texture.rs`, `core/contracts/writtenFormats.ts`).
- Writes `rust/texture/bake/write.rs:write_levels`, `rust/texture/levels.rs:tile_records`,
  `rust/manifest_binary/preview.rs:encode_previews`; gate `rust/texture/blocks/quality.rs`; half-float
  cook `rust/texture/bake/half.rs:cook`.
- Reads `core/manifest/binaryPreview.ts:decodeTexturePreviews`,
  `browser/materials/texture/levelReader.ts:createTextureLevelReader`,
  `browser/materials/texture/tileRecords.ts:tileRecord`.
