# Golden fixture — GIF driver, a single image

The repository's fidelity policy admits here only a **still image**: a file that carries more than one
image descriptor is refused by name, never flattened onto a frame chosen by default. The
fixture follows that cut — three files the driver reads, two it must refuse. The golden
`src/plugins/tests/gif.rs` decodes the first set and compares the RGBA8 pixels **one by one** against a
reference written in the clear in the test: a 4 × 2 pixel image whose eight values are known.
The golden `src/tests/textures/bmp_gif_golden.rs` takes `palette-globale.gif` through the whole compiler and
pins the bytes of its previews in `expected.json`.

## What the driver reads

| file                  | colour table       | what it puts under watch                                                             |
| --------------------- | ------------------ | ------------------------------------------------------------------------------------ |
| `palette-globale.gif` | global, 8 entries  | the table colours rendered as-is — the format is indexed, nothing is rounded         |
| `palette-locale.gif`  | local, 8 entries   | a table carried by the image descriptor, with no global table in the file at all     |
| `transparence.gif`    | global, 8 entries  | the index declared transparent becomes a zero alpha, **and its colour stays that of the table** |

The three carry the same image; only `transparence.gif` changes the alpha, and only it. The golden
checks this explicitly: where the table comes from does not change a pixel, and transparency does not
touch the colour — nothing is erased, filled with white, or premultiplied.

## What the driver refuses, and under which name

| file          | rejection                     | why                                                                                                                                                                                                                                                      |
| ------------- | ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `anime.gif`   | `image-animation-unsupported` | two image descriptors: an animation is not a texture, and choosing one image by default would be arbitrary. That is the `webp` driver's reason, shared on purpose — an animation rejection is an animation rejection, whichever format carries it        |
| `tronque.gif` | `image-decode-failed`         | 31 bytes out of 17,976: the signature is recognised, the decode refused                                                                                                                                                                                  |

The golden adds three cases that need no extra file, taken from the previous two:
the `GIF87a` signature rewritten onto `palette-globale.gif` — the version without extensions, which the
block walk must traverse as well as 89a —, `anime.gif` cut at the end of its first
image, which is then **accepted** (a whole image without an end byte remains an image), and the same
cut four bytes further, where the second image separator is enough to prove the animation even if
its descriptor is truncated.

### What the ignored-image count is not

The driver does not publish how many images it left aside: it leaves none, since it
refuses the whole file. Naming that count would require a report channel **on the success side**,
which the `image-plugin-2` contract does not have — `ImageDecoder::decode` names a reason only in its
`Err`, and `texture_preview` counts only those. That is a contract job, not a driver job.

## Provenance and licences

- The four files that are readable or refused for their structure are **written here**, byte by byte,
  from the public specification “Graphics Interchange Format, Version 89a” (CompuServe, 1990):
  header, logical screen descriptor, colour tables, graphic control extension,
  image descriptors and LZW stream. No editor tool, no SDK. Author: WebGeometry corpus,
  2026-09-15. Licence: **CC0-1.0**, see [LICENSE.txt](LICENSE.txt).
- Their LZW stream is the simplest the specification admits: a clear code, the
  literals, an end code. No pattern is learned, but the decoder learns one per code read:
  the code width therefore grows by one bit each time its table reaches a power of two,
  and the writer follows that width. A stream written at a fixed width is unreadable from the eighth code.
- Their pixels were checked by an independent decoder (Pillow 12.2.0) before being committed,
  image count included: an error in both the writer and the decoder would not pass the
  double read.
- `tronque.gif` is taken as-is from `test/assets/limites/truncated-gif/truncated.gif`, also
  **CC0-1.0** (WebGeometry corpus). The `test/assets/` folder is shipped off git: the file is
  copied here so the golden does not depend on it.
- `scene.gltf` and `scene.bin` — the quad of the full-path golden — are the quad from
  `../../tests/fixtures/formats/hdr/`, same corpus and same licence, with only its image changed.

The 256 × 256 GIF of `test/assets/textures/legacy-web-matrix/palette.gif` (CC0-1.0) covers the same
read at large size; the driver yields 256 × 256. It carries the same reference image as the
`rgb24.bmp` of the same folder, but **quantised at the source** by its encoder: comparing it pixel to
pixel with the BMP would report that encoder's loss, not the driver's. It is not committed here.
