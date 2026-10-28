//! The sparse volume texture: its maths, its build from voxels, its pages and tiles.
use super::derived::{Derived, NO_PARENT};
use super::format::*;
use super::texture::{Addressing, CreateInfo, Source, TextureData};

/// A cube of `side` voxels at `low` whose every voxel holds `value` in the first component.
struct Cube {
    low: IVec3,
    side: i32,
    value: f32,
}

impl Source for Cube {
    fn info(&self) -> CreateInfo {
        CreateInfo {
            min: self.low,
            max: add3(self.low, [self.side; 3]),
            formats: [PixelFormat::R8, PixelFormat::Unknown],
            fallback: [[0.0; 4]; 2],
        }
    }
    fn visit(&self, visit: &mut dyn FnMut(IVec3, IVec3, usize, usize, f32)) {
        visit(self.low, add3(self.low, [self.side; 3]), 0, 0, self.value);
    }
}

fn addressing(side: i32) -> Addressing {
    Addressing {
        resolution: [side; 3],
    }
}

// Behaviour: the page table rounds each side up to a power of two and a volume of 40 voxels needs
// three pages, so four, and three mip levels.
#[test]
fn a_volume_has_a_power_of_two_page_table_and_a_mip_chain() {
    let header = Header::new(
        [0; 3],
        [40; 3],
        [PixelFormat::R8, PixelFormat::Unknown],
        [[0.0; 4]; 2],
    );
    assert_eq!(header.page_table_resolution, [4; 3]);
    assert_eq!(mip_levels([0; 3], [40; 3]), 3);
    assert_eq!(pack_x11y11z10([1, 2, 3]), 1 | (2 << 11) | (3 << 22));
}

// Behaviour: a volume filled with one value stores a tile for each page it touches, shares them
// where they are alike, and the coarsest level is one page whose parent is none.
#[test]
fn a_full_volume_makes_pages_that_share_alike_tiles() {
    let cube = Cube {
        low: [0; 3],
        side: 32,
        value: 1.0,
    };
    let mut texture = TextureData::create(&cube).unwrap();
    assert_eq!(texture.mips[0].tile_count, 8);
    texture
        .build_mips(&addressing(32), mip_levels([0; 3], [32; 3]))
        .unwrap();
    assert_eq!(texture.mips.len(), 2);
    let derived = Derived::build(&texture);
    assert_eq!(derived.mips.len(), 2);
    assert_eq!(derived.mips[1].count, 1);
    assert_eq!(derived.parents[0], NO_PARENT);
    assert!(derived.tile_count < 9, "alike tiles are shared");
}

// Behaviour: only the voxels that are not the fallback value are stored, behind a bit mask.
#[test]
fn a_tile_stores_the_voxels_that_are_not_the_fallback() {
    let cube = Cube {
        low: [0; 3],
        side: 16,
        value: 1.0,
    };
    let mut texture = TextureData::create(&cube).unwrap();
    texture.build_mips(&addressing(16), 1).unwrap();
    let derived = Derived::build(&texture);
    let compressed = derived.compress().unwrap();
    // The 16^3 interior is set; the border, read as the clamped edge, is set too, the fallback being 0.
    assert_eq!(usize::from(compressed.voxels_a[0]), VOXELS_PER_PADDED_TILE);
    assert_eq!(
        compressed.data.len(),
        OCCUPANCY_WORDS_PER_PADDED_TILE * 4 + VOXELS_PER_PADDED_TILE
    );
}

// Behaviour: a voxel written to a format reads back as the format holds it.
#[test]
fn voxels_round_trip_through_their_format() {
    let mut data = vec![0u8; 16];
    write_voxel(1, &mut data, PixelFormat::R16F, [0.5, 0.0, 0.0, 0.0], None);
    assert_eq!(read_voxel(1, &data, PixelFormat::R16F)[0], 0.5);
    write_voxel(
        0,
        &mut data,
        PixelFormat::R8G8B8A8,
        [1.0, 0.0, 1.0, 0.0],
        Some(2),
    );
    assert_eq!(data[2], 255);
    assert_eq!(data[0], 0);
}
