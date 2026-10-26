//! The images of the merged atlas while its entries are baked and placed: the base colour and the
//! maps the layer bakes beside it, each entry baked into them as it comes (`Images::bake`), the
//! whole then finished (`Images::finished`).
//!
//! - In cells (`Placing::Cells`): each entry baked into images of its own, shrunk to one texel when
//!   they hold one value, their background filled outward, and placed in the entry's cell
//!   (`grid.rs`), the cells' texels the atlas's sampled ones; the emission images brought onto the
//!   largest strength, cell by cell.
//! - In the whole atlas (`Placing::Together`, the entries laid out together, `global`): each entry
//!   baked straight into the atlas's images, a texel written where a triangle covers it — a texel
//!   of the background value is no texel written, in any image — and over any entry's before, with
//!   no image of the entry's own to make or scan; the texels the base image holds written are the
//!   atlas's sampled ones; the emission images brought onto the largest strength texel by texel,
//!   by the entry that wrote each.
//!
//! Finished, every image has its background filled outward from what it holds.
use super::emission::{rescaled, rescaled_by_owner, NO_OWNER};
use super::remap::occupancy;
use crate::hlod::flatten::bake::Maps;
use crate::hlod::flatten::merge::grid::Cell;
use crate::hlod::flatten::merge::smear::BACKGROUND;
use crate::hlod::flatten::merge::tile::{baked, baked_in, Read, Shared, Targets};
use crate::hlod::flatten::uv::raster::{EMPTY, SAMPLED};
use crate::hlod::flatten::Library;
mod set;
pub(super) use set::Finished;
use set::Set;

/// Where the entries' images go, with what that mode keeps beside them.
enum Placing {
    /// Each in a cell of its own.
    Cells(Vec<Cell>),
    /// All over the atlas.
    Together {
        /// Per texel of the atlas, the emission in linear, where it is baked; else empty.
        linear: Vec<[f32; 3]>,
        /// Per texel, the entry that wrote the emission image there (`NO_OWNER` for none).
        owners: Vec<u32>,
    },
}

/// The atlas's images in the making.
pub(super) struct Images {
    side: usize,
    maps: Maps,
    set: Set,
    placing: Placing,
    /// Each entry's emission strength, in the order the entries are baked.
    strengths: Vec<f32>,
}

/// Entry number `rank` baked into the atlas `set` in place by `bake`, which is handed the atlas —
/// `linear` the emission in linear of every texel, none where it is not baked — and gives back the
/// entry's emission strength and the places of the emission texels it wrote, which `owners` then
/// names the entry for; the strength.
fn in_place(
    set: &mut Set,
    (linear, owners): (&mut [[f32; 3]], &mut [u32]),
    rank: usize,
    bake: impl FnOnce(&mut Shared) -> crate::Result<(f32, Vec<usize>)>,
) -> crate::Result<f32> {
    let Set {
        base,
        normal,
        metal_rough,
        emission,
        occlusion,
        anisotropy,
    } = set;
    let mut shared = Shared {
        targets: Targets {
            base,
            normal: normal.as_mut(),
            metal_rough: metal_rough.as_mut(),
            occlusion: occlusion.as_mut(),
            anisotropy: anisotropy.as_mut(),
            emitted: (!linear.is_empty()).then_some(linear),
            masked: true,
        },
        emission: emission.as_mut(),
    };
    let (strength, wrote) = bake(&mut shared)?;
    for at in wrote {
        owners[at] = rank as u32;
    }
    Ok(strength)
}

impl Images {
    /// The images of an atlas `side` texels square, the maps `maps` baked among them, the entries
    /// to go in the cells `cells`, or all over it when there are none.
    pub(super) fn new(side: usize, maps: Maps, cells: Option<Vec<Cell>>) -> Self {
        let placing = match cells {
            Some(cells) => Placing::Cells(cells),
            None => {
                let texels = if maps.emissive { side * side } else { 0 };
                Placing::Together {
                    linear: vec![[0.0; 3]; texels],
                    owners: vec![NO_OWNER; texels],
                }
            }
        };
        Self {
            side,
            maps,
            set: Set::blank(side, maps),
            placing,
            strengths: Vec::new(),
        }
    }

    /// The entries' cells, none where they share the atlas.
    pub(super) fn cells(&self) -> Option<&[Cell]> {
        match &self.placing {
            Placing::Cells(cells) => Some(cells),
            Placing::Together { .. } => None,
        }
    }

    /// Entry number `rank` — its triangles at `coordinates`, read as `read` says — baked and put in
    /// the atlas (module doc); entries come in order.
    pub(super) fn bake(
        &mut self,
        rank: usize,
        (read, coordinates): (Read<'_>, &[[[f64; 2]; 3]]),
        library: &Library,
    ) -> crate::Result<()> {
        let scene = (self.side, self.maps);
        match &mut self.placing {
            Placing::Cells(cells) => {
                let entry = baked(read, coordinates, scene, library)?;
                self.strengths.push(entry.emission_strength);
                self.set.put(cells[rank], entry);
            }
            Placing::Together { linear, owners } => {
                let strength = in_place(&mut self.set, (linear, owners), rank, |shared| {
                    baked_in(read, coordinates, scene, library, shared)
                })?;
                self.strengths.push(strength);
            }
        }
        Ok(())
    }

    /// Every entry baked: the emission images brought onto the largest strength, each image's
    /// background filled outward from what it holds, the images as bytes.
    pub(super) fn finished(mut self) -> Finished {
        let strength = self.strengths.iter().copied().fold(0.0f32, f32::max);
        let occupancy = match &self.placing {
            Placing::Cells(cells) => occupancy(cells, self.side),
            Placing::Together { .. } => (self.set.base.texels.iter())
                .map(|&texel| if texel == BACKGROUND { EMPTY } else { SAMPLED })
                .collect(),
        };
        if let Some(atlas) = self.set.emission.as_mut() {
            match &self.placing {
                Placing::Cells(cells) => rescaled(atlas, (cells, &self.strengths), strength),
                Placing::Together { owners, .. } => {
                    rescaled_by_owner(atlas, (owners, &self.strengths), strength)
                }
            }
        }
        self.set.finished(strength, occupancy)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::hlod::flatten::bake::gpu::Tile;

    const RED: [u8; 4] = [255, 0, 0, 255];
    const BLUE: [u8; 4] = [0, 0, 255, 255];

    /// The words of a tile whose base colour is `base` and whose emission is `emission`.
    fn tile(base: [u8; 4], emission: [f32; 3]) -> Tile {
        let [r, g, b] = emission.map(f32::to_bits);
        [u32::from_le_bytes(base), 0, 0, 0, 0, r, g, b]
    }

    /// Entry `rank` baked in place into the 2 × 2 atlas of `images`, which shares it: the texels
    /// `at` of `base` colour and `emission`, its emission held over its own strength.
    fn bake(images: &mut Images, rank: usize, at: &[usize], (base, emission): ([u8; 4], [f32; 3])) {
        let Placing::Together { linear, owners } = &mut images.placing else {
            panic!("the entries share the atlas");
        };
        let maps = images.maps;
        let strength = emission.into_iter().fold(0.0, f32::max);
        in_place(&mut images.set, (linear, owners), rank, |shared| {
            for &texel in at {
                shared.targets.put(texel, &tile(base, emission), maps);
            }
            let samples: Vec<[u32; 4]> = at.iter().map(|&t| [t as u32, 0, 0, 0]).collect();
            Ok((strength, shared.held_over(&samples, 2, strength)))
        })
        .expect("baked");
        images.strengths.push(strength);
    }

    #[test]
    fn entries_sharing_the_atlas_write_the_texels_they_cover_the_last_over_the_first() {
        let mut images = Images::new(2, Maps::default(), None);
        bake(&mut images, 0, &[0, 1], (RED, [0.0; 3]));
        bake(&mut images, 1, &[0], (BLUE, [0.0; 3]));
        bake(&mut images, 2, &[1], (BACKGROUND, [0.0; 3]));
        // The texel two covered is the second's; the one the third covered with the background's
        // value is still the first's; the texels none covered are still the background.
        assert_eq!(images.set.base.texels, [BLUE, RED, BACKGROUND, BACKGROUND]);
        let done = images.finished();
        assert_eq!(done.occupancy, [SAMPLED, SAMPLED, EMPTY, EMPTY]);
    }

    #[test]
    fn the_emission_of_each_texel_is_held_over_the_strongest_by_the_entry_that_wrote_it() {
        let maps = Maps {
            emissive: true,
            ..Maps::default()
        };
        let mut images = Images::new(2, maps, None);
        // Two entries, the first emitting half as strongly as the second.
        bake(&mut images, 0, &[0], (RED, [1.0; 3]));
        bake(&mut images, 1, &[3], (RED, [2.0; 3]));
        let done = images.finished();
        let emission = done.emission.expect("the emission image");
        assert_eq!(done.strength, 2.0);
        assert!(emission[0] < 255, "{emission:?}");
        assert_eq!(emission[12..15], [255, 255, 255]);
    }

    #[test]
    fn entries_in_cells_have_cells_and_entries_sharing_the_atlas_have_none() {
        let cell = Cell {
            at: [0, 0],
            size: [1, 1],
            offset: [0.0; 2],
            scale: [0.5; 2],
        };
        let in_cells = Images::new(2, Maps::default(), Some(vec![cell]));
        assert_eq!(in_cells.cells().map(<[_]>::len), Some(1));
        assert!(Images::new(2, Maps::default(), None).cells().is_none());
    }
}
