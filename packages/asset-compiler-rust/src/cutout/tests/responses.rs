//! Answer reading, and what an answer changes in scene.
use super::*;
use crate::tests::directories::scratch;
use crate::tests::textures::previews_source::encode;
use crate::texture::{collect, source};

fn write_sheet(directory: &Path, sheet: &Value) {
    fs::write(
        directory.join(DECISIONS_FILE),
        serde_json::to_vec(sheet).expect("sheet"),
    )
    .expect("write");
}

/// Scene of mesh, blend material, and embedded image whose bytes are
/// binary itself: sheet sorts by fingerprint of these bytes.
fn scene() -> (Value, Vec<u8>, String) {
    let bin = b"some image bytes".to_vec();
    let g = json!({"meshes":[{"primitives":[{"material":0}]}],
        "materials":[{"alphaMode":"BLEND","pbrMetallicRoughness":{"baseColorTexture":{"index":0}}}],
        "textures":[{"source":0}],"images":[{"bufferView":0}],
        "bufferViews":[{"buffer":0,"byteOffset":0,"byteLength":bin.len()}]});
    let sha = hash(&bin);
    (g, bin, sha)
}

fn appliquer(g: &mut Value, bin: &[u8], decisions: &mut Decisions) -> CutoutApplied {
    let root = Path::new(".");
    let used = collect::used_materials(g, &BTreeSet::from([0usize])).expect("used");
    let shas = source::ImageShas::of(g, bin, root, &used);
    let o = crate::tests::fixtures::options_in(root);
    apply_decisions((&o, 0), g, (bin, root), (&used, &shas), decisions).expect("apply")
}

/// Writes a sheet answering `cutout` for the texture `sha`, reads it back and applies it.
fn answer(directory: &Path, g: &mut Value, bin: &[u8], sha: &str, cutout: bool) -> CutoutApplied {
    write_sheet(
        directory,
        &json!({"version":1,"textures":{sha:{"cutout":cutout}}}),
    );
    let mut decisions = load_decisions(directory, directory).expect("read");
    appliquer(g, bin, &mut decisions)
}

/// The scene with its image the PNG of a `side`-square whose alpha `alpha` gives per texel.
fn png_scene(side: u32, alpha: impl Fn(u32, u32) -> u8) -> (Value, Vec<u8>) {
    let bin = encode(image::RgbaImage::from_fn(side, side, |x, y| {
        image::Rgba([90, 140, 60, alpha(x, y)])
    }));
    let (mut g, _, _) = scene();
    g["bufferViews"][0]["byteLength"] = json!(bin.len());
    g["images"][0]["mimeType"] = json!("image/png");
    (g, bin)
}

/// A leaf: present inside a disc, absent outside, hard edged.
fn leaf(x: u32, y: u32) -> u8 {
    let (dx, dy) = (x as i32 - 32, y as i32 - 32);
    if dx * dx + dy * dy < 24 * 24 {
        255
    } else {
        0
    }
}

// Behavior: with no answer, the measurement decides — a leaf turns masked, a pane whose alpha
// lies halfway stays blend —, and the preview step finds the measurement kept.
#[test]
fn with_no_answer_the_measurement_decides() {
    let directory = scratch("decoupes", "mesure");
    let (mut g, bin) = png_scene(64, leaf);
    let mut decisions = load_decisions(&directory, &directory).expect("read");
    let applied = appliquer(&mut g, &bin, &mut decisions);
    assert_eq!(g["materials"][0]["alphaMode"], json!("MASK"));
    assert_eq!(applied.applied.len(), 1);
    assert!(decisions.measurements.known(&hash(&bin)).is_some());
    let (mut pane, bin) = png_scene(64, |_, _| 96);
    let mut decisions = load_decisions(&directory, &directory).expect("read");
    appliquer(&mut pane, &bin, &mut decisions);
    assert_eq!(pane["materials"][0]["alphaMode"], json!("BLEND"));
}

// Behavior: an answer overrides the measurement: a leaf answered transparent stays blend.
#[test]
fn an_answer_overrides_the_measurement() {
    let directory = scratch("decoupes", "contre-mesure");
    let (mut g, bin) = png_scene(64, leaf);
    answer(&directory, &mut g, &bin, &hash(&bin), false);
    assert_eq!(g["materials"][0]["alphaMode"], json!("BLEND"));
}

// Behavior: an image that does not decode has no measurement: without an answer, blend stays
// blend, and the report says so.
#[test]
fn an_unreadable_image_without_an_answer_stays_blend() {
    let directory = scratch("decoupes", "vide");
    let mut decisions = load_decisions(&directory, &directory).expect("read");
    let (mut g, bin, _) = scene();
    let applied = appliquer(&mut g, &bin, &mut decisions);
    assert_eq!(g["materials"][0]["alphaMode"], json!("BLEND"));
    assert_eq!(applied.report(&decisions)["candidateTextures"], json!(1));
    assert!(
        applied.applied.is_empty(),
        "nothing is applied without an answer or a measurement"
    );
}

// Behavior: "cutout" answer sets material to mask, at glTF threshold, and
// report names changed binding.
#[test]
fn a_cutout_answer_turns_the_material_masked() {
    let directory = scratch("decoupes", "decoupe");
    let (mut g, bin, sha) = scene();
    let applied = answer(&directory, &mut g, &bin, &sha, true);
    assert_eq!(g["materials"][0]["alphaMode"], json!("MASK"));
    assert_eq!(g["materials"][0]["alphaCutoff"], json!(0.5));
    assert_eq!(applied.applied[0]["texture"], json!(0));
    assert_eq!(applied.to_measure(), BTreeSet::from([0usize]));
}

// Behavior: "window" answer, and never decided texture, leave scene intact.
#[test]
fn a_pane_answer_leaves_the_scene_intact() {
    let directory = scratch("decoupes", "vitre");
    let (mut g, bin, sha) = scene();
    answer(&directory, &mut g, &bin, &sha, false);
    assert_eq!(g["materials"][0]["alphaMode"], json!("BLEND"));
}

// Behavior: material transmitting light is refused despite answer — its thickness
// is not a cutout —, refusal named rather than quiet.
#[test]
fn a_transmission_is_refused_despite_the_answer() {
    let directory = scratch("decoupes", "transmission");
    let (mut g, bin, sha) = scene();
    g["materials"][0]["extensions"] =
        json!({"KHR_materials_transmission":{"transmissionFactor":0.8}});
    let applied = answer(&directory, &mut g, &bin, &sha, true);
    assert_eq!(g["materials"][0]["alphaMode"], json!("BLEND"));
    assert_eq!(applied.refused[0]["reason"], json!("transmission"));
}

// Behavior: material whose alpha factor is already partial is likewise refused — its
// opacity does not come from texture, cutting out would not yield it.
#[test]
fn a_partial_alpha_factor_is_refused() {
    let directory = scratch("decoupes", "facteur");
    let (mut g, bin, sha) = scene();
    g["materials"][0]["pbrMetallicRoughness"]["baseColorFactor"] = json!([1.0, 1.0, 1.0, 0.4]);
    let applied = answer(&directory, &mut g, &bin, &sha, true);
    assert_eq!(g["materials"][0]["alphaMode"], json!("BLEND"));
    assert_eq!(applied.refused[0]["reason"], json!("alpha-factor"));
}

// Behavior: null answer is undecided texture, not an error; unknown version
// and answer of another type refused, because misread answer would change
// image without user asking.
#[test]
fn an_unreadable_sheet_is_refused_and_a_null_answer_waits() {
    let directory = scratch("decoupes", "formes");
    write_sheet(
        &directory,
        &json!({"version":1,"textures":{"abc":{"cutout":Value::Null}}}),
    );
    assert_eq!(
        load_decisions(&directory, &directory)
            .expect("read")
            .verdict("abc"),
        None
    );
    write_sheet(&directory, &json!({"version":99,"textures":{}}));
    assert!(load_decisions(&directory, &directory).is_err());
    write_sheet(
        &directory,
        &json!({"version":1,"textures":{"abc":{"cutout":"oui"}}}),
    );
    assert!(load_decisions(&directory, &directory).is_err());
}

// Behavior: sheet delivered next to source seeds first compilation, when
// compiled model does not have one yet.
#[test]
fn a_sheet_shipped_with_the_source_seeds() {
    let (cache, source) = (scratch("decoupes", "cache"), scratch("decoupes", "source"));
    write_sheet(
        &source,
        &json!({"version":1,"textures":{"abc":{"cutout":true}}}),
    );
    assert_eq!(
        load_decisions(&cache, &source)
            .expect("read")
            .verdict("abc"),
        Some(true)
    );
}
