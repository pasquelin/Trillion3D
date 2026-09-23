# Golden fixture — PSD and PSB driver (flattened composite)

Twelve tiny files and a scene. Five carry the same composite written five ways, six
are there to be refused — each by name —, and the scene takes one of them through to the binary
sidecar via the whole compiler.

The import policy admits from PSD only the **flattened composite**: the image the file already
carries at the end of the file, never recomposed layers. Recomposing would mean redoing the editor's
blend modes, masks and effects, and therefore producing an image the source does
not contain.

## What the driver reads

| file                 | what it carries                              | what it puts under watch                                                                                                               |
| -------------------- | -------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `rgb-brut.psd`       | 4 × 2, 8-bit RGB, compression 0              | the three planes as-is, one whole channel after another                                                                                |
| `rgb-rle.psd`        | 4 × 2, 8-bit RGB, compression 1              | PackBits: same pixels as `rgb-brut.psd`, a run and a raw packet in the same scanline                                                   |
| `rgba-rle.psd`       | 4 × 2, RGB + one extra plane, compression 1  | nothing declares transparency: the fourth plane is a saved alpha channel, read, written nowhere and counted `psd-alpha-channel-ignored` |
| `gris-brut.psd`      | 4 × 2, 8-bit grayscale, compression 0        | the single colour channel carries the three components, with no profile and no matrix                                                  |
| `gris-alpha-rle.psd` | 4 × 2, grey + one extra plane, compression 1 | the same case in a mode with a single colour channel                                                                                   |
| `grand-format.psb`   | 4 × 2, 8-bit RGB, PSB, compression 1         | version 2 of the format: layer-section length on eight bytes, per-scanline byte count on four                                          |

The five 4 × 2 files carry the same composite — three identical pixels, one isolated pixel, then
a vivid colour and a grey run. That is the proof that compression, colour mode and format
version do not change a byte of the result. `src/plugins/tests/psd.rs` compares the
pixels **one by one** against a reference written in the clear in the test.

## The extra plane: transparency or selection

None of the twelve fixtures carries a layer section: their fourth plane is therefore **not**
declared as the document's transparency. It is a saved alpha channel — a selection — that
the driver reads in order to advance by one plane and writes nowhere, counting it under
`psd-alpha-channel-ignored`. The golden now says this out loud: it previously asserted that
the plane after the colour channels **was** the composite's alpha, which punched a hole in a texture
whose document carried only a selection.

The document's colour profile — its image resource 1039 — is built the same way:
`src/plugins/tests/icc.rs` replaces the empty resource section of `rgb-brut.psd` with a section
that carries that resource, once with a profile that names itself sRGB, once with another. The
first counts nothing, the second counts `image-icc-profile-ignored`: this batch converts no
colour, it says what it does not convert.

The true-transparency case, and the layer case, are built in the test: it takes
`rgba-rle.psd` and `rgb-rle.psd` and replaces their empty layer section with a section that carries
a layer count, the sixteen-bit signed integer by which Adobe's specification declares, by
its sign, that the composite's first alpha plane is the document's transparency. The driver
reads only that field and skips the rest of the section by its length: these cases therefore do not claim
to write a whole layer record, they fault exactly the field that decides.

## What the driver refuses, and under which name

| file                 | rejection                     | why                                                                                                  |
| -------------------- | ----------------------------- | ---------------------------------------------------------------------------------------------------- |
| `seize-bits.psd`     | `psd-depth-unsupported`       | sixteen bits per channel: bringing them down to eight would be a loss the source did not have        |
| `cmjn.psd`           | `psd-color-mode-unsupported`  | CMYK mode: converting it would require a profile the driver would choose in place of the source      |
| `canaux-en-trop.psd` | `psd-channels-unsupported`    | two planes more than the colour channels: nothing in the header says which one is a transparency     |
| `zip.psd`            | `psd-compression-unsupported` | composite compressed by ZIP, outside the raw and PackBits subset                                     |
| `sans-composite.psd` | `psd-composite-missing`       | the file stops after the layer section: no flattened image to read, and it is not recomposed         |
| `tronque.psd`        | `psd-data-truncated`          | 7 of the 24 pixel bytes: never a half plane                                                          |

The test adds a case that needs no file: `rgb-brut.psd` whose width is set to
zero, refused as `psd-header-invalid`, and a signature whose version number is unknown, which the
driver does not claim at all.

## The scene

`scene.gltf` and `scene.bin` are the quad from `../../tests/fixtures/formats/hdr/`, its base colour replaced by
`rgb-brut.psd`. `src/tests/textures/psd_golden.rs` compiles it through the shared harness and compares every byte
of its progressive previews against `expected.json`: an eight-bit-per-channel composite enters there like
any other RGBA8 source, with no rejection in the report. Regeneration of the expected is described in
the header of that test.

## Provenance and licence

- The twelve files are **written here**, byte by byte, from the specification Adobe publishes
  for third-party readers — “Adobe Photoshop File Formats Specification” —: twenty-six-byte
  header, three length-prefixed sections, composite-data section, and PackBits
  run-length compression. The encoder that produced them shares no line with the driver's decoder.
  No editor file, no SDK, no document under a restrictive licence was copied.
  Author: WebGeometry corpus, 2026-09-15. Licence: CC0-1.0, text in `LICENSE.txt`.
- `scene.gltf` and `scene.bin` take the geometry of the `../../tests/fixtures/formats/hdr/` golden, from the same corpus and
  under the same licence.
- The off-repository corpus `test/assets/textures/legacy-web-matrix/flattened.psd` (256 × 256, 8-bit RGB
  with a raw surface) was used to check the driver on a real file: its decoded composite is
  identical, pixel by pixel, to the `rgb24.bmp` placed beside it, which carries the same image.
