//! The crossed cells' flags and the points each leaf makes.
use super::super::grid::{add, local_coord, Coord, Grid, Mask, SIZE};
use super::super::tables::{AMBIGUOUS_FACE, EDGE_GROUP};
use super::cells::{cell_values, compute_point, correct_signs, sign_flags};
use super::regions::Aux;
use super::{INSIDE, INVALID_POINT, SIGNS, XEDGE, YEDGE, ZEDGE};
use rayon::prelude::*;
use trillion3d_page_codec::hash::{WordMap, WordSet};

/// Each crossed cell of `cells`: its corner signs, edge flags and ambiguous face correction.
pub(super) fn crossed_cells(grid: &Grid, cells: WordMap<Coord, Mask>, iso_value: f32) -> Vec<Aux> {
    let cells: Vec<(Coord, Mask)> = cells.into_iter().collect();
    cells
        .par_iter()
        .filter_map(|&(origin, mask)| {
            let mut flags = Box::new([0i16; SIZE]);
            let mut on = Mask::default();
            for pos in mask.ons() {
                let ijk = add(origin, local_coord(pos));
                let mut signs = sign_flags(&cell_values(grid, ijk), iso_value);
                if signs == 0 || signs == 0xFF {
                    continue;
                }
                let inside = signs & 0x1 != 0;
                let mut edge_flags = if inside { INSIDE } else { 0 };
                if inside != ((signs & 0x02) != 0) {
                    edge_flags |= XEDGE;
                }
                if inside != ((signs & 0x10) != 0) {
                    edge_flags |= YEDGE;
                }
                if inside != ((signs & 0x08) != 0) {
                    edge_flags |= ZEDGE;
                }
                let face = AMBIGUOUS_FACE[signs as usize];
                if face != 0 {
                    signs = correct_signs(signs, face, grid, ijk, iso_value);
                }
                flags[pos] = edge_flags | i16::from(signs);
                on.set_on(pos);
            }
            (!on.is_empty()).then_some(Aux { origin, flags, on })
        })
        .collect()
}

/// The points each leaf of `aux` makes, numbered into `point_index`: one per edge group of a cell
/// left alone, one per merged region.
pub(super) fn leaf_points(
    grid: &Grid,
    aux: &[Aux],
    point_index: &mut [Box<[u32; SIZE]>],
    voxel: f64,
    iso: f64,
) -> Vec<[f32; 3]> {
    let counts: Vec<u32> = aux
        .iter()
        .zip(point_index.iter())
        .map(|(a, idx)| {
            let mut count = 0u32;
            let mut regions: WordSet<u32> = WordSet::default();
            for pos in a.on.ons() {
                let id = idx[pos];
                if id == 0 {
                    count += u32::from(EDGE_GROUP[(SIGNS & a.flags[pos]) as usize][0]);
                } else if id != INVALID_POINT {
                    regions.insert(id);
                }
            }
            count + regions.len() as u32
        })
        .collect();
    let mut starts = Vec::with_capacity(counts.len());
    let mut total = 0u32;
    for &c in &counts {
        starts.push(total);
        total += c;
    }

    // The points.
    let per_leaf: Vec<Vec<[f32; 3]>> = point_index
        .par_iter_mut()
        .zip(aux.par_iter())
        .zip(starts.par_iter())
        .map(|((idx, a), &start)| {
            let mut points = Vec::new();
            let mut point_offset = start;
            let mut regions: std::collections::BTreeMap<u32, Vec<usize>> = Default::default();
            let values_at = |ijk: Coord| cell_values(grid, ijk).map(f64::from);
            for pos in a.on.ons() {
                let id = idx[pos];
                if id != 0 {
                    if id != INVALID_POINT {
                        regions.entry(id).or_default().push(pos);
                    }
                    continue;
                }
                idx[pos] = point_offset;
                let signs = (SIGNS & a.flags[pos]) as u8;
                let ijk = add(a.origin, local_coord(pos));
                let values = values_at(ijk);
                for group in 1..=EDGE_GROUP[signs as usize][0] {
                    let p = compute_point(&values, signs, group, iso);
                    points.push(std::array::from_fn(|k| {
                        ((p[k] + f64::from(ijk[k])) * voxel) as f32
                    }));
                    point_offset += 1;
                }
            }
            for voxels in regions.values() {
                let mut avg = [0.0f64; 3];
                for &pos in voxels {
                    let ijk = add(a.origin, local_coord(pos));
                    idx[pos] = point_offset;
                    let signs = (SIGNS & a.flags[pos]) as u8;
                    let p = compute_point(&values_at(ijk), signs, 1, iso);
                    for k in 0..3 {
                        avg[k] += f64::from(ijk[k]) + p[k];
                    }
                }
                if voxels.len() > 1 {
                    let w = 1.0 / voxels.len() as f64;
                    avg = avg.map(|v| v * w);
                }
                points.push(avg.map(|v| (v * voxel) as f32));
                point_offset += 1;
            }
            points
        })
        .collect();
    per_leaf.into_iter().flatten().collect()
}
