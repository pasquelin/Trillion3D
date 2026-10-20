//! Reconstruction of a 4 × 4 block surface to RGBA8, shared by the drivers that receive blocks
//! already compressed for the GPU: `dds` and `ktx2` name their codecs each in their own way —
//! `dwFourCC`, `dxgiFormat`, `vkFormat` — but once the decoder is chosen, walking its pixels is
//! exactly the same work, and it is written only once.
//!
//! `texture2ddecoder` expands each block by the integer interpolation the codec specification
//! defines — no extra rounding or filter is added here — and returns one pixel per thirty-two-bit
//! word, bytes B, G, R, A in memory. The only thing this module then does is put those bytes back
//! into the contract order, R, G, B, A.
use super::{pixel_surface_bytes, DecodedImage, RGBA8_PIXEL_BYTES};

/// Signature of a block decoder: the level's bytes, its dimensions, the returned pixels.
pub(super) type BlockDecode = fn(&[u8], usize, usize, &mut [u32]) -> Result<(), &'static str>;

/// How a level's bytes become pixels: a codec's only description, whichever driver names it
/// (`dds::codec`, `ktx2::format`). A level's weight and its reconstruction both derive from it.
#[derive(Clone, Copy)]
pub(super) enum Layout {
    /// 4 × 4 pixel blocks: a block's bytes and the decoder that expands them.
    Blocks { bytes: usize, decode: BlockDecode },
    /// An uncompressed surface, four bytes per pixel in the named order.
    Pixels(Order),
}

/// Order of the four bytes of an uncompressed pixel.
#[derive(Clone, Copy)]
pub(super) enum Order {
    /// R, G, B, A: already the contract order.
    Rgba,
    /// B, G, R, A.
    Bgra,
    /// B, G, R then a byte ignored by the specification: the surface is opaque.
    Bgrx,
}

impl Layout {
    /// 4 × 4 blocks of `bytes` each, expanded by `decode`.
    pub(super) const fn blocks(bytes: usize, decode: BlockDecode) -> Self {
        Layout::Blocks { bytes, decode }
    }

    /// Bytes occupied by a level of this size.
    pub(super) fn level_bytes(self, width: u32, height: u32) -> u64 {
        match self {
            Layout::Blocks { bytes, .. } => surface_bytes(width, height, bytes as u64),
            Layout::Pixels(_) => pixel_surface_bytes(width, height, RGBA8_PIXEL_BYTES),
        }
    }

    /// Level 0, `width` × `height`, in contract order; `truncated` is the driver's reason when
    /// the bytes do not fill it.
    pub(super) fn rgba8(
        self,
        level: &[u8],
        width: usize,
        height: usize,
        truncated: &'static str,
    ) -> std::result::Result<Vec<u8>, &'static str> {
        match self {
            Layout::Blocks { bytes, decode } => {
                to_rgba8(decode, bytes, level, width, height, truncated)
            }
            Layout::Pixels(order) => from_pixels(order, level, width * height, truncated),
        }
    }

    /// Level 0, `width` × `height`, as the image a driver returns (`rgba8`): the one glue of
    /// the drivers that receive GPU blocks, once their level's bytes are plain. The caller has
    /// bounded the image against its ceiling before reading them.
    pub(super) fn decode(
        self,
        level: &[u8],
        width: u32,
        height: u32,
        truncated: &'static str,
    ) -> std::result::Result<DecodedImage, &'static str> {
        let rgba = self.rgba8(level, width as usize, height as usize, truncated)?;
        image(width, height, rgba, truncated)
    }
}

/// An uncompressed surface, four bytes per pixel. In `Rgba` the bytes are already the contract's;
/// otherwise red and blue swap in place, and `Bgrx`, with no alpha channel, is opaque.
fn from_pixels(
    order: Order,
    level: &[u8],
    pixels: usize,
    truncated: &'static str,
) -> std::result::Result<Vec<u8>, &'static str> {
    let mut rgba = level
        .get(..pixels.saturating_mul(4))
        .ok_or(truncated)?
        .to_vec();
    let opaque = match order {
        Order::Rgba => return Ok(rgba),
        Order::Bgra => false,
        Order::Bgrx => true,
    };
    for pixel in rgba.as_chunks_mut::<4>().0 {
        pixel.swap(0, 2);
        if opaque {
            pixel[3] = 255;
        }
    }
    Ok(rgba)
}

/// Bytes of a `width` × `height` surface of 4 × 4 blocks of `block_bytes` each. Blocks always cover
/// multiples of four pixels: a 1 × 1 level still weighs a whole block. The count saturates rather
/// than overflowing: absurd dimensions give an absurd need, hence a refusal.
pub(crate) fn surface_bytes(width: u32, height: u32, block_bytes: u64) -> u64 {
    let (across, down) = blocks_of(width, height);
    pixel_surface_bytes(across, down, block_bytes)
}

/// Texels along a block's side.
pub(crate) const BLOCK_SIDE: u32 = 4;

/// Blocks across and down a `width` × `height` level: a partial block at an edge is a whole one.
pub(crate) fn blocks_of(width: u32, height: u32) -> (u32, u32) {
    (width.div_ceil(BLOCK_SIDE), height.div_ceil(BLOCK_SIDE))
}

/// Expands level 0 of a 4 × 4 block surface. The decoder works one block row at a time into a
/// four-line pixel buffer, copied immediately into the image: no second buffer the size of the
/// image. Each block decodes on its own, so cutting by row yields exactly the same pixels.
/// `truncated` is the reason the calling driver gives a level shorter than the announced block
/// count — a named refusal, never a panic.
pub(crate) fn to_rgba8(
    decode: BlockDecode,
    block_bytes: usize,
    level: &[u8],
    width: usize,
    height: usize,
    truncated: &'static str,
) -> std::result::Result<Vec<u8>, &'static str> {
    let row_bytes = surface_bytes(width as u32, 1, block_bytes as u64) as usize;
    let mut strip = vec![0u32; width * height.min(4)];
    let mut rgba = Vec::with_capacity(width * height * 4);
    for (row, top) in (0..height).step_by(4).enumerate() {
        let lines = (height - top).min(4);
        let blocks = level.get(row * row_bytes..).ok_or(truncated)?;
        decode(blocks, width, lines, &mut strip).map_err(|_| truncated)?;
        rgba.extend(strip[..width * lines].iter().flat_map(|pixel| {
            let [b, g, r, a] = pixel.to_le_bytes();
            [r, g, b, a]
        }));
    }
    Ok(rgba)
}

/// The RGBA8 image of these bytes, or the calling driver's named reason when they do not fill the
/// announced surface. The image contract forbids an empty image: `from_raw` is the only gate.
pub(super) fn image(
    width: u32,
    height: u32,
    rgba: Vec<u8>,
    truncated: &'static str,
) -> std::result::Result<DecodedImage, &'static str> {
    ::image::RgbaImage::from_raw(width, height, rgba)
        .map(DecodedImage::Rgba8)
        .ok_or(truncated)
}
