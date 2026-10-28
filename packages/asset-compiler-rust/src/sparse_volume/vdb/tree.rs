//! A grid's tree: a root that holds tiles and children at 4096 voxels, internal nodes at 128 and 8
//! voxels (tables of 32 and 16 entries a side), leaves of 8 voxels a side. Only what the importer
//! reads is kept: the voxels and tiles that are active, with their values.
use super::cursor::Cursor;
use super::values::{first4, is_on, parse_type, read_mask, read_values, Layout};
use super::{invalid, read_metadata, transform, unsupported};
use crate::sparse_volume::format::IVec3;
use crate::Result;

/// The `log2` of a leaf's side and of the sides of the two internal nodes' tables.
const LEAF_LOG2: u32 = 3;
const INTERNAL_LOG2: [u32; 2] = [5, 4];
/// The voxels a leaf holds.
const LEAF_VOXELS: usize = 1 << (3 * LEAF_LOG2);

/// A leaf: 8x8x8 voxels, the active ones with their values.
pub(crate) struct Leaf {
    pub(crate) origin: IVec3,
    /// A bit per voxel, `x` slowest and `z` fastest.
    pub(crate) mask: Vec<u64>,
    /// The values of the active voxels, in the order of their bits, `components` each.
    pub(crate) values: Vec<f32>,
}

/// An active tile: a cube of voxels, `dim` a side, that has one value.
pub(crate) struct Tile {
    pub(crate) origin: IVec3,
    pub(crate) dim: i32,
    pub(crate) value: [f32; 4],
}

/// A grid of the file.
pub(crate) struct Grid {
    pub(crate) name: String,
    /// Whether the type of its values is one the reader takes; a grid that is not holds nothing.
    pub(crate) supported: bool,
    /// The type of its values as the file names it.
    pub(crate) type_name: String,
    /// The numbers a value holds.
    pub(crate) components: usize,
    pub(crate) background: [f32; 4],
    /// The transform of an index to a position, row-major, the translation in the last row.
    pub(crate) matrix: [f64; 16],
    pub(crate) leaves: Vec<Leaf>,
    pub(crate) tiles: Vec<Tile>,
    /// The box of the active voxels and tiles, its upper corner excluded; none where nothing is
    /// active.
    pub(crate) active_box: Option<(IVec3, IVec3)>,
}

/// The position of entry `n` of a table of `log2` bits a side, in entries.
fn entry(n: usize, log2: u32) -> IVec3 {
    let side = (1usize << log2) - 1;
    [
        (n >> (2 * log2)) as i32,
        ((n >> log2) & side) as i32,
        (n & side) as i32,
    ]
}

/// Reads the topology of an internal node at `depth` (0 the one under the root) whose lowest
/// voxel is `origin`: its masks, its tiles' values, then its children's topology.
fn read_internal(
    cursor: &mut Cursor,
    layout: &Layout,
    grid: &mut Grid,
    depth: usize,
    origin: IVec3,
) -> Result<()> {
    let log2 = INTERNAL_LOG2[depth];
    let child_log2 = if depth == 0 {
        LEAF_LOG2 + INTERNAL_LOG2[1]
    } else {
        LEAF_LOG2
    };
    let child_dim = 1i32 << child_log2;
    let entries = 1usize << (3 * log2);
    let child_mask = read_mask(cursor, entries)?;
    let value_mask = read_mask(cursor, entries)?;
    let values = read_values(cursor, layout, entries, &value_mask)?;
    let width = layout.components;
    let place = |n: usize| {
        let at = entry(n, log2);
        [
            origin[0] + at[0] * child_dim,
            origin[1] + at[1] * child_dim,
            origin[2] + at[2] * child_dim,
        ]
    };
    let mut next = 0;
    for n in (0..entries).filter(|&n| is_on(&value_mask, n)) {
        grid.tiles.push(Tile {
            origin: place(n),
            dim: child_dim,
            value: first4(&values[next * width..(next + 1) * width]),
        });
        next += 1;
    }
    for n in (0..entries).filter(|&n| is_on(&child_mask, n)) {
        if depth == 0 {
            read_internal(cursor, layout, grid, 1, place(n))?;
        } else {
            let mask = read_mask(cursor, LEAF_VOXELS)?;
            grid.leaves.push(Leaf {
                origin: place(n),
                mask,
                values: Vec::new(),
            });
        }
    }
    Ok(())
}

/// Reads the grid whose descriptor was just read: its compression, metadata, transform, topology
/// and buffers. `end` is where its data ends, or zero where the file does not say.
pub(super) fn read_grid(
    cursor: &mut Cursor,
    name: String,
    grid_type: &str,
    end: i64,
) -> Result<Grid> {
    let mut grid = Grid {
        name,
        supported: false,
        type_name: grid_type.to_string(),
        components: 0,
        background: [0.0; 4],
        matrix: [0.0; 16],
        leaves: Vec::new(),
        tiles: Vec::new(),
        active_box: None,
    };
    let Some((components, component_bytes, half_suffix)) = parse_type(grid_type) else {
        if end <= 0 {
            return Err(unsupported(format!(
                "the grid {:?} is of the type {grid_type}, which cannot be skipped: the file does not say where it ends",
                grid.name
            )));
        }
        return Ok(grid);
    };
    grid.supported = true;
    grid.components = components;
    let compression = cursor.u32()?;
    let metadata = read_metadata(cursor)?;
    let from_half = half_suffix
        || metadata.iter().any(|(key, payload)| {
            key == "is_saved_as_half_float" && payload.first().is_some_and(|&b| b != 0)
        });
    grid.matrix = transform::read(cursor)?;
    let layout = Layout {
        components,
        component_bytes,
        from_half,
        compression,
    };
    cursor.skip(4)?; // the tree's buffer count, always one
    grid.background = layout.read_value(cursor)?;
    let tiles = cursor.u32()? as usize;
    let children = cursor.u32()? as usize;
    for _ in 0..tiles {
        let origin = [cursor.i32()?, cursor.i32()?, cursor.i32()?];
        let value = layout.read_value(cursor)?;
        let active = cursor.u8()? != 0;
        if active {
            grid.tiles.push(Tile {
                origin,
                dim: 1 << (LEAF_LOG2 + INTERNAL_LOG2[0] + INTERNAL_LOG2[1]),
                value,
            });
        }
    }
    for _ in 0..children {
        let origin = [cursor.i32()?, cursor.i32()?, cursor.i32()?];
        read_internal(cursor, &layout, &mut grid, 0, origin)?;
    }
    for leaf in &mut grid.leaves {
        let mask = read_mask(cursor, LEAF_VOXELS)?;
        if mask != leaf.mask {
            return Err(invalid(
                "a leaf's buffer does not repeat the mask of its topology",
            ));
        }
        leaf.values = read_values(cursor, &layout, LEAF_VOXELS, &mask)?;
    }
    grid.active_box = active_box(&grid);
    Ok(grid)
}

/// The box of the active voxels and tiles of `grid`, its upper corner excluded.
fn active_box(grid: &Grid) -> Option<(IVec3, IVec3)> {
    let mut found: Option<(IVec3, IVec3)> = None;
    let mut cover = |low: IVec3, high: IVec3| {
        let (min, max) = found.get_or_insert((low, high));
        for axis in 0..3 {
            min[axis] = min[axis].min(low[axis]);
            max[axis] = max[axis].max(high[axis]);
        }
    };
    for tile in &grid.tiles {
        cover(tile.origin, tile.origin.map(|x| x + tile.dim));
    }
    for leaf in &grid.leaves {
        for bit in (0..LEAF_VOXELS).filter(|&bit| is_on(&leaf.mask, bit)) {
            let at = entry(bit, LEAF_LOG2);
            let voxel = [
                leaf.origin[0] + at[0],
                leaf.origin[1] + at[1],
                leaf.origin[2] + at[2],
            ];
            cover(voxel, voxel.map(|x| x + 1));
        }
    }
    found
}

impl Grid {
    /// Calls `visit` for each active voxel and each active tile: the box it covers, its upper corner
    /// excluded, and its value's components.
    pub(crate) fn visit(&self, visit: &mut dyn FnMut(IVec3, IVec3, &[f32])) {
        for tile in &self.tiles {
            visit(
                tile.origin,
                tile.origin.map(|x| x + tile.dim),
                &tile.value[..self.components],
            );
        }
        let width = self.components;
        for leaf in &self.leaves {
            let mut next = 0;
            for bit in (0..LEAF_VOXELS).filter(|&bit| is_on(&leaf.mask, bit)) {
                let at = entry(bit, LEAF_LOG2);
                let voxel = [
                    leaf.origin[0] + at[0],
                    leaf.origin[1] + at[1],
                    leaf.origin[2] + at[2],
                ];
                visit(
                    voxel,
                    voxel.map(|x| x + 1),
                    &leaf.values[next * width..(next + 1) * width],
                );
                next += 1;
            }
        }
    }
}
