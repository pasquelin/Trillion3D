//! The assembly pass (`expand_assemblies`): its gate — what a job that does not allow an assembly
//! leaves of it, what a mesh's setting allows, a bent assembly's refusal — and what it leaves for
//! the compile: the nodes marked, the primitives that carry the levels above them, the plan.
use super::*;
use crate::tests::fixtures::options;
use std::path::PathBuf;

/// The source of `g` as a loaded one, compiled by `options`.
pub(super) fn loaded(g: Value) -> RuntimeSource {
    RuntimeSource {
        manifest: json!({}),
        g,
        g_bytes_len: 0,
        binary: Binary::Owned(Vec::new()),
        bin_hash: String::new(),
        bent: Vec::new(),
    }
}

fn job(build: Value) -> Options {
    let mesh_build = crate::MeshBuildOptions::read(Some(&build));
    Options {
        mesh_build,
        ..options(PathBuf::new(), PathBuf::new())
    }
}

// Behaviour: with `allowAssemblies` off — the default — nothing is read of an `assembly` extra and no
// job fails on one, whatever it holds: a name another tool wrote, an object of its own; the meshes
// that name an object are counted in the import report, and the document is as it came.
#[test]
fn an_assembly_extra_is_never_read_where_assemblies_are_not_allowed() {
    for extra in [json!("chassis"), json!(null), json!(7), json!([1, 2])] {
        let mut source = loaded(scene(extra, 1));
        let before = source.g.clone();
        expand_assemblies(&job(json!({})), &mut source).expect("no job fails on it");
        assert_eq!((&source.g, &source.manifest), (&before, &json!({})));
    }
    // An object, not even an assembly's fields: not read either, but told.
    let mut source = loaded(scene(json!({"anything": 1}), 1));
    let before = source.g.clone();
    expand_assemblies(&job(json!({})), &mut source).expect("not read");
    assert_eq!(source.g, before);
    assert_eq!(source.manifest["unsupported"][NOT_BUILT], 1);
}

// Behaviour: the setting is a mesh's own build setting: the scene's, a rule's by object or the
// mesh's `extras` allow its assembly, the default does not.
#[test]
fn an_assembly_is_laid_out_where_its_mesh_allows_it() {
    let built = |build: Value| {
        let mut source = loaded(scene(windows(2), 1));
        expand_assemblies(&job(build), &mut source).expect("lays out");
        source.g["nodes"].as_array().map(Vec::len)
    };
    assert_eq!(built(json!({})), Some(1));
    assert_eq!(built(json!({"allowAssemblies": true})), Some(3));
    let ruled = json!({"objects": [{"match": "Facade0", "allowAssemblies": true}]});
    assert_eq!(built(ruled), Some(3));
    let other = json!({"objects": [{"match": "Roof", "allowAssemblies": true}]});
    assert_eq!(built(other), Some(1));
    let mut source = loaded(scene(windows(2), 1));
    source.g["meshes"][1]["extras"]["allowAssemblies"] = json!(true);
    expand_assemblies(&job(json!({})), &mut source).expect("lays out");
    assert_eq!(source.g["nodes"].as_array().map(Vec::len), Some(3));
}

// Behaviour: a mesh a spline bent that names an assembly is refused where the job builds the
// assembly — the curve bends its own triangles, not its parts — and laid out as its triangles alone
// where the job does not.
#[test]
fn a_bent_assembly_is_refused_only_where_the_job_builds_it() {
    let mut source = loaded(scene(windows(2), 1));
    source.bent = vec![1];
    let refusal = expand_assemblies(&job(json!({"allowAssemblies": true})), &mut source).err();
    let refusal = refusal.expect("a bent assembly the job builds");
    assert_eq!(refusal.code, "INVALID_SPLINE_MESH");
    let mut source = loaded(scene(windows(2), 1));
    source.bent = vec![1];
    expand_assemblies(&job(json!({})), &mut source).expect("not built: its own triangles");
    assert_eq!(source.g["nodes"].as_array().map(Vec::len), Some(1));
}

// Behaviour: each node an assembly lays out is marked an instance of it — its mesh, its rank — and
// its mesh tells where the instances stand and which of its primitives carry the levels above
// them: the one that has the material and attributes of the part's primitive, the instances that
// join it listed `[node, primitive of its part]`; a carrier the compile then plans with each
// instance's transform, and the parts whose roots the climb takes.
#[test]
fn the_nodes_of_an_assembly_are_marked_and_its_mesh_names_the_primitive_that_carries_its_levels() {
    let mut g = scene(windows(3), 2);
    lay_out(&mut g).expect("lays out");
    let mut source = loaded(g);
    let binary = std::mem::replace(&mut source.binary, Binary::Owned(Vec::new()));
    carriers::lay(&mut source.g, binary, usize::MAX).expect("tells the carriers");
    let g = source.g;
    assert_eq!(
        g["nodes"][3]["extras"][plan::INSTANCE_EXTRA],
        json!({"of": 1, "at": 1})
    );
    let built = &g["meshes"][1]["extras"][plan::BUILT_EXTRA];
    assert_eq!((&built["first"], &built["count"]), (&json!(2), &json!(3)));
    let uses = json!([[0, 0], [1, 0], [2, 0]]);
    assert_eq!(built["carriers"], json!([{"primitive": 0, "uses": uses}]));
    assert_eq!(
        g["meshes"].as_array().map(Vec::len),
        Some(2),
        "its own triangle carries them"
    );
    let plan = plan::AssemblyPlan::of(&g, &[(0, 0), (1, 0)]).expect("plans");
    let joined = &plan.carriers[&(1, 0)];
    assert_eq!(
        joined.iter().map(|u| (u.at, u.part)).collect::<Vec<_>>(),
        [(0, (0, 0)), (1, (0, 0)), (2, (0, 0))]
    );
    assert_eq!(joined[1].matrix[0], 1.0);
    assert_eq!(plan.parts.iter().collect::<Vec<_>>(), [&(0, 0)]);
    // A carrier whose own primitive is not compiled is not planned.
    assert!(plan::AssemblyPlan::of(&g, &[(0, 0)])
        .expect("plans")
        .carriers
        .is_empty());
}
