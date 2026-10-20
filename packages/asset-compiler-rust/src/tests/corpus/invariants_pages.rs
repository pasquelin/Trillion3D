//! What the pages guarantee on every case: each cluster of the DAG the builder built in memory
//! encodes and decodes back to its source.
use super::invariants::Built;
use super::*;

/// Every cluster's page decodes back to its source positions and attributes, within the error
/// the page declares.
pub(super) fn check_pages(built: &Built, label: &str) {
    let (positions, attributes) = (&built.positions, &built.attributes);
    let carried: Vec<&encode::Attribute> = attributes.iter().collect();
    let exponent = crate::geometry_page_quant::primitive_exponent(
        positions,
        built
            .dag
            .iter()
            .filter(|c| c.level > 0)
            .map(|c| c.lod_error),
        false,
        trillion3d_page_codec::bits::grid::TILE_EXTENT_LOG2,
    );
    for cluster in &built.dag {
        let encoded = encode::encode(
            &cluster.indices,
            positions,
            &carried,
            exponent,
            trillion3d_page_codec::bits::grid::UV_EXPONENT,
        )
        .unwrap_or_else(|e| panic!("{label}: encode level {}: {e}", cluster.level));
        let page = trillion3d_page_codec::decode(&encoded.bytes, 64 << 20)
            .unwrap_or_else(|e| panic!("{label}: decode level {}: {e:?}", cluster.level));
        crate::tests::geometry_page::codec::verify(
            &page,
            &cluster.indices,
            positions,
            attributes,
            page.quantization_error,
        );
    }
}
