# Golden fixture — KTX 2.0 driver

The golden works on two materials: the five files in this folder, and the tiny containers
that `src/plugins/tests/ktx2/bytes.rs` writes field by field from the Khronos specification.

## 1. The five files

| file             | what it carries                                                       | what it proves                                                                                                            |
| ---------------- | --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `base.ktx2`      | 4 × 4, `VK_FORMAT_R8G8B8A8_SRGB`, `supercompressionScheme` 0          | an uncompressed level comes out byte for byte; its sixteen texels are written in the clear in `src/plugins/tests/ktx2.rs` |
| `base-zstd.ktx2` | the same level under `KTX_SS_ZSTD`                                    | supercompression is only a wrapper: undone, it yields exactly the same texels                                             |
| `uastc.ktx2`     | 16 × 16, `VK_FORMAT_UNDEFINED`, UASTC LDR 4 × 4 payload               | the Basis Universal path without supercompression, sixteen blocks of sixteen bytes                                        |
| `basis.ktx2`     | 256 × 256, `VK_FORMAT_UNDEFINED`, ETC1S payload under `KTX_SS_BASIS_LZ` | the supercompressed Basis Universal path, codebooks included, as a third-party encoder writes it                        |
| `tronque.ktx2`   | forty bytes of `basis.ktx2`                                           | the identifier is there, the header is not, and the rejection is named                                                    |

## 2. The test containers

They cover the `vkFormat` values the codec table names, one block per case, with the codec
specification's reference values rather than the decoder's. Since the “image
fidelity” batch, the two unsigned EAC formats have their own case there: a hand-written block whose
three eleven-bit values — 4, 5 and 13 — become the bytes 0, 1 and 2 by rounding to nearest,
where the external decoder's truncation yielded 0, 0 and 1 and where its reversed read of the
index field displaced the texels. The block therefore states both the rounding and the place of the texels.

They also cover what a container **declares** around its texels: the transfer function of
its format descriptor — the same payload declared linear then sRGB —, the premultiplied-alpha
flag of the same descriptor, and the `KTXorientation` and `KTXswizzle` keys. The driver applies
what applies (un-premultiplication, vertical flip for `ru`) and counts the rest under
`ktx2-orientation-unsupported` or `ktx2-swizzle-unsupported`. The four files in the folder
all declare an sRGB `transferFunction` and no flag: their texels do not move.

`scene.gltf`, `scene.bin` and `expected.json` are the compiled golden: three quads, one opaque
material and one texture per file of the first half of the table, taken through the whole compiler.
Their regeneration is described in the header of `src/tests/ktx2_golden.rs`.

## Provenance and licence

This whole folder is under **CC0-1.0** (<https://creativecommons.org/publicdomain/zero/1.0/>), see
[LICENSE.txt](LICENSE.txt).

- `basis.ktx2` is copied as-is from `test/assets/textures/ktx2-matrix/basis.ktx2`, WebGeometry
  corpus, written by `ktx create v4.4.2 / libktx v4.4.2` on 15 September 2026. The
  `test/assets/` folder is shipped off git: the file is copied here so the golden does not depend on it.
- `uastc.ktx2` is **cut** from `test/assets/textures/ktx2-matrix/uastc.ktx2` of the same corpus:
  UASTC blocks are sixteen bytes, independent of each other and laid out by rows, so
  the first four blocks of the first four rows are exactly the top-left 16 × 16 texel
  corner of the source, with no re-encoding at all. The header takes the source's with
  `pixelWidth` and `pixelHeight` at 16, no keys, the format descriptor copied at byte 104 and the
  level at byte 160 — the multiple of sixteen the specification requires for a sixteen-byte block.
- `base.ktx2` and `base-zstd.ktx2` are written from the specification: an eighty-byte
  header, a one-level index, an R8G8B8A8 sRGB format descriptor taken from the corpus, then the level at
  byte 196. Their sixteen texels equal `[x·85, y·85, (x+y)·42, 255 − (x+y)·17]`. The level of
  `base-zstd.ktx2` is the same byte sequence passed through a reference Zstandard encoder.

## Provenance of the reader

- Header, section index and level index: written from Khronos “KTX File Format Specification,
  version 2.0”. No editor SDK.
- Basis Universal payloads: crate `basisu` 0.1.0, Apache-2.0, `marcogomez/basisu`, pure Rust, a port
  of Binomial's reference transcoder verified byte for byte against it.
- Blocks already compressed for the GPU: crate `texture2ddecoder` 0.1.2, MIT or Apache-2.0, through the
  `image::blocks` foundation shared with the `dds` driver.
- Zstandard supercompression: crate `ruzstd` 0.7.3, MIT, pure Rust, decompression only.

## What the golden pins, and what it does not

The texels are written in the clear for the uncompressed case, for three-colour BC1 — the only case where the
alpha bit separates `BC1_RGB` from `BC1_RGBA` — and for a 4 × 4 ASTC “void extent” block, whose
colour is written in the clear in the block. For the other codecs named by `vkFormat`, the golden pins
the routing and the block geometry, proved by the missing byte: BCn block integer interpolation is
already pinned block by block by the `dds` driver golden, which goes through the same foundation and
the same decoder, and that of ETC2, EAC and ASTC belongs to `texture2ddecoder`.
