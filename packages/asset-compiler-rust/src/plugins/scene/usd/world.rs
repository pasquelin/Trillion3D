//! What a USD scene walk has at hand, and the names of everything it does not yield.
//!
//! None of these refusals is a compilation failure: a `PointInstancer` in the middle of a scene
//! must not prevent seeing its walls. They are counted, published in the manifest's
//! `unsupported`, and the report says how many times each was met. A scene that, after all
//! that, carries no visible surface is refused, itself, by `IMPORT_EMPTY`.
use super::*;

/// A `PointInstancer`: its instances are described by parallel arrays and an indexed prototype,
/// which this driver does not unfold.
pub(super) const POINT_INSTANCER: &str = "usd-point-instancer-unsupported";
/// A volume (`Volume`, OpenVDB or field3d fields): not a surface either.
pub(super) const VOLUME: &str = "usd-volume-unsupported";
/// A skeleton or skeleton animation (`SkelRoot`, `Skeleton`, `SkelAnimation`, `BlendShape`).
pub(super) const SKEL: &str = "usd-skel-unsupported";
/// A parametric surface this driver does not tile (`NurbsPatch`).
pub(super) const PATCH: &str = "usd-patch-unsupported";
/// A `Mesh` whose `subdivisionScheme` is not `none`: polygons are yielded **flat**, without the
/// requested subdivision, which changes the surface silhouette.
pub(super) const SUBDIVISION: &str = "usd-subdivision-unsupported";
/// A variant set is present: only the composition's default selection is read.
pub(super) const VARIANTS: &str = "usd-variants-unsupported";
/// A reference, payload or sublayer that composition did not resolve — the target file is
/// missing, unreadable, or the path does not resolve.
pub(super) const COMPOSITION: &str = "usd-composition-invalid";
/// An attribute read at its first time sample, for lack of a default value: the scene is frozen
/// on that value, no animation is carried.
pub(super) const TIME_SAMPLE: &str = "usd-animation-first-sample";
/// A face a `Mesh` declares and that its tables do not carry: an index outside the point table,
/// a negative index, fewer than three corners, or a primvar index that leaves its table. It is
/// removed from the surface rather than folded onto the first point.
pub(super) const FACE_INVALID: &str = "usd-face-invalid";
/// A face that `holeIndices` names: OpenUSD renders it invisible, whatever the subdivision
/// scheme. It is removed from emission rather than rendered solid, and this count says so.
pub(super) const FACE_HOLE: &str = "usd-face-hole";
/// A transform operation this driver does not compose (`!resetXformStack!`, inverse of a
/// matrix, operation of unknown type).
pub(super) const XFORM_UNSUPPORTED: &str = "usd-xform-unsupported";
/// A transform whose numbers are not finite: the node stays at identity.
pub(super) const XFORM_INVALID: &str = "usd-xform-invalid";
/// A `Material` without a `UsdPreviewSurface` reachable from `outputs:surface`.
pub(super) const SURFACE_UNSUPPORTED: &str = "usd-surface-unsupported";
/// An opacity carried by an image that the base colour does not carry: glTF reads alpha only in
/// `baseColorTexture`, and two distinct images do not fold into it without recomposing a third.
/// The material then keeps the written opacity, and nothing of the opacity image is poured.
pub(super) const OPACITY_TEXTURE: &str = "usd-opacity-texture-unsupported";
/// A texture `scale` or `bias` that a glTF factor does not carry: glTF multiplies its texture by
/// a factor and adds nothing, so a non-zero `bias`, a `scale` that differs from one colour
/// channel to another, or an alpha `scale` that is not one stay out of the scene.
pub(super) const TEXTURE_SCALE: &str = "usd-texture-scale-unsupported";
/// A `sourceColorSpace` contrary to the role of the input that reads the texture: a colour
/// declared `raw`, or a datum declared `sRGB`. Bytes pass as-is, none is re-encoded.
pub(super) const TEXTURE_COLOUR_SPACE: &str = "usd-texture-colour-space-unsupported";
/// A `UsdPreviewSurface` described by its specular workflow — `useSpecularWorkflow` or a
/// written specular colour: glTF metal and roughness do not carry it, and approximating it by
/// them would reinvent the surface.
pub(super) const SPECULAR_WORKFLOW: &str = "usd-specular-workflow-unsupported";
/// A clearcoat (`clearcoat` non-zero, with its roughness): base glTF has no such layer.
pub(super) const CLEARCOAT: &str = "usd-clearcoat-unsupported";
/// A normal written as a value, with no texture to carry it: glTF has no per-material constant
/// normal, and the surface keeps that of its geometry.
pub(super) const NORMAL_VALUE: &str = "usd-normal-value-unsupported";

/// What a walk has at hand: the scene under construction, the composed USD stage, and the root
/// where image URIs resolve.
pub(super) struct World<'a> {
    pub(super) stage: &'a usd::Stage,
    pub(super) scene: &'a mut SceneTables,
    /// Directory against which relative image URIs resolve, `scene::image_root`.
    pub(super) images: &'a Path,
    /// The same directory in its canonical form: composition resolves asset paths under that
    /// one, and it is the one that must be stripped to recover an image URI.
    pub(super) root: PathBuf,
    /// Materials already resolved, by prim path; `None` for an unreadable material.
    pub(super) materials: HashMap<String, Option<usize>>,
    /// Meshes already built, by (data path, bound materials): two instances of the same
    /// prototype with the same materials cite the same glTF mesh.
    pub(super) meshes: HashMap<(String, Vec<Option<usize>>), usize>,
    pub(super) cancelled: &'a AtomicBool,
    /// The metres a unit of the layer is worth (`layer::meters_per_unit`).
    pub(super) unit: f64,
    /// The width the groom declares on the top prim being walked (`curves::declared_width`).
    pub(super) root_width: Option<f32>,
}

impl World<'_> {
    /// Counts what the report publishes in the open.
    pub(super) fn count(&mut self, what: &'static str, by: usize) {
        self.scene.count(what, by);
    }
    /// The value of `prim`'s attribute `name` (`read::first`), one read at its first time sample
    /// counted (`TIME_SAMPLE`); `None` when the prim does not write it.
    pub(super) fn first(&mut self, prim: &usd::Prim, name: &str) -> Option<sdf::Value> {
        let (value, sampled) = read::first(&prim.attribute(name))?;
        if sampled {
            self.scene.report.add(TIME_SAMPLE);
        }
        Some(value)
    }
}

/// Named refusal a prim type this driver does not yield calls, and `None` for types it walks or
/// reads. An unknown type is not refused: it is walked as a group, which lets surfaces it
/// carries through instead of cutting a whole branch.
pub(super) fn refusal(type_name: &str) -> Option<&'static str> {
    Some(match type_name {
        "PointInstancer" => POINT_INSTANCER,
        "NurbsCurves" | "HermiteCurves" => crate::plugins::scene::codes::CURVES_UNSUPPORTED,
        "Volume" | "OpenVDBAsset" | "Field3DAsset" => VOLUME,
        "SkelRoot" | "Skeleton" | "SkelAnimation" | "BlendShape" => SKEL,
        "Camera" => crate::plugins::scene::codes::CAMERA_UNSUPPORTED,
        "NurbsPatch" => PATCH,
        _ => return None,
    })
}
