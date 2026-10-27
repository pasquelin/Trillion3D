//! How a groom travels from the driver that read it to the compiler that builds it: inside the
//! intermediate scene. The driver writes each array of a `Description` as an accessor of the scene's
//! binary and cites them from the `TRILLION3D_hair_strands` extension of the node that carries the
//! curves (`extension`); the compiler reads them back and takes the extension out of the scene
//! (`take`). The accessors stay in the scene's tables, cited by nothing: the stages that follow copy
//! only the accessors a mesh or the scene itself cites, so these are not copied into the compiled
//! scene. The extension carries the name of a vendor, so that no glTF a user wrote is taken for a
//! groom.
//!
//! The extension of a node holds the accessors of its arrays by name: `counts` (the point count of
//! each strand, `UNSIGNED_INT`), `positions` (`VEC3`), and, each only if the file gives it,
//! `strandWidths` or `vertexWidths` (one for each strand or each point), `rootUvs` (`VEC2`), `colors`
//! (`VEC3`), `roughness`, `groupIds` (the group numbers, as the bits of `UNSIGNED_INT` words) and
//! `groupNames` (the rank of each strand's name in `names`, the array of the distinct names); and the
//! number `groomWidth`, when the file declares one.
use super::description::{Description, Widths};
use crate::compiler::accessor::codes::{ARRAY_BUFFER, FLOAT, UNSIGNED_INT};
use crate::compiler::accessor::types::reserve;
use crate::plugins::scene::convert::Bin;
use crate::support::le::words;
use crate::*;
use bytemuck::cast_slice;
use std::collections::BTreeSet;

// The arrays go into the binary as they lie in memory, which a glTF binary reads little-endian.
const _: () = assert!(cfg!(target_endian = "little"));

/// The key of a node's `extensions` that cites a groom.
const EXTENSION: &str = "TRILLION3D_hair_strands";

/// A groom taken out of the scene, and the node that carried it.
pub(crate) struct Carried {
    pub(crate) node: usize,
    pub(crate) description: Description,
}

impl Carried {
    /// Whether the scene shows the groom: its node is reached from the scene's roots and no hidden
    /// node hides it.
    pub(crate) fn is_shown(&self, scene_nodes: &BTreeSet<usize>, hidden: &BTreeSet<usize>) -> bool {
        scene_nodes.contains(&self.node) && !hidden.contains(&self.node)
    }
}

/// Whether `node` carries a groom.
pub(crate) fn carries(node: &Value) -> bool {
    node.pointer("/extensions")
        .and_then(|extensions| extensions.get(EXTENSION))
        .is_some()
}

/// The kind of an accessor of arrays of `width` numbers each.
const KINDS: [&str; 3] = ["SCALAR", "VEC2", "VEC3"];

/// Appends the arrays of `d` to `bin`, as accessors pushed on `accessors`, and returns the
/// `extensions` of the node that carries them. An array the groom does not hold is not cited.
pub(crate) fn extension(d: &Description, bin: &mut Bin, accessors: &mut Vec<Value>) -> Value {
    let (widths_key, widths): (&str, &[f32]) = match &d.widths {
        Widths::None => ("", &[]),
        Widths::Strand(widths) => ("strandWidths", widths),
        Widths::Vertex(widths) => ("vertexWidths", widths),
    };
    // Each array by its key, its bytes, the component of its numbers and how many make an element.
    let arrays: [(&str, &[u8], usize, usize); 8] = [
        ("counts", cast_slice(&d.counts), UNSIGNED_INT, 1),
        ("positions", cast_slice(&d.positions), FLOAT, 3),
        (widths_key, cast_slice(widths), FLOAT, 1),
        ("rootUvs", cast_slice(&d.root_uvs), FLOAT, 2),
        ("colors", cast_slice(&d.colors), FLOAT, 3),
        ("roughness", cast_slice(&d.roughness), FLOAT, 1),
        ("groupIds", cast_slice(&d.group_ids), UNSIGNED_INT, 1),
        ("groupNames", cast_slice(&d.group_names), UNSIGNED_INT, 1),
    ];
    let mut groom = json!({});
    for (key, bytes, component, width) in arrays {
        if bytes.is_empty() {
            continue;
        }
        let view = bin.view(bytes, Some(ARRAY_BUFFER));
        accessors.push(json!({"bufferView": view, "componentType": component,
            "count": bytes.len() / (4 * width), "type": KINDS[width - 1]}));
        groom[key] = json!(accessors.len() - 1);
    }
    if !d.group_names.is_empty() {
        groom["names"] = json!(d.names);
    }
    if let Some(width) = d.groom_width {
        groom["groomWidth"] = json!(width);
    }
    json!({ EXTENSION: groom })
}

/// The grooms the nodes of `g` cite, read from `bin`, and removed from `g`: the node keeps its other
/// extensions. A groom whose arrays do not fit one another, or an array that is not what it is cited
/// as, refuses the scene.
pub(crate) fn take(g: &mut Value, bin: &[u8]) -> Result<Vec<Carried>> {
    let count = g.get("nodes").and_then(Value::as_array).map_or(0, Vec::len);
    let mut cited = Vec::new();
    for node in 0..count {
        let Some(object) = g["nodes"][node].as_object_mut() else {
            continue;
        };
        let Some(extensions) = object.get_mut("extensions").and_then(Value::as_object_mut) else {
            continue;
        };
        let Some(groom) = extensions.remove(EXTENSION) else {
            continue;
        };
        if extensions.is_empty() {
            object.remove("extensions");
        }
        cited.push((node, groom));
    }
    cited
        .into_iter()
        .map(|(node, groom)| {
            let description = read(g, bin, &groom)?;
            Ok::<Carried, CompilerError>(Carried { node, description })
        })
        .collect()
}

/// The accessor `key` of `groom` names, if it names one.
fn cites(groom: &Value, key: &str) -> Result<Option<usize>> {
    groom
        .get(key)
        .map(|id| required_index(Some(id), &format!("node.extensions.{EXTENSION}.{key}")))
        .transpose()
}

/// The numbers of accessor `id`, read as `from` reads four bytes: a plain accessor of the component
/// and the width it is cited for, whose every number is kept as it is — a value that is not finite is
/// for the builder to leave its curve out.
fn plain<T>(
    (g, bin): (&Value, &[u8]),
    id: usize,
    (component, width): (usize, usize),
    from: fn([u8; 4]) -> T,
) -> Result<Vec<T>> {
    let a = accessor(g, bin, id, None)?;
    if a.component != component
        || a.normalized
        || a.width != width
        || !a.has_buffer_view
        || a.sparse.is_some()
    {
        return Err(invalid(
            "hair strands: an array is not a plain accessor of the type it is cited for",
        ));
    }
    let mut out = reserve(a.count * width)?;
    out.extend(a.elements().flat_map(|element| words(element, from)));
    Ok(out)
}

/// The array `key` of `groom` cites, as `plain` reads it; none when it cites none.
fn array<T>(
    scene: (&Value, &[u8]),
    groom: &Value,
    key: &str,
    kind: (usize, usize),
    from: fn([u8; 4]) -> T,
) -> Result<Vec<T>> {
    match cites(groom, key)? {
        Some(id) => plain(scene, id, kind, from),
        None => Ok(Vec::new()),
    }
}

/// The description a node's `groom` cites.
fn read(g: &Value, bin: &[u8], groom: &Value) -> Result<Description> {
    let scene = (g, bin);
    let floats =
        |key: &str, width: usize| array(scene, groom, key, (FLOAT, width), f32::from_le_bytes);
    let widths = match (floats("strandWidths", 1)?, floats("vertexWidths", 1)?) {
        (strand, vertex) if strand.is_empty() && vertex.is_empty() => Widths::None,
        (strand, vertex) if vertex.is_empty() => Widths::Strand(strand),
        (strand, vertex) if strand.is_empty() => Widths::Vertex(vertex),
        _ => {
            return Err(invalid(
                "hair strands: widths are given for each strand and for each point",
            ))
        }
    };
    let names = match groom.get("names") {
        None => Vec::new(),
        Some(names) => names
            .as_array()
            .and_then(|names| {
                names
                    .iter()
                    .map(|name| name.as_str().map(str::to_string))
                    .collect()
            })
            .ok_or_else(|| invalid("hair strands: `names` holds text"))?,
    };
    let counts =
        cites(groom, "counts")?.ok_or_else(|| invalid("hair strands: `counts` is required"))?;
    let positions = cites(groom, "positions")?
        .ok_or_else(|| invalid("hair strands: `positions` is required"))?;
    let description = Description {
        counts: plain(scene, counts, (UNSIGNED_INT, 1), u32::from_le_bytes)?,
        positions: plain(scene, positions, (FLOAT, 3), f32::from_le_bytes)?,
        widths,
        root_uvs: floats("rootUvs", 2)?,
        colors: floats("colors", 3)?,
        roughness: floats("roughness", 1)?,
        group_ids: array(
            scene,
            groom,
            "groupIds",
            (UNSIGNED_INT, 1),
            i32::from_le_bytes,
        )?,
        names,
        group_names: array(
            scene,
            groom,
            "groupNames",
            (UNSIGNED_INT, 1),
            u32::from_le_bytes,
        )?,
        groom_width: finite(groom.get("groomWidth")).map(|width| width as f32),
    };
    if !description.fits() {
        return Err(invalid(
            "hair strands: the arrays of a groom do not fit one another",
        ));
    }
    Ok(description)
}
