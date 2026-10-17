import { db } from 'sdk';
import { makeGarden } from '../lib/bench_model.js';
import { runScenario, fixtureSql } from '../lib/bench_scenario.js';

export default async function (input) {
  const {gardens,events,index,action} = input;
  for (const name of [gardens,events,index]) if (!/^lab_bench_[a-z0-9_]+$/.test(name)) throw new Error('Unsafe fixture name');
  if (action === 'setup') {
    for (const sql of fixtureSql(gardens,events,index)) await db.run(sql);
    const info=async sql=>{try{return await db.get(sql)}catch(e){return {unavailable:true,reason:e.message}}};
    return {seedRows:1000, timer:typeof performance === 'object' ? 'performance.now' : 'Date.now',
      sqlite:await info('SELECT sqlite_version() AS version'),
      journalMode:await info('PRAGMA journal_mode'), synchronous:await info('PRAGMA synchronous')};
  }
  if (action === 'cleanup') {
    await db.run(`DROP TABLE IF EXISTS ${events}`); await db.run(`DROP TABLE IF EXISTS ${gardens}`);
    return {cleaned:true};
  }
  const garden = makeGarden(db);
  if (action === 'single') {
    const started = Date.now();
    const result = await garden.water(input.actor, input.event);
    return {accepted:result.accepted,reason:result.reason,executionMs:Date.now()-started};
  }
  return runScenario(garden,action,()=>Date.now());
}
