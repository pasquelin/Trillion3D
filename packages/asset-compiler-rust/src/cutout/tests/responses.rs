//! Answer reading, and what an answer changes in scene.
use super::*;
use std::time::{SystemTime, UNIX_EPOCH};

fn fresh_folder(nom: &str) -> PathBuf {
    let path = std::env::temp_dir().join(format!(
        "web-geometry-decoupes-{nom}-{}-{}",
        std::process::id(),
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock")
            .as_nanos()
    ));
    fs::create_dir_all(&path).expect("dir");
    path
}

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

fn appliquer(g: &mut Value, bin: &[u8], decisions: &Decisions) -> CutoutApplied {
    apply_decisions(g, bin, Path::new("."), &BTreeSet::from([0usize]), decisions).expect("apply")
}

/// Writes a sheet answering `cutout` for the texture `sha`, reads it back and applies it.
fn answer(directory: &Path, g: &mut Value, bin: &[u8], sha: &str, cutout: bool) -> CutoutApplied {
    write_sheet(
        directory,
        &json!({"version":1,"textures":{sha:{"cutout":cutout}}}),
    );
    let decisions = load_decisions(directory, directory).expect("read");
    appliquer(g, bin, &decisions)
}

// Behavior: without sheet, nothing changes. Blend stays blend, report says so.
#[test]
fn without_a_sheet_blend_stays_blend() {
    let directory = fresh_folder("vide");
    let decisions = load_decisions(&directory, &directory).expect("read");
    let (mut g, bin, _) = scene();
    let applied = appliquer(&mut g, &bin, &decisions);
    assert_eq!(g["materials"][0]["alphaMode"], json!("BLEND"));
    assert_eq!(applied.report(&decisions)["candidateTextures"], json!(1));
    assert!(
        applied.applied.is_empty(),
        "nothing is applied without an answer"
    );
}

// Behavior: "cutout" answer sets material to mask, at glTF threshold, and
// report names changed binding.
#[test]
fn a_cutout_answer_turns_the_material_masked() {
    let directory = fresh_folder("decoupe");
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
    let directory = fresh_folder("vitre");
    let (mut g, bin, sha) = scene();
    answer(&directory, &mut g, &bin, &sha, false);
    assert_eq!(g["materials"][0]["alphaMode"], json!("BLEND"));
}

// Behavior: material transmitting light is refused despite answer — its thickness
// is not a cutout —, refusal named rather than quiet.
#[test]
fn a_transmission_is_refused_despite_the_answer() {
    let directory = fresh_folder("transmission");
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
    let directory = fresh_folder("facteur");
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
    let directory = fresh_folder("formes");
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
    let (cache, source) = (fresh_folder("cache"), fresh_folder("source"));
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
