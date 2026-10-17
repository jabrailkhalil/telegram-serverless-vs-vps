import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { Worker } from 'node:worker_threads';
import { connect } from './sqlite-adapter.mjs';
import { makeGarden, growthAt, stageAt } from '../tgcloud/lib/model.js';

const start = 1_800_000_000_000;
const testRoot = resolve(process.env.GARDEN_TEST_WORKDIR || 'work/garden-tests');
mkdirSync(testRoot, { recursive: true });
const freshFile = name => resolve(testRoot, `${name}-${Date.now()}-${Math.random().toString(16).slice(2)}.sqlite`);
function fixture() {
  const db = connect(); let now = start;
  return { db, garden: makeGarden(db, () => now), advance: ms => now += ms };
}
async function race(filename, sameActor) {
  const workers = Array.from({ length: 12 }, (_, i) => new Worker(new URL('./water-worker.mjs', import.meta.url),
    { workerData: { filename, now: start, actor: sameActor ? 77 : i+1, event: `race:${i}` } }));
  try {
    await Promise.all(workers.map(w => new Promise((resolve,reject) => { w.once('message',resolve); w.once('error',reject); })));
    const results = workers.map(w => new Promise((resolve,reject) => { w.once('message',resolve); w.once('error',reject); }));
    workers.forEach(w => w.postMessage('go'));
    const values = await Promise.all(results);
    for (const value of values) assert.equal(value.error,undefined);
    return values.filter(v => v.accepted).length;
  } finally { await Promise.all(workers.map(w => w.terminate())); }
}

test('empty garden has no phantom growth or contributors', async () => {
  const f = fixture(); const s = await f.garden.snapshot(1);
  assert.equal(s.waters,0); assert.equal(s.contributors,0); assert.equal(s.growthUnits,0); f.db.close();
});
test('growth can be reconstructed after 30 seconds with no intervening calls', async () => {
  const f = fixture(); await f.garden.water(1,'first'); f.advance(30000);
  const s = await f.garden.snapshot(1); assert.equal(s.growthUnits,30); assert.equal(stageAt(s.growthUnits).name,'Росток'); f.db.close();
});
test('one drop stops contributing after 120 seconds, even after a day offline', async () => {
  const f = fixture(); await f.garden.water(1,'first'); f.advance(86400000);
  const s = await f.garden.snapshot(1); assert.equal(s.growthUnits,120); assert.deepEqual(s.activeTimes,[]); f.db.close();
});
test('two users contribute independent growth intervals', async () => {
  const f = fixture(); await f.garden.water(1,'a'); f.advance(30000); await f.garden.water(2,'b'); f.advance(30000);
  const s = await f.garden.snapshot(1); assert.equal(s.growthUnits,90); assert.equal(s.contributors,2); f.db.close();
});
test('replayed event stays deduplicated after the minute changes', async () => {
  const f = fixture(); await f.garden.water(1,'replay'); f.advance(120000);
  const r = await f.garden.water(1,'replay'); assert.equal(r.reason,'duplicate'); assert.equal(r.state.waters,1); f.db.close();
});
test('different event sources share the same per-user minute limit', async () => {
  const f = fixture(); await f.garden.water(1,'tg:1');
  const r = await f.garden.water(1,'app:1:request123'); assert.equal(r.reason,'cooldown'); assert.equal(r.state.waters,1); f.db.close();
});
test('minute limit is a fixed bucket rather than a rolling 60-second cooldown', async () => {
  const f = fixture(); f.advance(59999); await f.garden.water(1,'before'); f.advance(1);
  const r = await f.garden.water(1,'after'); assert.equal(r.accepted,true); assert.equal(r.state.waters,2); f.db.close();
});
test('invalid event identifiers cannot reach SQL', async () => {
  const f = fixture(); await assert.rejects(f.garden.water(1,"x'); DROP TABLE water_events;--"));
  await assert.rejects(f.garden.water(-1,'valid')); assert.equal((await f.garden.snapshot(1)).waters,0); f.db.close();
});
test('a new service instance and database connection retain the planted date and events', async () => {
  const filename = freshFile('persist'); let db = connect(filename);
  await makeGarden(db, () => start).water(1,'persisted'); db.close(); db = connect(filename);
  const s = await makeGarden(db, () => start+120000).snapshot(1);
  assert.equal(s.waters,1); assert.equal(s.plantedAt,start); assert.equal(s.growthUnits,120); db.close();
});
test('12 simultaneous connections from one user accept exactly one drop', async () => {
  const filename = freshFile('same-user'); const db = connect(filename);
  assert.equal(await race(filename,true),1);
  assert.equal((await makeGarden(db, () => start).snapshot(77)).waters,1); db.close();
});
test('12 simultaneous connections from different users lose no drops', async () => {
  const filename = freshFile('different-users'); const db = connect(filename);
  assert.equal(await race(filename,false),12);
  const s = await makeGarden(db, () => start).snapshot(1); assert.equal(s.waters,12); assert.equal(s.contributors,12); db.close();
});
test('client extrapolation matches a later authoritative snapshot', async () => {
  const f = fixture(); await f.garden.water(1,'a'); f.advance(30000); await f.garden.water(2,'b');
  const earlier = await f.garden.snapshot(1); f.advance(180000); const later = await f.garden.snapshot(1);
  assert.equal(growthAt(earlier,later.serverNow),later.growthUnits); f.db.close();
});
