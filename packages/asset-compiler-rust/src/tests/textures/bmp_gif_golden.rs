//! Goldens of the BMP and GIF drivers, by the full path: a real glTF scene whose
//! only colour texture is a bottom-up BMP, then an indexed GIF, compiled by the
//! common harness.
//!
//! What these goldens fix, which the in-vitro tests in `plugins/tests/` cannot,
//! is the image as an engine will read it: the bytes of the progressive previews,
//! after the whole compiler has run. That is where BMP row order is truly proven
//! — an image stored bottom-up and put right-side-up is indistinguishable from a
//! flipped image until one looks at the pixels that arrived at the end of the chain.
//!
//! Regenerating the expected, from the repository root:
//!
//! ```text
//! cargo test --release --manifest-path packages/asset-compiler-rust/Cargo.toml \
//!   -- --ignored regenerate_the_bmp_and_gif_fixtures --nocapture
//! npx prettier --write tests/fixtures/formats/bmp/expected.json \
//!   tests/fixtures/formats/gif/expected.json
//! ```
//!
//! Ignored by default: it writes into `tests/fixtures/formats/`. The diff it produces is
//! re-read before being committed — an expected regenerated without reading no
//! longer watches anything.
use super::previews_golden::previews_digest;
use super::*;

/// The two fixtures and the sentence that says what each puts under watch. The
/// scene and its binary are the same on both sides — a quad, two triangles, the
/// texture on its whole face — so the only difference between the two expecteds
/// is the image format.
const FIXTURES: [(&str, &str); 2] = [
    (
        "bmp",
        "A quad whose base colour is vraies-couleurs-24-bas.bmp, a 4 × 2 24-bit true-colour BMP stored bottom-up, compiled by the common harness.",
    ),
    (
        "gif",
        "A quad whose base colour is palette-globale.gif, a 4 × 2 GIF indexed on a global colour table of eight entries, compiled by the common harness.",
    ),
];
const RULE: &str = "Each colour texture carries the lossless tail of its mip chain, from the first level whose neither side exceeds 64 through 1×1, in RGBA8 sRGB with straight alpha. Neither BMP nor GIF adds loss: the first is read as-is and put back in image order, the second is indexed, and a colour table already carries 8-8-8.";

// Behaviour: both web-legacy formats go through the whole compiler, and every
// byte of their previews is compared to expected.json — provenance, level
// geometry and pixels.
#[test]
fn les_apercus_des_deux_formats_herites_suivent_leur_expected_json() {
    for (format, _) in FIXTURES {
        let dir = golden_dir(format);
        let run = compile_golden(&dir, "scene");
        assert_eq!(
            previews_digest(&run),
            golden_expected(&dir),
            "fixture {format}: texture previews diverge from expected.json"
        );
    }
}

#[test]
#[ignore = "writes into tests/fixtures/formats/; rerun by hand, and its diff is re-read"]
fn regenerate_the_bmp_and_gif_fixtures() {
    for (format, case) in FIXTURES {
        let dir = golden_dir(format);
        let run = compile_golden(&dir, "scene");
        write_expected(&dir, previews_digest(&run), case, RULE);
    }
}
