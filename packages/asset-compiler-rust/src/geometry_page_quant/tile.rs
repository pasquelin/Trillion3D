//! Tiles of a kilometre primitive (#930): a primitive wider than a tile of the world is quantized
//! as if each tile spanned 2^16 steps, so its grid follows the tile rather than its own size.

/// A tile spans 2^5 = 32 m of the world. Wider primitives sit on 2^-11 m (0.49 mm) up to 4 km,
/// where the 24-bit page field bounds the grid, so a kilometre terrain seen from 2 m quantizes
/// under half a pixel rather than several.
pub const TILE_EXTENT_LOG2: i32 = 5;

/// A tile's width, as a power of two in object units, for a primitive the largest world `scale`
/// places — the scale the proxy's cut maps its threshold by (`object_units`). Rounded down: a
/// tile never spans more than 32 m.
pub fn tile_log2(scale: Option<f64>) -> i32 {
    let tile = crate::proxy::cut::object_units(2f64.powi(TILE_EXTENT_LOG2), scale);
    tile.log2().floor() as i32
}

#[cfg(test)]
#[path = "tile_tests.rs"]
mod tests;
