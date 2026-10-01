# Third-party notices

Trillion3D ships the following third-party software in its builds. Each keeps its own licence.

## Jolt Physics

- Source: https://github.com/jrouwe/JoltPhysics, pinned as the git submodule
  `packages/physics-jolt-wasm/JoltPhysics` (tag `v5.6.0`); its sources are not copied into this
  repository.
- Shipped as: `packages/sdk-browser/src/physics/joltPhysics.wasm` and
  `packages/sdk-browser/src/physics/joltPhysicsThreads.wasm` (the threaded build), both built from
  those sources by `scripts/build-physics-wasm.ts`. This notice travels with them: in the npm
  package, and beside them in the site's `docs/runtime/`.
- Licence: MIT.

```text
Copyright 2021 Jorrit Rouwe

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
```

## draco-core

- Source: https://github.com/Filyus/draco-rust, crate `draco-core` pinned at `2.1.0`.
- Shipped in: the native asset compiler, for `KHR_draco_mesh_compression` decoding.
- Licence: Apache-2.0; see https://www.apache.org/licenses/LICENSE-2.0.
- Only mesh decoding and EdgeBreaker valence decoding are enabled; no encoder or point-cloud decoder is linked.

## mimalloc

- Linked into the native compiler binary as its allocator (#1352), through the crates `mimalloc`
  and `libmimalloc-sys`, versions pinned in `packages/asset-compiler-rust/Cargo.lock`.
- Source: https://github.com/microsoft/mimalloc and https://github.com/purpleprotocol/mimalloc_rust.
- Licence: MIT; copyright (c) 2018-2021 Microsoft Corporation, Daan Leijen, and (c) 2019 Octavian
  Oncescu. Notices kept with the dependency.

## Image and texture readers of the native compiler

Shipped in the native asset compiler, versions pinned in
`packages/asset-compiler-rust/Cargo.toml` and `Cargo.lock`; each crate's notices are kept with the
dependency. The fixtures that prove them are described in
[`tests/fixtures/formats/README.md`](tests/fixtures/formats/README.md).

| crate | version | licence | source | used for |
| --- | --- | --- | --- | --- |
| `exr` | 1.74.2 | BSD-3-Clause | https://github.com/johannesvollmer/exrs | OpenEXR reads; pure Rust, without `unsafe` |
| `texture2ddecoder` | 0.1.2 | MIT or Apache-2.0 | https://github.com/UniversalGameExtraction/texture2ddecoder | GPU block reconstruction (BCn, ETC2, EAC, ASTC) for the `dds` and `ktx2` drivers, through the `image::blocks` foundation; pure Rust |
| `basisu` | 0.1.0 | Apache-2.0 | https://github.com/marcogomez/basisu | Basis Universal payloads in KTX 2.0; pure Rust, a port of Binomial's reference transcoder verified byte for byte against it |
| `ruzstd` | 0.7.3 | MIT | https://github.com/KillingSpark/zstd-rs | Zstandard supercompression in KTX 2.0; pure Rust, decompression only |
| `avif-decode` | 3.0.0 | BSD-3-Clause | https://github.com/kornelski/avif-decode | AVIF still image decoding; no encoder or CLI |
| `avif-parse` | 2.1.0 | MPL-2.0 | https://github.com/kornelski/avif-parse | AVIF demuxing and AV1 sequence metadata; upstream sources remain unmodified |
| `rav1d` | 1.1.0 | BSD-2-Clause | https://github.com/memorysafety/rav1d | AV1 decoding, a Rust port of dav1d with platform assembly |

## Source XML reader

`roxmltree` 0.20.0 (MIT or Apache-2.0), https://github.com/RazrFalcon/roxmltree,
reads source-format XML. DTD processing is disabled. Its licence notices remain with
the dependency; no editor or external application SDK is linked.


## CAD source readers

- `cadmpeg-codec-rhino`, `cadmpeg-core`, `cadmpeg-ir` and their `cadmpeg-container`
  dependency, version 0.5.5, Apache-2.0, https://github.com/cadmpeg/cadmpeg.
  The compiler uses bounded read-only Rhino decoding and its native metadata.
  `cadmpeg-codec-rhino` is vendored with one source change correcting the CRC
  coverage of instance-definition wrappers; see
  [`PATCH.md`](packages/asset-compiler-rust/vendor/cadmpeg-codec-rhino/PATCH.md).
  Its upstream Apache-2.0 licence is retained. The other cadmpeg sources are unmodified.
- `ifc-lite-core` 20.2.0, MPL-2.0, https://github.com/LTplus-AG/ifc-lite.
  Only the STEP syntax/entity reader is linked; geometry is converted by the compiler's
  bounded format adapter. Upstream source remains unmodified and is available at that
  repository and https://crates.io/crates/ifc-lite-core/20.2.0.
- Fixture generation uses McNeel's `rhino3dm` independently of the runtime decoder;
  the fixture README records its MIT licence and the authored sample provenance.

## Isolated JSON dependency features

- `serde_json` 1.0.151, MIT OR Apache-2.0, https://github.com/serde-rs/json.
  Its unchanged source and build script are vendored as package `serde_json_legacy`
  for the compiler's existing JSON feature domain. Only the package name in its
  manifest changes; both upstream licences are included. This prevents cadmpeg's
  `float_roundtrip` requirement from changing historical Maya/Unity numeric bits,
  while preserving that feature for cadmpeg itself. See
  [`PATCH.md`](packages/asset-compiler-rust/vendor/serde-json-legacy/PATCH.md).
