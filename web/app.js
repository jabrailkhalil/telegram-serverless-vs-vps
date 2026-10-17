const $ = id => document.getElementById(id);
const demo = new URLSearchParams(location.search).get('demo') === '1';
const tg = window.Telegram?.WebApp;
let state, receivedAt = 0, busy = false, pendingRequest = null,
  offset = demo ? Number(sessionStorage.getItem('garden-demo-offset') || 0) : 0, blocked = false;
const demoKey = 'telegram-garden-demo-v1';
const now = () => Date.now() + offset;
const requestId = () => crypto.randomUUID();
if (demo) {
  $('demo-notice').hidden = false; $('demo-controls').hidden = false;
  $('mode').textContent = 'ЛОКАЛЬНОЕ ДЕМО';
} else { tg?.ready(); tg?.expand(); }

function demoRead() {
  try { return JSON.parse(localStorage.getItem(demoKey)) || { plantedAt: now(), events: [] }; }
  catch { return { plantedAt: now(), events: [] }; }
}
function demoState(data) {
  const time = now(), completed = data.events.filter(e => e.at <= time - 120000);
  const lastSlot = data.events.at(-1)?.slot;
  return { plantedAt: data.plantedAt, serverNow: time, waters: data.events.length,
    contributors: data.events.length ? 1 : 0, maturedUnits: completed.length * 120,
    activeTimes: data.events.filter(e => e.at > time - 120000).map(e => e.at),
    nextWaterAt: lastSlot === undefined ? time : Math.max(time, (lastSlot + 1) * 60000), build: 'LOCAL DEMO' };
}
async function call(name, input = {}) {
  const start = performance.now();
  if (demo) {
    const data = demoRead(); let accepted = false, reason;
    if (name === 'water') {
      const slot = Math.floor(now() / 60000);
      if (data.events.some(e => e.id === input.requestId)) reason = 'duplicate';
      else if (data.events.some(e => e.slot === slot)) reason = 'cooldown';
      else { data.events.push({ id: input.requestId, slot, at: now() }); accepted = true; reason = 'watered'; }
    }
    localStorage.setItem(demoKey, JSON.stringify(data));
    const s = demoState(data);
    return name === 'water' ? { accepted, reason, state: s } : s;
  }
  if (!tg?.initData || !tg.Serverless?.call) {
    blocked = true; throw new Error('Откройте сад через бота в актуальном приложении Telegram.');
  }
  const result = await new Promise((resolve, reject) => tg.Serverless.call(name, input, (err, value) =>
    err ? reject(new Error(err.message || 'Сад временно недоступен. Попробуйте ещё раз.')) : resolve(value)));
  window.gardenMeasurements = [...(window.gardenMeasurements || []),
    { endpoint: name, roundTripMs: Math.round(performance.now() - start), executionMs: result.executionMs }];
  return result;
}
function takeSnapshot(s) { state = s; receivedAt = Date.now(); render(); }
function serverTime() { return state.serverNow + Date.now() - receivedAt; }
function grow(s, time) { return s.maturedUnits + s.activeTimes.reduce((n, t) => n + Math.max(0, Math.min(120, (time - t) / 1000)), 0); }
function stage(g) {
  return g < 30 ? ['Семечко',0,30] : g < 120 ? ['Росток',1,120] : g < 360 ? ['Саженец',2,360] : g < 960 ? ['Дерево',3,960] : ['Общий сад',4,null];
}
function drawTree(growth, level) {
  const trunkHeight = Math.min(143, 9 + Math.sqrt(growth) * 6), ground = 306, top = ground - trunkHeight;
  let svg = '<ellipse cx="200" cy="309" rx="47" ry="6" fill="#a9b894" opacity=".28"/>';
  svg += `<path d="M200 ${ground} Q194 ${ground-35} 200 ${top}" fill="none" stroke="#6c6545" stroke-width="${3+level*1.4}" stroke-linecap="round"/>`;
  const leaves = level === 0 ? 2 : Math.min(28, 3 + Math.floor(growth / 15));
  for (let i = 0; i < leaves; i++) {
    const side = i % 2 ? -1 : 1, tier = Math.floor(i / 2), tiers = Math.ceil(leaves/2);
    const baseY = ground - 12 - trunkHeight * ((tier + .5) / (tiers + .5));
    const span = level === 0 ? 12 : 20 + 28 * Math.sin((tier + 1)/(tiers + 1) * Math.PI);
    const x = 200 + side * span, y = baseY - 16 - level * 3;
    svg += `<path d="M200 ${baseY} Q${200+side*span*.45} ${baseY-4} ${x} ${y}" stroke="#747a4e" stroke-width="1.8" fill="none"/>`;
    svg += `<ellipse cx="${x}" cy="${y}" rx="${level < 2 ? 9 : 16}" ry="${level < 2 ? 5 : 9}" transform="rotate(${side*-32} ${x} ${y})" fill="${['#81935a','#698a50','#8c9e64','#527849'][i%4]}"/>`;
  }
  svg += '<path d="M182 306q-6-10-10-5m54 5q5-15 9-10m-49 10q-2-9-5-7" stroke="#9aa87b" stroke-width="1.3" fill="none"/>';
  $('tree').innerHTML = svg;
}
function render() {
  if (!state) return;
  const time = serverTime(), growth = grow(state,time), [name,level,next] = stage(growth);
  const waiting = Math.max(0, Math.ceil((state.nextWaterAt - time)/1000));
  const active = state.activeTimes.filter(t => time-t < 120000).length;
  $('stage').textContent = name;
  $('age').textContent = `День ${Math.max(1, Math.floor((time-state.plantedAt)/86400000)+1)}`;
  $('waters').textContent = state.waters; $('people').textContent = state.contributors; $('active').textContent = active;
  $('growth-value').textContent = Math.floor(growth);
  $('growth-caption').textContent = next ? `До следующего этапа · ${Math.max(0,Math.ceil(next-growth))}` : 'Продолжаем расти вместе';
  const previous = [0,30,120,360,960][level];
  $('progress-fill').style.width = `${next ? Math.min(100, (growth-previous)/(next-previous)*100) : 100}%`;
  $('water').disabled = busy || blocked || waiting > 0;
  $('water').innerHTML = busy ? 'Отправляем каплю…' : waiting ? `Следующая капля через ${waiting} сек.` : '<span>↧</span> Полить дерево';
  $('build').textContent = state.build || 'GARDEN'; drawTree(growth,level);
}
function status(text, error = false) { $('status').textContent = text; $('status').classList.toggle('error', error); }
async function refresh() {
  $('refresh').disabled = true;
  try { takeSnapshot(await call('garden')); status(demo ? 'Попробуйте полить и переместиться вперёд во времени.' : 'Сад обновлён.'); }
  catch (e) { status(e.message,true); }
  finally { $('refresh').disabled = false; }
}
$('water').addEventListener('click', async () => {
  if (busy) return;
  busy = true; pendingRequest ||= requestId(); render();
  try {
    const result = await call('water', { requestId: pendingRequest });
    pendingRequest = null; takeSnapshot(result.state);
    status(result.accepted ? 'Твоя капля теперь часть общего сада.' : result.reason === 'duplicate' ? 'Эта капля уже в саду.' : 'Немного подождём до следующего полива.');
    if (!demo && result.accepted) tg?.HapticFeedback?.notificationOccurred('success');
  } catch (e) { status(e.message,true); }
  finally { busy = false; render(); }
});
$('refresh').addEventListener('click',refresh);
$('advance').addEventListener('click', () => { offset += 120000; sessionStorage.setItem('garden-demo-offset',String(offset)); refresh(); });
$('reset').addEventListener('click', () => { localStorage.removeItem(demoKey); sessionStorage.removeItem('garden-demo-offset'); offset = 0; pendingRequest = null; refresh(); });
setInterval(render,1000); refresh();
