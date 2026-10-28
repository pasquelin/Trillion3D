//! The mip chain and the border voxels of a volume texture: the levels above the first, each page the average of the eight
//! pages below it that it covers, and the voxels around each tile read from its neighbours.
use super::{Addressing, MipMap, TextureData};
use crate::sparse_volume::format::*;
use rayon::prelude::*;

impl TextureData {
    /// The number of mip levels down to a page table of one page.
    fn full_mip_count(&self) -> usize {
        let mut resolution = self.header.page_table_resolution;
        let mut levels = 1;
        while resolution.iter().any(|&side| side > 1) {
            resolution = map3(resolution, |side| side / 2);
            levels += 1;
        }
        levels
    }

    /// Generates the mip levels above the first, the border voxels of each included.
    pub(crate) fn generate_mip_maps(&mut self, addressing: &Addressing) {
        let formats = self.header.formats;
        let sizes = [formats[0].block_bytes(), formats[1].block_bytes()];
        self.mips.truncate(1);
        for mip in 1..self.full_mip_count() {
            let low = map3(self.header.page_table_min, |x| x >> mip);
            let resolution = shift_right_and_max(self.header.page_table_resolution, mip as u32, 1);
            // The pages that cover a page of the level below.
            let mut pages: Vec<IVec3> = Vec::new();
            for z in 0..resolution[2] {
                for y in 0..resolution[1] {
                    for x in 0..resolution[0] {
                        let page = [x, y, z];
                        let covered = (0..8).any(|octant| {
                            let offset = [octant & 1, (octant >> 1) & 1, (octant >> 2) & 1];
                            let parent = add3(map3(add3(low, page), |c| c * 2), offset);
                            self.read_page_table(parent, mip - 1)
                                .is_some_and(|entry| entry != 0)
                        });
                        if covered {
                            pages.push(page);
                        }
                    }
                }
            }
            let mut level = MipMap {
                page_table: vec![0; cells(resolution)],
                tiles_a: vec![0; pages.len() * VOXELS_PER_PADDED_TILE * sizes[0]],
                tiles_b: vec![0; pages.len() * VOXELS_PER_PADDED_TILE * sizes[1]],
                tile_count: pages.len(),
            };
            for (rank, &page) in pages.iter().enumerate() {
                level.page_table[linear(page, resolution)] = rank as u32 + 1;
            }
            // Each tile is the average of the eight voxels of the level below it covers.
            let averaged: Vec<[Vec<[f32; 4]>; 2]> = pages
                .par_iter()
                .map(|&page| {
                    let base = map3(add3(low, page), |c| c * TILE_RES * 2);
                    [0, 1].map(|attribute| {
                        if formats[attribute] == PixelFormat::Unknown {
                            return Vec::new();
                        }
                        let mut voxels =
                            Vec::with_capacity((TILE_RES * TILE_RES * TILE_RES) as usize);
                        for z in 0..TILE_RES {
                            for y in 0..TILE_RES {
                                for x in 0..TILE_RES {
                                    let mut sum = [0.0f32; 4];
                                    for octant in 0..8 {
                                        let offset =
                                            [octant & 1, (octant >> 1) & 1, (octant >> 2) & 1];
                                        let source =
                                            add3(add3(base, [x * 2, y * 2, z * 2]), offset);
                                        let sample =
                                            self.load(source, mip - 1, attribute, addressing);
                                        for c in 0..4 {
                                            sum[c] += sample[c];
                                        }
                                    }
                                    voxels.push(sum.map(|c| c / 8.0));
                                }
                            }
                        }
                        voxels
                    })
                })
                .collect();
            self.mips.push(level);
            for (rank, voxels) in averaged.iter().enumerate() {
                for attribute in 0..2 {
                    for (n, &value) in voxels[attribute].iter().enumerate() {
                        let side = TILE_RES as usize;
                        let coord = [
                            (n % side) as i32,
                            ((n / side) % side) as i32,
                            (n / (side * side)) as i32,
                        ];
                        self.write_tile_voxel(rank, coord, mip, attribute, value, None);
                    }
                }
            }
            self.generate_border_voxels(addressing, mip, &pages);
        }
    }

    /// Fills the border voxels of the tiles of `pages` (in mip `mip`'s page table) from the voxels
    /// of their neighbours.
    fn generate_border_voxels(&mut self, addressing: &Addressing, mip: usize, pages: &[IVec3]) {
        let low = map3(self.header.page_table_min, |x| x >> mip);
        let resolution = shift_right_and_max(self.header.page_table_resolution, mip as u32, 1);
        let border_coords: Vec<IVec3> = (-TILE_BORDER..TILE_RES + TILE_BORDER)
            .flat_map(|z| {
                (-TILE_BORDER..TILE_RES + TILE_BORDER).flat_map(move |y| {
                    (-TILE_BORDER..TILE_RES + TILE_BORDER).map(move |x| [x, y, z])
                })
            })
            .filter(|&coord| !in_bounds(coord, [0; 3], [TILE_RES; 3]))
            .collect();
        let borders: Vec<Vec<[[f32; 4]; 2]>> = pages
            .par_iter()
            .map(|&page| {
                border_coords
                    .iter()
                    .map(|&local| {
                        let volume = add3(map3(add3(low, page), |c| c * TILE_RES), local);
                        [0, 1].map(|attribute| self.load(volume, mip, attribute, addressing))
                    })
                    .collect()
            })
            .collect();
        for (&page, values) in pages.iter().zip(&borders) {
            let tile = self.mips[mip].page_table[linear(page, resolution)] as usize - 1;
            for (&local, value) in border_coords.iter().zip(values) {
                for attribute in 0..2 {
                    self.write_tile_voxel(tile, local, mip, attribute, value[attribute], None);
                }
            }
        }
    }

    /// The pages of mip 0 that hold a tile.
    fn mip0_pages(&self) -> Vec<IVec3> {
        let resolution = self.header.page_table_resolution;
        let mut pages = Vec::new();
        for z in 0..resolution[2] {
            for y in 0..resolution[1] {
                for x in 0..resolution[0] {
                    if self.mips[0].page_table[linear([x, y, z], resolution)] != 0 {
                        pages.push([x, y, z]);
                    }
                }
            }
        }
        pages
    }

    /// Aligns the texture to the page table `mips` mip levels ask for (`Header`), its border voxels
    /// and its mip chain generated. Why it cannot be, if it cannot.
    pub(crate) fn build_mips(&mut self, addressing: &Addressing, mips: u32) -> Result<(), String> {
        let mut header = self.header.clone();
        header.update_page_table_from_global_mips(mips);
        header.validate()?;
        if header != self.header {
            let old = &self.header;
            let mut table = vec![0u32; cells(header.page_table_resolution)];
            for z in header.page_table_min[2]..header.page_table_max[2] {
                for y in header.page_table_min[1]..header.page_table_max[1] {
                    for x in header.page_table_min[0]..header.page_table_max[0] {
                        let global = [x, y, z];
                        if in_bounds(global, old.page_table_min, old.page_table_max) {
                            let from =
                                linear(sub3(global, old.page_table_min), old.page_table_resolution);
                            let to = linear(
                                sub3(global, header.page_table_min),
                                header.page_table_resolution,
                            );
                            table[to] = self.mips[0].page_table[from];
                        }
                    }
                }
            }
            self.mips[0].page_table = table;
            self.header = header;
        }
        let pages = self.mip0_pages();
        self.generate_border_voxels(addressing, 0, &pages);
        self.generate_mip_maps(addressing);
        Ok(())
    }
}
