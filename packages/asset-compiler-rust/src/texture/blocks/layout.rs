use super::BLOCK_BYTES;

/// How a chain's texels are laid out in a family's blocks. What a sidecar
/// entry says of each family is `Option<Layout>`: `None` is a lossless chain,
/// no blocks written.
#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Debug)]
pub enum Layout {
    Rgba,
    TwoChannel,
    /// BC6H, unsigned half-float RGB: a half-float chain a texture's `hdrCompressed` setting asks
    /// for (`setting.rs`). BC alone, written beside the gate (`bake/half.rs`): the setting is the
    /// asking.
    Hdr,
    /// BC4, one channel of eight-byte blocks: a chain a texture's `alpha` setting asks for.
    /// BC alone, written beside the gate (`bake/single.rs`).
    OneChannel,
    /// One 8-bit channel kept to the bit, in sixteen-byte "blocks" that hold the sixteen texels of a
    /// 4 × 4 square row by row, no codec: a chain a texture's `grayscale` setting asks for, read
    /// as a grey. BC alone, written beside the gate (`bake/single.rs`).
    Gray,
    /// The same from the alpha channel, read in all four channels: a `displacementmap` chain.
    Displacement,
    /// Four 32-bit floats a texel, kept as they are in blocks of sixteen texels row by row: a chain a
    /// texture's `hdrF32` setting asks for, in the half-float atlas (`bake/half.rs`).
    Float32,
    /// One 32-bit float a texel, in such blocks: a `singleFloat` chain.
    SingleFloat,
    /// One 16-bit float a texel, in such blocks: a `halfFloat` chain.
    HalfSingle,
}
impl Layout {
    pub fn name(self) -> &'static str {
        match self {
            Self::Rgba => "rgba",
            Self::TwoChannel => "two-channel",
            Self::Hdr => "hdr",
            Self::OneChannel => "one-channel",
            Self::Gray => "gray",
            Self::Displacement => "displacement",
            Self::Float32 => "float32",
            Self::SingleFloat => "single-float",
            Self::HalfSingle => "half-single",
        }
    }
    /// The word a sidecar entry carries: 0 lossless, then the layouts.
    pub fn word(layout: Option<Layout>) -> u32 {
        match layout {
            None => 0,
            Some(Self::Rgba) => 1,
            Some(Self::TwoChannel) => 2,
            Some(Self::Hdr) => 3,
            Some(Self::OneChannel) => 4,
            Some(Self::Gray) => 5,
            Some(Self::Displacement) => 6,
            Some(Self::Float32) => 7,
            Some(Self::SingleFloat) => 8,
            Some(Self::HalfSingle) => 9,
        }
    }
    /// The inverse: `Some(layout or lossless)`, `None` for a word no layout owns.
    pub fn from_word(word: u32) -> Option<Option<Layout>> {
        match word {
            0 => Some(None),
            1 => Some(Some(Self::Rgba)),
            2 => Some(Some(Self::TwoChannel)),
            3 => Some(Some(Self::Hdr)),
            4 => Some(Some(Self::OneChannel)),
            5 => Some(Some(Self::Gray)),
            6 => Some(Some(Self::Displacement)),
            7 => Some(Some(Self::Float32)),
            8 => Some(Some(Self::SingleFloat)),
            9 => Some(Some(Self::HalfSingle)),
            _ => None,
        }
    }
    /// Whether the quality gate decides the layout (`gate.rs`): a chain the content decides, in
    /// every family. The others are asked for by a texture's setting and written as asked.
    pub const fn gated(self) -> bool {
        matches!(self, Self::Rgba | Self::TwoChannel)
    }
    /// Bytes of one 4 × 4 block of the layout.
    pub const fn block_bytes(self) -> usize {
        match self {
            Self::OneChannel => 8,
            Self::Float32 => 16 * 16,
            Self::SingleFloat => 16 * 4,
            Self::HalfSingle => 16 * 2,
            _ => BLOCK_BYTES,
        }
    }
}
