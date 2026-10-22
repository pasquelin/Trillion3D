//! The primitives that carry the levels above an assembly's instances (`dag::assembly`): clusters
//! hold one material and the attributes their page carries, so each group of instance primitives
//! that share both climbs into the primitive of the assembly's mesh that has them — its own
//! triangles the level 0 of that climb — or, where the mesh has none, into one the load adds, its
//! only triangle a placeholder that is never read (`TOP_EXTRA`). A group of one instance climbs
//! only into a primitive the mesh already has: there is nothing to climb over beside it.
//!
//! Each carrier is told to the compile on the assembly's mesh (`BUILT_EXTRA`), with the instances
//! that join it: `[node, primitive of its part]` pairs (`plan.rs`).
use super::plan::{BUILT_EXTRA, TOP_EXTRA};
use crate::compiler::primitive::triangles::{is_rigid, is_triangle_list};
use crate::compiler::source::synth::{float_accessor, position_accessor, seal};
use crate::*;
use std::collections::BTreeMap;

/// The attributes a page carries beside the positions, by the semantic and the accessor type that
/// name them in a glTF primitive: the normal, the stored tangent, the four texture sets, the
/// colour.
const CARRIED: [(&str, &str, usize); 7] = [
    ("NORMAL", "VEC3", 3),
    ("TANGENT", "VEC4", 4),
    ("TEXCOORD_0", "VEC2", 2),
    ("TEXCOORD_1", "VEC2", 2),
    ("TEXCOORD_2", "VEC2", 2),
    ("TEXCOORD_3", "VEC2", 2),
    ("COLOR_0", "VEC4", 4),
];

/// What two primitives share when their clusters can: the material and the attributes carried.
type Key = (Option<usize>, Vec<usize>);

/// The key of primitive `p`, none for one that draws no rigid triangles.
fn key_of(p: &Value) -> Option<Key> {
    if !is_triangle_list(p) || !is_rigid(p) {
        return None;
    }
    let material = p
        .get("material")
        .and_then(Value::as_u64)
        .map(|m| m as usize);
    let named = |semantic: &str| p.pointer(&format!("/attributes/{semantic}")).is_some();
    let carried = (CARRIED.iter().enumerate()).filter(|(_, (semantic, ..))| named(semantic));
    Some((material, carried.map(|(rank, _)| rank).collect()))
}

/// The instances of one assembly that share a key: `(node, primitive of its part)` pairs, the
/// primitive of the assembly's mesh that has the key — none when it has none — and, for a primitive
/// to be added, the first of them (the one whose attributes it takes).
struct Group {
    key: Key,
    uses: Vec<(usize, usize)>,
    carrier: Option<usize>,
}

/// The groups the instances `first..first + count` of assembly `mesh` make, in the order their keys
/// sort: each primitive of each part its node draws, under its key.
fn groups_of(g: &Value, mesh: usize, (first, count): (usize, usize)) -> Result<Vec<Group>> {
    let (nodes, meshes) = (values(g, "nodes")?, values(g, "meshes")?);
    let mut by_key: BTreeMap<Key, Vec<(usize, usize)>> = BTreeMap::new();
    for at in 0..count {
        let node = item(nodes, first + at, "node")?;
        let part = item(
            meshes,
            required_index(node.get("mesh"), "node.mesh")?,
            "mesh",
        )?;
        for (drawn, p) in values(part, "primitives")?.iter().enumerate() {
            if let Some(key) = key_of(p) {
                by_key.entry(key).or_default().push((at, drawn));
            }
        }
    }
    let own: Vec<Option<Key>> = (values(&meshes[mesh], "primitives")?.iter())
        .map(key_of)
        .collect();
    Ok(by_key
        .into_iter()
        .map(|(key, uses)| Group {
            carrier: own.iter().position(|own| own.as_ref() == Some(&key)),
            key,
            uses,
        })
        .collect())
}

/// The primitive that carries the levels of a group of key `key`, added to mesh `mesh`: one
/// placeholder triangle of three vertices at the origin and every attribute the key names, zeros;
/// its accessors laid after the binary's end. Its rank among the mesh's primitives.
fn add_carrier(g: &mut Value, out: &mut Vec<u8>, mesh: usize, key: &Key) -> Result<usize> {
    let mut attributes = serde_json::Map::new();
    let position = position_accessor(g, out, &[0.0; 9])?;
    attributes.insert("POSITION".into(), json!(position));
    for &rank in &key.1 {
        let (semantic, kind, width) = CARRIED[rank];
        let zeros = vec![0.0f32; 3 * width];
        let accessor = float_accessor(g, out, &zeros, (kind, width))?;
        attributes.insert(semantic.into(), json!(accessor));
    }
    let mut primitive = json!({"attributes": attributes, "extras": {(TOP_EXTRA): true}});
    if let Some(material) = key.0 {
        primitive["material"] = json!(material);
    }
    let primitives = g["meshes"][mesh]["primitives"].as_array_mut();
    let primitives = primitives.ok_or_else(|| invalid("mesh.primitives is required"))?;
    primitives.push(primitive);
    Ok(primitives.len() - 1)
}

/// Whether the primitive that carries `group` is to be added: the mesh has none, and two instances
/// or more join it.
fn needs_carrier(group: &Group) -> bool {
    group.carrier.is_none() && group.uses.len() >= 2
}

/// About how many bytes the placeholders of `groups` append to the binary: three vertices of the
/// positions and of each attribute, each array four-aligned.
fn carrier_bytes(groups: &[Group]) -> usize {
    let attributes = |group: &Group| -> usize {
        (group.key.1.iter())
            .map(|&rank| 12 * CARRIED[rank].2 + 4)
            .sum()
    };
    (groups.iter().filter(|group| needs_carrier(group)))
        .map(|group| 40 + attributes(group))
        .fold(0, usize::saturating_add)
}

/// The carriers of the assembly `mesh`'s `groups`, added where it lacks them, told on its mesh
/// (`BUILT_EXTRA`): each `{primitive, uses}`; a group nothing carries is left out.
fn record(
    g: &mut Value,
    mesh: usize,
    groups: Vec<Group>,
    mut out: Option<&mut Vec<u8>>,
) -> Result<()> {
    let mut carriers = Vec::with_capacity(groups.len());
    for group in groups {
        let primitive = match (group.carrier, out.as_deref_mut()) {
            (Some(primitive), _) => primitive,
            (None, Some(out)) if needs_carrier(&group) => add_carrier(g, out, mesh, &group.key)?,
            _ => continue,
        };
        let uses: Vec<Value> = group
            .uses
            .iter()
            .map(|&(at, drawn)| json!([at, drawn]))
            .collect();
        carriers.push(json!({"primitive": primitive, "uses": uses}));
    }
    g["meshes"][mesh]["extras"][BUILT_EXTRA]["carriers"] = Value::Array(carriers);
    Ok(())
}

/// Tells each assembly's mesh the primitives that carry its levels and the instances that join each
/// (`BUILT_EXTRA`), adding the primitives it lacks; the binary with their arrays appended, within
/// `limit` bytes of memory, and as it came — a mapped one still mapped — when none is added.
pub(super) fn lay(g: &mut Value, binary: Binary, limit: usize) -> Result<Binary> {
    let built: Vec<(usize, usize, usize)> = (values(g, "meshes")?.iter().enumerate())
        .filter_map(|(mesh, source)| {
            let at = |key: &str| {
                let value = source.pointer(&format!("/extras/{BUILT_EXTRA}/{key}"));
                value.and_then(Value::as_u64).map(|n| n as usize)
            };
            Some((mesh, at("first")?, at("count")?))
        })
        .collect();
    let mut planned = Vec::with_capacity(built.len());
    for &(mesh, first, count) in &built {
        planned.push(groups_of(g, mesh, (first, count))?);
    }
    let extra: usize = planned.iter().map(|groups| carrier_bytes(groups)).sum();
    if extra == 0 {
        for (&(mesh, ..), groups) in built.iter().zip(planned) {
            record(g, mesh, groups, None)?;
        }
        return Ok(binary);
    }
    if binary.bytes().len().saturating_add(extra) > limit {
        return Err(CompilerError::new(
            "RAM_ADMISSION_BUDGET_EXCEEDED",
            "An assembly: its carriers' arrays are past the job's memory budget",
        ));
    }
    let mut out = binary.into_owned(extra)?;
    for (&(mesh, ..), groups) in built.iter().zip(planned) {
        record(g, mesh, groups, Some(&mut out))?;
    }
    seal(g, &out);
    Ok(Binary::Owned(out))
}
