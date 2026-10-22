//! Step 4 of the build's input (`input.rs`): a colour white at every vertex the triangles read
//! dropped, as a mesh build lays no colour then; every value held within its range, then
//! corrected as a solve corrects the vertices it places; and, once the DAG is built, every vertex
//! the pages read held within its range again (`held`), the vertices the solves placed with them.
//!
//! **Ranges.** A position coordinate is held within ±`MOST_COORDINATE`, not a number reading 0; a
//! normal or a stored tangent's direction with a coordinate past ±`MOST_VALUE`, or not a number, is
//! up or +X (`UP`, `FORWARD`), and the tangent's sign is −1 when negative, else 1; a colour channel
//! is held within [0, 1], not a number reading 1; a texture coordinate within ±`MOST_VALUE`, a
//! bone's joint and weight within [0, `MOST_VALUE`], not a number reading 0.
//!
//! **Correction** (`simplify::Corrected`): every normal made unit, every stored tangent made unit
//! across it with its sign `±1`, every colour clamped to [0, 1].
use super::{Built, FORWARD, UP};
use crate::dag::{DagAttributes, Grown};
use crate::simplify::{Attribute as Weighed, Corrected, Role};
use trillion3d_page_codec::encode::Attribute;
use trillion3d_page_codec::{
    FLAG_COLOR, FLAG_NORMAL, FLAG_SKIN, FLAG_TANGENT, FLAG_UV, FLAG_UV1, FLAG_UV2, FLAG_UV3,
};

/// The largest position coordinate the build keeps, in metres: ten million kilometres.
const MOST_COORDINATE: f32 = 1e10;
/// The largest value of a normal, a tangent, a texture coordinate or a bone the build keeps.
const MOST_VALUE: f32 = 1e12;

/// `x` held within `[low, high]`, `default` when it is not a number.
fn within_or(x: f32, (low, high): (f32, f32), default: f32) -> f32 {
    if x >= low && x <= high {
        x
    } else if x < low {
        low
    } else if x > high {
        high
    } else {
        default
    }
}

/// Whether every float of `v` lies within ±`MOST_VALUE`; not a number does not.
fn within(v: &[f32]) -> bool {
    v.iter().all(|x| (-MOST_VALUE..=MOST_VALUE).contains(x))
}

/// The arrays the build reads: the `built` vertices, which the welded triangles `indices` read,
/// without a colour white at every one of them, held within their ranges and corrected (the
/// module's rules); `None` when that changes nothing of the `source` positions and attributes, so
/// the build reads the source's own arrays.
pub(in crate::dag) fn finished(
    built: Built,
    indices: &[u32],
    (positions, attributes): (&[f32], DagAttributes),
) -> Option<Grown> {
    let Built {
        positions: mut kept,
        mut carried,
        origin,
        ..
    } = built;
    // White: every byte 255, a three-wide colour's alpha 255 by its absence.
    let white = |a: &Attribute| {
        let at = |v: u32| &a.values[v as usize * a.width..][..a.width];
        indices.iter().all(|&v| at(v).iter().all(|&c| c == 1.0))
    };
    carried.retain(|a| a.flag != FLAG_COLOR || !white(a));
    hold(&mut kept, &mut carried);
    correct(&mut carried, kept.len() / 3);
    let same = |a: &[f32], b: &[f32]| {
        a.len() == b.len() && a.iter().zip(b).all(|(x, y)| x.to_bits() == y.to_bits())
    };
    let unchanged = same(&kept, positions)
        && carried.len() == attributes.carried.len()
        && (carried.iter().zip(attributes.carried)).all(|(a, b)| same(&a.values, &b.values));
    (!unchanged).then_some(Grown {
        positions: kept,
        carried,
        origin,
    })
}

/// Every vertex of `grown`'s arrays, which the pages read, held within its range (the module's
/// rules); none when they are the source's own, already within it.
pub(in crate::dag) fn held(grown: &mut Option<Grown>) {
    if let Some(grown) = grown {
        hold(&mut grown.positions, &mut grown.carried);
    }
}

/// `positions` and every vertex of `carried` held within their ranges (the module's rules).
fn hold(positions: &mut [f32], carried: &mut [Attribute]) {
    let coordinate = (-MOST_COORDINATE, MOST_COORDINATE);
    (positions.iter_mut()).for_each(|x| *x = within_or(*x, coordinate, 0.0));
    for a in carried {
        let (flag, range) = (a.flag, (-MOST_VALUE, MOST_VALUE));
        for v in a.values.chunks_exact_mut(a.width) {
            match flag {
                FLAG_NORMAL if !within(v) => v.copy_from_slice(&UP),
                FLAG_TANGENT => {
                    if !within(&v[..3]) {
                        v[..3].copy_from_slice(&FORWARD);
                    }
                    v[3] = if v[3] < 0.0 { -1.0 } else { 1.0 };
                }
                FLAG_COLOR => v
                    .iter_mut()
                    .for_each(|c| *c = within_or(*c, (0.0, 1.0), 1.0)),
                FLAG_UV | FLAG_UV1 | FLAG_UV2 | FLAG_UV3 => {
                    v.iter_mut().for_each(|c| *c = within_or(*c, range, 0.0))
                }
                FLAG_SKIN => v
                    .iter_mut()
                    .for_each(|c| *c = within_or(*c, (0.0, range.1), 0.0)),
                _ => {}
            }
        }
    }
}

/// Corrects the `vertices` of `carried` as a solve corrects the vertices it places
/// (`simplify::Corrected`).
fn correct(carried: &mut [Attribute], vertices: usize) {
    // The corrected attributes, each in a row of its own floats, in the simplifier's order.
    let roles = [
        (FLAG_NORMAL, Role::Normal),
        (FLAG_TANGENT, Role::Tangent),
        (FLAG_COLOR, Role::Color),
    ];
    let owners: Vec<(usize, Role)> = (roles.iter())
        .filter_map(|&(flag, role)| Some((carried.iter().position(|a| a.flag == flag)?, role)))
        .collect();
    let rows: Vec<Weighed> = (owners.iter())
        .map(|&(o, role)| Weighed {
            values: &[],
            width: carried[o].width,
            weight: 0.0,
            role,
        })
        .collect();
    let rule = Corrected::of(&rows);
    if !rule.any() {
        return;
    }
    let owners: Vec<usize> = owners.iter().map(|&(o, _)| o).collect();
    let stride: usize = rows.iter().map(|a| a.width).sum();
    let mut row = vec![0.0_f32; stride];
    for v in 0..vertices {
        let mut at = 0;
        for &o in &owners {
            let width = carried[o].width;
            row[at..at + width].copy_from_slice(&carried[o].values[v * width..][..width]);
            at += width;
        }
        rule.apply(&mut row);
        let mut at = 0;
        for &o in &owners {
            let width = carried[o].width;
            carried[o].values[v * width..][..width].copy_from_slice(&row[at..at + width]);
            at += width;
        }
    }
}
