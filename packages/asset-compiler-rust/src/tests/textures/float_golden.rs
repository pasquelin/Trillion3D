//! Floating point driver golden test: real glTF scene with single
//! color texture (EXR or Radiance HDR), compiled via common harness.
//!
//! What these goldens fix is the half-float chain: a floating point image read as a base colour
//! is not cut down to eight bits — it is chained in float and held in the half-float atlas, its
//! tail in the sidecar and the levels above it as files. The decoded values are tested in
//! `src/plugins/tests/`, the chain's in `src/texture/tests/half_chain.rs`.
use super::*;

// Behavior: floating point texture passes through compiler without failure or 8-bit clipping;
// its half-float chain is baked and counted in the previews report.
#[test]
fn a_float_texture_is_baked_in_half_floats_rather_than_reduced_to_eight_bits() {
    for format in ["exr", "hdr"] {
        let fixture_dir = golden_dir(format);
        let run = compile_golden(&fixture_dir, "scene");
        assert_eq!(
            float_digest(&run),
            golden_expected(&fixture_dir),
            "fixture {format}: compiled output diverges from expected.json"
        );
    }
}

/// Golden comparison: image contract binary publishes, driver claiming
/// texture, preview report — the baked levels —, and scene.
fn float_digest(run: &GoldenRun) -> Value {
    json!({
      "imageContract": plugins::image::VERSION,
      "report": run.result["texturePreviews"],
      "scene": {
        "formatVersion": run.result["formatVersion"],
        "manifestBinaryVersion": run.slim["binary"]["version"],
        "sidecarSha256": hash(&run.binary),
        "primitives": run.result["primitives"].as_array().expect("primitives").len(),
        "selectedTriangles": run.result["selectedTriangles"],
        "texturePreviewBytes": run.slim["binary"]["texturePreviewBytes"],
      },
    })
}

#[test]
#[ignore = "writes into tests/fixtures/formats/; rerun by hand, and its diff is re-read"]
fn regenerate_the_float_fixtures() {
    for format in ["exr", "hdr"] {
        let dir = golden_dir(format);
        let run = compile_golden(&dir, "scene");
        write_expected(&dir, float_digest(&run), "", "");
    }
}
