# Isolated JSON feature domain

Upstream: serde_json 1.0.151, https://github.com/serde-rs/json,
commit `de8500740cdcabffb9734f503e4889def823cf10`.
The published Rust sources, build script, README and MIT/Apache-2.0 licences
are unchanged. The only manifest change is the package name:
`serde_json` becomes `serde_json_legacy`; its library keeps the original name.
The unchanged upstream tests and their fixtures are retained because the published
manifest declares seven explicit test targets, which `cargo fmt --all` resolves.
No build caches or generated artifacts are vendored.

The compiler uses this package under its existing `serde_json` dependency alias,
with the same default features as before Rhino was introduced. cadmpeg continues
to use the upstream serde_json package with `float_roundtrip` and `raw_value`.
Distinct package identities prevent Cargo from unifying those feature sets.

Why isolation is necessary: cadmpeg-core, cadmpeg-ir and cadmpeg-codec-rhino all
require `float_roundtrip`. Globally activating it changes decimal parsing in
unrelated existing importers. The JSON token `-3.2584135922775204e-7` historically
parses to bits `be95dde974000001` without that feature; the roundtrip parser uses
`be95dde974000000`. Existing Maya and Unity bitwise output contracts must remain
unchanged; removing cadmpeg's precision requirement would instead risk its native
transform metadata. This packaging boundary preserves both behaviours without
changing either parser or weakening the existing golden assertions.

The native build fingerprint includes this source tree, manifest and build script.
Golden regression coverage remains in `tests/formats/ma/bits.rs` and
`tests/formats/unity/golden.rs`; Rhino fixtures exercise the independently retained
precise path, including transformed/reflected instances and source attributes.
