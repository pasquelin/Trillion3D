# Compiler message codes

<!-- Generated from packages/sdk-node/src/messages/messages.json by scripts/message-pages.ts: edit the catalogue, then run `pnpm run generate:messages`. -->

Every message of the compiler and of its Node adapter has a stable public code, one sentence,
its cause and the action to take, each on its own page. `T3D-Exxx` is an error: the job
publishes nothing. `T3D-Wxxx` is a warning: always told, it never stops a compile that can
succeed (`trillion3d-compile --strict` fails on it). `T3D-Ixxx` is an info, told on request
(`--verbose`). The events and the cache keep writing the symbolic name as `code`; the
catalogue maps it to its public code. Exit codes and message prefixes:
[COMPILER.md](COMPILER.md#exit-codes-and-error-codes).

## Global

| Code | Name | Level | Message |
| --- | --- | --- | --- |
| [T3D-E001](messages/T3D-E001.md) | `INVALID_ARGS` | error | The compiler command line was rejected before any work started. |
| [T3D-E002](messages/T3D-E002.md) | `INVALID_BATCH` | error | The batch file was rejected before any job started. |
| [T3D-E003](messages/T3D-E003.md) | `INVALID_OPTIONS` | error | A compile option is out of range. |
| [T3D-E004](messages/T3D-E004.md) | `INVALID_GLTF` | error | The source glTF could not be read. |
| [T3D-E005](messages/T3D-E005.md) | `INVALID_JSON` | error | A JSON file of the source could not be parsed. |
| [T3D-E006](messages/T3D-E006.md) | `UNSUPPORTED_ACCESSOR` | error | A glTF accessor uses a layout the compiler does not read. |
| [T3D-E007](messages/T3D-E007.md) | `BUFFER_OUT_OF_BOUNDS` | error | A glTF accessor reads past the end of its buffer. |
| [T3D-E008](messages/T3D-E008.md) | `SOURCE_NOT_READY` | error | The source folder's `manifest.json` is not marked ready. |
| [T3D-E009](messages/T3D-E009.md) | `UNSUPPORTED_FORMAT` | error | The source folder's `manifest.json` has a format version this compiler does not read. |
| [T3D-E010](messages/T3D-E010.md) | `SOURCE_HASH_MISMATCH` | error | Source files changed after their `manifest.json` was written. |
| [T3D-E011](messages/T3D-E011.md) | `IMPORT_ERROR` | error | The FBX or OBJ importer refused the file. |
| [T3D-E012](messages/T3D-E012.md) | `IMPORT_UNSUPPORTED_VERSION` | error | The FBX or OBJ file is in a version the importer does not read. |
| [T3D-E013](messages/T3D-E013.md) | `IMPORT_OUT_OF_MEMORY` | error | The importer ran out of memory while reading the file. |
| [T3D-E014](messages/T3D-E014.md) | `IMPORT_IO_ERROR` | error | The importer could not read the file from disk. |
| [T3D-E015](messages/T3D-E015.md) | `IMPORT_EMPTY` | error | The import produced no visible mesh. |
| [T3D-E016](messages/T3D-E016.md) | `EMPTY_SLICE` | error | No mesh instance fits the `slice` triangle budget. |
| [T3D-E017](messages/T3D-E017.md) | `RAM_ADMISSION_BUDGET_EXCEEDED` | error | The estimated working memory of the compile is above its RAM budget. |
| [T3D-E018](messages/T3D-E018.md) | `INCOMPLETE_CLUSTER_PARTITION` | error | An internal check on the finest clusters failed: some triangles belong to no cluster. |
| [T3D-E019](messages/T3D-E019.md) | `INVALID_CLUSTER_PARTITION` | error | An internal check on the finest clusters failed: a cluster is malformed. |
| [T3D-E020](messages/T3D-E020.md) | `DAG_ERROR_NOT_MONOTONE` | error | A cluster's simplification error is above its parent's, which would break level-of-detail selection. |
| [T3D-E021](messages/T3D-E021.md) | `DAG_NORMAL_DEVIATION` | error | A coarse cluster bends its normals past its group's bound. |
| [T3D-E022](messages/T3D-E022.md) | `PAGE_DEPENDENCY_BOUND` | error | A cluster's parents span more bundles than the dependency bound allows. |
| [T3D-E023](messages/T3D-E023.md) | `INVALID_PAGE_DEPENDENCIES` | error | A bundle's dependency list failed its consistency check. |
| [T3D-E024](messages/T3D-E024.md) | `CANCELLED` | error | The compile stopped on a cancel request; nothing was published. |
| [T3D-E025](messages/T3D-E025.md) | `CACHE_LOCKED` | error | Another compile holds the cache folder's lock. |
| [T3D-E026](messages/T3D-E026.md) | `IO_ERROR` | error | A file could not be read or written. |
| [T3D-E027](messages/T3D-E027.md) | `THREAD_POOL_ERROR` | error | The compiler could not start its worker threads. |
| [T3D-W001](messages/T3D-W001.md) | `autonomous-scene-animated` | warning | The standalone glTF scene was not written because the source is animated. |
| [T3D-W002](messages/T3D-W002.md) | `texture-level-write-failed` | warning | A baked texture level could not be written, so the engine loads the source image instead. |
| [T3D-E028](messages/T3D-E028.md) | `IMPORT_UNSUPPORTED_ANIMATION` | error | The source animation uses a feature the importer does not carry. |
| [T3D-E029](messages/T3D-E029.md) | `INDEX_OUT_OF_BOUNDS` | error | A glTF index points outside its accessor. |
| [T3D-E030](messages/T3D-E030.md) | `UNSUPPORTED_ACCESSOR_TYPE` | error | A glTF accessor has a missing or unknown type. |
| [T3D-E031](messages/T3D-E031.md) | `UNSUPPORTED_COMPONENT` | error | A glTF accessor has a component type the compiler does not read. |
| [T3D-E032](messages/T3D-E032.md) | `UNSUPPORTED_PRIMITIVE` | error | A glTF primitive is not made of triangles. |
| [T3D-E033](messages/T3D-E033.md) | `INVALID_TRIANGLES` | error | A primitive's index count is not a positive multiple of three. |
| [T3D-E034](messages/T3D-E034.md) | `NONFINITE_POSITION` | error | A vertex position is not a finite number. |
| [T3D-E035](messages/T3D-E035.md) | `INVALID_SOURCE` | error | The source is missing a file it needs. |
| [T3D-E036](messages/T3D-E036.md) | `SOURCE_FORMAT_UNKNOWN` | error | No import driver accepts this source. |
| [T3D-E037](messages/T3D-E037.md) | `SOURCE_FORMAT_AMBIGUOUS` | error | Several import drivers claim the same source folder. |
| [T3D-E038](messages/T3D-E038.md) | `INVALID_MANIFEST` | error | A compiled manifest failed its format check. |
| [T3D-E039](messages/T3D-E039.md) | `INVALID_PAGE` | error | A geometry page has an invalid triangle or vertex count. |
| [T3D-E040](messages/T3D-E040.md) | `INVALID_PAGE_ATTRIBUTE` | error | A geometry page attribute has an invalid count or layout. |
| [T3D-E041](messages/T3D-E041.md) | `PAGE_ATTRIBUTE_RANGE` | error | A page attribute spans more than its quantisation grid can hold. |
| [T3D-E042](messages/T3D-E042.md) | `PAGE_VERTEX_LIMIT` | error | A geometry page holds more than 65,535 vertices. |
| [T3D-E043](messages/T3D-E043.md) | `PAGE_JOINT_RANGE` | error | A skinned page names a joint past 65,535. |
| [T3D-E044](messages/T3D-E044.md) | `PAGE_MORPH_TARGETS` | error | A primitive has more morph targets than a page carries. |
| [T3D-E045](messages/T3D-E045.md) | `SOFT_DEFORMATION` | error | A simulated primitive also carries a skin or morph targets. |
| [T3D-E046](messages/T3D-E046.md) | `PHYSICS_COOK_FAILED` | error | The physics shape of a primitive could not be built. |
| [T3D-E047](messages/T3D-E047.md) | `TEXTURE_ENCODE_FAILED` | error | A baked texture level could not be encoded. |
| [T3D-E048](messages/T3D-E048.md) | `WORLD_TOP_OVER_BUDGET` | error | The world's pinned top level is above its byte budget. |
| [T3D-E049](messages/T3D-E049.md) | `INVALID_CUTOUT_DECISIONS` | error | The cutout answer sheet in the cache folder is invalid. |
| [T3D-E050](messages/T3D-E050.md) | `INVALID_ORACLE_JOB` | error | The reference path tracer's job file is invalid. |
| [T3D-E051](messages/T3D-E051.md) | `INVALID_ORACLE_SOURCE` | error | The reference path tracer's scene is invalid. |
| [T3D-W003](messages/T3D-W003.md) | `DAG_FLAT` | warning | A primitive of several clusters built no coarser level, so it is drawn at full detail at every distance. |
| [T3D-W004](messages/T3D-W004.md) | `DAG_ROOTS` | warning | A primitive's DAG stopped rising mid-way and left many roots, so it stays heavy in the distance. |

## Archives

| Code | Name | Level | Message |
| --- | --- | --- | --- |
| [T3D-E052](messages/T3D-E052.md) | `ARCHIVE_PATH_ESCAPE` | error | An archive entry's path leaves the extraction folder. |
| [T3D-E053](messages/T3D-E053.md) | `ARCHIVE_SYMLINK` | error | An archive entry is a symbolic link, which is never followed. |
| [T3D-E054](messages/T3D-E054.md) | `ARCHIVE_ENCRYPTED` | error | An archive entry is encrypted. |
| [T3D-E055](messages/T3D-E055.md) | `ARCHIVE_UNREADABLE` | error | The archive is truncated or corrupted. |
| [T3D-E056](messages/T3D-E056.md) | `ARCHIVE_EMPTY` | error | The archive holds no entry. |
| [T3D-E057](messages/T3D-E057.md) | `ARCHIVE_TOO_MANY_ENTRIES` | error | The archive holds more than 20,000 entries. |
| [T3D-E058](messages/T3D-E058.md) | `ARCHIVE_TOO_LARGE` | error | The archive unpacks to more than 8 GiB. |

## Lights and OBJ/MTL materials

| Code | Name | Level | Message |
| --- | --- | --- | --- |
| [T3D-W005](messages/T3D-W005.md) | `light-index-out-of-bounds` | warning | A node names a light the file does not declare, so that light is left out. |
| [T3D-W006](messages/T3D-W006.md) | `light-invalid-transform` | warning | A light's position or orientation is not a finite number, so the light is left out. |
| [T3D-W007](messages/T3D-W007.md) | `light-unsupported-type` | warning | A light is neither point, spot nor directional, so it is left out. |
| [T3D-W008](messages/T3D-W008.md) | `light-non-positive-intensity` | warning | A light's intensity is zero, negative or not a number, so it is left out. |
| [T3D-W009](messages/T3D-W009.md) | `light-degenerate-axis` | warning | A spot or directional light has a transform that collapses its direction, so it is left out. |
| [T3D-I001](messages/T3D-I001.md) | `light-emitter-radius-derived` | info | A light's emitter radius was measured on its emissive body rather than read from the file. |
| [T3D-W010](messages/T3D-W010.md) | `light-emitter-radius-invalid` | warning | A light's emitter radius is not usable, so it is omitted and the light kept. |
| [T3D-W011](messages/T3D-W011.md) | `light-area-or-volume` | warning | An area or volume light was left out; only point, spot and directional lights are carried. |
| [T3D-W012](messages/T3D-W012.md) | `material-library-missing` | warning | A material library the model cites could not be opened, so its materials take default values. |
| [T3D-W013](messages/T3D-W013.md) | `material-library-truncated` | warning | The material library ends in the middle of a declaration. |
| [T3D-W014](messages/T3D-W014.md) | `material-specular-color` | warning | A specular colour or map was dropped; glTF's metal-roughness model has no place for it. |
| [T3D-W015](messages/T3D-W015.md) | `material-specular-ior` | warning | An index of refraction other than 1.5 was dropped. |
| [T3D-W016](messages/T3D-W016.md) | `material-ambient-color` | warning | An ambient colour or map was dropped; glTF has no ambient term. |
| [T3D-W017](messages/T3D-W017.md) | `material-bump-map` | warning | A bump map was dropped because a different normal map is kept. |
| [T3D-W018](messages/T3D-W018.md) | `material-separate-opacity-texture` | warning | An opacity map separate from the base colour was dropped; glTF reads opacity from the base colour's alpha only. |
| [T3D-W019](messages/T3D-W019.md) | `material-split-metal-roughness` | warning | Metalness and roughness come from different maps, which glTF cannot carry. |
| [T3D-W020](messages/T3D-W020.md) | `texture-offset` | warning | A texture map's offset option was dropped. |
| [T3D-W021](messages/T3D-W021.md) | `texture-scale` | warning | A texture map's scale option was dropped. |
| [T3D-W022](messages/T3D-W022.md) | `texture-bump-scale` | warning | A bump map's strength option was dropped; glTF carries no relief strength. |
| [T3D-W023](messages/T3D-W023.md) | `texture-embedded-format` | warning | An embedded texture is in an image format the importer does not read, so it is dropped. |
| [T3D-W024](messages/T3D-W024.md) | `texture-format` | warning | A texture file is in an image format the importer does not read, so it is dropped. |
| [T3D-W025](messages/T3D-W025.md) | `texture-missing` | warning | A texture file the model cites was not found, so the material draws without it. |
| [T3D-W026](messages/T3D-W026.md) | `texture-outside-source` | warning | A texture file lies outside the model's folder, so it is not copied. |
| [T3D-W027](messages/T3D-W027.md) | `texture-procedural` | warning | A procedural texture was dropped; only image textures are carried. |
| [T3D-W028](messages/T3D-W028.md) | `texture-uv-transform` | warning | A texture's UV transform was dropped. |
| [T3D-I002](messages/T3D-I002.md) | `node-hidden` | info | Hidden nodes were left out of the scene. |
| [T3D-W029](messages/T3D-W029.md) | `node-invalid-transform` | warning | A node's transform is not a finite number, so the node is left out. |

## Blender

| Code | Name | Level | Message |
| --- | --- | --- | --- |
| [T3D-E059](messages/T3D-E059.md) | `blend-header-invalid` | error | The file is not a readable Blender file. |
| [T3D-E060](messages/T3D-E060.md) | `blend-pointer-size-unsupported` | error | The Blender file was written with 32-bit pointers. |
| [T3D-E061](messages/T3D-E061.md) | `blend-endianness-unsupported` | error | The Blender file is big-endian. |
| [T3D-E062](messages/T3D-E062.md) | `blend-block-header-unsupported` | error | The Blender file uses a block layout this reader does not know. |
| [T3D-E063](messages/T3D-E063.md) | `blend-truncated` | error | The Blender file ends in the middle of a block. |
| [T3D-E064](messages/T3D-E064.md) | `blend-too-large` | error | The Blender file needs more memory than the RAM budget. |
| [T3D-E065](messages/T3D-E065.md) | `blend-dna-invalid` | error | The Blender file's structure description is missing or unreadable. |
| [T3D-E066](messages/T3D-E066.md) | `blend-mesh-layout-unsupported` | error | A Blender mesh is stored in a layout this reader does not know. |
| [T3D-E067](messages/T3D-E067.md) | `blend-mesh-invalid` | error | A Blender mesh corner points outside its vertices. |
| [T3D-W030](messages/T3D-W030.md) | `blend-collection-instance-unsupported` | warning | An object that instances a collection was left out. |
| [T3D-W031](messages/T3D-W031.md) | `blend-modifier-not-applied` | warning | Modifiers were not applied; the base mesh is exported. |
| [T3D-W032](messages/T3D-W032.md) | `blend-mesh-missing` | warning | A mesh object points at no mesh data, so it is left out. |
| [T3D-W033](messages/T3D-W033.md) | `blend-alpha-texture-unsupported` | warning | An alpha input from another image or node was dropped; the declared alpha is kept. |
| [T3D-W034](messages/T3D-W034.md) | `blend-texture-channel-unsupported` | warning | An alpha taken from a colour channel was dropped; the declared alpha is kept. |
| [T3D-W035](messages/T3D-W035.md) | `blend-surface-node-unsupported` | warning | A material not driven by a Principled BSDF keeps only its basic values. |
| [T3D-W036](messages/T3D-W036.md) | `blend-shader-input-unconverted` | warning | A shader input fed by a node other than an image was not converted; its declared value is kept. |
| [T3D-W037](messages/T3D-W037.md) | `blend-emission-clamped` | warning | An emission above 1 was clamped. |
| [T3D-W038](messages/T3D-W038.md) | `blend-image-format` | warning | An image in a format the image readers do not decode was dropped. |
| [T3D-W039](messages/T3D-W039.md) | `blend-image-outside-source` | warning | An image outside the model's folder, not packed, was not copied. |
| [T3D-W040](messages/T3D-W040.md) | `blend-object-material-override-unconverted` | warning | An object's material override was dropped; the mesh's own material is kept. |
| [T3D-W041](messages/T3D-W041.md) | `blend-ngon-untriangulable` | warning | A polygon could not be cut into triangles cleanly and was filled as a fan. |
| [T3D-I003](messages/T3D-I003.md) | `blend-extra-scenes` | info | The file holds more than one scene; only the active one is exported. |
| [T3D-I004](messages/T3D-I004.md) | `blend-object-outside-scene` | info | A mesh object outside the active scene was not exported. |
| [T3D-W042](messages/T3D-W042.md) | `blend-light-type-unsupported` | warning | A light type other than point, sun, spot or area was left out. |
| [T3D-W043](messages/T3D-W043.md) | `blend-lamp-missing` | warning | A light object points at no light data, so it is left out. |

## Images

| Code | Name | Level | Message |
| --- | --- | --- | --- |
| [T3D-W044](messages/T3D-W044.md) | `image-lossy-unsupported` | warning | A lossy WebP texture was refused, so it falls back to white. |
| [T3D-W045](messages/T3D-W045.md) | `image-animation-unsupported` | warning | An animated WebP or GIF texture was refused, so it falls back to white. |
| [T3D-W046](messages/T3D-W046.md) | `image-animation-first-frame` | warning | An animated PNG was read as its default image only. |
| [T3D-W047](messages/T3D-W047.md) | `image-icc-profile-ignored` | warning | An embedded colour profile was ignored; the texture is read as sRGB. |
| [T3D-W048](messages/T3D-W048.md) | `image-transfer-unsupported` | warning | A PNG gamma other than sRGB or linear was ignored; the texture is read as sRGB. |
| [T3D-W049](messages/T3D-W049.md) | `image-profile-unsupported` | warning | A TIFF profile or codec was declined, so the texture falls back to white. |
| [T3D-W050](messages/T3D-W050.md) | `image-depth-unsupported` | warning | A texture with more than 8 bits per channel was refused, so it falls back to white. |
| [T3D-W051](messages/T3D-W051.md) | `image-too-large` | warning | A texture is above the decoding size ceiling, so it falls back to white. |
| [T3D-W052](messages/T3D-W052.md) | `image-float-unsupported` | warning | A floating-point image (OpenEXR or HDR) was used where an 8-bit image is expected. |
| [T3D-W053](messages/T3D-W053.md) | `bmp-depth-unsupported` | warning | A BMP bit depth outside the lossless list was refused, so the texture falls back to white. |
| [T3D-W054](messages/T3D-W054.md) | `bmp-bitfields-lossy` | warning | A BMP with more than 8 bits per channel was refused, so the texture falls back to white. |
| [T3D-W055](messages/T3D-W055.md) | `bmp-embedded-codec-unsupported` | warning | A BMP wrapping a JPEG or PNG was refused, so the texture falls back to white. |
| [T3D-W056](messages/T3D-W056.md) | `bmp-compression-unsupported` | warning | A BMP compression outside the read list was refused, so the texture falls back to white. |
| [T3D-W057](messages/T3D-W057.md) | `dds-header-truncated` | warning | A DDS texture's header is truncated, so the texture falls back to white. |
| [T3D-W058](messages/T3D-W058.md) | `dds-header-invalid` | warning | A DDS texture's header is out of range, so the texture falls back to white. |
| [T3D-W059](messages/T3D-W059.md) | `dds-codec-unsupported` | warning | A DDS codec outside the read list was refused, so the texture falls back to white. |
| [T3D-W060](messages/T3D-W060.md) | `dds-layout-unsupported` | warning | A DDS cube, volume, array or padded texture was refused, so it falls back to white. |
| [T3D-W061](messages/T3D-W061.md) | `dds-data-truncated` | warning | A DDS texture's pixel data is incomplete, so it falls back to white. |
| [T3D-W062](messages/T3D-W062.md) | `dds-image-too-large` | warning | A DDS texture is above the decoding size ceiling, so it falls back to white. |
| [T3D-W063](messages/T3D-W063.md) | `exr-header-invalid` | warning | An OpenEXR texture's header is unreadable, so it falls back to white. |
| [T3D-W064](messages/T3D-W064.md) | `exr-deep-unsupported` | warning | A deep OpenEXR image was refused, so the texture falls back to white. |
| [T3D-W065](messages/T3D-W065.md) | `exr-multipart-unsupported` | warning | A multi-part OpenEXR image was refused, so the texture falls back to white. |
| [T3D-W066](messages/T3D-W066.md) | `exr-channels-unsupported` | warning | OpenEXR channels other than R, G, B and A were refused, so the texture falls back to white. |
| [T3D-W067](messages/T3D-W067.md) | `exr-image-too-large` | warning | An OpenEXR texture is above the decoding size ceiling, so it falls back to white. |
| [T3D-W068](messages/T3D-W068.md) | `exr-data-unreadable` | warning | An OpenEXR texture's pixels are unreadable, so it falls back to white. |
| [T3D-W069](messages/T3D-W069.md) | `hdr-header-invalid` | warning | A Radiance HDR texture's header is unreadable, so it falls back to white. |
| [T3D-W070](messages/T3D-W070.md) | `hdr-format-unsupported` | warning | A Radiance HDR pixel encoding outside RGBE was refused, so the texture falls back to white. |
| [T3D-W071](messages/T3D-W071.md) | `hdr-orientation-unsupported` | warning | A Radiance HDR scan order other than top-down was refused, so the texture falls back to white. |
| [T3D-W072](messages/T3D-W072.md) | `hdr-data-truncated` | warning | A Radiance HDR texture's scanlines are incomplete, so it falls back to white. |
| [T3D-W073](messages/T3D-W073.md) | `hdr-image-too-large` | warning | A Radiance HDR texture is above the decoding size ceiling, so it falls back to white. |
| [T3D-W074](messages/T3D-W074.md) | `ktx2-header-truncated` | warning | A KTX2 texture's header is truncated, so it falls back to white. |
| [T3D-W075](messages/T3D-W075.md) | `ktx2-header-invalid` | warning | A KTX2 texture's header is out of range, so it falls back to white. |
| [T3D-W076](messages/T3D-W076.md) | `ktx2-format-unsupported` | warning | A KTX2 pixel format outside the read list was refused, so the texture falls back to white. |
| [T3D-W077](messages/T3D-W077.md) | `ktx2-layout-unsupported` | warning | A KTX2 cube, volume, array or 1D texture was refused, so it falls back to white. |
| [T3D-W078](messages/T3D-W078.md) | `ktx2-supercompression-unsupported` | warning | A KTX2 supercompression other than none, BasisLZ or Zstandard was refused, so the texture falls back to white. |
| [T3D-W079](messages/T3D-W079.md) | `ktx2-data-truncated` | warning | A KTX2 texture's level data is incomplete, so it falls back to white. |
| [T3D-W080](messages/T3D-W080.md) | `ktx2-image-too-large` | warning | A KTX2 texture is above the decoding size ceiling, so it falls back to white. |
| [T3D-W081](messages/T3D-W081.md) | `ktx2-transcode-failed` | warning | A Basis Universal payload could not be transcoded, so the texture falls back to white. |
| [T3D-W082](messages/T3D-W082.md) | `ktx2-orientation-unsupported` | warning | A KTX2 orientation the reader cannot map was kept as stored, so the texture may appear flipped. |
| [T3D-W083](messages/T3D-W083.md) | `ktx2-swizzle-unsupported` | warning | A KTX2 channel swizzle was not applied. |
| [T3D-W084](messages/T3D-W084.md) | `eac-level-short` | warning | An EAC-compressed KTX2 level is missing blocks, so the texture falls back to white. |
| [T3D-W085](messages/T3D-W085.md) | `psd-header-invalid` | warning | A Photoshop file's header is out of range, so the texture falls back to white. |
| [T3D-W086](messages/T3D-W086.md) | `psd-depth-unsupported` | warning | A Photoshop file at 1, 16 or 32 bits per channel was refused, so the texture falls back to white. |
| [T3D-W087](messages/T3D-W087.md) | `psd-color-mode-unsupported` | warning | A Photoshop colour mode other than RGB or greyscale was refused, so the texture falls back to white. |
| [T3D-W088](messages/T3D-W088.md) | `psd-channels-unsupported` | warning | A Photoshop file with several extra channels was refused, so the texture falls back to white. |
| [T3D-W089](messages/T3D-W089.md) | `psd-alpha-channel-ignored` | warning | An extra Photoshop channel not declared as transparency was ignored. |
| [T3D-I005](messages/T3D-I005.md) | `psd-layers-flattened` | info | A layered Photoshop file was read as its flattened composite. |
| [T3D-W090](messages/T3D-W090.md) | `psd-compression-unsupported` | warning | A ZIP-compressed Photoshop composite was refused, so the texture falls back to white. |
| [T3D-W091](messages/T3D-W091.md) | `psd-composite-missing` | warning | A Photoshop file has no flattened composite, so the texture falls back to white. |
| [T3D-W092](messages/T3D-W092.md) | `psd-data-truncated` | warning | A Photoshop file's image data is incomplete, so the texture falls back to white. |
| [T3D-W093](messages/T3D-W093.md) | `psd-image-too-large` | warning | A Photoshop texture is above the decoding size ceiling, so it falls back to white. |
| [T3D-W094](messages/T3D-W094.md) | `image-decode-failed` | warning | A texture could not be decoded, so its texture levels are not baked. |
| [T3D-W095](messages/T3D-W095.md) | `image-empty` | warning | A texture has no pixels, so its texture levels are not baked. |
| [T3D-W096](messages/T3D-W096.md) | `image-format-unknown` | warning | A texture is in no format the image readers recognise, so its texture levels are not baked. |
| [T3D-W097](messages/T3D-W097.md) | `image-missing` | warning | A texture file the model cites was not found, so its texture levels are not baked. |
| [T3D-W098](messages/T3D-W098.md) | `image-out-of-bounds` | warning | A material names an image the file does not declare, so its texture levels are not baked. |
| [T3D-W099](messages/T3D-W099.md) | `image-uri-not-relative` | warning | A texture URI is absolute or leaves the model's folder, so its texture levels are not baked. |
| [T3D-W100](messages/T3D-W100.md) | `image-uri-outside-source` | warning | A texture URI resolves outside the model's folder, so its texture levels are not baked. |
| [T3D-W101](messages/T3D-W101.md) | `image-uri-undecodable` | warning | A texture URI has invalid percent-encoding, so its texture levels are not baked. |
| [T3D-W102](messages/T3D-W102.md) | `image-without-source` | warning | A glTF image has neither a URI nor a buffer view, so its texture levels are not baked. |
| [T3D-W103](messages/T3D-W103.md) | `image-buffer-view-invalid` | warning | A glTF image names an invalid buffer view, so its texture levels are not baked. |
| [T3D-W104](messages/T3D-W104.md) | `image-buffer-view-not-copied` | warning | A glTF image's buffer view was not carried to the compiled source, so its texture levels are not baked. |
| [T3D-W105](messages/T3D-W105.md) | `image-buffer-view-out-of-bounds` | warning | A glTF image's buffer view reads past its buffer, so its texture levels are not baked. |
| [T3D-W106](messages/T3D-W106.md) | `texture-out-of-bounds` | warning | A material names a texture the file does not declare, so its texture levels are not baked. |
| [T3D-W107](messages/T3D-W107.md) | `texture-without-image` | warning | A glTF texture names no image, so its texture levels are not baked. |
| [T3D-W108](messages/T3D-W108.md) | `texture-blocks-undecodable` | warning | A compressed texture level did not decode back during its quality check. |

## USD

| Code | Name | Level | Message |
| --- | --- | --- | --- |
| [T3D-E068](messages/T3D-E068.md) | `USDZ_LAYOUT_INVALID` | error | The USDZ package stores an entry compressed or unaligned. |
| [T3D-E069](messages/T3D-E069.md) | `USDZ_ROOT_LAYER_MISSING` | error | The USDZ package's first entry is not a USD layer. |
| [T3D-W109](messages/T3D-W109.md) | `usd-point-instancer-unsupported` | warning | A point instancer was not expanded, so its instances are not drawn. |
| [T3D-W110](messages/T3D-W110.md) | `usd-curves-unsupported` | warning | Curves were left out; only surfaces are drawn. |
| [T3D-W111](messages/T3D-W111.md) | `usd-volume-unsupported` | warning | A volume was left out; only surfaces are drawn. |
| [T3D-W112](messages/T3D-W112.md) | `usd-skel-unsupported` | warning | A skeleton or blend shape was left out; the mesh is drawn in its rest pose. |
| [T3D-I006](messages/T3D-I006.md) | `usd-camera-unsupported` | info | A camera was left out; the host places its own. |
| [T3D-W113](messages/T3D-W113.md) | `usd-light-unsupported` | warning | A light type with no glTF equivalent was left out. |
| [T3D-W114](messages/T3D-W114.md) | `usd-patch-unsupported` | warning | A NURBS patch was left out; it is not tessellated. |
| [T3D-W115](messages/T3D-W115.md) | `usd-subdivision-unsupported` | warning | A subdivision surface was carried as its flat polygons, which changes its silhouette. |
| [T3D-W116](messages/T3D-W116.md) | `usd-variants-unsupported` | warning | Only the default selection of a variant set was read. |
| [T3D-W117](messages/T3D-W117.md) | `usd-composition-invalid` | warning | A reference, payload or sublayer could not be resolved. |
| [T3D-W118](messages/T3D-W118.md) | `usd-animation-first-sample` | warning | An animated attribute was read at its first time sample; the scene is frozen there. |
| [T3D-W119](messages/T3D-W119.md) | `usd-mesh-invalid` | warning | A mesh's arrays are missing or contradictory, so it is left out. |
| [T3D-W120](messages/T3D-W120.md) | `usd-ngon-untriangulable` | warning | A polygon could not be cut into triangles cleanly and was filled as a fan. |
| [T3D-W121](messages/T3D-W121.md) | `usd-xform-unsupported` | warning | A transform operation was not composed. |
| [T3D-W122](messages/T3D-W122.md) | `usd-xform-invalid` | warning | A transform is not a finite number, so the node stays at identity. |
| [T3D-W123](messages/T3D-W123.md) | `usd-surface-unsupported` | warning | A material with no UsdPreviewSurface keeps default values. |
| [T3D-W124](messages/T3D-W124.md) | `usd-texture-missing` | warning | A texture was not found, is outside the model's folder, or is in an unread format. |
| [T3D-W125](messages/T3D-W125.md) | `usd-opacity-texture-unsupported` | warning | An opacity image separate from the base colour was dropped; the written opacity is kept. |
| [T3D-W126](messages/T3D-W126.md) | `usd-texture-channel-unsupported` | warning | A texture channel glTF does not read there was used; the map is carried as is. |
| [T3D-W127](messages/T3D-W127.md) | `usd-texture-unsupported` | warning | A texture could not be bound as is. |
| [T3D-W128](messages/T3D-W128.md) | `usd-texture-wrap-unsupported` | warning | A wrap mode glTF lacks was replaced by repeat. |
| [T3D-W129](messages/T3D-W129.md) | `usd-texture-scale-unsupported` | warning | A texture scale or bias glTF cannot carry was dropped. |
| [T3D-W130](messages/T3D-W130.md) | `usd-texture-colour-space-unsupported` | warning | A texture's colour space contradicts its role; its bytes pass through unchanged. |
| [T3D-W131](messages/T3D-W131.md) | `usd-specular-workflow-unsupported` | warning | A specular-workflow material was read without its specular colour. |
| [T3D-W132](messages/T3D-W132.md) | `usd-clearcoat-unsupported` | warning | A clearcoat layer was dropped; base glTF has none. |
| [T3D-W133](messages/T3D-W133.md) | `usd-ior-unsupported` | warning | An index of refraction other than 1.5 was dropped. |
| [T3D-W134](messages/T3D-W134.md) | `usd-normal-value-unsupported` | warning | A constant normal value was dropped; the geometry's normals stay. |
| [T3D-W135](messages/T3D-W135.md) | `usd-face-invalid` | warning | A face its arrays do not carry was dropped. |
| [T3D-I007](messages/T3D-I007.md) | `usd-face-hole` | info | A face listed as a hole was removed, as OpenUSD draws it. |

## Alembic

| Code | Name | Level | Message |
| --- | --- | --- | --- |
| [T3D-E070](messages/T3D-E070.md) | `alembic-hdf5-unsupported` | error | The Alembic file uses the HDF5 container, which is not read. |
| [T3D-E071](messages/T3D-E071.md) | `alembic-archive-unfrozen` | error | The Alembic archive was never closed by its writer. |
| [T3D-E072](messages/T3D-E072.md) | `alembic-version-unsupported` | error | The Alembic file's format version is not read. |
| [T3D-E073](messages/T3D-E073.md) | `alembic-file-invalid` | error | The Alembic file is not a readable Ogawa archive. |
| [T3D-E074](messages/T3D-E074.md) | `alembic-size-unsupported` | error | An Alembic group or block is above the reader's size ceiling. |
| [T3D-E075](messages/T3D-E075.md) | `alembic-values-invalid` | error | An Alembic transform stack does not compose. |
| [T3D-E076](messages/T3D-E076.md) | `alembic-topology-invalid` | error | An Alembic face points outside its positions. |
| [T3D-W136](messages/T3D-W136.md) | `alembic-curves-unsupported` | warning | Alembic curves were left out; only meshes are drawn. |
| [T3D-W137](messages/T3D-W137.md) | `alembic-points-unsupported` | warning | An Alembic point cloud was left out; only meshes are drawn. |
| [T3D-W138](messages/T3D-W138.md) | `alembic-nupatch-unsupported` | warning | An Alembic NURBS patch was left out; it is not tessellated. |
| [T3D-I008](messages/T3D-I008.md) | `alembic-camera-unsupported` | info | An Alembic camera was left out; the host places its own. |
| [T3D-W139](messages/T3D-W139.md) | `alembic-light-unsupported` | warning | An Alembic light was left out. |
| [T3D-W140](messages/T3D-W140.md) | `alembic-object-unsupported` | warning | An Alembic object of an unknown schema was left out. |
| [T3D-W141](messages/T3D-W141.md) | `alembic-instance-unsupported` | warning | An Alembic instance was left out. |
| [T3D-W142](messages/T3D-W142.md) | `alembic-subd-as-polygons` | warning | An Alembic subdivision surface was drawn as its flat polygons. |
| [T3D-W143](messages/T3D-W143.md) | `alembic-animation-ignored` | warning | Only the first sample of an animated Alembic property was read. |
| [T3D-W144](messages/T3D-W144.md) | `alembic-normals-missing` | warning | Alembic normals are missing, so they are computed. |
| [T3D-W145](messages/T3D-W145.md) | `alembic-normals-dropped` | warning | Alembic normals are inconsistent, so they are dropped and computed. |
| [T3D-W146](messages/T3D-W146.md) | `alembic-uv-dropped` | warning | Alembic UVs are inconsistent, so they are dropped. |
| [T3D-W147](messages/T3D-W147.md) | `alembic-face-in-two-facesets` | warning | An Alembic face belongs to two face sets, so its material is ambiguous. |
| [T3D-W148](messages/T3D-W148.md) | `alembic-degenerate-face` | warning | An Alembic face with fewer than three corners was dropped. |
| [T3D-W149](messages/T3D-W149.md) | `alembic-ngon-untriangulable` | warning | A polygon could not be cut into triangles cleanly and was filled as a fan. |
| [T3D-W150](messages/T3D-W150.md) | `alembic-faceset-invalid` | warning | An Alembic face set could not be read, so it is skipped. |
| [T3D-W151](messages/T3D-W151.md) | `alembic-mesh-invalid` | warning | An Alembic mesh's arrays are contradictory, so it is left out. |
| [T3D-W152](messages/T3D-W152.md) | `alembic-mesh-empty` | warning | An Alembic mesh has no triangle, so it is left out. |
| [T3D-W153](messages/T3D-W153.md) | `alembic-transform-invalid` | warning | An Alembic transform is not a finite number, so the node stays at identity. |
| [T3D-I009](messages/T3D-I009.md) | `alembic-transform-not-inherited` | info | An Alembic transform that does not inherit its parent was placed at the scene root. |
| [T3D-W154](messages/T3D-W154.md) | `alembic-hierarchy-too-deep` | warning | An Alembic hierarchy is deeper than the limit, so the deeper branch is cut. |

## Maya ASCII

| Code | Name | Level | Message |
| --- | --- | --- | --- |
| [T3D-E077](messages/T3D-E077.md) | `ma-file-invalid` | error | The file is not a readable Maya ASCII file. |
| [T3D-E078](messages/T3D-E078.md) | `ma-size-unsupported` | error | The Maya ASCII file or one of its attributes is above the size ceiling. |
| [T3D-W155](messages/T3D-W155.md) | `ma-command-ignored` | warning | A MEL command outside the read subset was ignored; no command is ever run. |
| [T3D-W156](messages/T3D-W156.md) | `ma-node-ignored` | warning | A Maya node type that is not converted was ignored. |
| [T3D-W157](messages/T3D-W157.md) | `ma-attribute-unattached` | warning | An attribute value names no node of the file, so it is ignored. |
| [T3D-W158](messages/T3D-W158.md) | `ma-attribute-invalid` | warning | An attribute value is out of range or of an unread type, so it is ignored. |
| [T3D-W159](messages/T3D-W159.md) | `ma-parent-unsupported` | warning | A parenting command was not replayed. |
| [T3D-W160](messages/T3D-W160.md) | `ma-name-ambiguous` | warning | A short node name is carried by several nodes; the first one written is used. |
| [T3D-W161](messages/T3D-W161.md) | `ma-transform-invalid` | warning | A transform is not a finite number, so the node stays at identity. |
| [T3D-W162](messages/T3D-W162.md) | `ma-hierarchy-too-deep` | warning | A hierarchy is deeper than 256 levels or circular, so the branch is cut. |
| [T3D-W163](messages/T3D-W163.md) | `ma-matrix-unsupported` | warning | A matrix attribute not written as sixteen numbers was ignored. |
| [T3D-I010](messages/T3D-I010.md) | `ma-shape-intermediate` | info | An intermediate shape Maya never draws was left out. |
| [T3D-W164](messages/T3D-W164.md) | `ma-mesh-invalid` | warning | A mesh's arrays are contradictory, so it is left out. |
| [T3D-W165](messages/T3D-W165.md) | `ma-mesh-empty` | warning | A mesh has no triangle, so it is left out. |
| [T3D-W166](messages/T3D-W166.md) | `ma-degenerate-face` | warning | A face with fewer than three corners was dropped. |
| [T3D-W167](messages/T3D-W167.md) | `ma-face-hole-unsupported` | warning | A face with a hole was left out. |
| [T3D-W168](messages/T3D-W168.md) | `ma-ngon-untriangulable` | warning | A polygon could not be cut into triangles cleanly and was filled as a fan. |
| [T3D-W169](messages/T3D-W169.md) | `ma-face-record-ignored` | warning | An undocumented face record was ignored. |
| [T3D-W170](messages/T3D-W170.md) | `ma-face-record-invalid` | warning | A face record attached to no face was ignored. |
| [T3D-W171](messages/T3D-W171.md) | `ma-uv-dropped` | warning | UVs were dropped from a mesh part. |
| [T3D-W172](messages/T3D-W172.md) | `ma-normals-dropped` | warning | Written normals did not match the mesh, so they are dropped and computed. |
| [T3D-I011](messages/T3D-I011.md) | `ma-normals-computed` | info | No normals were written, so they are computed from the edges' hardness. |
| [T3D-W173](messages/T3D-W173.md) | `ma-face-material-invalid` | warning | A material assignment names no face, so it is ignored. |
| [T3D-W174](messages/T3D-W174.md) | `ma-face-material-missing` | warning | Faces with no material beside assigned ones were kept without a material. |
| [T3D-W175](messages/T3D-W175.md) | `ma-material-unsupported` | warning | A shader other than lambert, phong, blinn or standardSurface keeps default values. |
| [T3D-W176](messages/T3D-W176.md) | `ma-transparency-colour-unsupported` | warning | A coloured transparency was carried as one alpha, the mean of its channels. |
| [T3D-W177](messages/T3D-W177.md) | `ma-emission-clamped` | warning | An emission above 1 was clamped. |
| [T3D-W178](messages/T3D-W178.md) | `ma-texture-missing` | warning | A texture was not found, is outside the model's folder, or is in an unread format. |
| [T3D-W179](messages/T3D-W179.md) | `ma-bump-height-unsupported` | warning | A height bump map was dropped; glTF has no height map. |
| [T3D-W180](messages/T3D-W180.md) | `ma-bump-object-space-unsupported` | warning | An object-space normal map was dropped; glTF reads tangent-space normals. |
| [T3D-W181](messages/T3D-W181.md) | `ma-texture-transform-unsupported` | warning | A texture placement (repeat, offset or rotation) was dropped. |
| [T3D-W182](messages/T3D-W182.md) | `ma-texture-mirror-unsupported` | warning | A texture mirroring was dropped. |
| [T3D-W183](messages/T3D-W183.md) | `ma-texture-unsupported` | warning | A texture could not be bound as is. |

## Unity

| Code | Name | Level | Message |
| --- | --- | --- | --- |
| [T3D-W184](messages/T3D-W184.md) | `unity-model-hierarchy-invalid` | warning | A referenced model's hierarchy does not compose, so its meshes are placed without transforms. |
| [T3D-W185](messages/T3D-W185.md) | `unity-material-clip-and-blend` | warning | A material declares both transparency and alpha clipping; transparency wins and the clip threshold is lost. |
| [T3D-W186](messages/T3D-W186.md) | `unity-prefab-override-unplaced` | warning | A prefab modification aimed at an object that is not drawn on its own was ignored. |
| [T3D-W187](messages/T3D-W187.md) | `unity-prefab-material-slot-invalid` | warning | A prefab modification names a material slot beyond 65,536, so it is ignored. |
| [T3D-W188](messages/T3D-W188.md) | `unity-file-unreadable` | warning | A scene, prefab or material file could not be read. |
| [T3D-W189](messages/T3D-W189.md) | `unity-document-unreadable` | warning | An object in a Unity file could not be parsed, so it is skipped. |
| [T3D-W190](messages/T3D-W190.md) | `unity-hierarchy-too-deep` | warning | A Unity hierarchy is deeper than the limit, so the deeper branch is not built. |
| [T3D-W191](messages/T3D-W191.md) | `unity-invalid-transform` | warning | A transform value is not finite or a rotation has zero length, so identity is kept. |
| [T3D-I012](messages/T3D-I012.md) | `unity-camera` | info | A camera component was read as data and not drawn. |
| [T3D-W192](messages/T3D-W192.md) | `unity-light` | warning | A light component was not converted. |
| [T3D-W193](messages/T3D-W193.md) | `unity-particles` | warning | A particle system was not converted. |
| [T3D-I013](messages/T3D-I013.md) | `unity-script` | info | A script component was read as data and not run. |
| [T3D-W194](messages/T3D-W194.md) | `unity-skinned-renderer` | warning | A skinned mesh renderer was not converted. |
| [T3D-W195](messages/T3D-W195.md) | `unity-sprite-renderer` | warning | A sprite renderer was not converted. |
| [T3D-W196](messages/T3D-W196.md) | `unity-terrain` | warning | A terrain was not converted. |
| [T3D-W197](messages/T3D-W197.md) | `unity-mesh-local` | warning | A mesh stored inside the scene file was not read. |
| [T3D-W198](messages/T3D-W198.md) | `unity-builtin-mesh-unsupported` | warning | A built-in primitive other than the cube was not converted. |
| [T3D-W199](messages/T3D-W199.md) | `unity-model-missing` | warning | A referenced model is not in the project. |
| [T3D-W200](messages/T3D-W200.md) | `unity-material-missing` | warning | A referenced material is not in the project. |
| [T3D-W201](messages/T3D-W201.md) | `unity-texture-missing` | warning | A referenced texture is not in the project. |
| [T3D-W202](messages/T3D-W202.md) | `unity-prefab-missing` | warning | A referenced prefab is not in the project. |
| [T3D-W203](messages/T3D-W203.md) | `unity-material-unreadable` | warning | A material file holds no material. |
| [T3D-W204](messages/T3D-W204.md) | `unity-model-format-unknown` | warning | A referenced model is in a format no driver reads. |
| [T3D-W205](messages/T3D-W205.md) | `unity-model-nested-scene` | warning | A referenced model is itself a Unity scene, which is not nested. |
| [T3D-W206](messages/T3D-W206.md) | `unity-model-import-failed` | warning | A referenced model could not be imported; the note carries its reason. |
| [T3D-W207](messages/T3D-W207.md) | `unity-model-buffer-unreadable` | warning | A referenced model's imported data could not be read. |
| [T3D-W208](messages/T3D-W208.md) | `unity-model-mesh-by-fileid` | warning | A mesh of a multi-mesh model could not be found by its id, so the whole model is placed. |
| [T3D-W209](messages/T3D-W209.md) | `unity-metallic-map-unconverted` | warning | A packed metallic-smoothness map was not converted; the factors are kept. |
| [T3D-W210](messages/T3D-W210.md) | `unity-texture-format` | warning | A texture in a format the image readers do not decode was dropped. |
| [T3D-W211](messages/T3D-W211.md) | `unity-texture-outside-source` | warning | A texture outside the project's served folder was not copied. |
| [T3D-W212](messages/T3D-W212.md) | `unity-texture-transform` | warning | A texture's tiling or offset was dropped. |
| [T3D-W213](messages/T3D-W213.md) | `unity-texture-wrap-unsupported` | warning | A wrap mode glTF lacks (Mirror Once) was replaced by repeat. |
| [T3D-W214](messages/T3D-W214.md) | `unity-texture-filter-unsupported` | warning | A texture filter outside point, bilinear and trilinear was replaced by the default. |
| [T3D-W215](messages/T3D-W215.md) | `unity-emission-clamped` | warning | An HDR emission above 1 was clamped. |
| [T3D-I014](messages/T3D-I014.md) | `unity-emission-keyword-off` | info | A material stores an emission colour but does not enable emission, so it does not glow. |
| [T3D-W216](messages/T3D-W216.md) | `unity-prefab-added-component-unconverted` | warning | A component a prefab instance adds was not converted. |
| [T3D-W217](messages/T3D-W217.md) | `unity-prefab-added-object-unplaced` | warning | An object a prefab instance adds under an undrawn object was kept under the instance root. |
| [T3D-I015](messages/T3D-I015.md) | `unity-prefab-modification-ignored` | info | A prefab modification that changes neither geometry nor rendering was ignored. |

## Node adapter and CLI

| Code | Name | Level | Message |
| --- | --- | --- | --- |
| [T3D-E079](messages/T3D-E079.md) | `COMPILER_PLATFORM_UNSUPPORTED` | error | The compiler has no build for this operating system and processor. |
| [T3D-E080](messages/T3D-E080.md) | `COMPILER_EXECUTABLE_MISSING` | error | The compiler program is missing. |
| [T3D-E081](messages/T3D-E081.md) | `COMPILER_EXECUTABLE_NOT_EXECUTABLE` | error | The compiler program exists but cannot be run. |
| [T3D-E082](messages/T3D-E082.md) | `COMPILER_STALE` | error | The compiler built in this checkout is older than its sources. |
| [T3D-E083](messages/T3D-E083.md) | `COMPILER_LINE_LIMIT` | error | The compiler printed a line longer than the protocol allows, so the run was stopped. |
| [T3D-E084](messages/T3D-E084.md) | `COMPILER_NO_POINTER` | error | The compiler ended without printing where its result is. |
| [T3D-E085](messages/T3D-E085.md) | `COMPILER_NOT_READY` | error | The compiler reported a result that is not ready. |
| [T3D-E086](messages/T3D-E086.md) | `COMPILER_EXIT` | error | The compiler stopped with an unexpected exit code and no error code. |
| [T3D-E087](messages/T3D-E087.md) | `STRICT_WARNINGS` | error | The compile succeeded with warnings, which `--strict` turns into a failure. |
| [T3D-E088](messages/T3D-E088.md) | `CUTOUT_SHEET_INVALID` | error | The cutout answer sheet is not one this version reads. |
| [T3D-E089](messages/T3D-E089.md) | `CUTOUT_PREVIEW_UNSUPPORTED` | error | A cutout preview image is not a whole 8-bit RGBA PNG. |
