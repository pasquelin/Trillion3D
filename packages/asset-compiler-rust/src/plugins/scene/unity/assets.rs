//! Les fichiers de données que la scène cite : documents YAML lus une fois, matériaux par GUID.
use super::*;

impl Builder<'_, '_> {
    /// Le document d'un fichier de données, lu une seule fois. Son empreinte entre dans l'identité
    /// de la conversion : un `.prefab` ou un `.mat` modifié donne une autre scène intermédiaire.
    pub(super) fn document(&mut self, path: &Path) -> Option<Rc<Document>> {
        if let Some(known) = self.documents.get(path) {
            return Some(known.clone());
        }
        let name = path.file_name()?.to_string_lossy().to_string();
        let Some(text) = read_text(path) else {
            self.world.scene.report.add("unity-file-unreadable");
            self.world
                .scene
                .report
                .notes
                .push(format!("fichier de données illisible: {name}"));
            return None;
        };
        let digest = hash(text.as_bytes());
        let mut unreadable = Vec::new();
        let document = Rc::new(Document::parse(&text, &mut unreadable));
        self.world.scene.read_file(&name, text.len(), &digest);
        self.world
            .scene
            .report
            .add_count("unity-document-unreadable", unreadable.len());
        for reason in unreadable {
            self.world
                .scene
                .report
                .notes
                .push(format!("{name}: {reason}"));
        }
        self.documents.insert(path.to_path_buf(), document.clone());
        Some(document)
    }

    /// Le matériau glTF d'un GUID de `.mat`, versé une seule fois.
    pub(super) fn material(&mut self, reference: &Ref) -> Option<usize> {
        let guid = reference.guid.as_ref()?;
        if let Some(known) = self.materials.get(guid) {
            return *known;
        }
        let resolved = self.read_material(guid);
        self.materials.insert(guid.clone(), resolved);
        resolved
    }

    fn read_material(&mut self, guid: &str) -> Option<usize> {
        let Some(asset) = self.world.project.asset(guid).map(Path::to_path_buf) else {
            self.world.scene.report.add("unity-material-missing");
            return None;
        };
        let name = asset.file_stem()?.to_string_lossy().to_string();
        let document = self.document(&asset)?;
        let (_, entry) = document.of_class(MATERIAL).next().or_else(|| {
            self.world.scene.report.add("unity-material-unreadable");
            None
        })?;
        let json = materials::material_json(
            &entry.body,
            &name,
            self.world.scene,
            self.world.project,
            &mut self.textures,
        );
        self.world.scene.materials.push(json);
        self.world.scene.count("materials", 1);
        Some(self.world.scene.materials.len() - 1)
    }
}

/// La classe d'un `Material` sérialisé.
const MATERIAL: u32 = 21;
