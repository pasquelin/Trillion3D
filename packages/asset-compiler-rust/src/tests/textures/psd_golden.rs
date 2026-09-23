//! Golden of the `psd` driver: the only coverage of the full path real glTF →
//! `compile()` → cache → binary sidecar for a Photoshop texture. The in-vitro
//! tests in `plugins/tests/psd.rs` fix the decode; this one fixes the image as an
//! engine will really read it, once the flattened composite has gone through the
//! whole compiler.
//!
//! The scene is the floating golden's quad, its base colour replaced by
//! `rgb-brut.psd`: a PSD texture enters progressive previews like any eight-bit
//! source, without refusal and without added loss. Fixture provenance is in
//! `tests/fixtures/formats/psd/README.md`.
//!
//! Regenerating the expected, from the repository root:
//!
//! ```text
//! cargo test --release --manifest-path packages/asset-compiler-rust/Cargo.toml \
//!   -- --ignored regenere_la_fixture_psd --nocapture
//! npx prettier --write tests/fixtures/formats/psd/expected.json
//! ```
//!
//! Ignored by default: it writes into `tests/fixtures/formats/`. The diff it produces is
//! re-read before being committed — an expected regenerated without reading no
//! longer watches anything.
use super::previews_golden::previews_digest;
use super::*;

const CASE: &str = "A quad whose base colour is rgb-brut.psd, a flattened 4 × 2 Photoshop composite in eight-bit RGB with a raw surface, compiled by the common harness.";
const RULE: &str = "A flattened composite of eight bits per channel enters progressive previews like any other RGBA8 source: the lossless tail of its mip chain is produced, no reason is carried in the report, and the pixels are those the file already carried — never recomposed layers.";

// Behaviour: the golden PSD-texture fixture goes through the compiler and every
// byte of its previews is compared to expected.json — provenance, level geometry,
// pixels and coverage.
#[test]
fn psd_texture_previews_match_their_golden_expected_json() {
    let dir = golden_dir("psd");
    let run = compile_golden(&dir, "scene");
    assert_eq!(
        previews_digest(&run),
        golden_expected(&dir),
        "fixture psd: texture previews diverge from expected.json"
    );
}

#[test]
#[ignore = "writes into tests/fixtures/formats/; rerun by hand, and its diff is re-read"]
fn regenere_la_fixture_psd() {
    let dir = golden_dir("psd");
    let run = compile_golden(&dir, "scene");
    write_expected(&dir, previews_digest(&run), CASE, RULE);
}
