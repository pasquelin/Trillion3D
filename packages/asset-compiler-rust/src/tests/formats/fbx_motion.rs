//! An FBX that bends (#357): a leaf skinned to one bone, a blend shape that curls it, and a stack
//! that slides the bone two metres in one second. The conversion writes a skin, a morph target
//! and a clip; the compilation pages the skinned leaf and tables its motion.
use super::*;
use crate::tests::scene::scene_tables::tables_of;

#[test]
fn an_fbx_skin_blend_shape_and_stack_reach_the_scene_tables() {
    let (root, mut options) = fixture();
    let source = root.join("fbx");
    fs::create_dir_all(&source).expect("fbx dir");
    let fbx = fs::read(golden_dir("import-fbx").join("bend.fbx")).expect("fixture");
    fs::write(source.join("bend.fbx"), &fbx).expect("fbx");
    options.source = source.join("bend.fbx");
    options.scope = "full".into();
    let result = compile(&options, |_| {}).expect("compile fbx");
    let flags = result["primitives"][0]["pages"][0]["geometry"]["flags"].as_u64();
    assert_eq!(
        flags.expect("a paged leaf") & 48,
        48,
        "skin and target paged"
    );
    let tables = tables_of(&options);
    let leaf = tables["nodes"]
        .as_array()
        .expect("nodes")
        .iter()
        .find(|n| n["name"] == "leaf");
    let skin = leaf.expect("the leaf")["skin"].as_u64().expect("skinned") as usize;
    let bone = tables["skins"][skin]["joints"][0].as_u64().expect("a bone") as usize;
    assert_eq!(tables["nodes"][bone]["name"], "stem");
    let clip = &tables["animations"][0];
    assert_eq!(clip["name"], "sway");
    let channel = clip["channels"]
        .as_array()
        .expect("channels")
        .iter()
        .find(|c| c["node"] == bone);
    let channel = channel.expect("the bone moves");
    assert_eq!(channel["path"], "translation");
    let values = channel["values"].as_array().expect("values");
    assert_eq!(
        values[values.len() - 3],
        json!(2.0),
        "two metres at the last key"
    );
    assert_eq!(
        channel["times"].as_array().expect("times").last(),
        Some(&json!(1.0))
    );
    fs::remove_dir_all(root).expect("cleanup");
}

#[test]
fn fbx_long_clip_preserves_end_and_nonunit_blend_weight() {
    let (root, mut options) = fixture();
    let text = fs::read_to_string(golden_dir("import-fbx").join("bend.fbx"))
        .unwrap()
        .replace("46186158000", "110846779200000")
        .replace("DeformPercent: 0", "DeformPercent: 25")
        .replace("a: 100\n", "a: 50\n");
    options.source = root.join("long.fbx");
    fs::write(&options.source, text).unwrap();
    options.scope = "full".into();
    compile(&options, |_| {}).expect("long FBX with two source keys");
    let tables = tables_of(&options);
    let channels = tables["animations"][0]["channels"].as_array().unwrap();
    let translation = channels
        .iter()
        .find(|c| c["path"] == "translation")
        .unwrap();
    assert_eq!(translation["times"], json!([0.0, 2400.0]));
    let weights = channels.iter().find(|c| c["path"] == "weights").unwrap();
    assert_eq!(weights["values"], json!([0.5, 0.5]));
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn discontinuous_fbx_curves_are_refused_instead_of_smoothed() {
    let (root, mut options) = fixture();
    let text = fs::read_to_string(golden_dir("import-fbx").join("bend.fbx"))
        .unwrap()
        .replace("24836", "24834");
    options.source = root.join("step.fbx");
    fs::write(&options.source, text).unwrap();
    let error = compile(&options, |_| {}).expect_err("discontinuous motion must not be smoothed");
    assert!(format!("{error:?}").contains("IMPORT_UNSUPPORTED_ANIMATION"));
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn rotating_fbx_skin_emits_quaternion_tracks_in_compiled_tables() {
    let (root, mut options) = fixture();
    let text = fs::read_to_string(golden_dir("import-fbx").join("bend.fbx"))
        .unwrap()
        .replace("Lcl Translation", "Lcl Rotation")
        .replace("a: 0,2\n", "a: 0,720\n");
    options.source = root.join("rotation.fbx");
    fs::write(&options.source, text).unwrap();
    options.scope = "full".into();
    compile(&options, |_| {}).expect("ordinary rotating skeletal clip");
    let tables = tables_of(&options);
    let rotation = tables["animations"][0]["channels"]
        .as_array()
        .unwrap()
        .iter()
        .find(|channel| channel["path"] == "rotation")
        .unwrap();
    assert!(rotation["times"].as_array().unwrap().len() > 24);
    assert!(rotation["values"]
        .as_array()
        .unwrap()
        .chunks(4)
        .any(|quaternion| quaternion[0].as_f64().unwrap().abs() > 0.9));
    fs::remove_dir_all(root).unwrap();
}
