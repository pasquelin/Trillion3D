# Golden fixture — BMP driver

Eight tiny files, one per writing of the format that the `bmp` driver must read **losslessly**,
plus three that it must refuse by name. The golden `src/plugins/tests/bmp.rs` decodes them and
compares the RGBA8 pixels **one by one** against a reference written in the clear in the test: a
4 × 2 pixel image whose eight values are known. The golden `src/tests/bmp_gif_golden.rs` takes one
of them through the whole compiler and pins the bytes of its previews in `expected.json`.

## What the driver reads

| file                          | header | depth                   | row order | what it puts under watch                               |
| ----------------------------- | ------ | ----------------------- | --------- | ------------------------------------------------------ |
| `vraies-couleurs-24-bas.bmp`  | Info   | 24-bit `BI_RGB`         | bottom-up | BGR → RGB, rows restored to order, alpha filled to 255 |
| `vraies-couleurs-32-haut.bmp` | V3     | 32-bit `BI_BITFIELDS`   | top-down  | V3 header alpha mask, straight alpha kept (128 and 0)  |
| `palette-8.bmp`               | Info   | 8 bits, 8-entry palette | bottom-up | indices resolved to the same colours                   |
| `palette-8-rle.bmp`           | Info   | 8-bit `BI_RLE8`         | bottom-up | absolute mode, end of line and end of bitmap           |
| `palette-4.bmp`               | Info   | 4 bits, 8-entry palette | bottom-up | two indices per byte, row padded to four bytes         |
| `palette-1.bmp`               | Info   | 1 bit, 2-entry palette  | bottom-up | one index per bit; its reference is a checkerboard     |
| `r5g5b5.bmp`                  | Info   | 16-bit `BI_RGB`         | bottom-up | the default 5-5-5 masks, with no mask field            |
| `r5g6b5.bmp`                  | Info   | 16-bit `BI_BITFIELDS`   | bottom-up | 5-6-5 masks read after the header, six bits on green   |

The eight carry the same image — except `palette-1.bmp`, which a single bit reduces to two colours, and
`vraies-couleurs-32-haut.bmp`, the only one that carries an alpha. The golden checks this explicitly: neither
depth, nor palette, nor compression, nor row order changes a byte of the
result.

### Why 16-bit enters losslessly

The decoder takes an `n`-bit channel to eight by `round(v × 255 / (2^n − 1))`: a proportional
scale rounded to nearest, and **not** a bit copy. It still works, and for a reason that does not
depend on the formula: the table is strictly increasing, hence injective, hence invertible. The 32
values of a 5-bit channel land on 32 distinct 8-bit values, and the return path yields the original
value — no information from the source is lost.

That is also why the eight components of the reference equal 0, 8, 16, 49, 66, 132, 206, 239,
247 or 255: they are values that both the 5-bit **and** the 6-bit tables hit exactly, so
both 16-bit writings yield those bytes and not their neighbours.

## What the driver refuses, and under which name

| file                  | rejection                        | why                                                                                         |
| --------------------- | -------------------------------- | ------------------------------------------------------------------------------------------- |
| `masques-10-bits.bmp` | `bmp-bitfields-lossy`            | 32-bit with 10-10-10 masks: the decoder would keep only the eight high bits of each channel |
| `jpeg-embarque.bmp`   | `bmp-embedded-codec-unsupported` | `BI_JPEG`: the file does not wrap pixels but a whole format, which has its own driver       |
| `tronque.bmp`         | `image-decode-failed`            | 31 bytes out of 196,662: header recognised, pixel read refused                              |

The golden adds two rejections that no file carries, obtained by rewriting two fields of a readable
header: a 64-bit depth (`bmp-depth-unsupported`) and the
`BI_ALPHABITFIELDS` compression (`bmp-compression-unsupported`).

## Provenance and licences

- The ten files that are readable or refused for their header are **written here**, byte by byte, from
  the public `BITMAPFILEHEADER`, `BITMAPINFOHEADER` and `BITMAPV3HEADER` structures documented
  by Microsoft (“Bitmap Header Types”). No editor tool, no SDK. Author: WebGeometry corpus,
  2026-09-15. Licence: **CC0-1.0**, see [LICENSE.txt](LICENSE.txt).
- Their pixels were checked by an independent decoder (Pillow 12.2.0) before being committed:
  an error in both the writer and the decoder would not pass the double read. The two
  16-bit files were checked another way, and that must be said: Pillow expands an `n`-bit
  channel by `(v × 255) ÷ (2^n − 1)` **truncated**, where the `image` crate rounds. So it is the
  _stored indices_ that were compared against Pillow's convention, not the rendered bytes — both
  conventions being injective, neither loses information, but they do not give the
  same values to the last bit.
- `tronque.bmp` is taken as-is from `test/assets/limites/truncated-bmp/truncated.bmp`, also
  **CC0-1.0** (WebGeometry corpus). The `test/assets/` folder is shipped off git: the file is
  copied here so the golden does not depend on it.
- `scene.gltf` and `scene.bin` — the quad of the full-path golden — are the quad from
  `fixtures/hdr/`, same corpus and same licence, with only its image changed.

The 256 × 256 24-bit truecolour BMP of `test/assets/textures/legacy-web-matrix/rgb24.bmp`
(CC0-1.0) covers the same read at large size. The driver was run over it during
development — it yields 256 × 256; it is not committed here, a quarter of a megabyte for
pixels that cannot be written in the clear not being a minimal fixture.
