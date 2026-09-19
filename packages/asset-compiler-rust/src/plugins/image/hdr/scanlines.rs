//! Pixel lines of a Radiance HDR, in the three writings the specification defines, and the
//! RGBE → linear float conversion.
//!
//! A line is either raw — four bytes per pixel —, or run-length compressed. The "old"
//! compression of "Real Pixels" repeats the previous pixel by a `1,1,1,n` marker; the "new"
//! one, which appeared with Radiance 2.0 and is announced by the `2, 2, width` header,
//! compresses the four components separately, each in raw packets (count ≤ 128) and runs
//! (count > 128). Both write exactly the same pixels: it is the same line said another way.

/// The announced bytes are not all there, a run overflows its line, or a packet does not
/// advance. For the host, that is the symptom of a cut file, and the texture falls back to
/// white.
const TRUNCATED: &str = "hdr-data-truncated";
/// Widths in which the new compression can be written: outside, a `2,2,…` header is an
/// ordinary pixel whose red mantissa is 2, not a compression announcement.
const NEW_RLE_WIDTHS: std::ops::RangeInclusive<usize> = 8..=0x7fff;
/// Beyond this count, a packet of the new compression is a run, and its length is the
/// difference; at or below, it is a raw packet of `count` bytes.
const RUN_MARK: u8 = 128;
/// Run marker of the old compression: the three mantissas at one.
const OLD_RUN_MARKER: [u8; 3] = [1, 1, 1];
/// RGBE exponent offset: the mantissa is an eight-bit fraction and the exponent is biased
/// by 128, hence `value = mantissa × 2^(e - 128 - 8)`.
const EXPONENT_BIAS: i32 = 136;
/// Offset and bias of a double-float exponent, to write `2^k` without going through a power
/// function: at those exponents, the result must be exact.
const F64_MANTISSA_BITS: u32 = 52;
const F64_EXPONENT_BIAS: i32 = 1023;

/// The `height` lines of `width` pixels, as float RGBA, top row first. Alpha is opaque
/// everywhere: the format carries no transparency channel, and inventing one would be lying —
/// hence the buffer filled with 1 of which only the first three channels are rewritten.
pub(super) fn decode(
    body: &[u8],
    width: u32,
    height: u32,
) -> std::result::Result<Vec<f32>, &'static str> {
    let width = width as usize;
    let mut out = vec![1.0_f32; width * height as usize * 4];
    let mut row = vec![[0_u8; 4]; width];
    let mut rest = body;
    for y in 0..height as usize {
        rest = scanline(rest, &mut row)?;
        for (x, rgbe) in row.iter().enumerate() {
            let at = (y * width + x) * 4;
            out[at..at + 3].copy_from_slice(&to_linear(*rgbe));
        }
    }
    Ok(out)
}

/// One line, in the writing its first four bytes announce.
fn scanline<'a>(
    body: &'a [u8],
    row: &mut [[u8; 4]],
) -> std::result::Result<&'a [u8], &'static str> {
    let head: [u8; 4] = body
        .get(..4)
        .and_then(|head| head.try_into().ok())
        .ok_or(TRUNCATED)?;
    let announced = usize::from(u16::from_be_bytes([head[2], head[3]]));
    if head[0] == 2 && head[1] == 2 && announced == row.len() && NEW_RLE_WIDTHS.contains(&row.len())
    {
        return new_rle(&body[4..], row);
    }
    old_rle(body, row)
}

/// The new compression: the four components one after another, each in raw packets and runs,
/// until the line is full. An empty packet would not advance, a packet that overflows the line
/// is lying about its length: both are refusals.
fn new_rle<'a>(
    mut body: &'a [u8],
    row: &mut [[u8; 4]],
) -> std::result::Result<&'a [u8], &'static str> {
    for component in 0..4 {
        let mut at = 0;
        while at < row.len() {
            let (count, tail) = body.split_first().ok_or(TRUNCATED)?;
            body = tail;
            let is_run = *count > RUN_MARK;
            let run = usize::from(if is_run { *count - RUN_MARK } else { *count });
            if run == 0 {
                return Err(TRUNCATED);
            }
            let span = row.get_mut(at..at + run).ok_or(TRUNCATED)?;
            if is_run {
                let (value, tail) = body.split_first().ok_or(TRUNCATED)?;
                body = tail;
                for pixel in span {
                    pixel[component] = *value;
                }
            } else {
                let values = body.get(..run).ok_or(TRUNCATED)?;
                body = &body[run..];
                for (pixel, value) in span.iter_mut().zip(values) {
                    pixel[component] = *value;
                }
            }
            at += run;
        }
    }
    Ok(body)
}

/// The old compression, which is also the raw case: pixels as-is, and a `1,1,1,n` marker that
/// repeats the previous one. Consecutive markers multiply by 256, which allows runs longer
/// than 255; the first pixel of a line cannot be one.
fn old_rle<'a>(
    mut body: &'a [u8],
    row: &mut [[u8; 4]],
) -> std::result::Result<&'a [u8], &'static str> {
    let mut at = 0;
    let mut multiplier = 1_usize;
    let mut previous = [0_u8; 4];
    while at < row.len() {
        let pixel: [u8; 4] = body
            .get(..4)
            .and_then(|head| head.try_into().ok())
            .ok_or(TRUNCATED)?;
        body = &body[4..];
        if pixel[..3] != OLD_RUN_MARKER {
            multiplier = 1;
            previous = pixel;
            row[at] = pixel;
            at += 1;
            continue;
        }
        if at == 0 {
            return Err(TRUNCATED);
        }
        let run = usize::from(pixel[3])
            .checked_mul(multiplier)
            .ok_or(TRUNCATED)?;
        multiplier = multiplier.saturating_mul(256);
        for slot in row.get_mut(at..at + run).ok_or(TRUNCATED)? {
            *slot = previous;
        }
        at += run;
    }
    Ok(body)
}

/// An RGBE pixel to three linear floats. A null exponent is the format's zero, not a small
/// value. The scale `2^(e - 136)` is built bit by bit in double precision — its exponent sits
/// between -135 and 119, hence always normal — then the product is rounded only once, on the
/// way to single precision: the returned value is the one the file describes.
fn to_linear(pixel: [u8; 4]) -> [f32; 3] {
    if pixel[3] == 0 {
        return [0.0; 3];
    }
    let exponent = i32::from(pixel[3]) - EXPONENT_BIAS + F64_EXPONENT_BIAS;
    let scale = f64::from_bits((exponent as u64) << F64_MANTISSA_BITS);
    [
        (f64::from(pixel[0]) * scale) as f32,
        (f64::from(pixel[1]) * scale) as f32,
        (f64::from(pixel[2]) * scale) as f32,
    ]
}
