//! Colour profiles that files carry, and that the contract output does not carry.
//!
//! `into_rgba8`, in the `image` crate as in the PSD reader, returns bytes that the rest of the
//! chain reads as sRGB. A file can still embed an ICC profile that says something else: other
//! primaries, another curve, another white point. Converting it would require a full colour
//! management, which is not this batch; staying silent would pass a texture for what it is not.
//!
//! This module therefore converts nothing. It answers a single question — is this profile
//! something other than the output sRGB? — and returns the reason to count when the answer is
//! yes.
//!
//! **How a profile is named.** An ICC profile carries its description in the clear in its `desc`
//! tag; searching for the ASCII sequence "sRGB" in its bytes is enough to recognize sRGB
//! profiles, which all carry it in their description. A PNG, itself, compresses its profile but
//! writes the name in the clear in front: that is the name that is read, and the caller passes
//! what it has.
//!
//! A false positive — a profile of another space whose description would contain "sRGB" — only
//! silences a counter; a false negative only raises one too many. Neither touches a pixel.

/// The file carries a colour profile that the output does not carry, and that no conversion
/// comes to apply. Counted per texture, never silenced, never a refusal.
pub(super) const IGNORED: &str = "image-icc-profile-ignored";

/// Sequence that every sRGB profile carries in its description.
const SRGB: &[u8] = b"sRGB";
/// Header that the ICC specification requires of APP2 segments of a JPEG that carry a profile.
const JPEG_MARKER: &[u8] = b"ICC_PROFILE\0";
/// First byte of every JPEG marker, and the two markers where segment walking stops: the start
/// of entropy data, and the end of the image.
const MARKER: u8 = 0xff;
const START_OF_SCAN: u8 = 0xda;
const END_OF_IMAGE: u8 = 0xd9;
/// Second application segment, where the ICC specification places the profile.
const APP2: u8 = 0xe2;
/// The two bytes of the start-of-image signature, which the walk skips.
const START_OF_IMAGE: usize = 2;
/// Length of a segment, two bytes that count themselves.
const SEGMENT_LENGTH: usize = 2;

/// Reason to count for these bytes — the profile itself, or the name a container gives it —
/// when they do not name the output sRGB.
pub(super) fn note(profile: &[u8]) -> Option<&'static str> {
    let named_srgb = profile.windows(SRGB.len()).any(|window| window == SRGB);
    (!named_srgb).then_some(IGNORED)
}

/// Profile of a JPEG, looked up in its segments. The ICC specification carries it in one or
/// more APP2 whose payload opens on "ICC_PROFILE\0", the chunk number and their count; the
/// first chunk is enough, since the description is there. The walk stops at the start of
/// entropy data: beyond that, the bytes are no longer segments.
pub(super) fn jpeg(bytes: &[u8]) -> Option<&'static str> {
    let mut at = START_OF_IMAGE;
    while let Some(&[MARKER, kind]) = bytes.get(at..at + 2) {
        if kind == START_OF_SCAN || kind == END_OF_IMAGE {
            return None;
        }
        let field: [u8; 2] = bytes.get(at + 2..at + 4)?.try_into().ok()?;
        let length = usize::from(u16::from_be_bytes(field));
        let payload = bytes.get(at + 2 + SEGMENT_LENGTH..at + 2 + length)?;
        if kind == APP2 {
            if let Some(profile) = payload.strip_prefix(JPEG_MARKER) {
                return note(profile);
            }
        }
        at += 2 + length;
    }
    None
}
