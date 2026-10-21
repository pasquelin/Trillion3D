//! The HLOD pages, written as every primitive page is (`encode::encode_deformed`): `WGP3` pages, so
//! both engines decode and draw them as any page. The positions of an actor's pages lie on one grid
//! for the whole actor, which its finest clusters set as a mesh build sets a mesh's
//! (`page_grid`), so a vertex two of its pages share decodes to one float; texture coordinates are
//! float codes, normals octahedral, an approximated shell's tangents beside them, colour bytes,
//! each in its cluster's layout (`trillion3d_page_codec::OPTIONAL`). A voxel
//! actor's cluster is its voxel page as it is (`voxel::voxel_dag`), a box a brick, drawn as a
//! primitive's voxel pages are. Either page gives its descriptor's facts as the codec states them
//! (`PageFacts`), which `dag_records::page_facts` writes.
use super::merge::WorldDag;
use super::*;
use crate::geometry_page::quant::page_grid;
use std::collections::BTreeMap;
use trillion3d_page_codec::bits::grid::{PageGrid, Precision};
use trillion3d_page_codec::encode::deformation::Deformation;
use trillion3d_page_codec::encode::{encode_deformed, Attribute};
use trillion3d_page_codec::facts::PageFacts;
use trillion3d_page_codec::FLAG_TANGENT;

/// The grid of each actor's pages, by its rank: its mesh's build, at every default, from the boxes
/// of the clusters its build made (`WorldDag::extents`), a trim's cut-away ones included; a voxel
/// actor's pages have none.
fn actor_grids(world: &WorldDag) -> Result<BTreeMap<usize, PageGrid>> {
    (world.extents.iter().enumerate())
        .filter(|(_, extents)| !extents.is_empty())
        .map(|(actor, extents)| Ok((actor, page_grid(Precision::default(), extents)?)))
        .collect()
}

/// The positions the pages decode to: each actor's vertices on its grid (`PageGrid::decoded`, as a
/// primitive's boxes are measured), a voxel actor's as they are. What every box of the world
/// bounds, so it holds every vertex a page draws.
fn decoded_positions(world: &WorldDag, grids: &BTreeMap<usize, PageGrid>) -> Vec<f32> {
    let mut decoded = world.positions.clone();
    let total = world.positions.len() / 3;
    for (&actor, grid) in grids {
        let from = world.vertex_bases[actor];
        let to = world.vertex_bases.get(actor + 1).copied().unwrap_or(total);
        let own = from * 3..to * 3;
        decoded[own.clone()].copy_from_slice(&grid.decoded(&world.positions[own]));
    }
    decoded
}

/// Every world cluster's page: a voxel cluster's voxel page, a box a brick, any other's
/// triangles encoded; and the positions those pages decode to (`decoded_positions`).
pub(super) fn encode_pages(world: &WorldDag) -> Result<(Vec<PageFacts>, Vec<f32>)> {
    let grids = actor_grids(world)?;
    let decoded = decoded_positions(world, &grids);
    let still = Deformation::default();
    let pages = (0..world.clusters.len())
        .into_par_iter()
        .map(|slot| {
            if let Some(voxels) = &world.voxels[slot] {
                return Ok(voxels.facts());
            }
            let indices = &world.clusters[slot].indices;
            // The world's tangents only where the cluster's actor stores them — an approximated
            // shell's —: another holds the zeros `place::conform` gave it, and its page keeps the
            // frame the engine rebuilds from a triangle.
            let stored = |a: &&Attribute| {
                a.flag != FLAG_TANGENT
                    || (indices.iter())
                        .any(|&v| a.values[v as usize * 4..v as usize * 4 + 4] != [0.0; 4])
            };
            let attributes: Vec<&Attribute> = world.carried.iter().filter(stored).collect();
            let page = encode_deformed(
                indices,
                &world.positions,
                &attributes,
                (&still, &[]),
                grids[&world.actors[slot]],
            )
            .map_err(crate::CompilerError::from)?;
            Ok(page.facts(indices.len() / 3))
        })
        .collect::<Result<Vec<_>>>()?;
    Ok((pages, decoded))
}
