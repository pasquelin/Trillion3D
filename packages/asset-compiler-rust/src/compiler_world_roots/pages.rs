//! The HLOD pages, written as every primitive page is (`encode::encode_deformed`): `WGP3` pages, so
//! both engines decode and draw them as any page. Their world-space positions lie on one grid for
//! the whole world — an eighth of its finest simplified error, never finer than the page field
//! allows on the world's extent (`grid_exponent`) —, so a vertex two pages share decodes to one
//! float; texture coordinates on the format's grid, normals octahedral,
//! colour on bytes, each in its cluster's layout (`trillion3d_page_codec::OPTIONAL`). A voxel
//! actor's cluster is its voxel page as it is (`voxel::voxel_dag`), a box a brick, drawn as a
//! primitive's voxel pages are. Either page gives its descriptor's facts as the codec states them
//! (`PageFacts`), which `dag_records::page_facts` writes.
use super::merge::WorldDag;
use super::*;
use trillion3d_page_codec::bits::grid::{grid_exponent, UV_EXPONENT};
use trillion3d_page_codec::encode::deformation::Deformation;
use trillion3d_page_codec::encode::{encode_deformed, Attribute};
use trillion3d_page_codec::facts::PageFacts;

/// The grid of every world page: the finer of the world's extent in 2^16 steps and an eighth of its
/// finest simplified error, bounded by the page field on that extent.
pub(super) fn world_exponent(world: &WorldDag) -> i32 {
    let bounds = trillion3d_page_codec::proxy::bvh::extent(&world.positions);
    let extent = (0..3)
        .map(|axis| bounds[axis + 3] - bounds[axis])
        .fold(0.0, f64::max);
    let finest = (world.clusters.iter())
        .map(|cluster| cluster.lod_error)
        .filter(|&error| error > 0.0)
        .min_by(f64::total_cmp);
    // No tile caps the world: `grid_exponent` reads the extent's exponent itself, the same on
    // every host.
    grid_exponent(extent, finest, i32::MAX)
}

/// Every world cluster's page: a voxel cluster's voxel page, a box a brick, any other's
/// triangles encoded.
pub(super) fn encode_pages(world: &WorldDag) -> Result<Vec<PageFacts>> {
    let exponents = (world_exponent(world), UV_EXPONENT);
    let still = Deformation::default();
    (0..world.clusters.len())
        .into_par_iter()
        .map(|slot| {
            if let Some(voxels) = &world.voxels[slot] {
                return Ok(voxels.facts());
            }
            let attributes: Vec<&Attribute> = world.carried.iter().collect();
            let indices = &world.clusters[slot].indices;
            let page = encode_deformed(
                indices,
                &world.positions,
                &attributes,
                (&still, &[]),
                exponents,
            )
            .map_err(crate::CompilerError::from)?;
            Ok(page.facts(indices.len() / 3))
        })
        .collect()
}
