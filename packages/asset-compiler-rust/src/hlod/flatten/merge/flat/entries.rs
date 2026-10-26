//! What the entries of a merged layer are: each part's ground, the entries the parts make, and
//! where each entry's images go in the atlas (`cells_of`).
use super::ground::Ground;
use super::Flattening;
use crate::hlod::flatten::merge::grid::{binned, grid, Cell};
use crate::hlod::flatten::merge::Part;
use crate::hlod::flatten::Library;
use std::collections::BTreeMap;

/// Each entry's share of a binned atlas: its material's largest texture in texels — at least
/// 64 × 64 —, over the sum of every entry's.
pub(super) fn weights(materials: &[Option<u64>], library: &Library) -> Vec<f64> {
    let largest = |material: Option<u64>| {
        let surface = library.surface(material);
        [
            &surface.colour,
            &surface.metal_rough,
            &surface.occlusion,
            &surface.normal_map,
        ]
        .into_iter()
        .flatten()
        .map(|texels| {
            let (width, height, _) = texels.levels()[0];
            (width * height) as f64
        })
        .fold(64.0 * 64.0, f64::max)
    };
    let sizes: Vec<f64> = materials.iter().map(|&m| largest(m)).collect();
    let total: f64 = sizes.iter().sum();
    sizes.iter().map(|s| s / total).collect()
}

/// An entry: its material, what it is baked on, and its first part's rank.
pub(super) type Entry = (Option<u64>, Ground, usize);

/// What each part is baked on: its mesh when the layer lays its meshes out `together` (`global`),
/// or sees it through (`seen`), or bakes on meshes and `reads_mesh` says the part's look is its
/// mesh's; else a quad.
pub(super) fn grounds_of(
    parts: &[&Part],
    seen: &[bool],
    (together, reads_mesh): (bool, impl Fn(&Part) -> bool),
) -> Vec<Ground> {
    (parts.iter().zip(seen))
        .map(|(p, &through)| match together || through || reads_mesh(p) {
            true => Ground::Mesh(p.mesh, p.mirrored),
            false => Ground::Quad,
        })
        .collect()
}

/// The entries in the order the parts first name them, each with its first part, and each part's
/// entry.
pub(super) fn entries_of(parts: &[&Part], grounds: &[Ground]) -> (Vec<Entry>, Vec<usize>) {
    let mut entries: Vec<Entry> = Vec::new();
    let mut ranks: BTreeMap<(Option<u64>, Ground), usize> = BTreeMap::new();
    let entry_of = (parts.iter().zip(grounds).enumerate())
        .map(|(k, (part, &ground))| {
            *ranks.entry((part.material, ground)).or_insert_with(|| {
                entries.push((part.material, ground, k));
                entries.len() - 1
            })
        })
        .collect();
    (entries, entry_of)
}

/// Where each entry's images go in the atlas: a cell each, a grid's or binned (`binByTextureSize`,
/// by `weights` of the entries' materials); none where the entries are laid out `together`
/// (`global`) and share the whole atlas, their coordinates left as they are.
pub(super) fn cells_of(
    entries: &[Entry],
    flattening: &Flattening,
    (together, weights): (bool, impl FnOnce(&[Option<u64>]) -> Vec<f64>),
) -> Option<Vec<Cell>> {
    if together {
        return None;
    }
    let side = flattening.side;
    let materials: Vec<Option<u64>> = entries.iter().map(|&(m, ..)| m).collect();
    Some(match flattening.binned {
        true => binned(&weights(&materials), side, flattening.gutter),
        false => grid(entries.len(), side, flattening.gutter),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::hlod::flatten::bake::Maps;
    use crate::hlod::flatten::Sides;
    use crate::hlod::options::HlodUvMethod;

    fn part(material: Option<u64>, mesh: usize, mirrored: bool) -> Part {
        Part {
            material,
            mesh,
            mirrored,
            geometry: (Vec::new(), Vec::new(), Vec::new()),
        }
    }

    fn flattening(reuse: bool) -> Flattening {
        Flattening {
            side: 64,
            sides: Sides::uniform(64),
            gutter: 2,
            binned: false,
            on_mesh: true,
            lightmaps: (reuse, HlodUvMethod::Patches),
            double_sided: true,
            maps: Maps::default(),
        }
    }

    #[test]
    fn a_material_on_two_meshes_and_a_mirrored_copy_are_distinct_entries_in_the_order_met() {
        let parts = [
            part(Some(0), 0, false),
            part(Some(0), 1, false),
            part(Some(0), 0, false),
            part(Some(0), 0, true),
            part(Some(1), 0, false),
        ];
        let refs: Vec<&Part> = parts.iter().collect();
        let grounds: Vec<Ground> = (refs.iter())
            .map(|p| Ground::Mesh(p.mesh, p.mirrored))
            .collect();
        let (entries, entry_of) = entries_of(&refs, &grounds);
        // Entries are (material, mesh, mirrored); the third part is the first's again.
        assert_eq!(entry_of, [0, 1, 0, 2, 3]);
        let firsts: Vec<usize> = entries.iter().map(|&(.., first)| first).collect();
        assert_eq!(firsts, [0, 1, 3, 4]);
    }

    #[test]
    fn entries_laid_out_together_have_no_cells_and_the_others_a_grid() {
        let entries = [(None, Ground::Quad, 0)];
        let flat = flattening(true);
        let none = |_: &[Option<u64>]| -> Vec<f64> { unreachable!("not binned") };
        assert!(cells_of(&entries, &flat, (true, none)).is_none());
        let cells = cells_of(&entries, &flat, (false, none)).expect("cells");
        assert_eq!(cells.len(), 1);
        // The one cell fills the atlas less its gutter.
        assert_eq!(cells[0].size, [60, 60]);
    }

    #[test]
    fn a_part_is_baked_on_its_mesh_when_laid_out_together_seen_through_or_read_from_it() {
        let parts = [part(None, 3, false), part(None, 4, true)];
        let refs: Vec<&Part> = parts.iter().collect();
        let seen = [false, false];
        let quad = [Ground::Quad, Ground::Quad];
        let meshes = [Ground::Mesh(3, false), Ground::Mesh(4, true)];
        assert_eq!(grounds_of(&refs, &seen, (false, |_| false)), quad);
        // Together, every part is on its mesh whatever its look reads; seen through, so is the one.
        assert_eq!(grounds_of(&refs, &seen, (true, |_| false)), meshes);
        assert_eq!(
            grounds_of(&refs, &[true, false], (false, |_| false)),
            [Ground::Mesh(3, false), Ground::Quad]
        );
        assert_eq!(
            grounds_of(&refs, &seen, (false, |p| p.mesh == 4)),
            [Ground::Quad, meshes[1]]
        );
    }
}
