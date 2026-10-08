//! The super-root pages, written as every primitive page is (`geometry_page::encode_deformed`):
//! `WGP3` pages, so both engines decode and draw them as any page. Their world-space positions
//! lie on one grid for the whole world — an eighth of its finest super-root error, never finer
//! than the page field allows on the world's extent (`grid_exponent`) —, so a vertex two pages
//! share decodes to one float; texture coordinates on the format's grid, normals octahedral,
//! colour on bytes, each in its cluster's layout (`place::LAYOUT`).
use super::merge::WorldDag;
use super::*;
use crate::geometry_page::{encode_deformed, Attribute, Encoded};
use crate::geometry_page_deform::Deformation;
use trillion3d_page_codec::bits::grid::{grid_exponent, UV_EXPONENT};

/// The grid of every world page: the finer of the world's extent in 2^16 steps and an eighth of its
/// finest super-root error, bounded by the page field on that extent.
pub(super) fn world_exponent(world: &WorldDag) -> i32 {
    let bounds = crate::proxy::bvh::extent(&world.positions);
    let extent = (0..3)
        .map(|axis| bounds[axis + 3] - bounds[axis])
        .fold(0.0, f64::max);
    let finest = (world.clusters.iter().zip(&world.origins))
        .filter(|(cluster, origin)| origin.is_none() && cluster.lod_error > 0.0)
        .map(|(cluster, _)| cluster.lod_error)
        .min_by(f64::total_cmp);
    let widest = if extent > 0.0 {
        extent.log2().floor() as i32
    } else {
        0
    };
    grid_exponent(extent, finest, widest)
}

/// The world's attributes a page of `layout` carries, in the order a page writes them.
fn attributes_of(world: &WorldDag, layout: u32) -> Vec<&Attribute> {
    (world.carried.iter())
        .filter(|a| layout & a.flag != 0)
        .collect()
}

/// Every world cluster's page: a super-root's, written; `None` for a placed object, whose pages
/// are its primitive's own.
pub(super) fn encode_pages(world: &WorldDag) -> Result<Vec<Option<Encoded>>> {
    let exponents = (world_exponent(world), UV_EXPONENT);
    let still = Deformation::default();
    (0..world.clusters.len())
        .into_par_iter()
        .map(|slot| {
            if world.origins[slot].is_some() {
                return Ok(None);
            }
            let attributes = attributes_of(world, world.layouts[slot]);
            let indices = &world.clusters[slot].indices;
            encode_deformed(
                indices,
                &world.positions,
                &attributes,
                (&still, &[]),
                exponents,
            )
            .map(Some)
        })
        .collect()
}
