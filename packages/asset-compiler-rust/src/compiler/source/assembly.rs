//! Mesh assemblies: a mesh whose `extras.assembly` names parts — other meshes — and nodes — a part
//! and a transform each (`spec.rs`) — is one mesh made of its own triangles and of every node's
//! part, drawn through the node's transform.
//!
//! The reference builds each part once, shares its clusters between every node that names it, and
//! reduces the instances' roots together with the mesh's own clusters into the levels above
//! (`dag/assembly.rs`). Our pages hold no transform inside a mesh, so a node's part is laid in the
//! assembly's primitives already carried (`flatten.rs`), one block a node: the DAG of each block is
//! built as a part's is, and the levels above are built over their roots, the reference's levels.
//! What the reference shares between nodes is stored once a node here.
//!
//! The reference builds an assembly only where the project allows it (a read-only project switch,
//! off by default): here a mesh's `allowAssemblies` setting (`meshBuild`, false by default). A mesh
//! that does not allow it is drawn as its own triangles alone, as the reference draws one whose
//! assembly it does not build.
use crate::compiler::source::synth::{owned, seal};
use crate::*;

mod flatten;
mod piece;
mod spec;

/// The meshes of `g` that name an assembly.
fn assembly_meshes(g: &Value) -> Vec<usize> {
    let count = g
        .get("meshes")
        .and_then(Value::as_array)
        .map_or(0, Vec::len);
    (0..count)
        .filter(|&mesh| spec::names_assembly(g, mesh))
        .collect()
}

/// Lays out the assembly of every mesh that names one and allows it, before the plan: its
/// primitives become the flat primitives of its blocks (`flatten.rs`), the arrays appended to
/// the source's binary. A source naming none, or whose job allows none, is left as it is.
pub(crate) fn expand_assemblies(o: &Options, loaded: &mut RuntimeSource) -> Result<()> {
    let named = assembly_meshes(&loaded.g);
    if named.is_empty() {
        return Ok(());
    }
    let builds = o.mesh_build()?.meshes(&loaded.g)?;
    let allowed: Vec<usize> = named
        .into_iter()
        .filter(|&mesh| builds[mesh].allow_assemblies)
        .collect();
    if allowed.is_empty() {
        return Ok(());
    }
    let binary = std::mem::replace(&mut loaded.binary, Binary::Owned(Vec::new()));
    let mut out = owned(binary)?;
    for mesh in allowed {
        if let Some(assembly) = spec::read(&loaded.g, mesh)? {
            let limit = o.ram_budget_bytes();
            flatten::expand(&mut loaded.g, &mut out, (mesh, limit), &assembly)?;
        }
    }
    seal(&mut loaded.g, &out);
    loaded.binary = Binary::Owned(out);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A part — one triangle — and an assembly mesh with a triangle of its own and two nodes: the
    /// part moved ten along x, the part mirrored across x.
    fn document(assembly: Value) -> (Value, Vec<u8>) {
        let triangle = |z: f32| [0.0, 0.0, z, 1.0, 0.0, z, 0.0, 1.0, z];
        let bytes = [triangle(0.0), triangle(1.0)]
            .concat()
            .iter()
            .flat_map(|v| v.to_le_bytes())
            .collect();
        let accessor = |view: usize| json!({"bufferView": view, "componentType": 5126, "count": 3, "type": "VEC3"});
        let g = json!({
            "buffers": [{"byteLength": 72}],
            "bufferViews": [
                {"buffer": 0, "byteOffset": 0, "byteLength": 36},
                {"buffer": 0, "byteOffset": 36, "byteLength": 36},
            ],
            "accessors": [accessor(0), accessor(1)],
            "meshes": [
                {"primitives": [{"attributes": {"POSITION": 0}}]},
                {"primitives": [{"attributes": {"POSITION": 1}}], "extras": {"assembly": assembly}},
            ],
        });
        (g, bytes)
    }

    fn nodes() -> Value {
        json!({"parts": [{"mesh": 0}], "nodes": [
            {"part": 0, "translation": [10.0, 0.0, 0.0]},
            {"part": 0, "scale": [-1.0, 1.0, 1.0]},
        ]})
    }

    fn floats(g: &Value, bin: &[u8], semantic: &str) -> Vec<f32> {
        let id = g["meshes"][1]["primitives"][0]["attributes"][semantic].as_u64();
        let reader = accessor(g, bin, id.expect("an accessor") as usize, None);
        reader.expect("reads").collect_f32().expect("floats")
    }

    // Behaviour: an assembly's primitive holds the mesh's own triangle, then each node's part
    // carried by its transform, a mirroring node's triangles turned over; its extras name the
    // blocks, the mesh's own first; the assembly leaves the mesh's extras.
    #[test]
    fn a_primitive_lays_the_meshs_own_triangle_then_each_nodes_part_carried() {
        let (mut g, mut bin) = document(nodes());
        let assembly = spec::read(&g, 1).expect("reads").expect("an assembly");
        flatten::expand(&mut g, &mut bin, (1, usize::MAX), &assembly).expect("expands");
        let primitive = &g["meshes"][1]["primitives"][0];
        let layout = &primitive["extras"]["assembly"];
        assert_eq!(layout["base"], true);
        assert_eq!(
            layout["blocks"],
            json!([[0, 3, 0, 3], [3, 3, 3, 3], [6, 3, 6, 3]])
        );
        let positions = floats(&g, &bin, "POSITION");
        let expected: [f32; 27] = [
            0.0, 0.0, 1.0, 1.0, 0.0, 1.0, 0.0, 1.0, 1.0, // the mesh's own
            10.0, 0.0, 0.0, 11.0, 0.0, 0.0, 10.0, 1.0, 0.0, // moved
            0.0, 0.0, 0.0, -1.0, 0.0, 0.0, 0.0, 1.0, 0.0, // mirrored across x
        ];
        assert_eq!(positions, expected);
        let id = primitive["indices"].as_u64().expect("an index accessor") as usize;
        let indices = accessor(&g, &bin, id, None)
            .expect("reads")
            .collect_u32()
            .expect("indices");
        assert_eq!(indices, [0, 1, 2, 3, 4, 5, 6, 8, 7]);
        assert!(g["meshes"][1]["extras"].get("assembly").is_none());
    }

    // Behaviour: an assembly naming no part or no node is none; a node naming a part that is not
    // there, a part that is an assembly, and a field the assembly does not have are refused.
    #[test]
    fn an_assembly_that_does_not_read_is_refused_by_name() {
        let (g, _) = document(json!({"parts": [{"mesh": 0}]}));
        assert!(spec::read(&g, 1).expect("reads").is_none());
        for (assembly, words) in [
            (
                json!({"parts": [{"mesh": 0}], "nodes": [{"part": 1}]}),
                "part",
            ),
            (
                json!({"parts": [{"mesh": 1}], "nodes": [{"part": 0}]}),
                "assemblies of assemblies",
            ),
            (
                json!({"parts": [{"mesh": 0}], "nodes": [{"part": 0, "boneInfluences": []}]}),
                "boneInfluences",
            ),
        ] {
            let (g, _) = document(assembly);
            let refusal = spec::read(&g, 1).err().expect("refused");
            assert!(refusal.message.contains(words), "{}", refusal.message);
        }
    }
}
