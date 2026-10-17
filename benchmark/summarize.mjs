import {readFile,writeFile} from 'node:fs/promises';
import {dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
const dir=join(dirname(fileURLToPath(import.meta.url)),'results');
function stats(values){
  const a=values.toSorted((a,b)=>a-b);
  if(!a.length) return null;
  return {n:a.length,minMs:a[0],p50Ms:a[Math.ceil(a.length*.5)-1],p95Ms:a[Math.ceil(a.length*.95)-1],maxMs:a.at(-1),meanMs:a.reduce((s,x)=>s+x,0)/a.length};
}
const summary={date:'2026-10-10',quantiles:'nearest rank',environments:{},network:{}};
for(const name of ['telegram','fi','de']){
  const r=JSON.parse(await readFile(join(dir,`${name}.json`),'utf8'));
  const env={modes:{},concurrent:{same:[],different:[]}};
  for(const mode of ['read','water','replay']){
    const x=r.modes[mode];
    if(x.samplesMs.length!==50 || x.samplesMs.some(x=>!Number.isFinite(x)||x<0)) throw new Error(`Invalid ${name} ${mode} samples`);
    if(mode==='water' && (x.accepted!==50 || x.final.waters!==1055)) throw new Error(`Write correctness failed ${name}`);
    if(mode==='replay' && (x.accepted!==0 || x.final.waters!==1055)) throw new Error(`Deduplication failed ${name}`);
    if(mode==='read' && x.final.waters!==1000) throw new Error(`Seed count failed ${name}`);
    env.modes[mode]=stats(x.samplesMs);
  }
  for(const x of r.concurrent){
    const accepted=x.results.filter(v=>v.accepted).length;
    const expected=x.mode==='same'?1:4;
    if(x.results.length!==4 || accepted!==expected || x.results.some(v=>v.error)) throw new Error(`Concurrency failed ${name}`);
    env.concurrent[x.mode].push({round:x.round,accepted,requests:4,timing:stats(x.results.map(v=>v.executionMs))});
  }
  if(env.concurrent.same.length!==3 || env.concurrent.different.length!==3) throw new Error('Missing rounds');
  env.metadata=r.metadataBefore||null;
  env.maxRssMiB=r.processUsage?r.processUsage.maxRSS/1024:null;
  env.cpuTimeMs=r.processUsage?(r.processUsage.userCPUTime+r.processUsage.systemCPUTime)/1000:null;
  env.sqlite=r.sqlite||r.setup.sqlite;
  env.journalMode=r.journalMode||r.setup.journalMode;
  env.synchronous=r.synchronous||r.setup.synchronous;
  summary.environments[name]=env;
}
const network=JSON.parse(await readFile(join(dir,'network.json'),'utf8'));
for(const [name,{samples}] of Object.entries(network.hosts)){
  const ok=samples.filter(s=>!s.error);
  summary.network[name]={attempts:samples.length,errors:samples.length-ok.length,tls:stats(ok.map(s=>s.tlsMs)),
    tcpLocalTunnel:stats(ok.map(s=>s.tcpMs)),protocols:[...new Set(ok.map(s=>s.protocol))],sessionsReused:ok.filter(s=>s.sessionReused).length};
}
const cleanup=JSON.parse(await readFile(join(dir,'cleanup.json'),'utf8')).result;
if(cleanup.remaining.length || cleanup.gardenWatersBefore!==cleanup.gardenWatersAfter) throw new Error('Fixture cleanup not verified');
summary.cleanup={temporaryCloudTablesRemaining:0,liveGardenWaterCountPreserved:cleanup.gardenWatersAfter};
await writeFile(join(dir,'summary.json'),JSON.stringify(summary,null,2));
const csv=['environment,operation,samples,p50_ms,p95_ms,max_ms,mean_ms'];
for(const [name,e] of Object.entries(summary.environments)) for(const [mode,s] of Object.entries(e.modes)) csv.push([name,mode,s.n,s.p50Ms,s.p95Ms,s.maxMs,s.meanMs].join(','));
await writeFile(join(dir,'metrics.csv'),csv.join('\n')+'\n');
console.log(JSON.stringify(summary,null,2));
