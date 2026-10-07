//! The rows a view holds: what the runtime sizes its rows by before it reads any page, bound
//! by the view, not by the world.
//!
//! After a frame, every cell the runtime holds has a box within the reach, widened by its keep
//! margin, of the eye. In the frame of the parent a box hangs under, that sphere lies in a cube
//! (`partition/sizing.ts` gives its side), and any cube of side `s` lies in one window of
//! side `1.5·s` whose corner is a multiple of `s/2` on every axis. The root lists, per mesh, the
//! most nodes the cells of one parent that meet one such window place — each cell counted whole —,
//! summed over the parents and never past every node, for a ladder of sides: the widest cell's
//! diagonal times `√2` to the powers `0..RUNGS`. The runtime reads the rung of the cube its view
//! needs; past the last one, every node.
use super::*;
use std::collections::HashMap;
use trillion3d_math::aabb::diagonal;

/// How many sides the ladder lists.
pub(crate) const RUNGS: usize = 32;

/// A cell's parts under one parent: its box there and the index of its record.
type Parts = Vec<(Box6, usize)>;

/// The nodes of each mesh a record places.
pub(crate) fn meshes_of(record: &Value) -> impl Iterator<Item = (u64, u64)> + '_ {
    let meshes = record["meshes"].as_array().into_iter().flatten();
    meshes.filter_map(|mesh| Some((mesh[0].as_u64()?, mesh[1].as_u64()?)))
}

/// The side of rung `rung` over the widest cell's diagonal `cube`.
pub(crate) fn rung_side(cube: f64, rung: usize) -> f64 {
    cube * 2f64.powf(rung as f64 / 2.0)
}

/// Per mesh, the most nodes the records of `parts` place that meet one window of side `1.5·side`
/// at a multiple of `side / 2`.
fn most_in_window(records: &[Value], parts: &Parts, side: f64) -> BTreeMap<u64, u64> {
    let step = side / 2.0;
    let mut windows = HashMap::<[i64; 3], BTreeMap<u64, u64>>::new();
    for (bounds, record) in parts {
        // A window at `o·step` meets the box when `o·step ≤ max` and `o·step + 1.5·side ≥ min`.
        let span = |axis: usize| {
            let low = ((bounds[axis] - 1.5 * side) / step).ceil() as i64;
            low..=(bounds[axis + 3] / step).floor() as i64
        };
        for x in span(0) {
            for y in span(1) {
                for z in span(2) {
                    let window = windows.entry([x, y, z]).or_default();
                    for (mesh, nodes) in meshes_of(&records[*record]) {
                        *window.entry(mesh).or_default() += nodes;
                    }
                }
            }
        }
    }
    let mut most = BTreeMap::<u64, u64>::new();
    for window in windows.values() {
        for (mesh, nodes) in window {
            let held = most.entry(*mesh).or_default();
            *held = (*held).max(*nodes);
        }
    }
    most
}

/// The widest cell's diagonal, as sixteen hexadecimal digits of its `f64` bits, and per mesh placed,
/// in rank order, its rank, how many nodes the cells place, then its rows at each rung, eight
/// hexadecimal digits each: fixed width, whatever the world.
pub(crate) fn view_rows(records: &[Value]) -> (String, Vec<String>) {
    let mut groups = BTreeMap::<Option<u64>, Parts>::new();
    let mut totals = BTreeMap::<u64, u64>::new();
    let mut cube = 0f64;
    for (at, record) in records.iter().enumerate() {
        for (mesh, nodes) in meshes_of(record) {
            *totals.entry(mesh).or_default() += nodes;
        }
        for part in record["parents"].as_array().into_iter().flatten() {
            let values = part[1].as_array().into_iter().flatten();
            let values: Vec<f64> = values.filter_map(Value::as_f64).collect();
            let Ok(bounds) = <Box6>::try_from(values) else {
                continue;
            };
            let [x0, y0, z0, x1, y1, z1] = bounds;
            cube = cube.max(diagonal([x0, y0, z0], [x1, y1, z1]));
            groups
                .entry(part[0].as_u64())
                .or_default()
                .push((bounds, at));
        }
    }
    if !(cube.is_finite() && cube > 0.0) {
        cube = 1.0; // points, or no box: any side holds them
    }
    let mut rungs = vec![BTreeMap::<u64, u64>::new(); RUNGS];
    for parts in groups.values() {
        let mut whole = BTreeMap::<u64, u64>::new();
        for (_, record) in parts {
            for (mesh, nodes) in meshes_of(&records[*record]) {
                *whole.entry(mesh).or_default() += nodes;
            }
        }
        // Once a window holds every cell of the parent, every wider one does.
        let mut full = false;
        for (rung, rows) in rungs.iter_mut().enumerate() {
            let most = if full {
                whole.clone()
            } else {
                most_in_window(records, parts, rung_side(cube, rung))
            };
            full = most == whole;
            for (mesh, nodes) in most {
                *rows.entry(mesh).or_default() += nodes;
            }
        }
    }
    let meshes = totals.iter().map(|(mesh, total)| {
        let mut entry = format!("{mesh:08x}{total:08x}");
        for rows in &rungs {
            let held = rows.get(mesh).copied().unwrap_or_default().min(*total);
            write!(entry, "{held:08x}").expect("a string takes any write");
        }
        entry
    });
    (format!("{:016x}", cube.to_bits()), meshes.collect())
}
