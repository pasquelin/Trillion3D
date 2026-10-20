//! The `merge` HLOD builder: its sources merged into one mesh, nothing more — no simplification:
//!
//! - each source at the LOD whose error the layer's deviation holds (`super::deviation`,
//!   `LodSelection::Calculate`), or at its coarsest LOD (`LodSelection::Lowest`): a cut of its DAG
//!   (`Lods`);
//! - its materials kept (`mergeMaterials` false by default): one section per unique material, in
//!   the order the sources first name them, each source's triangles appended in turn — the
//!   sections' order is stable for a given input, so a rebuild cooks the same bytes;
//! - every texture set a source carries output, zeros where another lacks it, so every section
//!   shares one vertex layout; no vertex colour (a source's tint does not ride the merged mesh).
//!
//! Its materials merged (`mergeMaterials`), it is one actor wearing its own flattened material,
//! each source's material baked into its own charts of one atlas (`merged_flat`). Above HLOD 1 its
//! sources are the child HLOD actors' meshes, each wearing what it wears (`merged_children`,
//! `Material`).
//!
//! The mesh stays in world space: a pivot would only move its origin to a transform that places it
//! back there.
use super::super::cover::{compact_attribute, SourceCover};
use super::super::place::{empty, gather, layout_of};
use super::{step, Atlas, Built, Library, Made, Piece, Placed, StageMs, Stages};
use crate::compiler_world_roots::Instance;
use crate::dag::DagCluster;
use crate::proxy::cut::in_cut;
use crate::surface_trace::surface::Surface;
use std::collections::BTreeMap;
use trillion3d_math::vec3::point;
use trillion3d_page_codec::encode::Attribute;
use trillion3d_page_codec::{FLAG_COLOR, FLAG_NORMAL, OPTIONAL};

/// Which LOD of each source the merge takes (`HlodLodSelection`, a merged layer's
/// `lodSelection`).
pub(crate) use crate::HlodLodSelection as LodSelection;

/// A source's LODs the merge may take: the clusters of its DAG from the cut `Calculate` takes up
/// to its roots — the clusters whose parent's error passes it —, on the vertices they use, with
/// every attribute its pages carry on them. Empty for a source no merged layer takes
/// (`SourceCover::of`).
#[derive(Clone, Debug, Default)]
pub(crate) struct Lods {
    positions: Vec<f32>,
    carried: Vec<Attribute>,
    indices: Vec<u32>,
    /// Per cluster: its own error, its parent's and its corners' range in `indices`.
    clusters: Vec<(f64, f64, std::ops::Range<usize>)>,
    /// The error the cut `Calculate` takes stands at, in object space.
    calculated: f64,
}

impl Lods {
    /// The LODs of `dag` on `pos` and the attributes its pages carry (`carried`, one value set per
    /// vertex of `pos`), the cut `Calculate` takes at the object-space error `calculated` — the
    /// deviation of the merged layers that take it (`super::super::merge_lod_error`).
    pub(crate) fn of(
        dag: &[DagCluster],
        (pos, carried): (&[f32], &[&Attribute]),
        calculated: f64,
    ) -> Self {
        let mut joined = Vec::new();
        let mut clusters = Vec::new();
        for cluster in dag.iter().filter(|c| c.parent_error > calculated) {
            let start = joined.len();
            joined.extend_from_slice(&cluster.indices);
            clusters.push((cluster.lod_error, cluster.parent_error, start..joined.len()));
        }
        let (positions, carried, indices) = compacted(pos, carried.iter().copied(), &joined);
        Self {
            positions,
            carried,
            indices,
            clusters,
            calculated,
        }
    }

    /// The corners of the clusters `selection` takes, by the engine's cut rule (`in_cut`):
    /// `Calculate`'s cut, or the roots.
    fn selected(&self, selection: LodSelection) -> impl Iterator<Item = &[u32]> {
        (self.clusters.iter())
            .filter(move |(own, parent, _)| match selection {
                LodSelection::Calculate => in_cut(*own, *parent, self.calculated),
                LodSelection::Lowest => !parent.is_finite(),
            })
            .map(|(.., range)| &self.indices[range.clone()])
    }

    /// The LOD `selection` takes as a cover on the vertices it uses, with every attribute the
    /// source carries.
    fn cut(&self, selection: LodSelection) -> SourceCover {
        let joined: Vec<u32> = self.selected(selection).flatten().copied().collect();
        let (positions, carried, indices) = compacted(&self.positions, &self.carried, &joined);
        SourceCover {
            positions,
            carried,
            indices,
            lods: Self::default(),
        }
    }

    /// The bytes the LOD `selection` takes holds as a cover: at most a vertex per corner, each
    /// carrying every attribute a page may.
    fn cut_bytes(&self, selection: LodSelection) -> usize {
        let corners: usize = self.selected(selection).map(<[u32]>::len).sum();
        mesh_bytes(corners.min(self.positions.len() / 3), corners)
    }
}

/// The vertices of `positions` and `carried` the corners `joined` use, compacted in the order they
/// are first used (`qem::compact_region`, `compact_attribute`), and `joined` on them.
fn compacted<'a>(
    positions: &[f32],
    carried: impl IntoIterator<Item = &'a Attribute>,
    joined: &[u32],
) -> Geometry {
    let (positions, indices, remap) = crate::qem::compact_region(positions, joined);
    let carried = (carried.into_iter())
        .map(|attribute| compact_attribute(attribute, &remap))
        .collect();
    (positions, carried, indices)
}

/// The bytes a mesh of `vertices` and `corners` holds, each vertex carrying every attribute a page
/// may: a source's cut, or a child HLOD actor's mesh as a piece.
pub(in crate::compiler_world_roots) fn mesh_bytes(vertices: usize, corners: usize) -> usize {
    let floats = 3 + OPTIONAL.iter().map(|&(_, width)| width).sum::<usize>();
    4 * (vertices * floats + corners)
}

/// What a section of the merged mesh wears (`sources::Material`).
pub(crate) use super::sources::Material;

/// A mesh in world space: its positions, attributes and triangles.
pub(crate) type Geometry = (Vec<f32>, Vec<Attribute>, Vec<u32>);

/// One section of the merged mesh: its material and its geometry.
pub(crate) type Section = (Material, Geometry);

/// The merged mesh of `pieces`, in order: one section per unique material in the order the pieces
/// first name them, each piece's triangles appended to its material's in turn, every section
/// carrying the attributes of `layout` — where a piece lacks one, its vertex normals
/// (`vertex_normals`), a white vertex colour — the bake's tint, so the material shows as it is —,
/// zeros for a texture set —, a piece's others dropped.
fn sections(pieces: impl IntoIterator<Item = (Material, Geometry)>, layout: u32) -> Vec<Section> {
    let mut sections: Vec<Section> = Vec::new();
    for (material, (positions, carried, indices)) in pieces {
        if indices.is_empty() {
            continue;
        }
        let at = match sections.iter().position(|(m, _)| *m == material) {
            Some(at) => at,
            None => {
                sections.push((material, (Vec::new(), empty(layout), Vec::new())));
                sections.len() - 1
            }
        };
        let (into_positions, into_carried, into_indices) = &mut sections[at].1;
        let base = (into_positions.len() / 3) as u32;
        let vertices = positions.len() / 3;
        into_positions.extend_from_slice(&positions);
        for into in into_carried.iter_mut() {
            match carried.iter().find(|a| a.flag == into.flag) {
                Some(from) => into
                    .values
                    .extend_from_slice(&from.values[..vertices * into.width]),
                None if into.flag == FLAG_NORMAL => {
                    let vertex = |v: usize| point(&positions, v as u32);
                    let triangles = indices.as_chunks::<3>().0.iter();
                    let triangles = triangles.map(|t| t.map(|v| v as usize));
                    let normals = vertex_normals(vertices, vertex, triangles);
                    into.values
                        .extend(normals.into_iter().flat_map(|n| n.map(|x| x as f32)));
                }
                None => {
                    let fill = if into.flag == FLAG_COLOR { 1.0 } else { 0.0 };
                    (into.values).resize(into.values.len() + vertices * into.width, fill);
                }
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
    use trillion3d_math::triangle::triangle_cross;
    use trillion3d_math::vec3::normalized_or;
    use trillion3d_math::vecn::add;
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

/// The layout a merged mesh carries: normals always — a piece without them is given them
/// (`vertex_normals`) —, every attribute a piece of `layouts` carries, the vertex colour only when
/// `colour`: dropped from a mesh that keeps its sources' materials, but kept for the material bake,
/// which reads it as a tint.
fn layout(layouts: impl IntoIterator<Item = u32>, colour: bool) -> u32 {
    let all = (layouts.into_iter()).fold(FLAG_NORMAL, |flags, layout| flags | layout);
    if colour {
        all
    } else {
        all & !FLAG_COLOR
    }
}

/// The merged mesh of the sources `members` of `instances`, each at the LOD `selection` takes,
/// placed in world space (`place::gather`): its sections (`sections`), the vertex colour carried
/// only when `colour` (`layout`).
pub(in crate::compiler_world_roots) fn merged(
    instances: &[Instance],
    members: &[usize],
    (selection, colour): (LodSelection, bool),
) -> Vec<Section> {
    let layout = layout(
        members.iter().map(|&i| layout_of(instances[i].cover)),
        colour,
    );
    let pieces = members.iter().map(|&i| {
        let source = &instances[i];
        let cut = source.cover.lods.cut(selection);
        let placed = gather(&Instance {
            hlod: source.hlod,
            material: source.material,
            matrix: source.matrix,
            cover: &cut,
        });
        (Material::Source(source.material), placed)
    });
    sections(pieces, layout)
}

/// The merged mesh of the child HLOD actors `children` — each its mesh at LOD 0 and what it wears,
/// a child HLOD mesh having no LOD but its own —: its sections
/// (`sections`), the vertex colour carried only when `colour` (`layout`).
pub(in crate::compiler_world_roots) fn merged_children(
    children: Vec<(Material, Geometry)>,
    colour: bool,
) -> Vec<Section> {
    let layouts = (children.iter())
        .map(|(_, (_, carried, _))| carried.iter().fold(0, |flags, a| flags | a.flag));
    let layout = layout(layouts, colour);
    sections(children, layout)
}

/// The merged mesh's sections as one placed mesh, the input of a layer above that reads its
/// positions and triangles.
pub(in crate::compiler_world_roots) fn closed(sections: &[Section]) -> Placed {
    let (mut positions, mut indices) = (Vec::new(), Vec::new());
    for (_, (section_positions, _, section_indices)) in sections {
        let base = (positions.len() / 3) as u32;
        positions.extend_from_slice(section_positions);
        indices.extend(section_indices.iter().map(|v| v + base));
    }
    (positions, indices)
}

/// The merged mesh's one actor when its materials are merged (`mergeMaterials`): its `sections`
/// given unique texture coordinates of a `texture_size` atlas (`super::unique`) and each section's
/// material baked into its own charts, texel by texel at its own point (`bake::own`). A source's
/// own texture coordinates may repeat or overlap, so they cannot address one atlas: unique ones
/// are generated once over the whole merged mesh, its charts sharing the atlas by area. A section
/// wearing a child actor's flattened material reads it from that actor's atlas, `atlases` by actor
/// rank (`sources::atlas_surface`). `Err` when such an atlas was not kept or the packer found no
/// layout.
pub(in crate::compiler_world_roots) fn merged_flat(
    sections: &[Section],
    (library, atlases): (&Library, &BTreeMap<usize, Atlas>),
    texture_size: usize,
) -> Built {
    let corners: usize = sections.iter().map(|(_, (_, _, i))| i.len()).sum();
    let stages: Stages = [corners / 3; super::STAGE_COUNT];
    let pieces: Vec<Piece> = (sections.iter())
        .map(|(material, (positions, carried, indices))| Piece {
            material: *material,
            positions,
            carried,
            indices,
        })
        .collect();
    // Each child flattened material a section wears, read from its atlas.
    let surfaces: BTreeMap<usize, Surface> = (sections.iter())
        .filter_map(|(material, _)| match material {
            Material::Actor(rank) => Some(*rank),
            Material::Source(_) => None,
        })
        .map(|rank| match atlases.get(&rank) {
            Some(atlas) => Ok((rank, super::sources::atlas_surface(atlas))),
            None => Err(("a merged child actor's atlas was not kept", stages)),
        })
        .collect::<Result<_, _>>()?;
    let mut ms: StageMs = [0; step::COUNT];
    let started = std::time::Instant::now();
    let (positions, indices) = closed(sections);
    let points: Vec<[f64; 3]> = (positions.as_chunks::<3>().0.iter())
        .map(|p| p.map(f64::from))
        .collect();
    let triangles: Vec<[usize; 3]> = (indices.as_chunks::<3>().0.iter())
        .map(|t| t.map(|v| v as usize))
        .collect();
    let normals = corner_normals(sections);
    let flat =
        super::unique(&points, &triangles, &normals, texture_size).map_err(|e| (e, stages))?;
    ms[step::UNWRAP] = super::millis(started);
    let started = std::time::Instant::now();
    // The sections traced in their own triangle order, the flat mesh's (`sources::traceable`).
    let traced = super::sources::traceable(&pieces, (library, &surfaces));
    drop(pieces);
    let atlas = super::bake::own(&flat, &traced, texture_size);
    ms[step::BAKE] = super::millis(started);
    Ok(Made {
        flat,
        atlas,
        closed: (positions, indices),
        stages,
        stage_ms: ms,
    })
}

/// Each corner's normal of the sections' triangles, in order: the vertex normal a section carries,
/// else its triangle's own.
fn corner_normals(sections: &[Section]) -> Vec<[f32; 3]> {
    let mut normals = Vec::new();
    for (_, (positions, carried, indices)) in sections {
        let carried = carried.iter().find(|a| a.flag == FLAG_NORMAL);
        for triangle in indices.as_chunks::<3>().0 {
            let [a, b, c] = triangle.map(|v| point(positions, v));
            let face = trillion3d_math::triangle::face_normal(a, b, c);
            normals.extend(triangle.iter().map(|&v| match carried {
                Some(n) => [0, 1, 2].map(|k| n.values[v as usize * 3 + k]),
                None => face.map(|x| x as f32),
            }));
        }
    }
    normals
}

/// The bytes and corners the sources `members` of `instances` hold at the LOD `selection` takes.
pub(in crate::compiler_world_roots) fn cut_bytes(
    instances: &[Instance],
    members: &[usize],
    selection: LodSelection,
) -> (usize, usize) {
    (members.iter()).fold((0, 0), |(bytes, corners), &i| {
        let lods = &instances[i].cover.lods;
        let taken: usize = lods.selected(selection).map(<[u32]>::len).sum();
        (bytes + lods.cut_bytes(selection), corners + taken)
    })
}

/// The bytes a merged actor holds while it is made from pieces of `bytes` and `corners`: each
/// piece, its placed copy and its section's copy; each triangle's DAG build or, when its materials
/// are merged into a `texture_size` atlas cooked for `families` block families (`flattened`), its
/// unwrap and its traced copy (`super::SOURCE_TRIANGLE_BYTES`), and the atlas baked and cooked
/// (`super::atlas_bytes`).
pub(in crate::compiler_world_roots) fn working_bytes(
    (bytes, corners): (usize, usize),
    flattened: Option<(usize, usize)>,
) -> usize {
    let held = (bytes.saturating_mul(3))
        .saturating_add((corners / 3).saturating_mul(super::SOURCE_TRIANGLE_BYTES));
    match flattened {
        None => held,
        Some((texture_size, families)) => {
            held.saturating_add(super::atlas_bytes(texture_size, families))
        }
    }
}
