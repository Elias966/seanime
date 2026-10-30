'use strict';
// Unpacks a downloaded season archive next to it. Zip files are read here (stored and deflate, zip64 for big seasons)
// and every file is checked against the size and CRC32 the zip records; 7z and rar use 7-Zip or unrar when installed,
// which check their own checksums. The caller deletes the archive only once this resolves.
const fs=require('fs'),path=require('path'),zlib=require('zlib'),{execFile}=require('child_process');
const VIDEO=/\.(mkv|mp4|m4v|avi|webm|mov|ts|wmv|flv)$/i,ARCHIVE=/\.(zip|7z|rar)$/i;

function readAt(fd,pos,len){const b=Buffer.alloc(len);const n=fs.readSync(fd,b,0,len,pos);return b.subarray(0,n)}
const u64=(b,o)=>Number(b.readBigUInt64LE(o));

function zipEntries(file){
 const fd=fs.openSync(file,'r');
 try{
  const size=fs.fstatSync(fd).size,tailLen=Math.min(size,65557),tail=readAt(fd,size-tailLen,tailLen);
  let e=-1;for(let i=tail.length-22;i>=0;i--)if(tail.readUInt32LE(i)===0x06054b50){e=i;break}
  if(e<0)throw Error('This is not a zip file or it is damaged');
  let count=tail.readUInt16LE(e+10),cdSize=tail.readUInt32LE(e+12),cdOff=tail.readUInt32LE(e+16);
  if(count===0xffff||cdSize===0xffffffff||cdOff===0xffffffff){
   const loc=e-20;if(loc<0||tail.readUInt32LE(loc)!==0x07064b50)throw Error('The zip file is damaged');
   const z=readAt(fd,u64(tail,loc+8),56);if(z.readUInt32LE(0)!==0x06064b50)throw Error('The zip file is damaged');
   count=u64(z,32);cdSize=u64(z,40);cdOff=u64(z,48);
  }
  const cd=readAt(fd,cdOff,cdSize),entries=[];let p=0;
  for(let i=0;i<count;i++){
   if(cd.readUInt32LE(p)!==0x02014b50)throw Error('The zip file is damaged');
   const flags=cd.readUInt16LE(p+8),method=cd.readUInt16LE(p+10),crc=cd.readUInt32LE(p+16),nl=cd.readUInt16LE(p+28),xl=cd.readUInt16LE(p+30),cl=cd.readUInt16LE(p+32);
   let csize=cd.readUInt32LE(p+20),usize=cd.readUInt32LE(p+24),local=cd.readUInt32LE(p+42);
   const raw=cd.subarray(p+46,p+46+nl),name=(flags&0x800)?raw.toString('utf8'):raw.toString('latin1');
   for(let x=p+46+nl,end=x+xl;x+4<=end;){const id=cd.readUInt16LE(x),len=cd.readUInt16LE(x+2);if(id===1){let q=x+4;if(usize===0xffffffff){usize=u64(cd,q);q+=8}if(csize===0xffffffff){csize=u64(cd,q);q+=8}if(local===0xffffffff)local=u64(cd,q)}x+=4+len}
   entries.push({name,flags,method,crc,csize,usize,local});p+=46+nl+xl+cl;
  }
  for(const en of entries){const h=readAt(fd,en.local,30);if(h.readUInt32LE(0)!==0x04034b50)throw Error('The zip file is damaged');en.data=en.local+30+h.readUInt16LE(26)+h.readUInt16LE(28)}
  return entries;
 }finally{fs.closeSync(fd)}
}

function target(dest,name){
 const rel=name.replace(/\\/g,'/').split('/').filter(s=>s&&s!=='.');
 if(!rel.length||rel.includes('..')||path.isAbsolute(name)||/^[a-z]:/i.test(name))return null;
 const out=path.resolve(dest,...rel);return out.startsWith(path.resolve(dest)+path.sep)?out:null;
}

function extractEntry(file,en,out,onBytes){
 return new Promise((resolve,reject)=>{
  fs.mkdirSync(path.dirname(out),{recursive:true});const part=out+'.part';
  if(!en.csize){if(en.usize)return reject(Error('The zip file is damaged: '+en.name));fs.writeFileSync(out,'');return resolve(out)}
  let crc=0,size=0;const src=fs.createReadStream(file,{start:en.data,end:en.data+en.csize-1});
  const stream=en.method===8?src.pipe(zlib.createInflateRaw()):src,dst=fs.createWriteStream(part);
  const fail=err=>{src.destroy();dst.destroy();fs.rm(part,{force:true},()=>reject(err))};
  src.on('error',fail);stream.on('error',()=>fail(Error('The zip file is damaged: '+en.name)));dst.on('error',fail);
  stream.on('data',c=>{crc=zlib.crc32(c,crc);size+=c.length;onBytes(c.length)});
  dst.on('finish',()=>{
   if(size!==en.usize||(crc>>>0)!==en.crc)return fail(Error('A file in the zip did not check out: '+en.name));
   fs.rename(part,out,err=>err?fail(err):resolve(out));
  });
  stream.pipe(dst);
 });
}

async function extractZip(file,dest,onProgress){
 const entries=zipEntries(file).filter(en=>!en.name.startsWith('__MACOSX/')&&!/(^|\/)\.DS_Store$/.test(en.name));
 if(entries.some(en=>en.flags&1))throw Error('The zip is password protected');
 const bad=entries.find(en=>!en.name.endsWith('/')&&en.method!==0&&en.method!==8);if(bad)throw Error('The zip uses a packing method that is not supported');
 const files=entries.filter(en=>!en.name.endsWith('/')),total=files.reduce((n,en)=>n+en.usize,0);
 await freeSpace(dest,total);
 const written=[];let done=0;
 for(const en of files){const out=target(dest,en.name);if(!out)throw Error('The zip has an unsafe file name: '+en.name);written.push(await extractEntry(file,en,out,n=>{done+=n;onProgress?.(done,total)}))}
 return written;
}

async function freeSpace(dest,need){
 try{const s=await fs.promises.statfs(dest);if(s.bavail*s.bsize<need+64*1024*1024)throw Error('Not enough free space to unpack, '+Math.ceil(need/1e9)+' GB is needed')}catch(e){if(/free space/.test(e.message))throw e}
}

const run=(cmd,args)=>new Promise((resolve,reject)=>execFile(cmd,args,{maxBuffer:64*1024*1024},(err,out,errOut)=>err?reject(Object.assign(err,{output:String(errOut||out)})):resolve(String(out))));
const has=async cmd=>{try{await run(cmd,['--help']);return true}catch(e){return e.code!=='ENOENT'}};

// 7z and rar: test the archive first, then unpack, then list what it holds so the caller can check the files are there
async function extractOther(file,dest){
 const seven=await has('7z')?'7z':await has('7za')?'7za':'';
 if(seven){
  await run(seven,['t','-y',file]).catch(e=>{throw Error('The archive is damaged: '+(e.output||'').trim().split('\n').pop())});
  const list=await run(seven,['l','-ba','-slt',file]),items=[];let cur={};
  for(const line of list.split('\n')){const m=/^(Path|Size|Folder) = (.*)$/.exec(line.trim());if(m)cur[m[1]]=m[2];if(!line.trim()&&cur.Path){items.push(cur);cur={}}}if(cur.Path)items.push(cur);
  const files=items.filter(x=>x.Folder!=='+');for(const x of files)if(!target(dest,x.Path))throw Error('The archive has an unsafe file name: '+x.Path);
  await freeSpace(dest,files.reduce((n,x)=>n+(+x.Size||0),0));
  await run(seven,['x','-y','-aoa','-o'+dest,file]);
  return files.map(x=>{const out=target(dest,x.Path);if(!fs.existsSync(out)||fs.statSync(out).size!==(+x.Size||0))throw Error('A file did not unpack fully: '+x.Path);return out});
 }
 if(/\.rar$/i.test(file)&&await has('unrar')){
  await run('unrar',['t','-y','-idq',file]).catch(()=>{throw Error('The archive is damaged')});
  const names=(await run('unrar',['lb',file])).split('\n').map(s=>s.trim()).filter(Boolean);for(const n of names)if(!target(dest,n))throw Error('The archive has an unsafe file name: '+n);
  await run('unrar',['x','-o+','-y','-idq',file,dest+path.sep]);
  return names.map(n=>target(dest,n)).filter(p=>fs.existsSync(p)&&fs.statSync(p).isFile());
 }
 throw Error('Install 7-Zip (p7zip) to unpack '+path.extname(file)+' files');
}

/** Unpacks `file` into `dest` and resolves with the episodes found, throws when anything does not check out. */
async function extractArchive(file,dest,onProgress){
 const written=/\.zip$/i.test(file)?await extractZip(file,dest,onProgress):await extractOther(file,dest);
 const videos=written.filter(p=>VIDEO.test(p));
 if(!videos.length)throw Error('No episodes were found in the archive');
 return videos;
}

module.exports={extractArchive,ARCHIVE,VIDEO,zipEntries};
