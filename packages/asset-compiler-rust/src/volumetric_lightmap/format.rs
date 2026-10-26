//! The file of a volumetric lightmap and the numbers its readers and writers share.
//!
//! Words are little-endian `u32`. The head: the magic, the version, the brick size, the bounds
//! (lower then upper corner, `f32` × 3 each, world units), the indirection volume's size in texels
//! and the brick atlas's, `u32` × 3 each; then, for each of the `VOLUMETRIC_LIGHTMAP_LAYERS`
//! layers in `LayerKind` order, its texel format and its byte length (before padding). The layers
//! follow, each starting on a four-byte boundary, texels in x, then y, then z order.
//!
//! Version 2 adds the finest bricks' streaming cells: after the head, two words (the side of a cell
//! in finest bricks, the cells' count); the layers then hold the bricks that are always loaded;
//! after the layers, one record a cell (its three coordinates, its bricks' count, where its bytes
//! start in the file and their length, then their SHA-256 as eight words); then the cells' bytes.
//! A cell holds, brick after brick in each part: the three coordinates of every brick in the
//! indirection volume, then the padded texels of its ambient, its six coefficient layers, its bent
//! normal (where the file has one) and its sun's shadowing. Version 1, whose bricks are all in the
//! layers, is read as before.

/// The file's version; a file of another version is refused, never reinterpreted.
pub const VOLUMETRIC_LIGHTMAP_VERSION: u32 = 2;
/// The oldest version a reader still reads: all its bricks are always loaded.
pub const VOLUMETRIC_LIGHTMAP_FIRST_VERSION: u32 = 1;
/// Words after the head of a file with cells: the side of a cell in finest bricks, the cells' count.
pub const VOLUMETRIC_LIGHTMAP_CELL_HEADER_WORDS: usize = 2;
/// Words of a cell's record: three coordinates, its bricks, its offset and length, a SHA-256.
pub const VOLUMETRIC_LIGHTMAP_CELL_RECORD_WORDS: usize = 14;
/// Texels of a padded brick, the unit a cell's layers are counted in.
pub const VOLUMETRIC_LIGHTMAP_CELL_TEXELS: usize = 125;
/// 'T','3','V','L' read as an unsigned 32-bit integer little-endian.
pub const VOLUMETRIC_LIGHTMAP_MAGIC: u32 = 0x4c56_3354;
/// Layers of a file: the indirection volume, the ambient, six of coefficients, the sky's bent
/// normal and the sun's shadowing.
pub const VOLUMETRIC_LIGHTMAP_LAYERS: usize = 10;
/// Words of the head before the layer table: magic, version, brick size, bounds, the two sizes.
pub const VOLUMETRIC_LIGHTMAP_FIXED_WORDS: usize = 15;
/// Words of a layer's entry in the table: its format and its byte length.
pub const VOLUMETRIC_LIGHTMAP_LAYER_WORDS: usize = 2;
/// Words of the whole head: the fixed words, then an entry a layer.
pub const VOLUMETRIC_LIGHTMAP_HEADER_WORDS: usize = 35;
const _: () = assert!(
    VOLUMETRIC_LIGHTMAP_HEADER_WORDS
        == VOLUMETRIC_LIGHTMAP_FIXED_WORDS
            + VOLUMETRIC_LIGHTMAP_LAYERS * VOLUMETRIC_LIGHTMAP_LAYER_WORDS
);
/// Bricks along one side of the atlas's layout at most: an indirection texel names a brick by three
/// bytes.
pub const VOLUMETRIC_LIGHTMAP_MAX_LAYOUT: u32 = 256;

/// The layers in file order; the coefficient layers pair as red, green, blue × (low, high).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum LayerKind {
    Indirection = 0,
    Ambient = 1,
    Coefficients0Red = 2,
    Coefficients1Red = 3,
    Coefficients0Green = 4,
    Coefficients1Green = 5,
    Coefficients0Blue = 6,
    Coefficients1Blue = 7,
    SkyBentNormal = 8,
    DirectionalShadowing = 9,
}

/// A layer's texel format, by the code the head holds.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum TexelFormat {
    /// Four unsigned bytes read as integers: the indirection's brick position and span.
    Rgba8Uint = 1,
    /// Three floats packed in 32 bits (11, 11 and 10 bits): the ambient.
    Rg11b10Float = 2,
    /// Four bytes normalised to [0, 1]: a coefficient layer, the bent normal.
    Rgba8Unorm = 3,
    /// One byte normalised to [0, 1]: the sun's shadowing.
    R8Unorm = 4,
}

impl TexelFormat {
    /// Bytes of one texel.
    pub const fn bytes(self) -> usize {
        match self {
            TexelFormat::R8Unorm => 1,
            _ => 4,
        }
    }
}

impl LayerKind {
    /// Every layer, in file order.
    pub const ALL: [LayerKind; VOLUMETRIC_LIGHTMAP_LAYERS] = [
        LayerKind::Indirection,
        LayerKind::Ambient,
        LayerKind::Coefficients0Red,
        LayerKind::Coefficients1Red,
        LayerKind::Coefficients0Green,
        LayerKind::Coefficients1Green,
        LayerKind::Coefficients0Blue,
        LayerKind::Coefficients1Blue,
        LayerKind::SkyBentNormal,
        LayerKind::DirectionalShadowing,
    ];

    /// The format of the layer's texels.
    pub const fn format(self) -> TexelFormat {
        match self {
            LayerKind::Indirection => TexelFormat::Rgba8Uint,
            LayerKind::Ambient => TexelFormat::Rg11b10Float,
            LayerKind::DirectionalShadowing => TexelFormat::R8Unorm,
            _ => TexelFormat::Rgba8Unorm,
        }
    }
}
