# Compiler error codes

The codes `trillion3d-compiler` reports, by driver. Exit codes, stdout on failure and message
prefixes:
[COMPILER.md](COMPILER.md#exit-codes-and-error-codes). A ceiling exceeded is refused before
allocating.

## Global

| `code` | Meaning |
| --- | --- |
| `INVALID_ARGS`, `INVALID_BATCH` | Command line or batch file rejected before any work |
| `INVALID_OPTIONS` | Scope, budgets, threads, base URL or simplification out of range |
| `INVALID_GLTF`, `INVALID_JSON`, `UNSUPPORTED_ACCESSOR`, `BUFFER_OUT_OF_BOUNDS` | Source glTF rejected (also a directory with nothing importable, and an `accessor.count` whose dense expansion no machine can address) |
| `SOURCE_NOT_READY`, `UNSUPPORTED_FORMAT`, `SOURCE_HASH_MISMATCH` | Source `manifest.json` not ready, wrong format version, or files changed since it was written |
| `IMPORT_ERROR`, `IMPORT_UNSUPPORTED_VERSION`, `IMPORT_OUT_OF_MEMORY`, `IMPORT_IO_ERROR`, `IMPORT_EMPTY` | FBX/OBJ import failed, or produced no visible mesh |
| `EMPTY_SLICE` | No mesh instance fits the `slice` budget |
| `RAM_ADMISSION_BUDGET_EXCEEDED` | Estimated working set above `RAM_MB`, dense expansion of every decoded accessor counted; also a dense expansion the allocator refuses |
| `INCOMPLETE_CLUSTER_PARTITION`, `INVALID_CLUSTER_PARTITION` | Internal consistency check failed on level-0 clusters |
| `DAG_ERROR_NOT_MONOTONE`, `DAG_NORMAL_DEVIATION` | A cluster's error above its parent's, or a coarse cluster's normal deviation past its group's bound ([checks](COMPILER.md#invocation)) |
| `PAGE_DEPENDENCY_BOUND` | A cluster whose parents alone span more bundles than `streams.dependencyBound` ([bundles](COMPILER.md#invocation)); names the mesh, the primitive and the page |
| `INVALID_PAGE_DEPENDENCIES` | A bundle dependency list with a cycle, missing its pages' parents, not closed, not reaching the root cover, or not empty on a pinned bundle ([bundles](COMPILER.md#invocation)) |
| `CANCELLED` | Stopped on a cancel request |
| `CACHE_LOCKED` | Another compilation holds `<cache>/native/.lock`, an operating-system file lock held for the whole compile. It follows the process, not the file: released when its owner ends, killed or not, so no cache stays blocked; the file is never deleted, only the hold counts. The newcomer waits 30 s (`TRILLION3D_CACHE_LOCK_WAIT_MS`) before this refusal; a cancel during the wait ends it with `CANCELLED` |
| `IO_ERROR`, `THREAD_POOL_ERROR` | Filesystem or thread pool failure |
| `autonomous-scene-animated` | The source declares node animation, skinning or morph weights, which the autonomous glTF (accessors rebuilt from the cache's pages) cannot carry: the mode is refused for this cache (`autonomousScene: null`) rather than written frozen. Once per job; does not fail the job |
| `texture-level-write-failed` | A baked mip level could not be written under `native/textures/` (disk full, directory not writable); the entry keeps its sidecar tail with `bakedLevels = 0`, so the engine loads the source image. Per image; does not fail the job |

## Archives

| `code` | Meaning |
| --- | --- |
| `ARCHIVE_PATH_ESCAPE` | ZIP entry path leaves the extraction root (absolute path, `..`, named volume, reversed separator) |
| `ARCHIVE_SYMLINK` | ZIP entry is a symlink; never followed |
| `ARCHIVE_ENCRYPTED` | ZIP entry is encrypted; refused, never bypassed |
| `ARCHIVE_UNREADABLE` | ZIP archive truncated or corrupted |
| `ARCHIVE_EMPTY` | ZIP archive carries no entry |
| `ARCHIVE_TOO_MANY_ENTRIES` | ZIP archive exceeds 20,000 entries |
| `ARCHIVE_TOO_LARGE` | ZIP archive exceeds 8 GiB decompressed |

## Lights and OBJ/MTL materials

| `code` | Meaning |
| --- | --- |
| `light-index-out-of-bounds` | A node names a `KHR_lights_punctual` light the document does not declare; the lamp is left out |
| `light-invalid-transform` | The lamp's world matrix holds a non-finite number |
| `light-unsupported-type` | A lamp neither `point`, `spot` nor `directional` |
| `light-non-positive-intensity` | Intensity zero, negative or non-finite |
| `light-degenerate-axis` | A `spot` or `directional` lamp whose node transform collapses its −Z axis |
| `light-emitter-radius-derived` | Counted, not rejected: `emitterRadius` measured on the emissive body bound to the lamp, not read from the source |
| `light-emitter-radius-invalid` | A radius, declared or measured, not finite, not strictly positive, or not strictly below `range`; the field is omitted, the lamp kept |
| `material-library-missing` | A cited material library (an OBJ `mtllib`) could not be opened; every material takes its defaults |
| `material-library-truncated` | The material library's last line is unterminated, cut mid-declaration; the incomplete value parsed is kept |
| `material-specular-color` | A specular colour or map (`Ks`, `map_Ks`), which glTF's metallic-roughness model has no room for; **not** turned into metalness, a different model |
| `material-specular-ior` | An index of refraction (`Ni`) other than glTF's default 1.5 |
| `material-ambient-color` | An ambient colour or map (`Ka`, `map_Ka`) that became neither the occlusion nor the base-colour texture; glTF has no ambient term |
| `material-bump-map` | A bump map (`bump`, `map_Bump`) naming another file than the normal map kept; the normal map wins and the height map is dropped |
| `texture-offset`, `texture-scale` | A map's `-o` or `-s` option; would need `KHR_texture_transform`, which the glTF writer does not emit |
| `texture-bump-scale` | A map's `-bm` option; glTF carries no relief strength |

## Blender

| `code` | Meaning |
| --- | --- |
| `blend-header-invalid` | File starts neither with `BLENDER` nor with a gzip or Zstandard frame, or its header does not read back |
| `blend-pointer-size-unsupported` | Written with 32-bit pointers; only 64-bit files are read |
| `blend-endianness-unsupported` | Big-endian; only little-endian files are read |
| `blend-block-header-unsupported` | A block-header variant outside the one this reader describes |
| `blend-truncated` | The file, or its compressed frame, ends inside a block |
| `blend-too-large` | Needs more than the job's `ramBudgetMb`: a gzip or Zstandard file unpacking past it (the message names the least bytes needed), a block index not fitting in what is left, or a packed image or mesh taking the scene binary past it (named, with its bytes); a bare file is mapped in place, its size never counted. Also a mesh announcing more vertices or corners than this reader reads |
| `blend-dna-invalid` | No `DNA1` block, or its self-description does not read back |
| `blend-mesh-layout-unsupported` | A mesh in none of the known layouts — Blender 5's attribute store, the `CustomData` layers of 3.5 to 4.x, the `MVert`/`MPoly`/`MLoop` structures of 2.8 to 3.4 — (no `position`, no `.corner_vert`, or unreadable face offsets); refused, never guessed |
| `blend-mesh-invalid` | A mesh corner points outside its own vertices |
| `blend-collection-instance-unsupported` | An object instancing a collection; per object, does not fail the job |
| `blend-modifier-not-applied` | Modifiers, evaluated by Blender and not stored: the base mesh is exported |
| `blend-mesh-missing` | A mesh object pointing at non-mesh data, or nothing |
| `blend-alpha-texture-unsupported` | `Alpha` from an image the base colour does not carry, or a computed node; glTF reads opacity only from the base-colour texture's alpha, so the declared factor is kept |
| `blend-texture-channel-unsupported` | `Alpha` from a channel of the base-colour image other than its alpha; reading it there would recompose bytes, so the declared factor is kept |
| `blend-surface-node-unsupported` | The active `Material Output` is driven by something other than a `Principled BSDF`, or nothing; the material block's own values are kept |
| `blend-shader-input-unconverted` | A Principled BSDF input fed by a node other than an image texture (or a normal map over one); the declared value is kept exactly |
| `blend-emission-clamped` | Emission colour × strength above 1, which `emissiveFactor` cannot carry; clamped |
| `blend-image-format` | An image file the image registry cannot decode; the scene continues without it |
| `blend-image-outside-source` | An image outside the served root with no packed bytes; not copied beside the scene |
| `blend-object-material-override-unconverted` | An object replacing a mesh material slot; the mesh's material is kept |
| `blend-ngon-untriangulable` | A face the ear-clipping cut could not finish ([Polygon faces](COMPILER.md#polygon-faces)): self-crossing, or planeless (every corner collinear, zero area); it falls back to the fan from its first corner, which may overfill its outline |
| `blend-extra-scenes` | More than one scene; only the active scene's objects are exported |
| `blend-object-outside-scene` | A mesh object no collection of the active scene holds — left over, in another scene, or in a collection the active view layer excludes; not exported |
| `blend-light-type-unsupported` | A lamp type not converted — the `hemi` of files before Blender 2.8, or any type outside point, sun, spot and area; not exported |
| `blend-lamp-missing` | A lamp object pointing at non-`Lamp` data, or nothing; not exported |

## Images

Image codes are report reasons, per texture: an unreadable texture falls back to white and never
fails the job.

| `code` | Meaning |
| --- | --- |
| `image-lossy-unsupported` | A WebP `VP8 ` (lossy) stream, refused before decoding: the fidelity policy admits WebP lossless only |
| `image-animation-unsupported` | An `ANIM`/`ANMF` chunk (WebP) or a second image descriptor (GIF): an animation is not a texture, refused rather than flattened to a chosen frame |
| `image-animation-first-frame` | A PNG `acTL` chunk (an APNG of several frames): the default image, the one the APNG specification places in `IDAT`, is delivered and the animation counted |
| `image-icc-profile-ignored` | An embedded colour profile — PNG `iCCP`, JPEG `ICC_PROFILE` APP2 segment, Photoshop image resource 1039 — that the sRGB output, with no colour management, does not carry; a profile naming itself sRGB counts nothing |
| `image-transfer-unsupported` | A PNG `gAMA` neither 45455 (sRGB) nor 100000 (linear), with no `iCCP` or `sRGB` chunk overriding it; treated as sRGB, the convention for a silent file |
| `image-profile-unsupported` | TIFF read, its profile or codec declined |
| `image-depth-unsupported` | A bit depth the `Rgba8` contract cannot carry (PNG or TIFF 16 bits per channel, DDS 16-bit codecs); refused before decoding rather than narrowed to 8 bits |
| `image-too-large` | Over the allocation ceiling once expanded to RGBA8 (width x height x 4, checked before any pixel is decoded); decoded by no `image`-crate plugin |
| `image-float-unsupported` | The `RgbaF32` variant (OpenEXR, Radiance HDR) returned to an `Rgba8`-only consumer (the RGBA8 sRGB previews); refused by name rather than tone-mapped |
| `bmp-depth-unsupported` | A BMP bit count outside those carried losslessly to RGBA8 (1, 2, 4, 8, 16, 24, 32) |
| `bmp-bitfields-lossy` | A `BI_BITFIELDS` mask wider than eight bits per channel (10-10-10, for instance), which decoding would narrow; refused before decoding |
| `bmp-embedded-codec-unsupported` | `BI_JPEG` or `BI_PNG`: another format wrapped, which has its own plugin; unwrapping it here would bypass the router |
| `bmp-compression-unsupported` | A compression outside the read format (`BI_ALPHABITFIELDS`, the CMYK variants) |
| `dds-header-truncated` | Shorter than `DDS_HEADER`/`DDS_PIXELFORMAT`/`DDS_HEADER_DXT10` require |
| `dds-header-invalid` | Header out of domain (false announced size, zero dimension, absurd mip count) |
| `dds-codec-unsupported` | A codec outside the declared list (BC6H float, signed variants, `_TYPELESS`, 16-bit, YUV, premultiplied-alpha `DXT2`/`DXT4`) |
| `dds-layout-unsupported` | Not a plain surface (cube, volume, array, padded row pitch) |
| `dds-data-truncated` | Consistent header, announced pixels missing |
| `dds-image-too-large` | Over the decoder's allocation ceiling |
| `exr-header-invalid` | OpenEXR magic present, version field or header unreadable |
| `exr-deep-unsupported` | Deep data (a list of samples per pixel); flattening it would be a compositing choice |
| `exr-multipart-unsupported` | Several parts; nothing says which is the texture |
| `exr-channels-unsupported` | Channels other than `R`, `G`, `B` plus optional `A` — extra or other names, 32-bit integers, subsampling |
| `exr-image-too-large` | Over the allocation ceiling, counted at 16 bytes per pixel |
| `exr-data-unreadable` | Header in the subset, pixels unreadable (truncated file, unexpected compression, wrong chunk table) |
| `hdr-header-invalid` | Radiance HDR header missing, truncated, or without a valid resolution line |
| `hdr-format-unsupported` | Pixel encoding outside the subset (`32-bit_rle_xyze`, another colour space) |
| `hdr-orientation-unsupported` | Scan order other than `-Y height +X width`; accepting it would flip the image |
| `hdr-data-truncated` | Scanlines cut short, a run overflowing its line, or a packet not advancing |
| `hdr-image-too-large` | Over the allocation ceiling, counted at 16 bytes per pixel |
| `ktx2-header-truncated` | Shorter than its 80-byte header and level index require |
| `ktx2-header-invalid` | Header out of domain (bad identifier, zero width, unexpected `typeSize`, absurd level count, level starting inside the index) |
| `ktx2-format-unsupported` | A `vkFormat` outside the declared list (signed BC4/BC5/EAC, BC6H float, byte orders other than RGBA, channels wider than 8 bits, ASTC footprints other than 4x4) |
| `ktx2-layout-unsupported` | Not a plain surface (1D texture, volume, layer array, cubemap) |
| `ktx2-supercompression-unsupported` | A `supercompressionScheme` outside None, BasisLZ and Zstandard (ZLIB, unassigned numbers) |
| `ktx2-data-truncated` | Consistent header, an announced level or its Zstandard stream incomplete |
| `ktx2-image-too-large` | The image or its decompression buffer over the decoder's allocation ceiling |
| `ktx2-transcode-failed` | A Basis Universal payload the transcoder refuses (codec outside its list, video with cross-frame state, corrupt stream) |
| `ktx2-orientation-unsupported` | A `KTXorientation` not reducible to the contract's (top row first, left to right): starting leftwards, or a third dimension. `rd` (the contract's) and `ru` (flipped vertically) are handled; otherwise texels stay as stored |
| `ktx2-swizzle-unsupported` | A `KTXswizzle` other than the identity `rgba`; not applied |
| `psd-header-invalid` | Photoshop header out of domain (unknown version, non-zero reserved bytes, zero or over-ceiling side, channel count out of range or below its mode's colour channels) |
| `psd-depth-unsupported` | 1, 16 or 32 bits per channel, which `Rgba8` cannot hold; refused before decoding rather than narrowed |
| `psd-color-mode-unsupported` | A mode outside RGB and greyscale (bitmap, indexed, CMYK, multichannel, duotone, Lab), whose conversion would need a profile, matrix or palette chosen in the source's stead |
| `psd-channels-unsupported` | More than one plane beyond the mode's colour channels; nothing says which is transparency, a saved selection or a spot colour |
| `psd-alpha-channel-ignored` | One extra plane not declared transparency — the signed layer count Adobe's specification uses to say "the first alpha channel of the composite holds the document transparency" is absent or positive: a saved selection, read and written nowhere (taking it for transparency punched holes in the texture) |
| `psd-layers-flattened` | Layers present; only the flattened composite is delivered, since recomposing would redo the editor's blend modes, masks and effects |
| `psd-compression-unsupported` | A ZIP-compressed composite, outside the raw and PackBits subset |
| `psd-composite-missing` | The file stops before its merged image data; layers are not recomposed instead |
| `psd-data-truncated` | Announced planes missing, or a compressed row short of its width |
| `psd-image-too-large` | Over the decoder's allocation ceiling |

## USD

| `code` | Meaning |
| --- | --- |
| `USDZ_LAYOUT_INVALID` | A USDZ entry compressed, or its payload not on a 64-byte boundary; the AOUSD package layout requires every file stored as-is and aligned |
| `USDZ_ROOT_LAYER_MISSING` | The package's first entry, its root layer, is not a USD layer, so it names no scene; later entries are resources, never candidate scenes |
| `usd-point-instancer-unsupported` | `PointInstancer`: parallel arrays over an indexed prototype, not expanded; does not fail the job |
| `usd-curves-unsupported` | `BasisCurves`, `NurbsCurves` or `HermiteCurves`: not a surface |
| `usd-volume-unsupported` | `Volume` or an OpenVDB/Field3D asset: not a surface |
| `usd-skel-unsupported` | `SkelRoot`, `Skeleton`, `SkelAnimation` or `BlendShape`: no skinning carried |
| `usd-camera-unsupported` | `Camera`: the host places its own |
| `usd-light-unsupported` | A `UsdLux` schema with no glTF punctual equivalent — `DomeLight`, `CylinderLight`, `GeometryLight`, `PortalLight`, every `LightFilter`; sphere, disk, rect and distant lights are imported, with their declared emitter radius |
| `usd-patch-unsupported` | `NurbsPatch`: not tessellated |
| `usd-subdivision-unsupported` | A `Mesh` whose `subdivisionScheme` is not `none`: polygons carried **flat**, changing the silhouette |
| `usd-variants-unsupported` | A variant set; only the composed default selection is read |
| `usd-composition-invalid` | A reference, payload or sublayer left unresolved (missing file, unresolvable path) |
| `usd-animation-first-sample` | An attribute with no default read at its first time sample; the scene is frozen there |
| `usd-mesh-invalid` | Required `Mesh` arrays missing or contradictory (`faceVertexCounts` not landing on `faceVertexIndices`) |
| `usd-ngon-untriangulable` | As `blend-ngon-untriangulable` |
| `usd-xform-unsupported` | A transform op not composed (`!resetXformStack!`, the inverse of an arbitrary matrix, an unknown op type) |
| `usd-xform-invalid` | Non-finite transform; the node stays at identity |
| `usd-surface-unsupported` | A `Material` with no `UsdPreviewSurface` reachable from `outputs:surface` |
| `usd-texture-missing` | A texture file absent, outside the source directory, or of a format the image registry does not read |
| `usd-opacity-texture-unsupported` | An `opacity` bound to an image the base colour does not carry; glTF reads alpha only in `baseColorTexture` and two images do not merge without recomposing a third, so the written opacity is kept and the image dropped |
| `usd-texture-channel-unsupported` | An input bound to a channel glTF does not read there (metal from blue, roughness from green; an opacity on the base-colour image from alpha only); the map is carried as is, the opacity falls back to its written value |
| `usd-texture-unsupported` | A texture not bindable as is: a UV set other than `st`, a `<UDIM>` pattern, or split metallic/roughness maps |
| `usd-texture-wrap-unsupported` | A `UsdUVTexture` wrap mode glTF lacks — `black` (transparent border) or `useMetadata`; the texture repeats, USD's default |
| `usd-texture-scale-unsupported` | A `scale` or `bias` no glTF factor carries (glTF multiplies, never adds): a non-zero `bias`, a `scale` differing across colour channels, or an alpha `scale` other than one |
| `usd-texture-colour-space-unsupported` | A `sourceColorSpace` contrary to the input's role (colour declared `raw`, data declared `sRGB`); bytes pass through, never re-encoded |
| `usd-specular-workflow-unsupported` | A specular-workflow `UsdPreviewSurface` (`useSpecularWorkflow`, or a written `specularColor`), which metal and roughness do not carry |
| `usd-clearcoat-unsupported` | A clearcoat (`clearcoat` above zero, with its roughness): base glTF has no such layer |
| `usd-ior-unsupported` | An index of refraction other than 1.5: base glTF carries none |
| `usd-normal-value-unsupported` | A normal written as a value, no texture: glTF has no constant material normal, the geometry's stays |
| `usd-face-invalid` | A face its arrays do not carry: index outside the points or negative, under three corners, or a primvar index outside its array; dropped, never folded onto the first point |
| `usd-face-hole` | A face in `holeIndices`, invisible in OpenUSD before any subdivision, so removed, once per face, whatever `subdivisionScheme`; a hole index outside the face table counts as `usd-face-invalid` |

## Alembic

| `code` | Meaning |
| --- | --- |
| `alembic-hdf5-unsupported` | HDF5 container instead of Ogawa, refused by name; re-export as Ogawa |
| `alembic-archive-unfrozen` | No frozen flag: the writer never closed the archive, a work in progress |
| `alembic-version-unsupported` | A format version this reader does not read (a 16-bit big-endian field, `00 01` for version one) |
| `alembic-file-invalid` | No Ogawa header, block truncated, pointer outside the file, root group without its six blocks |
| `alembic-size-unsupported` | A group or data block beyond the plugin's allocation ceiling (4 Mi children, 1 GiB per block, 64 Mi face corners per mesh) |
| `alembic-values-invalid` | An `Xform` op stack that does not compose: an op outside the format's seven, or fewer values than it consumes |
| `alembic-topology-invalid` | A face index outside the position table, or more face corners declared than indices written |
| `alembic-*` report reasons | Counted under `unsupported`, never failing the job: `curves`, `points`, `nupatch`, `camera`, `light`, `object` and `instance` `-unsupported` for objects not converted; `subd-as-polygons` (a subdivision surface drawn as its flat polygons); `animation-ignored` (only the first of several samples read); `normals-missing`, `normals-dropped`, `uv-dropped` (parameters absent or inconsistent); `face-in-two-facesets`, `degenerate-face`, `ngon-untriangulable` (as `blend-ngon-untriangulable`), `faceset-invalid`, `mesh-invalid`, `mesh-empty`, `transform-invalid`, `transform-not-inherited`, `hierarchy-too-deep` |

## Maya ASCII

| `code` | Meaning |
| --- | --- |
| `ma-file-invalid` | Does not open with `//Maya ASCII`, is not valid UTF-8, or stops inside a quoted string; refused, not read up to the break |
| `ma-size-unsupported` | File above the 512 MiB ceiling, or an attribute index past the 16 Mi element ceiling |
| `ma-command-ignored:<command>` | A MEL command outside the read subset, named after the two dots. **No command is ever executed**: `python`, `eval`, `source` and every unknown one land here, their text going to the report only |
| `ma-node-ignored:<type>` | A node type not converted — camera, light, NURBS surface, joint, script node, tool node |
| `ma-attribute-unattached` | A `setAttr` with no node: no `createNode` or `select` before it, or the selection names no node of this file (Maya's defaults, `:time1` and the like, are not in the file) |
| `ma-attribute-invalid:<attribute>` | A `setAttr` whose values miss its index range, whose type is outside the read list, or whose index passes the element ceiling |
| `ma-parent-unsupported` | A `parent` not replayed: not naming known mesh shapes and a known transform, or removing instead of adding |
| `ma-name-ambiguous` | A name written without a path that several nodes carry, where Maya requires the full path (`\|A\|M`); the first node written answers |
| `ma-transform-invalid` | Non-finite `transform`; the node stays at identity |
| `ma-hierarchy-too-deep` | Deeper than 256 levels, a circular parent chain included; the branch is cut there without overflowing the stack |
| `ma-matrix-unsupported` | A matrix attribute (`offsetParentMatrix`) not written as its sixteen numbers (`setAttr`'s long `xform` form); not guessed, the node keeps its other attributes' pose |
| `ma-shape-intermediate` | An intermediate shape (`.io`), a construction-history input Maya never draws; left out. A shape with `visibility` off is left out too, counted as `invisible` like an invisible transform |
| `ma-mesh-invalid` | Contradictory `mesh` arrays: no `.vt`, a face corner outside the edge table, or an edge outside the vertex table |
| `ma-mesh-empty` | A `mesh` yielding no triangle: no face, or all degenerate |
| `ma-degenerate-face` | A face under three corners |
| `ma-face-hole-unsupported` | A face declaring a hole (`h` record), which the fan would fill; the silhouette is not guessed |
| `ma-ngon-untriangulable` | As `blend-ngon-untriangulable` |
| `ma-face-record-ignored` | A `.fc` record the documentation does not describe |
| `ma-face-record-invalid` | A `.fc` record attached to no face |
| `ma-uv-dropped` | UVs dropped: a `mu` record with no face, a UV set past the first, a slot outside `.uvst[0].uvsp`, or a material part where only some faces carry UVs (a glTF primitive has an attribute on all its vertices or none) |
| `ma-normals-dropped` | `.n` counts neither one vector per vertex nor one per corner; dropped, normals computed |
| `ma-normals-computed` | No normal written: computed from the geometry and each edge's hardness flag (the third number of `.ed`, a `.ma`'s only smoothing mark). A soft edge carries shading across, a hard edge splits it, one smooth fan's corners share a vertex. An edge shared by more than two faces joins nothing: incidences are counted over the whole topology, marks included, before any join, so no face or edge turns a three-face edge into a border and the file's face order does not matter |
| `ma-face-material-invalid` | An `instObjGroups` group whose component list names no face (a vertex, an edge, an empty list) |
| `ma-face-material-missing` | Faces no `shadingGroup` claims beside bound faces of the same mesh; they leave in a material-less primitive, not dropped |
| `ma-material-unsupported` | A shader other than `lambert`, `phong`, `blinn`, `standardSurface` |
| `ma-transparency-colour-unsupported` | A colour transparency with unequal channels; their mean is carried as the one alpha |
| `ma-emission-clamped` | Emission above one, which `emissiveFactor` cannot carry; clamped |
| `ma-texture-missing` | A texture file absent, outside the source directory, or of a format the image registry does not read |
| `ma-bump-height-unsupported` | A `bump2d` reading a height relief (`bumpInterp` 0, Maya's default): glTF has no height map, and as `normalTexture` it would light the surface from an image saying nothing of orientation; the material keeps no `normalTexture` |
| `ma-bump-object-space-unsupported` | A `bump2d` reading object-space normals (`bumpInterp` 2); glTF's `normalTexture` is tangent-space, and converting needs the pose at draw time |
| `ma-texture-transform-unsupported` | A `place2dTexture` moving the placement (`repeatUV`, `offset`, `rotateUV`, whole or per component); `KHR_texture_transform` would carry it, but this glTF writer declares no such extension |
| `ma-texture-mirror-unsupported` | A `place2dTexture` mirroring (`mirrorU`, `mirrorV`); no glTF wrap mode folds so |
| `ma-texture-unsupported` | A texture not bindable as is: an input computed rather than from a `file` node, a lone metalness or roughness map, or an opacity from another image than the base colour |

## Unity

| `code` | Meaning |
| --- | --- |
| `unity-model-hierarchy-invalid` | A referenced model whose hierarchy does not compose (a child index outside the node table, a node with two parents, a tree deeper than the limit); its meshes are instanced without transforms |
| `unity-material-clip-and-blend` | Transparency **and** alpha clipping declared (`_Mode`, `_Surface`, `_AlphaClip`/`_AlphaCutoffEnable`): `BLEND` wins, since `MASK` would make pixels fully opaque or drop them; the threshold is lost, glTF reading `alphaCutoff` only under `MASK` |
| `unity-prefab-override-unplaced` | A prefab-instance modification aimed at an object not rendered on its own (a model object folded into the instance root, or a second target competing for it); not mixed into another object's transform or materials |
| `unity-prefab-material-slot-invalid` | A modification aimed at a material slot beyond the 65,536 a renderer carries |
| `unity-file-unreadable` | A `.unity`, `.prefab` or `.mat` unreadable; the note names it |
| `unity-document-unreadable` | A serialized object whose body does not parse in an otherwise readable file; skipped with the reason, the rest read |
| `unity-hierarchy-too-deep` | A transform hierarchy, nested prefabs included, deeper than the limit; the subtree is not built |
| `unity-invalid-transform` | A non-finite local transform value or a zero-length rotation; identity kept |
| `unity-camera`, `unity-light`, `unity-particles`, `unity-script`, `unity-skinned-renderer`, `unity-sprite-renderer`, `unity-terrain` | A component read as data, not rendered (camera, light, particle system, script, skinned renderer, sprite renderer, terrain); never approximated |
| `unity-mesh-local` | A `MeshFilter` pointing at a mesh stored in the scene file; no mesh bytes are read here |
| `unity-builtin-mesh-unsupported` | An editor built-in primitive other than the cube (sphere, capsule, cylinder, plane), whose tessellation is the editor's; the note gives the `fileID` |
| `unity-model-missing`, `unity-material-missing`, `unity-texture-missing`, `unity-prefab-missing` | A GUID no project asset carries |
| `unity-material-unreadable` | A `.mat` with no `Material` object |
| `unity-model-format-unknown` | A referenced model no driver claims |
| `unity-model-nested-scene` | A referenced model that is itself a Unity scene: a driver does not call itself |
| `unity-model-import-failed` | The model's driver refused it; the note carries its code and message |
| `unity-model-buffer-unreadable` | The imported model's glTF, or a buffer, unreadable |
| `unity-model-mesh-by-fileid` | A `MeshFilter` naming one mesh of a multi-mesh model by a `fileID` its `.meta` does not name, or an object the model lacks; the whole model is instanced, no part guessed |
| `unity-metallic-map-unconverted` | Metal and smoothness packed in one plane (R and A, or the HDRP mask) where glTF wants G and B; converting would re-encode pixels, so the factors are kept exactly |
| `unity-texture-format` | A texture format the image registry does not claim; dropped |
| `unity-texture-outside-source` | A texture outside the served root, which no URI names |
| `unity-texture-transform` | A non-neutral UV scale or offset on a slot, which needs an extension the intermediate scene does not write yet |
| `unity-texture-wrap-unsupported` | A `TextureImporter` wrap mode glTF lacks (_Mirror Once_); the axis repeats |
| `unity-texture-filter-unsupported` | A `TextureImporter` filter outside point, bilinear and trilinear; glTF default kept |
| `unity-emission-clamped` | An emissive colour above 1 (Unity's HDR emission), `emissiveFactor` being bounded to [0, 1] |
| `unity-emission-keyword-off` | Keywords declared without `_EMISSION` beside a stored emissive colour: it does not emit |
| `unity-prefab-added-component-unconverted` | A component a prefab instance adds to a source object; it lives in the instance's document, not folded into the source object |
| `unity-prefab-added-object-unplaced` | An object a prefab instance adds under a source object not rendered; kept under the instance root |
| `unity-prefab-modification-ignored:<property>` | A modification changing neither geometry nor rendering, counted by property (array indices reduced to `[]`, keeping the report bounded) |

A Unity scene also carries the report of each referenced model's driver: codes are added under their
own names (summed across models), notes prefixed with the model's file name.
