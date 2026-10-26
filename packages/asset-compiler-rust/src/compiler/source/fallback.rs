//! The fallback meshes of an instanced HLOD layer that disallows the cluster DAG
//! (`disallowClusterDag`): one mesh per source mesh the layer's objects place, made once, which the
//! objects of the layer's actors stand on as rows in place of the source mesh's own DAG.
//!
//! A fallback mesh is a mesh of the input scene (`add`), a copy of its source that the primitives'
//! compile reads differently: its triangles are the source's fallback (`flatten::merge::fallback`,
//! handed on by the source's own compile), built as exact clusters, every one a root — drawn whole
//! at every distance. It is published as any mesh is, listed by the partition with no node placing
//! it, and named by the rows of the actors (`hlod/chain/instances.rs`). Its `extras` name its
//! source (`FALLBACK_OF`): by the input scene's rank in the input scene, by the published rank in
//! the published one (`source/scene.rs`).
//!
//! Only a mesh nothing moves has one: every primitive draws triangles with no skin, no morph target
//! and no soft body, no node placing it carries a skin or morph weights, and it is no part nor
//! product of an assembly. The objects of any other keep their source mesh as their row.
use super::assembly::plan::{extra, BUILT_EXTRA, INSTANCE_EXTRA, PART_EXTRA, TOP_EXTRA};
use super::nodes::moves_by_itself;
use crate::compiler::args::mesh_build::MeshBuild;
use crate::compiler::primitive::triangles::is_static_triangles;
use crate::hlod::options::Assigned;
use crate::*;

/// The key of a fallback mesh's `extras` that names the mesh it stands for.
pub(crate) const FALLBACK_OF: &str = "hlodFallbackOf";

/// The source mesh the mesh `mesh` stands for as a fallback, none for any other mesh.
pub(crate) fn of(mesh: &Value) -> Option<usize> {
    extra(mesh, FALLBACK_OF)?
        .as_u64()
        .map(|source| source as usize)
}

/// The meshes some node moves or builds by itself — a skin, morph weights, a soft body, an
/// assembly's instance —, found in one pass over the nodes.
fn moved_meshes(g: &Value) -> BTreeSet<u64> {
    let nodes = g["nodes"].as_array().into_iter().flatten();
    let moves = |n: &Value| {
        moves_by_itself(n)
            || extra(n, INSTANCE_EXTRA).is_some()
            || crate::physics_cook::declared_soft(n).is_some()
    };
    nodes
        .filter(|n| moves(n))
        .filter_map(|n| n["mesh"].as_u64())
        .collect()
}

/// Whether mesh `mesh` of `g` can have a fallback (the header), `moved` the meshes a node moves
/// (`moved_meshes`).
fn rigid(g: &Value, mesh: usize, moved: &BTreeSet<u64>) -> bool {
    let Some(entry) = g["meshes"].get(mesh) else {
        return false;
    };
    let moving = |p: &Value| !is_static_triangles(p) || extra(p, TOP_EXTRA).is_some();
    let drawn = entry["primitives"].as_array().filter(|p| !p.is_empty());
    drawn.is_some_and(|primitives| !primitives.iter().any(moving))
        && extra(entry, BUILT_EXTRA).is_none()
        && extra(entry, PART_EXTRA).is_none()
        && !moved.contains(&(mesh as u64))
}

/// A fallback mesh for each source mesh the chosen nodes `chosen` of `g` place that an instanced
/// layer without a cluster DAG takes (`Hlod::takes_fallback`) and can have one (the header),
/// appended to `g`'s meshes in the order of their sources. Returns each source and its fallback.
/// `g` is the scene after its identical meshes were shared and its nodes chosen.
pub(crate) fn add(
    o: &Options,
    g: &mut Value,
    chosen: &BTreeSet<usize>,
) -> Result<BTreeMap<usize, usize>> {
    let hlod = o.hlod()?;
    if !hlod.has_fallback_layer() {
        return Ok(BTreeMap::new());
    }
    let assignments: Vec<Assigned> = hlod.assignments(g)?;
    let moved = moved_meshes(g);
    let mut sources = BTreeSet::new();
    for &node in chosen {
        let Some(mesh) = g["nodes"][node]["mesh"].as_u64() else {
            continue;
        };
        if hlod.takes_fallback(assignments[node].layer) && rigid(g, mesh as usize, &moved) {
            sources.insert(mesh as usize);
        }
    }
    let meshes = (g.get_mut("meshes").and_then(Value::as_array_mut))
        .ok_or_else(|| invalid("meshes array is required"))?;
    let mut made = BTreeMap::new();
    for source in sources {
        let mut mesh = meshes[source].clone();
        if let Some(name) = mesh["name"].as_str() {
            mesh["name"] = json!(format!("{name}#fallback"));
        }
        mesh["extras"] = json!({ FALLBACK_OF: source });
        made.insert(source, meshes.len());
        meshes.push(mesh);
    }
    Ok(made)
}

/// The settings of the fallback mesh `fallback`'s primitives (`MeshBuild`), from those of its
/// source: the pages are the source's, but nothing is trimmed, baked, voxelized, given a distance
/// field or cards — the source's own build did all that — and no assembly is built.
pub(crate) fn build_of(source: &MeshBuild) -> MeshBuild {
    MeshBuild {
        trim: crate::dag::Trim::default(),
        distance_field: crate::distance_field::DistanceFieldSettings {
            generate: false,
            ..source.distance_field
        },
        cards: crate::card_representation::CardSettings {
            max_cards: 0,
            ..source.cards
        },
        displacement: crate::displace::DisplacementSettings::default(),
        allow_assemblies: false,
        ..source.clone()
    }
}

/// The settings of every mesh of `g` (`builds`, by rank) with each fallback mesh's taken from its
/// source's (`build_of`).
pub(crate) fn inherit(g: &Value, builds: &mut [MeshBuild]) {
    let meshes = g["meshes"].as_array().into_iter().flatten();
    for (rank, mesh) in meshes.enumerate().take(builds.len()) {
        if let Some(source) = of(mesh).filter(|&s| s < builds.len()) {
            builds[rank] = build_of(&builds[source]);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A scene of one mesh of one triangle primitive, placed by `nodes`.
    fn scene(nodes: Value) -> Value {
        json!({"meshes": [{"name": "rock", "primitives": [
            {"attributes": {"POSITION": 0}, "indices": 1}]}],
            "nodes": nodes})
    }

    // Behaviour: a mesh nothing moves can have a fallback.
    #[test]
    fn a_rigid_mesh_can_have_a_fallback() {
        let rigid = |g: &Value| rigid(g, 0, &moved_meshes(g));
        assert!(rigid(&scene(json!([{"mesh": 0}]))));
    }

    // Behaviour: a mesh a skin, morph weights, a soft body, a morph target or joint weights move
    // has none; neither has a mesh an assembly built or took as a part.
    #[test]
    fn a_mesh_something_moves_has_none() {
        let rigid = |g: &Value| rigid(g, 0, &moved_meshes(g));
        assert!(!rigid(&scene(json!([{"mesh": 0, "skin": 0}]))));
        assert!(!rigid(&scene(json!([{"mesh": 0, "weights": [0.5]}]))));
        let mut moved = scene(json!([{"mesh": 0}]));
        moved["meshes"][0]["primitives"][0]["attributes"]["JOINTS_0"] = json!(2);
        assert!(!rigid(&moved));
        let mut morphs = scene(json!([{"mesh": 0}]));
        morphs["meshes"][0]["primitives"][0]["targets"] = json!([{"POSITION": 3}]);
        assert!(!rigid(&morphs));
        let mut built = scene(json!([{"mesh": 0}]));
        built["meshes"][0]["extras"] = json!({ BUILT_EXTRA: {} });
        assert!(!rigid(&built));
    }

    // Behaviour: a fallback mesh names its source and no other mesh does.
    #[test]
    fn a_fallback_mesh_names_its_source() {
        let g = scene(json!([]));
        assert_eq!(of(&g["meshes"][0]), None);
        assert_eq!(of(&json!({"extras": {FALLBACK_OF: 3}})), Some(3));
    }
}
