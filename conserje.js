#!/usr/bin/env node
// Conserje · fase 0: YouTube -> avisos + página de novedades. Sin dependencias (Node 18+).
const fs = require('fs'), path = require('path');
const ROOT = __dirname, STATE = path.join(ROOT, 'state.json'), SITE = path.join(ROOT, 'site', 'index.html');

// ---------- utilidades ----------
const norm = s => (s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
function hasTerm(text, term) {                       // palabra completa, sin importar tildes ni mayúsculas
  const t = norm(term).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp('(^|[^a-z0-9])' + t + '([^a-z0-9]|$)').test(norm(text));
}
const parts = (d, tz) => Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit' }).formatToParts(d).map(p => [p.type, p.value]));
const localHour = (d, tz) => +parts(d, tz).hour;
const localDate = (d, tz) => { const p = parts(d, tz); return `${p.year}-${p.month}-${p.day}`; };
const inQuiet = (cfg, now) => { const q = cfg.quietHours; if (!q) return false; const h = localHour(now, cfg.timezone); return q.from > q.to ? (h >= q.from || h < q.to) : (h >= q.from && h < q.to); };
const clock = (iso, tz) => new Date(iso).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: tz });
const whenStr = (iso, tz) => new Date(iso).toLocaleString('es-AR', { weekday: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false, timeZone: tz });
const left = m => m >= 60 ? `${Math.floor(m / 60)} h${m % 60 ? ' ' + (m % 60) + ' min' : ''}` : `${m} min`;

// ---------- YouTube (API oficial, ~3 unidades de cuota por canal) ----------
async function yt(key, endpoint, params) {
  const u = new URL('https://www.googleapis.com/youtube/v3/' + endpoint);
  for (const k in params) u.searchParams.set(k, params[k]);
  u.searchParams.set('key', key);
  const r = await fetch(u), j = await r.json();
  if (!r.ok) throw new Error(`YouTube ${r.status}: ${j.error && j.error.message}`);
  return j;
}
async function fetchChannel(key, ch, st) {
  st.uploads = st.uploads || {};
  if (!st.uploads[ch.handle] && ch.channelId) st.uploads[ch.handle] = 'UU' + ch.channelId.slice(2);
  if (!st.uploads[ch.handle]) {
    const c = await yt(key, 'channels', { part: 'contentDetails', forHandle: ch.handle });
    const up = c.items && c.items[0] && c.items[0].contentDetails.relatedPlaylists.uploads;
    if (!up) throw new Error('no encontré el canal (revisa el @handle en config.json)');
    st.uploads[ch.handle] = up;
  }
  const p = await yt(key, 'playlistItems', { part: 'contentDetails', playlistId: st.uploads[ch.handle], maxResults: Math.min(ch.recent || 15, 50) });
  const ids = (p.items || []).map(i => i.contentDetails.videoId).join(',');
  if (!ids) return [];
  const v = await yt(key, 'videos', { part: 'snippet,liveStreamingDetails', id: ids });
  return v.items.map(x => ({ id: x.id, title: x.snippet.title, description: x.snippet.description || '', publishedAt: x.snippet.publishedAt, status: x.snippet.liveBroadcastContent, start: (x.liveStreamingDetails && x.liveStreamingDetails.scheduledStartTime) || null, channel: ch.name, handle: ch.handle }));
}

// ---------- detección: qué programa y qué personas aparecen ----------
function enrich(v, cfg) {
  const programs = [], via = {};
  for (const p of cfg.programs) {
    if (p.channel !== v.handle) continue;
    if (!p.match) { programs.push(p.name); continue; }
    const head = (v.description || '').slice(0, p.descChars || 300);   // solo el comienzo de la descripción
    if (p.match.some(t => hasTerm(v.title, t))) { programs.push(p.name); via[p.name] = 'el título'; }
    else if (p.match.some(t => hasTerm(head, t))) { programs.push(p.name); via[p.name] = 'la descripción'; }
  }
  const people = [];
  for (const p of cfg.persons) {
    const names = [p.name, ...(p.aliases || [])];
    const inTitle = names.some(n => hasTerm(v.title, n)), inDesc = names.some(n => hasTerm(v.description, n));
    if (inTitle || inDesc) people.push({ name: p.name, confidence: inTitle ? 'alta' : 'media' });
  }
  const { description, ...rest } = v;
  return { ...rest, programs, via, people };
}
function rulesFor(it, cfg) {                         // mención (confianza media) va solo al resumen
  const rs = [];
  for (const p of cfg.programs) if (it.programs.includes(p.name)) rs.push(p.rule || {});
  for (const x of it.people) { const p = cfg.persons.find(q => q.name === x.name); rs.push(x.confidence === 'alta' ? (p.rule || {}) : { digestOnly: true }); }
  return rs;
}

// ---------- motor de avisos ----------
async function step(videos, cfg, st, now, send) {
  const tz = cfg.timezone, nowMs = +now, today = localDate(now, tz);
  st.items = st.items || {}; st.sent = st.sent || {};
  if (!st.day || st.day.date !== today) st.day = { date: today, count: 0 };
  const first = !st.initialized;
  if (!st.known) { st.known = {}; for (const it of Object.values(st.items)) st.known[it.handle] = true; }
  const fresh = new Set(videos.map(v => v.handle).filter(h => !st.known[h]));
  for (const v of videos) {
    const it = enrich(v, cfg), old = st.items[it.id];
    st.items[it.id] = { ...it, firstSeen: old ? old.firstSeen : nowMs };
    if (!old && (first || fresh.has(v.handle))) st.sent[it.id + ':new'] = nowMs;   // canal nuevo: no avisar lo ya publicado
  }
  fresh.forEach(h => { st.known[h] = true; });
  if (first) { st.initialized = true; st.lastDigest = today; st.lastDigestAt = nowMs; }
  const quiet = inQuiet(cfg, now);
  const attempt = async text => { try { await send(text); return true; } catch (e) { console.error('No se pudo enviar:', e.message); return false; } };
  const deliver = async (key, text) => {
    if (quiet || st.day.count >= (cfg.dailyCap == null ? 99 : cfg.dailyCap)) return false;
    if (!(await attempt(text))) return false;
    st.sent[key] = nowMs; st.day.count++; return true;
  };
  const items = Object.values(st.items).sort((a, b) => a.firstSeen - b.firstSeen);
  for (const it of items) {
    const rs = rulesFor(it, cfg).filter(r => !r.digestOnly);
    if (!rs.length) continue;
    const leads = [...new Set(rs.flatMap(r => r.leadMinutes || []))].sort((a, b) => b - a);
    const startMs = it.start ? Date.parse(it.start) : 0;
    const upcoming = it.status === 'upcoming' && startMs > nowMs;
    const mins = upcoming ? Math.round((startMs - nowMs) / 6e4) : 0;
    const why = [...it.programs, ...it.people.map(p => p.name)].join(' y ');
    const link = 'https://youtu.be/' + it.id;
    const dueLeads = () => upcoming ? leads.filter(l => startMs - l * 6e4 <= nowMs) : [];
    if (rs.some(r => r.onPublish) && !st.sent[it.id + ':new'] && nowMs - it.firstSeen < 864e5) {
      const text = upcoming
        ? `📅 Directo programado: ${it.title}\n${it.channel} · ${whenStr(it.start, tz)} (en ${left(mins)})\nPor: ${why}\n${link}`
        : `🆕 Nuevo: ${it.title}\n${it.channel}\nPor: ${why}\n${link}`;
      if (await deliver(it.id + ':new', text)) for (const l of dueLeads()) st.sent[it.id + ':' + l] = nowMs;
    }
    const due = dueLeads().filter(l => !st.sent[it.id + ':' + l]);
    if (due.length && await deliver(it.id + ':' + due[due.length - 1], `⏰ Empieza en ${left(mins)}: ${it.title}\n${it.channel} · ${clock(it.start, tz)}\nPor: ${why}\n${link}`))
      due.forEach(l => { st.sent[it.id + ':' + l] = nowMs; });
  }
  const dg = cfg.digest;                              // resumen diario
  if (dg && dg.enabled && !quiet && localHour(now, tz) >= dg.hour && st.lastDigest !== today) {
    const since = st.lastDigestAt || nowMs - 864e5;
    const list = items.filter(it => rulesFor(it, cfg).length && (it.firstSeen > since || (it.status === 'upcoming' && Date.parse(it.start) > nowMs && Date.parse(it.start) - nowMs < 864e5)));
    const text = '📰 Tu resumen de Conserje\n\n' + list.slice(0, 15).map(it => `• ${it.title} — ${it.channel}${it.status === 'upcoming' ? ' · ' + whenStr(it.start, tz) : ''}\n  ${[...it.programs, ...it.people.map(p => (p.confidence === 'alta' ? '' : 'mención: ') + p.name)].join(', ')}\n  https://youtu.be/${it.id}`).join('\n');
    if (!list.length || await attempt(text)) { st.lastDigest = today; st.lastDigestAt = nowMs; }
  }
  const keep = new Set(Object.values(st.items).sort((a, b) => b.firstSeen - a.firstSeen).slice(0, 80).map(i => i.id));
  for (const id of Object.keys(st.items)) if (!keep.has(id)) delete st.items[id];
  return st;
}

// ---------- página de novedades (estilo Conserje) ----------
const CSS = `*{box-sizing:border-box}body{margin:0;background:#F4F9FC;color:#0F2A44;font-family:Manrope,system-ui,sans-serif}main{max-width:460px;margin:0 auto;padding:24px 20px 48px}header{display:flex;justify-content:space-between;align-items:baseline}.w{font:600 22px Fraunces,serif;color:#2F7DC0}h1{font:600 32px/1.1 Fraunces,serif;margin:14px 0 4px}h2{font:500 12px 'IBM Plex Mono',monospace;letter-spacing:.04em;color:#4F677D;margin:24px 0 10px}.c{display:block;color:inherit;text-decoration:none;background:#fff;border:1px solid #D6ECF8;border-radius:16px;padding:14px 16px;margin-bottom:10px;box-shadow:0 6px 16px rgba(47,125,192,.07)}.c:focus-visible{outline:2px solid #2F7DC0}.r{display:flex;justify-content:space-between;align-items:center;gap:12px}.k{display:inline-block;font:500 10.5px/1 'IBM Plex Mono',monospace;padding:5px 8px;border-radius:999px;background:#D6ECF8;white-space:nowrap}.cy{background:#14B8D4}.gr{background:#EEF3F7}.dot{display:inline-block;width:7px;height:7px;border-radius:50%;background:#FF6B5E;margin-right:6px}.h{font:600 18px/1.25 Fraunces,serif;margin:10px 0 4px}.g{font-size:13px;line-height:1.4;color:#4F677D}.b{font-size:13px}.p{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-top:10px}.q{margin-top:10px;padding-top:10px;border-top:1px solid #E3F0F8;font-size:12px;font-weight:600;color:#24679F}`;
function render(st, cfg) {
  const tz = cfg.timezone, now = Date.now();
  const all = Object.values(st.items || {}).filter(i => i.programs.length || i.people.length);
  const isLive = i => i.status === 'live' || (i.status === 'upcoming' && Date.parse(i.start) > now - 36e5);
  const live = all.filter(isLive).sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
  const rest = all.filter(i => !isLive(i)).sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt)).slice(0, 30);
  const ago = iso => { const m = Math.max(1, Math.round((now - Date.parse(iso)) / 6e4)); return m < 60 ? `hace ${m} min` : m < 1440 ? `hace ${Math.round(m / 60)} h` : `hace ${Math.round(m / 1440)} d`; };
  const card = i => {
    const l = i.status === 'live', up = i.status === 'upcoming' && !l;
    const chip = (l || up) ? `<span class="k" style="background:#FFE3E0"><i class="dot"></i>${l ? 'En vivo' : 'Directo'}</span>` : '<span class="k">Video</span>';
    const ppl = i.people.map(p => `<span class="k ${p.confidence === 'alta' ? 'cy' : 'gr'}">${p.confidence === 'alta' ? 'Aparece' : 'Mención'}</span><b class="b">${esc(p.name)}</b>`).join('');
    const why = [...i.programs.map(n => n + (i.via && i.via[n] ? ` (en ${i.via[n]})` : '')), ...i.people.map(p => p.name)].join(' y ');
    return `<a class="c" href="https://youtu.be/${esc(i.id)}"><div class="r">${chip}<span class="g">${up ? esc(whenStr(i.start, tz)) : esc(ago(i.publishedAt))}</span></div><div class="h">${esc(i.title)}</div><div class="g">${esc(i.channel)}</div>${ppl ? `<div class="p">${ppl}</div>` : ''}<div class="q">Porque sigues a ${esc(why)}</div></a>`;
  };
  const empty = t => `<p class="g">${t}</p>`;
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Conserje</title><link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,600&family=IBM+Plex+Mono:wght@500&family=Manrope:wght@400;600;700&display=swap" rel="stylesheet"><style>${CSS}</style></head><body><main><header><span class="w">Conserje</span><span class="g">Actualizado ${esc(clock(new Date(), tz))}</span></header><h1>Hoy en tu radar</h1><h2>Directos y próximos</h2>${live.map(card).join('') || empty('No hay directos a la vista. Cuando un programa que sigues programe uno, aparece acá.')}<h2>Novedades</h2>${rest.map(card).join('') || empty('Todavía no hay novedades. Ejecuta conserje.js para buscarlas.')}</main></body></html>`;
}

// ---------- datos de prueba (modo --mock) ----------
function mockVideos(now) {
  const t = m => new Date(+now + m * 6e4).toISOString(), C = { channel: 'El Cronista Stream', handle: '@Cronista_ar' };
  return [
    { id: 'mock1', ...C, title: 'Claudio Zuchovicki: el mercado hoy', description: 'Charla en Sin Manual con Jonatan Loidi.', status: 'upcoming', start: t(70), publishedAt: t(-60) },
    { id: 'mock2', channel: 'La Fábrica Podcast', handle: '@LaFabricaPodcast_ok', title: 'Episodio nuevo de prueba', description: '', status: 'none', start: null, publishedAt: t(-120) },
    { id: 'mock3', channel: 'La Fórmula Podcast', handle: '@laformulapod', title: 'Otro episodio de prueba', description: '', status: 'none', start: null, publishedAt: t(-1500) },
    { id: 'mock4', ...C, title: 'Entrevista exclusiva', description: 'Marcos Galperín habla de Mercado Libre.', status: 'none', start: null, publishedAt: t(-300) },
    { id: 'mock5', ...C, title: 'Otro programa sin relación', description: '', status: 'none', start: null, publishedAt: t(-400) }
  ];
}

// ---------- ejecución ----------
function loadEnv() {
  try { for (const l of fs.readFileSync(path.join(ROOT, '.env'), 'utf8').split('\n')) { const m = l.match(/^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/); if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, ''); } } catch (e) { /* sin .env */ }
}
function sender(cfg, dry) {                           // Telegram si hay claves; si no, imprime en pantalla
  const tk = process.env.TELEGRAM_BOT_TOKEN, chat = process.env.TELEGRAM_CHAT_ID;
  if (dry || !tk || !chat) return async t => console.log('\n--- AVISO ---\n' + t);
  return async text => { const r = await fetch(`https://api.telegram.org/bot${tk}/sendMessage`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chat_id: chat, text }) }); if (!r.ok) throw new Error('Telegram respondió ' + r.status); };
}
async function main() {
  loadEnv();
  const args = process.argv.slice(2), mock = args.includes('--mock');
  const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'config.json'), 'utf8'));
  let st = mock ? { initialized: true } : (fs.existsSync(STATE) ? JSON.parse(fs.readFileSync(STATE, 'utf8')) : {});
  if (mock) cfg.quietHours = null;
  const now = new Date(); let videos = [];
  if (mock) videos = mockVideos(now);
  else {
    const key = process.env.YOUTUBE_API_KEY;
    if (!key) throw new Error('Falta YOUTUBE_API_KEY en .env (mira el README)');
    for (const ch of cfg.channels) { try { const list = await fetchChannel(key, ch, st); videos.push(...list); console.log(`${ch.name}: ${list.length} videos leídos`); } catch (e) { console.error(`${ch.handle}: ${e.message}`); } }
  }
  await step(videos, cfg, st, now, sender(cfg, args.includes('--dry') || mock));
  if (!mock) fs.writeFileSync(STATE, JSON.stringify(st, null, 1));
  fs.mkdirSync(path.dirname(SITE), { recursive: true }); fs.writeFileSync(SITE, render(st, cfg));
  const hits = Object.values(st.items).filter(i => i.programs.length || i.people.length).sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt)).slice(0, 10);
  for (const i of hits) console.log(`  · ${i.title.slice(0, 70)} → ${[...i.programs.map(n => n + ' (' + ((i.via || {})[n] || '-') + ')'), ...i.people.map(p => p.name + ' (' + p.confidence + ')')].join(', ')}`);
  console.log(`\nListo: ${Object.keys(st.items).length} videos en seguimiento. Página en site/index.html`);
}
module.exports = { norm, hasTerm, enrich, step, render, mockVideos };
if (require.main === module) main().catch(e => { console.error('Error:', e.message); process.exit(1); });
