import { EndpointError } from 'sdk';
import { garden } from '../lib/service.js';
import { BUILD } from '../lib/config.js';
export default async function (_input, ctx) {
  const id = ctx?.initData?.user?.id;
  if (!Number.isSafeInteger(id) || id <= 0) throw new EndpointError('Откройте сад внутри Telegram.');
  const started = Date.now();
  return { ...await garden.snapshot(id), build: BUILD, executionMs: Date.now() - started };
}
