# Input formats

The compiler accepts what marketplaces deliver (FAB, Unity Asset Store, Quixel, Sketchfab) without
third-party tools. Fidelity first: no loss added without a measured bound, no lossy format
re-encoded, sources never modified nor written beside. No proprietary format is read without an
established legal reading (this page is not legal advice): each reader is written in this
repository, its dependencies' licenses kept, no editor code or SDK reused, no protection bypassed.
An unknown or ambiguous source is refused with the list of accepted formats.

| Format | Driver | Reader and condition | Dropped, counted by code |
| --- | --- | --- | --- |
| glTF / GLB | `gltf` | Khronos standard; Draco and meshopt decoded | Nodes outside the rendered scene; quantized positions refused |
| FBX | `fbx` | MIT ufbx, pinned, never the Autodesk SDK | Cameras, area lights, procedural textures, UV transforms |
| OBJ / MTL | `obj` | Published specification, through ufbx ([fixture](../../tests/fixtures/formats/README.md#obj)) | MTL `Tr`, `illum`, `-o`, `-s`, `-bm` |
| USD / USDA / USDC | `usd` | AOUSD, TOST 1.0; `openusd` crate, pure Rust | Non-punctual lights, animation (one value kept) |
| USDZ | `usdz` | Stored, aligned ZIP container | As USD |
| Alembic | `alembic` | Open, BSD-3; Ogawa reader written here | All but static geometry |
| `.blend` | `blend` | Documented SDNA, no GPL imposed; reader written here | All but Blender 2.8–5.x meshes, UVs, instances, Principled BSDF |
| Maya ASCII | `ma` | Public MEL command docs; no script executed | Commands outside the read subset |
| Unity `.unity`, `.prefab`, `.mat`, `.meta` | `unity` | Documented YAML subset; data only | Scripts |
| `.unitypackage`, ZIP | `unitypackage`, `zip` | tar.gz and ZIP; each file keeps its license | Encrypted archives refused |
| PNG, JPEG, TGA, TIFF, BMP, GIF | one each | Open specifications | Animated GIF, BMP masks above 8 bits |
| OpenEXR, Radiance HDR | `exr`, `hdr` | BSD-3 `exr` crate; HDR reader written here; held in half-float | As a metal-roughness, normal, occlusion or height map |
| PSD / PSB | `psd` | Adobe's published specification | Layers: the flattened composite only |
| DDS, KTX2 | `dds`, `ktx2` | Documented containers; `basisu` Apache-2 | Undeclared codecs, KTX 1.0 |
| WebP | `webp` | Pure Rust `image-webp`, libwebp patent license | Lossy streams, animation |

Not read: `.uasset` / `.umap`, `.max`, `.mb`, native SpeedTree, Substance `.sbsar`, CAD (`.step`,
`.3dm`), point clouds, HEIC. Export to one of the formats above.

## glTF buffers, primitive modes and required extensions

A `.gltf` buffer is a `data:application/octet-stream;base64,…` (or `application/gltf-buffer`) URI of
exactly its `byteLength`, or a relative path, `%XX`-escaped, in the file's folder or below it
(`buffers/scene.bin`); a path that climbs out of the folder is refused. A triangle strip or fan
primitive is read as the list of triangles it draws; a points or lines primitive draws no surface
and is left out, the rest of the file imported, counted under `primitive-mode-not-imported` in the
import report. A file whose `extensionsRequired` names an extension no reader implements is refused
(`UNSUPPORTED_EXTENSION`, naming them); one that only lists such an extension in `extensionsUsed` is
read and counts them under `extension-not-implemented`. A file whose `asset` names a version below
2.0, or a `minVersion` above 2.0, is refused (`UNSUPPORTED_VERSION`).

```json
{ "asset": { "version": "2.0" },
  "buffers": [{ "uri": "buffers/scene%20part.bin", "byteLength": 4096 },
              { "uri": "data:application/octet-stream;base64,AAECAw==", "byteLength": 4 }],
  "extensionsRequired": ["KHR_materials_unlit"] }
```

## Polygon faces

The USD, Blender, Alembic and Maya readers share one cut for faces of more than three corners: a
strictly convex ring becomes a fan, any other is ear-clipped in its own plane so a concave face
keeps its outline, and a ring the ears cannot finish falls back on the fan, counted under
`ngon-untriangulable` (`plugins/scene/ngon.rs`).

## Content Licenses — Independent of Format

Audit a local asset and license manifest offline with `pnpm audit:assets <manifest.json>`
(`scripts/release/asset-license-manifest.ts` holds its shape).

- FAB Standard License: other tools and engines permitted, standalone asset redistribution
  prohibited; keep the purchase EULA.
- Quixel Megascans under a single-engine plan: unusable in Trillion3D.
- Unity Asset Store: other engines permitted, not a product whose purpose is raw asset distribution.
- Sketchfab: per-download license (CC-BY requires attribution and a change notice).
- Demos and public repository tests: assets owned outright or under a redistributable license.
