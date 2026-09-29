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
