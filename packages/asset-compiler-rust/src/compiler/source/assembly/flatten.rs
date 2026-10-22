//! The flat primitives of an assembly (`assembly.rs`): its own triangles and, for every node, the
//! triangles of the part it names carried by the node's transform, laid in the primitives of one
//! material each. A primitive remembers its blocks — the mesh's own triangles first, then each
//! node's —, which the DAG builds apart (`dag/assembly.rs`).
use super::piece::{Piece, Placement};
use super::spec::{refused, Node, Part, Spec, ASSEMBLY_EXTRA};
use crate::compiler::source::synth::{float_accessor, index_accessor};
use crate::*;
use std::collections::BTreeMap;
use trillion3d_page_codec::MAX_UV_SETS;

/// The triangles of one material: the mesh's own, then the nodes'.
#[derive(Default)]
struct Group {
    base: Vec<Piece>,
    instances: Vec<Piece>,
}

/// The material primitive `p` names, none when it names none.
fn own_material(p: &Value) -> Result<Option<usize>> {
    let named = p.get("material");
    named
        .map(|id| required_index(Some(id), "primitive.material"))
        .transpose()
}

/// The pieces of the triangle primitives of `part`'s mesh, each with the material the assembly
/// draws it with: the part's `materialRemap`, else its own.
fn part_pieces(g: &Value, bin: &[u8], part: &Part) -> Result<Vec<(Option<usize>, Piece)>> {
    let mesh = item(values(g, "meshes")?, part.mesh, "mesh")?;
    let mut pieces = Vec::new();
    for (rank, p) in values(mesh, "primitives")?.iter().enumerate() {
        let Some(piece) = Piece::read(g, bin, p)? else {
            continue;
        };
        let remapped = part.remap.as_ref().and_then(|list| list.get(rank));
        let material = match remapped {
            Some(material) => *material,
            None => own_material(p)?,
        };
        pieces.push((material, piece));
    }
    Ok(pieces)
}

/// The arrays of a group's blocks laid one after the other.
#[derive(Default)]
struct Flat {
    positions: Vec<f32>,
    indices: Vec<u32>,
    normals: Vec<f32>,
    tangents: Vec<f32>,
    uvs: [Vec<f32>; MAX_UV_SETS],
    colours: Vec<f32>,
}

/// Which attributes a group's primitive carries: normals and tangents only when every piece has
/// them, a texture set or a colour when any has, the others given the value of none.
struct Carried {
    normals: bool,
    tangents: bool,
    uvs: [bool; MAX_UV_SETS],
    colours: bool,
}

impl Carried {
    fn of(pieces: &[&Piece]) -> Self {
        Self {
            normals: pieces.iter().all(|p| p.normals.is_some()),
            tangents: pieces.iter().all(|p| p.tangents.is_some()),
            uvs: core::array::from_fn(|k| pieces.iter().any(|p| p.uvs[k].is_some())),
            colours: pieces.iter().any(|p| p.colours.is_some()),
        }
    }
}

impl Flat {
    /// Appends `piece`, its indices past the vertices already laid.
    fn append(&mut self, piece: &Piece, carried: &Carried) -> Result<()> {
        let base = u32::try_from(self.positions.len() / 3)
            .map_err(|_| refused("an assembly", "it holds more vertices than a mesh can"))?;
        let count = piece.positions.len() / 3;
        self.positions.extend_from_slice(&piece.positions);
        self.indices.extend(piece.indices.iter().map(|i| i + base));
        if let (true, Some(values)) = (carried.normals, &piece.normals) {
            self.normals.extend_from_slice(values);
        }
        if let (true, Some(values)) = (carried.tangents, &piece.tangents) {
            self.tangents.extend_from_slice(values);
        }
        for (k, laid) in self
            .uvs
            .iter_mut()
            .enumerate()
            .filter(|(k, _)| carried.uvs[*k])
        {
            match &piece.uvs[k] {
                Some(values) => laid.extend_from_slice(values),
                None => laid.resize(laid.len() + count * 2, 0.0),
            }
        }
        if carried.colours {
            match &piece.colours {
                Some(values) => self.colours.extend_from_slice(values),
                None => self.colours.resize(self.colours.len() + count * 4, 1.0),
            }
        }
        Ok(())
    }
}

/// The primitive of one material: the group's blocks, the mesh's own as one, then each node's.
fn primitive_of(
    g: &mut Value,
    out: &mut Vec<u8>,
    material: Option<usize>,
    group: &Group,
) -> Result<Value> {
    let pieces: Vec<&Piece> = group.base.iter().chain(&group.instances).collect();
    let carried = Carried::of(&pieces);
    let mut flat = Flat::default();
    let mut blocks: Vec<[usize; 4]> = Vec::new();
    let mut lay = |flat: &mut Flat, pieces: &[&Piece]| -> Result<()> {
        let (vertices, indices) = (flat.positions.len() / 3, flat.indices.len());
        for piece in pieces {
            flat.append(piece, &carried)?;
        }
        let now = (flat.positions.len() / 3, flat.indices.len());
        blocks.push([vertices, now.0 - vertices, indices, now.1 - indices]);
        Ok(())
    };
    if !group.base.is_empty() {
        lay(&mut flat, &group.base.iter().collect::<Vec<_>>())?;
    }
    for piece in &group.instances {
        lay(&mut flat, &[piece])?;
    }
    let mut attributes = serde_json::Map::new();
    let mut put = |name: &str, values: &[f32], width: usize, bounds: bool| -> Result<()> {
        let id = float_accessor(g, out, values, width, bounds)?;
        attributes.insert(name.to_string(), json!(id));
        Ok(())
    };
    put("POSITION", &flat.positions, 3, true)?;
    if carried.normals {
        put("NORMAL", &flat.normals, 3, false)?;
    }
    if carried.tangents {
        put("TANGENT", &flat.tangents, 4, false)?;
    }
    for (k, laid) in flat.uvs.iter().enumerate().filter(|(k, _)| carried.uvs[*k]) {
        put(&format!("TEXCOORD_{k}"), laid, 2, false)?;
    }
    if carried.colours {
        put("COLOR_0", &flat.colours, 4, false)?;
    }
    let indices = index_accessor(g, out, &flat.indices)?;
    let layout = json!({"base": !group.base.is_empty(), "blocks": blocks});
    let mut primitive = json!({
        "attributes": attributes, "indices": indices, "mode": 4,
        "extras": { ASSEMBLY_EXTRA: layout },
    });
    if let Some(material) = material {
        primitive["material"] = json!(material);
    }
    Ok(primitive)
}

/// How many times the bytes of a carried part are held at once: the carried piece, the flat array
/// it is laid in and its bytes in the binary.
const COPIES: usize = 3;

/// Refuses an assembly whose carried parts would not fit `limit` bytes beside the binary `out`.
fn admit(
    parts: &[Vec<(Option<usize>, Piece)>],
    nodes: &[Node],
    out: usize,
    limit: usize,
) -> Result<()> {
    let held = |node: &Node| parts[node.part].iter().map(|(_, piece)| piece.bytes());
    let carried = nodes
        .iter()
        .flat_map(held)
        .fold(0usize, usize::saturating_add);
    if out.saturating_add(carried.saturating_mul(COPIES)) <= limit {
        return Ok(());
    }
    let mib = carried / (1024 * 1024);
    let why = format!(
        "its {} nodes carry {mib} MiB of parts, past the job's memory budget",
        nodes.len()
    );
    Err(CompilerError::new(
        "RAM_ADMISSION_BUDGET_EXCEEDED",
        format!("An assembly: {why}"),
    ))
}

/// Replaces the primitives of assembly mesh `mesh` by the flat primitives of its assembly, the
/// arrays appended to `out`, within `limit` bytes of memory; a mesh that names no part or no node
/// is left as it is.
pub(super) fn expand(
    g: &mut Value,
    out: &mut Vec<u8>,
    (mesh, limit): (usize, usize),
    spec: &Spec,
) -> Result<()> {
    let mut groups: BTreeMap<Option<usize>, Group> = BTreeMap::new();
    let mut kept = Vec::new();
    for p in values(item(values(g, "meshes")?, mesh, "mesh")?, "primitives")? {
        match Piece::read(g, out, p)? {
            Some(piece) => groups.entry(own_material(p)?).or_default().base.push(piece),
            None => kept.push(p.clone()),
        }
    }
    let mut used = vec![false; spec.parts.len()];
    spec.nodes
        .iter()
        .for_each(|node: &Node| used[node.part] = true);
    let mut parts: Vec<Vec<(Option<usize>, Piece)>> = Vec::with_capacity(spec.parts.len());
    for (part, used) in spec.parts.iter().zip(used) {
        parts.push(if used {
            part_pieces(g, out, part)?
        } else {
            Vec::new()
        });
    }
    admit(&parts, &spec.nodes, out.len(), limit)?;
    for node in &spec.nodes {
        let placement = Placement::of(node.matrix);
        for (material, piece) in &parts[node.part] {
            let group = groups.entry(*material).or_default();
            group.instances.push(placement.carry(piece));
        }
    }
    let mut primitives = Vec::with_capacity(groups.len() + kept.len());
    for (material, group) in &groups {
        primitives.push(primitive_of(g, out, *material, group)?);
    }
    primitives.extend(kept);
    g["meshes"][mesh]["primitives"] = Value::Array(primitives);
    if let Some(extras) = g["meshes"][mesh]["extras"].as_object_mut() {
        extras.remove(ASSEMBLY_EXTRA);
    }
    Ok(())
}
