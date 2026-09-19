//! The three length-prefixed sections that separate a PSD's header from its composite data,
//! and what they **declare**: colour-mode data, image resources, layers and masks.
//!
//! They are not recomposed — the driver only returns the flattened composite the file already
//! carries —, but they are no longer skipped blindly either. The specification Adobe
//! publishes for third-party readers places at the start of the layers section a **layer
//! count** over two signed bytes, and says of its sign: negative, its absolute value is the
//! number of layers and the composite's first alpha channel carries the document's
//! transparency. That is the only declaration that separates a transparency from a stored
//! alpha channel — a selection —, and without it a fourth plane taken for alpha punches holes
//! in the texture.
//!
//! The image-resources section is read the same way, for a single one of its entries:
//! resource 1039, which carries the document's colour profile. The contract output is sRGB
//! and this batch converts no colour: another profile is counted, never applied.
use super::{Header, DATA_TRUNCATED};
use crate::plugins::image::icc;

/// Width of the layers-section length field, and of the layer-info block it opens: four
/// bytes in PSD, eight in PSB.
const WIDE: usize = 8;
const NARROW: usize = 4;
/// The layer count itself, two signed bytes.
const COUNT_BYTES: usize = 2;
/// Signature that each block of the image-resources section carries at the front.
const RESOURCE: &[u8] = b"8BIM";
/// Identifier of the resource that carries the document's colour profile.
const ICC_PROFILE: u16 = 1039;
/// What a resource block carries before its name: its signature and its identifier.
const RESOURCE_HEAD: usize = 6;

/// What the sections declare, and that the header alone does not say.
pub(super) struct Declared {
    /// The composite carries the document's transparency in its first alpha plane. False
    /// when nothing declares it: the plane that follows the colour channels is then a
    /// selection.
    pub(super) transparency: bool,
    /// Number of layers in the file. Only the composite comes out of the driver: above zero,
    /// that is a report reason, never a silence.
    pub(super) layers: u32,
    /// Reason to count for the document's colour profile, when it is not the output's.
    pub(super) profile: Option<&'static str>,
}

/// Skips the three sections and returns what they declare with the bytes that follow them.
/// A length that falls outside the file is a named truncation, never a read beside it.
pub(super) fn walk<'a>(
    header: &Header,
    after_header: &'a [u8],
) -> std::result::Result<(Declared, &'a [u8]), &'static str> {
    // The first two lengths sit on four bytes in both versions of the format; only that of
    // the layers section doubles in width in PSB.
    let mut rest = skip(after_header, NARROW)?;
    let profile = profile(rest);
    rest = skip(rest, NARROW)?;
    let wide = if header.psb { WIDE } else { NARROW };
    let (transparency, layers) = layers(rest, wide);
    let declared = Declared {
        transparency,
        layers,
        profile,
    };
    Ok((declared, skip(rest, wide)?))
}

/// Reason to count for resource 1039, looked up block by block in the image-resources
/// section. A block is the `8BIM` signature, the identifier over two bytes, a Pascal name
/// padded to an even length, the data length, then the data themselves, padded the same way.
/// A missing or inconsistent section declares nothing.
fn profile(bytes: &[u8]) -> Option<&'static str> {
    let mut rest = field(bytes, NARROW).and_then(|length| bytes.get(NARROW..NARROW + length))?;
    while let Some(head) = rest.get(..RESOURCE_HEAD) {
        if !head.starts_with(RESOURCE) {
            return None;
        }
        let id = u16::from_be_bytes([head[4], head[5]]);
        let name = usize::from(*rest.get(RESOURCE_HEAD)?) + 1;
        let at = RESOURCE_HEAD + name.next_multiple_of(2);
        let length = field(rest.get(at..)?, NARROW)?;
        let data = rest.get(at + NARROW..at + NARROW + length)?;
        if id == ICC_PROFILE {
            return icc::note(data);
        }
        rest = rest.get(at + NARROW + length.next_multiple_of(2)..)?;
    }
    None
}

/// Declared transparency and layer count, read at the start of the layers section when it
/// carries one. An empty section, or one too short for its layer-info block, declares
/// nothing: that is the case of a document without a layer, whose extra plane can only be a
/// selection.
fn layers(bytes: &[u8], wide: usize) -> (bool, u32) {
    let count = count(bytes, wide);
    (
        count.is_some_and(|count| count < 0),
        count.map_or(0, |count| count.unsigned_abs().into()),
    )
}

/// The count itself, when the section carries it. The layer-info block opens the section by
/// its own length: under two bytes, there is no count to read.
fn count(bytes: &[u8], wide: usize) -> Option<i16> {
    let section = field(bytes, wide).and_then(|length| bytes.get(wide..wide + length))?;
    let info = field(section, wide)?;
    let count = section
        .get(wide..wide + COUNT_BYTES)
        .filter(|_| info >= COUNT_BYTES)?;
    Some(i16::from_be_bytes([count[0], count[1]]))
}

/// Length that a field of `width` bytes carries at the front of these bytes, big-endian like
/// the whole format. A missing field or a length that does not fit in a `usize` return `None`.
fn field(bytes: &[u8], width: usize) -> Option<usize> {
    let field = bytes.get(..width)?;
    let length = field
        .iter()
        .fold(0u64, |value, byte| value << 8 | u64::from(*byte));
    usize::try_from(length).ok()
}

/// A length-prefixed section, skipped by its length.
fn skip(bytes: &[u8], width: usize) -> std::result::Result<&[u8], &'static str> {
    let end = field(bytes, width)
        .and_then(|length| width.checked_add(length))
        .ok_or(DATA_TRUNCATED)?;
    bytes.get(end..).ok_or(DATA_TRUNCATED)
}
