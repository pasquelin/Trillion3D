# Format fixtures

The small source files the native compiler's tests read, one folder per input format or per
correction case: what each holds, then where it comes from and its licence in the
[table](#provenance-and-licences). How a format adds its fixture, and what a golden's
`expected.json` pins:
[`docs/COMPILER.md`, "Adding a format"](../../../docs/COMPILER.md#adding-a-format).
Test paths below are relative to `packages/asset-compiler-rust/`.

## Provenance and licences

- **Corpus** is the local Trillion3D corpus under `tests/assets/`, off git; a file taken from it is
  copied here unchanged, so the golden holds without it.
- **Written here** means written byte by byte in this repository from the public specification
  named in the table: no editor tool, no SDK, no third-party content.
- **Traps** (files the driver must refuse) come from a tool other than the crate the driver reads
  with.
- **Licences.** CC0-1.0 is <https://creativecommons.org/publicdomain/zero/1.0/>. A file with
  "repository" falls under the repository's [`LICENSE`](../../../LICENSE) (PolyForm Noncommercial
  1.0.0, © 2026 Alban Pasquelin). A package's contents keep their author's licence. Reader crates:
  [`THIRD_PARTY_NOTICES.md`](../../../THIRD_PARTY_NOTICES.md#image-and-texture-readers-of-the-native-compiler).
  A folder without `LICENSE.txt` takes its licence from this table.

| folder | files | licence | source |
| --- | --- | --- | --- |
| `alembic/procedural-static` | `scene.abc` | CC0-1.0, `LICENSE.txt` | corpus `alembic/procedural-static`, by `tests/assets/tools/model_formats_blender.py` (Blender 5.2.1 LTS, Alembic 1.8.3) |
| `alembic/limites` | `hdf5.abc`, `truncated.abc`, `cases.abc` | CC0-1.0, `LICENSE.txt` | written here from the Alembic specification |
| `blend/procedural-materials` | `scene.blend` | CC0-1.0, `LICENSE.txt` | corpus `blend/procedural-materials` (Blender 5.2.1 LTS) |
| `blend/limites` | `truncated.blend` | CC0-1.0, `LICENSE.txt` | the first 4,096 bytes of the unwrapped `procedural-materials` scene |
| `blend/layouts` | `blender-3.3.blend`, `blender-4.4.blend`, `blender-5.2.blend` | CC0-1.0, `LICENSE.txt` | [`layouts.py`](blend/layouts/layouts.py), run by Blender 3.3.21, 4.4.3 and 5.2.1 LTS |
| `bmp` | the readable and header-refused `.bmp` | CC0-1.0, [`LICENSE.txt`](bmp/LICENSE.txt) | written here from Microsoft's "Bitmap Header Types" |
| `bmp` | `tronque.bmp` | CC0-1.0, same notice | corpus `limites/truncated-bmp/truncated.bmp` |
| `bmp`, `gif`, `psd` | `scene.gltf`, `scene.bin` | CC0-1.0 | the [`hdr`](#hdr) quad, only its image changed |
| `coplanar` | five `<name>/<name>.gltf`, `.bin`, `expected.json` | repository | written here |
| `dds` | `bc1-mips.dds`, `tronque.dds` | CC0-1.0 | corpus `textures/dds-matrix/bc1-mips.dds`, `limites/truncated-dds/truncated.dds`, by `tests/assets/tools/texture_assets.py` |
| `exr` | the `.exr`, `scene.gltf`, `scene.bin` | CC0-1.0 | written here from ASF "OpenEXR File Layout" and "Technical Introduction to OpenEXR" |
| `gif` | the readable `.gif`, `anime.gif` | CC0-1.0, [`LICENSE.txt`](gif/LICENSE.txt) | written here from CompuServe "Graphics Interchange Format, Version 89a" |
| `gif` | `tronque.gif` | CC0-1.0, same notice | corpus `limites/truncated-gif/truncated.gif` |
| `gltf/compressed-box` | `Box.gltf`, `Box.bin` | **CC-BY-4.0**, [`LICENSE.txt`](gltf/compressed-box/LICENSE.txt) | unmodified, Khronos glTF Sample Assets [`Models/Box/glTF-Draco`](https://github.com/KhronosGroup/glTF-Sample-Assets/tree/main/Models/Box/glTF-Draco), © 2017 Cesium |
| `gltf-world` | `world.gltf`, `world.bin` | CC0-1.0 | written here |
| `hdr` | the `.hdr`, `scene.gltf`, `scene.bin` | CC0-1.0 | written here from the Radiance RGBE format |
| `import-fbx` | `riviere.fbx`, `bend.fbx` | repository | ASCII FBX 7400 written here |
| `ktx2` | `basis.ktx2` | CC0-1.0, [`LICENSE.txt`](ktx2/LICENSE.txt) | corpus `textures/ktx2-matrix/basis.ktx2`, by `ktx create` / libktx 4.4.2 |
| `ktx2` | `uastc.ktx2` | CC0-1.0, same notice | cut from corpus `textures/ktx2-matrix/uastc.ktx2`, no re-encoding |
| `ktx2` | `base.ktx2`, `base-zstd.ktx2`, `tronque.ktx2`, `scene.*`, `expected.json` | CC0-1.0, same notice | written here from Khronos "KTX File Format Specification, version 2.0"; `tronque.ktx2` is forty bytes of `basis.ktx2` |
| `ma` | `minuscule/scene.ma` | CC0-1.0, [`LICENSE.txt`](ma/LICENSE.txt) | written here from Autodesk's public MEL command documentation |
| `ma` | `minuscule/textures/checker.png` | CC0-1.0, same notice | corpus, as `usd/minuscule/textures/checker.png` |
| `material-classes` | three `.gltf` + `.bin` | repository | written here |
| `obj` | `minuscule/scene.obj`, `scene.mtl`, `textures/*.png` | CC0-1.0, [`LICENSE.txt`](obj/LICENSE.txt) | written here from the OBJ and MTL specification; PNGs by a minimal PNG encoder |
| `png` | the `.png` | CC0-1.0 | written here from W3C "PNG Specification (Second Edition)" (ISO/IEC 15948:2004), W3C "APNG Specification" and "ICC.1:2001-04" |
| `previews` | `atlas-couleur/` | repository | generated here by `src/tests/textures/previews_source.rs` |
| `previews` | `coverage-alpha.json`, `coverage-filtered.json` | repository | written here |
| `psd` | the `.psd`, `.psb` | CC0-1.0, [`LICENSE.txt`](psd/LICENSE.txt) | written here from Adobe's "Photoshop File Formats Specification" |
| `tga` | the readable `.tga` | CC0-1.0 | written here from "Truevision TGA File Format Specification, Version 2.0" |
| `tga` | `tronque.tga` | CC0-1.0 | corpus `limites/truncated-tga/truncated.tga` |
| `tiff` | `rgb8-brut-ii`, `rgb8-brut-mm`, `rgb8-plans-separes`, `rgba8-alpha-associe` | CC0-1.0, [`LICENSE.txt`](tiff/LICENSE.txt) | written here from "TIFF Revision 6.0" |
| `tiff` | `rgb8-lzw`, `rgb8-deflate`, `rgb8-packbits`, `rgb8-jpeg`, `rgba8-brut`, `gris8-brut`, `palette8`, `gris16`, `deux-pages`, `ccitt-g4` | CC0-1.0, same notice | Pillow 12.2.0, an encoder outside the crate the driver reads with |
| `tiff` | `tronque.tif` | CC0-1.0, same notice | corpus `limites/truncated-tif/truncated.tif` |
| `unity/cc0-import-project` | Unity project | CC0-1.0, `LICENSE.txt` | corpus `unity/cc0-import-project` (`tests/assets/tools/unity_assets.py`), plus objects written here |
| `unity/limites` | `truncated.unity` | CC0-1.0, `LICENSE.txt` | corpus `limites/truncated-unity` |
| `unitypackage` | `test.unitypackage`, `hors-paquet/` | CC0-1.0, [`LICENSE.txt`](unitypackage/LICENSE.txt) | corpus `unity/cc0-unitypackage` (`tests/assets/tools/unity_assets.py`) |
| `unitypackage` | `tronque.unitypackage` | CC0-1.0, same notice | corpus `limites/truncated-unitypackage` |
| `unitypackage` | `sortie-de-dossier.unitypackage`, `vide.unitypackage` | CC0-1.0, same notice | traps, [`traps.sh`](unitypackage/traps.sh) (Python `tarfile`) |
| `usd` | `corpus/usda`, `corpus/usdc` | CC0-1.0, [`LICENSE.txt`](usd/LICENSE.txt) | corpus `usd/procedural-usda`, `usd/procedural-usdc` (`model_formats_blender.py`, `model_formats_text.py`) |
| `usd` | `minuscule/scene.usda`, `minuscule/textures/checker.png` | CC0-1.0, same notice | scene written here from the AOUSD specification; texture from the corpus |
| `usdz` | `scene.usdz` | CC0-1.0, [`LICENSE.txt`](usdz/LICENSE.txt) | corpus `usd/procedural-usdz` (`model_formats_blender.py`) |
| `usdz` | `compressee.usdz`, `sans-scene.usdz`, `deux-scenes.usdz` | CC0-1.0, same notice | traps, [`traps.py`](usdz/traps.py) (Python `zipfile`) |
| `webp` | `sans-perte.webp`, `avec-perte.webp` | CC0-1.0, [`LICENSE.txt`](webp/LICENSE.txt) | corpus `textures/legacy-web-matrix/lossless.webp`, `lossy.webp` (`texture_assets.py`) |
| `webp` | `etendu-sans-perte.webp`, `anime.webp`, `tronque.webp` | CC0-1.0, same notice | `sans-perte.webp`'s RIFF chunks reassembled per the "WebP Container Specification", no pixel rewritten |
| `zip` | `scene.zip`, `tronquee.zip`, `hors-archive/` | CC0-1.0, [`LICENSE.txt`](zip/LICENSE.txt) | corpus `archives/gltf-nested-zip`, `limites/truncated-zip` |
| `zip` | `sortie-de-dossier.zip`, `vide.zip` | CC0-1.0, same notice | traps, [`traps.sh`](zip/traps.sh) (Python `zipfile`) |

Corpus paths are relative to `tests/assets/`.

## alembic

- `procedural-static/scene.abc`: a root `Xform` and three `Xform` at x = 0, 3, 6, each over the same
  `PolyMesh` cube with three `FaceSet` (`Emissive`, `Opaque`, `Transparent`); golden
  `src/tests/formats/alembic_golden.rs`.
- `limites/`: `hdf5.abc` (the HDF5 container, refused), `truncated.abc` (an Ogawa header whose root
  is past the end), `cases.abc` (an animated mesh, a subdivision surface, curves, meshes without
  normals, a non-inheriting `Xform`, each counted).

## blend

- `procedural-materials/scene.blend`, Zstandard-compressed: three objects instancing one `Cube`
  mesh under an empty root, three `Principled BSDF` materials and one packed PNG; golden
  `src/tests/formats/blend_golden.rs`.
- `limites/truncated.blend`: a valid header and a block that is not whole.
- `layouts/`: one scene saved by Blender 3.3, 4.4 and 5.2, each storing meshes its own way;
  `src/tests/formats/blend_layouts.rs` proves the three cook to the same scene. Regenerate with
  `Blender --background --factory-startup --python layouts.py -- <out.blend>`.

Pre-2.8, 32-bit and big-endian files have no fixture: their rejections are written in
`src/plugins/scene/blend/tests/surgery.rs`.

## bmp

Eight readable 4 × 2 files (24- and 32-bit, palettes of 8, 4 and 1 bits, RLE8,
5-5-5 and 5-6-5), two refused by name (`masques-10-bits.bmp`, `jpeg-embarque.bmp`) and
`tronque.bmp`. Tests: `src/plugins/tests/bmp.rs`; `src/tests/textures/bmp_gif_golden.rs` compiles
`scene.gltf` against `expected.json`.

## coplanar

Five minimal scenes (`blend-overlay`, `full-overlap`, `masked-overlay`, `partial-overlap`,
`three-stack`), each two or three overlapping meshes triangulated differently, with their
`expected.json`; golden `src/tests/coplanar/goldens.rs`.

## dds

`bc1-mips.dds` (256 × 256, nine BC1 levels) and `tronque.dds`. Per-codec blocks are written in
`src/plugins/tests/dds/bytes.rs`; tests in `src/plugins/tests/dds.rs`.

## exr

`demi.exr` (2 × 2 half-float RGBA), `flottant.exr` (the same RGB in single float), three refused
(`canaux-xyz.exr`, `profond.exr`, `multi-parties.exr`), `tronque.exr`, and a quad `scene.gltf`
textured by `demi.exr`. Tests: `src/plugins/tests/exr.rs`, `src/tests/textures/float_golden.rs`.

## gif

Three readable files with one image (global palette, local palette, transparent index),
`anime.gif` (refused) and `tronque.gif`. Tests: `src/plugins/tests/gif.rs`,
`src/tests/textures/bmp_gif_golden.rs`.

## gltf

`compressed-box/`: Khronos's Draco `Box` (`KHR_draco_mesh_compression`), unmodified; read by
`src/compressed/tests.rs`, `src/compressed/container_tests.rs` and
`src/tests/formats/compressed_gltf/sources.rs`. Attribution: *Box, copyright 2017 Cesium, licensed
under Creative Commons Attribution 4.0 International*, from the Khronos glTF Sample Assets
repository.

## gltf-world

One triangle placed by nested and instanced nodes (`EXT_mesh_gpu_instancing`) and a
`KHR_lights_punctual` light, so each cooked position checks against the world position the file
declares; `src/tests/formats/gltf_world.rs`.

## hdr

`plat.hdr`, `rle-ancienne.hdr`, `signature-rgbe.hdr` (one 4 × 2 image, three writings),
`rle-nouvelle.hdr` (8 × 1, per-component RLE), two refused (`xyze.hdr`, `bas-en-haut.hdr`),
`tronque.hdr`, and a quad `scene.gltf` textured by `plat.hdr`. Tests: `src/plugins/tests/hdr.rs`,
`src/tests/textures/float_golden.rs`.

## import-fbx

- `riviere.fbx`: a quad with a `phong` material whose opacity is carried by `TransparentColor`;
  `src/tests/formats/import_opacity.rs` writes its two images beside a throwaway copy.
- `bend.fbx`: a triangle skinned to one bone, with a blend shape and an animation stack;
  `src/tests/formats/fbx_motion.rs`, `src/import/motion_sampling_tests.rs`.

## ktx2

`base.ktx2` (4 × 4 RGBA8 sRGB), `base-zstd.ktx2` (the same level under Zstandard), `uastc.ktx2`
(16 × 16 UASTC), `basis.ktx2` (256 × 256 ETC1S under BasisLZ), `tronque.ktx2`, and a three-quad
`scene.gltf` with its `expected.json`. Other `vkFormat` cases are written in
`src/plugins/tests/ktx2/bytes.rs`. Tests: `src/plugins/tests/ktx2.rs`,
`src/tests/textures/ktx2_golden.rs`.

## ma

`minuscule/scene.ma`: a `transform` hierarchy, a two-quad `mesh` with two shaded face groups, an
instance by `parent -add`, a `lambert` and a `standardSurface` textured by
`minuscule/textures/checker.png`, a camera and a `python` command that must never run. Golden
`src/tests/formats/ma/golden.rs`; driver internals in `src/plugins/scene/ma/tests.rs`.

## material-classes

Minimal scenes carrying the material classes the engine distinguishes, no texture:
`classes-materiaux` (opaque, `MASK` cutout, `BLEND`), `transmission` (a
`KHR_materials_transmission` water plane over a ground and blocks) and `emetteur-sphere` (a point
lamp inside an emissive envelope, with one occluder inside its radius and one outside), read by
`src/tests/lights/lamp_emitter.rs`.

## obj

`minuscule/scene.obj`: a quad and a pentagon under two `usemtl`. `minuscule/scene.mtl` declares
every statement a library can (`Ka`, `Kd`, `Ks`, `Ns`, `Ni`, `d`, `Ke`, `map_Ka`, `map_Kd`,
`map_d`, `norm`, `map_Bump`, `map_Ke`, options `-s`, `-o`, `-bm`, `-clamp`), over six 2 × 2
`textures/*.png`. Golden `src/tests/formats/obj_golden.rs`; modified sources in
`src/tests/formats/obj_mtl.rs`.

## png

One 2 × 2 drawing in `rgb8.png` and `palette4.png`, `rgb16.png` (refused), `anime.png` (APNG, two
frames) and `icc-autre.png`, `icc-srgb.png` (`rgb8.png` with an `iCCP` chunk); tests in
`src/plugins/tests/png.rs`.

## previews

- `atlas-couleur/`: four quads (opaque, `MASK`, `BLEND`, emissive) over three textures — a PNG by
  `uri`, one embedded by `bufferView`, a JPEG shared by two materials — with `expected.json`, all
  generated by `src/tests/textures/previews_source.rs`.
- `coverage-alpha.json`: coverage-preserving alpha cases ([`docs/FORMAT.md`,
  "Textures"](../../../docs/FORMAT.md#textures)), read by
  `src/texture_preview/tests/coverage_alpha.rs` and
  `packages/sdk-browser/src/texture/coverageRule.test.ts`.
- `coverage-filtered.json`: coverage of a bilinearly filtered cut per level, read by
  `src/texture_preview/tests/coverage_filtered.rs`.

## psd

Six readable composites (8-bit RGB raw and PackBits, RGB plus an extra plane, grey, grey plus an
extra plane, PSB), five refused by name (`seize-bits.psd`, `cmjn.psd`, `canaux-en-trop.psd`,
`zip.psd`, `sans-composite.psd`) and `tronque.psd`; `scene.gltf` is a quad textured by
`rgb-brut.psd`. Tests: `src/plugins/tests/psd.rs`, `src/plugins/tests/icc.rs`,
`src/tests/textures/psd_golden.rs`.

## tga

Six readable profiles (raw and RLE, 24 and 32 bits, top and bottom origins, 8-bit
palette, 8-bit grey) and `tronque.tga`; tests in `src/plugins/tests/tga.rs`.

## tiff

Seven readable profiles (8-bit RGB raw in both byte orders, LZW, Deflate, PackBits, RGBA, grey),
seven refused by name (`gris16`, `palette8`, `rgb8-jpeg`, `ccitt-g4`, `deux-pages`,
`rgb8-plans-separes`, `rgba8-alpha-associe`) and `tronque.tif`; tests in
`src/plugins/tests/tiff.rs`.

## unity

- `cc0-import-project/`: a minimal Unity project — `Assets/Map.unity`, five materials, the
  `LODProp.fbx` model, the `Prop_Standard` prefab and a TGA texture, each with its `.meta`. The
  scene adds model references by GUID and by sub-mesh `fileID`, an import scale, a lamp, cutout
  and glass materials, an inactive object, `fileID`s beyond 2^53 and two edited prefab instances.
  Golden `src/tests/formats/unity/golden.rs`, with `expected.json`.
- `limites/truncated.unity`: the first 31 bytes of `Map.unity`.

## unitypackage

`test.unitypackage` and `hors-paquet/`, the same project inside and outside its container (the
package's C# script excepted), and three traps (`sortie-de-dossier.unitypackage`,
`tronque.unitypackage`, `vide.unitypackage`). Golden
`src/tests/formats/unity/package_golden.rs`; regenerate the synthetic traps with `sh traps.sh`
from this folder.

## usd

- `minuscule/scene.usda`: an `Xform` hierarchy, a two-quad `Mesh` with a `GeomSubset`, an opaque
  and a translucent textured `UsdPreviewSurface`, over `minuscule/textures/checker.png`.
- `corpus/usda/scene.usda`, `corpus/usdc/scene.usdc`: the same scene in text and binary, which must
  yield the same intermediate scene.

Golden `src/tests/formats/usd/golden.rs`; `driver.rs`, `report.rs` and `refusal.rs` beside it.

## usdz

`scene.usdz` wraps the same layer as `usd/corpus/usdc/scene.usdc`; `compressee.usdz`,
`sans-scene.usdz` and `deux-scenes.usdz` are traps, regenerated with `python3 traps.py` from this
folder. Golden `src/tests/formats/usd/usdz_golden.rs`.

## webp

`sans-perte.webp` (256 × 256 lossless), `etendu-sans-perte.webp` (the same `VP8L` in an extended
container), two refused (`avec-perte.webp`, `anime.webp`) and `tronque.webp`; tests in
`src/plugins/tests/webp.rs`.

## zip

`scene.zip` and `hors-archive/`, the same glTF scene inside and outside its archive, and three traps
(`sortie-de-dossier.zip`, `tronquee.zip`, `vide.zip`). Golden `src/tests/formats/zip_golden.rs`;
regenerate the synthetic traps with `sh traps.sh` from this folder.
