//! The nodes of an assembly laid under the nodes that place its mesh (`assembly.rs`): one child
//! node for each node of the assembly, carrying the mesh of the part it names and the transform it
//! holds, appended after every existing node as the instancing pass appends its own
//! (`instancing.rs`), so that no index the document already holds moves.
//!
//! A part is a mesh like any, compiled once whatever the number of nodes that place it and of
//! placements of the assembly: its pages are written once and every child shares them. The only
//! copy of a mesh made is a part's that the assembly draws with other materials or settings than
//! its own (`parts.rs`), once for each assembly that does.
use super::parts::{part_meshes, Resolved};
use super::plan::{BUILT_EXTRA, INSTANCE_EXTRA};
use super::spec::{self, Node, Spec};
use crate::compiler::source::nodes::{
    append_children, check_references, child_name, moves_by_itself,
};
use crate::*;
use std::collections::BTreeMap;

/// What the child node for node `at` of an assembly, `node`, weighs while the document is held, in
/// bytes, for the memory budget, its parent's name `parent` bytes long: each of its fields — its
/// name (`child`), its mesh and the node's transform — a key and a value, each number of a
/// transform's array a value, and the text of its keys and its name, by the sizes of their types;
/// the map's own nodes left out.
fn child_bytes(parent: usize, at: usize, node: &Node) -> usize {
    let (key, value) = (std::mem::size_of::<String>(), std::mem::size_of::<Value>());
    let numbers: usize = (node.transform.values())
        .map(|v| v.as_array().map_or(0, Vec::len))
        .sum();
    let keys: usize = node.transform.keys().map(String::len).sum::<usize>() + "namemesh".len();
    let name = parent + "#".len() + at.checked_ilog10().map_or(1, |digits| digits as usize + 1);
    (2 + node.transform.len()) * (key + value) + numbers * value + keys + name
}

/// The child node of the node named `name`, for node `at` of assembly `assembly`: the part's mesh
/// `mesh` at the node's transform, marked as an instance of the assembly (`INSTANCE_EXTRA`) so
/// that the compile finds what its levels above carry for it (`plan.rs`).
fn child(name: &str, at: usize, node: &Node, (assembly, mesh): (usize, usize)) -> Value {
    let mut child = serde_json::Map::new();
    child.insert("name".into(), json!(child_name(name, at)));
    child.insert("mesh".into(), json!(mesh));
    child.insert(
        "extras".into(),
        json!({ (INSTANCE_EXTRA): {"of": assembly, "at": at} }),
    );
    child.extend(node.transform.clone());
    Value::Object(child)
}

/// The nodes that place an assembly's mesh, each with the rank of its assembly among `specs`: a
/// node that moves with bones or morph targets is refused, an assembly being static.
fn placing(g: &Value, specs: &[(usize, Spec)]) -> Result<Vec<(usize, usize)>> {
    let by_mesh: BTreeMap<usize, usize> = (specs.iter().enumerate())
        .map(|(rank, (mesh, _))| (*mesh, rank))
        .collect();
    let mut placing = Vec::new();
    for (id, node) in g["nodes"].as_array().into_iter().flatten().enumerate() {
        let mesh = node.get("mesh").and_then(Value::as_u64);
        let rank = mesh.and_then(|mesh| by_mesh.get(&usize::try_from(mesh).ok()?));
        let Some(&rank) = rank else {
            continue;
        };
        if moves_by_itself(node) {
            let what = format!("nodes[{id}]");
            let why = "it places an assembly, which is static: no skin and no morph weights";
            return Err(spec::ASSEMBLY.bad(format!("{what}: {why}")));
        }
        placing.push((id, rank));
    }
    Ok(placing)
}

/// How many nodes the assemblies `specs` lay out under the nodes `placing` place them, and about
/// how many bytes they weigh (`child_bytes`).
fn weighed(g: &Value, specs: &[(usize, Spec)], placing: &[(usize, usize)]) -> (usize, usize) {
    let name_of = |id: usize| {
        g["nodes"][id]["name"]
            .as_str()
            .map_or("assembly".len(), str::len)
    };
    (placing.iter()).fold((0usize, 0usize), |(count, bytes), &(id, rank)| {
        let nodes = &specs[rank].1.nodes;
        let weighed = (nodes.iter().enumerate())
            .map(|(at, node)| child_bytes(name_of(id), at, node))
            .sum::<usize>();
        (
            count.saturating_add(nodes.len()),
            bytes.saturating_add(weighed),
        )
    })
}

/// Lays out the assemblies of the meshes `allowed`, within `limit` bytes of memory, the parts
/// taking the settings their assembly resolves (`resolved`). Each is read and checked before any is
/// laid out, so that no verdict depends on the order of the meshes; an assembly no node places is
/// left as it is. A mesh with no primitive of its own leaves its nodes with none once every level
/// is laid out (`strip_bare`): they only hold what stands under them.
pub(super) fn expand(
    g: &mut Value,
    allowed: &[usize],
    resolved: &Resolved<'_>,
    limit: usize,
) -> Result<()> {
    let mut specs = Vec::new();
    for &mesh in allowed {
        specs.extend(spec::read(g, mesh)?.map(|spec| (mesh, spec)));
    }
    spec::refuse_nested(&specs)?;
    let placing = placing(g, &specs)?;
    let (children, bytes) = weighed(g, &specs, &placing);
    if bytes > limit {
        let why = format!("{children} nodes to place, past the job's memory budget");
        return Err(CompilerError::new(
            "RAM_ADMISSION_BUDGET_EXCEEDED",
            format!("An assembly: {why}"),
        ));
    }
    if placing.is_empty() {
        return Ok(());
    }
    let nodes = values(g, "nodes")?;
    check_references(g, nodes)?;
    let mut drawn: Vec<Option<Vec<usize>>> = vec![None; specs.len()];
    // The first child of the first node that places each assembly: where its instances stand.
    let mut firsts: Vec<Option<usize>> = vec![None; specs.len()];
    for &(id, rank) in &placing {
        if drawn[rank].is_none() {
            drawn[rank] = Some(part_meshes(g, specs[rank].0, &specs[rank].1, resolved)?);
        }
        let parts = drawn[rank].as_deref().unwrap_or_default();
        let nodes = g["nodes"].as_array_mut().expect("nodes checked above");
        let name = nodes[id]["name"].as_str().unwrap_or("assembly").to_string();
        let first = nodes.len();
        firsts[rank].get_or_insert(first);
        let made = (specs[rank].1.nodes.iter().enumerate())
            .map(|(at, node)| child(&name, at, node, (specs[rank].0, parts[node.part])));
        let made: Vec<Value> = made.collect();
        let range = first..first + made.len();
        nodes.extend(made);
        append_children(&mut nodes[id], range)?;
    }
    settle(g, &specs, &firsts);
    Ok(())
}

/// What the assemblies that were laid out leave of their meshes: the assembly itself is gone from
/// the `extras`, which tell instead where its instances stand (`BUILT_EXTRA`: the first of the
/// `count` nodes that carry them, under the first node that places it, `firsts`). An assembly no
/// node places is left as it is.
fn settle(g: &mut Value, specs: &[(usize, Spec)], firsts: &[Option<usize>]) {
    for ((mesh, spec), first) in specs.iter().zip(firsts) {
        if first.is_none() {
            continue;
        }
        let extras = &mut g["meshes"][*mesh]["extras"];
        if let Some(extras) = extras.as_object_mut() {
            extras.remove("assembly");
        }
        extras[BUILT_EXTRA] = json!({"first": first, "count": spec.nodes.len()});
    }
}

/// The nodes that place an assembly built from no primitive of its own, once its levels are laid
/// out (`carriers.rs`), place nothing of their own: they only hold what stands under them.
pub(super) fn strip_bare(g: &mut Value) {
    let bare: Vec<bool> = (g["meshes"].as_array().into_iter().flatten())
        .map(|mesh| {
            let primitives = mesh.get("primitives").and_then(Value::as_array);
            mesh["extras"].get(BUILT_EXTRA).is_some() && primitives.is_none_or(Vec::is_empty)
        })
        .collect();
    for node in g["nodes"].as_array_mut().into_iter().flatten() {
        let mesh = node.get("mesh").and_then(Value::as_u64);
        if mesh.is_some_and(|mesh| bare.get(mesh as usize).copied().unwrap_or(false)) {
            node.as_object_mut().map(|fields| fields.remove("mesh"));
        }
    }
}
