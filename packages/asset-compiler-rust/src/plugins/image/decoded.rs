//! What an image driver returns: the pixels, and what the file declared around them.
//!
//! A driver does not return only a surface. A file also declares things the contract cannot carry
//! — an animation, a colour profile, a selection channel — and dropping them in silence is the
//! defect this module closes: what is not converted is counted as a named reason, beside the image,
//! without refusing the decode.
//!
//! **Straight alpha, everywhere.** Both `DecodedImage` variants carry non-premultiplied alpha.
//! A format whose samples are associated with their alpha — an OpenEXR, whose specification says
//! associated alpha, a KTX 2.0 whose descriptor raises the premultiplied flag — is
//! un-premultiplied by its driver before it leaves, never returned as-is: the consumer would not
//! know it had to, and the preview would premultiply a second time.

/// What a driver returns as pixels. Two outputs, and no bridge from one to the other: reducing a
/// float to eight bits would require a tone-mapping curve, hence a loss the source did not have,
/// which the import policy forbids. A consumer that can only handle one variant refuses the other
/// with a named report reason. Both carry **straight alpha**: a format with associated alpha is
/// un-premultiplied by its driver, never returned as-is.
pub enum DecodedImage {
    /// RGBA 8 bits per channel, straight alpha, at least one pixel. `ImageDecoded::transfer` says
    /// which transfer function these bytes are written in: the contract no longer assumes sRGB.
    Rgba8(image::RgbaImage),
    /// RGBA 32-bit floats per channel, **linear** and straight alpha, at least one pixel: what
    /// high-dynamic-range formats return. `data` holds `width * height * 4` values, one pixel after
    /// another, top row first.
    RgbaF32 {
        width: u32,
        height: u32,
        data: Vec<f32>,
    },
}

/// Transfer function of the returned samples: the curve that links the stored byte to the light
/// it represents. A DDS `_UNORM` and its `_SRGB` twin carry the same bytes and do not mean the
/// same thing; confusing them lightens or darkens the whole texture.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Transfer {
    /// Bytes are encoded by the sRGB curve: what most colour formats declare, and what convention
    /// lends to those that stay silent.
    Srgb,
    /// Samples are proportional to light. That is the case of the float outputs, and of a GPU
    /// container that names an `_UNORM` variant or a linear `transferFunction`.
    Linear,
}

/// What a driver returns: the image, its transfer function, and named reasons for what the file
/// declared that the output cannot carry. `notes` is never a refusal — the driver returned an
/// image —, it is the caller that counts these reasons on the report.
pub struct ImageDecoded {
    pub image: DecodedImage,
    pub transfer: Transfer,
    pub notes: Vec<&'static str>,
}

impl ImageDecoded {
    /// A decoded image and its transfer function — read from the file, or lent by the format's
    /// convention (sRGB for bytes, linear for floats) — nothing to report.
    pub fn new(image: DecodedImage, transfer: Transfer) -> Self {
        Self {
            image,
            transfer,
            notes: Vec::new(),
        }
    }

    /// The same, its transfer function read from the file rather than lent by convention.
    pub fn with_transfer(mut self, transfer: Transfer) -> Self {
        self.transfer = transfer;
        self
    }

    /// One more reason, counted by the caller. The same code is added only once: an image carries
    /// a defect, it does not carry it twice.
    pub fn with_note(mut self, note: &'static str) -> Self {
        if !self.notes.contains(&note) {
            self.notes.push(note);
        }
        self
    }

    /// The same, when the caller has several to set at once.
    pub fn with_notes(self, notes: impl IntoIterator<Item = &'static str>) -> Self {
        notes.into_iter().fold(self, Self::with_note)
    }
}
