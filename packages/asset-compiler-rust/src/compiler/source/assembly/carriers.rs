//! The primitives that carry the levels above an assembly's instances (`dag::assembly`): clusters
//! hold one material and the attributes their page carries, so each group of instance primitives
//! that share both climbs into the primitive of the assembly's mesh that has them — its own
//! triangles the level 0 of that climb — or, where the mesh has none, into one the load adds, its
//! only triangle a placeholder that is never read (`TOP_EXTRA`). A group of one instance climbs
//! only into a primitive the mesh already has: there is nothing to climb over beside it, and the
//! import report counts the groups left out (`Laid::alone`). A placeholder that fewer than two
//! instances can join once the parts are compiled builds no job at all
//! (`compiler/primitive/carrying.rs`).
//!
//! Each carrier is told to the compile on the assembly's mesh (`BUILT_EXTRA`), with the instances
//! that join it: `[node, primitive of its part]` pairs (`plan.rs`).
use super::plan::{extra, material_of, BUILT_EXTRA, TOP_EXTRA};
use crate::compiler::accessor::codes::element_shape;
use crate::compiler::primitive::triangles::is_static_triangles;
use crate::compiler::source::synth::{float_accessor, position_accessor, seal};
use crate::*;
use std::collections::BTreeMap;
use trillion3d_page_codec::encode::{PAGE_ATTRIBUTES, TANGENT_ATTRIBUTE};
use trillion3d_page_codec::FLAG_COLOR;

/// What two primitives share when their clusters can: the material, and the attributes carried —
/// the glTF semantic of each and its width, a colour being three or four wide.
type Key = (Option<usize>, Vec<(&'static str, usize)>);

/// The width of the accessor `id` of `g`: the component count its vector type names (`element_shape`,
/// the one table of the widths), none for a scalar or a matrix.
fn width_of(g: &Value, id: &Value) -> Option<usize> {
    let accessor = g.get("accessors")?.get(id.as_u64()? as usize)?;
    let (columns, rows) = element_shape(accessor.get("type")?.as_str()?)?;
    (columns == 1 && rows > 1).then_some(rows)
}

/// The key of primitive `p` of `g`, none for one that draws no rigid triangles: its material and
/// each attribute a page carries beside the positions that it names (`PAGE_ATTRIBUTES`, then the
/// stored tangent).
fn key_of(g: &Value, p: &Value) -> Option<Key> {
    if !is_static_triangles(p) {
        return None;
    }
    let material = material_of(p);
    let named = p.get("attributes");
    let page = PAGE_ATTRIBUTES
        .iter()
        .chain(std::iter::once(&TANGENT_ATTRIBUTE));
    let carried = page.filter_map(|&(semantic, width, flag)| {
        let id = named?.get(semantic)?;
        let width = if flag == FLAG_COLOR {
            width_of(g, id).unwrap_or(width)
        } else {
            width
        };
        Some((semantic, width))
    });
    Some((material, carried.collect()))
}

/// The instances of one assembly that share a key: `(node, primitive of its part)` pairs, and the
/// primitive of the assembly's mesh that has the key — none when it has none.
struct Group {
    key: Key,
    uses: Vec<(usize, usize)>,
    carrier: Option<usize>,
}

impl Group {
    /// Whether the group climbs nowhere: the mesh has no primitive of its key and fewer than two
    /// instances would join one that is added.
    fn is_alone(&self) -> bool {
        self.carrier.is_none() && self.uses.len() < 2
    }
}

/// The groups the instances `first..first + count` of assembly `mesh` make, in the order their keys
/// sort: each primitive of each part its node draws, under its key. The keys of a part's primitives
/// are read once, however many nodes name it.
fn groups_of(g: &Value, mesh: usize, (first, count): (usize, usize)) -> Result<Vec<Group>> {
    let (nodes, meshes) = (values(g, "nodes")?, values(g, "meshes")?);
    let keys_of = |mesh: &Value| -> Result<Vec<Option<Key>>> {
        Ok(values(mesh, "primitives")?
            .iter()
            .map(|p| key_of(g, p))
            .collect())
    };
    let mut parts: BTreeMap<usize, Vec<Option<Key>>> = BTreeMap::new();
    let mut drawing = Vec::with_capacity(count);
    for at in 0..count {
        let node = item(nodes, first + at, "node")?;
        let part = required_index(node.get("mesh"), "node.mesh")?;
        if let std::collections::btree_map::Entry::Vacant(slot) = parts.entry(part) {
            slot.insert(keys_of(item(meshes, part, "mesh")?)?);
        }
        drawing.push(part);
    }
    // The keys live in `parts`: the groups borrow them, and take a copy each once they are made.
    let mut by_key: BTreeMap<&Key, Vec<(usize, usize)>> = BTreeMap::new();
    for (at, part) in drawing.into_iter().enumerate() {
        for (drawn, key) in parts[&part].iter().enumerate() {
            if let Some(key) = key {
                by_key.entry(key).or_default().push((at, drawn));
            }
        }
    }
    let own = keys_of(&meshes[mesh])?;
    Ok(by_key
        .into_iter()
        .map(|(key, uses)| Group {
            carrier: own.iter().position(|own| own.as_ref() == Some(key)),
            key: key.clone(),
            uses,
        })
        .collect())
}

/// The primitive that carries the levels of a group of key `key`, added to mesh `mesh`: one
/// placeholder triangle of three vertices at the origin and every attribute the key names, zeros,
/// each as wide as the key says; its accessors laid after the binary's end. Its rank among the
/// mesh's primitives.
fn add_carrier(g: &mut Value, out: &mut Vec<u8>, mesh: usize, key: &Key) -> Result<usize> {
    let mut attributes = serde_json::Map::new();
    let position = position_accessor(g, out, &[0.0; 9])?;
    attributes.insert("POSITION".into(), json!(position));
    for &(semantic, width) in &key.1 {
        let zeros = vec![0.0f32; 3 * width];
        let accessor = float_accessor(g, out, &zeros, (&format!("VEC{width}"), width))?;
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
    let attributes =
        |group: &Group| -> usize { (group.key.1.iter()).map(|&(_, width)| 12 * width + 4).sum() };
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

/// What the carriers pass leaves: the binary with the placeholders' arrays appended — as it came, a
/// mapped one still mapped, when none is added — and how many groups of instances climb nowhere
/// (`Group::is_alone`), which the import report counts.
pub(super) struct Laid {
    pub binary: Binary,
    pub alone: usize,
}

/// Tells each assembly's mesh the primitives that carry its levels and the instances that join each
/// (`BUILT_EXTRA`), adding the primitives it lacks, within `limit` bytes of memory.
pub(super) fn lay(g: &mut Value, binary: Binary, limit: usize) -> Result<Laid> {
    let built: Vec<(usize, usize, usize)> = (values(g, "meshes")?.iter().enumerate())
        .filter_map(|(mesh, source)| {
            let built = extra(source, BUILT_EXTRA)?;
            let at = |key: &str| built.get(key)?.as_u64().map(|n| n as usize);
            Some((mesh, at("first")?, at("count")?))
        })
        .collect();
    let mut planned = Vec::with_capacity(built.len());
    for &(mesh, first, count) in &built {
        planned.push(groups_of(g, mesh, (first, count))?);
    }
    let alone = planned
        .iter()
        .flatten()
        .filter(|group| group.is_alone())
        .count();
    let appended: usize = planned.iter().map(|groups| carrier_bytes(groups)).sum();
    if appended == 0 {
        for (&(mesh, ..), groups) in built.iter().zip(planned) {
            record(g, mesh, groups, None)?;
        }
        return Ok(Laid { binary, alone });
    }
    if binary.bytes().len().saturating_add(appended) > limit {
        return Err(CompilerError::new(
            "RAM_ADMISSION_BUDGET_EXCEEDED",
            "An assembly: its carriers' arrays are past the job's memory budget",
        ));
    }
    let mut out = binary.into_owned(appended)?;
    for (&(mesh, ..), groups) in built.iter().zip(planned) {
        record(g, mesh, groups, Some(&mut out))?;
    }
    seal(g, &out);
    Ok(Laid {
        binary: Binary::Owned(out),
        alone,
    })
}
