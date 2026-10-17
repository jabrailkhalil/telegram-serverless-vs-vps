import { parentPort, workerData } from 'node:worker_threads';
import { connect } from './sqlite-adapter.mjs';
import { makeGarden } from '../tgcloud/lib/model.js';
const db = connect(workerData.filename, false);
parentPort.postMessage({ ready: true });
parentPort.once('message', async () => {
  try {
    const result = await makeGarden(db, () => workerData.now).water(workerData.actor, workerData.event);
    parentPort.postMessage({ accepted: result.accepted });
  } catch (error) { parentPort.postMessage({ error: error.message }); }
  finally { db.close(); parentPort.close(); }
});
