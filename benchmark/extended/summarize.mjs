import {readFile,writeFile} from 'node:fs/promises';
import {dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
const directory=join(dirname(fileURLToPath(import.meta.url)),'results');
const raw=JSON.parse(await readFile(join(directory,'consolidated.json'),'utf8'));
function stats(values){
  if(!values.length)return null;
  if(values.some(n=>!Number.isFinite(n)||n<0))throw new Error('Invalid sample');
  const sorted=[...values].sort((a,b)=>a-b);const q=p=>sorted[Math.max(0,Math.ceil(sorted.length*p)-1)];
  return {n:sorted.length,minMs:sorted[0],p50Ms:q(.5),p95Ms:q(.95),p99Ms:q(.99),maxMs:sorted.at(-1),meanMs:values.reduce((a,b)=>a+b,0)/values.length};
}
const summary={startedAt:raw.startedAt,finishedAt:raw.finishedAt,pilot:raw.pilot,provenance:raw.provenance,observedLimits:raw.observedLimits,errors:raw.errors,cleanup:raw.cleanup,productionBefore:raw.productionBefore,productionAfter:raw.productionAfter,finalProbe:raw.finalProbe,queryBoundaries:raw.queryBoundaries,deployedRevisionUnchanged:raw.deployedRevisionUnchanged,deployedSourcesUnchanged:raw.deployedSourcesUnchanged,environments:{}};
const csv=['environment,group,case,size,concurrency,n,p50_ms,p95_ms,max_ms'];
const add=(env,group,mode,size,level,s)=>{if(s)csv.push([env,group,mode,size??'',level??'',s.n,s.p50Ms,s.p95Ms,s.maxMs].join(','));};
for(const [alias,env]of Object.entries(raw.environments)){
  const result=summary.environments[alias]={micro:{},pure:{},scale:{},scaleErrors:{},concurrency:{},independent:{},outbound:{},metadata:env.metadataBefore,filesystem:env.filesystem,counter:env.counter,concurrencyScope:env.concurrencyScope,scaleFailures:env.scaleFailures};
  const microNames=[...new Set(env.rounds.flatMap(r=>Object.keys(r.cases)))];
  for(const mode of microNames){const runs=env.rounds.map(r=>r.cases[mode]).filter(Boolean);result.micro[mode]=stats(runs.flatMap(r=>r.samplesMs));add(alias,'micro',mode,null,null,result.micro[mode]);}
  for(const mode of ['cpu','json']){const runs=(env.pure||[]).filter(r=>r.mode===mode);result.pure[mode]={batchRuntime:stats(runs.map(r=>r.runtimeReportedMs)),normalizedPerIteration:stats(runs.map(r=>r.runtimeReportedMs/r.iterations)),blocks:runs.length,iterations:runs.reduce((n,r)=>n+r.iterations,0),iterationsPerBlock:runs[0]?.iterations,jsonBytes:runs[0]?.jsonBytes,checksums:[...new Set(runs.map(r=>r.last))]};add(alias,'pureBlockMean',mode,null,null,result.pure[mode].normalizedPerIteration);}
  for(const size of [...new Set((env.scale||[]).map(r=>r.size))]){
    result.scale[size]={};result.scaleErrors[size]={};for(const mode of ['gardenRead','gardenReadNoEnsure','gardenWater']){const runs=env.scale.filter(r=>r.size===size);const values=runs.flatMap(r=>r.cases[mode].samplesMs);result.scale[size][mode]=stats(values);result.scaleErrors[size][mode]=runs.filter(r=>r.cases[mode].error).map(r=>({round:r.round,error:r.cases[mode].error}));add(alias,'scale',mode,size,null,result.scale[size][mode]);}
  }
  for(const level of [...new Set(env.concurrency.map(r=>r.level))]){
    result.concurrency[level]={};for(const mode of ['indexedRead','increment']){
      const runs=env.concurrency.filter(r=>r.level===level&&r.mode===mode);
      result.concurrency[level][mode]={execution:stats(runs.flatMap(r=>r.results.flatMap(x=>x.samplesMs))),controllerBatch:stats(runs.map(r=>r.controllerWallMs))};
      add(alias,'concurrency',mode,null,level,result.concurrency[level][mode].execution);
    }
  }
  for(const mode of ['noop','select1','gardenRead']){const runs=(env.independent||[]).filter(r=>r.mode===mode);result.independent[mode]={execution:stats(runs.flatMap(r=>r.samplesMs)),controllerRoundTrip:stats(runs.map(r=>r.controllerRoundTripMs).filter(Number.isFinite)),runtimeReported:stats(runs.filter(r=>r.runtimeReportedMs!==undefined).map(r=>r.runtimeReportedMs))};add(alias,'independent',mode,null,null,result.independent[mode].execution);}
  for(const url of [...new Set((env.outbound||[]).map(r=>r.url))]){const runs=env.outbound.filter(r=>r.url===url);const attempts=runs.flatMap(r=>r.samplesMs.map((ms,i)=>({ms,...(r.outcomes?.[i]||r.last)})));result.outbound[url]={allAttempts:stats(attempts.map(r=>r.ms)),successTiming:stats(attempts.filter(r=>r.status===200).map(r=>r.ms)),failures:attempts.filter(r=>r.status!==200).length,successes:attempts.filter(r=>r.status===200).length,responses:runs.map(r=>r.last)};add(alias,'outbound',url,null,null,result.outbound[url].successTiming);}
}
const cpuChecks=Object.values(raw.environments).flatMap(e=>(e.pure||[]).filter(r=>r.mode==='cpu').map(r=>r.last));
const jsonChecks=Object.values(raw.environments).flatMap(e=>(e.pure||[]).filter(r=>r.mode==='json').map(r=>r.last));
summary.correctness={cpuChecksumsMatch:cpuChecks.length>0&&new Set(cpuChecks).size===1,jsonChecksumsMatch:jsonChecks.length>0&&new Set(jsonChecks).size===1,originalGardenPreserved:raw.productionBefore?.waters===raw.productionAfter?.waters,fixtureCleanupConfirmed:Object.values(raw.cleanup).length===3&&Object.values(raw.cleanup).every(c=>c.cleaned)&&raw.finalProbe.temporaryTables.length===0,countersMatch:Object.values(raw.environments).every(e=>e.counter.value===65),deployedRevisionUnchanged:raw.deployedRevisionUnchanged,deployedSourcesUnchanged:raw.deployedSourcesUnchanged};
summary.correctness.expectedSampleCountsMatch=Object.entries(summary.environments).every(([alias,e])=>
  ['select1','indexedRead','increment'].every(k=>e.micro[k].n===150)&&
  ['write32Separate','write32Batch'].every(k=>e.micro[k].n===30)&&
  ['cpu','json'].every(k=>e.pure[k].blocks===30)&&
  [1000,10000,100000].every(size=>['gardenRead','gardenReadNoEnsure','gardenWater'].every(k=>alias==='telegram'&&size===100000?e.scale[size][k]===null&&e.scaleErrors[size][k].length===3:e.scale[size][k].n===(k==='gardenWater'?60:90)))&&
  [1,4,8].every(level=>['indexedRead','increment'].every(k=>e.concurrency[level][k].execution.n===level*5))&&e.independent.noop.runtimeReported.n===10);
if(!Object.values(summary.correctness).every(Boolean))throw new Error('Final dataset failed integrity checks');
await writeFile(join(directory,'summary.json'),JSON.stringify(summary,null,2));await writeFile(join(directory,'metrics.csv'),csv.join('\n')+'\n');
console.log(JSON.stringify({pilot:raw.pilot,errors:summary.errors,correctness:summary.correctness,micro:Object.fromEntries(Object.entries(summary.environments).map(([k,v])=>[k,v.micro]))},null,2));
