//! The nodes each cell file places, and what the compile warns of them.

use super::*;

/// The published nodes each cell file places, by file rank — an animated object of the core its
/// cell draws among them —; each file's HLOD 0 cell — none for objects in no layer —, and the whole
/// chain of HLOD cells, those first (`hlod/cells.rs`): what the world's HLOD layers are built over
/// (`hlod/chain.rs`). `banked`, the instanced skinned objects the cells place, each with its
/// item and skin frame: their rows play their track; one marked `hlodInstance` stands above. With
/// them, the compile's warnings: each placed node whose mark won over a rule naming another
/// layer — its node, the mark's layer and the rule's (`Assigned`) —; each node marked that no HLOD
/// takes — it moves, itself or through a node above it, or is not spatially loaded or in a batch
/// with one that is not, hidden, held whole by no cell below a grid's top, or turned away by its
/// layer's size filter —; each node its settings make an instanced skinned object that stays a
/// plain skinned one, with why (`bank_warnings`: the bake's refusals, `Banks::refused`, then the
/// partition's); and each batch root whose `runtimeGrid` no grid bears (`unknown_grids`).
#[derive(Default)]
pub(crate) struct CellMembers {
    pub nodes: Vec<Vec<usize>>,
    pub hlod: Vec<Option<usize>>,
    pub tree: Vec<HlodNode>,
    pub banked: BTreeMap<usize, (usize, Option<usize>)>,
    pub overruled: Vec<(usize, usize, usize)>,
    pub unplaced: Vec<usize>,
    pub bank_warnings: Vec<(usize, String)>,
    pub unknown_grids: Vec<(usize, String)>,
}
