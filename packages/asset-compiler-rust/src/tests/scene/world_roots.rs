//! The world's HLOD in a compilation: a partitioned world publishes it beside its cells, one entry
//! per HLOD 0 cell, each cell naming its own.
//!
//! Provenance: the synthetic grid world of `partition.rs`, the fixture triangle placed 48 × 48
//! times, which spans several grid cells.
use super::partition::{cells, grid};
use super::*;
use crate::hlod::chain::tests::decoded::table;
use crate::hlod::chain::{WORLD_ROOTS_BIN, WORLD_ROOTS_FILE};

/// The fixture triangle placed `side` × `side` times, wearing `materials` — its first, if any —,
/// compiled whole and simplified: its result and its cache's directory. Each placement is scaled
/// twice.
fn grid_world(side: usize, materials: Value) -> (PathBuf, Value, PathBuf) {
    grid_world_with(side, materials, crate::tests::fixtures::hlod_chain())
}

/// `grid_world` under the HLOD `hlod`.
pub(super) fn grid_world_with(
    side: usize,
    materials: Value,
    hlod: crate::Hlod,
) -> (PathBuf, Value, PathBuf) {
    let (root, mut options) = fixture();
    let mut gltf = read_gltf(&options);
    gltf["accessors"][0]["min"] = json!([0.0, 0.0, 0.0]);
    gltf["accessors"][0]["max"] = json!([1.0, 1.0, 0.0]);
    gltf["nodes"] = json!(grid(side, 4.0, 2.0));
    gltf["scenes"] = json!([{"nodes": (0..side * side).collect::<Vec<_>>()}]);
    if materials.as_array().is_some_and(|all| !all.is_empty()) {
        gltf["meshes"][0]["primitives"][0]["material"] = json!(0);
    }
    gltf["materials"] = materials;
    write_gltf(&options, &gltf, None);
    options.scope = "full".into();
    options.simplification = "qem-endpoints".into();
    options.hlod = Ok(hlod);
    let result = compile(&options, |_| {}).expect("compile");
    let directory = options.key_directory(result["key"].as_str().expect("key"));
    (root, result, directory)
}

#[test]
fn a_partitioned_world_publishes_its_hlod_cell_by_cell() {
    let side = 48;
    let (_root, result, directory) = grid_world(side, json!([]));
    // The table as a load reads it (`hlod/chain/tests/decoded.rs`): its header, then each
    // HLOD cell's bundles, its parent, layer and bounds.
    let table = table(&fs::read(directory.join(WORLD_ROOTS_FILE)).expect("table"));
    let report = &result["worldRoots"];
    let partition = cells(&directory);
    assert!(partition.len() > 1, "the world is split");
    let hlod = table["hlod"].as_array().expect("hlod");
    assert_eq!(report["chainCells"], json!(hlod.len()));
    // The chain: HLOD 0 cells first, each layer's cells after, the HLOD 2 cells the top's.
    let layers: Vec<u64> = hlod
        .iter()
        .map(|h| h["level"].as_u64().expect("level"))
        .collect();
    assert!(layers.windows(2).all(|w| w[0] <= w[1]), "{layers:?}");
    assert_eq!(layers.last(), Some(&2));
    for h in hlod {
        let top = h["level"] == json!(2);
        assert_eq!(h["parent"].is_null(), top, "{h}");
    }
    let mut nodes = Vec::new();
    for cell in &partition {
        assert!(cell["hlod"][0].as_u64().expect("its HLOD 0 cell") < hlod.len() as u64);
        let body = read_json(&directory.join(cell["url"].as_str().expect("url")));
        nodes.extend(body["nodes"].as_array().expect("nodes").iter().cloned());
    }
    assert_eq!(nodes.len(), side * side, "every placement once");
    let payload = fs::read(directory.join(WORLD_ROOTS_BIN)).expect("payload");
    assert_eq!(
        table["payload"],
        json!({"bytes": payload.len(), "sha256": hash(&payload)})
    );
}

/// A blended primitive is drawn sorted, and approximated into its HLOD 1 all the same: the
/// approximation takes every primitive of a cell whatever its blend mode (`SourceCover::of`), the
/// same world, blended, publishes its HLOD, every HLOD 0 cell built.
#[test]
fn a_blended_world_publishes_its_hlod_too() {
    let (_root, result, directory) = grid_world(48, json!([{"alphaMode":"BLEND"}]));
    assert_eq!(result["primitives"][0]["pass"], "clustered-blend");
    let report = &result["worldRoots"];
    assert!(report["hlodCells"].as_u64().unwrap_or(0) > 0, "{report}");
    assert_eq!(report["builtCells"], report["chainCells"], "{report}");
    assert_eq!(report["layers"], json!(3), "HLOD 1 to HLOD 3 built");
    assert!(directory.join(WORLD_ROOTS_FILE).exists());
    assert!(cells(&directory).len() > 1, "the world is still split");
}

// Behaviour: a layer names the unwrap its mesh is given by any word the generator offers: a merge
// layer the old chart layout (`legacy`) and the spectral charts (`uvAtlas`) beside the patches and
// the charts, an approximate layer the spectral charts and the stretch they may reach, refused
// outside 0 to 1.
#[test]
fn a_layer_names_the_unwrap_of_its_mesh() {
    use crate::hlod::options::HlodUvMethod;
    let top = |layer: Value| {
        let chain = json!({
            "layers": [{"name": "hlod0", "builder": "instanced", "parent": "top"}, layer],
            "default": "hlod0"
        });
        crate::Hlod::read(Some(&chain)).map(|hlod| {
            let found = hlod.layers.iter().find(|l| l.name == "top").cloned();
            found.expect("the layer")
        })
    };
    let merged = |word: &str| {
        let layer = json!({"name": "top", "builder": "merge", "spatiallyLoaded": false,
            "mergeMaterials": true, "uvMethod": word});
        top(layer).map(|layer| layer.merging.uv_method)
    };
    for (word, method) in [
        ("default", HlodUvMethod::Patches),
        ("xAtlas", HlodUvMethod::Charts),
        ("patchBuilder", HlodUvMethod::Patches),
        ("legacy", HlodUvMethod::Legacy),
        ("uvAtlas", HlodUvMethod::UvAtlas),
    ] {
        assert_eq!(merged(word).expect(word), method, "{word}");
    }
    assert!(merged("xatlas2").is_err());
    let approximated = |settings: Value| {
        let layer = json!({"name": "top", "builder": "approximate", "spatiallyLoaded": false,
            "approximation": settings});
        top(layer).map(|layer| layer.approximation)
    };
    let shell = approximated(json!({"uvMethod": "uvAtlas", "uvAtlasStretch": 0.25}));
    let shell = shell.expect("a shell unwrapped by the spectral charts");
    assert_eq!(shell.uv_method, HlodUvMethod::UvAtlas);
    assert_eq!(shell.uv_atlas_stretch, 0.25);
    assert_eq!(
        approximated(json!({})).expect("defaults").uv_atlas_stretch,
        0.1
    );
    assert!(approximated(json!({"uvAtlasStretch": 1.5})).is_err());
    assert!(approximated(json!({"uvMethod": "legacy"})).is_err());
}

// Behaviour: a voxel layer's `meshBuild` names how its cells' voxels are sampled and no other
// setting of a mesh's build; another layer's names no voxel setting, which are a voxel layer's.
#[test]
fn a_voxel_layer_names_how_its_voxels_are_sampled() {
    use crate::voxel::VoxelSettings;
    let top = |layer: Value| {
        let chain = json!({
            "layers": [{"name": "hlod0", "builder": "instanced", "parent": "top"}, layer],
            "default": "hlod0"
        });
        crate::Hlod::read(Some(&chain)).map(|hlod| {
            let found = hlod.layers.into_iter().find(|l| l.name == "top");
            found.expect("the layer")
        })
    };
    let voxel = |build: Option<Value>| {
        let mut layer = json!({"name": "top", "builder": "voxel", "spatiallyLoaded": false});
        layer["meshBuild"] = build.unwrap_or(Value::Null);
        top(layer)
    };
    let named = json!({"voxelRays": 16, "voxelBackUp": 0.5, "voxelNdf": false});
    let sampled = voxel(Some(named))
        .expect("settings named")
        .mesh_build
        .voxels;
    assert_eq!(
        (sampled.asked_rays, sampled.back_up, sampled.ndf),
        (16, 0.5, false)
    );
    let none = voxel(None).expect("none named").mesh_build.voxels;
    assert_eq!(none, VoxelSettings::default());
    assert!(voxel(Some(json!({"keptTriangles": 0.5}))).is_err());
    let merged = json!({"name": "top", "builder": "merge", "spatiallyLoaded": false,
        "mergeMaterials": true, "meshBuild": {"voxelRays": 16}});
    assert!(top(merged).is_err());
}

// Behaviour: a layer whose parent closes a cycle, or wears its sources' own materials above a layer
// whose actors wear materials of their own, loses that parent and the job is told, as the reference
// keeps the layer and clears its parent; it is never refused.
#[test]
fn a_layer_whose_parent_is_invalid_loses_it_and_the_job_is_told() {
    let layer = |name: &str, builder: &str, parent: &str| json!({"name": name, "builder": builder, "parent": parent});
    let chain = json!({"layers": [
        layer("a", "simplify", "b"),
        layer("b", "simplify", "a"),
    ]});
    let hlod = crate::Hlod::read(Some(&chain)).expect("a cycle is not refused");
    assert_eq!(
        hlod.layers[0].parent, None,
        "the first layer of the cycle lets its parent go"
    );
    assert_eq!(hlod.layers[1].parent, Some(0));
    assert!(hlod.dropped[0].contains("cycle"), "{:?}", hlod.dropped);
    let chain = json!({"layers": [
        layer("own", "simplify", "kept"),
        {"name": "kept", "builder": "instanced"},
    ]});
    let hlod = crate::Hlod::read(Some(&chain)).expect("a material reuse is not refused");
    assert_eq!(hlod.layers[0].parent, None);
    assert!(
        hlod.dropped[0].contains("own materials"),
        "{:?}",
        hlod.dropped
    );
}

// Behaviour: as the reference's builders have it, the mesh an approximated
// layer builds gets a distance field unless the layer says otherwise, the mesh a merged or
// simplified layer builds none unless it asks: a setting of the layers that build a mesh, refused
// on an instanced or voxel layer.
#[test]
fn a_layer_allows_the_distance_field_of_its_actors_as_its_builder_defaults_it() {
    let allowed = |builder: &str, extra: Value| {
        let mut layer = json!({"name": "only", "builder": builder});
        layer
            .as_object_mut()
            .expect("an object")
            .extend(extra.as_object().cloned().unwrap_or_default());
        crate::Hlod::read(Some(&json!({"layers": [layer]})))
            .map(|hlod| hlod.layers[0].allow_distance_field)
    };
    assert_eq!(allowed("approximate", json!({})), Ok(true));
    assert_eq!(allowed("merge", json!({})), Ok(false));
    assert_eq!(allowed("simplify", json!({})), Ok(false));
    for builder in ["approximate", "merge", "simplify"] {
        let (yes, no) = (
            json!({"allowDistanceField": true}),
            json!({"allowDistanceField": false}),
        );
        assert_eq!(allowed(builder, yes), Ok(true), "{builder}");
        assert_eq!(allowed(builder, no), Ok(false), "{builder}");
    }
    for builder in ["instanced", "voxel"] {
        assert!(allowed(builder, json!({})).is_ok(), "{builder} reads");
        let refused = allowed(builder, json!({"allowDistanceField": true}));
        assert!(refused.is_err(), "{builder}: it builds no mesh of its own");
    }
    assert!(allowed("merge", json!({"allowDistanceField": "yes"})).is_err());
}

// Behaviour: as the reference has them, two settings: the mesh a merge, approximate or simplify
// layer builds gets no cluster DAG unless the layer asks for one (`clusterDag`, off by default),
// and an instanced layer's objects keep their own unless it disallows it (`disallowClusterDag`,
// off by default), which stands each object on a fallback mesh.
#[test]
fn a_built_mesh_gets_a_cluster_dag_only_when_asked_and_instances_keep_theirs() {
    use crate::hlod::options::HlodBuilder;
    let layer = |extra: Value| {
        let mut layer = json!({"name": "only", "builder": "merge"});
        layer
            .as_object_mut()
            .expect("an object")
            .extend(extra.as_object().cloned().unwrap_or_default());
        let hlod = crate::Hlod::read(Some(&json!({"layers": [layer]}))).expect("reads");
        hlod.layers[0].clone()
    };
    assert!(
        !layer(json!({})).cluster_dag,
        "a merged mesh is a plain mesh by default"
    );
    assert!(layer(json!({"clusterDag": true})).cluster_dag);
    let kept = layer(json!({"builder": "instanced"}));
    assert_eq!(
        (kept.builder, kept.cluster_dag),
        (HlodBuilder::Instanced, true)
    );
    let fallback = layer(json!({"builder": "instanced", "disallowClusterDag": true}));
    assert_eq!(
        (fallback.builder, fallback.cluster_dag),
        (HlodBuilder::Instanced, false),
        "it stays instanced: its objects stand on fallback meshes"
    );
    // The chain from a layer up decides what its objects stand on: any instanced layer without a
    // cluster DAG in it, its own or one above, gives them a fallback.
    let chain = json!({"layers": [
        {"name": "below", "builder": "instanced", "parent": "above"},
        {"name": "above", "builder": "instanced", "disallowClusterDag": true}]});
    let hlod = crate::Hlod::read(Some(&chain)).expect("reads");
    assert!(hlod.has_fallback_layer());
    assert!(hlod.takes_fallback(Some(0)) && hlod.takes_fallback(Some(1)));
    assert!(!hlod.takes_fallback(None));
    let refused = json!({"layers": [{"name": "i", "builder": "instanced", "clusterDag": false}]});
    assert!(
        crate::Hlod::read(Some(&refused)).is_err(),
        "an instanced layer names the other one"
    );
}
