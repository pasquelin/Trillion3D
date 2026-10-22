use super::*;

mod gate;

/// A scene of `placements` nodes placing the mesh "Facade" — a triangle of its own and `assembly`
/// — whose part, the mesh "Window", is a triangle too, over two materials.
fn scene(assembly: Value, placements: usize) -> Value {
    let triangle = json!({"attributes": {"POSITION": 0}, "indices": 1});
    let nodes: Vec<Value> = (0..placements)
        .map(|at| json!({"name": format!("Facade{at}"), "mesh": 1}))
        .collect();
    json!({
        "accessors": [
            {"componentType": 5126, "type": "VEC3", "count": 3},
            {"componentType": 5125, "type": "SCALAR", "count": 3},
        ],
        "materials": [{}, {}],
        "meshes": [
            {"name": "Window", "primitives": [triangle]},
            {"name": "Facade", "primitives": [triangle], "extras": {"assembly": assembly}},
        ],
        "nodes": nodes,
        "scenes": [{"nodes": (0..placements).collect::<Vec<_>>()}],
    })
}

/// An assembly of `count` windows, each moved one along x.
fn windows(count: usize) -> Value {
    let nodes: Vec<Value> = (0..count)
        .map(|at| json!({"part": 0, "translation": [at as f64, 0.0, 0.0]}))
        .collect();
    json!({"parts": [{"mesh": 0}], "nodes": nodes})
}

/// The assemblies of `g`, laid out, within a budget that holds them, the nodes of one with no
/// primitive of its own left with none.
fn lay_out(g: &mut Value) -> Result<()> {
    let meshes = assembly_meshes(g);
    expand::expand(g, &meshes, usize::MAX)?;
    expand::strip_bare(g);
    Ok(())
}

fn children(g: &Value, node: usize) -> Vec<usize> {
    let list = g["nodes"][node]["children"].as_array();
    let list = list.map(|c| {
        c.iter()
            .filter_map(Value::as_u64)
            .map(|c| c as usize)
            .collect()
    });
    list.unwrap_or_default()
}

// Behaviour: each node of an assembly becomes a child of every node that places the assembly's
// mesh, carrying the part's mesh and the node's transform, named after its parent; the parts' own
// mesh is shared, nothing of the document's arrays is copied, and the assembly leaves the extras.
#[test]
fn a_node_of_the_assembly_is_a_child_of_each_node_that_places_it() {
    let nodes = json!([
        {"part": 0, "translation": [1.0, 0.0, 0.0]},
        {"part": 0, "scale": [-1.0, 1.0, 1.0]},
        {"part": 0, "matrix": [1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,3,1]},
    ]);
    let mut g = scene(json!({"parts": [{"mesh": 0}], "nodes": nodes}), 2);
    lay_out(&mut g).expect("lays out");
    assert_eq!(g["nodes"].as_array().map(Vec::len), Some(2 + 3 * 2));
    assert_eq!(children(&g, 0), [2, 3, 4]);
    assert_eq!(children(&g, 1), [5, 6, 7]);
    for child in [2, 3, 4, 5, 6, 7] {
        assert_eq!(g["nodes"][child]["mesh"], 0);
    }
    assert_eq!(g["nodes"][3]["name"], "Facade0#1");
    assert_eq!(g["nodes"][3]["scale"], json!([-1.0, 1.0, 1.0]));
    assert_eq!(g["nodes"][7]["matrix"][14], 3);
    assert!(g["nodes"][2].get("part").is_none());
    assert_eq!(g["nodes"][0]["mesh"], 1, "the mesh keeps its own triangles");
    assert_eq!(g["meshes"].as_array().map(Vec::len), Some(2));
    assert_eq!(g["accessors"].as_array().map(Vec::len), Some(2));
    assert!(g["meshes"][1]["extras"].get("assembly").is_none());
}

// Behaviour: one part placed by 1, 10 and 100 nodes of an assembly, the assembly placed twice, adds
// nodes and nothing else: the meshes, the accessors and the views stay what the document held, so
// the part's pages are written once and its DAG built once whatever the count.
#[test]
fn a_part_placed_one_ten_and_a_hundred_times_adds_nodes_alone() {
    for count in [1, 10, 100] {
        let mut g = scene(windows(count), 2);
        lay_out(&mut g).expect("lays out");
        assert_eq!(
            g["nodes"].as_array().map(Vec::len),
            Some(2 + 2 * count),
            "{count}"
        );
        assert_eq!(g["meshes"].as_array().map(Vec::len), Some(2), "{count}");
        assert_eq!(g["accessors"].as_array().map(Vec::len), Some(2), "{count}");
    }
}

// Behaviour: a part that remaps its materials is a copy of its mesh wearing them, made once for the
// assembly however many nodes name it and however many times it is placed; the part's own mesh is
// untouched, a `null` takes the material off and a primitive past the list takes the assembly's
// first slot (its first primitive's material).
#[test]
fn a_part_that_remaps_its_materials_is_copied_once() {
    let mut g = scene(windows(3), 2);
    g["meshes"][1]["primitives"][0]["material"] = json!(1);
    g["meshes"][0]["primitives"] = json!([
        {"attributes": {"POSITION": 0}, "indices": 1, "material": 0},
        {"attributes": {"POSITION": 0}, "indices": 1, "material": 0},
        {"attributes": {"POSITION": 0}, "indices": 1, "material": 0},
    ]);
    let nodes = json!([{"part": 0}, {"part": 0}, {"part": 0}]);
    g["meshes"][1]["extras"]["assembly"] = json!({
        "parts": [{"mesh": 0, "materialRemap": [1, null]}], "nodes": nodes
    });
    lay_out(&mut g).expect("lays out");
    assert_eq!(g["meshes"].as_array().map(Vec::len), Some(3));
    let worn = &g["meshes"][2]["primitives"];
    assert_eq!(worn[0]["material"], 1);
    assert!(worn[1].get("material").is_none());
    assert_eq!(worn[2]["material"], 1);
    assert_eq!(
        g["meshes"][0]["primitives"][0]["material"], 0,
        "the part's mesh is as it was"
    );
    assert!((2..8).all(|child| g["nodes"][child]["mesh"] == 2));
}

// Behaviour: a part with no remap takes the assembly's slot of each primitive's rank, and the
// assembly mesh's shape, tangent, texture, edge and voxel settings: a copy wearing them; a part that
// already wears them is drawn from its own mesh.
#[test]
fn a_part_takes_the_assemblys_slots_and_settings() {
    let mut g = scene(windows(1), 1);
    g["meshes"][0]["primitives"][0]["material"] = json!(0);
    g["meshes"][1]["primitives"][0]["material"] = json!(1);
    g["meshes"][1]["extras"]["voxelRays"] = json!(128);
    lay_out(&mut g).expect("lays out");
    let copy = &g["meshes"][2];
    assert_eq!(copy["primitives"][0]["material"], 1);
    assert_eq!(copy["extras"]["voxelRays"], 128);
    assert!(copy["extras"].get("assembly").is_none());
    let mut same = scene(windows(1), 1);
    same["meshes"][0]["primitives"][0]["material"] = json!(1);
    same["meshes"][1]["primitives"][0]["material"] = json!(1);
    lay_out(&mut same).expect("lays out");
    assert_eq!(same["meshes"].as_array().map(Vec::len), Some(2));
}

// Behaviour: an assembly with no triangle of its own — `primitives` empty — leaves its placing nodes
// with no mesh, the nodes under them standing alone.
#[test]
fn an_assembly_with_no_triangle_of_its_own_leaves_its_nodes_bare() {
    let mut g = scene(windows(2), 1);
    g["meshes"][1]["primitives"] = json!([]);
    lay_out(&mut g).expect("lays out");
    assert!(g["nodes"][0].get("mesh").is_none());
    assert_eq!(children(&g, 0), [1, 2]);
}

// Behaviour: an assembly no node places, or naming no part or no node, is left as it is.
#[test]
fn an_assembly_no_node_places_is_left_as_it_is() {
    let mut g = scene(windows(2), 0);
    let before = g.clone();
    lay_out(&mut g).expect("lays out");
    assert_eq!(g, before);
    let mut g = scene(json!({"parts": [{"mesh": 0}]}), 1);
    let before = g.clone();
    lay_out(&mut g).expect("lays out");
    assert_eq!(g, before);
}

// Behaviour: a part that is itself an assembly is refused, whatever the order of the meshes: both
// assemblies are read before either is laid out, and an assembly that is not built is a part like
// any mesh.
#[test]
fn a_part_that_is_an_assembly_is_refused_whatever_the_order_of_the_meshes() {
    let nested = |first: usize, second: usize| {
        let mut g = scene(windows(1), 1);
        let copy = g["meshes"][1].clone();
        g["meshes"].as_array_mut().expect("meshes").push(copy);
        let on_second = json!({"parts": [{"mesh": second}], "nodes": [{"part": 0}]});
        g["meshes"][first]["extras"]["assembly"] = on_second;
        g["meshes"][second]["extras"]["assembly"] = windows(1);
        g
    };
    for (first, second) in [(1, 2), (2, 1)] {
        let mut g = nested(first, second);
        let refusal = lay_out(&mut g).err().expect("nested");
        assert_eq!(refusal.code, "INVALID_ASSEMBLY");
        assert!(
            refusal.message.contains("assemblies of assemblies"),
            "{}",
            refusal.message
        );
    }
    // The part's own assembly not built: drawn as its own triangles, a part like any.
    let mut g = nested(1, 2);
    expand::expand(&mut g, &[1], usize::MAX).expect("the part is not built as an assembly");
    assert_eq!(children(&g, 0).len(), 1);
    // An assembly listed as a part that no node places is never laid out: not refused.
    let mut g = nested(1, 2);
    g["meshes"][1]["extras"]["assembly"]["parts"] = json!([{"mesh": 0}, {"mesh": 2}]);
    lay_out(&mut g).expect("an unplaced nested part is not met");
}

// Behaviour: what does not read is refused by name — an unknown field, a part or a node out of
// bounds, a part with bones, a placing node with a skin, too many nodes — and an assembly past the
// job's memory budget is refused before a node is made.
#[test]
fn an_assembly_that_does_not_read_is_refused_by_name() {
    let mut skinned_part = scene(windows(1), 1);
    skinned_part["meshes"][0]["primitives"][0]["attributes"]["JOINTS_0"] = json!(0);
    let mut skinned_node = scene(windows(1), 1);
    skinned_node["nodes"][0]["skin"] = json!(0);
    let too_many = scene(windows(65_536), 1);
    let cases = [
        (
            scene(
                json!({"parts": [{"mesh": 0}], "nodes": [{"part": 0, "bones": []}]}),
                1,
            ),
            "bones",
        ),
        (
            scene(json!({"parts": [{"mesh": 0}], "nodes": [{"part": 1}]}), 1),
            "part",
        ),
        (
            scene(json!({"parts": [{"mesh": 7}], "nodes": [{"part": 0}]}), 1),
            "parts[0].mesh",
        ),
        (
            scene(
                json!({"parts": [{"mesh": 0, "materialRemap": [5]}], "nodes": [{"part": 0}]}),
                1,
            ),
            "materialRemap",
        ),
        (
            scene(
                json!({"parts": [{"mesh": 0}], "nodes": [{"part": 0, "translation": [1]}]}),
                1,
            ),
            "translation",
        ),
        (skinned_part, "static"),
        (skinned_node, "static"),
        (too_many, "65535"),
    ];
    for (mut g, words) in cases {
        let refusal = lay_out(&mut g).err().expect(words);
        assert_eq!(refusal.code, "INVALID_ASSEMBLY", "{words}");
        assert!(refusal.message.contains(words), "{}", refusal.message);
    }
    let mut g = scene(windows(10), 2);
    let refusal = expand::expand(&mut g, &[1], 64)
        .err()
        .expect("over the budget");
    assert_eq!(refusal.code, "RAM_ADMISSION_BUDGET_EXCEEDED");
}
