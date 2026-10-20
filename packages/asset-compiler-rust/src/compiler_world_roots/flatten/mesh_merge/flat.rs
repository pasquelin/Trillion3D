//! The merged children: closed, flattened, and the bytes a cut and its work hold.
use super::super::{step, Atlas, Built, Library, Made, Piece, Placed, StageMs, Stages};
use super::{layout, sections, Geometry, LodSelection, Material, Section};
use crate::compiler_world_roots::Instance;
use crate::surface_trace::surface::Surface;
use std::collections::BTreeMap;
use trillion3d_math::vec3::point;
use trillion3d_page_codec::FLAG_NORMAL;

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
/// given unique texture coordinates of a `texture_size` atlas (`super::super::unique`) and each section's
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
    let stages: Stages = [corners / 3; super::super::STAGE_COUNT];
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
            Some(atlas) => Ok((rank, super::super::sources::atlas_surface(atlas))),
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
    let flat = super::super::unique(&points, &triangles, &normals, texture_size)
        .map_err(|e| (e, stages))?;
    ms[step::UNWRAP] = super::super::millis(started);
    let started = std::time::Instant::now();
    // The sections traced in their own triangle order, the flat mesh's (`sources::traceable`).
    let traced = super::super::sources::traceable(&pieces, (library, &surfaces));
    drop(pieces);
    let atlas = super::super::bake::own(&flat, &traced, texture_size);
    ms[step::BAKE] = super::super::millis(started);
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
/// unwrap and its traced copy (`super::super::SOURCE_TRIANGLE_BYTES`), and the atlas baked and cooked
/// (`super::super::atlas_bytes`).
pub(in crate::compiler_world_roots) fn working_bytes(
    (bytes, corners): (usize, usize),
    flattened: Option<(usize, usize)>,
) -> usize {
    let held = (bytes.saturating_mul(3))
        .saturating_add((corners / 3).saturating_mul(super::super::SOURCE_TRIANGLE_BYTES));
    match flattened {
        None => held,
        Some((texture_size, families)) => {
            held.saturating_add(super::super::atlas_bytes(texture_size, families))
        }
    }
}
