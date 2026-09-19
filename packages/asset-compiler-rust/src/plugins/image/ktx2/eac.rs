//! The two unsigned EAC formats of a KTX 2.0 — R11 and RG11 —, expanded here to eleven bits,
//! then brought back to the contract's eight by a round-to-nearest.
//!
//! Why not rely on `texture2ddecoder`, which expands all the other blocks? Because its EAC
//! path returns bytes directly, by `val >> 3`: the three low bits of the eleven disappear by
//! truncation, and one value in eight comes out one step too low. It also reads the index
//! field by `u64::from_le_bytes` where its own ETC2 alpha path, which follows the same write
//! order, reads `from_be_bytes`: the sixteen texels of a block come out shuffled. Both
//! defects fall with this decoder, written from the OpenGL ES 3.0 public specification
//! ("ETC2/EAC Compressed Texture Image Formats").
//!
//! The rest of the driver knows nothing of it: these two functions have the signature
//! `image::blocks` expects of a block decoder, and sit in the same codec table as the others.

/// The specification's sixteen sets of eight modifiers, named by the four low bits of the
/// block's second byte.
const MODIFIERS: [[i8; 8]; 16] = [
    [-3, -6, -9, -15, 2, 5, 8, 14],
    [-3, -7, -10, -13, 2, 6, 9, 12],
    [-2, -5, -8, -13, 1, 4, 7, 12],
    [-2, -4, -6, -13, 1, 3, 5, 12],
    [-3, -6, -8, -12, 2, 5, 7, 11],
    [-3, -7, -9, -11, 2, 6, 8, 10],
    [-4, -7, -8, -11, 3, 6, 7, 10],
    [-3, -5, -8, -11, 2, 4, 7, 10],
    [-2, -6, -8, -10, 1, 5, 7, 9],
    [-2, -5, -8, -10, 1, 4, 7, 9],
    [-2, -4, -8, -10, 1, 3, 7, 9],
    [-2, -5, -7, -10, 1, 4, 6, 9],
    [-3, -4, -7, -10, 2, 3, 6, 9],
    [-1, -2, -3, -10, 0, 1, 2, 9],
    [-4, -6, -8, -9, 3, 5, 7, 8],
    [-3, -5, -7, -9, 2, 4, 6, 8],
];

/// Bytes of a one-channel block, and the side of a block in texels.
const BLOCK: usize = 8;
const SIDE: usize = 4;
/// The index field occupies the forty-eight low bits of the block, three per texel, the first
/// texel in the high bits: its shift is therefore 45.
const TOP: u32 = 45;
const INDEX_BITS: u32 = 3;
/// Largest value of an eleven-bit channel.
const MAX: i32 = 2047;
/// Where a channel goes in a pixel's thirty-two-bit word, whose bytes are B, G, R, A.
const RED: usize = 2;
const GREEN: usize = 1;
/// The level does not carry all the blocks its dimensions announce.
const SHORT: &str = "eac-level-short";

/// `VK_FORMAT_EAC_R11_UNORM_BLOCK`: a single channel, returned as red.
pub(super) fn r11(
    level: &[u8],
    width: usize,
    height: usize,
    image: &mut [u32],
) -> Result<(), &'static str> {
    planes(level, width, height, image, &[RED])
}

/// `VK_FORMAT_EAC_R11G11_UNORM_BLOCK`: two consecutive channels, red then green.
pub(super) fn rg11(
    level: &[u8],
    width: usize,
    height: usize,
    image: &mut [u32],
) -> Result<(), &'static str> {
    planes(level, width, height, image, &[RED, GREEN])
}

/// The level's blocks, row by row, each expanded into the image. A block overflows the edge
/// when the width or height is not a multiple of four: texels outside the image are simply
/// left aside, as the specification requires.
fn planes(
    level: &[u8],
    width: usize,
    height: usize,
    image: &mut [u32],
    targets: &[usize],
) -> Result<(), &'static str> {
    let stride = BLOCK * targets.len();
    let (columns, rows) = (width.div_ceil(SIDE), height.div_ceil(SIDE));
    if level.len() < columns * rows * stride || image.len() < width * height {
        return Err(SHORT);
    }
    for row in 0..rows {
        for column in 0..columns {
            let at = (row * columns + column) * stride;
            // Alpha of an EAC format is opaque: neither R11 nor RG11 carry one.
            let mut texels = [[0, 0, 0, u8::MAX]; SIDE * SIDE];
            for (plane, target) in targets.iter().enumerate() {
                let block = &level[at + plane * BLOCK..at + (plane + 1) * BLOCK];
                channel(block, &mut texels, *target);
            }
            for (index, texel) in texels.iter().enumerate() {
                let (x, y) = (column * SIDE + index % SIDE, row * SIDE + index / SIDE);
                if x < width && y < height {
                    image[y * width + x] = u32::from_le_bytes(*texel);
                }
            }
        }
    }
    Ok(())
}

/// One channel of a block: the base word, the multiplier, the modifier table, then the
/// sixteen three-bit indices. Texels of an EAC block follow column by column — texel `n` is
/// at column `n / 4`, row `n % 4` —, and `texels` stores them in reading order.
fn channel(block: &[u8], texels: &mut [[u8; 4]; SIDE * SIDE], target: usize) {
    let base = i32::from(block[0]) * 8 + 4;
    let declared = i32::from(block[1] >> 4);
    // A null multiplier does not mean "no modifier": the specification reads it as one,
    // which gives the finest step the format can write.
    let multiplier = if declared == 0 { 1 } else { declared * 8 };
    let table = MODIFIERS[usize::from(block[1] & 0xf)];
    let indices = u64::from_be_bytes(block[..BLOCK].try_into().unwrap_or([0; BLOCK]));
    for texel in 0..SIDE * SIDE {
        let index = (indices >> (TOP - INDEX_BITS * texel as u32)) & 7;
        let value = (base + multiplier * i32::from(table[index as usize])).clamp(0, MAX);
        let (x, y) = (texel / SIDE, texel % SIDE);
        texels[y * SIDE + x][target] = eight_bits(value);
    }
}

/// Eleven bits brought back to eight by the round-to-nearest that the range conversion asks:
/// `v * 255 / 2047`, half added before the integer division. Truncation `v >> 3`, itself,
/// lowered one value in eight by one step — and 2047, the full value, only landed right there
/// by chance.
fn eight_bits(value: i32) -> u8 {
    ((value as u32 * 255 + 1023) / 2047) as u8
}
