//! Profile of a TIFF, read from its first IFD before any decode.
//!
//! TIFF is a field container rather than a format: two files of the same extension may have
//! only their first eight bytes in common. The driver therefore reads the IFD itself to know,
//! before decoding, whether it is facing one of the profiles it declares. Without this read
//! the library would decide in its place, and a 16-bit would come back clipped to eight
//! without anyone having said so — exactly the loss the import policy forbids adding.
//!
//! Fields, types and default values follow "TIFF Revision 6.0" (Adobe Developers Association,
//! 3 June 1992), public specification. BigTIFF is recognized by its magic number 43.
use super::{DEPTH, PROFILE, UNREADABLE};

/// The eight header bytes: byte order, magic number, address of the first IFD.
const HEADER: usize = 8;
/// One IFD entry: tag, type, number of values, then the value or its address.
const ENTRY: usize = 12;
/// Magic number of classic TIFF; 43 is that of BigTIFF, which this driver refuses.
const CLASSIC: u32 = 42;
const BIG: u32 = 43;

const BITS_PER_SAMPLE: u32 = 258;
const COMPRESSION: u32 = 259;
const PHOTOMETRIC: u32 = 262;
const SAMPLES_PER_PIXEL: u32 = 277;
const PLANAR: u32 = 284;
const EXTRA_SAMPLES: u32 = 338;
const SAMPLE_FORMAT: u32 = 339;

/// Declared compressions: none, LZW, Deflate — the two tags that name it — and PackBits.
/// All return the original bytes as-is. JPEG (6 and 7) and CCITT (2, 3, 4) are absent: the
/// first would add a loss on decoding an already-lossy source, the latter only describe
/// bilevel, outside the announced profiles.
const COMPRESSIONS: [u32; 5] = [1, 5, 8, 32773, 32946];

/// What an IFD entry carries: its number of values, and the first four. Beyond four
/// components we are outside the declared profiles, there is nothing left to read to decide.
struct Field {
    count: u32,
    values: [u32; 4],
}

struct Ifd<'a> {
    bytes: &'a [u8],
    big_endian: bool,
}

impl Ifd<'_> {
    /// An unsigned integer of `width` bytes, in the order the header declares.
    fn uint(&self, at: usize, width: usize) -> Option<u32> {
        let mut value = 0;
        for (index, byte) in self.bytes.get(at..at + width)?.iter().enumerate() {
            let rank = if self.big_endian {
                width - 1 - index
            } else {
                index
            };
            value |= u32::from(*byte) << (8 * rank);
        }
        Some(value)
    }

    /// Values of an entry. They live in the field's four bytes when they fit — left-aligned —,
    /// otherwise the field carries their address. Types that cannot describe a profile,
    /// starting with rationals, are not read.
    fn field(&self, entry: usize) -> Option<Field> {
        let width = match self.uint(entry + 2, 2)? {
            1 | 2 | 6 | 7 => 1,
            3 | 8 => 2,
            4 | 9 => 4,
            _ => return None,
        };
        let count = self.uint(entry + 4, 4)?;
        let base = if u64::from(count) * width as u64 <= 4 {
            entry + HEADER
        } else {
            self.uint(entry + HEADER, 4)? as usize
        };
        let mut values = [0; 4];
        for (index, slot) in values.iter_mut().enumerate().take(count.min(4) as usize) {
            *slot = self.uint(base + index * width, width)?;
        }
        Some(Field { count, values })
    }

    /// The entry that carries this tag in the IFD starting at `first`, or nothing.
    fn find(&self, first: usize, entries: usize, tag: u32) -> Option<Field> {
        (0..entries)
            .map(|index| first + 2 + index * ENTRY)
            .find(|entry| self.uint(*entry, 2) == Some(tag))
            .and_then(|entry| self.field(entry))
    }

    /// The unique value of this tag, or the one the specification gives by default when it is
    /// missing.
    fn single(&self, first: usize, entries: usize, tag: u32, default: u32) -> Option<u32> {
        match self.find(first, entries, tag) {
            None => Some(default),
            Some(field) if field.count == 1 => Some(field.values[0]),
            Some(_) => None,
        }
    }
}

/// This file's profile, or the reason to refuse it. Nothing is decoded here: fields are read.
pub(super) fn check(bytes: &[u8]) -> std::result::Result<(), &'static str> {
    let big_endian = match bytes.get(..2) {
        Some(b"II") => false,
        Some(b"MM") => true,
        _ => return Err(UNREADABLE),
    };
    let ifd = Ifd { bytes, big_endian };
    match ifd.uint(2, 2) {
        Some(CLASSIC) => {}
        // BigTIFF shares the extension and almost the header, but its addresses sit on eight
        // bytes: it is another format, with no reader here, and it is named rather than broken.
        Some(BIG) => return Err(PROFILE),
        _ => return Err(UNREADABLE),
    }
    let first = ifd.uint(4, 4).ok_or(UNREADABLE)? as usize;
    let entries = ifd.uint(first, 2).ok_or(UNREADABLE)? as usize;
    // One page and only one: of a multi-page TIFF the library would return the first, and the
    // others would vanish without a report.
    if ifd.uint(first + 2 + entries * ENTRY, 4).ok_or(UNREADABLE)? != 0 {
        return Err(PROFILE);
    }
    let samples = ifd
        .single(first, entries, SAMPLES_PER_PIXEL, 1)
        .ok_or(PROFILE)?;
    depth(&ifd, first, entries, samples)?;
    colors(&ifd, first, entries, samples)?;
    if !COMPRESSIONS.contains(&ifd.single(first, entries, COMPRESSION, 1).ok_or(PROFILE)?) {
        return Err(PROFILE);
    }
    // Interleaved only: in planar configuration the components live in distinct strips, that
    // is another data organization this driver does not announce it reads.
    if ifd.single(first, entries, PLANAR, 1) != Some(1) {
        return Err(PROFILE);
    }
    Ok(())
}

/// Eight bits per component, unsigned integers, and nothing else. 16-bit has its own reason:
/// it is not an exotic profile, it is precision the contract output cannot yet carry —
/// clipping it in silence would add a loss.
fn depth(
    ifd: &Ifd<'_>,
    first: usize,
    entries: usize,
    samples: u32,
) -> std::result::Result<(), &'static str> {
    if samples == 0 || samples > 4 {
        return Err(PROFILE);
    }
    let bits = ifd.find(first, entries, BITS_PER_SAMPLE).ok_or(PROFILE)?;
    if bits.count != samples {
        return Err(PROFILE);
    }
    let read = &bits.values[..samples as usize];
    if read.contains(&16) {
        return Err(DEPTH);
    }
    let entiers = ifd
        .find(first, entries, SAMPLE_FORMAT)
        .is_none_or(|format| {
            format.values[..samples.min(format.count) as usize]
                .iter()
                .all(|value| *value == 1)
        });
    if read.iter().any(|value| *value != 8) || !entiers {
        return Err(PROFILE);
    }
    Ok(())
}

/// The three declared interpretations: 8-bit greyscale black at zero, RGB8 and RGBA8 with
/// straight alpha. Palette, CMYK, YCbCr and CIELab have no reader here — the library does
/// not even expand TIFF palettes, and nothing would be returned rather than returned wrong.
fn colors(
    ifd: &Ifd<'_>,
    first: usize,
    entries: usize,
    samples: u32,
) -> std::result::Result<(), &'static str> {
    let photometric = ifd
        .single(first, entries, PHOTOMETRIC, u32::MAX)
        .ok_or(PROFILE)?;
    let extra = ifd.find(first, entries, EXTRA_SAMPLES);
    match (photometric, samples) {
        (1, 1) | (2, 3) if extra.is_none() => Ok(()),
        // The fourth channel of an RGB is an alpha only once declared as such, and only
        // unassociated alpha (2) is straight: associated alpha (1) is premultiplied, returning
        // it as-is would change the colours.
        (2, 4) => match extra {
            Some(field) if field.count == 1 && field.values[0] == 2 => Ok(()),
            _ => Err(PROFILE),
        },
        _ => Err(PROFILE),
    }
}
