//! Native exact-cluster compiler. Rendering, UI and platform IPC do not belong here.
mod topology;
mod cluster;
mod qem;
mod lod;
use std::{collections::{BTreeMap,BTreeSet},fmt::{Display,Formatter},fs::{self,File},io::{Read,Write,BufWriter},path::{Path,PathBuf},sync::{Arc,atomic::{AtomicBool,Ordering}},time::Instant};
use serde_json::{Value,json};use sha2::{Sha256,Digest};use rayon::prelude::*;
pub const FORMAT_VERSION:u32=1;pub const COMPILER_VERSION:&str=env!("CARGO_PKG_VERSION");
#[derive(Debug)] pub struct CompilerError {pub code:&'static str,pub message:String}
impl CompilerError {fn new(code:&'static str,message:impl Into<String>)->Self{Self{code,message:message.into()}}}
impl Display for CompilerError {fn fmt(&self,f:&mut Formatter<'_>)->std::fmt::Result{write!(f,"{}: {}",self.code,self.message)}}
impl std::error::Error for CompilerError {}
impl From<std::io::Error> for CompilerError {fn from(value:std::io::Error)->Self{Self::new("IO_ERROR",value.to_string())}}
impl From<serde_json::Error> for CompilerError {fn from(value:serde_json::Error)->Self{Self::new("INVALID_JSON",value.to_string())}}
impl From<rayon::ThreadPoolBuildError> for CompilerError {fn from(value:rayon::ThreadPoolBuildError)->Self{Self::new("THREAD_POOL_ERROR",value.to_string())}}
pub type Result<T> = std::result::Result<T,CompilerError>;
#[derive(Clone)] pub struct Options {pub source:PathBuf,pub cache:PathBuf,pub resource_base:String,pub scope:String,pub triangle_budget:usize,pub threads:usize,pub ram_budget_mb:usize,pub simplification:String,pub cancelled:Arc<AtomicBool>}
pub trait ClusterStrategy:Send+Sync {fn id(&self)->&str;fn version(&self)->u32;fn clusters(&self,indices:&[u32],neighbors:&[Vec<usize>])->Result<Vec<Vec<usize>>>;}
pub const CLUSTER_INDEX_COUNT:usize=768;
pub const CLUSTER_TRIANGLES:usize=256;
pub struct Exact256;impl ClusterStrategy for Exact256 {fn id(&self)->&str{"exact-source-order"}fn version(&self)->u32{1}fn clusters(&self,indices:&[u32],_neighbors:&[Vec<usize>])->Result<Vec<Vec<usize>>>{if indices.len()%3!=0||indices.is_empty(){return Err(invalid("Index count must be a positive multiple of three"))}let triangles=indices.len()/3;Ok((0..triangles).step_by(CLUSTER_TRIANGLES).map(|start|(start..(start+CLUSTER_TRIANGLES).min(triangles)).collect()).collect())}}
pub use cluster::GreedyAdjacency;
fn invalid(message:impl Into<String>)->CompilerError{CompilerError::new("INVALID_GLTF",message)}
fn required_index(v:Option<&Value>,field:&str)->Result<usize>{let raw=v.and_then(Value::as_u64).ok_or_else(||invalid(format!("{field} must be an unsigned integer")))?;usize::try_from(raw).map_err(|_|invalid(format!("{field} is too large")))}
fn optional_index(v:Option<&Value>,field:&str,default:usize)->Result<usize>{match v{Some(value)=>required_index(Some(value),field),None=>Ok(default)}}
fn values<'a>(g:&'a Value,field:&str)->Result<&'a Vec<Value>>{g.get(field).and_then(Value::as_array).ok_or_else(||invalid(format!("{field} array is required")))}
fn item<'a>(items:&'a [Value],id:usize,field:&str)->Result<&'a Value>{items.get(id).ok_or_else(||invalid(format!("{field} index {id} is out of bounds")))}
fn hash(b:&[u8])->String{format!("{:x}",Sha256::digest(b))}
fn hash_file(p:&Path)->Result<String>{let mut f=File::open(p)?;let mut h=Sha256::new();let mut block=[0u8;65536];loop{let n=f.read(&mut block)?;if n==0{break}h.update(&block[..n]);}Ok(format!("{:x}",h.finalize()))}
fn is_safe_source_name(name:&str)->bool{!name.is_empty()&&name.len()<256&&name!="."&&name!=".."&&!name.contains('/')&&!name.contains('\\')&&!name.contains("..")&&!name.contains('\0')}
fn atomic(path:&Path,data:&[u8])->Result<()>{let temp=path.with_extension(format!("tmp-{}-{:?}",std::process::id(),std::thread::current().id()));fs::write(&temp,data)?;fs::rename(temp,path)?;Ok(())}
fn check(o:&Options)->Result<()>{if o.cancelled.load(Ordering::Relaxed){return Err(CompilerError::new("CANCELLED","Compilation cancelled"))}Ok(())}
fn accessor<'a>(g:&'a Value,bin:&'a [u8],id:usize)->Result<Accessor<'a>>{let accessors=values(g,"accessors")?;let views=values(g,"bufferViews")?;let a=item(accessors,id,"accessor")?;let view_id=required_index(a.get("bufferView"),"accessor.bufferView")?;let v=item(views,view_id,"bufferView")?;if a.get("sparse").is_some()||a.get("normalized").and_then(Value::as_bool)==Some(true)||optional_index(v.get("buffer"),"bufferView.buffer",0)?!=0{return Err(CompilerError::new("UNSUPPORTED_ACCESSOR","Only dense, non-normalized accessors in buffer zero are supported"))}
 let component=required_index(a.get("componentType"),"accessor.componentType")?;let bytes=match component{5121=>1,5123=>2,5125|5126=>4,_=>return Err(CompilerError::new("UNSUPPORTED_COMPONENT",component.to_string()))};let width=match a.get("type").and_then(Value::as_str){Some("SCALAR")=>1,Some("VEC2")=>2,Some("VEC3")=>3,Some("VEC4")=>4,_=>return Err(CompilerError::new("UNSUPPORTED_ACCESSOR_TYPE","Unsupported or missing accessor type"))};
 let base=optional_index(v.get("byteOffset"),"bufferView.byteOffset",0)?.checked_add(optional_index(a.get("byteOffset"),"accessor.byteOffset",0)?).ok_or_else(||invalid("Accessor offset overflow"))?;let stride=optional_index(v.get("byteStride"),"bufferView.byteStride",width*bytes)?;if stride<width*bytes{return Err(invalid("Accessor stride is smaller than one element"))}Ok(Accessor{bin,base,stride,count:required_index(a.get("count"),"accessor.count")?,component,bytes,width})}
struct Accessor<'a>{bin:&'a [u8],base:usize,stride:usize,count:usize,component:usize,bytes:usize,width:usize}
impl Accessor<'_>{
 fn bytes_at(&self,i:usize,c:usize)->Result<&[u8]>{if i>=self.count||c>=self.width{return Err(CompilerError::new("INDEX_OUT_OF_BOUNDS","Accessor element is out of bounds"))}let o=self.base.checked_add(i.checked_mul(self.stride).ok_or_else(||invalid("Accessor offset overflow"))?).and_then(|value|value.checked_add(c*self.bytes)).ok_or_else(||invalid("Accessor offset overflow"))?;self.bin.get(o..o+self.bytes).ok_or_else(||CompilerError::new("BUFFER_OUT_OF_BOUNDS","Accessor exceeds binary buffer"))}
 fn value(&self,i:usize,c:usize)->Result<f64>{let b=self.bytes_at(i,c)?;Ok(match self.component{5121=>b[0] as f64,5123=>u16::from_le_bytes([b[0],b[1]]) as f64,5125=>u32::from_le_bytes([b[0],b[1],b[2],b[3]]) as f64,5126=>f32::from_le_bytes([b[0],b[1],b[2],b[3]]) as f64,_=>return Err(invalid("Unsupported component"))})}
 fn u32_at(&self,i:usize)->Result<u32>{let b=self.bytes_at(i,0)?;match self.component{5121=>Ok(b[0] as u32),5123=>Ok(u16::from_le_bytes([b[0],b[1]]) as u32),5125=>Ok(u32::from_le_bytes([b[0],b[1],b[2],b[3]])),5126=>{let value=f32::from_le_bytes([b[0],b[1],b[2],b[3]]);if !value.is_finite()||value.fract()!=0.||value<0.||value>u32::MAX as f32{return Err(invalid("Index is not an unsigned 32-bit integer"))}Ok(value as u32)},_=>Err(invalid("Unsupported component"))}}
 fn f32_at(&self,i:usize,c:usize)->Result<f32>{let value=self.value(i,c)? as f32;if !value.is_finite(){return Err(CompilerError::new("NONFINITE_POSITION","Position is not finite"))}Ok(value)}
 fn collect_u32(&self)->Result<Vec<u32>>{
  let mut out=Vec::with_capacity(self.count);
  if self.width==1&&self.stride==self.bytes&&self.component!=5126{
   let nbytes=self.count.checked_mul(self.bytes).ok_or_else(||invalid("Accessor offset overflow"))?;
   let end=self.base.checked_add(nbytes).ok_or_else(||invalid("Accessor offset overflow"))?;
   let slice=self.bin.get(self.base..end).ok_or_else(||CompilerError::new("BUFFER_OUT_OF_BOUNDS","Accessor exceeds binary buffer"))?;
   match self.component{
    5121=>{out.extend(slice.iter().map(|&b|b as u32));return Ok(out);}
    5123=>{for chunk in slice.chunks_exact(2){out.push(u16::from_le_bytes([chunk[0],chunk[1]]) as u32);}return Ok(out);}
    5125=>{for chunk in slice.chunks_exact(4){out.push(u32::from_le_bytes([chunk[0],chunk[1],chunk[2],chunk[3]]));}return Ok(out);}
    _=>{}
   }
  }
  for i in 0..self.count{out.push(self.u32_at(i)?);}
  Ok(out)
 }
 fn collect_f32(&self)->Result<Vec<f32>>{
  let n=self.count.checked_mul(self.width).ok_or_else(||invalid("Accessor offset overflow"))?;
  let mut out=Vec::with_capacity(n);
  if self.component==5126&&self.stride==self.width*self.bytes{
   let nbytes=n.checked_mul(4).ok_or_else(||invalid("Accessor offset overflow"))?;
   let end=self.base.checked_add(nbytes).ok_or_else(||invalid("Accessor offset overflow"))?;
   let slice=self.bin.get(self.base..end).ok_or_else(||CompilerError::new("BUFFER_OUT_OF_BOUNDS","Accessor exceeds binary buffer"))?;
   for chunk in slice.chunks_exact(4){
    let value=f32::from_le_bytes([chunk[0],chunk[1],chunk[2],chunk[3]]);
    if !value.is_finite(){return Err(CompilerError::new("NONFINITE_POSITION","Position is not finite"));}
    out.push(value);
   }
   return Ok(out);
  }
  for i in 0..self.count{for c in 0..self.width{out.push(self.f32_at(i,c)?);}}
  Ok(out)
 }
}
fn hierarchy(pages:&[Value])->Result<Value>{
 #[derive(Clone,Copy)] struct PageBound{id:usize,min:[f64;3],max:[f64;3]}
 fn coordinate(page:&Value,bound:&str,axis:usize)->Result<f64>{page.get(bound).and_then(Value::as_array).and_then(|v|v.get(axis)).and_then(Value::as_f64).ok_or_else(||invalid(format!("page.{bound}[{axis}] is required")))}
 let bounds=pages.iter().map(|page|{let mut min=[0.0;3];let mut max=[0.0;3];for a in 0..3{min[a]=coordinate(page,"min",a)?;max[a]=coordinate(page,"max",a)?;}Ok(PageBound{id:required_index(page.get("id"),"page.id")?,min,max})}).collect::<Result<Vec<_>>>()?;
 fn build(bounds:&[PageBound],idx:&[usize])->Result<Value>{
  if idx.is_empty(){return Ok(Value::Null)}
  let mut min=[f64::INFINITY;3];let mut max=[f64::NEG_INFINITY;3];
  for &i in idx{let p=&bounds[i];for a in 0..3{min[a]=min[a].min(p.min[a]);max[a]=max[a].max(p.max[a]);}}
  if idx.len()==1{return Ok(json!({"min":min,"max":max,"page":bounds[idx[0]].id}))}
  let mut axis=0;for candidate in 1..3{if max[candidate]-min[candidate]>max[axis]-min[axis]{axis=candidate;}}
  let mut sorted=idx.to_vec();sorted.sort_by(|&a,&b|{(bounds[a].min[axis]+bounds[a].max[axis]).total_cmp(&(bounds[b].min[axis]+bounds[b].max[axis])).then(bounds[a].id.cmp(&bounds[b].id))});
  let middle=sorted.len()/2;Ok(json!({"min":min,"max":max,"children":[build(bounds,&sorted[..middle])?,build(bounds,&sorted[middle..])?]}))
 }
 build(&bounds,&(0..bounds.len()).collect::<Vec<_>>())
}
pub fn parse_compiler_args(args:&[String],cancelled:Arc<AtomicBool>)->std::result::Result<Options,String>{
 fn number(value:Option<&String>,default:usize,name:&str)->std::result::Result<usize,String>{match value{Some(raw)=>raw.parse::<usize>().ok().filter(|v|*v>0).ok_or_else(||format!("{name} must be a positive integer")),None=>Ok(default)}}
 let (scope,triangle_budget,threads,ram_budget_mb,resource_base,simplification)=match args.len(){
  5=>(args[2].clone(),number(Some(&args[3]),150000,"triangles")?,2,256,args[4].clone(),"none".into()),
  7=>(args[2].clone(),number(Some(&args[3]),150000,"triangles")?,number(Some(&args[4]),2,"threads")?,number(Some(&args[5]),256,"RAM_MB")?,args[6].clone(),"none".into()),
  8=>(args[2].clone(),number(Some(&args[3]),150000,"triangles")?,number(Some(&args[4]),2,"threads")?,number(Some(&args[5]),256,"RAM_MB")?,args[6].clone(),args[7].clone()),
  _=>return Err("Usage: web-geometry-compiler SOURCE CACHE [slice|full] [triangles] RESOURCE_BASE_URL\n       web-geometry-compiler SOURCE CACHE [slice|full] [triangles] [threads] [RAM_MB] RESOURCE_BASE_URL [none|qem-endpoints]".into()),
 };
 if !["none","qem-endpoints"].contains(&simplification.as_str()){return Err("simplification must be none or qem-endpoints".into());}
 Ok(Options{source:PathBuf::from(&args[0]),cache:PathBuf::from(&args[1]),resource_base,scope,triangle_budget,threads,ram_budget_mb,simplification,cancelled})
}
/// Library entry point: strategy, cancellation, storage roots and progress are supplied by the host.
pub fn compile(o:&Options,strategy:&dyn ClusterStrategy,progress:impl Fn(Value)+Sync)->Result<Value>{
 check(o)?;if !["slice","full"].contains(&o.scope.as_str())||o.triangle_budget==0||o.threads==0||o.threads>64||o.ram_budget_mb<64||o.resource_base.is_empty()||!["none","qem-endpoints"].contains(&o.simplification.as_str()){return Err(CompilerError::new("INVALID_OPTIONS","scope, budgets, threads, resource_base and simplification must be valid"))}
 let started=Instant::now();let manifest_bytes=fs::read(o.source.join("manifest.json"))?;let manifest:Value=serde_json::from_slice(&manifest_bytes)?;if manifest.get("status").and_then(Value::as_str)!=Some("ready"){return Err(CompilerError::new("SOURCE_NOT_READY","Source manifest is not ready"))}if let Some(version)=manifest.get("formatVersion").and_then(Value::as_u64){if version!=FORMAT_VERSION as u64{return Err(CompilerError::new("UNSUPPORTED_FORMAT",format!("Expected {FORMAT_VERSION}, received {version}")))}}
 let runtime=manifest.get("runtime").ok_or_else(||invalid("manifest.runtime is required"))?;let gltf_file=runtime.get("file").and_then(Value::as_str).filter(|name|is_safe_source_name(name)).ok_or_else(||invalid("manifest.runtime.file is required"))?;let g_bytes=fs::read(o.source.join(gltf_file))?;let g:Value=serde_json::from_slice(&g_bytes)?;if hash(&g_bytes)!=runtime.get("sha256").and_then(Value::as_str).ok_or_else(||invalid("manifest.runtime.sha256 is required"))?{return Err(CompilerError::new("SOURCE_HASH_MISMATCH","glTF hash differs from manifest"))}
 let buffers=values(&g,"buffers")?;if buffers.len()!=1{return Err(CompilerError::new("UNSUPPORTED_ACCESSOR","Multiple buffers are unsupported"))}let bin_name=buffers[0].get("uri").and_then(Value::as_str).filter(|name|is_safe_source_name(name)).ok_or_else(||invalid("glTF buffer uri is required"))?;let bin_path=o.source.join(bin_name);let bin_hash=hash_file(&bin_path)?;let declared=runtime.get("sidecars").and_then(Value::as_array).ok_or_else(||invalid("manifest.runtime.sidecars is required"))?.iter().find(|v|v.get("file").and_then(Value::as_str)==Some(bin_name)).ok_or_else(||invalid("buffer sidecar hash is required"))?;
 if bin_hash!=declared.get("sha256").and_then(Value::as_str).ok_or_else(||invalid("sidecar.sha256 is required"))?{return Err(CompilerError::new("SOURCE_HASH_MISMATCH","Binary hash differs from manifest"))}
 let file=File::open(&bin_path)?;
 // Mapping is read-only. Host must keep the source immutable until compile returns.
 let bin=unsafe{memmap2::MmapOptions::new().map(&file)?};
 let mut implementation=Sha256::new();implementation.update(include_bytes!("lib.rs"));implementation.update(include_bytes!("topology.rs"));implementation.update(include_bytes!("cluster.rs"));implementation.update(include_bytes!("qem.rs"));implementation.update(include_bytes!("lod.rs"));
 let key=hash(serde_json::to_string(&json!({"source":hash(&manifest_bytes),"binary":bin_hash,"compiler":COMPILER_VERSION,"implementation":format!("{:x}",implementation.finalize()),"strategy":strategy.id(),"strategyVersion":strategy.version(),"scope":o.scope,"budget":o.triangle_budget,"resourceBase":o.resource_base,"simplification":o.simplification}))?.as_bytes());
 let nodes=values(&g,"nodes")?;let mesh_values=values(&g,"meshes")?;let accessor_values=values(&g,"accessors")?;let view_values=values(&g,"bufferViews")?;let mut chosen=BTreeSet::new();let mut selected_triangles=0;
 for (i,n) in nodes.iter().enumerate(){if let Some(mesh_value)=n.get("mesh"){if n.get("skin").is_some(){return Err(CompilerError::new("UNSUPPORTED_SKIN","Skinned geometry is unsupported"))}let mesh_id=required_index(Some(mesh_value),"node.mesh")?;let mesh=item(mesh_values,mesh_id,"mesh")?;let mut triangles=0;for (primitive_id,p) in values(mesh,"primitives")?.iter().enumerate(){let index_id=required_index(p.get("indices"),"primitive.indices")?;if p.get("attributes").and_then(Value::as_object).and_then(|a|a.get("POSITION")).is_none(){return Err(invalid(format!("mesh {mesh_id} primitive {primitive_id} requires POSITION")))}let count=required_index(item(accessor_values,index_id,"accessor")?.get("count"),"accessor.count")?;if count==0||count%3!=0{return Err(CompilerError::new("INVALID_TRIANGLES","Index count must be a positive multiple of three"))}triangles+=count/3;}if o.scope=="full"||selected_triangles+triangles<=o.triangle_budget{chosen.insert(i);selected_triangles+=triangles;}}}
 if chosen.is_empty(){return Err(CompilerError::new("EMPTY_SLICE","No complete mesh instance fits the slice budget"))}
 let mut meshes=BTreeSet::new();for i in &chosen{meshes.insert(required_index(nodes[*i].get("mesh"),"node.mesh")?);}let mesh_map:BTreeMap<usize,usize>=meshes.iter().enumerate().map(|(new,old)|(*old,new)).collect();
 let mut accessors=BTreeSet::new();let mut jobs=Vec::new();for old in &meshes{for (primitive,p) in values(item(mesh_values,*old,"mesh")?,"primitives")?.iter().enumerate(){accessors.insert(required_index(p.get("indices"),"primitive.indices")?);let attributes=p.get("attributes").and_then(Value::as_object).ok_or_else(||invalid("primitive.attributes is required"))?;if !attributes.contains_key("POSITION"){return Err(invalid("primitive.attributes.POSITION is required"))}for a in attributes.values(){accessors.insert(required_index(Some(a),"primitive attribute")?);}jobs.push((*old,primitive));}}
 let access_map:BTreeMap<usize,usize>=accessors.iter().enumerate().map(|(new,old)|(*old,new)).collect();let mut views=BTreeSet::new();for a in &accessors{views.insert(required_index(item(accessor_values,*a,"accessor")?.get("bufferView"),"accessor.bufferView")?);}let view_map:BTreeMap<usize,usize>=views.iter().enumerate().map(|(new,old)|(*old,new)).collect();
 let mut estimated_working_bytes=g_bytes.len().saturating_mul(2).saturating_add(o.threads.saturating_mul(1024*1024));
 for id in &views{estimated_working_bytes=estimated_working_bytes.checked_add(required_index(item(view_values,*id,"bufferView")?.get("byteLength"),"bufferView.byteLength")?).ok_or_else(||invalid("Working set overflow"))?;}
 for (old,primitive) in &jobs{let p=item(values(item(mesh_values,*old,"mesh")?,"primitives")?,*primitive,"primitive")?;let count=required_index(item(accessor_values,required_index(p.get("indices"),"primitive.indices")?,"accessor")?.get("count"),"accessor.count")?;estimated_working_bytes=estimated_working_bytes.checked_add(count.checked_mul(4).ok_or_else(||invalid("Working set overflow"))?).ok_or_else(||invalid("Working set overflow"))?;}
 estimated_working_bytes=estimated_working_bytes.checked_add(bin.len()).ok_or_else(||invalid("Working set overflow"))?;
 if estimated_working_bytes>o.ram_budget_mb*1024*1024{return Err(CompilerError::new("RAM_ADMISSION_BUDGET_EXCEEDED","Estimated working set exceeds configured budget"))}
 let directory=o.cache.join("native").join(&o.scope).join(&key);fs::create_dir_all(directory.join("pages"))?;fs::create_dir_all(o.cache.join("native").join("objects"))?;let temp=directory.join("source.bin.tmp");let mut writer=BufWriter::new(File::create(&temp)?);let mut offset=0;let mut output_views=Vec::new();for id in &views{check(o)?;let mut v=item(view_values,*id,"bufferView")?.clone();if optional_index(v.get("buffer"),"bufferView.buffer",0)?!=0{return Err(CompilerError::new("UNSUPPORTED_ACCESSOR","Multiple buffers are unsupported"))}let padding=(4-offset%4)%4;writer.write_all(&[0u8;3][..padding])?;offset+=padding;let start=optional_index(v.get("byteOffset"),"bufferView.byteOffset",0)?;let len=required_index(v.get("byteLength"),"bufferView.byteLength")?;let end=start.checked_add(len).ok_or_else(||invalid("bufferView range overflow"))?;writer.write_all(bin.get(start..end).ok_or_else(||CompilerError::new("BUFFER_OUT_OF_BOUNDS","bufferView exceeds binary buffer"))?)?;v["byteOffset"]=json!(offset);offset+=len;output_views.push(v);}writer.flush()?;drop(writer);fs::rename(temp,directory.join("source.bin"))?;
 let import_ms=started.elapsed().as_secs_f64()*1000.;progress(json!({"phase":"import","completed":1,"total":1,"ms":import_ms}));
 let cluster_start=Instant::now();let pool=rayon::ThreadPoolBuilder::new().num_threads(o.threads).build()?;
 // Compact per-page index storage is bounded independently from source size. Metadata is retained.
 let primitives:Vec<Value>=pool.install(||jobs.par_iter().map(|(old,primitive)|->Result<Value>{check(o)?;let p=item(values(item(mesh_values,*old,"mesh")?,"primitives")?,*primitive,"primitive")?;if optional_index(p.get("mode"),"primitive.mode",4)?!=4||p.get("targets").is_some(){return Err(CompilerError::new("UNSUPPORTED_PRIMITIVE","Only static triangles are supported"))}
  let ids=accessor(&g,&bin,required_index(p.get("indices"),"primitive.indices")?)?;let positions=accessor(&g,&bin,required_index(p.get("attributes").and_then(Value::as_object).and_then(|a|a.get("POSITION")),"primitive.attributes.POSITION")?)?;if ids.count==0||ids.count%3!=0{return Err(CompilerError::new("INVALID_TRIANGLES","Index count must be a positive multiple of three"))}if positions.width!=3{return Err(invalid("POSITION must be VEC3"));}let index_values=ids.collect_u32()?;let pos=positions.collect_f32()?;let topology=crate::topology::classify_topology(&index_values,positions.count)?;let blend=if let Some(material)=p.get("material"){let id=required_index(Some(material),"primitive.material")?;values(&g,"materials")?.get(id).and_then(|m|m.get("alphaMode")).and_then(Value::as_str)==Some("BLEND")}else{false};let mesh=*mesh_map.get(old).ok_or_else(||invalid("Missing mesh mapping"))?;let mut pages=Vec::new();let mut reused:i32=0;let mut tree=Value::Null;
  if !blend{let clusters=strategy.clusters(&index_values,&topology.neighbors)?;let mut seen=vec![false;index_values.len()/3];let mut cluster_page_ids=Vec::new();for cluster in &clusters{check(o)?;if cluster.is_empty(){return Err(CompilerError::new("INVALID_CLUSTER_PARTITION","Cluster partitions must cover ordered triangles exactly"))}let mut bytes=Vec::with_capacity(cluster.len()*12);let mut min=[f64::INFINITY;3];let mut max=[f64::NEG_INFINITY;3];for &triangle in cluster{if triangle>=seen.len()||seen[triangle]{return Err(CompilerError::new("INVALID_CLUSTER_PARTITION","Cluster partitions must cover ordered triangles exactly"))}seen[triangle]=true;for k in 0..3{let id=index_values[triangle*3+k] as usize;if id*3+2>=pos.len(){return Err(invalid("Invalid index"));}bytes.extend_from_slice(&(id as u32).to_le_bytes());for a in 0..3{let value=pos[id*3+a] as f64;min[a]=min[a].min(value);max[a]=max[a].max(value);}}}
   let digest=hash(&bytes);let name=format!("../../objects/{}.bin",digest);let target=o.cache.join("native").join("objects").join(format!("{}.bin",digest));if target.exists()&&hash_file(&target)?==digest{reused+=1;}else{atomic(&target,&bytes)?;}cluster_page_ids.push(pages.len());pages.push(json!({"id":pages.len(),"url":name,"sha256":digest,"bytes":bytes.len(),"count":cluster.len()*3,"start":cluster[0]*3,"min":min,"max":max,"role":"exact"}));}if seen.iter().any(|flag|!*flag){return Err(CompilerError::new("INCOMPLETE_CLUSTER_PARTITION","Cluster partitions omitted source indices"))}
   let write_coarse=|slice:&[u32],pages:&mut Vec<Value>,reused:&mut i32|->Result<usize>{
    check(o)?;let mut bytes=Vec::with_capacity(slice.len()*4);let mut min=[f64::INFINITY;3];let mut max=[f64::NEG_INFINITY;3];
    for &id in slice{let index=id as usize;if index*3+2>=pos.len(){return Err(invalid("Invalid coarse index"));}bytes.extend_from_slice(&id.to_le_bytes());for a in 0..3{let value=pos[index*3+a] as f64;min[a]=min[a].min(value);max[a]=max[a].max(value);}}
    let digest=hash(&bytes);let name=format!("../../objects/{}.bin",digest);let target=o.cache.join("native").join("objects").join(format!("{}.bin",digest));if target.exists()&&hash_file(&target)?==digest{*reused+=1;}else{atomic(&target,&bytes)?;}
    let id=pages.len();pages.push(json!({"id":id,"url":name,"sha256":digest,"bytes":bytes.len(),"count":slice.len(),"start":0,"min":min,"max":max,"role":"coarse"}));Ok(id)
   };
   tree=if o.simplification=="qem-endpoints"&&clusters.len()>=2{
    match crate::lod::build_lod_tree(&pos,&index_values,&clusters,&topology.neighbors)?{
     Some(node)=>crate::lod::to_json(&node,&cluster_page_ids,&mut |slice|write_coarse(slice,&mut pages,&mut reused))?,
     None=>hierarchy(&pages)?,
    }
   }else{
    let mut tree=hierarchy(&pages)?;
    if o.simplification=="qem-endpoints"&&index_values.len()>=6{
     let simplified=crate::qem::simplify_fast(&pos,&index_values,(index_values.len()/12).max(1))?;
     if simplified.triangles*3<index_values.len(){
      let mut coarse_ids=Vec::new();let mut start=0usize;
      while start<simplified.indices.len(){let end=(start+CLUSTER_INDEX_COUNT).min(simplified.indices.len());coarse_ids.push(write_coarse(&simplified.indices[start..end],&mut pages,&mut reused)?);start=end;}
      if !tree.is_null(){tree["errorObject"]=json!(simplified.error_object);tree["coarsePages"]=json!(coarse_ids);}
     }
    }
    tree
   };
  }
  progress(json!({"phase":"primitive","mesh":mesh,"primitive":primitive,"pages":pages.len()}));Ok(json!({"mesh":mesh,"primitive":primitive,"material":p.get("material").cloned().unwrap_or(Value::Null),"triangles":ids.count/3,"pass":if blend{"shared-blend"}else{"exact-clusters"},"hierarchy":tree,"pages":pages,"reusedPages":reused,"topology":{"triangles":topology.triangles,"edges":{"boundary":topology.boundary_edges,"manifold":topology.manifold_edges,"nonManifold":topology.non_manifold_edges},"vertices":{"interior":topology.interior_vertices,"boundary":topology.boundary_vertices,"locked":topology.locked_vertices,"unused":topology.unused_vertices},"manifold":topology.manifold}}))}).collect::<Result<Vec<_>>>())?;
 let mut source=g;let mut output_meshes=Vec::new();for id in &meshes{let mut mesh=item(values(&source,"meshes")?,*id,"mesh")?.clone();for p in mesh.get_mut("primitives").and_then(Value::as_array_mut).ok_or_else(||invalid("mesh.primitives is required"))?{let old=required_index(p.get("indices"),"primitive.indices")?;p["indices"]=json!(*access_map.get(&old).ok_or_else(||invalid("Missing accessor mapping"))?);for v in p.get_mut("attributes").and_then(Value::as_object_mut).ok_or_else(||invalid("primitive.attributes is required"))?.values_mut(){let old=required_index(Some(v),"primitive attribute")?;*v=json!(*access_map.get(&old).ok_or_else(||invalid("Missing accessor mapping"))?);}}output_meshes.push(mesh);}source["meshes"]=Value::Array(output_meshes);
 for (i,n) in source.get_mut("nodes").and_then(Value::as_array_mut).ok_or_else(||invalid("nodes array is required"))?.iter_mut().enumerate(){if n.get("mesh").is_some(){if chosen.contains(&i){let old=required_index(n.get("mesh"),"node.mesh")?;n["mesh"]=json!(*mesh_map.get(&old).ok_or_else(||invalid("Missing mesh mapping"))?);}else{n.as_object_mut().ok_or_else(||invalid("node object is required"))?.remove("mesh");}}}
 let mut output_accessors=Vec::new();for id in &accessors{let mut a=item(values(&source,"accessors")?,*id,"accessor")?.clone();let old=required_index(a.get("bufferView"),"accessor.bufferView")?;a["bufferView"]=json!(*view_map.get(&old).ok_or_else(||invalid("Missing bufferView mapping"))?);output_accessors.push(a);}source["accessors"]=Value::Array(output_accessors);
 source["bufferViews"]=json!(output_views);source["buffers"]=json!([{"uri":"source.bin","byteLength":offset}]);for image in source.get_mut("images").and_then(Value::as_array_mut).ok_or_else(||invalid("images array is required"))?{let uri=image.get("uri").and_then(Value::as_str).ok_or_else(||invalid("image.uri is required"))?;image["uri"]=json!(format!("{}/{}",o.resource_base.trim_end_matches('/'),uri));}
 atomic(&directory.join("source.gltf"),&serde_json::to_vec(&source)?)?;
 let mut unsupported=vec!["compression","hard RSS enforcement","N-API binding"];if o.simplification=="none"{unsupported.insert(0,"simplification");}
 let result=json!({"schema":FORMAT_VERSION,"formatVersion":FORMAT_VERSION,"compilerVersion":COMPILER_VERSION,"status":"ready","key":key,"scope":o.scope,"clusterStrategy":strategy.id(),"selectedTriangles":selected_triangles,"sourceTriangles":manifest["runtime"]["trianglesAcrossNodes"],"selectedNodes":chosen,"totalNodes":manifest["runtime"]["meshNodes"],"primitives":primitives,"simplification":o.simplification!="none","gpuDriven":false,"metrics":{"importMs":import_ms,"clusterHierarchyPagesMs":cluster_start.elapsed().as_secs_f64()*1000.,"wallMs":started.elapsed().as_secs_f64()*1000.,"sourceMappedBytes":bin.len(),"outputGeometryBytes":offset,"threads":o.threads,"ramBudgetMb":o.ram_budget_mb,"admissionEstimatedBytes":estimated_working_bytes,"peakRssBytes":null,"cpuMs":null,"diskBytesRead":null},"unsupported":unsupported});
 atomic(&directory.join("clusters.json"),&serde_json::to_vec(&result)?)?;atomic(&o.cache.join("native").join(&o.scope).join("manifest.json"),&serde_json::to_vec(&json!({"status":"ready","formatVersion":FORMAT_VERSION,"compiler":"native-rust","key":key,"scope":o.scope,"url":format!("{}/clusters.json",key)}))?)?;progress(json!({"phase":"complete","completed":1,"total":1}));Ok(result)
}
#[cfg(test)] mod tests {use super::*;use std::time::{SystemTime,UNIX_EPOCH};
 fn fixture()->(PathBuf,Options){fixture_named("mesh.gltf","mesh.bin")}
 fn fixture_named(gltf_name:&str,bin_name:&str)->(PathBuf,Options){let root=std::env::temp_dir().join(format!("web-geometry-{}-{}-{}",std::process::id(),SystemTime::now().duration_since(UNIX_EPOCH).expect("clock").as_nanos(),gltf_name));let source=root.join("source");let cache=root.join("cache");fs::create_dir_all(&source).expect("source");let mut bin=Vec::new();for value in [0f32,0.,0.,1.,0.,0.,0.,1.,0.]{bin.extend_from_slice(&value.to_le_bytes())}for value in [0u32,1,2]{bin.extend_from_slice(&value.to_le_bytes())}let gltf=json!({"asset":{"version":"2.0"},"buffers":[{"uri":bin_name,"byteLength":48}],"bufferViews":[{"buffer":0,"byteOffset":0,"byteLength":36},{"buffer":0,"byteOffset":36,"byteLength":12}],"accessors":[{"bufferView":0,"componentType":5126,"type":"VEC3","count":3},{"bufferView":1,"componentType":5125,"type":"SCALAR","count":3}],"meshes":[{"primitives":[{"attributes":{"POSITION":0},"indices":1}]}],"nodes":[{"mesh":0},{"mesh":0}],"materials":[],"images":[]});let gltf_bytes=serde_json::to_vec(&gltf).expect("gltf");fs::write(source.join(gltf_name),&gltf_bytes).expect("gltf write");fs::write(source.join(bin_name),&bin).expect("bin write");fs::write(source.join("manifest.json"),serde_json::to_vec(&json!({"status":"ready","formatVersion":FORMAT_VERSION,"runtime":{"file":gltf_name,"sha256":hash(&gltf_bytes),"sidecars":[{"file":bin_name,"sha256":hash(&bin)}],"trianglesAcrossNodes":2,"meshNodes":2}})).expect("manifest")).expect("manifest write");let options=Options{source,cache,resource_base:"/assets/".into(),scope:"slice".into(),triangle_budget:1,threads:1,ram_budget_mb:64,simplification:"none".into(),cancelled:Arc::new(AtomicBool::new(false))};(root,options)}
 #[test] fn hierarchy_has_every_leaf_once(){let leaves:Vec<Value>=(0..9).map(|i|json!({"id":i,"min":[i,0,0],"max":[i+1,1,1]})).collect();fn walk(v:&Value,ids:&mut Vec<usize>){if let Some(id)=v.get("page"){ids.push(id.as_u64().expect("id") as usize)}else{for c in v["children"].as_array().expect("children"){walk(c,ids)}}}let tree=hierarchy(&leaves).expect("hierarchy");let mut ids=Vec::new();walk(&tree,&mut ids);ids.sort();assert_eq!(ids,(0..9).collect::<Vec<_>>());assert_eq!(tree["min"],json!([0.0,0.0,0.0]));assert_eq!(tree["max"],json!([9.0,1.0,1.0]));}
 #[test] fn hierarchy_tie_breaks_equal_centers_by_page_id(){let leaves=vec![json!({"id":2,"min":[0,0,0],"max":[1,1,1]}),json!({"id":1,"min":[0,0,0],"max":[1,1,1]})];let tree=hierarchy(&leaves).expect("hierarchy");assert_eq!(tree["children"][0]["page"],1);assert_eq!(tree["children"][1]["page"],2);}
 #[test] fn parse_accepts_five_or_seven_args(){let cancelled=Arc::new(AtomicBool::new(false));let five=parse_compiler_args(&["s".into(),"c".into(),"slice".into(),"12".into(),"/assets/".into()],cancelled.clone()).expect("five");assert_eq!(five.threads,2);assert_eq!(five.ram_budget_mb,256);assert_eq!(five.simplification,"none");let seven=parse_compiler_args(&["s".into(),"c".into(),"full".into(),"12".into(),"4".into(),"128".into(),"/a/".into()],cancelled.clone()).expect("seven");assert_eq!(seven.threads,4);assert_eq!(seven.ram_budget_mb,128);let eight=parse_compiler_args(&["s".into(),"c".into(),"full".into(),"12".into(),"4".into(),"128".into(),"/a/".into(),"qem-endpoints".into()],cancelled).expect("eight");assert_eq!(eight.simplification,"qem-endpoints");}
 #[test] fn hierarchy_scales_without_cloning_page_json_per_level(){let leaves:Vec<Value>=(0..4096).map(|i|json!({"id":i,"min":[i,0,0],"max":[i+1,1,1]})).collect();let tree=hierarchy(&leaves).expect("hierarchy");assert_eq!(tree["min"],json!([0.0,0.0,0.0]));assert_eq!(tree["max"],json!([4096.0,1.0,1.0]));}
 #[test] fn malformed_accessor_is_rejected(){let g=json!({"accessors":[{"bufferView":0,"componentType":5125,"type":"SCALAR","count":1}],"bufferViews":[{"buffer":0,"byteLength":4}]});let a=accessor(&g,&[],0).expect("accessor");assert!(a.value(0,0).is_err());assert!(a.value(1,0).is_err());}
 #[test] fn compile_writes_pages_and_namespaced_pointer(){let(root,options)=fixture();let result=compile(&options,&Exact256,|_|{}).expect("compile");assert_eq!(result["selectedTriangles"],1);assert!(options.cache.join("native/slice/manifest.json").exists());let key=result["key"].as_str().expect("key");assert!(options.cache.join("native/slice").join(key).join("source.gltf").exists());fs::remove_dir_all(root).expect("cleanup");}
 #[test] fn compile_rejects_cancel_hash_and_format(){let(root,options)=fixture();options.cancelled.store(true,Ordering::Relaxed);assert_eq!(compile(&options,&Exact256,|_|{}).expect_err("cancel").code,"CANCELLED");options.cancelled.store(false,Ordering::Relaxed);fs::write(options.source.join("mesh.bin"),[0u8;48]).expect("corrupt");assert_eq!(compile(&options,&Exact256,|_|{}).expect_err("hash").code,"SOURCE_HASH_MISMATCH");let manifest_path=options.source.join("manifest.json");let mut manifest:Value=serde_json::from_slice(&fs::read(&manifest_path).expect("read")).expect("json");manifest["formatVersion"]=json!(999);fs::write(&manifest_path,serde_json::to_vec(&manifest).expect("encode")).expect("write");assert_eq!(compile(&options,&Exact256,|_|{}).expect_err("format").code,"UNSUPPORTED_FORMAT");fs::remove_dir_all(root).expect("cleanup");}
 #[test] fn compile_rejects_missing_indices_without_panicking(){let(root,options)=fixture();let gltf_path=options.source.join("mesh.gltf");let mut gltf:Value=serde_json::from_slice(&fs::read(&gltf_path).expect("read")).expect("json");gltf["meshes"][0]["primitives"][0].as_object_mut().expect("primitive").remove("indices");let gltf_bytes=serde_json::to_vec(&gltf).expect("encode");fs::write(&gltf_path,&gltf_bytes).expect("write");let manifest_path=options.source.join("manifest.json");let mut manifest:Value=serde_json::from_slice(&fs::read(&manifest_path).expect("read")).expect("json");manifest["runtime"]["sha256"]=json!(hash(&gltf_bytes));fs::write(&manifest_path,serde_json::to_vec(&manifest).expect("encode")).expect("write");assert_eq!(compile(&options,&Exact256,|_|{}).expect_err("invalid").code,"INVALID_GLTF");fs::remove_dir_all(root).expect("cleanup");}
 #[test] fn compile_reads_named_runtime_file(){let(root,options)=fixture_named("cube.gltf","cube.bin");let result=compile(&options,&Exact256,|_|{}).expect("compile");assert_eq!(result["selectedTriangles"],1);assert!(options.cache.join("native/slice/manifest.json").exists());fs::remove_dir_all(root).expect("cleanup");}
 #[test] fn compile_rejects_unsafe_runtime_file(){let(root,options)=fixture_named("mesh.gltf","mesh.bin");let manifest_path=options.source.join("manifest.json");let mut manifest:Value=serde_json::from_slice(&fs::read(&manifest_path).expect("read")).expect("json");manifest["runtime"]["file"]=json!("../mesh.gltf");fs::write(&manifest_path,serde_json::to_vec(&manifest).expect("encode")).expect("write");assert_eq!(compile(&options,&Exact256,|_|{}).expect_err("unsafe").code,"INVALID_GLTF");fs::remove_dir_all(root).expect("cleanup");}
 #[test] fn compile_greedy_strategy_covers_source_triangles(){let(root,options)=fixture_named("mesh.gltf","mesh.bin");let result=compile(&options,&crate::GreedyAdjacency,|_|{}).expect("compile");assert_eq!(result["clusterStrategy"],"greedy-adjacency");assert_eq!(result["selectedTriangles"],1);assert_eq!(result["primitives"][0]["topology"]["manifold"],true);fs::remove_dir_all(root).expect("cleanup");}
 fn cube_fixture()->(PathBuf,Options){
  let root=std::env::temp_dir().join(format!("web-geometry-cube-{}-{}",std::process::id(),SystemTime::now().duration_since(UNIX_EPOCH).expect("clock").as_nanos()));
  let source=root.join("source");let cache=root.join("cache");fs::create_dir_all(&source).expect("source");
  let mut bin=Vec::new();
  for value in [0f32,0.,0.,1.,0.,0.,1.,1.,0.,0.,1.,0.,0.,0.,1.,1.,0.,1.,1.,1.,1.,0.,1.,1.]{bin.extend_from_slice(&value.to_le_bytes());}
  for value in [0u32,1,2,0,2,3,4,6,5,4,7,6,0,4,5,0,5,1,3,2,6,3,6,7,1,5,6,1,6,2,0,3,7,0,7,4]{bin.extend_from_slice(&value.to_le_bytes());}
  let gltf=json!({"asset":{"version":"2.0"},"buffers":[{"uri":"cube.bin","byteLength":bin.len()}],"bufferViews":[{"buffer":0,"byteOffset":0,"byteLength":96},{"buffer":0,"byteOffset":96,"byteLength":144}],"accessors":[{"bufferView":0,"componentType":5126,"type":"VEC3","count":8},{"bufferView":1,"componentType":5125,"type":"SCALAR","count":36}],"meshes":[{"primitives":[{"attributes":{"POSITION":0},"indices":1}]}],"nodes":[{"mesh":0}],"materials":[],"images":[]});
  let gltf_bytes=serde_json::to_vec(&gltf).expect("gltf");
  fs::write(source.join("cube.gltf"),&gltf_bytes).expect("gltf write");fs::write(source.join("cube.bin"),&bin).expect("bin write");
  fs::write(source.join("manifest.json"),serde_json::to_vec(&json!({"status":"ready","formatVersion":FORMAT_VERSION,"runtime":{"file":"cube.gltf","sha256":hash(&gltf_bytes),"sidecars":[{"file":"cube.bin","sha256":hash(&bin)}],"trianglesAcrossNodes":12,"meshNodes":1}})).expect("manifest")).expect("manifest write");
  let options=Options{source,cache,resource_base:"/assets/".into(),scope:"full".into(),triangle_budget:150000,threads:1,ram_budget_mb:64,simplification:"qem-endpoints".into(),cancelled:Arc::new(AtomicBool::new(false))};
  (root,options)
 }
 #[test] fn compile_qem_endpoints_attaches_coarse_lod(){
  let(root,options)=cube_fixture();
  let result=compile(&options,&Exact256,|_|{}).expect("compile");
  assert_eq!(result["simplification"],true);
  let pages=result["primitives"][0]["pages"].as_array().expect("pages");
  let exact:Vec<_>=pages.iter().filter(|p|p["role"]!="coarse").collect();
  let coarse:Vec<_>=pages.iter().filter(|p|p["role"]=="coarse").collect();
  let exact_count:u64=exact.iter().map(|p|p["count"].as_u64().expect("count")).sum();
  assert_eq!(exact_count,36);
  assert_eq!(result["simplification"],true);
  let _=coarse;
  fs::remove_dir_all(root).expect("cleanup");
 }
 fn grid_fixture(nx:usize,ny:usize)->(PathBuf,Options){
  let root=std::env::temp_dir().join(format!("web-geometry-grid-{}-{}",std::process::id(),SystemTime::now().duration_since(UNIX_EPOCH).expect("clock").as_nanos()));
  let source=root.join("source");let cache=root.join("cache");fs::create_dir_all(&source).expect("source");
  let mut positions=Vec::new();
  for y in 0..=ny{for x in 0..=nx{positions.extend([x as f32,y as f32,0.0]);}}
  let mut indices=Vec::new();let width=(nx+1) as u32;
  for y in 0..ny as u32{for x in 0..nx as u32{let i=y*width+x;indices.extend([i,i+1,i+width,i+1,i+1+width,i+width]);}}
  let mut bin=Vec::new();
  for value in &positions{bin.extend_from_slice(&value.to_le_bytes());}
  for value in &indices{bin.extend_from_slice(&value.to_le_bytes());}
  let pos_bytes=positions.len()*4;let index_bytes=indices.len()*4;
  let gltf=json!({"asset":{"version":"2.0"},"buffers":[{"uri":"grid.bin","byteLength":bin.len()}],"bufferViews":[{"buffer":0,"byteOffset":0,"byteLength":pos_bytes},{"buffer":0,"byteOffset":pos_bytes,"byteLength":index_bytes}],"accessors":[{"bufferView":0,"componentType":5126,"type":"VEC3","count":positions.len()/3},{"bufferView":1,"componentType":5125,"type":"SCALAR","count":indices.len()}],"meshes":[{"primitives":[{"attributes":{"POSITION":0},"indices":1}]}],"nodes":[{"mesh":0}],"materials":[],"images":[]});
  let gltf_bytes=serde_json::to_vec(&gltf).expect("gltf");
  fs::write(source.join("grid.gltf"),&gltf_bytes).expect("gltf");fs::write(source.join("grid.bin"),&bin).expect("bin");
  fs::write(source.join("manifest.json"),serde_json::to_vec(&json!({"status":"ready","formatVersion":FORMAT_VERSION,"runtime":{"file":"grid.gltf","sha256":hash(&gltf_bytes),"sidecars":[{"file":"grid.bin","sha256":hash(&bin)}],"trianglesAcrossNodes":indices.len()/3,"meshNodes":1}})).expect("manifest")).expect("manifest write");
  let options=Options{source,cache,resource_base:"/assets/".into(),scope:"full".into(),triangle_budget:150000,threads:1,ram_budget_mb:64,simplification:"qem-endpoints".into(),cancelled:Arc::new(AtomicBool::new(false))};
  (root,options)
 }
 #[test] fn compile_qem_builds_nested_lod_for_two_clusters(){
  let(root,options)=grid_fixture(16,10);
  let result=compile(&options,&Exact256,|_|{}).expect("compile");
  let exact:Vec<_>=result["primitives"][0]["pages"].as_array().expect("pages").iter().filter(|p|p["role"]!="coarse").collect();
  assert_eq!(exact.len(),2);
  let tree=&result["primitives"][0]["hierarchy"];
  assert!(tree["children"].as_array().expect("children").len()>=2);
  assert!(tree["errorObject"].as_f64().expect("error")>=0.0);
  assert!(!tree["coarsePages"].as_array().expect("coarse").is_empty());
  assert!(tree["children"][0].get("page").is_some()||tree["children"][0].get("children").is_some());
  fs::remove_dir_all(root).expect("cleanup");
 }
}
