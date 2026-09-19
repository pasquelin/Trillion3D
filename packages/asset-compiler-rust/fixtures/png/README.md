# Golden fixture — PNG driver

Six tiny files, two hundred bytes at most each. Three carry **the same 2 × 2 pixel
drawing** written at three bit depths, the fourth carries an animation, and the last two
carry a colour profile. The golden
`src/plugins/tests/png.rs` feeds them to the image registry and compares the result against a reference
written in the clear in the test.

| file            | colour type     | depth                   | what it puts under watch                                                              |
| --------------- | --------------- | ----------------------- | ------------------------------------------------------------------------------------- |
| `rgb8.png`      | 2 (RGB)         | 8 bits per channel      | the common case: decoded, alpha filled to 255, pixels unchanged                       |
| `palette4.png`  | 3 (palette)     | 4 bits, 24-bit palette  | under eight bits the expansion to RGBA8 copies, it loses nothing                      |
| `rgb16.png`     | 2 (RGB)         | 16 bits per channel     | refused under `image-depth-unsupported`, before any decoding                          |
| `anime.png`     | 2 (RGB)         | 8 bits, two frames      | APNG: the default image comes out, the animation is counted under `image-animation-first-frame` |
| `icc-autre.png` | 2 (RGB)         | 8 bits, `iCCP` chunk    | a profile that is not the output's: counted under `image-icc-profile-ignored`         |
| `icc-srgb.png`  | 2 (RGB)         | 8 bits, `iCCP` chunk    | a profile that names itself sRGB: nothing to convert, nothing to count                |

The drawing is the same everywhere: red, green on the top row, blue, yellow on the bottom. The two
readable fixtures must therefore yield exactly the same four pixels — that is the proof that bit depth
is a way of writing the image, never of changing it.

`rgb16.png` carries, in the low-order byte of each of its twelve components, a non-zero and distinct
value (`0x11`, `0x22`, … `0xCC`), while its high-order bytes repeat the reference. That is deliberate:
a `to_rgba8()` on this source would yield the reference without a murmur, and the twelve precision
bytes would vanish without a word. The golden checks that it never comes to that — the driver reads
the depth from the IHDR and refuses before decoding.

The transfer curve is read from the chunks, under a fixed priority: `iCCP`, then `sRGB`, then `gAMA` — a
gamma of 45455 is that of the sRGB curve, a gamma of 100000 means linear samples, and any other
is counted under `image-transfer-unsupported`. The golden places these chunks itself on `rgb8.png`, in memory:
they do not change a pixel, and one fixture per gamma would teach nothing more.

`anime.png` carries the `acTL`, `fcTL`, `IDAT`, `fcTL`, `fdAT` chunks: two frames, the first
a pure red written in `IDAT` — the default image of the APNG specification —, the second a
pure green written in `fdAT`. The contract returns only one image: the golden fixes that it is
the first, and that because the file declared an animation, the driver counts it instead of letting the
second frame vanish without a word.

The two profile files take `rgb8.png` and insert an `iCCP` chunk after its IHDR. Their
profile is a minimal ICC v2 — a one-hundred-and-twenty-eight-byte header, a single `desc` tag —
written here; only its name, which the PNG specification requires to be written in the clear in front of the
compressed profile, enters the driver's decision. They carry the same drawing as `rgb8.png`: a profile
changes no pixel here, since this batch converts no colour.

## Provenance and licence

The six files are **written here**, chunk by chunk (IHDR, PLTE, IDAT, IEND, `acTL`, `fcTL`,
`fdAT`, `iCCP`, lengths and CRC-32 included), from the public specifications “Portable Network
Graphics (PNG) Specification (Second Edition)”, W3C / ISO-IEC 15948:2004, “APNG Specification”
(W3C, `acTL`, `fcTL`, `fdAT` chunks) and “ICC.1:2001-04” for the profile shape. No editor
tool, no SDK, no reused image. Author: WebGeometry corpus, 2026-09-15; `anime.png`,
`icc-autre.png` and `icc-srgb.png` added on 2026-09-16. Licence: **CC0-1.0**
(<https://creativecommons.org/publicdomain/zero/1.0/>), redistributable without condition.

Their pixels were re-read by an independent decoder (Pillow 12.2.0) before being committed: the
three yield the same image, and `rgb16.png` is there quietly narrowed to the
8-bit reference — the symptom this driver now refuses. The same decoder reads in
`anime.png` two frames, red then green, and finds in both profile files an ICC profile
of two hundred and fifty bytes: that is the proof that these files carry what the driver
counts.

The five 256 × 256 PNGs of `test/assets/textures/png-matrix/` (grey, palette, 8-bit RGB, 8-bit RGBA
with binary alpha, 16-bit RGB, CC0-1.0) cover the same matrix at large size; the driver was
run over them during development, read in place, never modified. Only one file changes
behaviour, the one the decision targeted; the other four yield what their colour type
announces:

| file               | colour type     | depth      | verdict                           |
| ------------------ | --------------- | ---------- | --------------------------------- |
| `rgb8.png`         | 2 (RGB)         | 8 bits     | decoded                           |
| `rgba8-binary.png` | 6 (RGBA)        | 8 bits     | decoded, alpha kept               |
| `palette.png`      | 3 (palette)     | 8 bits     | decoded                           |
| `gray.png`         | 0 (grey)        | 8 bits     | decoded                           |
| `rgb16.png`        | 2 (RGB)         | 16 bits    | refused, `image-depth-unsupported` |

They are not committed here: one hundred and forty kilobytes for pixels that cannot be written
in the clear do not make a minimal fixture, and the `test/assets/` folder is shipped off git.
