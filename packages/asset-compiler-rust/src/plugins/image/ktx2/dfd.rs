//! Format descriptor of a KTX 2.0 — the "Khronos Data Format Descriptor" — and what it
//! declares around the texels.
//!
//! Khronos's specification places this descriptor in a section the header names by an offset
//! and a length. It opens on its total size, then on a basic block of which this module reads
//! two bytes: `transferFunction`, which says whether the samples are encoded by the sRGB
//! curve or proportional to light, and `flags`, whose first bit announces a premultiplied
//! alpha. Ignoring them amounted to lightening or darkening a whole texture, and to letting
//! colours already multiplied by their alpha through where the contract asks for straight
//! alpha.
//!
//! This module judges nothing and refuses nothing: a missing, truncated or silent descriptor
//! simply returns an empty declaration, and it is the caller that decides what to do with it.
use crate::plugins::image::Transfer;

/// The two header words that name the section: its offset then its length.
const OFFSET: usize = 48;
const LENGTH: usize = 52;
/// The descriptor's total size opens the section; the basic block starts just after.
const TOTAL_SIZE: usize = 4;
/// In the basic block: the transfer function, then the flags.
const TRANSFER: usize = 10;
const FLAGS: usize = 11;

/// `KHR_DF_TRANSFER_LINEAR` and `KHR_DF_TRANSFER_SRGB`. Zero is `KHR_DF_TRANSFER_UNSPECIFIED`,
/// and any other value names a curve this driver does not declare: in both cases the file
/// said nothing usable, and the caller falls back on the `vkFormat`.
const LINEAR: u8 = 1;
const SRGB: u8 = 2;
/// `KHR_DF_FLAG_ALPHA_PREMULTIPLIED`, the first bit of the basic-block flags: the texel's
/// components are already multiplied by its alpha, where the output contract asks for them
/// straight.
const PREMULTIPLIED: u8 = 1;

/// What the descriptor declares. `transfer` is empty when the file has no descriptor, when
/// it is truncated, or when it leaves the transfer function unspecified.
pub(super) struct Descriptor {
    pub(super) transfer: Option<Transfer>,
    pub(super) premultiplied: bool,
}

/// This file's descriptor, or an empty declaration. The section bounds are checked against
/// the file length: an offset that falls outside reads nothing, it never reads beside it.
pub(super) fn read(bytes: &[u8]) -> Descriptor {
    let byte = |at: usize| basic(bytes).and_then(|block| block.get(at).copied());
    Descriptor {
        transfer: match byte(TRANSFER) {
            Some(LINEAR) => Some(Transfer::Linear),
            Some(SRGB) => Some(Transfer::Srgb),
            _ => None,
        },
        premultiplied: byte(FLAGS).is_some_and(|flags| flags & PREMULTIPLIED != 0),
    }
}

/// The descriptor's basic block: the section the header names, its total size skipped.
fn basic(bytes: &[u8]) -> Option<&[u8]> {
    let word = |at: usize| {
        let field: [u8; 4] = bytes.get(at..at + 4)?.try_into().ok()?;
        usize::try_from(u32::from_le_bytes(field)).ok()
    };
    let (at, length) = (word(OFFSET)?, word(LENGTH)?);
    bytes.get(at..at.checked_add(length)?)?.get(TOTAL_SIZE..)
}
