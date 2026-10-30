//! The `merge` HLOD builder: its cell's original objects merged into one mesh, nothing more — no
//! simplification —, at every level: never an actor of a level below.
//!
//! - each source at the LOD the layer's `lodScreenSize` selects among its own, a quarter by default
//!   (`LodSelection::Calculate`, `calculated_lod`: a glTF mesh has one, its level 0, taken whole),
//!   or at its fallback mesh (`LodSelection::Lowest`, `fallback`: `RELATIVE_ERROR`, `AT_LEAST`,
//!   `OVERSHOOT`, `LIMIT`);
//! - equivalent materials — one definition under two names — collapsed into the first of them
//!   the sources name (`collapseEquivalentMaterials`, on by default, `classes`);
//! - its materials kept (`mergeMaterials` false by default): one section per unique material, in
//!   the order the sources first name them, each source's triangles appended in turn — the
//!   sections' order is stable for a given input, so a rebuild cooks the same bytes;
//! - every texture set a source carries output, zeros where another lacks it, so every section
//!   shares one vertex layout; no vertex colour (a source's tint does not ride the merged mesh)
//!   unless the layer asks it (`bakeVertexColors`): every section then carries the colours its
//!   sources carry, white where a source has none.
//!
//! Its materials merged (`mergeMaterials`), it is one actor wearing its own flattened material:
//! one atlas of every material it wears, each baked into its own cell (`merged_flat`).
//!
//! The mesh stays in world space: our world pages carry no actor transform, every one drawn under
//! the identity, so no pivot is written.
//! The flattened merge and the bytes a cut and its work hold live in `flat`, the LODs a source
//! offers in `lods` and its fallback in `fallback`, the atlas's cells in `grid`, an entry's bake
//! in `tile`.
use super::super::chain::place::{empty, gather, Normals};
use crate::hlod::chain::{Instance, SourceCover};
use serde_json::Value;
use std::collections::{BTreeMap, BTreeSet};
use trillion3d_math::matrix::linear::determinant;
use trillion3d_math::vector::vec3::point;
use trillion3d_page_codec::encode::Attribute;
use trillion3d_page_codec::{FLAG_COLOR, FLAG_NORMAL};
mod fallback;
mod flat;
mod grid;
mod lods;
mod resize;
mod smear;
mod tile;
pub(in crate::hlod) use flat::{
    area, atlas_sides, coordinates, cut_counts, lightmapped, merged_flat, quad, seen_through,
    sphere, working_bytes, Flattened, Flattening,
};
use lods::mesh_bytes;
pub(crate) use lods::{Lods, MeshBounds, Taken};
pub(in crate::hlod) use smear::{shrunk, smeared, uniform, Image};
pub(in crate::hlod) use tile::{baked, cotangent, Baked, Behind, Read};

/// Which LOD of each source the merge takes (`HlodLodSelection`, a merged layer's
/// `lodSelection`).
pub(crate) use crate::HlodLodSelection as LodSelection;

/// The cut a merged layer takes of each source: its `lodSelection`, and its `lodScreenSize`, the
/// share of the view a source's bounding sphere spans when `Calculate`'s LOD is drawn.
pub(crate) type Cut = (LodSelection, f64);

/// A mesh in world space: its positions, attributes and triangles.
pub(crate) type Geometry = (Vec<f32>, Vec<Attribute>, Vec<u32>);

/// One section of the merged mesh: its material of the source scene — its glTF rank, none for
/// glTF's default — and its geometry.
pub(crate) type Section = (Option<u64>, Geometry);

/// Each material of the scene with the material whose class it is in (`classes`).
pub(crate) type Classes = BTreeMap<Option<u64>, Option<u64>>;

/// Each of `materials` of `g` with the first of them by rank holding the same definition — every
/// field but its name and its extras, and its sky property (`sky`, by rank): a sky material is
/// never equivalent to a plain one, so that a merged mesh keeps the property —: equivalent
/// materials, one material under two names, share that first one's class. glTF's default
/// material, and one `g` does not define, is its own.
pub(crate) fn classes(g: &Value, materials: &BTreeSet<Option<u64>>, sky: &[bool]) -> Classes {
    let definition = |id: Option<u64>| {
        let mut material = g.pointer(&format!("/materials/{}", id?))?.clone();
        let fields = material.as_object_mut()?;
        fields.remove("name");
        fields.remove("extras");
        fields.insert(
            "sky".into(),
            Value::Bool(sky.get(id? as usize).copied().unwrap_or(false)),
        );
        Some(material)
    };
    let mut firsts: Vec<(Option<u64>, Value)> = Vec::new();
    (materials.iter())
        .map(|&id| {
            let Some(defined) = definition(id) else {
                return (id, id);
            };
            match firsts.iter().find(|(_, first)| *first == defined) {
                Some(&(first, _)) => (id, first),
                None => {
                    firsts.push((id, defined));
                    (id, id)
                }
            }
        })
        .collect()
}

/// One source of the merged mesh as the merge takes it (`merged`): its material — the first
/// equivalent one the sources name when the layer collapses them —, the mesh it places — its
/// cover, by address — and whether its matrix mirrors it, and its geometry placed in world space
/// at the LOD the layer takes, carrying the attributes its pages carry.
pub(crate) struct Part {
    pub material: Option<u64>,
    pub mesh: usize,
    pub mirrored: bool,
    pub geometry: Geometry,
}

impl Part {
    /// The flags of the attributes it carries.
    fn layout(&self) -> u32 {
        self.geometry.1.iter().fold(0, |flags, a| flags | a.flag)
    }

    /// It as a bake reads a piece of its sources, wearing its material.
    pub(super) fn piece(&self) -> super::Piece<'_> {
        let (positions, carried, indices) = &self.geometry;
        super::Piece {
            material: self.material,
            positions,
            carried,
            indices,
        }
    }

    /// The `width` floats a vertex of its attribute `flag` holds, end to end; `None` when it
    /// carries none.
    pub(super) fn carried(&self, flag: u32) -> Option<&[f32]> {
        let (positions, carried, _) = &self.geometry;
        let attribute = carried.iter().find(|a| a.flag == flag)?;
        Some(&attribute.values[..positions.len() / 3 * attribute.width])
    }

    /// Its vertex normals, three floats each: those it carries, else its triangles'
    /// (`mesh_normals`).
    pub(super) fn normals(&self) -> std::borrow::Cow<'_, [f32]> {
        if let Some(normals) = self.carried(FLAG_NORMAL) {
            return std::borrow::Cow::Borrowed(normals);
        }
        let (positions, _, indices) = &self.geometry;
        std::borrow::Cow::Owned(mesh_normals(positions, indices))
    }
}

/// The vertex normals of the mesh `positions` and `indices`, three floats each: its triangles'
/// (`vertex_normals`) — a source that carries none.
pub(in crate::hlod) fn mesh_normals(positions: &[f32], indices: &[u32]) -> Vec<f32> {
    let vertex = |v: usize| point(positions, v as u32);
    let triangles = (indices.as_chunks::<3>().0.iter()).map(|t| t.map(|v| v as usize));
    let normals = vertex_normals(positions.len() / 3, vertex, triangles);
    normals
        .into_iter()
        .flat_map(|n| n.map(|x| x as f32))
        .collect()
}

/// The merged mesh of `parts`, its materials kept: one section per unique material in the order
/// the parts first name them, each part's triangles appended to its material's in turn, every
/// section carrying every attribute a part carries but the vertex colour — a source's tint does
/// not ride a mesh that keeps its materials, unless the layer keeps the colours
/// (`keep_colours`, `bakeVertexColors`) —: where a part lacks one, its vertex normals
/// (`Part::normals`), zeros for a texture set, white for a colour.
pub(in crate::hlod) fn sections(parts: Vec<Part>, keep_colours: bool) -> Vec<Section> {
    let layout = parts
        .iter()
        .fold(FLAG_NORMAL, |flags, p| flags | p.layout());
    let layout = if keep_colours {
        layout
    } else {
        layout & !FLAG_COLOR
    };
    let mut sections: Vec<Section> = Vec::new();
    for part in parts.iter().filter(|p| !p.geometry.2.is_empty()) {
        let at = match sections.iter().position(|(m, _)| *m == part.material) {
            Some(at) => at,
            None => {
                sections.push((part.material, (Vec::new(), empty(layout), Vec::new())));
                sections.len() - 1
            }
        };
        let (positions, _, indices) = &part.geometry;
        let (into_positions, into_carried, into_indices) = &mut sections[at].1;
        let base = (into_positions.len() / 3) as u32;
        let vertices = positions.len() / 3;
        into_positions.extend_from_slice(positions);
        for into in into_carried.iter_mut() {
            match into.flag {
                FLAG_NORMAL => into.values.extend_from_slice(&part.normals()),
                flag => match part.carried(flag) {
                    Some(values) => into.values.extend_from_slice(values),
                    None => {
                        let fill = if flag == FLAG_COLOR { 1.0 } else { 0.0 };
                        (into.values).resize(into.values.len() + vertices * into.width, fill)
                    }
                },
            }
        }
        into_indices.extend(indices.iter().map(|v| v + base));
    }
    sections
}

/// The normals of `count` vertices at `point` under `triangles` — a piece that carries none, the
/// welded parts of an approximated shell's sources: each vertex's, its triangles' area-weighted
/// normals summed in triangle order — a large triangle weighs more than a sliver, and with no hard
/// edge known every corner of a vertex shares it —; up where they cancel.
pub(super) fn vertex_normals(
    count: usize,
    point: impl Fn(usize) -> [f64; 3],
    triangles: impl IntoIterator<Item = [usize; 3]>,
) -> Vec<[f64; 3]> {
    use trillion3d_math::geometry::triangle::triangle_cross;
    use trillion3d_math::vector::vec3::normalized_or;
    use trillion3d_math::vector::vecn::add;
    let mut sums = vec![[0.0f64; 3]; count];
    for triangle in triangles {
        let [a, b, c] = triangle.map(&point);
        let area = triangle_cross(a, b, c);
        for v in triangle {
            sums[v] = add(sums[v], area);
        }
    }
    (sums.into_iter())
        .map(|n| normalized_or(n, [0.0, 1.0, 0.0]))
        .collect()
}

/// The parts of the merged mesh of the sources `members` of `instances` (`Part`), in order, each
/// at the LOD `cut` takes, placed in world space (`place::gather`); each material that of the
/// first part of its class (`classes`) when `classes` collapses equivalent ones.
pub(in crate::hlod) fn merged(
    instances: &[Instance],
    members: &[usize],
    (cut, classes): (Cut, Option<&Classes>),
) -> Vec<Part> {
    let mut firsts = Classes::new();
    // Each source's cover at the cut, made once whatever its copies.
    let mut covers: BTreeMap<usize, SourceCover> = BTreeMap::new();
    (members.iter())
        .map(|&i| {
            let source = &instances[i];
            debug_assert!(
                source.cover.lods.built(),
                "a merged layer takes mesh {}, whose LODs were not built (`Hlod::merged_meshes`)",
                source.mesh
            );
            let cover = covers
                .entry(source.source())
                .or_insert_with(|| source.cover.lods.cut(cut));
            let geometry = gather(&Instance { cover, ..*source }, Normals::Axes);
            let material = match classes {
                Some(classes) => {
                    let class = classes.get(&source.material).copied();
                    *firsts
                        .entry(class.unwrap_or(source.material))
                        .or_insert(source.material)
                }
                None => source.material,
            };
            Part {
                material,
                mesh: source.source(),
                mirrored: determinant(&source.matrix) < 0.0,
                geometry,
            }
        })
        .collect()
}
