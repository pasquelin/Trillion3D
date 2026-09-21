//! The gate's verdict file: read back by the next cook of the same chain, and
//! only when the files it vouches for are there.
use super::gate::{normal_map, scene};
use super::*;

// Behaviour: the gate's verdict is kept beside the level files and taken as
// read by the next cook of the same chain and sheet — a verdict that says
// lossless leaves the chain lossless without encoding it again, one that says
// kept but whose block files are gone is not trusted and the chain is cooked anew.
#[test]
fn a_kept_verdict_is_read_back_and_a_verdict_without_its_files_is_not() {
    let dir = temp_dir("gate-verdict");
    normal_map(128, 128)
        .save(dir.join("map.png"))
        .expect("save");
    let scene = scene(json!({"normalTexture": {"index": 0}}));
    let (previews, _) = stage_scene(&dir, &scene);
    let native = dir.join("cache").join("native");
    let folder = native
        .join(level_path(&previews[0].sha256, AtlasKind::Data, 0, "bc5"))
        .parent()
        .unwrap()
        .to_path_buf();
    let verdict = fs::read_dir(&folder)
        .expect("folder")
        .flatten()
        .map(|entry| entry.path())
        .find(|path| path.to_string_lossy().ends_with(".gate.json"))
        .expect("a verdict file");
    assert!(verdict
        .file_name()
        .unwrap()
        .to_string_lossy()
        .starts_with("linear-bc5-rgb"));
    // The same chain under a verdict forged as lossless: followed, no encode, no tail.
    fs::write(
        &verdict,
        br#"{"squared":1e9,"samples":1,"maxDelta":200,"maskFlips":0}"#,
    )
    .unwrap();
    let (previews, report) = stage_scene(&dir, &scene);
    assert_eq!(previews[0].layouts, [None; 2]);
    assert_eq!(report["lossless"][0]["maxDelta"], json!(200));
    // A kept verdict whose level file is gone: cooked anew, the file and the tail are back.
    fs::write(
        &verdict,
        br#"{"squared":0.0,"samples":1,"maxDelta":0,"maskFlips":0}"#,
    )
    .unwrap();
    fs::remove_file(native.join(level_path(&previews[0].sha256, AtlasKind::Data, 0, "bc5")))
        .unwrap();
    let (previews, _) = stage_scene(&dir, &scene);
    assert_eq!(previews[0].layouts, [Some(Layout::TwoChannel), None]);
    assert!(native
        .join(level_path(&previews[0].sha256, AtlasKind::Data, 0, "bc5"))
        .exists());
    let rewritten: Value = serde_json::from_slice(&fs::read(&verdict).unwrap()).unwrap();
    assert!(
        rewritten["samples"].as_u64().unwrap() > 1,
        "the verdict is the new measure"
    );
}
