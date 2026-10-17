import {DatabaseSync} from 'node:sqlite';
import {Worker,isMainThread,parentPort,workerData} from 'node:worker_threads';
import {createInterface} from 'node:readline';
import {cpus,totalmem,freemem,loadavg,release} from 'node:os';
import {join,resolve,dirname} from 'node:path';
import {makeGarden} from './ext-model.mjs';
import {makeGarden as makeOptimizedGarden} from './ext-model-optimized.mjs';
import {namesFor,setup,seed,measure} from './common.mjs';
function context(file,suffix){
  const conn=new DatabaseSync(file);conn.exec('PRAGMA journal_mode=WAL;PRAGMA synchronous=FULL;PRAGMA busy_timeout=5000;');
  const db={async run(sql,params={}){const statement=conn.prepare(sql);return /\bRETURNING\b/i.test(sql)?{rowsAffected:statement.all(params).length}:{rowsAffected:Number(statement.run(params).changes)};},async get(sql,params={}){return conn.prepare(sql).get(params);},async all(sql,params={}){return conn.prepare(sql).all(params);}};
  const httpGet=async url=>{try{const response=await fetch(url,{signal:AbortSignal.timeout(15000)});const body=await response.text();return {status:response.status,characters:body.length};}catch(error){return {status:null,characters:0,error:error.code||error.name};}};
  return {conn,db,names:namesFor(suffix),garden:makeGarden(db),optimizedGarden:makeOptimizedGarden(db),httpGet,now:()=>performance.now()};
}
if(!isMainThread){
  const ctx=context(workerData.file,workerData.suffix);
  parentPort.on('message',async job=>{try{parentPort.postMessage({id:job.id,result:await measure(ctx,job.input)});}catch(error){parentPort.postMessage({id:job.id,error:error.message});}});
  parentPort.postMessage({ready:true});
}else{
  const file=join(dirname(new URL(import.meta.url).pathname),'fixture.sqlite');
  const suffix=process.argv[2];const ctx=context(file,suffix);const workers=[];
  const metadata=()=>({node:process.version,sqlite:ctx.conn.prepare('SELECT sqlite_version() AS value').get().value,vcpus:cpus().length,memoryMiB:Math.round(totalmem()/1048576),freeMiB:Math.round(freemem()/1048576),load:loadavg(),kernel:release(),usage:process.resourceUsage()});
  const runWorker=(worker,input,id)=>new Promise((res,rej)=>{const reply=message=>{if(message.id!==id)return;worker.off('message',reply);message.error?rej(new Error(message.error)):res(message.result);};worker.on('message',reply);worker.postMessage({id,input});});
  let serial=0;
  const dispatch=async input=>{
    if(input.action==='metadata')return metadata();
    if(input.action==='setup')return setup(ctx.db,ctx.names);
    if(input.action==='seed')return seed(ctx.db,ctx.names,input.size);
    if(input.action==='counterReset'){await ctx.db.run(`UPDATE ${ctx.names.kv} SET value=0 WHERE id=0`);return {reset:true};}
    if(input.action==='counter')return ctx.db.get(`SELECT value FROM ${ctx.names.kv} WHERE id=0`);
    if(input.action==='limitProbe'){
      if(![10000,10001].includes(input.rows))throw new Error('Invalid limit probe');
      const before=await ctx.db.get(`SELECT COUNT(*) AS count FROM ${ctx.names.kv}`);let result,error;
      try{result=await ctx.db.run(`WITH RECURSIVE n(i) AS(VALUES(1) UNION ALL SELECT i+1 FROM n WHERE i<${input.rows}) INSERT INTO ${ctx.names.kv}(id,value) SELECT ${input.rows===10000?20000000:40000000}+i,1 FROM n`);}catch(e){error=e.message;}
      const after=await ctx.db.get(`SELECT COUNT(*) AS count FROM ${ctx.names.kv}`);return {requestedRows:input.rows,rowsBefore:before.count,rowsAfter:after.count,rowsAffected:result?.rowsAffected,error};
    }
    if(input.action==='parallel'){
      while(workers.length<input.jobs.length){const w=new Worker(new URL(import.meta.url),{workerData:{file,suffix}});await new Promise((r,j)=>{w.once('message',r);w.once('error',j);});workers.push(w);}
      const t=performance.now();const results=await Promise.all(input.jobs.map((job,i)=>runWorker(workers[i],job,++serial)));return {results,wallMs:performance.now()-t};
    }
    return measure(ctx,input);
  };
  const rl=createInterface({input:process.stdin});
  for await(const line of rl){let req;try{req=JSON.parse(line);const started=performance.now();const result=await dispatch(req.input);console.log(JSON.stringify({id:req.id,result,runtimeReportedMs:performance.now()-started}));}catch(error){console.log(JSON.stringify({id:req?.id,error:error.message}));}}
  for(const worker of workers)await worker.terminate();ctx.conn.close();
}
