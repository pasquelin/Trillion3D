//! Tiles of a kilometre primitive: a primitive wider than a tile of the world is quantized
//! as if each tile spanned 2^16 steps, so its grid follows the tile rather than its own size.

/// A tile's extent and width for a primitive the largest world `scale` places, the scale the
/// proxy's cut maps its threshold by: shared with the run-time cut (`trillion3d_page_codec::bits::grid`).
pub use trillion3d_page_codec::bits::grid::tile_log2;
#[cfg(test)]
pub use trillion3d_page_codec::bits::grid::TILE_EXTENT_LOG2;

#[cfg(test)]
#[path = "tile_tests.rs"]
mod tests;

#[cfg(test)]
#[path = "tile_quantum_tests.rs"]
mod quantum_tests;
