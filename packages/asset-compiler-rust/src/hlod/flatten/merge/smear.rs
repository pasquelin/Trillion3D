//! A baked image's texels nothing wrote — the background, opaque magenta, which the image starts
//! as —: the image shrunk to one texel when it holds one value (`shrunk`), the background around
//! what it holds filled outward (`smeared`), and an image of one value at last one texel
//! (`uniform`). An entry's images go through all three before the atlas takes them, the atlas's
//! own images through the filling alone (`grid.rs`), its gutters and empty cells then the colours
//! of the cells around them.
use super::super::uv::raster::{dilate, Role};

/// The value of a texel nothing wrote: opaque magenta, a colour no material is expected to bake. A
/// baked texel of exactly that value reads as one nothing wrote, as every texel of it does.
pub(super) const BACKGROUND: [u8; 4] = [255, 0, 255, 255];

/// An RGBA8 image: its sides and texels, row by row.
pub(in crate::hlod) struct Image {
    pub width: usize,
    pub height: usize,
    pub texels: Vec<[u8; 4]>,
}

impl Image {
    /// An image `width` by `height` texels of the background alone.
    pub(super) fn background(width: usize, height: usize) -> Self {
        Self {
            width,
            height,
            texels: vec![BACKGROUND; width * height],
        }
    }

    /// The one texel it holds once shrunk (`shrunk`, `uniform`), `None` while it holds more.
    pub(super) fn constant(&self) -> Option<[u8; 4]> {
        (self.texels.len() == 1).then(|| self.texels[0])
    }

    /// The image as one texel of `value`.
    fn single(&mut self, value: [u8; 4]) {
        *self = Self {
            width: 1,
            height: 1,
            texels: vec![value],
        };
    }
}

/// `image` shrunk to one texel when every texel nothing wrote aside holds one value — to the
/// background itself when nothing wrote any —; whole otherwise.
pub(in crate::hlod) fn shrunk(image: &mut Image) {
    let mut written = image.texels.iter().filter(|&&t| t != BACKGROUND);
    let value = written.next().copied().unwrap_or(BACKGROUND);
    if written.all(|&t| t == value) {
        image.single(value);
    }
}

/// `image` of one value — every texel alike — as that one texel.
pub(in crate::hlod) fn uniform(image: &mut Image) {
    if let Some(&first) = image.texels.first() {
        if image.texels.len() > 1 && image.texels.iter().all(|&t| t == first) {
            image.single(first);
        }
    }
}

/// `image`'s background filled outward from what it holds, ring by ring (`raster::dilate`, the
/// one dilation of every atlas): each round, every background texel with a written texel among
/// its eight neighbours — those written before the round — takes their mean, each channel's sum
/// divided by their count and the remainder dropped; a mean that falls on the background value
/// leaves its texel to a later round, and a round that writes nothing leaves the rest background.
/// An image holding nothing is all zeros; one texel is left as it is.
pub(in crate::hlod) fn smeared(image: &mut Image) {
    let (width, height) = (image.width, image.height);
    if width * height <= 1 {
        return;
    }
    let texels = &mut image.texels;
    let roles: Vec<Role> = (texels.iter())
        .map(|&t| match t == BACKGROUND {
            true => Role::Open,
            false => Role::Source,
        })
        .collect();
    if !roles.contains(&Role::Source) {
        texels.iter_mut().for_each(|t| *t = [0; 4]);
        return;
    }
    dilate([width, height], roles, |at, from| {
        let mut sum = [0u32; 4];
        for &n in from {
            (0..4).for_each(|c| sum[c] += u32::from(texels[n][c]));
        }
        let mean = sum.map(|s| (s / from.len() as u32) as u8);
        let taken = mean != BACKGROUND;
        if taken {
            texels[at] = mean;
        }
        taken
    });
}
