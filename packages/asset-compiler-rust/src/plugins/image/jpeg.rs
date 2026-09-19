//! JPEG driver, ISO/IEC 10918 standard, decoded by the `image` crate (`jpeg` feature). Decoding
//! re-encodes nothing: the loss is the source file's, the compiler adds none.
//!
//! Twelve-bit-precision JPEG, rare and reserved for technical imaging, does not have here the
//! defect that 16-bit PNG had: `zune-jpeg`, the feature's decoder, reads precision from the SOF
//! marker and refuses anything that is not eight bits, rather than lowering it. The refusal
//! already comes out as `image-decode-failed`, with no depth clipped in silence — nothing to
//! add here.
use super::{crate_image, icc, ImageDecoded, ImageDecoder, Plugin};

pub(super) static JPEG: Jpeg = Jpeg;
pub(super) struct Jpeg;

impl Plugin for Jpeg {
    fn name(&self) -> &'static str {
        "jpeg"
    }
    /// The suffix names the colour-profile counting: the version enters the cache identity, and
    /// an entry written when a profile vanished without a word does not say the same thing as
    /// today's.
    fn version(&self) -> &'static str {
        "jpeg-image-0.25-icc"
    }
    /// The two extensions of the same format, in the order a neighbouring file is looked up.
    fn extensions(&self) -> &'static [&'static str] {
        &["jpg", "jpeg"]
    }
}

impl ImageDecoder for Jpeg {
    fn mime(&self) -> &'static str {
        "image/jpeg"
    }
    /// Start-of-image marker, followed by the first segment marker.
    fn accepts_head(&self, head: &[u8]) -> bool {
        head.starts_with(&[0xFF, 0xD8, 0xFF])
    }
    fn decode(
        &self,
        bytes: &[u8],
        max_alloc: u64,
    ) -> std::result::Result<ImageDecoded, &'static str> {
        let decoded = crate_image::decode(bytes, max_alloc, image::ImageFormat::Jpeg)?;
        Ok(decoded.with_notes(icc::jpeg(bytes)))
    }
}
