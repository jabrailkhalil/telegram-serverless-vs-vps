import { garden } from '../lib/service.js';
import { sendGarden } from '../lib/reply.js';

export default async function (message, ctx) {
  if (!message.from || message.from.is_bot) return;
  const command = (message.text || '').trim().split(/\s+/)[0].split('@')[0];
  if (!['/start', '/garden', '/water', '/help'].includes(command)) return;
  const actor = message.from.id;
  if (command === '/water') {
    const updateId = ctx?.update?.update_id;
    if (!Number.isSafeInteger(updateId)) throw new Error('Missing update_id');
    const result = await garden.water(actor, `tg:${updateId}`);
    if (result.reason === 'duplicate') return;
    const wait = Math.ceil((result.state.nextWaterAt - result.state.serverNow) / 1000);
    await sendGarden(message.chat.id, result.state,
      result.accepted ? 'Капля принята. Спасибо за полив!' : `Следующий полив через ${wait} сек.`);
    return;
  }
  await sendGarden(message.chat.id, await garden.snapshot(actor));
}
