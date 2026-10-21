//! A vertex colour as a mesh build quantizes it (`built.rs`).
//!
//! A colour channel becomes the byte of its sRGB encoding by Giesen's table (stb_image_resize,
//! THIRD_PARTY_NOTICES.md): the channel held within 2⁻¹³ and the float under 1, its exponent and
//! top mantissa bits pick one of 104 segments, each a bias and a slope, and the next 8 mantissa
//! bits interpolate along it — the exact byte of every byte's linear value, the bounds between
//! bytes off the exact ones by 0.11 % at most. Not a number reads 0. An alpha channel is its
//! linear value times 255, plus a half, truncated, held within [0, 1] and not a number read 0. The
//! DAG and the pages read each channel as its byte's share of 255.

/// Per segment of the table, its bias (high half) and slope (low half).
const SEGMENTS: [u32; 104] = [
    0x0073000d, 0x007a000d, 0x0080000d, 0x0087000d, 0x008d000d, 0x0094000d, 0x009a000d, 0x00a1000d,
    0x00a7001a, 0x00b4001a, 0x00c1001a, 0x00ce001a, 0x00da001a, 0x00e7001a, 0x00f4001a, 0x0101001a,
    0x010e0033, 0x01280033, 0x01410033, 0x015b0033, 0x01750033, 0x018f0033, 0x01a80033, 0x01c20033,
    0x01dc0067, 0x020f0067, 0x02430067, 0x02760067, 0x02aa0067, 0x02dd0067, 0x03110067, 0x03440067,
    0x037800ce, 0x03df00ce, 0x044600ce, 0x04ad00ce, 0x051400ce, 0x057b00c5, 0x05dd00bc, 0x063b00b5,
    0x06970158, 0x07420142, 0x07e30130, 0x087b0120, 0x090b0112, 0x09940106, 0x0a1700fc, 0x0a9500f2,
    0x0b0f01cb, 0x0bf401ae, 0x0ccb0195, 0x0d950180, 0x0e56016e, 0x0f0d015e, 0x0fbc0150, 0x10630143,
    0x11070264, 0x1238023e, 0x1357021d, 0x14660201, 0x156601e9, 0x165a01d3, 0x174401c0, 0x182401af,
    0x18fe0331, 0x1a9602fe, 0x1c1502d2, 0x1d7e02ad, 0x1ed4028d, 0x201a0270, 0x21520256, 0x227d0240,
    0x239f0443, 0x25c003fe, 0x27bf03c4, 0x29a10392, 0x2b6a0367, 0x2d1d0341, 0x2ebe031f, 0x304d0300,
    0x31d105b0, 0x34a80555, 0x37520507, 0x39d504c5, 0x3c37048b, 0x3e7c0458, 0x40a8042a, 0x42bd0401,
    0x44c20798, 0x488e071e, 0x4c1c06b6, 0x4f76065d, 0x52a50610, 0x55ac05cc, 0x5892058f, 0x5b590559,
    0x5e0c0a23, 0x631c0980, 0x67db08f6, 0x6c55087f, 0x70940818, 0x74a007bd, 0x787d076c, 0x7c330723,
];
/// The bits of 2⁻¹³, the least channel the table reads, and of the float just under 1.
const LEAST: u32 = (127 - 13) << 23;
const ALMOST_ONE: u32 = 0x3f7f_ffff;

/// The byte of the sRGB encoding of linear channel `value` (the module's table).
pub(crate) fn srgb_byte(value: f32) -> u8 {
    let (least, almost_one) = (f32::from_bits(LEAST), f32::from_bits(ALMOST_ONE));
    // Written so that not a number falls to the least.
    let held = if value > least { value } else { least };
    let held = if held > almost_one { almost_one } else { held };
    let bits = held.to_bits();
    let segment = SEGMENTS[((bits - LEAST) >> 20) as usize];
    let (bias, slope) = ((segment >> 16) << 9, segment & 0xffff);
    let along = (bits >> 12) & 0xff;
    ((bias + slope * along) >> 16) as u8
}

/// The byte of linear alpha `value` (the module's rule).
pub(crate) fn alpha_byte(value: f32) -> u8 {
    let low = if value > 0.0 { value } else { 0.0 };
    let held = if low < 1.0 { low } else { 1.0 };
    (0.5 + held * 255.0) as u8
}
