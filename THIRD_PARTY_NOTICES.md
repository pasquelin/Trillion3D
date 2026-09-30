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
