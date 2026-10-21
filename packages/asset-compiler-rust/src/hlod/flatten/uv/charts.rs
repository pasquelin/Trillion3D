//! Charts and their texture coordinates for the approximated shell, cut, flattened and packed step
//! for step as the chart generator below defines them, in single precision where it rounds in
//! single precision:
//!
//! 1. the source mesh (`groups::source_mesh`): the welded shell with each triangle turned, the
//!    degenerate faces set aside, the coincident vertices linked as colocals;
//! 2. the face groups (`groups::face_groups`), the faces joined across edges; each group meshed on
//!    its own (`groups::group_mesh`) and measured (`planar::Surface`);
//! 3. per group the charts: the planar regions bounded by right angles (`planar`), then the rest
//!    grown from seeds, relocated, grown again, the holes filled and the neighbours merged
//!    (`clustered`);
//! 4. per chart its texture coordinates (`chart`): the projection on its frame when good enough
//!    (`quality`), else its least-squares conformal map (`conformal`, solved by `solver`), else
//!    patches laid face by face (`piecewise`);
//! 5. the charts packed into one atlas (`pack`): scaled to a texel density for 1024², turned to
//!    their least-area boxes (`hull`), rasterized (`raster`), grown for bilinear filtering and
//!    placed where they overlap nothing (`pack::place`), largest first.
//!
//! The groups and the charts of a group are built in parallel, each from its own inputs only, and
//! kept in order, so the result is the same whatever the order they finish in; the packing runs
//! in order, its random draws seeded once.
//!
//! The port follows its sources' quirks where they decide the result: a chart's validity is tested
//! on the frame it had before the face that joins it; a patch candidate's side is read at the
//! patch face's corner of the same rank; the boundary grid keeps the cells an edge was first
//! listed in. Three guards stand where the sources read out of bounds or loop forever, on input no
//! finite mesh gives: a hull of fewer than two points or of no finite order is the points
//! themselves, a hull turn of NaN keeps its point, a polygon clipped against a texel keeps at most
//! fifteen corners.
//!
//! The algorithm and its constants are ported from xatlas, which carries this notice:
//!
//! ```text
//! MIT License
//!
//! Copyright (c) 2018-2020 Jonathan Young
//!
//! Permission is hereby granted, free of charge, to any person obtaining a copy
//! of this software and associated documentation files (the "Software"), to deal
//! in the Software without restriction, including without limitation the rights
//! to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
//! copies of the Software, and to permit persons to whom the Software is
//! furnished to do so, subject to the following conditions:
//!
//! The above copyright notice and this permission notice shall be included in all
//! copies or substantial portions of the Software.
//!
//! THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
//! IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
//! FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
//! AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
//! LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
//! OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
//! SOFTWARE.
//! ```
//!
//! Its segmentation, parameterization and packing derive from thekla_atlas:
//!
//! ```text
//! thekla_atlas
//! https://github.com/Thekla/thekla_atlas
//! MIT License
//! Copyright (c) 2013 Thekla, Inc
//! Copyright NVIDIA Corporation 2006 -- Ignacio Castano <icastano@nvidia.com>
//! ```
//!
//! The sparse least-squares solver (`solver`) derives from OpenNL, which carries this notice
//! (ported to Rust by the Trillion3D contributors on 2026-10-20 for the approximated shell's
//! texture coordinates):
//!
//! ```text
//! Copyright (c) 2004-2010, Bruno Levy
//! All rights reserved.
//!
//! Redistribution and use in source and binary forms, with or without
//! modification, are permitted provided that the following conditions are met:
//!
//! * Redistributions of source code must retain the above copyright notice,
//! this list of conditions and the following disclaimer.
//! * Redistributions in binary form must reproduce the above copyright notice,
//! this list of conditions and the following disclaimer in the documentation
//! and/or other materials provided with the distribution.
//! * Neither the name of the ALICE Project-Team nor the names of its
//! contributors may be used to endorse or promote products derived from this
//! software without specific prior written permission.
//!
//! THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
//! AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
//! IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE
//! ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE
//! LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR
//! CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF
//! SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS
//! INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN
//! CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE)
//! ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE
//! POSSIBILITY OF SUCH DAMAGE.
//!
//! If you modify this software, you should include a notice giving the
//! name of the person performing the modification, the date of modification,
//! and the reason for such modification.
//!
//! Contact: Bruno Levy
//!
//!    levy@loria.fr
//!
//!    ALICE Project
//!    LORIA, INRIA Lorraine,
//!    Campus Scientifique, BP 239
//!    54506 VANDOEUVRE LES NANCY CEDEX
//!    FRANCE
//! ```
use super::Topology;
use rayon::prelude::*;
use trillion3d_math::geometry::triangle::edge_key;
use trillion3d_math::join::{Join, LeastRoot};
use trillion3d_page_codec::encode::vertices::first_use;
use trillion3d_page_codec::hash::{word_map, WordMap};

mod chart;
mod clustered;
mod conformal;
mod fit;
mod grid;
mod groups;
mod hull;
mod mesh;
mod pack;
mod piecewise;
mod planar;
mod quality;
mod raster;
mod solver;
mod vector;

use chart::{build_charts, UvChart};
use groups::{face_groups, source_mesh};
use mesh::{TriMesh, NONE};
use vector::most;

/// The builder's corner of each caller corner: every triangle is turned, its first two corners
/// swapped.
const TURN: [usize; 3] = [1, 0, 2];

/// Per corner of `topology`'s triangles (`t · 3 + k`, in their own corner order), its texture
/// coordinates in `[0, 1]²` — each axis over the atlas's side on that axis, all at the origin when
/// no chart was packed —, and the islands to repack: the triangles joined through shared texture
/// vertices across a shared edge (a chart's, in practice), a set-aside triangle (at the origin)
/// alone, each island its triangles in order, the islands by their first triangle.
pub(crate) fn charts(topology: &Topology) -> (Vec<[f64; 2]>, Vec<Vec<usize>>) {
    let source = source_mesh(topology);
    let groups: Vec<Vec<UvChart>> = (face_groups(&source).par_iter())
        .map(|faces| build_charts(&source, faces))
        .collect();
    let mut charts: Vec<UvChart> = groups.into_iter().flatten().collect();
    let (width, height) = pack::pack(&mut charts);
    let corner_count = source.indices.len();
    let mut vertex_of = vec![NONE; corner_count];
    let mut uv_of = vec![[0.0f32; 2]; corner_count];
    // The set-aside triangles' vertices numbered in order of first use, ahead of the charts'.
    let set_aside: Vec<usize> = (0..source.face_count())
        .filter(|&face| source.is_ignored(face))
        .flat_map(|face| face * 3..face * 3 + 3)
        .collect();
    let (distinct, ranks) = first_use(set_aside.iter().map(|&corner| source.indices[corner]));
    for (&corner, &rank) in set_aside.iter().zip(&ranks) {
        vertex_of[corner] = rank as usize;
    }
    let mut first = distinct.len();
    for chart in &charts {
        for (f, &face) in chart.faces.iter().enumerate() {
            for k in 0..3 {
                let vertex = chart.corners[f * 3 + k] as usize;
                let uv = chart.mesh.texcoords[chart.unified[vertex]];
                vertex_of[face * 3 + k] = first + vertex;
                uv_of[face * 3 + k] = [most(0.0, uv[0]), most(0.0, uv[1])];
            }
        }
        first += chart.unified.len();
    }
    // An atlas that packed no chart, every triangle set aside, has no side to divide by: its
    // corners, all at the origin, stay there.
    let (width, height) = (f64::from(width.max(1)), f64::from(height.max(1)));
    let corners = (0..corner_count)
        .map(|corner| {
            let [u, v] = uv_of[corner / 3 * 3 + TURN[corner % 3]];
            [f64::from(u) / width, f64::from(v) / height]
        })
        .collect();
    (corners, islands(&source, &vertex_of))
}

/// The triangles joined across every edge whose two texture vertices they share, set-aside
/// triangles alone.
fn islands(source: &TriMesh, vertex_of: &[usize]) -> Vec<Vec<usize>> {
    let face_count = source.face_count();
    let mut join = Join::<LeastRoot>::new(face_count);
    // Per texture edge, the first triangle along it; there are no more texture vertices than
    // corners, so each fits a word.
    let mut sides: WordMap<u64, usize> = word_map(source.indices.len());
    for face in (0..face_count).filter(|&face| !source.is_ignored(face)) {
        for k in 0..3 {
            let (a, b) = (vertex_of[face * 3 + k], vertex_of[face * 3 + (k + 1) % 3]);
            let other = *sides.entry(edge_key(a as u32, b as u32)).or_insert(face);
            join.unite(other as u32, face as u32);
        }
    }
    (join.groups().into_iter())
        .map(|island| island.into_iter().map(|face| face as usize).collect())
        .collect()
}
