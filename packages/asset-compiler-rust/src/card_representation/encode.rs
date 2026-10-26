//! `meshCards.bin` and the manifest's `meshCards` section.
//!
//! Little-endian: a head (`MESH_CARDS_HEAD_BYTES`) — the magic, the version, the mesh count and the
//! card count —, a record per mesh (`MESH_CARDS_MESH_BYTES`): its compiled mesh — or, the cards of
//! an HLOD cell's actors, the cell —, its flags (`MESH_CARDS_FLAG_TWO_SIDED`: mostly two-sided,
//! `MESH_CARDS_FLAG_HLOD_CELL`: an HLOD cell's), the low and the high corner of the box the cards
//! were fitted in, in metres (six `f32`; the world's space for an HLOD cell's), then the rank of
//! its first card and how many it has (two `u32`). After the records, the cards of every mesh one
//! after the other (`MESH_CARDS_CARD_BYTES` each): the centre of the box in metres, its
//! half-extents in metres, its three axes (three `f32` each), and the direction it looks along
//! (`u32`, 0 to 5).
use super::abi::{
    MESH_CARDS_CARD_BYTES, MESH_CARDS_FILE, MESH_CARDS_FLAG_HLOD_CELL, MESH_CARDS_FLAG_TWO_SIDED,
    MESH_CARDS_HEAD_BYTES, MESH_CARDS_MAGIC, MESH_CARDS_MESH_BYTES, MESH_CARDS_VERSION,
};
use super::build::MeshCards;
use crate::distance_field::abi::DISTANCE_FIELD_UNITS_PER_METRE;
use crate::distance_field::Owner;
use crate::support::le::{f32_bytes, u32_bytes};
use serde_json::{json, Value};

/// A mesh's cards and what they stand for.
pub(crate) struct PlacedCards {
    pub owner: Owner,
    pub(super) cards: MeshCards,
}

impl PlacedCards {
    /// The cards of `owner`.
    pub(super) fn new(owner: Owner, cards: MeshCards) -> Self {
        Self { owner, cards }
    }

    /// The bytes the cards hold in memory.
    pub(crate) fn held_bytes(&self) -> usize {
        self.cards.cards.len() * size_of::<super::cards::Card>()
    }
}

/// `values`, centimetres, as the `f32` metres of the file.
fn metres(values: impl IntoIterator<Item = f64>) -> Vec<f32> {
    let to_metres = |v: f64| (v / DISTANCE_FIELD_UNITS_PER_METRE) as f32;
    values.into_iter().map(to_metres).collect()
}

/// The record's first word and its flag bit.
fn word_and_flag(owner: Owner) -> (u32, u32) {
    match owner {
        Owner::Mesh(mesh) => (mesh, 0),
        Owner::HlodCell(cell) => (cell, MESH_CARDS_FLAG_HLOD_CELL),
    }
}

/// The file holding `placed`.
pub(super) fn encode(placed: &[PlacedCards]) -> Vec<u8> {
    let total: usize = placed.iter().map(|p| p.cards.cards.len()).sum();
    let records = MESH_CARDS_HEAD_BYTES + placed.len() * MESH_CARDS_MESH_BYTES;
    let mut head = u32_bytes(&[
        MESH_CARDS_MAGIC,
        MESH_CARDS_VERSION,
        placed.len() as u32,
        total as u32,
    ]);
    head.reserve(records - head.len());
    let mut table = Vec::with_capacity(total * MESH_CARDS_CARD_BYTES);
    for one in placed {
        let cards = &one.cards;
        let (word, owner_flag) = word_and_flag(one.owner);
        let sided = u32::from(cards.mostly_two_sided) * MESH_CARDS_FLAG_TWO_SIDED;
        let first = table.len() / MESH_CARDS_CARD_BYTES;
        head.extend(u32_bytes(&[word, sided | owner_flag]));
        head.extend(f32_bytes(&metres(cards.low.into_iter().chain(cards.high))));
        head.extend(u32_bytes(&[first as u32, cards.cards.len() as u32]));
        for card in &cards.cards {
            let axes: Vec<f32> = card.axes.iter().flatten().map(|&c| c as f32).collect();
            table.extend(f32_bytes(&metres(
                card.origin.into_iter().chain(card.extent),
            )));
            table.extend(f32_bytes(&axes));
            table.extend(u32_bytes(&[card.direction as u32]));
        }
    }
    debug_assert_eq!(head.len(), records);
    head.extend(table);
    head
}

/// The manifest's `meshCards` section: the file's layout and totals, and every mesh's cards.
pub(super) fn report(placed: &[PlacedCards], bytes: usize) -> Value {
    let mesh = |one: &PlacedCards| {
        let (word, _) = word_and_flag(one.owner);
        let mut entry = json!({"mesh": word, "twoSided": one.cards.mostly_two_sided,
            "cards": one.cards.cards.len()});
        // The cards of an HLOD cell's actors name their cell (`mesh`) and say so.
        if matches!(one.owner, Owner::HlodCell(_)) {
            entry["hlodCell"] = json!(true);
        }
        entry
    };
    let cards: usize = placed.iter().map(|p| p.cards.cards.len()).sum();
    json!({"version": MESH_CARDS_VERSION, "file": MESH_CARDS_FILE, "bytes": bytes,
        "headBytes": MESH_CARDS_HEAD_BYTES, "meshBytes": MESH_CARDS_MESH_BYTES,
        "cardBytes": MESH_CARDS_CARD_BYTES, "cards": cards,
        "meshes": placed.iter().map(mesh).collect::<Vec<_>>()})
}
