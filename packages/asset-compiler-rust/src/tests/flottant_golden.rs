//! Floating point driver golden test: real glTF scene with single
//! color texture (EXR or Radiance HDR), compiled via common harness.
//!
//! What these goldens fix is not an image but a **refusal**: progressive previews are
//! sRGB RGBA8, floating point image does not enter without tone mapping (lossy).
//! Compilation succeeds, texture counted, reason `image-float-unsupported`
//! reported. Decoded values tested in `src/plugins/tests/`.
use super::*;

// Behavior: floating point texture passes through compiler without failure or 8-bit clipping;
// reported in previews report, per image contract reason.
#[test]
fn une_texture_flottante_est_nommee_au_rapport_plutot_que_ramenee_a_huit_bits() {
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
/// texture, preview report — origin of named refusal —, and scene.
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
#[ignore = "writes into fixtures/; rerun by hand, and its diff is re-read"]
fn regenerate_the_float_fixtures() {
    for format in ["exr", "hdr"] {
        let dir = golden_dir(format);
        let run = compile_golden(&dir, "scene");
        write_expected(&dir, float_digest(&run), "", "");
    }
}
