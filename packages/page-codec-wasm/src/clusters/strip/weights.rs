//! The window's scores a strip weighs its triangles by, and how a triangle's case picks its row.
//!
//! The table holds sixteen rows, one per case of a triangle: whether it starts a strip, and
//! whether its neighbours across its corner's own edge, the edge of the corner after it and the
//! edge of the corner before it are still to lay. Each row holds one score per place among the
//! last `WINDOW` laid vertices, the most recent first. A laying sums, in the row of the triangle's
//! case (`row`), the scores of the places its three vertices lie at, a vertex never laid or out of
//! the window scoring nothing; the strip starts and grows where that sum is greatest.
use super::WINDOW;

/// The row of `WEIGHTS` of a triangle that starts a strip or not, by whether its neighbours across
/// its corner's own edge, the edge of the corner after it and the edge of the corner before it are
/// still to lay.
pub(super) fn row(start: bool, opposite: bool, left: bool, right: bool) -> usize {
    usize::from(start) << 3
        | usize::from(opposite) << 2
        | usize::from(left) << 1
        | usize::from(right)
}

/// The window's scores, by row (`row`: a triangle starting a strip, its neighbours across its
/// corner's own edge, the edge of the corner after and the edge of the corner before still to lay)
/// and by how far back among the laid vertices the vertex lies.
#[rustfmt::skip]
pub(super) static WEIGHTS: [[i32; WINDOW as usize]; 16] = [
    // starts no, opposite no, left no, right no
    [
        142, 124, 131, 184, 138, 149, 148, 127,
        154, 148, 152, 133, 133, 132, 170, 141,
        109, 148, 138, 117, 126, 112, 144, 126,
        116, 139, 122, 141, 122, 133, 134, 137,
    ],
    // starts no, opposite no, left no, right yes
    [
        128, 144, 134, 122, 130, 133, 129, 122,
        128, 107, 127, 126, 89, 135, 88, 130,
        94, 134, 103, 118, 128, 96, 90, 139,
        89, 139, 113, 100, 119, 131, 113, 121,
    ],
    // starts no, opposite no, left yes, right no
    [
        128, 144, 134, 129, 110, 142, 111, 140,
        116, 139, 98, 110, 125, 143, 122, 109,
        127, 154, 113, 119, 126, 131, 123, 127,
        93, 118, 101, 93, 131, 139, 130, 139,
    ],
    // starts no, opposite no, left yes, right yes
    [
        120, 128, 137, 105, 113, 121, 120, 120,
        112, 117, 124, 129, 129, 98, 137, 133,
        122, 159, 141, 104, 129, 119, 98, 111,
        110, 115, 114, 125, 115, 140, 109, 137,
    ],
    // starts no, opposite yes, left no, right no
    [
        128, 137, 154, 169, 140, 162, 156, 157,
        164, 144, 171, 145, 148, 146, 124, 138,
        144, 158, 140, 137, 141, 145, 140, 148,
        110, 160, 128, 129, 144, 155, 125, 123,
    ],
    // starts no, opposite yes, left no, right yes
    [
        124, 115, 136, 131, 145, 143, 159, 144,
        158, 165, 128, 191, 135, 173, 147, 137,
        128, 163, 164, 151, 162, 178, 161, 143,
        168, 166, 122, 160, 170, 175, 132, 109,
    ],
    // starts no, opposite yes, left yes, right no
    [
        134, 112, 132, 123, 126, 138, 148, 138,
        145, 136, 146, 133, 141, 165, 139, 145,
        119, 167, 135, 120, 146, 120, 117, 136,
        102, 156, 128, 120, 132, 143, 91, 136,
    ],
    // starts no, opposite yes, left yes, right yes
    [
        140, 95, 118, 117, 127, 102, 119, 119,
        134, 107, 135, 128, 109, 133, 120, 122,
        132, 150, 152, 119, 128, 137, 119, 128,
        131, 165, 156, 143, 135, 134, 135, 154,
    ],
    // starts yes, opposite no, left no, right no
    [
        139, 132, 139, 133, 130, 134, 135, 131,
        133, 139, 141, 139, 132, 136, 139, 150,
        140, 137, 143, 157, 149, 157, 168, 155,
        159, 181, 176, 185, 219, 167, 133, 143,
    ],
    // starts yes, opposite no, left no, right yes
    [
        125, 127, 126, 131, 128, 114, 130, 126,
        129, 131, 125, 127, 131, 126, 137, 129,
        140, 99, 142, 99, 149, 121, 155, 118,
        131, 156, 168, 144, 175, 155, 112, 129,
    ],
    // starts yes, opposite no, left yes, right no
    [
        129, 129, 128, 128, 128, 129, 128, 129,
        130, 127, 131, 130, 131, 130, 134, 133,
        136, 134, 134, 138, 144, 139, 137, 154,
        147, 141, 175, 214, 140, 140, 130, 122,
    ],
    // starts yes, opposite no, left yes, right yes
    [
        128, 128, 124, 123, 125, 107, 127, 128,
        125, 128, 128, 128, 128, 128, 128, 130,
        107, 124, 136, 119, 139, 127, 132, 140,
        125, 150, 133, 150, 138, 130, 127, 127,
    ],
    // starts yes, opposite yes, left no, right no
    [
        104, 125, 126, 129, 126, 122, 128, 126,
        126, 127, 125, 122, 130, 126, 130, 131,
        130, 132, 118, 101, 119, 121, 143, 114,
        122, 145, 132, 144, 116, 142, 114, 127,
    ],
    // starts yes, opposite yes, left no, right yes
    [
        128, 124, 93, 126, 108, 128, 127, 122,
        128, 126, 128, 123, 92, 125, 98, 99,
        127, 131, 126, 128, 121, 133, 113, 121,
        122, 137, 145, 138, 137, 109, 129, 100,
    ],
    // starts yes, opposite yes, left yes, right no
    [
        119, 128, 122, 128, 127, 123, 126, 128,
        126, 122, 120, 127, 128, 122, 130, 121,
        138, 122, 136, 130, 133, 124, 139, 134,
        138, 118, 139, 145, 132, 122, 124, 86,
    ],
    // starts yes, opposite yes, left yes, right yes
    [
        116, 124, 119, 126, 118, 113, 114, 125,
        128, 111, 129, 122, 129, 129, 135, 130,
        138, 132, 115, 138, 114, 119, 122, 136,
        138, 128, 141, 119, 139, 119, 130, 128,
    ],
];
