import { DatabaseSync } from 'node:sqlite';
import { mkdtemp, rm } from 'node:fs/promises';
import { join, resolve, dirname, basename } from 'node:path';
import { tmpdir, cpus, totalmem, freemem, loadavg, release } from 'node:os';
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { makeGarden } from './bench-model.mjs';
import { fixtureSql, runScenario } from './scenario.mjs';

const names = {gardens:'lab_bench_gardens',events:'lab_bench_events',index:'lab_bench_actor_slot'};
const metadata = () => ({node:process.version,cpus:cpus().length,cpuModel:cpus()[0]?.model,
  totalMemoryMiB:Math.round(totalmem()/1048576),freeMemoryMiB:Math.round(freemem()/1048576),
  load:loadavg(),kernel:release()});
function connect(path) {
  const conn = new DatabaseSync(path);
  conn.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000;');
  const db = {
    async run(sql,params={}) {const stmt=conn.prepare(sql); if (/\bRETURNING\b/i.test(sql)) {const rows=stmt.all(params); return {rowsAffected:rows.length};} return {rowsAffected:Number(stmt.run(params).changes)};},
    async get(sql,params={}) {return conn.prepare(sql).get(params)}
  };
  return {conn,garden:makeGarden(db)};
}

if (!isMainThread) {
  const {conn,garden} = connect(workerData.path);
  parentPort.on('message',async job=>{
    try {const t=performance.now(); const result=await garden.water(job.actor,job.event);
      parentPort.postMessage({accepted:result.accepted,reason:result.reason,executionMs:performance.now()-t});
    } catch(e) {parentPort.postMessage({error:e.message});}
  });
  parentPort.postMessage({ready:true});
} else {
  const dir=await mkdtemp(join(tmpdir(),'telegram-garden-benchmark-'));
  const path=join(dir,'benchmark.sqlite');
  const {conn,garden}=connect(path);
  const workers=[];
  const results={environment:'VPS Node.js + SQLite',timer:'performance.now',metadataBefore:metadata(),modes:{},concurrent:[]};
  const started=performance.now();
  try {
    for(const sql of fixtureSql(names.gardens,names.events,names.index)) conn.exec(sql);
    results.sqlite=conn.prepare('SELECT sqlite_version() AS version').get().version;
    results.journalMode=conn.prepare('PRAGMA journal_mode').get();
    results.synchronous=conn.prepare('PRAGMA synchronous').get();
    for(const mode of ['read','water','replay']) results.modes[mode]=await runScenario(garden,mode,()=>performance.now());
    for(let i=0;i<4;i++) {
      const worker=new Worker(new URL(import.meta.url),{workerData:{path}});
      await new Promise((r,j)=>{worker.once('message',r);worker.once('error',j)}); workers.push(worker);
    }
    for(const mode of ['same','different']) {
      for(let round=0;round<3;round++) {
        const promises=workers.map((worker,i)=>new Promise((r,j)=>{
          worker.once('message',r);worker.once('error',j);
          worker.postMessage({actor:80000001000000+(mode==='same' ? round : 100+round*4+i),event:`concurrent:${mode}:${round}:${i}`});
        }));
        results.concurrent.push({mode,round,results:await Promise.all(promises)});
      }
    }
    results.final=await garden.snapshot(80000000000100);
    results.durationMs=performance.now()-started;
    results.metadataAfter=metadata();
    results.processUsage=process.resourceUsage();
    console.log(JSON.stringify(results));
  } finally {
    for(const worker of workers) await worker.terminate();
    conn.close();
    // Only the random temporary directory created above belongs to this run.
    if (dirname(resolve(dir)) !== resolve(tmpdir()) || !basename(dir).startsWith('telegram-garden-benchmark-')) throw new Error('Unexpected cleanup path');
    await rm(dir,{recursive:true});
  }
}
