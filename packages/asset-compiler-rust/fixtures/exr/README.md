# Golden fixture — OpenEXR driver

Six tiny files and a scene. Two files carry the same image in the two precisions
of the subset; four are there to be refused, each by name.

| file                      | what it carries                                  | what it puts under watch                                                                                                                        |
| ------------------------- | ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `demi.exr`                | 2 × 2, `A`, `B`, `G`, `R` channels in half-float | read order, the four channels, an alpha that is neither 0 nor 1, and un-premultiplication                                                       |
| `flottant.exr`            | 2 × 2, `B`, `G`, `R` channels in single float    | the same RGB values as `demi.exr` — half extends without rounding — and the opaque alpha the specification requires when the channel is missing |
| `canaux-xyz.exr`          | 2 × 2, `X`, `Y`, `Z` channels                    | a channel set of another name: rejection `exr-channels-unsupported`                                                                             |
| `profond.exr`             | `demi.exr` with the deep-data flag               | the version field is enough: rejection `exr-deep-unsupported` before any other read                                                             |
| `multi-parties.exr`       | `demi.exr` with the multi-part flag              | rejection `exr-multipart-unsupported`: nothing says which part is the texture                                                                   |
| `tronque.exr`             | 40 of the 395 bytes of `demi.exr`                | the magic is there, the header is not: rejection `exr-header-invalid`                                                                           |
| `scene.gltf`, `scene.bin` | a quad whose base colour is `demi.exr`           | the full path through to the preview report, where the float texture is named                                                                   |

The two readable files carry the same RGB image, and `src/plugins/tests/exr.rs` compares their
values **one by one** against a reference written in the clear in the test. The chosen values — 0, ⅛,
¼, ½, ¾, 1, 1.5, 2, 3, 4, 8, 16 — are exact in half as in single precision: a mismatch can only
come from the driver, never from the encoding.

The test writes **two** references for `demi.exr`: `STOCKE`, what the file carries — samples
associated with their alpha, as the OpenEXR specification defines them —, and `DROIT`, what
the contract yields once each component is divided by the pixel's alpha. The two pixels whose
alpha is neither 0 nor 1 change, the one with a zero alpha does not: under a zero alpha there is no
straight colour to recover, and nothing is divided by zero. The quotients — 4, 8, 3, 6, 12 —
are exact in single precision.

The two flagged files differ from `demi.exr` only by the version field, the very field
the specification defines to announce deep or multiple parts. That is exactly what
the driver reads in order to refuse: four bytes, before opening the header. A real deep file
would additionally carry its `type` and `version` attributes and chunks of another shape — the rejection
would fall even earlier.

## `expected.json`

The image contract this binary publishes, the progressive-preview report — a `skipped` that
names `image-float-unsupported`, and no preview — and the scene: format version, binary sidecar
version, sha256 of `clusters.bin`, primitives and triangles. `case` and `rule` are
prose only, the test strips them before comparing.

## Provenance and licence

- The six EXRs are **written here**, byte by byte, from the public specifications of
  the Academy Software Foundation — “OpenEXR File Layout” and “Technical Introduction to OpenEXR”,
  <https://openexr.com/> — by an encoder that shares no line with the driver's decoder:
  no compression, one scanline per chunk, offset table computed. No editor tool,
  no SDK. Author: WebGeometry corpus, 2026-09-15. Licence: **CC0-1.0**
  (<https://creativecommons.org/publicdomain/zero/1.0/>), redistributable without condition.
- The `scene.gltf` scene and its binary are written here the same way, **CC0-1.0**.

The two 256 × 256 EXRs of `test/assets/textures/hdr-matrix/` (`float16.exr` and `float32.exr`,
CC0-1.0, produced by a third-party encoder and re-read by FFmpeg at the time they entered the corpus)
cover the case of a file written elsewhere. The driver was run over them during development;
they are not committed here — eight hundred thousand bytes of pixels that cannot be written in the clear do
not make a minimal fixture. Both decode, at 256 × 256 each, `R`, `G`, `B` channels without
alpha (the driver therefore yields an opaque alpha), with RGB values between 0 and 8 exactly —
the linear 0..8 ramp that the corpus manifest announces and that FFmpeg had re-read.

## Provenance of the reader

Crate `exr` 1.74.2 (BSD-3-Clause, `johannesvollmer/exrs`), pure Rust and without `unsafe`, version pinned
in `Cargo.toml`, notices kept with the dependency. The version field — deep and
multi-part flags — and the channel set are read by the driver itself, from the specification.
