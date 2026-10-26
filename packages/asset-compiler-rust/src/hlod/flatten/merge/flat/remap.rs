//! The flattened mesh laid into its atlas: the coordinates each entry's mesh is baked and laid at
//! (`Laid`), each part's moved into its entry's cell (`remapped`), and which atlas texels the
//! cells hold (`occupancy`).
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

/// The texture coordinates each entry's mesh is baked and laid at, three to a triangle.
pub(super) enum Laid {
    /// Each mesh laid on its own, from its first part, in the mesh's own corner order: an entry
    /// takes its mesh's, its corners turned where its parts mirror the mesh (`oriented`).
    PerMesh(BTreeMap<usize, Vec<[[f64; 2]; 3]>>),
    /// Each entry's, every entry laid together (`global`), in the entry's own corner order.
    PerEntry(Vec<Vec<[[f64; 2]; 3]>>),
}

/// The coordinates one entry's triangles are laid at, in the order of its parts' triangles.
pub(super) struct EntryCoordinates<'a> {
    set: &'a [[[f64; 2]; 3]],
    mirrored: bool,
}

impl EntryCoordinates<'_> {
    /// The triangles' coordinates in order, their corners turned where the entry's parts mirror
    /// their mesh (`oriented`).
    pub(super) fn iter(&self) -> impl Iterator<Item = [[f64; 2]; 3]> + '_ {
        self.set.iter().map(|&t| oriented(t, self.mirrored))
    }
}

impl Laid {
    /// The coordinates of entry `entry`, baked on the mesh `mesh` that its parts `mirrored` or not.
    pub(super) fn of_entry(
        &self,
        entry: usize,
        mesh: usize,
        mirrored: bool,
    ) -> EntryCoordinates<'_> {
        match self {
            Self::PerMesh(laid) => EntryCoordinates {
                set: &laid[&mesh],
                mirrored,
            },
            Self::PerEntry(laid) => EntryCoordinates {
                set: &laid[entry],
                mirrored: false,
            },
        }
    }
}

/// The merged mesh of `parts`, each part's texture coordinates in its entry's cell: on a quad its
/// own first set, on its mesh the coordinates generated for it (`laid`), its vertices split where
/// two of its corners take two; each moved by its cell, `uv · scale + offset`, a cell of no scale
/// leaving them as they are, as does no cell at all, where the entries share the atlas.
pub(super) fn remapped(
    parts: &[&Part],
    (grounds, entry_of): (&[Ground], &[usize]),
    (laid, cells): (&Laid, Option<&[Cell]>),
) -> Flat {
    let mut flat = Flat {
        positions: Vec::new(),
        normals: Vec::new(),
        uvs: Vec::new(),
        tangents: Vec::new(),
        colours: Vec::new(),
        indices: Vec::new(),
    };
    for ((part, &ground), &entry) in parts.iter().zip(grounds).zip(entry_of) {
        let cell = cells.map(|cells| cells[entry]);
        let moved = |uv: [f64; 2]| match cell {
            Some(Cell { offset, scale, .. }) if scale != [0.0; 2] => {
                [0, 1].map(|k| uv[k] * scale[k] + offset[k])
            }
            _ => uv,
        };
        let (positions, _, indices) = &part.geometry;
        let normals = part.normals();
        let base = (flat.positions.len() / 3) as u32;
        match ground {
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
                let coordinates = laid.of_entry(entry, mesh, mirrored);
                let keys: Vec<(u32, [u64; 2])> = (indices.as_chunks::<3>().0.iter())
                    .zip(coordinates.iter())
                    .flat_map(|(&t, uv)| [0, 1, 2].map(|k| (t[k], uv[k].map(f64::to_bits))))
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

#[cfg(test)]
mod tests {
    use super::*;

    const SET: [[f64; 2]; 3] = [[0.1, 0.2], [0.3, 0.4], [0.5, 0.6]];

    /// A part of one triangle over `positions`.
    fn triangle(mirrored: bool) -> Part {
        Part {
            material: None,
            mesh: 7,
            mirrored,
            geometry: (
                vec![0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0, 0.0],
                Vec::new(),
                vec![0, 1, 2],
            ),
        }
    }

    #[test]
    fn an_entry_takes_its_meshs_coordinates_turned_or_its_own_as_they_are() {
        let per_mesh = Laid::PerMesh(BTreeMap::from([(7, vec![SET])]));
        let turned: Vec<_> = per_mesh.of_entry(3, 7, true).iter().collect();
        assert_eq!(turned, [[SET[0], SET[2], SET[1]]]);
        let per_entry = Laid::PerEntry(vec![vec![], vec![], vec![], vec![SET]]);
        // Entry 3's own, in its parts' order: the mesh and the turn name nothing.
        let own: Vec<_> = per_entry.of_entry(3, 99, true).iter().collect();
        assert_eq!(own, [SET]);
    }

    #[test]
    fn entries_sharing_the_atlas_keep_the_coordinates_as_laid_and_cells_move_them() {
        let part = triangle(false);
        let parts = [&part];
        let at = (&[Ground::Mesh(7, false)][..], &[0][..]);
        let laid = Laid::PerEntry(vec![vec![SET]]);
        let none = remapped(&parts, at, (&laid, None));
        let expected: Vec<f32> = SET.iter().flatten().map(|&x| x as f32).collect();
        assert_eq!(none.uvs, expected);
        let cell = Cell {
            at: [0, 0],
            size: [1, 1],
            offset: [0.25, 0.5],
            scale: [0.5, 0.5],
        };
        let moved = remapped(&parts, at, (&laid, Some(&[cell][..])));
        let expected: Vec<f32> = SET
            .iter()
            .flat_map(|uv| [uv[0] * 0.5 + 0.25, uv[1] * 0.5 + 0.5])
            .map(|x| x as f32)
            .collect();
        assert_eq!(moved.uvs, expected);
    }
}
