//! Walking the file's objects, and what it pours into the glTF tables.
//!
//! Each mesh-type `OB` block becomes a node; each `ME` block a glTF mesh, poured once — several
//! objects that share a mesh share the same one, and differ only by their matrix. A mesh's
//! materials are those of its slots; an object that replaces one is counted on the report, the
//! driver following the mesh. Everything that is not rendered is counted, never silenced.
use super::*;
use trillion3d_math::matrix::linear::uniform_scale;

/// What the walk has at hand.
pub(super) struct Scene<'a> {
    pub(super) out: Out,
    pub(super) images: Images,
    /// The glTF rank of a material, by the address of its block.
    pub(super) materials: HashMap<u64, Option<usize>>,
    /// The glTF rank of a mesh, by the address of its block.
    pub(super) meshes: HashMap<u64, Option<usize>>,
    pub(super) root: &'a Path,
    pub(super) cancelled: &'a AtomicBool,
}

/// The name of an identified block, without the two genre letters Blender prefixes it with.
fn short(view: &At<'_>, fallback: &str) -> String {
    let name = view.id_name();
    let trimmed = name.get(2..).unwrap_or_default();
    if trimmed.is_empty() {
        return fallback.to_string();
    }
    trimmed.to_string()
}

impl Scene<'_> {
    /// An object: its mesh if it holds one, and what is not rendered, counted.
    pub(super) fn object(&mut self, object: &At<'_>) -> Result<()> {
        if object.pointer("instance_collection") != 0 || object.pointer("dup_group") != 0 {
            self.out
                .scene
                .report
                .add("blend-collection-instance-unsupported");
        }
        let kind = object.int("type", -1);
        if kind == light::OB_LAMP {
            self.light(object);
            return Ok(());
        }
        if kind != object::OB_MESH {
            self.out.scene.count("nonMeshObjects", 1);
            return Ok(());
        }
        if !object.list("modifiers").is_empty() {
            self.out.scene.report.add("blend-modifier-not-applied");
        }
        let Some(mesh) = object
            .follow("data")
            .filter(|data| data.layout.name == "Mesh")
        else {
            self.out.scene.report.add("blend-mesh-missing");
            return Ok(());
        };
        let Some(index) = self.mesh(&mesh)? else {
            return Ok(());
        };
        if self.overridden(object) {
            self.out
                .scene
                .report
                .add("blend-object-material-override-unconverted");
        }
        let node = json!({
            "name": short(object, "Object"), "mesh": index,
            "matrix": object::world(object),
        });
        self.under_root(node);
        self.out.scene.count("meshInstances", 1);
        Ok(())
    }

    /// The lamp of a lamp-type object: one more node under the root, at the object's matrix.
    /// Blender orients its lamps toward their `-Z`, like glTF: nothing to rotate.
    fn light(&mut self, object: &At<'_>) {
        let matrix = object::world(object);
        let scale = uniform_scale(&matrix.map(f64::from));
        let name = short(object, "Light");
        let Some(light) = light::build(object.follow("data"), name.clone(), scale, &mut self.out)
        else {
            return;
        };
        self.under_root(crate::plugins::scene::convert::light_node(
            &name,
            json!(matrix),
            light,
        ));
    }

    /// Adds `node` to the scene, one more child of the root.
    fn under_root(&mut self, node: Value) {
        let rank = self.out.scene.node(node);
        if let Some(children) = self.out.scene.nodes[0]["children"].as_array_mut() {
            children.push(json!(rank));
        }
    }

    /// The glTF mesh of an `ME` block, poured on first request.
    fn mesh(&mut self, mesh: &At<'_>) -> Result<Option<usize>> {
        if let Some(known) = self.meshes.get(&mesh.old) {
            return Ok(*known);
        }
        let name = short(mesh, "Mesh");
        let room = self.out.room.saturating_sub(self.out.scene.bin.bytes.len());
        let geometry = mesh::read(mesh, &name, room)?;
        let normals = normals::corners(&geometry.surface(), self.cancelled)
            .ok_or_else(cancel::refusal)?
            .normals;
        self.out.scene.count("normalsComputed", 1);
        let slots = self.slots(mesh)?;
        let before = self.out.scene.bin.bytes.len();
        let (json, triangles) = build::mesh_json(
            &geometry,
            &normals,
            &slots,
            &name,
            &mut self.out,
            self.cancelled,
        )?;
        // The geometry joins the scene binary under the same budget as the packed images. The
        // check follows the pour: it bounds the binary, not the peak of building this mesh.
        let added = self.out.scene.bin.bytes.len() - before;
        self.out.fit("mesh", &name, before, added)?;
        let built = Some(self.out.scene.mesh(json, triangles));
        self.meshes.insert(mesh.old, built);
        self.out.scene.count("meshes", 1);
        Ok(built)
    }

    /// The materials of a mesh's slots, in slot order.
    fn slots(&mut self, mesh: &At<'_>) -> Result<Vec<Option<usize>>> {
        let total = mesh.int("totcol", 0).max(0) as usize;
        let table = mesh.block("mat").unwrap_or_default();
        (0..total)
            .map(|slot| self.material(mesh.file, pointer_at(table, slot)))
            .collect()
    }

    /// The glTF rank of a material, poured on first request.
    fn material(&mut self, file: &BlendFile<'_>, pointer: u64) -> Result<Option<usize>> {
        if pointer == 0 {
            return Ok(None);
        }
        if let Some(known) = self.materials.get(&pointer) {
            return Ok(*known);
        }
        let found = file
            .at(pointer)
            .and_then(|block| file.view(block))
            .map(|it| -> Result<usize> {
                let name = short(&it, "Material");
                let json = material::material_json(
                    &it,
                    &name,
                    self.root,
                    &mut self.images,
                    &mut self.out,
                )?;
                self.out.scene.materials.push(json);
                Ok(self.out.scene.materials.len() - 1)
            })
            .transpose()?;
        self.materials.insert(pointer, found);
        Ok(found)
    }

    /// An object that replaces a material of its mesh: the driver follows the mesh, and says so.
    fn overridden(&self, object: &At<'_>) -> bool {
        let bits = object.block("matbits").unwrap_or_default();
        let table = object.block("mat").unwrap_or_default();
        (0..object.int("totcol", 0).max(0) as usize)
            .any(|slot| bits.get(slot).is_some_and(|b| *b != 0) && pointer_at(table, slot) != 0)
    }
}

/// The pointer of rank `rank` in a pointer block.
fn pointer_at(bytes: &[u8], rank: usize) -> u64 {
    crate::support::le::u64_at(bytes, rank * POINTER).unwrap_or(0)
}
