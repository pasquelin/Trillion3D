//! Associated (premultiplied) samples brought back to straight alpha, pixel by pixel and in place:
//! the one walk the drivers whose formats may associate alpha run (`exr`, `ktx2`), each sample type
//! dividing in its own range and rounding.

/// A sample type alpha can be divided out of.
pub(super) trait Associated: Copy {
    /// Whether `alpha` divides anything: an opaque alpha leaves the pixel exactly as-is, and a
    /// null (or, in floats, negative) one holds no straight colour to recover.
    fn divides(alpha: Self) -> bool;
    /// This colour sample with `alpha` divided out.
    fn unassociate(self, alpha: Self) -> Self;
}

impl Associated for f32 {
    fn divides(alpha: f32) -> bool {
        !(alpha <= 0.0 || alpha == 1.0)
    }
    fn unassociate(self, alpha: f32) -> f32 {
        self / alpha
    }
}

/// Bytes round to nearest and saturate at a full byte: an encoder may have written a component
/// above its alpha.
impl Associated for u8 {
    fn divides(alpha: u8) -> bool {
        alpha != 0 && alpha != u8::MAX
    }
    fn unassociate(self, alpha: u8) -> u8 {
        let alpha = u32::from(alpha);
        let value = (u32::from(self) * u32::from(u8::MAX) + alpha / 2) / alpha;
        value.min(u32::from(u8::MAX)) as u8
    }
}

/// Every RGBA pixel of `data` brought back to straight alpha.
pub(super) fn straight<T: Associated>(data: &mut [T]) {
    for pixel in data.as_chunks_mut::<4>().0 {
        let alpha = pixel[3];
        if !T::divides(alpha) {
            continue;
        }
        for component in pixel.iter_mut().take(3) {
            *component = component.unassociate(alpha);
        }
    }
}
