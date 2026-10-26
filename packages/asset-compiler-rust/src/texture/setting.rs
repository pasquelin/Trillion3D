//! The compression setting of a texture: how it asks to be stored, read from the glTF texture's
//! `extras.compression`, one name of this list, and absent for `default`:
//!
//! | name | what the texture is | how it is cooked |
//! |---|---|---|
//! | `default`, `masks` | colour and data maps | BC7, or BC5 for a normal map, where the quality gate keeps them |
//! | `normalmap` | a normal map, whatever reads it | BC5, X and Y, Z rebuilt by the shader |
//! | `bc7` | any map | BC7, whatever reads it |
//! | `alpha` | one channel, read in R | BC4, eight bytes a block |
//! | `grayscale` | one channel, read in R and shown grey | G8: the red channel kept to the bit, eight bits a texel |
//! | `displacementmap` | one channel, read in A and shown in all four | G8: the alpha channel kept to the bit |
//! | `vectorDisplacementmap` | a map that must not lose a bit | no block: the source image, lossless |
//! | `hdr` | floating point | half-float RGBA |
//! | `hdrF32` | floating point | 32-bit float RGBA, kept as it is |
//! | `halfFloat` | one floating-point channel (the red) | half-float, 16 bits a texel |
//! | `singleFloat` | one floating-point channel (the red) | 32-bit float, 32 bits a texel |
//! | `hdrCompressed` | floating point | BC6H, unsigned half-float RGB |
//!
//! A file stored in floating point (OpenEXR, Radiance HDR) is `hdr` unless it says `hdrCompressed`;
//! a byte file asking for a floating-point setting is read as linear values (its colour curve
//! decoded) and cooked as one. A colour setting (`hdr`, `hdrF32`, `hdrCompressed`) on a map the data
//! atlas reads (the half-float atlas holds colours alone) falls back to `default`, and the report
//! says so; a one-channel setting (`halfFloat`, `singleFloat`) is read by the data atlas, and on a
//! colour map it is cooked as `hdr`.
use super::blocks::Layout;
use super::*;

/// A texture's compression setting, as named in the list above.
#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Debug)]
pub(crate) enum Compression {
    Default,
    Masks,
    Normalmap,
    Bc7,
    Alpha,
    Grayscale,
    Displacementmap,
    VectorDisplacementmap,
    Hdr,
    HdrF32,
    HalfFloat,
    SingleFloat,
    HdrCompressed,
}

/// The cook a setting asks for: what separates two textures of one image into two chains.
#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Debug)]
pub(crate) enum Route {
    /// Through the quality gate, in `Some(layout)` where the setting names it, in the one its readers
    /// decide otherwise.
    Gated(Option<Layout>),
    /// BC4 blocks of the first channel, no gate.
    OneChannel,
    /// The red channel in eight-bit texels, no gate.
    Gray,
    /// The alpha channel in eight-bit texels, no gate.
    Displacement,
    /// No block: the source image, lossless.
    Lossless,
    /// Half-float RGBA texels.
    Float,
    /// 32-bit float RGBA texels, exact.
    Float32,
    /// 32-bit float texels of the red channel, exact.
    SingleFloat,
    /// Half-float texels of the red channel.
    HalfSingle,
    /// BC6H blocks of half-float RGB.
    FloatBlocks,
}

/// Report note of a setting name the list does not hold: the texture is cooked as `default`.
pub(crate) const UNKNOWN: &str = "texture-compression-unknown";
/// Report note of a setting that asks a data map for floating point: the texture is cooked as
/// `default`.
pub(crate) const FLOAT_DATA: &str = "texture-compression-float-data-unsupported";

impl Compression {
    const NAMES: [(&'static str, Compression); 13] = [
        ("default", Self::Default),
        ("masks", Self::Masks),
        ("normalmap", Self::Normalmap),
        ("bc7", Self::Bc7),
        ("alpha", Self::Alpha),
        ("grayscale", Self::Grayscale),
        ("displacementmap", Self::Displacementmap),
        ("vectorDisplacementmap", Self::VectorDisplacementmap),
        ("hdr", Self::Hdr),
        ("hdrF32", Self::HdrF32),
        ("halfFloat", Self::HalfFloat),
        ("singleFloat", Self::SingleFloat),
        ("hdrCompressed", Self::HdrCompressed),
    ];

    /// The setting a name names.
    pub fn named(name: &str) -> Option<Self> {
        Self::NAMES
            .iter()
            .find(|(n, _)| *n == name)
            .map(|&(_, c)| c)
    }

    /// The setting of glTF texture `texture`: `extras.compression`, `default` where absent;
    /// `Err` for a name this list does not hold.
    pub fn of(g: &Value, texture: usize) -> std::result::Result<Self, &'static str> {
        match g.pointer(&format!("/textures/{texture}/extras/compression")) {
            None | Some(Value::Null) => Ok(Self::Default),
            Some(Value::String(name)) => Self::named(name).ok_or(UNKNOWN),
            Some(_) => Err(UNKNOWN),
        }
    }

    /// The cook the setting asks for.
    pub fn route(self) -> Route {
        match self {
            Self::Default | Self::Masks => Route::Gated(None),
            Self::Normalmap => Route::Gated(Some(Layout::TwoChannel)),
            Self::Bc7 => Route::Gated(Some(Layout::Rgba)),
            Self::Alpha => Route::OneChannel,
            Self::Grayscale => Route::Gray,
            Self::Displacementmap => Route::Displacement,
            Self::VectorDisplacementmap => Route::Lossless,
            Self::Hdr => Route::Float,
            Self::HdrF32 => Route::Float32,
            Self::HalfFloat => Route::HalfSingle,
            Self::SingleFloat => Route::SingleFloat,
            Self::HdrCompressed => Route::FloatBlocks,
        }
    }
}

impl Route {
    /// Whether the cook is the half-float atlas's (`bake/half.rs`).
    pub fn is_float(self) -> bool {
        matches!(
            self,
            Self::Float | Self::FloatBlocks | Self::Float32 | Self::SingleFloat | Self::HalfSingle
        )
    }
}
