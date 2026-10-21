//! Each marked cell the surface does cross, its flags and its point slot, in two trees of the same
//! leaves and active voxels: the flags tree holds per cell its settled sign configuration, whether
//! its voxel lies inside and which of its three edges from the voxel the surface crosses; the slot
//! tree, `0` at each such cell for now, later its region (`merge`) and then its first point
//! (`points`), its background the empty slot `u32::MAX`.
use super::super::tree::{Leaf, Tree};
use super::cell::{corner_values, disambiguate, sign_bits};
use rayon::prelude::*;

/// The flags' sign configuration, settled across its ambiguous face (`cell::disambiguate`).
pub(super) const SIGN_MASK: u16 = 0xFF;
/// The flag of a cell whose voxel, its first corner, lies inside.
pub(super) const FIRST_INSIDE: u16 = 0x100;
/// Per axis, the flag of a cell whose edge from its voxel towards `+` along it crosses the surface.
pub(super) const CROSSES: [u16; 3] = [0x200, 0x400, 0x800];
/// Any of the three crossing flags.
pub(super) const ANY_CROSSING: u16 = 0xE00;

/// Per axis, the sign bit of the corner at the far end of the edge from a cell's voxel.
const FAR_CORNER: [u8; 3] = [0x02, 0x10, 0x08];

/// The flags tree and the slot tree of the cells `cells` marks that the `level` surface of `field`
/// crosses, a leaf each where one is crossed. The leaves are read in parallel and put in the
/// trees in order.
pub(super) fn flags(field: &Tree<f32>, cells: &Tree<()>, level: f32) -> (Tree<u16>, Tree<u32>) {
    let leaves: Vec<&Leaf<()>> = cells.leaves().collect();
    let made: Vec<Option<Leaf<u16>>> = leaves
        .par_iter()
        .map(|cells| leaf_flags(field, cells, level))
        .collect();
    let mut flag_tree = Tree::new(0);
    let mut slot_tree = Tree::new(u32::MAX);
    for leaf in made.into_iter().flatten() {
        let mut slots = Leaf::filled(leaf.origin, u32::MAX);
        for pos in leaf.active() {
            slots.set(pos, 0);
        }
        slot_tree.add(slots);
        flag_tree.add(leaf);
    }
    (flag_tree, slot_tree)
}

/// The flags of the marked cells of one leaf whose corners do not all lie on one side, none when
/// no cell is crossed. The crossing flags read the corners' signs before they are settled; the
/// settling flips every sign, which keeps each edge's crossing.
fn leaf_flags(field: &Tree<f32>, cells: &Leaf<()>, level: f32) -> Option<Leaf<u16>> {
    let source = field.leaf(cells.origin);
    let mut flags = Leaf::filled(cells.origin, 0);
    for pos in cells.active() {
        let c = cells.coord(pos);
        let signs = sign_bits(corner_values(field, source, c), level);
        if signs == 0 || signs == 0xFF {
            continue;
        }
        let inside = signs & 1 != 0;
        let mut flag = if inside { FIRST_INSIDE } else { 0 };
        for (&far, &crosses) in FAR_CORNER.iter().zip(&CROSSES) {
            if inside != (signs & far != 0) {
                flag |= crosses;
            }
        }
        flags.set(pos, flag | u16::from(disambiguate(signs, field, c, level)));
    }
    (!flags.inactive()).then_some(flags)
}
