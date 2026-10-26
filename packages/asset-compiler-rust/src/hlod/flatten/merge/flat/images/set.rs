//! The images of the atlas, whichever way the entries are put in (`Set`), and the atlas finished
//! (`Finished`).
use crate::hlod::flatten::bake::Maps;
use crate::hlod::flatten::merge::grid::{placed, Cell};
use crate::hlod::flatten::merge::smear::{shrunk, smeared, uniform, Image};
use crate::hlod::flatten::merge::tile::Baked;

/// The atlas's images: the base colour, and the others where the layer bakes them.
pub(super) struct Set {
    pub base: Image,
    pub normal: Option<Image>,
    pub metal_rough: Option<Image>,
    pub emission: Option<Image>,
    pub occlusion: Option<Image>,
    pub anisotropy: Option<Image>,
}

impl Set {
    /// The images of an atlas `side` texels square, blank, the maps `maps` bakes among them.
    pub(super) fn blank(side: usize, maps: Maps) -> Self {
        let blank = |baked: bool| baked.then(|| Image::background(side, side));
        Self {
            base: Image::background(side, side),
            normal: blank(maps.normal),
            metal_rough: blank(maps.metal_rough()),
            emission: blank(maps.emissive),
            occlusion: blank(maps.occlusion),
            anisotropy: blank(maps.anisotropic()),
        }
    }

    /// An entry's baked images put in its `cell`: each shrunk to one texel when it holds one value,
    /// its background filled outward, and placed (`grid.rs`).
    pub(super) fn put(&mut self, cell: Cell, entry: Baked) {
        let place = |atlas: &mut Image, mut image: Image| {
            shrunk(&mut image);
            smeared(&mut image);
            uniform(&mut image);
            placed(atlas, &image, &cell);
        };
        place(&mut self.base, entry.base);
        let others = [
            (&mut self.normal, entry.normal),
            (&mut self.metal_rough, entry.metal_rough),
            (&mut self.emission, entry.emission),
            (&mut self.occlusion, entry.occlusion),
            (&mut self.anisotropy, entry.anisotropy),
        ];
        for (atlas, image) in others {
            if let (Some(atlas), Some(image)) = (atlas.as_mut(), image) {
                place(atlas, image);
            }
        }
    }

    /// Each image's background filled outward from what it holds, the images as bytes.
    pub(super) fn finished(self, strength: f32, occupancy: Vec<u32>) -> Finished {
        let finish = |mut image: Image| {
            smeared(&mut image);
            image.texels.into_flattened()
        };
        Finished {
            base: finish(self.base),
            normal: self.normal.map(finish),
            metal_rough: self.metal_rough.map(finish),
            emission: self.emission.map(finish),
            occlusion: self.occlusion.map(finish),
            anisotropy: self.anisotropy.map(finish),
            strength,
            occupancy,
        }
    }
}

/// The atlas's images finished, as bytes, and what they are held over.
pub(in crate::hlod) struct Finished {
    pub base: Vec<u8>,
    pub normal: Option<Vec<u8>>,
    pub metal_rough: Option<Vec<u8>>,
    pub emission: Option<Vec<u8>>,
    pub occlusion: Option<Vec<u8>>,
    pub anisotropy: Option<Vec<u8>>,
    /// The strength the emission image is held over.
    pub strength: f32,
    /// `SAMPLED` where an entry wrote a texel of the atlas, `EMPTY` elsewhere.
    pub occupancy: Vec<u32>,
}
