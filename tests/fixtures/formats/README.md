# Format fixtures

The small source files the native compiler's tests read, one folder per input format or per
correction case: what each folder puts under watch and why, then its provenance and licence in the
[table](#provenance-and-licences). How a new format adds its fixture:
[`docs/COMPILER.md`, "Adding a format"](../../../docs/COMPILER.md#adding-a-format).

## Rules for every folder

- **Corpus.** `tests/assets/` is the local corpus, off git; a file taken from it is copied here
  unchanged, with its notice, so the golden holds without it.
- **Written here** means written byte by byte from the public specification named in the table, by
  an encoder that shares no line with the driver's decoder: no editor tool, no SDK, no third-party
  content.
- **Double read.** Where marked, pixels were checked by an independent decoder (Pillow 12.2.0)
  before commit: an error in both the writer and the decoder would not pass.
- **Traps** (files the driver must refuse) come from a tool other than the crate the driver reads
  with: a trap must come from somewhere other than the reader it puts on trial.
- **Image goldens** compare pixels one by one against a reference written in the clear in the test;
  for `bmp`, `gif`, `tga` and `tiff`, a 4 × 2 pixel image whose eight values are known.
- **`expected.json`:** `case` and `rule` are prose only, the test strips them. A converted scene's
  cache key never appears: its manifest carries the import duration and the key the fingerprint of
  the whole compiler implementation, so it moves between runs or with an unrelated change without
  the scene moving — a golden pins a scene, never a clock. The file itself lists what it pins.
- **Regenerating:** the regeneration test is ignored by default (it writes into
  `tests/fixtures/formats/`), and **its diff is re-read before commit** — a regenerated expected
  without a reading no longer watches anything.
- **Large corpus files** reading the same matrix at large size were run over during development and
  are [not committed](#corpus-files-not-committed): pixels that cannot be written in the clear do
  not make a minimal fixture.
- **Licences.** CC0-1.0 is <https://creativecommons.org/publicdomain/zero/1.0/>, redistributable
  without condition. A file written in this repository with no other stated licence falls under
  the repository's [`LICENSE`](../../../LICENSE) (PolyForm Noncommercial 1.0.0, © 2026 Alban
  Pasquelin). A package's contents keep their author's licence: a container driver grants none and
  withdraws none. Reader crates:
  [`THIRD_PARTY_NOTICES.md`](../../../THIRD_PARTY_NOTICES.md#image-and-texture-readers-of-the-native-compiler).

## Provenance and licences

"Corpus" is the Trillion3D corpus under `tests/assets/`, generated on 15 September 2026 unless
dated otherwise; "written here" as [above](#rules-for-every-folder). Sizes are the committed bytes.

| folder | files (bytes) | licence, notice | source | author, generator, date |
| --- | --- | --- | --- | --- |
| `alembic/procedural-static` | `scene.abc` (8,110 bytes, Ogawa, format version 256) | CC0-1.0, `LICENSE.txt` | corpus `tests/assets/alembic/procedural-static`, unchanged | `tests/assets/tools/model_formats_blender.py`, Blender 5.2.1 LTS through Alembic 1.8.3 |
| `alembic/limites` | `hdf5.abc`, `truncated.abc` (16 bytes each), `cases.abc` (3,110 bytes) | CC0-1.0, `LICENSE.txt` | written by hand for this repository from the public Alembic specification | Trillion3D, 2026-09-15 |
| `blend/procedural-materials` | `scene.blend` (92,065 bytes) | CC0-1.0, `LICENSE.txt` | corpus `tests/assets/blend/procedural-materials`, unchanged | procedural generation, Blender 5.2.1 LTS |
| `blend/limites` | `truncated.blend` (4,096 bytes) | CC0-1.0, `LICENSE.txt` | the first 4,096 bytes of the unwrapped `procedural-materials` scene | corpus |
| `blend/layouts` | `blender-3.3.blend`, `blender-4.4.blend`, `blender-5.2.blend` (about 90 KB each) | CC0-1.0, `LICENSE.txt` | [`layouts.py`](blend/layouts/layouts.py), written here | Blender 3.3.21, 4.4.3, 5.2.1 LTS; 2026-09-27 |
| `bmp` | ten readable or header-refused `.bmp` (58–104 bytes) | CC0-1.0, [LICENSE.txt](bmp/LICENSE.txt) | written here from Microsoft's `BITMAPFILEHEADER`, `BITMAPINFOHEADER`, `BITMAPV3HEADER` (“Bitmap Header Types”); double read | Trillion3D corpus, 2026-09-15 |
| `bmp` | `tronque.bmp` (31 bytes) | CC0-1.0, same notice | corpus `tests/assets/limites/truncated-bmp/truncated.bmp` | corpus |
| `bmp`, `gif`, `psd` | `scene.gltf`, `scene.bin` | CC0-1.0 | the [`hdr/`](#hdr) quad, only its image changed | Trillion3D corpus |
| `coplanar` | five `<name>.gltf` + `.bin` (612–816 bytes) + `expected.json` | repository [`LICENSE`](../../../LICENSE) | written in this repository with the `coplanar-depth-layers-v1` stage (2026-09-14), regenerated for sidecar v3; no generator kept | Alban Pasquelin |
| `dds` | `bc1-mips.dds` (43,832 bytes), `tronque.dds` (31 bytes) | CC0-1.0 | corpus `tests/assets/textures/dds-matrix/bc1-mips.dds`, `tests/assets/limites/truncated-dds/truncated.dds`; levels re-read by Pillow 12.2.0 on entering the corpus | `tests/assets/tools/texture_assets.py` |
| `exr` | six `.exr` (40–395 bytes), `scene.gltf`, `scene.bin` | CC0-1.0 | written here from ASF “OpenEXR File Layout” and “Technical Introduction to OpenEXR”, <https://openexr.com/> | Trillion3D corpus, 2026-09-15 |
| `gif` | four `.gif` (57–76 bytes) | CC0-1.0, [LICENSE.txt](gif/LICENSE.txt) | written here from CompuServe “Graphics Interchange Format, Version 89a” (1990); double read, image count included | Trillion3D corpus, 2026-09-15 |
| `gif` | `tronque.gif` (31 bytes) | CC0-1.0, same notice | corpus `tests/assets/limites/truncated-gif/truncated.gif` | corpus |
| `gltf/compressed-box` | `Box.gltf` (2,427 bytes), `Box.bin` (120 bytes) | **CC-BY-4.0**, [LICENSE.txt](gltf/compressed-box/LICENSE.txt) | unmodified Draco glTF and binary from Khronos glTF Sample Assets, [`Models/Box/glTF-Draco`](https://github.com/KhronosGroup/glTF-Sample-Assets/tree/main/Models/Box/glTF-Draco) | © 2017 Cesium (`COLLADA2GLTF`); added 2026-09-28 |
| `gltf-world` | `world.gltf`, `world.bin` (124 bytes) | CC0-1.0 | written by hand for this repository (#823) | 2026-09-26 |
| `hdr` | seven `.hdr` (81–106 bytes), `scene.gltf`, `scene.bin` | CC0-1.0 | written here from the Radiance RGBE format: a text header, a resolution line, then run-length or flat scanlines of RGB mantissas sharing one exponent byte | Trillion3D corpus, 2026-09-15 |
| `import-fbx` | `riviere.fbx` (2,990 bytes), `bend.fbx` (2,499 bytes) | repository [`LICENSE`](../../../LICENSE) | ASCII FBX 7400 written in this repository: `riviere.fbx` by hand (2026-09-15), `bend.fbx` with #357 (2026-09-29) | Alban Pasquelin |
| `ktx2` | `basis.ktx2` (8,108 bytes) | CC0-1.0, [LICENSE.txt](ktx2/LICENSE.txt) | corpus `tests/assets/textures/ktx2-matrix/basis.ktx2` | `ktx create v4.4.2 / libktx v4.4.2`, `tests/assets/tools/texture_assets.py` |
| `ktx2` | `uastc.ktx2` (416 bytes) | CC0-1.0, same notice | cut from corpus `tests/assets/textures/ktx2-matrix/uastc.ktx2`, no re-encoding | corpus |
| `ktx2` | `base.ktx2` (260 bytes), `base-zstd.ktx2` (256 bytes), `tronque.ktx2` (40 bytes), `scene.*`, `expected.json` | CC0-1.0, same notice | written here from Khronos “KTX File Format Specification, version 2.0”; `tronque.ktx2` is forty bytes of `basis.ktx2` | Trillion3D corpus |
| `ma` | `minuscule/scene.ma` (2,106 bytes) | CC0-1.0, [LICENSE.txt](ma/LICENSE.txt) | written by hand from Autodesk's public MEL command documentation, no third-party content, code or SDK | 2026-09-15 |
| `ma` | `minuscule/textures/checker.png` (291 bytes) | CC0-1.0, same notice | corpus, via `usd/minuscule/textures/checker.png` | corpus |
| `material-classes` | three `.gltf` + `.bin` | repository [`LICENSE`](../../../LICENSE) | written in this repository on 2026-09-15 (transparency, measurement and water batches); no generator kept | Alban Pasquelin |
| `obj` | `minuscule/scene.obj`, `scene.mtl`, six 2×2 `textures/*.png` | CC0-1.0, [LICENSE.txt](obj/LICENSE.txt) | written by hand from the published specification of OBJ and its material library; PNGs by a minimal PNG encoder | 2026-09-15 |
| `png` | six `.png` (77–200 bytes) | CC0-1.0 | written here from “Portable Network Graphics (PNG) Specification (Second Edition)”, W3C / ISO-IEC 15948:2004, W3C “APNG Specification” and “ICC.1:2001-04”; double read | Trillion3D corpus, 2026-09-15; `anime.png`, `icc-autre.png`, `icc-srgb.png` 2026-09-16 |
| `previews` | `atlas-couleur/` (scene, `base-degrade.png`, `lueur.jpg`, `expected.json`) | repository [`LICENSE`](../../../LICENSE) | generated in this repository by `src/tests/textures/previews_source.rs` (2026-09-15) | Alban Pasquelin |
| `previews` | `coverage-alpha.json`, `coverage-filtered.json` | repository [`LICENSE`](../../../LICENSE) | tables written in this repository (#44, #748; #43), 2026-09-26 | Alban Pasquelin |
| `psd` | twelve `.psd`/`.psb` (38–92 bytes) | CC0-1.0, `LICENSE.txt` | written here from Adobe's “Adobe Photoshop File Formats Specification”; no document under a restrictive licence copied | Trillion3D corpus, 2026-09-15 |
| `tga` | six readable `.tga` (26–76 bytes) | CC0-1.0 | written here from “Truevision TGA File Format Specification, Version 2.0”; double read | Trillion3D corpus, 2026-09-15 |
| `tga` | `tronque.tga` (31 bytes) | CC0-1.0 | corpus `tests/assets/limites/truncated-tga/truncated.tga` | `tests/assets/tools/texture_assets.py` |
| `tiff` | `rgb8-brut-ii`, `rgb8-brut-mm`, `rgb8-plans-separes`, `rgba8-alpha-associe` | CC0-1.0, [LICENSE.txt](tiff/LICENSE.txt) | written here from “TIFF Revision 6.0” (Adobe Developers Association, 3 June 1992) | Trillion3D corpus, 2026-09-15 |
| `tiff` | `rgb8-lzw`, `rgb8-deflate`, `rgb8-packbits`, `rgb8-jpeg`, `rgba8-brut`, `gris8-brut`, `palette8`, `gris16`, `deux-pages`, `ccitt-g4` | CC0-1.0, same notice | **Pillow 12.2.0**, an encoder outside the library the driver reads with | Trillion3D corpus |
| `tiff` | `tronque.tif` (31 bytes) | CC0-1.0, same notice | corpus `tests/assets/limites/truncated-tif/truncated.tif` | `tests/assets/tools/texture_assets.py` |
| `unity/cc0-import-project` | Unity project | CC0-1.0, `LICENSE.txt` | corpus `tests/assets/unity/cc0-import-project`, plus objects added here | `tests/assets/tools/unity_assets.py` |
| `unity/limites` | `truncated.unity` (31 bytes) | CC0-1.0, `LICENSE.txt` | corpus `tests/assets/limites/truncated-unity` | corpus |
| `unitypackage` | `test.unitypackage` (26,432 bytes), `hors-paquet/` | CC0-1.0, [LICENSE.txt](unitypackage/LICENSE.txt) | corpus `tests/assets/unity/cc0-unitypackage` | `tests/assets/tools/unity_assets.py` |
| `unitypackage` | `tronque.unitypackage` (31 bytes) | CC0-1.0, same notice | corpus `tests/assets/limites/truncated-unitypackage` | corpus |
| `unitypackage` | `sortie-de-dossier.unitypackage` (191 bytes), `vide.unitypackage` (63 bytes) | CC0-1.0, same notice | synthetic traps, [`traps.sh`](unitypackage/traps.sh) (Python `tarfile`) | written for this test |
| `usd` | `corpus/usda`, `corpus/usdc` | CC0-1.0, [LICENSE.txt](usd/LICENSE.txt) | corpus `tests/assets/usd/procedural-usda` and `procedural-usdc` | `model_formats_blender.py`, `model_formats_text.py` |
| `usd` | `minuscule/scene.usda` (2,847 bytes), `minuscule/textures/checker.png` | CC0-1.0, same notice | scene written by hand from the public AOUSD specification; texture from the same CC0 corpus | 2026-09-15 |
| `usdz` | `scene.usdz` (5,318 bytes) | CC0-1.0, [LICENSE.txt](usdz/LICENSE.txt) | corpus `tests/assets/usd/procedural-usdz` | `model_formats_blender.py` |
| `usdz` | `compressee.usdz`, `sans-scene.usdz`, `deux-scenes.usdz` | CC0-1.0, same notice | synthetic traps, [`traps.py`](usdz/traps.py) (Python `zipfile`) | written for this test, 2026-09-15 |
| `webp` | `sans-perte.webp` (184 bytes), `avec-perte.webp` (1,984 bytes) | CC0-1.0, [LICENSE.txt](webp/LICENSE.txt) | corpus `tests/assets/textures/legacy-web-matrix/` `lossless.webp`, `lossy.webp` | `tests/assets/tools/texture_assets.py` |
| `webp` | `etendu-sans-perte.webp`, `anime.webp`, `tronque.webp` | CC0-1.0, same notice | derived from `sans-perte.webp` by reassembling RIFF chunks per the public “WebP Container Specification”; no encoder, no pixel rewritten | same origin |
| `zip` | `scene.zip` (4,406 bytes), `tronquee.zip` (31 bytes), `hors-archive/` | CC0-1.0, [LICENSE.txt](zip/LICENSE.txt) | corpus `tests/assets/archives/gltf-nested-zip`, `tests/assets/limites/truncated-zip` | `tools/archive_limits.py` |
| `zip` | `sortie-de-dossier.zip` (153 bytes), `vide.zip` (22 bytes) | CC0-1.0, same notice | synthetic traps, [`traps.sh`](zip/traps.sh) (Python `zipfile`) | written for this test |

### Corpus files not committed

Each was run over by the driver during development, read in place, never modified.

| corpus path | size | observed result |
| --- | --- | --- |
| `tests/assets/textures/legacy-web-matrix/rgb24.bmp` | 256 × 256 24-bit truecolour, a quarter of a megabyte | yields 256 × 256 |
| `tests/assets/textures/dds-matrix/` `bc3-mips.dds`, `bc5-mips.dds`, `bc7-mips.dds`, `bc1-no-mips.dds` | two hundred and fifty kilobytes | with `bc1-mips.dds`, the five decode at 256 × 256, constant blocks throughout; the test's blocks say the same exactly |
| `tests/assets/textures/hdr-matrix/` `float16.exr`, `float32.exr` | 256 × 256 each, eight hundred thousand bytes; third-party encoder, re-read by FFmpeg on entering the corpus | `R`, `G`, `B` without alpha (the driver yields an opaque alpha), RGB between 0 and 8 exactly — the linear 0..8 ramp the corpus manifest announces |
| `tests/assets/textures/legacy-web-matrix/palette.gif` | 256 × 256 | yields 256 × 256; the image of `rgb24.bmp` **quantised at the source** by its encoder: a pixel comparison with the BMP would report that encoder's loss, not the driver's |
| `tests/assets/textures/hdr-matrix/environment.hdr` | 512 × 256, half a megabyte; third-party encoder, re-read by FFmpeg | the new compression on a real width: 512 × 256, RGB between 0 and 8 exactly (the same ramp), opaque alpha everywhere |
| `tests/assets/textures/png-matrix/`, five 256 × 256 PNGs | one hundred and forty kilobytes | see [png](#png) |
| `tests/assets/textures/legacy-web-matrix/flattened.psd` | 256 × 256, 8-bit RGB, raw surface | composite identical, pixel by pixel, to `rgb24.bmp` beside it (same image) |
| `tests/assets/textures/tga-matrix/`, four 256 × 256 TGAs (24 and 32 bits, raw and RLE, top and bottom origins, produced by Pillow) | a quarter of a megabyte per file | read |
| `tests/assets/textures/tiff-matrix/`, three 256 × 256 TIFFs (raw RGB8, LZW RGB8, grey16) and one RGB8 in 16 × 16 tiles | a quarter of a megabyte | sha256 of the RGBA8 pixels identical to Pillow's for the three readable cases, named rejection for grey16 |
| `Village2.fbx` (Whisperwind Village, off repository) | 409 MB | the opacity shape [`import-fbx`](#import-fbx) reproduces |

## alembic

### `procedural-static`

`scene.abc`: a root `Xform` `HierarchyRoot`; three `Xform` `SharedMesh_0`, `SharedMesh_1`,
`SharedMesh_2` at x = 0, 3 and 6 (the identity matrix of the first and of the root is not written
in the glTF, which implies it); under each a `PolyMesh` `Cube` — 8 positions, 6 four-sided faces,
normals and texture coordinates per face corner, the latter indexed on 14 unique values — with
three `FaceSet`, `Emissive` (faces 2 and 5), `Opaque` (0 and 3), `Transparent` (1 and 4): three
primitives per mesh, one material per name shared by the three cubes. The cubes have the same
bytes, so one mesh is written and the repetitions are nodes. `expected.json` pins 36 triangles,
3 materials, 9 face sets.

### `limites`

| file | what it proves |
| --- | --- |
| `hdf5.abc` | the HDF5 container magic, Alembic's historical wrapper this binary does not read: `alembic-hdf5-unsupported` through the whole compiler |
| `truncated.abc` | a complete Ogawa header whose root group is past the end of the file: `alembic-file-invalid` through the whole compiler |
| `cases.abc` | what the corpus lacks: a `Pentagon` with two position samples, a `Smooth` subdivision surface, a `Hair` curves object, three meshes without normals, a `Detached` `Xform` that does not inherit from its parent |

`src/tests/formats/alembic_golden.rs` proves `cases.abc` is counted (`alembic-animation-ignored`,
`alembic-curves-unsupported`, `alembic-normals-missing` ×3, `alembic-subd-as-polygons`,
`alembic-transform-not-inherited`) and that `Detached` becomes a root keeping its own matrix;
`src/plugins/scene/alembic/tests.rs` reads its Ogawa version (1).

## blend

### `procedural-materials`

`scene.blend`, Zstandard-compressed as Blender does by default; replaying the golden
(`procedural-materials/expected.json`) needs no Blender install.

| content | what it puts under watch |
| --- | --- |
| an empty `HierarchyRoot` and **three mesh objects** `SharedMesh_0`, `SharedMesh_1`, `SharedMesh_2` parented to it at (0, 0, 0), (3, 0, 0), (6, 0, 0) | the root is counted, not rendered; the world matrix is composed through the parent chain, the parenting matrix and the local transform — a file of this generation writes no matrix |
| **a single mesh** `Cube` for the three — eight vertices, six four-corner faces, twenty-four corners | the objects are instances: the glTF writes the mesh once |
| **per-face material indices** (0, 1, 2, 0, 1, 2) | three primitives |
| one **UV** layer per corner, `UVMap`; `sharp_face` true on every face | normals computed flat |
| **three materials** with a `Principled BSDF`: `Emissive` (emission of intensity 3), `Opaque` (base colour wired to an image), `Transparent` (base colour and alpha wired to the same image) | the emission is clamped by glTF and counted |
| **one packed PNG** (`checker_rgba.png`, 291 bytes) whose declared path leaves the served tree | the packed bytes are used, poured as-is into the intermediate scene binary through a buffer view |

### `limites`

`truncated.blend`: a valid header followed by a block that is not whole, refused as
`blend-truncated` without panic or unbounded allocation.

### `layouts`

One scene saved by three Blender generations, each storing meshes its own way:
`blender-3.3.blend` (`MVert`, `MEdge`, `MPoly`, `MLoop`, an `MLoopUV` layer), `blender-4.4.blend`
(named `CustomData` layers), `blender-5.2.blend` (the attribute store, whose data addresses are
unique only within each ID); all Zstandard-compressed. A `Cube` mesh — six quads, two materials
alternating by face, smooth faces with the four top edges sharp, one UV map — instanced by `CubeA`
and `CubeB`, and an `Ngon` mesh — one flat-shaded pentagon, one corner dented and raised off its
plane, no UV — held by `Ngon`. `src/tests/formats/blend_layouts.rs` proves the three cook to the
same nodes, triangles, normals and UVs, bit for bit. Regenerate from `blend/layouts/` with
`Blender --background --factory-startup --python layouts.py -- <out.blend>`.

### What the repository does not own

No file written by a Blender older than 2.8, by a 32-bit Blender or on a big-endian machine: those
rejections are proved on a minimal file written in the test from the format description
(`src/plugins/scene/blend/tests/surgery.rs`), never on a committed fixture.

## bmp

Eight files the `bmp` driver reads **losslessly**, three it refuses by name
(`src/plugins/tests/bmp.rs`); `src/tests/textures/bmp_gif_golden.rs` takes one through the whole
compiler and pins its previews' bytes in `expected.json`.

| file | header | depth | row order | what it puts under watch |
| --- | --- | --- | --- | --- |
| `vraies-couleurs-24-bas.bmp` | Info | 24-bit `BI_RGB` | bottom-up | BGR → RGB, rows restored to order, alpha filled to 255 |
| `vraies-couleurs-32-haut.bmp` | V3 | 32-bit `BI_BITFIELDS` | top-down | V3 header alpha mask, straight alpha kept (128 and 0) |
| `palette-8.bmp` | Info | 8 bits, 8-entry palette | bottom-up | indices resolved to the same colours |
| `palette-8-rle.bmp` | Info | 8-bit `BI_RLE8` | bottom-up | absolute mode, end of line and end of bitmap |
| `palette-4.bmp` | Info | 4 bits, 8-entry palette | bottom-up | two indices per byte, row padded to four bytes |
| `palette-1.bmp` | Info | 1 bit, 2-entry palette | bottom-up | one index per bit; its reference is a checkerboard |
| `r5g5b5.bmp` | Info | 16-bit `BI_RGB` | bottom-up | the default 5-5-5 masks, with no mask field |
| `r5g6b5.bmp` | Info | 16-bit `BI_BITFIELDS` | bottom-up | 5-6-5 masks read after the header, six bits on green |
| `masques-10-bits.bmp` | refused | `bmp-bitfields-lossy` | | 32-bit with 10-10-10 masks: the decoder would keep only the eight high bits of each channel |
| `jpeg-embarque.bmp` | refused | `bmp-embedded-codec-unsupported` | | `BI_JPEG`: the file wraps a whole format, which has its own driver |
| `tronque.bmp` | refused | `image-decode-failed` | | 31 bytes out of 196,662: header recognised, pixel read refused |

The eight readable files carry the same image — except `palette-1.bmp`, reduced by one bit to two
colours, and `vraies-couleurs-32-haut.bmp`, the only one with alpha: neither depth, palette,
compression nor row order changes a byte. The golden adds two rejections by rewriting a readable
header: a 64-bit depth (`bmp-depth-unsupported`) and `BI_ALPHABITFIELDS`
(`bmp-compression-unsupported`).

**Why 16-bit enters losslessly.** The decoder takes an `n`-bit channel to eight by
`round(v × 255 / (2^n − 1))` — rounded to nearest, **not** a bit copy. The table is strictly
increasing, hence injective, hence invertible: the 32 values of a 5-bit channel land on 32 distinct
8-bit values, nothing is lost. So the reference's components are 0, 8, 16, 49, 66, 132, 206, 239,
247 or 255, values both the 5-bit **and** 6-bit tables hit exactly. Pillow expands by
`(v × 255) ÷ (2^n − 1)` **truncated** where the `image` crate rounds, so the double read of the two
16-bit files compared the *stored indices* against Pillow's convention, not the rendered bytes: both
are injective, but differ in the last bit.

## coplanar

Five minimal glTF scenes pinning the `coplanar-depth-layers-v1` stage
(`src/tests/coplanar/goldens.rs`). Each folder holds `<name>.gltf` + `<name>.bin` and its verdict,
`expected.json`, checked by hand by compiling the scene with the CLI from the repository root:

```
cargo build --release --locked --manifest-path packages/asset-compiler-rust/Cargo.toml
./packages/asset-compiler-rust/target/release/trillion3d-compiler \
  tests/fixtures/formats/coplanar/<name>/<name>.gltf <CACHE>/<name> full 1000000 /assets
jq '.coplanar' <CACHE>/<name>/native/full/<key>/manifest-page-<head>.json
```

`depthLayerPerPage` is column 20 of the mesh page's column file (one `u32` per cluster, primitives
then pages), or the `depthLayer` field of each page before the manifest cut. In all five scenes the
two overlapping meshes are triangulated differently — each cell cut by a different diagonal —, so
depth alone cannot decide the winner: the reason the stage exists.

## dds

`src/plugins/tests/dds.rs` works on two materials. **A 4 × 4 block per codec**, built by
`src/plugins/tests/dds/bytes.rs` `DDS_HEADER` field by field, endpoints reconstructed by hand from
the specification:

| codec | how it is named | what it puts under watch |
| --- | --- | --- |
| BC1 | `DXT1`, then `DXGI_FORMAT_BC1_UNORM` | the two 565 endpoints and the integer thirds `(2·c0 + c1)/3` |
| BC2 | `DXT3` | the explicit four-bit alpha, expanded as `v << 4 \| v` |
| BC3 | `DXT5` | the three-bit alpha ramp and its six integer sevenths |
| BC4 | `ATI1` | a single interpolated channel, rendered as red, the rest zero and alpha 255 |
| BC5 | `ATI2` | two independent ramps, in red and green |
| BC7 | `DXGI_FORMAT_BC7_UNORM` | mode 6: seven-bit endpoints, P bit, four-bit indices; the two extreme blocks on indices 0 and 15 (weights 0 and 64), so the reference holds only endpoints |
| RGBA8, BGRA8, BGRX8 | bit masks, then `dxgiFormat` | byte order, and the opacity of `BGRX8` |

**Two corpus files:** `bc1-mips.dds`, a header written by a third-party encoder, 256 × 256, nine
levels — only level 0 comes out, the chain is counted, one byte less and the file is refused; and
`tronque.dds`, 31 bytes out of 43,832 — the magic is there, the header is not, the rejection is
named. The reader's `DDS_HEADER`, `DDS_PIXELFORMAT`, `DDS_HEADER_DXT10` and `DXGI_FORMAT` values
come from Microsoft's public “DDS — Programming Guide”, no editor SDK; blocks from
`texture2ddecoder`.

## exr

| file | what it carries | what it puts under watch |
| --- | --- | --- |
| `demi.exr` | 2 × 2, `A`, `B`, `G`, `R` channels in half-float | read order, the four channels, an alpha that is neither 0 nor 1, and un-premultiplication |
| `flottant.exr` | 2 × 2, `B`, `G`, `R` channels in single float | the same RGB values as `demi.exr` — half extends without rounding — and the opaque alpha the specification requires when the channel is missing |
| `canaux-xyz.exr` | 2 × 2, `X`, `Y`, `Z` channels | another channel set: `exr-channels-unsupported` |
| `profond.exr` | `demi.exr` with the deep-data flag | the version field is enough: `exr-deep-unsupported` before any other read |
| `multi-parties.exr` | `demi.exr` with the multi-part flag | `exr-multipart-unsupported`: nothing says which part is the texture |
| `tronque.exr` | 40 of the 395 bytes of `demi.exr` | the magic is there, the header is not: `exr-header-invalid` |
| `scene.gltf`, `scene.bin` | a quad whose base colour is `demi.exr` | the full path through to the preview report, where the float texture is named |

The encoder writes no compression, one scanline per chunk, offset table computed. The values — 0,
⅛, ¼, ½, ¾, 1, 1.5, 2, 3, 4, 8, 16 — are exact in half and single precision, so a mismatch in
`src/plugins/tests/exr.rs` can only come from the driver. For `demi.exr` the test writes **two**
references: `STOCKE`, the samples associated with their alpha as OpenEXR defines them, and `DROIT`,
each component divided by the pixel's alpha. The two pixels whose alpha is neither 0 nor 1 change;
the zero-alpha one does not — no straight colour to recover, nothing divided by zero. The quotients
— 4, 8, 3, 6, 12 — are exact in single precision.

The flagged files differ from `demi.exr` only by the version field the specification defines to
announce deep or multiple parts: the driver reads those four bytes, before the header, to refuse. A
real deep file would also carry `type` and `version` attributes and chunks of another shape — the
rejection would fall even earlier. The driver reads the version field and the channel set itself,
the rest through crate `exr`. `expected.json`: the image contract, the preview report (a `skipped`
naming `image-float-unsupported`, no preview) and the scene.

## gif

The fidelity policy admits only a **still image**: more than one image descriptor is refused by
name, never flattened onto a default frame. `src/plugins/tests/gif.rs` decodes the readable files;
`src/tests/textures/bmp_gif_golden.rs` takes `palette-globale.gif` through the whole compiler and
pins its previews' bytes in `expected.json`.

| file | colour table | what it puts under watch |
| --- | --- | --- |
| `palette-globale.gif` | global, 8 entries | the table colours rendered as-is — the format is indexed, nothing is rounded |
| `palette-locale.gif` | local, 8 entries | a table carried by the image descriptor, with no global table in the file |
| `transparence.gif` | global, 8 entries | the index declared transparent becomes a zero alpha, **and its colour stays that of the table** |
| `anime.gif` | refused, `image-animation-unsupported` | two image descriptors: an animation is not a texture and choosing one image would be arbitrary — the `webp` driver's reason, shared on purpose |
| `tronque.gif` | refused, `image-decode-failed` | 31 bytes out of 17,976: signature recognised, decode refused |

The three readable files carry the same image; only `transparence.gif` changes the alpha, and
transparency does not touch colour — nothing erased, filled with white or premultiplied. Three cases
need no file: the `GIF87a` signature rewritten onto `palette-globale.gif` (no extensions; the block
walk must traverse it as it does 89a); `anime.gif` cut at the end of its first image, then
**accepted** (a whole image without an end byte is still an image); the same cut four bytes further,
where the second image separator proves the animation even with a truncated descriptor.

The writer's LZW stream is the simplest admitted — a clear code, the literals, an end code — yet the
decoder learns one pattern per code read, so the code width grows by one bit each time its table
reaches a power of two and the writer follows: a fixed-width stream is unreadable from the eighth
code.

The driver publishes no count of images left aside — it refuses the whole file. Naming that count
needs a report channel **on the success side**, which the `image-plugin-2` contract lacks:
`ImageDecoder::decode` names a reason only in its `Err`, and `texture_preview` counts only those. A
contract job, not a driver job.

## gltf

### `compressed-box`

Khronos's Draco `Box` (`KHR_draco_mesh_compression`), unmodified, an independent decoder
interoperability fixture: `src/compressed/tests.rs` and `src/compressed/container_tests.rs` load it
(provenance and original bytes kept; the reference box reaches the existing accessors), and
`src/tests/formats/compressed_gltf/sources.rs` builds its reference accessors from the upstream
codec. Attribution (CC-BY-4.0): *Box, copyright 2017 Cesium, licensed under Creative Commons
Attribution 4.0 International*, from the Khronos glTF Sample Assets repository.

## gltf-world

One triangle `(0,0,0) (1,0,0) (0,1,0)` placed by nested and instanced nodes, so each cooked
position can be checked against the world position the file declares
(`src/tests/formats/gltf_world.rs`).

| node | placement |
| --- | --- |
| `house`, the root | translation `(10,0,0)`, a quarter turn about Y, scale 2: maps `(x,y,z)` to `(10+2z, 2y, -2x)` |
| `wall`, its child | the triangle, moved by `(1,0,0)` |
| `lamp`, child of `wall` | a `KHR_lights_punctual` point light moved by `(0,1,0)`, so at `(10,2,-2)` in the world |
| `wing`, the other child of `house` | the triangle moved by `(0,0,3)`, drawn twice through `EXT_mesh_gpu_instancing`: once moved by `(1,0,0)`, once scaled by 3, turned a quarter about Z and moved by `(0,2,0)` |

`world.bin` holds, in order, the three positions (float), the three indices (u16, padded to 4
bytes), then the two instances' translations, rotations and scales (float).

## hdr

| file | what it carries | what it puts under watch |
| --- | --- | --- |
| `plat.hdr` | 4 × 2, raw scanlines | four bytes per pixel, with no marker at all |
| `rle-ancienne.hdr` | 4 × 2, `1,1,1,n` markers | the “Real Pixels” compression: same pixels as `plat.hdr` |
| `signature-rgbe.hdr` | 4 × 2, `#?RGBE` signature | the format's second signature, which old files carry |
| `rle-nouvelle.hdr` | 8 × 1, `2, 2, width` header | per-component compression, its runs **and** its raw packets in the same scanline |
| `xyze.hdr` | `FORMAT=32-bit_rle_xyze` | another colour space: `hdr-format-unsupported` |
| `bas-en-haut.hdr` | resolution `+Y 2 +X 4` | an orientation that would have to be flipped: `hdr-orientation-unsupported` |
| `tronque.hdr` | 7 of the 32 pixel bytes | `hdr-data-truncated`, never a half scanline |
| `scene.gltf`, `scene.bin` | a quad whose base colour is `plat.hdr` | the full path through to the preview report, where the float texture is named |

The four RGBE quadruplets have exponents readable by eye — `2^-8`, `2^-7`, `2^0`, `2^4` — and
mantissas that land exactly, so every value `src/plugins/tests/hdr.rs` expects is exact in single
precision. The three 4 × 2 files carry the same image: compression and signature change no bit. The
new compression is only written from eight pixels of width, so the 8 × 1 file carries another
image, a run of four identical pixels and isolated values exercising both packet kinds.

The reader is written here (`src/plugins/image/hdr.rs`, `src/plugins/image/hdr/scanlines.rs`) from
the same sources, with no third-party library: the `image` crate recognises only the `#?RADIANCE`
signature and cannot name what it refuses, two things the driver needs. `expected.json`: the image
contract, the preview report (a `skipped` naming `image-float-unsupported`, no preview) and the
scene.

## import-fbx

**`riviere.fbx`**, classic-material opacity (`src/tests/formats/import_opacity.rs`): a 3 KB ASCII
FBX 7400 — a quad, a `phong` material `M_Riviere`, two textures — reproducing as short as possible
the shape opacity takes in `Village2.fbx`. `ShadingModel: "phong"` makes `ufbx` classify it as
`FbxPhong`, so `features.pbr` stays off and **`pbr.opacity` has neither a value nor a texture**;
`TransparentColor` carries the transparency *and* the opacity map
(`C: "OP",5000,3000, "TransparentColor"`), `TransparencyFactor` the factor. The two images
(`albedo.png`, `opacite.png`) are not versioned: the test writes them beside the throwaway copy of
the FBX, like the OBJ fixtures — only the path opacity takes counts. To wire one texture onto base
colour and opacity, the test replaces the last connection with
`C: "OP",4000,3000, "TransparentColor"`, the case where glTF can carry the alpha in
`baseColorTexture`.

**`bend.fbx`**, an FBX that bends (#357; `src/tests/formats/fbx_motion.rs`,
`src/import/motion_sampling_tests.rs`): a triangle `leaf` skinned to one `LimbNode` bone `stem`, a
`BlendShape` whose channel `curl` curls it, and an `AnimationStack` `sway` sliding the bone. The
conversion writes a skin, a morph target and a clip; the compilation pages the skinned leaf and
tables its motion.

## ktx2

The golden works on the five files below and on the tiny containers
`src/plugins/tests/ktx2/bytes.rs` writes field by field from the Khronos specification.

| file | what it carries | what it proves |
| --- | --- | --- |
| `base.ktx2` | 4 × 4, `VK_FORMAT_R8G8B8A8_SRGB`, `supercompressionScheme` 0 | an uncompressed level comes out byte for byte; its sixteen texels are written in the clear in `src/plugins/tests/ktx2.rs` |
| `base-zstd.ktx2` | the same level under `KTX_SS_ZSTD` | supercompression is only a wrapper: undone, it yields exactly the same texels |
| `uastc.ktx2` | 16 × 16, `VK_FORMAT_UNDEFINED`, UASTC LDR 4 × 4 payload | the Basis Universal path without supercompression, sixteen blocks of sixteen bytes |
| `basis.ktx2` | 256 × 256, `VK_FORMAT_UNDEFINED`, ETC1S payload under `KTX_SS_BASIS_LZ` | the supercompressed Basis Universal path, codebooks included, as a third-party encoder writes it |
| `tronque.ktx2` | forty bytes of `basis.ktx2` | the identifier is there, the header is not, and the rejection is named |

**The small files.** UASTC blocks are sixteen bytes, independent and laid out by rows, so the first
four blocks of the first four rows of the corpus `uastc.ktx2` are exactly its top-left 16 × 16
texel corner. The header is the source's with `pixelWidth` and `pixelHeight` at 16, no keys, the
format descriptor copied at byte 104 and the level at byte 160 — the multiple of sixteen the
specification requires for a sixteen-byte block. `base.ktx2` and `base-zstd.ktx2`: an eighty-byte
header, a one-level index, an R8G8B8A8 sRGB format descriptor taken from the corpus, the level at
byte 196; sixteen texels `[x·85, y·85, (x+y)·42, 255 − (x+y)·17]`; `base-zstd.ktx2`'s level is the
same bytes through a reference Zstandard encoder.

**The test containers** cover the `vkFormat` values the codec table names, one block per case, with
the codec specification's reference values rather than the decoder's. Since the “image fidelity”
batch, the two unsigned EAC formats have their own case: a hand-written block whose eleven-bit
values 4, 5 and 13 become bytes 0, 1 and 2 by rounding to nearest, where the external decoder's
truncation gave 0, 0 and 1 and its reversed read of the index field displaced the texels — the
block states both rounding and texel place. They also cover what a container **declares**: the
format descriptor's transfer function (the same payload declared linear then sRGB), its
premultiplied-alpha flag, and the `KTXorientation` and `KTXswizzle` keys. The driver applies what
applies (un-premultiplication, vertical flip for `ru`) and counts the rest under
`ktx2-orientation-unsupported` or `ktx2-swizzle-unsupported`. The four readable files declare an
sRGB `transferFunction` and no flag: their texels do not move.

**What the golden pins.** Texels in the clear for the uncompressed case, for three-colour BC1 —
the only case where the alpha bit separates `BC1_RGB` from `BC1_RGBA` — and for a 4 × 4 ASTC “void
extent” block, whose colour is written in the block. For the other `vkFormat` codecs, routing and
block geometry, proved by the missing byte: BCn integer interpolation is pinned block by block by
the `dds` golden (same `image::blocks` foundation, same decoder), and ETC2, EAC and ASTC belong to
`texture2ddecoder`.

`scene.gltf`, `scene.bin` and `expected.json` are the compiled golden: three quads, one opaque
material and one texture per file of the table's first half; regeneration is in the header of
`src/tests/textures/ktx2_golden.rs`. The reader: header, section index and level index written from
the KTX 2.0 specification, no editor SDK; Basis Universal by `basisu`, GPU blocks by
`texture2ddecoder` through the `image::blocks` foundation shared with `dds`, Zstandard by `ruzstd`.

## ma

**What the `ma` driver produces from a MEL command file, and what it refuses to do with it.**
Golden
[`packages/asset-compiler-rust/src/tests/formats/ma/golden.rs`](../../../packages/asset-compiler-rust/src/tests/formats/ma/golden.rs);
what only the driver's inside proves — text splitting, an attribute written in slices, a corner
resolved from its edge — in
[`packages/asset-compiler-rust/src/plugins/scene/ma/tests.rs`](../../../packages/asset-compiler-rust/src/plugins/scene/ma/tests.rs).
`minuscule/scene.ma` holds a `transform` hierarchy, a `mesh` of two quadrilaterals, two shaded face
groups, an instance via `parent -add`, a `lambert` and a `standardSurface`, the latter textured by
`minuscule/textures/checker.png`, resolved relative to the source folder.

| choice | what it puts under watch |
| --- | --- |
| **a face reusing another face's edge in reverse** (`f 4 -3 4 5 6`) | a Maya face cites its **edges**; the corner of rank `k` is the start vertex of the `k`-th — the second vertex when the index is negative. The easiest rule in the format to read the wrong way |
| **two quadrilaterals** | fan triangulation, four triangles for two faces |
| **two `objectGrpCompList` of one face each** | one `instObjGroups` per face group becomes a separate glTF primitive, no face drawn twice |
| **no written normal** | computed flat, one per face, and the report says so |
| **`currentUnit -l centimeter`** | the `0.01` factor toward the metre, carried by the scene root, not applied to the vertices |
| **a 90° rotation with `rotateOrder`** | the local matrix, composed in the declared order |
| **`parent -add -s`** | a second pose of the same shape cites the **same** glTF mesh |
| **an opaque `lambert` and a `standardSurface` with `opacity` 0.5, metal, colour texture and emission** | `baseColorFactor`, `metallicFactor`, `roughnessFactor`, `alphaMode` and the texture slot, without any rule naming an object type |
| **a camera, a `select` on a node absent from the file, a `python` command** | what the driver **counts without rendering**; the `python` command is the written proof of the safety contract: its text enters the report under `ma-command-ignored:python`, nothing executes it |

`expected.json`: the selected driver, the intermediate scene and the compiled scene, sidecar
included. Regenerate:

```sh
cargo test --release --locked --manifest-path packages/asset-compiler-rust/Cargo.toml --lib regenerate_the_ma_fixture -- --ignored
```

## material-classes

No bench scene carries the classes the engine distinguishes: Emerald has only blended foliage, no
cutout, no transmissive surface. These minimal glTF scenes do, each subdivided enough for several
clusters and so a real DAG cut; no texture, the class is read from the material alone. Read by
`src/tests/lights/lamp_emitter.rs`, `src/tests/scene/visibility.rs` and the bench.

### `classes-materiaux` — opaque, cutout, blend

| mesh | material | class | compiler packing |
| --- | --- | --- | --- |
| `opaque0..2` | `beton` | opaque | `exact-clusters` |
| `grille` | `grillage`, `alphaMode: MASK`, `alphaCutoff 0.5` | cutout | `exact-clusters` |
| `vitre` | `vitre`, `alphaMode: BLEND` | blend | `clustered-blend` |

4,516 triangles. This is the scene the harness measures.

### `transmission` — the fourth class, and something to see it with

| mesh | material | class | compiler packing |
| --- | --- | --- | --- |
| `fond` | `fond`, opaque | opaque | `exact-clusters` |
| `bloc0..2` | `beton`, opaque | opaque | `exact-clusters` |
| `eau` | `eau`, `KHR_materials_transmission` 1.0, `KHR_materials_ior` 1.33, `KHR_materials_volume` (thickness 2.5, distance 6, colour 0.35/0.72/0.68) | transmission | `shared-blend` |

2,880 triangles: a water plane at `y = 0` above a ground at `y = -2.5` and three blocks, two
piercing the surface. What is looked at is the ground's deviation under the water against the
straight line of the block above it, and the tint the attenuation distance gives it — with nothing
behind the water the scene would prove nothing. Every triangle winds outward (ground and water face
`+y`, blocks face away from their centre) so a single-sided material shows the faces the camera
sees; the file's first form wound them inward and rendered the blocks' far faces. The water packs
as `shared-blend`: outside the DAG, one primitive = one whole mesh, source order kept, so no
cluster and no error band; `assertCacheIdentity` accepts it on that ground since the water batch,
and a `shared-blend` primitive still carrying pages remains refused.

### `emetteur-sphere` — the emitter's spherical exclusion

| mesh | material | role |
| --- | --- | --- |
| `sol` | `sol`, opaque | receives the shadow |
| `occultant-diagonale` | `occultant`, opaque | 0.3121 m from the lamp centre (0.19, 0.18, 0.17 relative) — outside the 0.20 m radius sphere |
| `occultant-proche` | `occultant`, opaque | 0.15 m from the lamp centre — inside the sphere |
| `enveloppe-lampe` | `enveloppe`, non-zero `emissiveFactor` | the luminaire around the lamp: six vertices at 0.20 m from its centre |

34 triangles, one point lamp (`lampe`, `KHR_lights_punctual`, range 3 m). The glTF declares no
radius — `KHR_lights_punctual` carries none (`docs/SDK.md`): the compiler writes
`"emitterRadius": 0.2` in `lights.json`, measured on `enveloppe-lampe` (the lamp's emissive
sibling, an octahedron) and counted under `light-emitter-radius-derived`. Nothing is added by hand:
`loadImportedLights` (`packages/sdk-browser/src/lighting/importedLights.ts`) validates the value by
the host's lamp contract. It reproduces the VERIFICATION_STABILISATION_5896648_2026-09-16 audit
(defect 4): `occultant-diagonale` is outside the sphere but fell inside the cube the old near plane
excluded; `occultant-proche` falls in both, before as after, and crosses the envelope — the wall
that cuts the glass, occluding beyond it.

### Compile and measure

From the repository root; `<CACHE>` is the “derived” folder receiving `native/full/manifest.json`,
outside the repository (`.mesure/` for example) — nothing is written into the bench assets.

```
cargo build --release --locked --manifest-path packages/asset-compiler-rust/Cargo.toml
./packages/asset-compiler-rust/target/release/trillion3d-compiler \
  tests/fixtures/formats/material-classes/<name>.gltf <CACHE> full 1000000 /assets

node bench/runner/bench.ts --engine webgpu --before <ref> --after <ref> \
     --cache-before <CACHE> --cache-after <CACHE> --views overview,detail \
     --images 60 --pixelError 0.1
```

## obj

**What an OBJ and its `.mtl` yield, and what the driver counts without rendering.** Golden
[`packages/asset-compiler-rust/src/tests/formats/obj_golden.rs`](../../../packages/asset-compiler-rust/src/tests/formats/obj_golden.rs);
what needs the source modified between two compilations — library touched, missing, truncated,
texture name to escape — in
[`packages/asset-compiler-rust/src/tests/formats/obj_mtl.rs`](../../../packages/asset-compiler-rust/src/tests/formats/obj_mtl.rs).
`minuscule/scene.obj`: two groups, a quadrilateral and a pentagon, shaded by two `usemtl`.
`minuscule/scene.mtl`: everything a library declares — `Ka`, `Kd`, `Ks`, `Ns`, `Ni`, `d`, `Ke`,
`map_Ka`, `map_Kd`, `map_d`, `norm`, `map_Bump`, `map_Ke`, and the `-s`, `-o`, `-bm`, `-clamp`
options. `minuscule/textures/*.png`: six 2×2 RGBA images, three entering the output, three proving
a report code.

| choice | what it puts under watch |
| --- | --- |
| **a pentagon** | triangulation, three triangles for one face, five in all with the quad |
| **`d 0.5` and `map_d` on a different file from `map_Kd`** | the material comes out `BLEND`, never `MASK` — a cut-out transparent would be a loss —, and the separate map glTF cannot carry is counted under `material-separate-opacity-texture`, not swallowed |
| **`norm` and `map_Bump` on two different files** | the **normal wins**, the bump left behind is counted under `material-bump-map`; without that, the reader's “last one wins” changed the normal map silently |
| **`Ks`, `Ni`, `Ka` and `map_Ka`** | no place in glTF's metal-roughness model: counted — `material-specular-color`, `material-specular-ior`, `material-ambient-color` — and **never guessed**: a specular colour does not become metal, those are two models |
| **`-clamp on` on `map_Ke`** | the only map option glTF carries as-is, become the sampler wrap mode (`wrapS` and `wrapT` at `CLAMP_TO_EDGE`) |
| **`-s`, `-o` on `map_Kd` and `-bm` on `norm`** | accepted by the reader then inert — the glTF writer does not know `KHR_texture_transform`, nothing carries bump strength: counted under `texture-scale`, `texture-offset`, `texture-bump-scale` |
| **`Ns 60`** | the specular exponent, which does become a roughness and so is not counted |

`expected.json`: the selected driver, the intermediate scene — with the external files the read
opened and their fingerprint — and the compiled scene, sidecar included; neither cache key nor
durations. Regenerate:

```sh
cargo test --release --locked --manifest-path packages/asset-compiler-rust/Cargo.toml --lib regenerate_the_obj_fixture -- --ignored
```

## png

Six files of two hundred bytes at most; `src/plugins/tests/png.rs` feeds them to the image registry
and compares against the reference. Chunks are written one by one (IHDR, PLTE, IDAT, IEND, `acTL`,
`fcTL`, `fdAT`, `iCCP`, lengths and CRC-32 included).

| file | colour type | depth | what it puts under watch |
| --- | --- | --- | --- |
| `rgb8.png` | 2 (RGB) | 8 bits per channel | the common case: decoded, alpha filled to 255, pixels unchanged |
| `palette4.png` | 3 (palette) | 4 bits, 24-bit palette | under eight bits the expansion to RGBA8 copies, it loses nothing |
| `rgb16.png` | 2 (RGB) | 16 bits per channel | refused under `image-depth-unsupported`, before any decoding |
| `anime.png` | 2 (RGB) | 8 bits, two frames | APNG: the default image comes out, the animation is counted under `image-animation-first-frame` |
| `icc-autre.png` | 2 (RGB) | 8 bits, `iCCP` chunk | a profile that is not the output's: counted under `image-icc-profile-ignored` |
| `icc-srgb.png` | 2 (RGB) | 8 bits, `iCCP` chunk | a profile that names itself sRGB: nothing to convert, nothing to count |

The same 2 × 2 drawing everywhere — red, green on the top row, blue, yellow below —, and the two
readable depths yield exactly the same four pixels: bit depth writes the image, never changes it.

- `rgb16.png` carries in the low byte of each of its twelve components a non-zero, distinct value
  (`0x11`, `0x22`, … `0xCC`), its high bytes repeating the reference: a `to_rgba8()` would yield
  the reference without a murmur and lose twelve precision bytes. The driver reads the depth from
  the IHDR and refuses before decoding; Pillow's double read quietly narrows it to the 8-bit
  reference — the symptom this driver refuses.
- The transfer curve is read in a fixed priority, `iCCP`, then `sRGB`, then `gAMA`: 45455 is the
  sRGB curve, 100000 linear samples, any other gamma counted under `image-transfer-unsupported`. The
  golden places these chunks on `rgb8.png` in memory: they change no pixel, and one fixture per
  gamma would teach nothing more.
- `anime.png` carries `acTL`, `fcTL`, `IDAT`, `fcTL`, `fdAT`: a pure red first frame in `IDAT` (the
  APNG default image), a pure green second in `fdAT`. The contract returns one image: the golden
  fixes it is the first and that the declared animation is counted, not silently dropped.
- The profile files are `rgb8.png` with an `iCCP` chunk after the IHDR: a minimal ICC v2 written
  here, a one-hundred-and-twenty-eight-byte header and a single `desc` tag. Only its name, which PNG
  requires in the clear before the compressed profile, enters the decision; same drawing, since this
  batch converts no colour. Pillow reads two frames, red then green, in `anime.png` and a
  two-hundred-and-fifty-byte ICC profile in both profile files: the files carry what the driver
  counts.

The five 256 × 256 corpus PNGs of `tests/assets/textures/png-matrix/` (grey, palette, 8-bit RGB,
8-bit RGBA with binary alpha, 16-bit RGB) change behaviour only where the decision targeted:
`rgb8.png` (2, 8 bits), `palette.png` (3, 8 bits) and `gray.png` (0, 8 bits) are decoded,
`rgba8-binary.png` (6, 8 bits) decoded with alpha kept, `rgb16.png` (2, 16 bits) refused,
`image-depth-unsupported`.

## previews

**Progressive colour-texture previews**, end to end: real glTF → `compile()` → cache →
`texturePreview*` columns of the head page's column file, pinning the compiler's `texturePreviews`
section. The unit tests of
[`packages/asset-compiler-rust/src/texture_preview/tests/`](../../../packages/asset-compiler-rust/src/texture_preview/tests/)
pin the math on images built in memory; this pins the bytes an engine reads, PNG and JPEG decoders
included.

### `atlas-couleur`

Four two-triangle quads, three units apart so no pair is coplanar — the scene speaks only of
textures.

| primitive | material | class | colour texture |
| --- | --- | --- | --- |
| 0 | `beton` | opaque | `baseColorTexture` → texture 0 |
| 1 | `grille` | `MASK`, `alphaCutoff` **0.25** | `baseColorTexture` → texture 1 |
| 2 | `vitre` | `BLEND` | `baseColorTexture` → texture 2 |
| 3 | `lampe` | opaque, emissive | `emissiveTexture` → **texture 2**, shared with `vitre` |

| image | file | provenance | dimensions | first carried level | levels | what it puts under watch |
| --- | --- | --- | --- | --- | --- | --- |
| 0 | `base-degrade.png` | `uri` | 40 × 24 | 0 | 6 | neither square nor a multiple of sixteen: box-average cells differ in size, the last level is reached by truncation |
| 1 | — | `bufferView` 6 of `atlas-couleur.bin` | 24 × 16 | 0 | 5 | strictly binary alpha (a centred ellipse, coverage exactly 192 texels out of 384); the only texture every binding of which is a `MASK` base colour, so the only alpha rescaled to preserve coverage |
| 2 | `lueur.jpg` | `uri` | 80 × 48 | **1** | 6 | the only side above `PREVIEW_BASE`: first carried level mip 1, never mip 0; the only JPEG, hence the second decoder; shared by a `BLEND` and an emissive, no binding a `MASK`, so no cutoff |

The other two keep their alpha, which `coveredAtMaskCutoff` in `expected.json` shows by staying
equal to each level's total texel count; one image by `uri`, one by `bufferView` cover both
source-byte read paths. `expected.json`, per sidecar entry: the ten numbers it declares, the source
image digest, then each level's dimensions, the **sha256 of all its bytes**, five texels (four
corners and centre) and its coverage at the `MASK` cutoff — the sha256 trips on any byte, texels and
coverage say *where* the computation moved. Scene, images and expected all come from
[`packages/asset-compiler-rust/src/tests/textures/previews_source.rs`](../../../packages/asset-compiler-rust/src/tests/textures/previews_source.rs):

```
cargo test --release --locked --manifest-path packages/asset-compiler-rust/Cargo.toml --lib \
  regenerate_the_previews_fixture -- --ignored --nocapture
npx prettier --write tests/fixtures/formats/previews/atlas-couleur/expected.json
```

Decoded JPEG bytes depend on the decoder: an `image` crate version change requires regenerating and
justifying the gap in the commit message.

### Coverage tables

Shared by the compiler and the engine, one case per line, each stating its contract in `about`:

- `coverage-alpha.json` — coverage-preserving alpha (`docs/FORMAT.md`, #44): per case the cutoff
  byte, level 0's alphas, a level's median alphas, the `t` the rule picks, and the alphas once
  scaled. Read by `src/texture_preview/tests/coverage_alpha.rs` and
  `packages/sdk-browser/src/texture/coverageRule.test.ts`, which checks the WGSL and GLSL arithmetic
  on it (#748).
- `coverage-filtered.json` — coverage on the bilinearly filtered cut (#43): a 32² alpha cut at
  `cutoff` 128 whose texel count and filtered coverage disagree, and per level of the compiler's
  chain its filtered samples at or above the cutoff (four a texel). Read by
  `src/texture_preview/tests/coverage_filtered.rs` and
  `packages/sdk-browser/src/texture/leafCoverage.test.ts`, each builder within 2.5 % of it.

## psd

The import policy admits from PSD only the **flattened composite** the file carries at its end,
never recomposed layers: recomposing would redo the editor's blend modes, masks and effects and
produce an image the source does not contain. The encoder writes the twenty-six-byte header, three
length-prefixed sections, the composite-data section and PackBits run-length compression.

| file | what it carries | what it puts under watch |
| --- | --- | --- |
| `rgb-brut.psd` | 4 × 2, 8-bit RGB, compression 0 | the three planes as-is, one whole channel after another |
| `rgb-rle.psd` | 4 × 2, 8-bit RGB, compression 1 | PackBits: same pixels as `rgb-brut.psd`, a run and a raw packet in the same scanline |
| `rgba-rle.psd` | 4 × 2, RGB + one extra plane, compression 1 | nothing declares transparency: the fourth plane is a saved alpha channel, read, written nowhere and counted `psd-alpha-channel-ignored` |
| `gris-brut.psd` | 4 × 2, 8-bit grayscale, compression 0 | the single colour channel carries the three components, with no profile and no matrix |
| `gris-alpha-rle.psd` | 4 × 2, grey + one extra plane, compression 1 | the same case in a mode with a single colour channel |
| `grand-format.psb` | 4 × 2, 8-bit RGB, PSB, compression 1 | version 2 of the format: layer-section length on eight bytes, per-scanline byte count on four |
| `seize-bits.psd` | refused, `psd-depth-unsupported` | sixteen bits per channel: bringing them down to eight would be a loss the source did not have |
| `cmjn.psd` | refused, `psd-color-mode-unsupported` | CMYK mode: converting it would require a profile the driver would choose in place of the source |
| `canaux-en-trop.psd` | refused, `psd-channels-unsupported` | two planes more than the colour channels: nothing in the header says which one is a transparency |
| `zip.psd` | refused, `psd-compression-unsupported` | composite compressed by ZIP, outside the raw and PackBits subset |
| `sans-composite.psd` | refused, `psd-composite-missing` | the file stops after the layer section: no flattened image to read, and it is not recomposed |
| `tronque.psd` | refused, `psd-data-truncated` | 7 of the 24 pixel bytes: never a half plane |

Five of the readable files carry the same composite — three identical pixels, one isolated pixel,
then a vivid colour and a grey run: compression, colour mode and format version change no byte
(`src/plugins/tests/psd.rs`). The test adds `rgb-brut.psd` with its width set to zero
(`psd-header-invalid`) and a signature with an unknown version number, which the driver does not
claim.

**The extra plane: transparency or selection.** No fixture carries a layer section, so a fourth
plane is **not** declared as the document's transparency: it is a saved alpha channel — a selection
— read to advance one plane, written nowhere, counted under `psd-alpha-channel-ignored`. The golden
once asserted that plane **was** the composite's alpha, punching a hole in a texture whose document
carried only a selection. The true-transparency and layer cases are built in the test from
`rgba-rle.psd` and `rgb-rle.psd`, their empty layer section replaced by one carrying a layer count —
the sixteen-bit signed integer whose sign, per Adobe's specification, declares the composite's first
alpha plane to be the document's transparency. The driver reads only that field and skips the rest
by its length, so these cases fault exactly the deciding field without a whole layer record.

The colour profile, image resource 1039, is built the same way: `src/plugins/tests/icc.rs` replaces
`rgb-brut.psd`'s empty resource section with one carrying it, once naming itself sRGB (counts
nothing), once another (counts `image-icc-profile-ignored`) — this batch converts no colour, it says
what it does not convert.

`scene.gltf` and `scene.bin`: the [`hdr/`](#hdr) quad, base colour `rgb-brut.psd`.
`src/tests/textures/psd_golden.rs` compiles it through the shared harness and compares every byte of
its progressive previews against `expected.json` — an eight-bit-per-channel composite enters like
any other RGBA8 source, with no rejection in the report; regeneration is in that test's header.

## tga

`src/plugins/tests/tga.rs`: six profiles read losslessly, one truncated file refused by name.

| file | image type | depth | origin | what it puts under watch |
| --- | --- | --- | --- | --- |
| `vraies-couleurs-24-bas.tga` | 2 (raw) | 24 bits | bottom | BGR → RGB, rows flipped, alpha filled to 255 |
| `vraies-couleurs-32-haut.tga` | 2 (raw) | 32 bits | top | alpha kept as-is, “TRUEVISION-XFILE.” 2.0 footer |
| `vraies-couleurs-32-rle-haut.tga` | 10 (RLE) | 32 bits | top | repeated packets **and** raw packets, same pixels as the raw |
| `vraies-couleurs-32-rle-bas.tga` | 10 (RLE) | 32 bits | bottom | RLE and row flip together |
| `palette-8-haut.tga` | 1 (raw) | 8 bits, 24-bit palette | top | palette indices resolved to the same colours |
| `niveaux-de-gris-8-bas.tga` | 3 (raw) | 8 bits | bottom | grey expanded to RGB, alpha 255 |
| `tronque.tga` | 2 (raw) | 24 bits | bottom | 31 bytes out of 196,652: header recognised, decode refused |

The three 32-bit variants and the 24-bit one carry the same image, only the 24-bit alpha filled
(the format has none): origin, compression and depth change no byte.

## tiff

TIFF is a field container rather than a format: the driver declares its profiles one by one and
refuses the rest by name — seven files read losslessly, eight refused (`src/plugins/tests/tiff.rs`).

| file | profile | compression | what it puts under watch |
| --- | --- | --- | --- |
| `rgb8-brut-ii.tiff` | 8-bit RGB | none (1) | little-endian IFD, `BitsPerSample` array off-field, alpha filled to 255 |
| `rgb8-brut-mm.tiff` | 8-bit RGB | none (1) | the same file big-endian: byte order does not change a pixel |
| `rgb8-lzw.tiff` | 8-bit RGB | LZW (5) | variable-length codes, same pixels as the raw |
| `rgb8-deflate.tiff` | 8-bit RGB | Deflate (8) | the other tag of the same codec |
| `rgb8-packbits.tiff` | 8-bit RGB | PackBits (32773) | repeated packets and raw packets |
| `rgba8-brut.tiff` | 8-bit RGBA | none (1) | `ExtraSamples = 2` (unassociated alpha): the four bytes pass as-is, including a zero alpha |
| `gris8-brut.tiff` | 8-bit grey | none (1) | black at zero, value copied onto the three channels, alpha 255 |
| `gris16.tiff` | refused | `image-depth-unsupported` | 16 bits per component: `DecodedImage` has only `Rgba8`, silently narrowing would add loss |
| `palette8.tiff` | refused | `image-profile-unsupported` | `Photometric = 3`; the reading library does not expand TIFF palettes |
| `rgb8-jpeg.tiff` | refused | `image-profile-unsupported` | JPEG-in-TIFF (compression 7) |
| `ccitt-g4.tiff` | refused | `image-profile-unsupported` | CCITT Group 4 (compression 4), bilevel |
| `deux-pages.tiff` | refused | `image-profile-unsupported` | two IFDs: a single page would be rendered, the other would vanish with no report |
| `rgb8-plans-separes.tiff` | refused | `image-profile-unsupported` | `PlanarConfiguration = 2`: one strip per component |
| `rgba8-alpha-associe.tiff` | refused | `image-profile-unsupported` | `ExtraSamples = 1`, premultiplied alpha: rendering it as-is would change the colours |
| `tronque.tif` | refused | `image-decode-failed` | 31 bytes out of 196,748: the header is a TIFF header, it is the read that fails |

The hand-written files carry a header, a single IFD sorted by tag, off-field arrays and strips. The
fourteen files other than `tronque.tif` were re-read by Pillow before commit. BigTIFF has no file:
its first four bytes (`II+\0`, `MM\0+`) suffice and are written in the golden; the driver claims
them so the rejection is named rather than the file coming out as an unknown format.

## unity

### `cc0-import-project`

A minimal Unity project (expected: `cc0-import-project/expected.json`). Only the files the driver
needs come from the corpus; its editor C# script does not — this driver reads only data, and no
script has a place in a fixture. Taken as-is: `Assets/Map.unity` and its `.meta`,
`Assets/Materials/{Standard,URP,HDRP}.mat`, `Assets/Models/LODProp.fbx` (LOD 320/80/20 triangles),
`Assets/Prefabs/Prop_Standard.prefab`, `Assets/Textures/checker.tga`. Added here under the same
CC0-1.0 licence, for what the corpus scene (built-in cubes with a `LODGroup`) lacks:

| object | what it puts under watch |
| --- | --- |
| `Prop_Model` | a `MeshFilter` pointing at the FBX by GUID, at (1, 2, 3), turned a quarter about Y, scaled by 2: axis conversion and composition with the FBX driver checked in the clear; its `fileID` is not in the `.meta` name table, so the whole model is instantiated and the fact counted |
| `Prop_SubMesh` | the same model through a `MeshFilter` targeting `fileID` 4300002, which the `.meta` `internalIDToNameTable` names `Icosphere.001`: only that mesh is kept |
| `LODProp.fbx.meta` | `globalScale: 2` and `useFileScale: 1`: the import scale applies to the nodes poured from the model, never to its geometry |
| a lamp on that object | counted without being rendered |
| `Prop_Cutout`, `Prop_Glass` with `Assets/Materials/{Cutout,Glass}.mat`, written here | cutout (Standard `_Mode: 1`, `_Cutoff: 0.25`) and transparent (URP `_Surface: 1`, alpha 0.5, emission, double-sided) |
| `Prop_Hidden`, inactive | must produce no node |
| `Prop_Glass`'s real-project `fileID`s beyond 2^53 (`33000014169494082`, `23000014090315290`) | read through a float they would name an object that does not exist, and the object would vanish |
| two instances of `Prop_Standard.prefab` | `Prop_Copy`: moved to (-4, 0, 5), renamed, rescaled on y, LOD0 renderer material replaced by `Glass`, `LOD2` object disabled; `Prop_Muted`: LOD0 renderer off. Edits this driver does not render — `m_StaticEditorFlags`, `m_TagString` — stay counted, property by property |

The folder is also the router's proof: it carries a scene and an FBX, and routes to `unity` without
anything designating it.

### `limites`

`truncated.unity`: the first 31 bytes of `Map.unity`. A file with no document is refused cleanly,
without panic or unbounded allocation.

## unitypackage

A container must change nothing about the project it wraps, so the same Unity project is here
**inside** its `.unitypackage` and **flat** outside it. The golden
(`packages/asset-compiler-rust/src/tests/formats/unity/package_golden.rs`) compiles both through the
shared harness, compares the second against the first, then the first against `expected.json`.

| file | what it pins |
| --- | --- |
| `test.unitypackage` | the package: 11 GUID folders, each with `pathname`, `asset` and `asset.meta` — scene, prefabs, materials, FBX, TGA texture |
| `hors-paquet/Assets/` | the contents of `test.unitypackage`, rebuilt once and for all: the same project without a container |
| `sortie-de-dossier.unitypackage` | a `pathname` `../escape/Map.unity`: escape from the extraction folder, refused `ARCHIVE_PATH_ESCAPE` |
| `tronque.unitypackage` | 31 of the 26,432 bytes of `test.unitypackage`: the gzip stream stops, rejection `ARCHIVE_UNREADABLE` |
| `vide.unitypackage` | the 63 bytes of a tar.gz with no entry: rejection `ARCHIVE_EMPTY` |

- **The rebuilt tree:** entries carry no project path, only a folder per GUID;
  `Assets/Materials/Standard.mat` exists only because the driver read the GUID's `pathname` and
  copied `asset` there, `Assets/Map.unity.meta` only because it copied `asset.meta` there.
- **The whole project's `.meta`:** `metaFiles: 11`, so the eleven `.meta` are rebuilt in place — one
  missing and the Unity driver would no longer resolve its GUID. `hors-paquet/` is the package
  **C# script excepted**: `Assets/Editor/` carries the `.meta` but not the `.cs`, so the flat
  project counts the same eleven `.meta` and the two compilations compare.
- **A routing that traverses:** extraction carries only `Assets/`, which the foundation traverses
  before routing; the router sees a `.unity` at the first level and the `.fbx` nested under
  `Models/`, so one driver claims and the `unitypackage` → `unity` chain closes.
- **The fingerprint of each file read:** `files` carries each data file's name, size and sha256; a
  byte moved by extraction shows there. `files` stands in for identity: the two compilations'
  equality rests on it.
- **The three traps:** each refused by its own code, nothing extracted. Regenerate the two
  synthetic ones with `sh traps.sh` from `unitypackage/`.

`expected.json` also pins the `unitypackage` → inner driver chain, the three rejection codes, the
files read with their fingerprint and the Unity driver counts.

## usd

Two fixtures, two questions. Golden
[`packages/asset-compiler-rust/src/tests/formats/usd/golden.rs`](../../../packages/asset-compiler-rust/src/tests/formats/usd/golden.rs);
isolated behaviours in `packages/asset-compiler-rust/src/tests/formats/usd/driver.rs`, what the
report counts in `packages/asset-compiler-rust/src/tests/formats/usd/report.rs`, hard rejections in
`packages/asset-compiler-rust/src/tests/formats/usd/refusal.rs`.

| file or choice | what it pins |
| --- | --- |
| `minuscule/scene.usda` | what the driver produces: `Xform` hierarchy, `Mesh` of two quads, `GeomSubset` `materialBind`, two materials of which one is textured |
| `minuscule/textures/checker.png` | the texture the translucent material cites, resolved relative to the layer folder |
| `corpus/usda/scene.usda`, `corpus/usdc/scene.usdc` | the same scene in text and in binary “crate”: both must yield the **same** intermediate scene, down to the node and the sidecar byte — the only proof that counts that the driver reads a document, not a writing. Three cubes, three materials, thirty-six triangles |
| **two quadrilaterals and a one-face subset** | fan triangulation; a material part becomes a separate glTF primitive, faces no subset claims falling back to the mesh binding |
| **a `constant` normal and a `vertex` `primvars:st`** | the two interpolations resolve at different ranks of the array, and that rank is what deduplicates vertices |
| **an opaque `UsdPreviewSurface` and another with `opacity` 0.5 and a texture** | `baseColorFactor`, `alphaMode` and the texture slot, without any rule naming an object type |

`expected.json`: the selected driver, the intermediate scene and the compiled scene, sidecar
included. Regenerate:

```sh
cargo test --release --locked --manifest-path packages/asset-compiler-rust/Cargo.toml --lib regenerate_the_usd_fixture -- --ignored
```

## usdz

A container must change nothing about the scene it wraps. The package carries the **same layer** as
[`usd/corpus/usdc/scene.usdc`](usd/corpus/usdc/scene.usdc); the golden
([`packages/asset-compiler-rust/src/tests/formats/usd/usdz_golden.rs`](../../../packages/asset-compiler-rust/src/tests/formats/usd/usdz_golden.rs))
compiles both, compares the second against the first — equality with the bare layer, checked on
the intermediate scene and the sidecar, is the real subject — then the first against
`expected.json`.

| file | what it pins |
| --- | --- |
| `scene.usdz` | the conforming package: entries stored as-is, payloads aligned on 64 bytes, one `usdc` layer and its texture in a subfolder — AOUSD requires stored, aligned entries so the layer and images read in place; relative URIs are not rewritten, images resolve from the extracted folder |
| `compressee.usdz` | a `deflate` entry: rejection `USDZ_LAYOUT_INVALID`, nothing extracted — a non-conforming package is refused by saying so, not read anyway |
| `sans-scene.usdz` | a package that does not open on a USD layer: rejection `USDZ_ROOT_LAYER_MISSING` |
| `deux-scenes.usdz` | two layers: a triangle first, a quadrilateral next. The package delivers the first, and the triangle count says so |

The root layer is neither guessed nor searched: AOUSD wants the package's **first** entry to be the
root layer, everything after it a resource, never a candidate scene; a package that does not open on
a USD layer does not say which scene it delivers, so it is refused under its own name. Regenerate
the three traps with `python3 traps.py` from `usdz/` (it reproduces the committed bytes).
`expected.json` also pins the `usdz` → `usd` chain, the two rejection codes and the two-layer
package's triangle count. Regenerate:

```sh
cargo test --release --locked --manifest-path packages/asset-compiler-rust/Cargo.toml --lib regenerate_the_usdz_fixture -- --ignored
```

## webp

The import policy admits WebP **lossless only**: a lossy stream is neither re-encoded nor decoded,
it is refused by name. `src/plugins/tests/webp.rs` compares the two writings of the same stream
**byte for byte** and checks five texels written in the clear, taken from Pillow's identical read
of both.

| file | container | what it puts under watch |
| --- | --- | --- |
| `sans-perte.webp` | `VP8L` alone | 256 × 256 RGBA8, zero alpha and opaque alpha mixed: nothing is filled by default nor premultiplied |
| `etendu-sans-perte.webp` | `VP8X` + `ICCP` + `VP8L` | the metadata chunks are walked without touching a pixel: the yielded bytes are those of the `VP8L` alone |
| `avec-perte.webp` | refused, `image-lossy-unsupported` | `VP8X` + `ALPH` + `VP8 `: the lossy stream is *behind* optional chunks, the driver must walk the container and not look at the first chunk |
| `anime.webp` | refused, `image-animation-unsupported` | `VP8X` + `ANIM` + `ANMF`: flattening an animation onto a frame chosen by default would be arbitrary, not a faithful read |
| `tronque.webp` | refused, `image-decode-failed` | 40 of 192 bytes: the size announced by `RIFF` exceeds what the file carries, an amputated stream is not handed to the decoder |

The derived files put `sans-perte.webp`'s `VP8L` chunk back into an extended container, then into
an animation image, and cut the file. The test adds a `VP8L` renamed `VP8 ` — the lossy stream
without an extended container, refused by the same path — and a RIFF header of another form type,
which the driver does not claim.

## zip

A container must change nothing about the scene it wraps, so the same glTF scene is here **inside**
its archive and **outside** it. The golden
(`packages/asset-compiler-rust/src/tests/formats/zip_golden.rs`) compiles both through the shared
harness, compares the second against the first — cache key included, which proves the two
compilations are one: the key serves only that equality, the real subject — then the first against
`expected.json`.

| file | what it pins |
| --- | --- |
| `scene.zip` | the archive: a single root folder `scene/`, which the driver traverses — a wrapping root must never become a scene level —, a `.gltf`, its external buffer `geometry.bin` (extracted and re-read in place, or the source manifest would not recompute identically) and `textures/checker.png` in a subfolder (relative URIs not rewritten, nothing flattened) |
| `hors-archive/` | the contents of `scene.zip`, extracted once and for all: the same scene without a container |
| `sortie-de-dossier.zip` | an entry `../escape.gltf`: escape from the extraction folder, refused `ARCHIVE_PATH_ESCAPE` |
| `tronquee.zip` | 31 of the 4,406 bytes of `scene.zip`: the central directory is missing, rejection `ARCHIVE_UNREADABLE` |
| `vide.zip` | the 22 bytes of an archive with no entry: rejection `ARCHIVE_EMPTY` |

Each trap is refused by its own code, nothing extracted; regenerate the two synthetic ones with
`sh traps.sh` from `zip/`. `expected.json` also pins the `zip` → inner driver chain and the
three rejection codes.
