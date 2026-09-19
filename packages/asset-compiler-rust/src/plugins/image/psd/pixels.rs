//! Composite data of a PSD or a PSB: the flattened image the file already carries, plane by
//! plane. Three length-prefixed sections separate the header from these bytes — colour-mode
//! data, image resources, layers and masks — and are skipped by their length, with nothing
//! read there: layers are not recomposed.
//!
//! The section starts with its compression mode, then carries one whole plane after another,
//! in the order of the header's channels. Raw planes are the surface as-is; compressed planes
//! are PackBits lines, preceded by a table that gives the compressed length of each line of
//! each channel — two bytes per entry in PSD, four in PSB.
use super::lines::Lines;
use super::sections::{self, Declared};
use super::{Header, COMPOSITE_MISSING, DATA_TRUNCATED};
use crate::plugins::image::{blocks, DecodedImage, RGBA8_PIXEL_BYTES};

/// The two bytes that announce the composite's compression.
const MARKER_BYTES: usize = 2;
/// Bytes of one pixel of the output contract, counted as the allocation ceiling counts them.
const RGBA_BYTES: usize = RGBA8_PIXEL_BYTES as usize;

/// Skips the three sections that separate the header from the composite data, and returns
/// what they declare with the composite's compression mode and the bytes that follow it. A
/// file that stops before this section has no flattened image: its layers are not recomposed
/// in its place.
pub(super) fn composite<'a>(
    header: &Header,
    after_header: &'a [u8],
) -> std::result::Result<(Declared, u16, &'a [u8]), &'static str> {
    let (declared, rest) = sections::walk(header, after_header)?;
    if rest.is_empty() {
        return Err(COMPOSITE_MISSING);
    }
    let marker = rest.get(..MARKER_BYTES).ok_or(DATA_TRUNCATED)?;
    Ok((
        declared,
        u16::from_be_bytes([marker[0], marker[1]]),
        &rest[MARKER_BYTES..],
    ))
}

/// RGBA8 image of the composite. The buffer starts all at `u8::MAX`: the mode's colour
/// channels are always written, and alpha therefore stays opaque exactly when no plane
/// carries it.
pub(super) fn decode(
    header: &Header,
    declared: &Declared,
    compression: u16,
    body: &[u8],
) -> std::result::Result<DecodedImage, &'static str> {
    let (width, height) = (header.width as usize, header.height as usize);
    let mut lines = Lines::new(header, compression, body)?;
    let mut rgba = vec![u8::MAX; width * height * RGBA_BYTES];
    let mut line = vec![0u8; width];
    for channel in 0..header.channels {
        let targets = targets(header, declared, channel);
        for row in 0..height {
            lines.read(channel * height + row, &mut line)?;
            let start = row * width * RGBA_BYTES;
            let quads = rgba
                .get_mut(start..start + width * RGBA_BYTES)
                .ok_or(DATA_TRUNCATED)?;
            let (quads, _) = quads.as_chunks_mut::<RGBA_BYTES>();
            for (pixel, value) in quads.iter_mut().zip(line.iter().copied()) {
                for target in targets {
                    pixel[*target] = value;
                }
            }
        }
    }
    blocks::image(header.width, header.height, rgba, DATA_TRUNCATED)
}

/// Where a plane goes in the output quadruplet. In greyscale, the single colour channel
/// carries the three components; in RGB, each carries its own. The plane that follows the
/// colour channels is the composite's alpha only if the file declared it — by the sign of
/// its layer count. Otherwise it is a stored alpha channel, a selection: it is read, so that
/// the cursor advances by one plane, and written nowhere. The buffer keeps its opaque alpha.
fn targets(header: &Header, declared: &Declared, channel: usize) -> &'static [usize] {
    if channel >= header.color_channels {
        return if declared.transparency { &[3] } else { &[] };
    }
    match (header.color_channels, channel) {
        (1, _) => &[0, 1, 2],
        (_, 0) => &[0],
        (_, 1) => &[1],
        _ => &[2],
    }
}
