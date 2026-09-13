/** Generate material mip levels once during preparation, averaging in the texture's
 * declared color space. Clamp to each layer's image rather than its padded area. */
export async function generateMaterialMips(device:GPUDevice,texture:GPUTexture,format:GPUTextureFormat,width:number,height:number,scales:readonly (readonly [number,number])[],selectedLayers?:readonly number[]){
 const levels=1+Math.floor(Math.log2(Math.max(width,height)));
 if(levels===1)return;
 const layout=device.createBindGroupLayout({entries:[
  {binding:0,visibility:GPUShaderStage.FRAGMENT,texture:{sampleType:'float'}},
  {binding:1,visibility:GPUShaderStage.FRAGMENT,buffer:{type:'uniform'}},
 ]});
 const module=device.createShaderModule({code:`
 @group(0) @binding(0) var source:texture_2d<f32>;
 @group(0) @binding(1) var<uniform> extent:vec4u;
 @vertex fn vs(@builtin(vertex_index) i:u32)->@builtin(position) vec4f{
  return vec4f(f32(i32(i&1u)*4-1),f32(i32(i>>1u)*4-1),0.0,1.0);
 }
 @fragment fn fs(@builtin(position) pos:vec4f)->@location(0) vec4f{
  let p=vec2i(pos.xy)*2;let hi=vec2i(extent.xy)-vec2i(1);
  return (textureLoad(source,min(p,hi),0)+textureLoad(source,min(p+vec2i(1,0),hi),0)
   +textureLoad(source,min(p+vec2i(0,1),hi),0)+textureLoad(source,min(p+vec2i(1,1),hi),0))*0.25;
 }`});
 const pipeline=device.createRenderPipeline({layout:device.createPipelineLayout({bindGroupLayouts:[layout]}),vertex:{module,entryPoint:'vs'},fragment:{module,entryPoint:'fs',targets:[{format}]},primitive:{topology:'triangle-list'}});
 const stride=Math.max(256,device.limits.minUniformBufferOffsetAlignment??256);
 const packed=new Uint32Array(scales.length*(levels-1)*stride/4);
 for(let layer=0;layer<scales.length;layer++)for(let level=1;level<levels;level++){
  const at=(layer*(levels-1)+level-1)*stride/4,scale=scales[layer];
  packed[at]=Math.max(1,Math.floor(width*scale[0]/2**(level-1)));
  packed[at+1]=Math.max(1,Math.floor(height*scale[1]/2**(level-1)));
 }
 const uniforms=device.createBuffer({size:packed.byteLength,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});
 try{
  device.queue.writeBuffer(uniforms,0,packed);
  const encoder=device.createCommandEncoder();
  for(const layer of selectedLayers??scales.map((_,index)=>index))for(let level=1;level<levels;level++){
   const group=device.createBindGroup({layout,entries:[
    {binding:0,resource:texture.createView({dimension:'2d',baseArrayLayer:layer,arrayLayerCount:1,baseMipLevel:level-1,mipLevelCount:1})},
    {binding:1,resource:{buffer:uniforms,offset:(layer*(levels-1)+level-1)*stride,size:16}},
   ]});
   const pass=encoder.beginRenderPass({colorAttachments:[{view:texture.createView({dimension:'2d',baseArrayLayer:layer,arrayLayerCount:1,baseMipLevel:level,mipLevelCount:1}),loadOp:'clear',storeOp:'store'}]});
   pass.setPipeline(pipeline);pass.setBindGroup(0,group);pass.draw(3);pass.end();
  }
  device.queue.submit([encoder.finish()]);
  await device.queue.onSubmittedWorkDone();
 }finally{uniforms.destroy();}
}
