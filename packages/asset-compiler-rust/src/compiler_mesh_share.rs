//! Meshes of identical content, shared before anything is cooked.
//!
//! Two meshes whose primitives read the same bytes, with the same material and the same fields,
//! are one mesh placed twice: every node naming the later one is pointed at the first, so their
//! content is cooked once, listed once in the manifest and written on the same pages, exactly what
//! the scene compiles to when it instances the mesh itself. Content is compared, never names: an
//! accessor is its declared layout and the bytes of its elements read through its view and
//! stride, so two copies of a buffer in two views are one content, and a single differing bit
//! (−0 against +0, another NaN payload) keeps two meshes apart. A sparse accessor, or one that
//! cannot be read, is only ever equal to itself: validation further on reports it as before. A
//! mesh a skinned node names is left alone, so no mesh becomes skinned by sharing. Whole meshes
//! are compared: two meshes that share only some of their primitives are cooked apart.
use super::*;
use sha2::{Digest, Sha256};
use std::collections::HashMap;

/// Accessor fields that make its layout; the bytes of its elements are hashed apart.
const LAYOUT: [&str; 6] = ["componentType", "type", "normalized", "count", "min", "max"];

/// Points every node at the first mesh of identical content; returns the nodes re-pointed.
pub(super) fn share_identical_meshes(g: &mut Value, bin: &[u8]) -> usize {
    let shared = duplicates(g, bin);
    let mut repointed = 0;
    for node in g
        .get_mut("nodes")
        .and_then(Value::as_array_mut)
        .into_iter()
        .flatten()
    {
        let mesh = node.get("mesh").and_then(Value::as_u64);
        if let Some(&first) = mesh.and_then(|mesh| shared.get(&(mesh as usize))) {
            node["mesh"] = json!(first);
            repointed += 1;
        }
    }
    repointed
}

/// Each mesh that repeats an earlier one, mapped to that earlier one. Layouts are compared first,
/// with no byte read; only meshes whose layouts meet have their bytes hashed.
fn duplicates(g: &Value, bin: &[u8]) -> BTreeMap<usize, usize> {
    let (Some(meshes), Some(nodes)) = (
        g.get("meshes").and_then(Value::as_array),
        g.get("nodes").and_then(Value::as_array),
    ) else {
        return BTreeMap::new();
    };
    let mesh_of = |node: &Value| Some(node.get("mesh")?.as_u64()? as usize);
    let skinned: BTreeSet<usize> = (nodes.iter())
        .filter(|node| node.get("skin").is_some())
        .filter_map(mesh_of)
        .collect();
    let unskinned: BTreeSet<usize> = (nodes.iter())
        .filter_map(mesh_of)
        .filter(|mesh| *mesh < meshes.len() && !skinned.contains(mesh))
        .collect();
    let mut by_layout: BTreeMap<String, Vec<usize>> = BTreeMap::new();
    for mesh in unskinned {
        let key = signature(&meshes[mesh], &mut |id| layout(g, id)).to_string();
        by_layout.entry(key).or_default().push(mesh);
    }
    let mut contents: HashMap<usize, Value> = HashMap::new();
    let mut shared = BTreeMap::new();
    for candidates in by_layout.into_values().filter(|group| group.len() > 1) {
        let mut first_of: BTreeMap<String, usize> = BTreeMap::new();
        for mesh in candidates {
            let key = signature(&meshes[mesh], &mut |id| {
                contents
                    .entry(id)
                    .or_insert_with(|| content(g, bin, id))
                    .clone()
            });
            let first = *first_of.entry(key.to_string()).or_insert(mesh);
            if first != mesh {
                shared.insert(mesh, first);
            }
        }
    }
    shared
}

/// A mesh without its name, each accessor it reads replaced by `accessor(id)`.
fn signature(mesh: &Value, accessor: &mut impl FnMut(usize) -> Value) -> Value {
    let mut mesh = mesh.clone();
    if let Some(fields) = mesh.as_object_mut() {
        fields.remove("name");
    }
    let mut replace = |slot: &mut Value| {
        if let Some(id) = slot.as_u64() {
            *slot = accessor(id as usize);
        }
    };
    let primitives = mesh.get_mut("primitives").and_then(Value::as_array_mut);
    for primitive in primitives.into_iter().flatten() {
        for (field, value) in primitive.as_object_mut().into_iter().flatten() {
            match (field.as_str(), value) {
                ("indices", slot) => replace(slot),
                ("attributes", Value::Object(slots)) => slots.values_mut().for_each(&mut replace),
                ("targets", Value::Array(targets)) => (targets.iter_mut())
                    .filter_map(Value::as_object_mut)
                    .flat_map(|slots| slots.values_mut())
                    .for_each(&mut replace),
                _ => {}
            }
        }
    }
    mesh
}

/// Accessor `id` when it can be equal to no other: sparse, missing or unreadable.
fn only(id: usize) -> Value {
    json!({ "accessor": id })
}

/// The declared layout of accessor `id`; a sparse or missing one is only itself.
fn layout(g: &Value, id: usize) -> Value {
    let found = g
        .get("accessors")
        .and_then(Value::as_array)
        .and_then(|accessors| accessors.get(id));
    match found {
        Some(a) if a.get("sparse").is_none() => {
            LAYOUT.iter().map(|&f| json!([f, a.get(f)])).collect()
        }
        _ => only(id),
    }
}

/// The layout of accessor `id` and the digest of its element bytes, or `id` alone when it is
/// sparse or cannot be read.
fn content(g: &Value, bin: &[u8], id: usize) -> Value {
    match (layout(g, id), element_digest(g, bin, id)) {
        (Value::Array(mut fields), Some(digest)) => {
            fields.push(json!(digest));
            Value::Array(fields)
        }
        _ => only(id),
    }
}

/// SHA-256 of the accessor's elements, each element's bytes read through its view and stride.
fn element_digest(g: &Value, bin: &[u8], id: usize) -> Option<String> {
    // `accessor` refuses a view-less accessor unless it is sparse, and a sparse one is only itself.
    let a = accessor(g, bin, id, None)
        .ok()
        .filter(|a| a.has_buffer_view)?;
    let size = a.width.checked_mul(a.bytes)?;
    let mut sha = Sha256::new();
    if a.stride == size {
        // Tightly packed: the elements are one run of bytes, hashed in one update.
        sha.update(
            a.bin
                .get(a.base..a.base.checked_add(a.count.checked_mul(size)?)?)?,
        );
    } else {
        for i in 0..a.count {
            let at = a.base.checked_add(i.checked_mul(a.stride)?)?;
            sha.update(a.bin.get(at..at.checked_add(size)?)?);
        }
    }
    Some(format!("{:x}", sha.finalize()))
}
