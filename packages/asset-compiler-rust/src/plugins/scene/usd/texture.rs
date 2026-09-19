//! A `UsdUVTexture` into a glTF texture.
//!
//! The driver decodes nothing itself: it names the image by its URI, relative to the root where
//! the compiler will reread those same bytes, and leaves the image registry to say whether this
//! format reads. A texture of a format outside the registry, missing, or that leaves the source
//! directory is counted in the report and the scene continues without it — never a compilation
//! failure.
use super::*;

/// Identifier of the texture node this driver reads.
const UV_TEXTURE: &str = "UsdUVTexture";
/// Coordinate set the intermediate scene carries: glTF receives only one here.
const UV_SET: &str = "st";
/// Pattern of a per-tile texture set, which names several files not one.
const UDIM: &str = "<UDIM>";

/// What a hung texture yields to the input that reads it: its glTF slot, and the factor glTF
/// carries in place of the texture node's `scale` — one for a missing `scale`.
pub(super) struct Bound {
    pub(super) value: Value,
    /// Unique factor that `scale` and `bias` fold into, `None` when they do not fit.
    scale: Option<f64>,
}

impl Bound {
    /// Factor to write where glTF has one; a `scale` that does not fold into it is counted.
    pub(super) fn factor(&self, world: &mut World<'_>) -> f64 {
        self.scale.unwrap_or_else(|| {
            world.refuse(world::TEXTURE_SCALE);
            1.0
        })
    }
    /// Slot alone, where glTF has no factor: a `scale` that is not one is counted.
    pub(super) fn plain(self, world: &mut World<'_>) -> Value {
        if self.scale != Some(1.0) {
            world.refuse(world::TEXTURE_SCALE);
        }
        self.value
    }
}

/// glTF texture this connection names. `colour` says the role of the input that reads it — a
/// colour or a datum — on which depends the colour space the file must carry.
pub(super) fn resolve(world: &mut World<'_>, target: &sdf::Path, colour: bool) -> Option<Bound> {
    let shader = world.stage.prim(target.prim_path()).ok()?;
    let id = read::first(&shader.attribute("info:id")).and_then(|(value, _)| read::text(&value));
    if id.as_deref() != Some(UV_TEXTURE) {
        world.refuse(world::TEXTURE_UNSUPPORTED);
        return None;
    }
    let (value, _) = read::first(&shader.attribute("inputs:file"))?;
    let file = read::asset(&value)?;
    if file.as_str().contains(UDIM) {
        world.refuse(world::TEXTURE_UNSUPPORTED);
        return None;
    }
    if uv_set(world, &shader).as_deref().unwrap_or(UV_SET) != UV_SET {
        world.refuse(world::TEXTURE_UNSUPPORTED);
    }
    let index = image(world, file)?;
    sampling::colour_space(world, &shader, colour);
    let sampler = sampling::sampler(world, &shader);
    Some(Bound {
        value: json!({ "index": world.scene.texture(index, sampler) }),
        scale: sampling::scale(&shader),
    })
}

/// Rank of the image, poured on first request, or `None` when the file does not read.
fn image(world: &mut World<'_>, file: &sdf::AssetPath) -> Option<usize> {
    let Some(relative) = under_root(world, file) else {
        world.refuse(world::TEXTURE_MISSING);
        return None;
    };
    let Some(mime) = crate::import::readable(world.images, &relative) else {
        world.refuse(world::TEXTURE_MISSING);
        world.scene.image_unreadable(&relative);
        return None;
    };
    Some(world.scene.image(relative, mime))
}

/// Path of the image under the root where the compiler will reread its bytes. An asset path
/// anchors on the layer that writes it — reference, sublayer or payload — and it is that
/// resolved path that comes back under the root: a layer stored in a subdirectory finds its
/// images there. Failing resolution, the written path is anchored on the root, as a lone layer
/// asks.
fn under_root(world: &World<'_>, asset: &sdf::AssetPath) -> Option<String> {
    let under = asset
        .resolved_path()
        .map(Path::new)
        .and_then(|path| path.strip_prefix(&world.root).ok())
        .map(|path| path.to_string_lossy().replace('\\', "/"));
    // A USD layer separates segments of an asset path by a slash, and only one: a backslash
    // belongs to the name there, it cuts nothing.
    crate::safe_relative(under.as_deref().unwrap_or(asset.as_str()), &['/'])
}

/// Coordinate set the primvar reader wired onto `inputs:st` names.
fn uv_set(world: &World<'_>, shader: &usd::Prim) -> Option<String> {
    let target = shader
        .attribute("inputs:st")
        .connections()
        .ok()?
        .into_iter()
        .next()?;
    let reader = world.stage.prim(target.prim_path()).ok()?;
    read::first(&reader.attribute("inputs:varname")).and_then(|(value, _)| read::text(&value))
}
