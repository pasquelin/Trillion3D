//! Correctness of `scene-tables.json`, the node table: which primitive is drawn where, by which
//! node, with which surface (#287). Its material table is proven by `tables_surface.rs`.
//!
//! Provenance of every case: the glTF the compilation itself publishes as `source.gltf`, built
//! here from the repository's own triangle fixture (`tests/base.rs`) — no asset is read from
//! outside this crate. Each case names the glTF field it comes from, so what the table claims can
//! be traced back to the specification it is read from.
use super::reuse::compile_with_events;
use super::*;

/// Cube corners on the fixture triangle's accessor, so a world box has something to grow from.
fn with_bounds(gltf: &mut Value) {
    gltf["accessors"][0]["min"] = json!([0.0, 0.0, 0.0]);
    gltf["accessors"][0]["max"] = json!([1.0, 1.0, 0.0]);
}
/// The tables a compilation published, as the runtime will read them.
pub(super) fn tables_of(options: &Options) -> Value {
    let result = compile(options, |_| {}).expect("compile");
    let directory = options.key_directory(result["key"].as_str().expect("key"));
    read_json(&directory.join("scene-tables.json"))
}
/// A full-scope compilation of the fixture, altered by the case before it is written back.
pub(super) fn published(alter: impl FnOnce(&mut Value)) -> (PathBuf, Value) {
    let (root, mut options) = fixture();
    let mut gltf = read_gltf(&options);
    with_bounds(&mut gltf);
    alter(&mut gltf);
    write_gltf(&options, &gltf, None);
    options.scope = "full".into();
    let tables = tables_of(&options);
    (root, tables)
}

#[test]
fn the_node_table_places_every_drawn_primitive() {
    // A parent that moves its two children: the pose written is the world pose, not the local one.
    let (_root, tables) = published(|gltf| {
        gltf["nodes"] = json!([
            {"name":"root","translation":[10.0,0.0,0.0],"children":[1,2]},
            {"name":"left","mesh":0},
            {"name":"right","mesh":0,"translation":[0.0,2.0,0.0]},
        ]);
    });
    let nodes = tables["nodes"].as_array().expect("nodes");
    assert_eq!(nodes.len(), 2, "one entry per drawn primitive: {tables}");
    assert_eq!(nodes[0]["name"], json!("left"));
    assert_eq!(
        nodes[0]["parent"],
        json!(0),
        "the hierarchy is in the table"
    );
    assert_eq!(nodes[0]["mesh"], json!(0));
    assert_eq!(nodes[0]["primitive"], json!(0));
    assert_eq!(
        nodes[0]["matrix"][12],
        json!(10.0),
        "world pose of the child"
    );
    assert_eq!(nodes[1]["matrix"][13], json!(2.0));
    // Instancing is the rank among the copies of one primitive, and nothing else repeats.
    assert_eq!(nodes[0]["instance"], json!(0));
    assert_eq!(nodes[1]["instance"], json!(1));
    // The box is the accessor's corners through that same pose.
    assert_eq!(
        nodes[0]["bounds"],
        json!({"min":[10.0,0.0,0.0],"max":[11.0,1.0,0.0]})
    );
    assert_eq!(
        nodes[1]["bounds"],
        json!({"min":[10.0,2.0,0.0],"max":[11.0,3.0,0.0]})
    );
    // A primitive that declares no material wears the glTF default one, which is an entry like
    // any other: the node table names a rank, never an absence.
    assert_eq!(nodes[0]["material"], json!(0));
    assert_eq!(
        tables["materials"][0]["metalness"],
        json!(1.0),
        "the glTF default: {tables}"
    );
    assert_eq!(tables["materials"][0]["roughness"], json!(1.0));
}

#[test]
fn the_node_table_describes_the_published_scene_and_not_the_input() {
    // The slice keeps one node of the two and renumbers what it keeps: the table follows the
    // document the runtime loads, so a node left out of the slice is absent from it.
    let (_root, mut options) = fixture();
    let mut gltf = read_gltf(&options);
    with_bounds(&mut gltf);
    gltf["meshes"] = json!([{"primitives":[]}, gltf["meshes"][0]]);
    gltf["nodes"] = json!([{"mesh":1},{"mesh":1}]);
    write_gltf(&options, &gltf, None);
    options.triangle_budget = 1;
    let tables = tables_of(&options);
    let nodes = tables["nodes"].as_array().expect("nodes");
    assert_eq!(nodes.len(), 1, "one node fits the slice: {tables}");
    assert_eq!(
        nodes[0]["mesh"],
        json!(0),
        "the rank the published scene uses"
    );
}

#[test]
fn the_format_number_is_raised_and_an_earlier_cache_is_refused_by_it() {
    let (_root, options) = fixture();
    let (first, _) = compile_with_events(&options);
    assert_eq!(first["formatVersion"], json!(FORMAT_VERSION));
    assert_eq!(
        FORMAT_VERSION, 5,
        "the batch that adds the tables raises it"
    );
    let path = options
        .key_directory(first["key"].as_str().expect("key"))
        .join("clusters.json");
    let mut manifest = read_json(&path);
    manifest["formatVersion"] = json!(3);
    fs::write(&path, serde_json::to_vec(&manifest).expect("encode")).expect("tamper");
    let (_second, events) = compile_with_events(&options);
    assert_eq!(
        events[0]["reason"],
        "manifest format 3 is not one this compiler writes"
    );
}
