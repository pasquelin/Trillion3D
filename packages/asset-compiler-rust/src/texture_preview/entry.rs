//! What one sidecar entry carries: the texture it covers, where its bytes came
//! from, its tail in every encoding the gate kept.
use super::blocks::Layout;
use super::reduce::AtlasKind;

/// Origin of preview source bytes. `uri` itself not copied: read
/// in `source.gltf` at `images[image]`, which entry names.
#[derive(Clone, Copy, PartialEq, Eq)]
pub enum PreviewSource {
    Uri,
    BufferView(u32),
}
impl PreviewSource {
    pub fn kind(self) -> u32 {
        match self {
            Self::Uri => 0,
            Self::BufferView(_) => 1,
        }
    }
    pub fn buffer_view(self) -> u32 {
        match self {
            Self::Uri => u32::MAX,
            Self::BufferView(view) => view,
        }
    }
}

/// Section entry: texture covered, origin, level bytes.
/// `first_level` and level count re-deduced from `width` and `height`; carrying in
/// entry lets reader refuse entry contradicting own dimensions.
pub struct TexturePreview {
    pub texture: u32,
    pub image: u32,
    pub width: u32,
    pub height: u32,
    pub source: PreviewSource,
    pub sha256: String,
    /// Atlas entry serves: same texture can have one per atlas.
    pub kind: AtlasKind,
    pub first_level: u32,
    /// Levels written in cache as PNG files, 0 to `baked_levels - 1`: `first_level`
    /// when chain complete, 0 when nothing could be written.
    pub baked_levels: u32,
    pub pixels: Vec<u8>,
    /// What each family holds of the chain, `BlockFormat::ALL` order: a layout
    /// when the gate kept it, `None` when the chain stays lossless in that
    /// family — not cooked, or under the bar.
    pub layouts: [Option<Layout>; 2],
    /// The same tail in each family's blocks, `BlockFormat::ALL` order; empty
    /// where the layout is `None`.
    pub blocks: [Vec<u8>; 2],
}
