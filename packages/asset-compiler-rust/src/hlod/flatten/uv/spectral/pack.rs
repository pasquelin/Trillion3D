//! The charts packed into the unit square, step for step as the library's packer lays them.
//!
//! 1. The input checked (`layout`, which runs the steps below); the charts found again as the
//!    groups of faces joined by the partition's adjacency, each with its own vertices (`charts`).
//! 2. Each chart turned to the least bounding box among the turns of 5° to 90°, its area and its
//!    boundary edges taken at 5 turns from 0° to 72°; the charts sorted by their longest side
//!    (`order`).
//! 3. The texel size estimated from a 60% coverage, lowered by 1% at a time until the longest
//!    chart fits; each chart rasterised into a grid of texels with its gutter grown around it
//!    (`board`).
//! 4. The longest chart placed in the middle of a board twice the atlas's size; each other chart,
//!    in each of its turns and four quarter turns, slid along the side of the board the aspect
//!    ratio asks for (a random side when the ratios are equal), and put where the atlas keeps the
//!    asked ratio best, then wastes least space (`place`, then copied onto the board by `commit`).
//! 5. When the board outgrows the atlas, the coverage is lowered and the layout restarted (with 30
//!    charts or more, at most 200 times); the layout is then scaled into the unit square
//!    (`scale`). The transforms are 4×4 matrices with the library's roundings (`matrix`).
use super::draw;
use matrix::Matrix;
use std::cell::Cell;

mod board;
mod charts;
mod commit;
mod layout;
mod matrix;
mod order;
mod place;
mod scale;

pub(crate) use layout::pack_charted;

/// The turns each chart is tried in.
const TURNS: usize = 5;
/// Below this many charts, a failed layout lowers the coverage by how far it overflowed.
const CHART_THRESHOLD: usize = 30;
/// The most restarts with many charts.
const MAX_ITERATION: i32 = 200;
/// The board is this many times the atlas's size, plus the gutters.
const BOARD_FACTOR: usize = 2;

/// The sides of a chart or of the board.
const UP: usize = 0;
const RIGHT: usize = 1;
const DOWN: usize = 2;
const LEFT: usize = 3;

/// A chart edge with its box.
#[derive(Clone, Copy)]
struct Segment {
    p1: [f32; 2],
    p2: [f32; 2],
    low: [f32; 2],
    high: [f32; 2],
}

/// A chart in one of its turns.
#[derive(Clone, Default)]
struct Turn {
    /// The texel corner the chart's transform is read from.
    base: [f32; 2],
    low: [f32; 2],
    high: [f32; 2],
    /// Its size in texels, gutters included.
    num_x: i32,
    num_y: i32,
    /// The shift that centres it in its texels.
    adjust: [f32; 2],
    angle: f32,
    edges: Vec<Segment>,
}

#[derive(Clone, Default)]
struct ChartInfo {
    longest: f32,
    valid: bool,
    area: f32,
    turns: Vec<Turn>,
}

/// A chart's faces and vertices in the packer's buffers.
struct Range {
    vertex_start: usize,
    vertex_count: usize,
    face_start: usize,
    face_count: usize,
}

/// The best placement found so far.
#[derive(Default)]
struct Tried {
    turn: usize,
    internal_space: i32,
    position: i32,
    overlap: i32,
    rotation: i32,
    side: usize,
    aspect: f32,
}

/// The packer's state.
struct Packer<'d> {
    draw: &'d Cell<u32>,
    width: usize,
    height: usize,
    gutter: i32,
    aspect: f32,
    /// Per face, the faces across its edges (chart order), and the faces' input vertices.
    adjacency: Vec<u32>,
    indices: Vec<u32>,
    /// Per input vertex, its packer vertex.
    local_of: Vec<u32>,
    uvs: Vec<[f32; 2]>,
    ranges: Vec<Range>,
    charts: Vec<ChartInfo>,
    sorted: Vec<u32>,
    matrices: Vec<Matrix>,
    total_area: f32,
    percent: f32,
    stop: bool,
    iterations: i32,
    out_of_range: bool,
    adjust_factor: f32,
    packed_area: f32,
    packed_charts: i32,
    pixel: f32,
    board_width: usize,
    board_height: usize,
    board: Vec<Vec<u8>>,
    chart_board: Vec<Vec<u8>>,
    tried_board: Vec<Vec<u8>>,
    space: [Vec<i32>; 4],
    chart_space: [Vec<i32>; 4],
    from: [i32; 2],
    to: [i32; 2],
    chart_from: [i32; 2],
    chart_to: [i32; 2],
    current_aspect: f32,
    current_turn: usize,
    tried: Tried,
    normalize_len: i32,
}

impl<'d> Packer<'d> {
    fn new(draw: &'d Cell<u32>, width: usize, height: usize, gutter: i32) -> Packer<'d> {
        Packer {
            draw,
            width,
            height,
            gutter,
            aspect: height as f32 / width as f32,
            adjacency: Vec::new(),
            indices: Vec::new(),
            local_of: Vec::new(),
            uvs: Vec::new(),
            ranges: Vec::new(),
            charts: Vec::new(),
            sorted: Vec::new(),
            matrices: Vec::new(),
            total_area: 0.0,
            percent: 0.0,
            stop: false,
            iterations: 0,
            out_of_range: false,
            adjust_factor: 0.0,
            packed_area: 0.0,
            packed_charts: 0,
            pixel: 0.0,
            board_width: 0,
            board_height: 0,
            board: Vec::new(),
            chart_board: Vec::new(),
            tried_board: Vec::new(),
            space: Default::default(),
            chart_space: Default::default(),
            from: [0; 2],
            to: [0; 2],
            chart_from: [0; 2],
            chart_to: [0; 2],
            current_aspect: 0.0,
            current_turn: 0,
            tried: Tried::default(),
            normalize_len: 0,
        }
    }

    /// The next draw of the shared generator.
    fn random(&self) -> i32 {
        draw::next(self.draw)
    }
}
