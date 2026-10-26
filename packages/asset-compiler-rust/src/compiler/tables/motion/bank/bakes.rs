//! The bakes the banks hold: a skin as they read it, a (skin, clip) sampled into a bake, and each
//! bake kept once in the file whatever the objects playing it.
//!
//! A skin is read with the nodes its joints are posed through, its joints, and its inverse binds,
//! identities when it declares none (`Skin`). Its bake playing a clip holds, joint by joint, the
//! three rows of its inverse bind's affine part, then, frame by frame and joint by joint, the
//! translation and the rotation quaternion of the joint's transform in the frame's space
//! (`poses.rs`). Each of those transforms must be rigid — its linear part's columns orthonormal
//! within `RIGID_TOLERANCE`, its determinant positive —, or the bake is refused with why and the
//! object left to its host's skeleton (`bake`). Two bakes of the same joints, frames, rate and
//! float bits — the crowds made of copied skins — are one (`Bakes`).
use super::poses::{each_frame, translation};
use super::*;
use crate::compiler::source::node_transform::Mat4;
use crate::compiler::tables::motion::frame::Chain;
use crate::compiler::tables::motion::sample::Clip;
use trillion3d_math::geometry::aabb::{extend_flat, EMPTY_FLAT};
use trillion3d_math::matrix::linear::{determinant, linear_columns};
use trillion3d_math::matrix::rotation::rotation_quaternion;
use trillion3d_math::matrix::{IDENTITY, MATRIX_VALUES};
use trillion3d_math::quaternion::normalize;
use trillion3d_math::vector::vecn::dot;

/// The most a joint transform's columns may stray from unit length and from square to one another,
/// as dot products, for it to be rigid.
const RIGID_TOLERANCE: f64 = 1e-3;

/// A skin as its bakes read it: the nodes its joints are posed through, its joints, and its
/// inverse binds — sixteen floats a joint, column-major —, none for identities.
pub(super) struct Skin {
    pub(super) chain: Chain,
    pub(super) joints: BTreeSet<usize>,
    inverse: Option<Vec<f32>>,
}

impl Skin {
    /// Skin `skin` of `g`, its chain under `parents`.
    pub(super) fn read(
        g: &Value,
        bin: &[u8],
        parents: &[Option<usize>],
        skin: usize,
    ) -> Result<Self> {
        let declared = item(values(g, "skins")?, skin, "skin")?;
        let joints = super::joints(declared, parents.len())?;
        let inverse = super::inverse_binds(g, bin, declared, joints.len())?;
        Ok(Self {
            chain: Chain::of(parents, &joints),
            joints: joints.into_iter().collect(),
            inverse,
        })
    }
}

/// The file's bakes, each once, and the rank of each by the digest of its content.
#[derive(Default)]
pub(super) struct Bakes {
    pub(super) list: Vec<Bake>,
    seen: BTreeMap<[u8; 32], usize>,
}

impl Bakes {
    /// The rank of `bake`: the one of the same joints, frames, rate and float bits already held,
    /// else a new one.
    pub(super) fn rank(&mut self, bake: Bake) -> usize {
        let counts = [bake.joints, bake.frames].map(|count| count as u64);
        let mut bytes = Vec::with_capacity(24 + 4 * bake.floats.len());
        bytes.extend(counts.iter().flat_map(|count| count.to_le_bytes()));
        bytes.extend(bake.rate.to_le_bytes());
        bytes.extend(bake.floats.iter().flat_map(|float| float.to_le_bytes()));
        *self.seen.entry(digest_bytes(&bytes)).or_insert_with(|| {
            self.list.push(bake);
            self.list.len() - 1
        })
    }
}

/// Whether `m`'s linear part is a rotation: its columns of unit length and square to one another
/// within `RIGID_TOLERANCE`, its determinant positive.
fn rigid(m: &Mat4) -> bool {
    let columns = linear_columns(m);
    let orthonormal = (0..3).all(|i| {
        (i..3).all(|j| {
            let unit = if i == j { 1.0 } else { 0.0 };
            (dot(columns[i], columns[j]) - unit).abs() <= RIGID_TOLERANCE
        })
    });
    orthonormal && determinant(m) > 0.0
}

/// The bake of `skin` playing `clip`, and the box of its keys' translations; `Err` with why when a
/// joint's transform is not rigid.
pub(super) fn bake(
    nodes: &[Value],
    skin: &Skin,
    clip: &Clip,
) -> Result<std::result::Result<(Bake, [f64; 6]), String>> {
    let (joints, frames) = (skin.chain.joints.len(), clip.frames());
    let keys = frames * ANIMATION_BANK_KEY_FLOATS;
    let mut floats = Vec::with_capacity(joints * (ANIMATION_BANK_INVERSE_FLOATS + keys));
    for joint in 0..joints {
        let column_major: [f32; MATRIX_VALUES] = match &skin.inverse {
            Some(matrices) => std::array::from_fn(|at| matrices[joint * MATRIX_VALUES + at]),
            None => IDENTITY.map(|value| value as f32),
        };
        // The three rows of its affine part.
        for row in 0..3 {
            floats.extend((0..4).map(|column| column_major[column * 4 + row]));
        }
    }
    let mut reach = EMPTY_FLAT;
    let mut scales = None;
    each_frame(nodes, &skin.chain, clip, |posed| {
        for (joint, m) in posed.iter().enumerate() {
            if scales.is_none() && !rigid(m) {
                scales = Some(joint);
            }
            let moved = translation(m);
            extend_flat(&mut reach, moved);
            let mut turned = rotation_quaternion(linear_columns(m));
            normalize(&mut turned);
            floats.extend(moved.into_iter().chain(turned).map(|value| value as f32));
        }
    })?;
    if let Some(joint) = scales {
        let node = skin.chain.nodes[skin.chain.joints[joint]].0;
        return Ok(Err(format!(
            "its skeleton scales: joint node {node} is not rigid"
        )));
    }
    let bake = Bake {
        joints,
        frames,
        rate: clip.rate,
        floats,
    };
    Ok(Ok((bake, reach)))
}
