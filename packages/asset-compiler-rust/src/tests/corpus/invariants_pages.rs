//! What the pages guarantee on every case: each cluster of the DAG the builder built in memory
//! encodes and decodes back to its source.
use super::invariants::Built;
use super::*;

/// Every cluster's page decodes back to its source positions and attributes, within what the grid
/// of the mesh's clusters holds.
pub(super) fn check_pages(built: &Built, label: &str) {
    let (positions, attributes) = (&built.positions, &built.attributes);
    let carried: Vec<&encode::Attribute> = attributes.iter().collect();
    let extents = crate::geometry_page::quant::page_extents(positions, &built.dag);
    let grid = crate::geometry_page::quant::page_grid(Default::default(), &extents)
        .unwrap_or_else(|e| panic!("{label}: grid: {e:?}"));
    for cluster in &built.dag {
        let encoded = encode::encode(&cluster.indices, positions, &carried, grid)
            .unwrap_or_else(|e| panic!("{label}: encode level {}: {e}", cluster.level));
        let page = trillion3d_page_codec::decode(&encoded.bytes, 64 << 20)
            .unwrap_or_else(|e| panic!("{label}: decode level {}: {e:?}", cluster.level));
        crate::tests::geometry_page::codec::verify(
            &page,
            &cluster.indices,
            positions,
            attributes,
            crate::tests::geometry_page::codec::position_bound(grid),
        );
    }
}
