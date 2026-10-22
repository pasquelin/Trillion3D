//! A job's mesh build settings as the compiler reads them (`meshBuildOptions.ts` writes them): for
//! each source mesh, the settings of `MESH_BUILD_SETTINGS` (`MeshBuild`) — whether its pages store
//! its tangents, the share of its triangles and the error its finest level is cut to
//! (`dag::Trim`), whether its near-collapsed triangles are dropped, the size it keeps resident
//! whatever the view (`root_page_count`), how its source is read (`dag::InputRules`): whether its
//! normals and its tangents are rebuilt, its tangents by the tangent spaces, its normals weighed
//! by area and angle, and the tolerances of its skinned weld, and the precisions of its pages' grid
//! (`Precision`): the cells of its positions, the bits of its normals and of its tangents' angle,
//! how its voxels are sampled when it is drawn as voxels far away (`voxels.rs`), how its distance
//! field is built (`distance_field.rs`), the displacement baked into its triangles
//! (`displacement.rs`), and whether
//! the assembly its `extras` name is built (`ALLOW_ASSEMBLIES_SETTING`, `source/assembly.rs`).
//! For each setting of a mesh, the first that names it:
//! 1. the first rule of `meshBuild.objects` whose match names one of its objects — a node of the
//!    mesh —, as `voxelize` names its objects;
//! 2. `meshBuild`'s own setting, the scene's;
//! 3. its own `extras` under the setting's name;
//! 4. the default, the reference's.
//!
//! A job naming no `meshBuild` compiles as before, its cache key unchanged. Read and checked here
//! once; what does not read is the job's refusal (`INVALID_OPTIONS`, `validate_compile_options`),
//! never the batch's — a mesh's `extras` setting that does not read included, when the meshes are
//! resolved.
use super::name_match::{present, read_rules, NameMatch, NodeNames};
use super::reader::Reader;
use super::*;
mod displacement;
mod distance_field;
mod voxels;
use displacement::NamedDisplacement;
use distance_field::NamedDistanceField;
use trillion3d_page_codec::bits::grid::Precision;
use trillion3d_page_codec::{
    MAX_NORMAL_PRECISION, MAX_POSITION_PRECISION, MAX_TANGENT_PRECISION, MIN_POSITION_PRECISION,
};
use voxels::NamedVoxels;

/// One mesh's build settings, every one resolved (`MeshBuildOptions::meshes`).
#[derive(Clone, Debug, PartialEq)]
pub(crate) struct MeshBuild {
    /// Whether its pages store the tangents its source carries (`STORED_TANGENTS_SETTING`).
    pub stored_tangents: bool,
    /// What its finest level keeps (`KEPT_TRIANGLES_SETTING`, `TRIMMED_ERROR_SETTING`).
    pub trim: crate::dag::Trim,
    /// Whether its build drops its near-collapsed triangles (`DROP_NEAR_COLLAPSED_SETTING`).
    pub drop_near_collapsed: bool,
    /// The root pages its pages keep at least, for the size it keeps resident whatever the view
    /// (`ALWAYS_RESIDENT_SETTING`, `root_page_count`).
    pub root_pages: usize,
    /// How its source is read (`RECOMPUTE_NORMALS_SETTING`, `RECOMPUTE_TANGENTS_SETTING`,
    /// `MIKK_TSPACE_SETTING`, `WEIGHTED_NORMALS_SETTING`, and the skinned weld's
    /// `SKINNED_WELD_POSITION_SETTING`, `SKINNED_WELD_NORMAL_SETTING`,
    /// `SKINNED_WELD_TEXTURE_SETTING`).
    pub input: crate::dag::InputRules,
    /// The precisions it names for its pages' grid, none where the format's or its density's
    /// serve (`POSITION_PRECISION_SETTING`, `NORMAL_PRECISION_SETTING`,
    /// `TANGENT_PRECISION_SETTING`).
    pub precision: Precision,
    /// How its voxels are sampled (`voxel::VoxelSettings`: `voxelRays`, `voxelLevel`,
    /// `voxelBackUp`, `voxelSeparable`, `voxelNdf`, `voxelOpacity`), read when it is voxelized.
    pub voxels: crate::voxel::VoxelSettings,
    /// How its distance field is built (`distance_field::DistanceFieldSettings`: `distanceField`,
    /// `distanceFieldScale`, `distanceFieldTwoSided`, `distanceFieldDensity`,
    /// `distanceFieldMaxResolution`).
    pub distance_field: crate::distance_field::DistanceFieldSettings,
    /// The displacement baked into its triangles (`displace::DisplacementSettings`:
    /// `displacementMaps`, `displacementUvChannel`, `displacementEdgeSplit`), none by default.
    pub displacement: crate::displace::DisplacementSettings,
    /// Whether the assembly its `extras` name is built (`ALLOW_ASSEMBLIES_SETTING`).
    pub allow_assemblies: bool,
}

/// The settings one source names, each none where it names none.
#[derive(Clone, Debug, Default)]
struct Named {
    stored_tangents: Option<bool>,
    kept_triangles: Option<f64>,
    trimmed_error: Option<f64>,
    drop_near_collapsed: Option<bool>,
    always_resident_kib: Option<u32>,
    recompute_normals: Option<bool>,
    recompute_tangents: Option<bool>,
    mikk_tangents: Option<bool>,
    weighted_normals: Option<bool>,
    weld_position: Option<f64>,
    weld_normal: Option<f64>,
    weld_texture: Option<f64>,
    position_precision: Option<i32>,
    normal_precision: Option<i32>,
    tangent_precision: Option<i32>,
    voxels: NamedVoxels,
    distance_field: NamedDistanceField,
    displacement: NamedDisplacement,
    allow_assemblies: Option<bool>,
}
impl Named {
    /// The settings of `MESH_BUILD_SETTINGS` `map` holds, its other keys read by others; `what`
    /// names where they were read, for the refusal of one that does not read.
    fn of(map: &Map<String, Value>, what: &str) -> Result<Self> {
        let read = Reader { map, what };
        // A whole number from `low` to `high`, a precision's bound.
        let precision = |key: &str, (low, high): (i32, i32)| {
            let takes = format!("a whole number from {low} to {high}");
            let named = read.whole(key, (i64::from(low), i64::from(high)), &takes);
            named.map(|n| n.map(|n| n as i32))
        };
        let (share, at_least_zero) = ((0.0, 1.0), (0.0, f64::INFINITY));
        let tolerance = |key: &str| read.number(key, at_least_zero, "a number of at least 0");
        // A whole number of KiB from 0 to `MAX_ALWAYS_RESIDENT_KIB`, a 32-bit word's.
        let takes = format!("a whole number from 0 to {MAX_ALWAYS_RESIDENT_KIB}");
        let kib = (0, i64::from(MAX_ALWAYS_RESIDENT_KIB));
        Ok(Self {
            stored_tangents: read.boolean(STORED_TANGENTS_SETTING)?,
            kept_triangles: read.number(KEPT_TRIANGLES_SETTING, share, "a number from 0 to 1")?,
            trimmed_error: tolerance(TRIMMED_ERROR_SETTING)?,
            drop_near_collapsed: read.boolean(DROP_NEAR_COLLAPSED_SETTING)?,
            always_resident_kib: (read.whole(ALWAYS_RESIDENT_SETTING, kib, &takes)?)
                .map(|n| n as u32),
            recompute_normals: read.boolean(RECOMPUTE_NORMALS_SETTING)?,
            recompute_tangents: read.boolean(RECOMPUTE_TANGENTS_SETTING)?,
            mikk_tangents: read.boolean(MIKK_TSPACE_SETTING)?,
            weighted_normals: read.boolean(WEIGHTED_NORMALS_SETTING)?,
            weld_position: tolerance(SKINNED_WELD_POSITION_SETTING)?,
            weld_normal: tolerance(SKINNED_WELD_NORMAL_SETTING)?,
            weld_texture: tolerance(SKINNED_WELD_TEXTURE_SETTING)?,
            position_precision: precision(
                POSITION_PRECISION_SETTING,
                (MIN_POSITION_PRECISION, MAX_POSITION_PRECISION),
            )?,
            normal_precision: precision(
                NORMAL_PRECISION_SETTING,
                (1, MAX_NORMAL_PRECISION as i32),
            )?,
            tangent_precision: precision(
                TANGENT_PRECISION_SETTING,
                (0, MAX_TANGENT_PRECISION as i32),
            )?,
            voxels: NamedVoxels::of(&read)?,
            distance_field: NamedDistanceField::of(&read)?,
            displacement: NamedDisplacement::of(&read)?,
            allow_assemblies: read.boolean(ALLOW_ASSEMBLIES_SETTING)?,
        })
    }

    /// These settings, each that names none taken from `lower`.
    fn or(self, lower: Self) -> Self {
        Self {
            stored_tangents: self.stored_tangents.or(lower.stored_tangents),
            kept_triangles: self.kept_triangles.or(lower.kept_triangles),
            trimmed_error: self.trimmed_error.or(lower.trimmed_error),
            drop_near_collapsed: self.drop_near_collapsed.or(lower.drop_near_collapsed),
            always_resident_kib: self.always_resident_kib.or(lower.always_resident_kib),
            recompute_normals: self.recompute_normals.or(lower.recompute_normals),
            recompute_tangents: self.recompute_tangents.or(lower.recompute_tangents),
            mikk_tangents: self.mikk_tangents.or(lower.mikk_tangents),
            weighted_normals: self.weighted_normals.or(lower.weighted_normals),
            weld_position: self.weld_position.or(lower.weld_position),
            weld_normal: self.weld_normal.or(lower.weld_normal),
            weld_texture: self.weld_texture.or(lower.weld_texture),
            position_precision: self.position_precision.or(lower.position_precision),
            normal_precision: self.normal_precision.or(lower.normal_precision),
            tangent_precision: self.tangent_precision.or(lower.tangent_precision),
            voxels: self.voxels.or(lower.voxels),
            distance_field: self.distance_field.or(lower.distance_field),
            displacement: self.displacement.or(lower.displacement),
            allow_assemblies: self.allow_assemblies.or(lower.allow_assemblies),
        }
    }

    /// Every setting, the default where none was named.
    fn resolved(self) -> MeshBuild {
        let kib = self
            .always_resident_kib
            .unwrap_or(DEFAULT_ALWAYS_RESIDENT_KIB);
        let input = crate::dag::InputRules::default();
        let weld = input.skinned_weld;
        let tolerance = |named: Option<f64>, default: f32| named.map_or(default, |t| t as f32);
        MeshBuild {
            stored_tangents: self.stored_tangents.unwrap_or(DEFAULT_STORED_TANGENTS),
            trim: crate::dag::Trim {
                kept_triangles: self.kept_triangles.unwrap_or(DEFAULT_KEPT_TRIANGLES) as f32,
                trimmed_error: self.trimmed_error.unwrap_or(DEFAULT_TRIMMED_ERROR) as f32,
            },
            drop_near_collapsed: self
                .drop_near_collapsed
                .unwrap_or(DEFAULT_DROP_NEAR_COLLAPSED),
            root_pages: crate::compiler::pages::bundles::root_page_count(kib),
            input: crate::dag::InputRules {
                recompute_normals: self.recompute_normals.unwrap_or(input.recompute_normals),
                recompute_tangents: self.recompute_tangents.unwrap_or(input.recompute_tangents),
                mikk_tangents: self.mikk_tangents.unwrap_or(input.mikk_tangents),
                weighted_normals: self.weighted_normals.unwrap_or(input.weighted_normals),
                skinned_weld: crate::dag::SkinnedWeld {
                    position: tolerance(self.weld_position, weld.position),
                    normal: tolerance(self.weld_normal, weld.normal),
                    texture: tolerance(self.weld_texture, weld.texture),
                },
            },
            precision: Precision {
                position: self.position_precision,
                normal: self.normal_precision,
                tangent: self.tangent_precision,
            },
            voxels: self.voxels.resolved(),
            distance_field: self.distance_field.resolved(),
            displacement: self.displacement.resolved(),
            allow_assemblies: self.allow_assemblies.unwrap_or(DEFAULT_ALLOW_ASSEMBLIES),
        }
    }
}

/// The build settings of `MESH_BUILD_SETTINGS` `map` names, the default where it names none —
/// an HLOD layer's `meshBuild` for its actors' meshes (`hlod/options/meshes.rs`) —; `what`
/// prefixes a key in the refusal of one that does not read.
pub(crate) fn mesh_build_of(map: &Map<String, Value>, what: &str) -> Result<MeshBuild> {
    Ok(Named::of(map, what)?.resolved())
}

/// A job's `meshBuild`: the scene's settings, the rules by object, and what named them, its cache
/// identity; none for none.
#[derive(Clone, Debug, Default)]
pub struct MeshBuildOptions {
    scene: Named,
    objects: Vec<(NameMatch, Named)>,
    identity: Option<Value>,
}

impl MeshBuildOptions {
    /// The settings the job's `meshBuild` field names, none for none; `Err` with the job's refusal
    /// when they do not read.
    pub fn read(value: Option<&Value>) -> std::result::Result<Self, String> {
        Self::parse(value).map_err(|e| e.message)
    }

    fn parse(value: Option<&Value>) -> Result<Self> {
        let Some(value) = present(value) else {
            return Ok(Self::default());
        };
        let settings: &[&str] = &MESH_BUILD_SETTINGS;
        let names = (MESH_BUILD_FIELD, settings, MESH_BUILD_OBJECTS);
        let (scene, objects) = read_rules(value, names, Named::of)?;
        Ok(Self {
            scene,
            objects,
            identity: Some(value.clone()),
        })
    }

    /// What named the settings, for the cache key: `None` when the job names none.
    pub fn identity(&self) -> Option<&Value> {
        self.identity.as_ref()
    }

    /// The build settings of each source mesh of `g`, by its rank, by the precedence the module
    /// states; `Err` when a mesh's own `extras` setting does not read.
    pub(crate) fn meshes(&self, g: &Value) -> Result<Vec<MeshBuild>> {
        let meshes = g.get("meshes").and_then(Value::as_array);
        let meshes = meshes.map_or(&[][..], Vec::as_slice);
        // The nodes drawing each mesh, in node order.
        let mut nodes_of = vec![Vec::new(); meshes.len()];
        let nodes = g.get("nodes").and_then(Value::as_array);
        for (node, declared) in nodes.into_iter().flatten().enumerate() {
            let mesh = declared.get("mesh").and_then(Value::as_u64);
            if let Some(drawn) = mesh.and_then(|m| nodes_of.get_mut(m as usize)) {
                drawn.push(node);
            }
        }
        (meshes.iter().zip(&nodes_of).enumerate())
            .map(|(rank, (mesh, nodes))| {
                // Without a rule no object is named: no node's names are read.
                let names: Vec<NodeNames> = match self.objects.is_empty() {
                    true => Vec::new(),
                    false => nodes.iter().map(|&n| NodeNames::of(g, n)).collect(),
                };
                let ruled = (self.objects.iter())
                    .filter(|(matcher, _)| names.iter().any(|n| matcher.matches(n)))
                    .fold(Named::default(), |named, (_, rule)| named.or(rule.clone()));
                let own = match mesh.get("extras").and_then(Value::as_object) {
                    Some(extras) if !extras.is_empty() => {
                        Named::of(extras, &format!("meshes[{rank}].extras."))?
                    }
                    _ => Named::default(),
                };
                Ok(ruled.or(self.scene.clone()).or(own).resolved())
            })
            .collect()
    }
}
