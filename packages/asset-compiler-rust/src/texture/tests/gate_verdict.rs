//! The gate's verdict file: read back by the next cook of the same chain, and
//! only when the files it vouches for are there.
use super::gate::{normal_map, scene};
use super::*;

// Behaviour: the gate's verdict is kept beside the level files and taken as
// read by the next cook of the same chain and sheet — a verdict that refuses
// leaves the chain out of the family without encoding it again, one that
// says kept but whose block files are gone is not trusted and the chain is
// cooked anew. The stored BC chain is there throughout.
#[test]
fn a_kept_verdict_is_read_back_and_a_verdict_without_its_files_is_not() {
    let dir = scratch("texture-preview", "gate-verdict");
    normal_map(128, 128)
        .save(dir.join("map.png"))
        .expect("save");
    let scene = scene(json!({"normalTexture": {"index": 0}}));
    let stage = || stage_scene_in(&dir, &scene, vec![BlockFormat::Bc7, BlockFormat::Etc2]);
    let (previews, _) = stage();
    let native = dir.join("cache").join("native");
    let folder = native
        .join(level_path(
            &previews[0].sha256,
            AtlasKind::Data,
            0,
            "eac-rg",
        ))
        .parent()
        .unwrap()
        .to_path_buf();
    let verdict = folder.join("linear-eac-rg.gate.json");
    assert!(verdict.is_file(), "a verdict file");
    // The same chain under a verdict forged as refused: followed, no encode, no tail in ETC2.
    fs::write(
        &verdict,
        br#"{"squared":1e9,"samples":1,"maxDelta":200,"maskFlips":0}"#,
    )
    .unwrap();
    let (previews, report) = stage();
    assert_eq!(previews[0].layouts, [Some(Layout::TwoChannel), None, None]);
    assert_eq!(report["lossless"][0]["maxDelta"], json!(200));
    // A kept verdict whose level file is gone: cooked anew, the file and the tail are back.
    fs::write(
        &verdict,
        br#"{"squared":0.0,"samples":1,"maxDelta":0,"maskFlips":0}"#,
    )
    .unwrap();
    let level = native.join(level_path(
        &previews[0].sha256,
        AtlasKind::Data,
        0,
        "eac-rg",
    ));
    fs::remove_file(&level).unwrap();
    let (previews, _) = stage();
    let two = Some(Layout::TwoChannel);
    assert_eq!(previews[0].layouts, [two, None, two]);
    assert!(level.exists());
    let rewritten: Value = serde_json::from_slice(&fs::read(&verdict).unwrap()).unwrap();
    assert!(
        rewritten["samples"].as_u64().unwrap() > 1,
        "the verdict is the new measure"
    );
}
