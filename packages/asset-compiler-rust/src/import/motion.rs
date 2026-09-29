//! FBX skin (all bones), inverse binds, blend-shape keys and source-key clips (#357).
//! The intermediate graph is flat; nodes and animation keys therefore use world poses.
use super::*;
/// First skin and full-weight blend shapes, indexed by source vertex.
pub(super) struct MeshDeform<'a> {
    skin: Option<&'a ufbx::SkinDeformer>,
    width: usize,
    pub(super) channels: Vec<(&'a ufbx::BlendChannel, usize)>,
    shapes: Vec<(&'a ufbx::BlendShape, HashMap<u32, usize>)>,
}

impl<'a> MeshDeform<'a> {
    pub(super) fn of(mesh: &'a ufbx::Mesh) -> Self {
        let (mut channels, mut shapes) = (Vec::new(), Vec::new());
        for deformer in mesh.blend_deformers.iter() {
            for channel in deformer.channels.iter() {
                for (key, frame) in channel.keyframes.iter().enumerate() {
                    let shape = &*frame.shape;
                    let ranks = shape.offset_vertices.iter().enumerate();
                    shapes.push((shape, ranks.map(|(i, &v)| (v, i)).collect()));
                    channels.push((&**channel, key));
                }
            }
        }
        let skin = mesh.skin_deformers.first().map(|skin| &**skin);
        let width = skin.map_or(0, |skin| {
            skin.vertices
                .iter()
                .map(|v| v.num_weights as usize)
                .max()
                .unwrap_or(0)
                .max(1)
                .div_ceil(4)
                * 4
        });
        Self {
            skin,
            width,
            channels,
            shapes,
        }
    }
    pub(super) fn weights(&self) -> Vec<f64> {
        self.channels
            .iter()
            .map(|(channel, key)| channel.keyframes[*key].effective_weight)
            .collect()
    }

    pub(super) fn deformed(&self) -> bool {
        self.skin.is_some() || !self.shapes.is_empty()
    }
    /// All source bones and weights, padded to the mesh width; never ranked or pruned.
    pub(super) fn influences(&self, vertex: usize) -> Option<(Vec<u16>, Vec<f32>)> {
        let skin = self.skin?;
        let at = skin.vertices.get(vertex)?;
        let width = self.width;
        let (mut joints, mut weights) = (vec![0u16; width], vec![0f32; width]);
        for j in 0..at.num_weights as usize {
            let value = &skin.weights[at.weight_begin as usize + j];
            joints[j] = u16::try_from(value.cluster_index).expect("FBX joint exceeds format range");
            weights[j] = value.weight as f32;
        }
        Some((joints, weights))
    }
    /// Position and normal offsets shape `target` gives `vertex`, zero where it gives none.
    pub(super) fn offset(&self, target: usize, vertex: u32) -> [f32; 6] {
        let (shape, ranks) = &self.shapes[target];
        let Some(&rank) = ranks.get(&vertex) else {
            return [0.0; 6];
        };
        let p = shape.position_offsets[rank];
        let n = shape.normal_offsets.get(rank).copied().unwrap_or_default();
        [p.x, p.y, p.z, n.x, n.y, n.z].map(|v| v as f32)
    }

    pub(super) fn targets(&self) -> usize {
        self.shapes.len()
    }
    /// Whether a target carries normal offsets at all.
    pub(super) fn bends(&self, target: usize) -> bool {
        !self.shapes[target].0.normal_offsets.is_empty()
    }
}

/// A node the scene wrote from the file: its rank among the file's nodes, its glTF rank, whether
/// it is placed by its geometry (a mesh) rather than its own frame (a bone), and the blend
/// channels its mesh plays.
pub(super) struct Written<'a> {
    pub(super) typed: usize,
    pub(super) node: usize,
    pub(super) geometry: bool,
    pub(super) pose: bool,
    pub(super) channels: Vec<(&'a ufbx::BlendChannel, usize)>,
}

/// A world matrix as the TRS a glTF node an animation drives must carry.
pub(super) fn trs(matrix: &ufbx::Matrix) -> [Vec<f64>; 3] {
    let t = ufbx::matrix_to_transform(matrix);
    let (p, r, s) = (t.translation, t.rotation, t.scale);
    [
        vec![p.x, p.y, p.z],
        vec![r.x, r.y, r.z, r.w],
        vec![s.x, s.y, s.z],
    ]
}

impl Importer<'_> {
    /// The glTF node of `bone`, written once per file, posed in the world where the file stands it.
    fn bone(&mut self, bone: &ufbx::Node, bones: &mut HashMap<u32, usize>) -> usize {
        *bones.entry(bone.element.typed_id).or_insert_with(|| {
            let [translation, rotation, scale] = trs(&bone.node_to_world);
            self.nodes.push(
                json!({"name": &*bone.element.name, "translation": translation,
                "rotation": rotation, "scale": scale}),
            );
            self.nodes.len() - 1
        })
    }

    /// The glTF skin of `skin`, written once per file: its bones and their inverse bind matrices.
    pub(super) fn skin(
        &mut self,
        skin: &ufbx::SkinDeformer,
        bones: &mut HashMap<u32, usize>,
        skins: &mut HashMap<u32, usize>,
    ) -> usize {
        if let Some(&rank) = skins.get(&skin.element.element_id) {
            return rank;
        }
        let mut joints = Vec::with_capacity(skin.clusters.len());
        let mut matrices = Vec::with_capacity(skin.clusters.len() * 16);
        for cluster in skin.clusters.iter() {
            joints.push(match cluster.bone_node.as_ref() {
                Some(bone) => json!(self.bone(bone, bones)),
                None => json!(self.bone_less()),
            });
            matrices.extend(
                matrix_json(&cluster.geometry_to_bone)
                    .iter()
                    .map(|v| *v as f32),
            );
        }
        let view = self.bin.view(&f32_bytes(&matrices), None);
        self.accessors.push(
            json!({"bufferView":view,"componentType":5126,"count":joints.len(),"type":"MAT4"}),
        );
        let accessor = self.accessors.len() - 1;
        self.skins
            .push(json!({"joints": joints, "inverseBindMatrices": accessor}));
        skins.insert(skin.element.element_id, self.skins.len() - 1);
        self.skins.len() - 1
    }

    /// Bind skin and animation targets: bones place skins; otherwise tracks place the mesh.
    pub(super) fn bend<'a>(
        &mut self,
        node: &ufbx::Node,
        mesh: &'a ufbx::Mesh,
        placed: usize,
        (bones, skins): (&mut HashMap<u32, usize>, &mut HashMap<u32, usize>),
        written: &mut Vec<Written<'a>>,
    ) {
        let deform = MeshDeform::of(mesh);
        let skinned = mesh
            .skin_deformers
            .first()
            .map(|skin| self.skin(skin, bones, skins));
        if let Some(skin) = skinned {
            self.nodes[placed]["skin"] = json!(skin);
        }
        if skinned.is_none() || !deform.channels.is_empty() {
            let typed = node.element.typed_id as usize;
            let (geometry, channels) = (skinned.is_none(), deform.channels);
            written.push(Written {
                typed,
                node: placed,
                geometry,
                pose: skinned.is_none(),
                channels,
            });
        }
    }

    /// An origin joint leaves unbound vertices where their bind matrix places them.
    fn bone_less(&mut self) -> usize {
        self.nodes.push(json!({"name": ""}));
        self.nodes.len() - 1
    }
}

#[path = "motion_clips.rs"]
mod clips;
#[path = "motion_contract.rs"]
pub(super) mod contract;
#[path = "motion_sampling.rs"]
mod sampling;
