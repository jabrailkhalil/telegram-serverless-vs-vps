import { EndpointError } from 'sdk';
import { garden } from '../lib/service.js';
import { BUILD } from '../lib/config.js';
export default async function (input, ctx) {
  const id = ctx?.initData?.user?.id;
  if (!Number.isSafeInteger(id) || id <= 0) throw new EndpointError('Откройте сад внутри Telegram.');
  if (typeof input?.requestId !== 'string' || !/^[a-zA-Z0-9_-]{8,64}$/.test(input.requestId)) {
    throw new EndpointError('Не удалось распознать полив. Попробуйте ещё раз.');
  }
  const started = Date.now();
  const result = await garden.water(id, `app:${id}:${input.requestId}`);
  return { ...result, state: { ...result.state, build: BUILD }, executionMs: Date.now() - started };
}
