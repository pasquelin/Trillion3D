//! Tiles of a kilometre primitive (#930): a primitive wider than a tile of the world is quantized
//! as if each tile spanned 2^16 steps, so its grid follows the tile rather than its own size.

/// A tile's extent, shared with the run-time cut (`trillion3d_page_codec::bits::grid`).
pub use trillion3d_page_codec::bits::grid::TILE_EXTENT_LOG2;

/// A tile's width, as a power of two in object units, for a primitive the largest world `scale`
/// places, the scale the proxy's cut maps its threshold by (`proxy::object_units`). Rounded
/// down: a tile never spans more than 32 m.
pub fn tile_log2(scale: Option<f64>) -> i32 {
    let tile = crate::proxy::object_units(2f64.powi(TILE_EXTENT_LOG2), scale);
    tile.log2().floor() as i32
}

#[cfg(test)]
#[path = "tile_tests.rs"]
mod tests;
