//! Tiny DDS of the golden, written here byte by byte from Microsoft's public specification. No
//! encoder is called: each field of `DDS_HEADER`, `DDS_PIXELFORMAT` and `DDS_HEADER_DXT10` is
//! set by hand, and each block carries values whose exact decoding is known. That is the only
//! way to assert “lossless” without taking the decoder's word for it.

/// Offsets, relative to the start of `DDS_HEADER` — the magic number is four extra bytes.
const SIZE: usize = 0;
const FLAGS: usize = 4;
const HEIGHT: usize = 8;
const WIDTH: usize = 12;
const MIPS: usize = 24;
const PIXEL_FORMAT: usize = 72;
const CAPS: usize = 104;
/// `DDSD_CAPS | DDSD_HEIGHT | DDSD_WIDTH | DDSD_PIXELFORMAT | DDSD_MIPMAPCOUNT`.
const HEADER_FLAGS: u32 = 0x0002_1007;
/// `DDSCAPS_TEXTURE`.
const CAPS_TEXTURE: u32 = 0x1000;

fn put(into: &mut [u8], at: usize, value: u32) {
    into[at..at + 4].copy_from_slice(&value.to_le_bytes());
}

/// Thirty-two bytes of `DDS_PIXELFORMAT` for a codec named by its `dwFourCC`.
pub(super) fn fourcc_format(tag: &[u8; 4]) -> [u8; 32] {
    let mut format = [0u8; 32];
    put(&mut format, 0, 32);
    // DDPF_FOURCC
    put(&mut format, 4, 0x4);
    format[8..12].copy_from_slice(tag);
    format
}

/// Thirty-two bytes of `DDS_PIXELFORMAT` of an uncompressed surface, described by its bit
/// masks. `bit_count` is left free: a profile outside the list must be able to write itself.
pub(super) fn mask_format(bit_count: u32, masks: [u32; 4]) -> [u8; 32] {
    let mut format = [0u8; 32];
    put(&mut format, 0, 32);
    // DDPF_RGB | DDPF_ALPHAPIXELS when an alpha mask is given.
    put(&mut format, 4, if masks[3] == 0 { 0x40 } else { 0x41 });
    put(&mut format, 12, bit_count);
    for (channel, mask) in masks.iter().enumerate() {
        put(&mut format, 16 + channel * 4, *mask);
    }
    format
}

/// Complete container: magic number, `DDS_HEADER`, then the bytes that follow the header.
pub(super) fn container(
    format: [u8; 32],
    width: u32,
    height: u32,
    levels: u32,
    payload: &[u8],
) -> Vec<u8> {
    let mut header = [0u8; 124];
    put(&mut header, SIZE, 124);
    put(&mut header, FLAGS, HEADER_FLAGS);
    put(&mut header, HEIGHT, height);
    put(&mut header, WIDTH, width);
    put(&mut header, MIPS, levels);
    header[PIXEL_FORMAT..PIXEL_FORMAT + 32].copy_from_slice(&format);
    put(&mut header, CAPS, CAPS_TEXTURE);
    let mut out = Vec::with_capacity(4 + header.len() + payload.len());
    out.extend_from_slice(b"DDS ");
    out.extend_from_slice(&header);
    out.extend_from_slice(payload);
    out
}

/// The same container, codec named by the `dxgiFormat` of `DDS_HEADER_DXT10`: a simple 2D
/// texture, neither array nor cube, straight alpha.
pub(super) fn dx10(dxgi: u32, width: u32, height: u32, payload: &[u8]) -> Vec<u8> {
    let mut extended = [0u8; 20];
    put(&mut extended, 0, dxgi);
    // D3D10_RESOURCE_DIMENSION_TEXTURE2D, miscFlag, arraySize, miscFlags2.
    put(&mut extended, 4, 3);
    put(&mut extended, 12, 1);
    let mut tail = extended.to_vec();
    tail.extend_from_slice(payload);
    container(fourcc_format(b"DX10"), width, height, 1, &tail)
}

/// A bit writer, from the low bit of the first byte upward: that is the order in which BCn
/// blocks are read, indices as BC7 fields.
pub(super) struct Bits {
    block: [u8; 16],
    at: usize,
}

impl Bits {
    pub(super) fn new() -> Self {
        Bits {
            block: [0; 16],
            at: 0,
        }
    }
    pub(super) fn put(&mut self, value: u32, width: usize) -> &mut Self {
        for bit in 0..width {
            if value >> bit & 1 == 1 {
                self.block[self.at / 8] |= 1 << (self.at % 8);
            }
            self.at += 1;
        }
        self
    }
    /// The sixteen written bytes, padded with zeros — the size of a BC2, BC3, BC5 or BC7 block.
    pub(super) fn block(&self) -> [u8; 16] {
        self.block
    }
}

/// Indices of a block, `width` bits each, from the first pixel to the last.
pub(super) fn indices(values: [u8; 16], width: usize) -> Vec<u8> {
    let mut bits = Bits::new();
    for value in values {
        bits.put(u32::from(value), width);
    }
    bits.block()[..values.len() * width / 8].to_vec()
}

/// Golden's BC1 colour block: pure red and pure blue in 565, so `colour0 > colour1` and the four
/// interpolated colours, then the given indices.
pub(super) fn color_block(order: [u8; 16]) -> Vec<u8> {
    let mut block = vec![0x00, 0xf8, 0x1f, 0x00];
    block.extend_from_slice(&indices(order, 2));
    block
}

/// A three-bit alpha block (BC3, BC4, BC5): two bounds then sixteen indices.
pub(super) fn ramp_block(first: u8, second: u8, order: [u8; 16]) -> Vec<u8> {
    let mut block = vec![first, second];
    block.extend_from_slice(&indices(order, 3));
    block
}
