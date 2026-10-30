# Adding a format

A format is a driver module and a registry line under `packages/asset-compiler-rust/src/plugins/`;
core and command line name no format. [Input formats](input-formats.md#input-formats) says which formats are
admitted and on what condition; a driver outside it is not merged.

- A scene driver, `plugins/scene/<format>.rs`, is named after the format, never its library, is
  listed in `scene::PLUGINS` and produces the intermediate glTF scene under the cache, never beside
  the source; the contract is `plugins/scene.rs`, a container's `plugins/scene/archive.rs`.
- An image driver, `plugins/image/<format>.rs`, is listed in `image::DECODERS` and decodes to RGBA8,
  or float for high dynamic range, under the ceiling it receives; its contract is
  `plugins/image.rs`.
- It comes with the smallest owned or redistributable fixture under
  [`tests/fixtures/formats/`](../../tests/fixtures/formats/README.md), compiled by the shared harness
  (`src/tests/golden.rs`), one test per behaviour, and its library's license in `Cargo.toml` and
  `THIRD_PARTY_NOTICES.md`.
