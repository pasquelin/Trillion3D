//! The flattened mesh laid into its atlas: each part's texture coordinates moved into its entry's
//! cell (`remapped`), and which atlas texels the cells hold (`occupancy`).
use super::ground::{oriented, Ground};
use crate::hlod::flatten::first_seen::first_seen;
use crate::hlod::flatten::merge::grid::Cell;
use crate::hlod::flatten::merge::Part;
use crate::hlod::flatten::uv::raster::{EMPTY, SAMPLED};
use crate::hlod::flatten::Flat;
use std::collections::BTreeMap;
use trillion3d_page_codec::FLAG_UV;

/// Each atlas texel inside an entry's cell, `SAMPLED`, the others — gutters and empty cells —
/// `EMPTY`: what the tone of the cells and of the whole atlas read (`appearance::tone`).
pub(super) fn occupancy(cells: &[Cell], side: usize) -> Vec<u32> {
    let mut occupancy = vec![EMPTY; side * side];
    for cell in cells {
        let [x0, y0] = cell.at.map(|a| a.clamp(0, side as i64) as usize);
        let [x1, y1] = [0, 1].map(|k| (cell.at[k] + cell.size[k].max(0)).clamp(0, side as i64));
        for y in y0..y1 as usize {
            occupancy[y * side + x0..y * side + x1 as usize].fill(SAMPLED);
        }
    }
    occupancy
}

/// Each mesh's texture coordinates as generated for it, three to a triangle.
type LaidCoordinates = BTreeMap<usize, Vec<[[f64; 2]; 3]>>;

/// The merged mesh of `parts`, each part's texture coordinates in its entry's cell: on a quad its
/// own first set, on its mesh the coordinates generated for it (`laid`), its vertices split where
/// two of its corners take two; each moved by its cell, `uv · scale + offset`, a cell of no scale
/// leaving them as they are.
pub(super) fn remapped(
    parts: &[&Part],
    (grounds, entry_of): (&[Ground], &[usize]),
    (laid, cells): (&LaidCoordinates, &[Cell]),
) -> Flat {
    let mut flat = Flat {
        positions: Vec::new(),
        normals: Vec::new(),
        uvs: Vec::new(),
        tangents: Vec::new(),
        colours: Vec::new(),
        indices: Vec::new(),
    };
    for ((part, ground), &entry) in parts.iter().zip(grounds).zip(entry_of) {
        let Cell { offset, scale, .. } = cells[entry];
        let moved = |uv: [f64; 2]| match scale == [0.0; 2] {
            true => uv,
            false => [0, 1].map(|k| uv[k] * scale[k] + offset[k]),
        };
        let (positions, _, indices) = &part.geometry;
        let normals = part.normals();
        let base = (flat.positions.len() / 3) as u32;
        match *ground {
            Ground::Quad => {
                let own = part.carried(FLAG_UV);
                flat.positions.extend_from_slice(positions);
                flat.normals.extend_from_slice(&normals);
                for v in 0..positions.len() / 3 {
                    let uv = own.map_or([0.0; 2], |uv| [0, 1].map(|k| f64::from(uv[v * 2 + k])));
                    flat.uvs.extend(moved(uv).map(|x| x as f32));
                }
                flat.indices.extend(indices.iter().map(|&v| v + base));
            }
            Ground::Mesh(mesh, mirrored) => {
                // Each corner's vertex and coordinates, numbered as the corners first name them.
                let keys: Vec<(u32, [u64; 2])> = (indices.as_chunks::<3>().0.iter())
                    .zip(&laid[&mesh])
                    .flat_map(|(&t, &uv)| {
                        let uv = oriented(uv, mirrored);
                        [0, 1, 2].map(|k| (t[k], uv[k].map(f64::to_bits)))
                    })
                    .collect();
                let (vertices, ranks) = first_seen(keys);
                for (v, uv) in vertices {
                    let v = v as usize;
                    flat.positions
                        .extend_from_slice(&positions[v * 3..v * 3 + 3]);
                    flat.normals.extend_from_slice(&normals[v * 3..v * 3 + 3]);
                    flat.uvs
                        .extend(moved(uv.map(f64::from_bits)).map(|x| x as f32));
                }
                flat.indices.extend(ranks.iter().map(|&r| r + base));
            }
        }
    }
    flat
}
