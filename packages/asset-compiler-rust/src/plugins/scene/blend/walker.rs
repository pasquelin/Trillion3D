//! Le parcours des objets du fichier, et ce qu'il verse dans les tables glTF.
//!
//! Chaque bloc `OB` de type maillage devient un nœud ; chaque bloc `ME` un maillage glTF, versé une
//! seule fois — plusieurs objets qui partagent un maillage partagent le même, et n'en diffèrent que
//! par leur matrice. Les matériaux d'un maillage sont ceux de ses emplacements ; un objet qui en
//! remplace un est compté au rapport, le pilote suivant le maillage. Tout ce qui n'est pas rendu est
//! compté, jamais tu.
use super::*;

/// Ce que le parcours a sous la main.
pub(super) struct Scene<'a> {
    pub(super) out: Out,
    pub(super) images: Images,
    /// Le rang glTF d'un matériau, par l'adresse de son bloc.
    pub(super) materials: HashMap<u64, Option<usize>>,
    /// Le rang glTF d'un maillage et ses triangles, par l'adresse de son bloc.
    pub(super) meshes: HashMap<u64, Option<(usize, usize)>>,
    pub(super) root: &'a Path,
    pub(super) cancelled: &'a AtomicBool,
}

/// Le nom d'un bloc identifié, sans les deux lettres de genre que Blender lui préfixe.
fn short(view: &At<'_>, fallback: &str) -> String {
    let name = view.id_name();
    let trimmed = name.get(2..).unwrap_or_default();
    if trimmed.is_empty() {
        return fallback.to_string();
    }
    trimmed.to_string()
}

impl Scene<'_> {
    /// Un objet : son maillage s'il en porte un, et ce qu'on ne rend pas, compté.
    pub(super) fn object(&mut self, object: &At<'_>) -> Result<()> {
        if object.pointer("instance_collection") != 0 || object.pointer("dup_group") != 0 {
            self.out.report.add("blend-collection-instance-unsupported");
        }
        let kind = object.int("type", -1);
        if kind == light::OB_LAMP {
            self.light(object);
            return Ok(());
        }
        if kind != object::OB_MESH {
            self.out.count("nonMeshObjects", 1);
            return Ok(());
        }
        if !object.list("modifiers").is_empty() {
            self.out.report.add("blend-modifier-not-applied");
        }
        let Some(mesh) = object
            .follow("data")
            .filter(|data| data.layout.name == "Mesh")
        else {
            self.out.report.add("blend-mesh-missing");
            return Ok(());
        };
        let Some((index, triangles)) = self.mesh(&mesh)? else {
            return Ok(());
        };
        if self.overridden(object) {
            self.out
                .report
                .add("blend-object-material-override-unconverted");
        }
        let node = json!({
            "name": short(object, "Object"), "mesh": index,
            "matrix": object::world(object, 0),
        });
        self.out.nodes.push(node);
        let rank = self.out.nodes.len() - 1;
        if let Some(children) = self.out.nodes[0]["children"].as_array_mut() {
            children.push(json!(rank));
        }
        self.out.triangles += triangles;
        self.out.count("meshInstances", 1);
        Ok(())
    }

    /// La lampe d'un objet de type lampe : un nœud de plus sous la racine, à la matrice de
    /// l'objet. Blender oriente ses lampes vers leur `-Z`, comme le glTF : rien à tourner.
    fn light(&mut self, object: &At<'_>) {
        let matrix = object::world(object, 0);
        let scale = crate::shared_math::uniform_scale(&matrix.map(f64::from));
        let name = short(object, "Light");
        let Some(light) = light::build(object.follow("data"), name.clone(), scale, &mut self.out)
        else {
            return;
        };
        self.out
            .nodes
            .push(crate::import::light_node(&name, json!(matrix), light));
        let rank = self.out.nodes.len() - 1;
        if let Some(children) = self.out.nodes[0]["children"].as_array_mut() {
            children.push(json!(rank));
        }
    }

    /// Le maillage glTF d'un bloc `ME`, versé à la première demande.
    fn mesh(&mut self, mesh: &At<'_>) -> Result<Option<(usize, usize)>> {
        if let Some(known) = self.meshes.get(&mesh.old) {
            return Ok(*known);
        }
        let name = short(mesh, "Mesh");
        let geometry = mesh::read(mesh, &name)?;
        let normals = normals::corners(&geometry.surface()).normals;
        self.out.count("normalsComputed", 1);
        let slots = self.slots(mesh);
        let (json, triangles) = build::mesh_json(
            &geometry,
            &normals,
            &slots,
            &name,
            &mut self.out,
            self.cancelled,
        )?;
        self.out.meshes.push(json);
        let built = Some((self.out.meshes.len() - 1, triangles));
        self.meshes.insert(mesh.old, built);
        self.out.count("meshes", 1);
        Ok(built)
    }

    /// Les matériaux des emplacements d'un maillage, dans l'ordre des emplacements.
    fn slots(&mut self, mesh: &At<'_>) -> Vec<Option<usize>> {
        let total = mesh.int("totcol", 0).max(0) as usize;
        let table = mesh.block("mat").unwrap_or_default();
        (0..total)
            .map(|slot| self.material(mesh.file, pointer_at(table, slot)))
            .collect()
    }

    /// Le rang glTF d'un matériau, versé à la première demande.
    fn material(&mut self, file: &BlendFile, pointer: u64) -> Option<usize> {
        if pointer == 0 {
            return None;
        }
        if let Some(known) = self.materials.get(&pointer) {
            return *known;
        }
        let found = file
            .at(pointer)
            .and_then(|block| file.view(block))
            .map(|it| {
                let name = short(&it, "Material");
                let json =
                    material::material_json(&it, &name, self.root, &mut self.images, &mut self.out);
                self.out.materials.push(json);
                self.out.materials.len() - 1
            });
        self.materials.insert(pointer, found);
        found
    }

    /// Un objet qui remplace un matériau de son maillage : le pilote suit le maillage, et le dit.
    fn overridden(&self, object: &At<'_>) -> bool {
        let bits = object.block("matbits").unwrap_or_default();
        let table = object.block("mat").unwrap_or_default();
        (0..object.int("totcol", 0).max(0) as usize)
            .any(|slot| bits.get(slot).is_some_and(|b| *b != 0) && pointer_at(table, slot) != 0)
    }
}

/// Le pointeur de rang `rank` dans un bloc de pointeurs.
fn pointer_at(bytes: &[u8], rank: usize) -> u64 {
    bytes
        .get(rank * POINTER..rank * POINTER + POINTER)
        .map_or(0, |word| {
            u64::from_le_bytes(word.try_into().unwrap_or_default())
        })
}
