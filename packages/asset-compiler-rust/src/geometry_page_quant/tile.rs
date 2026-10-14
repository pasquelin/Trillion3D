//! Tiles of a kilometre primitive: a primitive wider than a tile of the world is quantized
//! as if each tile spanned 2^16 steps, so its grid follows the tile rather than its own size.
//!
//! A tile's extent and width, for a primitive the largest world `scale` places, is
//! `trillion3d_page_codec::bits::grid::tile_log2`, shared with the run-time cut; a stage imports it
//! from there.

#[cfg(test)]
#[path = "tile_tests.rs"]
mod tests;

#[cfg(test)]
#[path = "tile_quantum_tests.rs"]
mod quantum_tests;
