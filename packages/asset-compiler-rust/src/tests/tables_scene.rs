//! Correctness of `scene-tables.json`: the node table and the material table the prepared scene
//! is described by (#287).
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
fn tables_of(options: &Options) -> Value {
    let result = compile(options, |_| {}).expect("compile");
    let directory = options.key_directory(result["key"].as_str().expect("key"));
    read_json(&directory.join("scene-tables.json"))
}
/// A full-scope compilation of the fixture, altered by the case before it is written back.
fn published(alter: impl FnOnce(&mut Value)) -> (PathBuf, Value) {
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
fn the_material_table_carries_every_field_the_engine_reads() {
    let (_root, tables) = published(|gltf| {
        gltf["samplers"] = json!([{"wrapS":33071,"wrapT":33648,"magFilter":9728,"minFilter":9985}]);
        gltf["images"] = json!([{"uri":"albedo.png"}]);
        gltf["textures"] = json!([{"source":0,"sampler":0}]);
        gltf["materials"] = json!([{
            "name":"surface",
            "pbrMetallicRoughness":{
                "baseColorFactor":[0.25,0.5,0.75,1.0],
                "metallicFactor":0.125,
                "roughnessFactor":0.375,
                "baseColorTexture":{"index":0,"texCoord":1},
                "metallicRoughnessTexture":{"index":0},
            },
            "normalTexture":{"index":0,"scale":0.5},
            "occlusionTexture":{"index":0,"strength":0.25},
            "emissiveTexture":{"index":0},
            "emissiveFactor":[0.1,0.2,0.3],
            "doubleSided":true,
            "alphaMode":"MASK",
            "alphaCutoff":0.4,
            "extensions":{
                "KHR_materials_emissive_strength":{"emissiveStrength":2.0},
                "KHR_materials_transmission":{"transmissionFactor":0.6},
                "KHR_materials_ior":{"ior":1.7},
                "KHR_materials_volume":{"thicknessFactor":0.8,"attenuationDistance":3.0,
                    "attenuationColor":[0.9,0.8,0.7]},
            },
        }]);
        gltf["meshes"][0]["primitives"][0]["material"] = json!(0);
    });
    let m = &tables["materials"][0];
    assert_eq!(m["lit"], json!(true));
    assert_eq!(
        m["baseColor"],
        json!([0.25, 0.5, 0.75]),
        "alpha is not a colour"
    );
    assert_eq!(
        (m["metalness"].clone(), m["roughness"].clone()),
        (json!(0.125), json!(0.375))
    );
    assert_eq!(m["doubleSided"], json!(true));
    assert_eq!(m["backSide"], json!(false));
    assert_eq!(
        m["alphaTest"],
        json!(0.4),
        "the cutoff of a masked material"
    );
    assert_eq!(
        m["map"],
        json!({"texture":0,"texCoord":1,"transform":[1.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,1.0]})
    );
    assert_eq!(m["metalnessMap"]["texture"], json!(0));
    assert_eq!(
        m["roughnessMap"]["texture"],
        json!(0),
        "one glTF texture feeds both"
    );
    // No tangent on the primitive: the host rebuilds the frame from derivatives and flips the
    // second factor, and the table says the surface the host will hold.
    assert_eq!(
        (m["normalScale"].clone(), m["normalScaleY"].clone()),
        (json!(0.5), json!(-0.5))
    );
    assert_eq!(
        m["derivativeTangents"],
        json!(true),
        "the variant the entry is written for"
    );
    assert_eq!(m["aoIntensity"], json!(0.25));
    assert_eq!(
        m["emissive"],
        json!([0.2, 0.4, 0.6]),
        "factor times strength"
    );
    assert_eq!(m["transmission"], json!(0.6));
    assert_eq!(m["ior"], json!(1.7));
    assert_eq!(m["thickness"], json!(0.8));
    assert_eq!(m["attenuationDistance"], json!(3.0));
    assert_eq!(m["attenuationColor"], json!([0.9, 0.8, 0.7]));
    // Sampler state travels with the texture, at the texture's own rank.
    assert_eq!(
        tables["textures"][0],
        json!({"image":0,"wrapS":"clamp","wrapT":"mirror","magFilter":"nearest",
            "minFilter":"linear-mip-nearest"})
    );
    assert_eq!(tables["nodes"][0]["material"], json!(0));
    assert_eq!(
        tables["materials"].as_array().expect("materials").len(),
        1,
        "one surface worn"
    );
}

#[test]
fn an_unlit_material_answers_no_light() {
    let (_root, tables) = published(|gltf| {
        gltf["textures"] = json!([{"source":0}]);
        gltf["images"] = json!([{"uri":"albedo.png"}]);
        gltf["materials"] = json!([{
            "pbrMetallicRoughness":{"metallicFactor":1.0,"baseColorTexture":{"index":0}},
            "normalTexture":{"index":0},
            "emissiveFactor":[1.0,1.0,1.0],
            "extensions":{"KHR_materials_unlit":{}},
        }]);
        gltf["meshes"][0]["primitives"][0]["material"] = json!(0);
    });
    let m = &tables["materials"][0];
    assert_eq!(m["lit"], json!(false));
    assert_eq!(
        m["metalness"],
        json!(0.0),
        "the engine reads none on an unlit surface"
    );
    assert_eq!(m["roughness"], json!(1.0));
    assert_eq!(m["map"]["texture"], json!(0), "the colour map stays");
    assert_eq!(m["normalMap"], Value::Null);
    assert_eq!(m["emissive"], json!([0.0, 0.0, 0.0]));
    // A texture without a sampler takes the specification's defaults.
    assert_eq!(tables["textures"][0]["wrapS"], json!("repeat"));
    assert_eq!(
        tables["textures"][0]["minFilter"],
        json!("linear-mip-linear")
    );
}

#[test]
fn a_texture_transform_is_composed_as_the_loader_composes_it() {
    let (_root, tables) = published(|gltf| {
        gltf["textures"] = json!([{"source":0}]);
        gltf["images"] = json!([{"uri":"albedo.png"}]);
        gltf["materials"] = json!([{"pbrMetallicRoughness":{"baseColorTexture":{"index":0,
            "extensions":{"KHR_texture_transform":{"offset":[0.25,0.5],"scale":[2.0,4.0],
                "texCoord":1}}}}}]);
        gltf["meshes"][0]["primitives"][0]["material"] = json!(0);
    });
    assert_eq!(
        tables["materials"][0]["map"],
        json!({"texture":0,"texCoord":1,
            "transform":[2.0,0.0,0.0,0.0,4.0,0.0,0.25,0.5,1.0]}),
        "scale on the diagonal, offset in the last column, as the host holds it"
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
