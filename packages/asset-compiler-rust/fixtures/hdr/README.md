# Golden fixture — Radiance HDR (RGBE) driver

Seven tiny files and a scene. Four carry the same image written four ways; three
are there to be refused, each by name.

| file                      | what it carries                        | what it puts under watch                                                              |
| ------------------------- | -------------------------------------- | ------------------------------------------------------------------------------------- |
| `plat.hdr`                | 4 × 2, raw scanlines                   | four bytes per pixel, with no marker at all                                           |
| `rle-ancienne.hdr`        | 4 × 2, `1,1,1,n` markers               | the “Real Pixels” compression: same pixels as `plat.hdr`                              |
| `signature-rgbe.hdr`      | 4 × 2, `#?RGBE` signature              | the format's second signature, which old files carry                                  |
| `rle-nouvelle.hdr`        | 8 × 1, `2, 2, width` header            | per-component compression, its runs **and** its raw packets in the same scanline      |
| `xyze.hdr`                | `FORMAT=32-bit_rle_xyze`               | another colour space: rejection `hdr-format-unsupported`                              |
| `bas-en-haut.hdr`         | resolution `+Y 2 +X 4`                 | an orientation that would have to be flipped: rejection `hdr-orientation-unsupported` |
| `tronque.hdr`             | 7 of the 32 pixel bytes                | rejection `hdr-data-truncated`, never a half scanline                                 |
| `scene.gltf`, `scene.bin` | a quad whose base colour is `plat.hdr` | the full path through to the preview report, where the float texture is named         |

`src/plugins/tests/hdr.rs` compares the values **one by one** against a reference written in the clear in
the test. The four RGBE quadruplets used have exponents readable by eye — `2^-8`, `2^-7`,
`2^0`, `2^4` — and mantissas that land exactly: every expected value is exact in
single precision, so a mismatch can only come from the driver.

The three 4 × 2 files carry the same image: that is the proof that compression and signature
do not change a bit of the result. The 8 × 1 fixture carries another, because the new
compression is only written from eight pixels of width — its scanline mixes a run of four
identical pixels and isolated values, so both kinds of packet are exercised.

## `expected.json`

The image contract this binary publishes, the progressive-preview report — a `skipped` that
names `image-float-unsupported`, and no preview — and the scene: format version, binary sidecar
version, sha256 of `clusters.bin`, primitives and triangles. `case` and `rule` are
prose only, the test strips them before comparing.

## Provenance and licence

- The seven HDRs are **written here**, byte by byte, from the public specification of the format:
  Greg Ward's “Real Pixels” (Graphics Gems II, 1991) for the RGBE encoding and its two
  compressions, and the Radiance manual (Lawrence Berkeley National Laboratory) for the header and the
  resolution line. The encoder that produced them shares no line with the driver's decoder.
  No editor tool, no SDK. Author: WebGeometry corpus, 2026-09-15. Licence:
  **CC0-1.0** (<https://creativecommons.org/publicdomain/zero/1.0/>).
- The `scene.gltf` scene and its binary are written here the same way, **CC0-1.0**.

The `test/assets/textures/hdr-matrix/environment.hdr` (512 × 256, CC0-1.0, produced by a third-party
encoder and re-read by FFmpeg at the time it entered the corpus) covers the case of a file written
elsewhere, with the new compression on a real width. The driver was run over it during
development; it is not committed here — half a megabyte of pixels that cannot be written
in the clear does not make a minimal fixture. It decodes as 512 × 256, with RGB values between
0 and 8 exactly — the same linear 0..8 ramp that the corpus manifest announces and that
FFmpeg had re-read — and an opaque alpha everywhere.

## Provenance of the reader

Reader written here, in `src/plugins/image/hdr.rs` and `src/plugins/image/hdr/scanlines.rs`, from
the same public sources. No third-party library: the `image` crate recognises only the
`#?RADIANCE` signature and does not let what it refuses be named, two things the driver
needs.
