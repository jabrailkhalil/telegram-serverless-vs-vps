import {db,fetch as sdkFetch} from 'sdk';
import {makeGarden} from '../lib/ext_model.js';
import {makeGarden as makeOptimizedGarden} from '../lib/ext_model_optimized.js';
import {namesFor,setup,seed,cleanup,measure} from '../lib/ext_common.js';
export default async function(input) {
  const names=namesFor(input.suffix);
  if(input.action==='setup')return setup(db,names);
  if(input.action==='seed')return seed(db,names,input.size);
  if(input.action==='cleanup')return cleanup(db,names);
  if(input.action==='counterReset'){await db.run(`UPDATE ${names.kv} SET value=0 WHERE id=0`);return {reset:true};}
  if(input.action==='counter')return db.get(`SELECT value FROM ${names.kv} WHERE id=0`);
  if(input.action==='concurrencySuite'){
    await db.run(`UPDATE ${names.kv} SET value=0 WHERE id=0`);const rounds=[];
    const context={db,names,garden:makeGarden(db),optimizedGarden:makeOptimizedGarden(db),now:()=>Date.now()};
    for(const level of [1,4,8])for(const mode of ['indexedRead','increment'])for(let round=0;round<5;round++){
      const started=Date.now();const results=await Promise.all(Array.from({length:level},()=>measure(context,{mode,count:1,warmup:0})));rounds.push({level,mode,round,results,controllerWallMs:Date.now()-started});
    }
    const counter=await db.get(`SELECT value FROM ${names.kv} WHERE id=0`);if(counter.value!==65)throw new Error('Lost concurrent writes');return {rounds,counter};
  }
  if(input.action==='limitProbe'){
    if(![10000,10001].includes(input.rows))throw new Error('Invalid limit probe');
    const before=await db.get(`SELECT COUNT(*) AS count FROM ${names.kv}`);let result,error;
    try{result=await db.run(`WITH RECURSIVE n(i) AS(VALUES(1) UNION ALL SELECT i+1 FROM n WHERE i<${input.rows}) INSERT INTO ${names.kv}(id,value) SELECT ${input.rows===10000?20000000:40000000}+i,1 FROM n`);}catch(e){error=String(e.message).slice(0,200);}
    const after=await db.get(`SELECT COUNT(*) AS count FROM ${names.kv}`);return {requestedRows:input.rows,rowsBefore:before.count,rowsAfter:after.count,rowsAffected:result?.rowsAffected,error};
  }
  const httpGet=async url=>{
    if(!['https://telegram.org/js/telegram-web-app.js','https://app8881637352.tgcloud.ai/'].includes(url))throw new Error('Unexpected outbound target');
    try{const response=await sdkFetch(url);const body=await response.text();return {status:response.status,characters:body.length};}
    catch(error){return {status:null,characters:0,error:String(error.message).slice(0,160)};}
  };
  return measure({db,names,garden:makeGarden(db),optimizedGarden:makeOptimizedGarden(db),httpGet,now:()=>Date.now()},input);
}
