// Pruebas de la lógica con datos simulados (no usan internet). Ejecutar: node test.js
const assert = require('node:assert/strict');
const { norm, hasTerm, enrich, step, render } = require('./conserje.js');
const base = JSON.parse(require('fs').readFileSync(__dirname + '/config.json', 'utf8'));
const mkCfg = o => ({ ...JSON.parse(JSON.stringify(base)), timezone: 'UTC', ...o });
const at = (h, m = 0, d = 20) => new Date(Date.UTC(2026, 9, d, h, m));
const cr = (id, title, description, extra = {}) => ({ id, channel: 'El Cronista Stream', handle: '@Cronista_ar', title, description, status: 'none', start: null, publishedAt: at(8).toISOString(), ...extra });
const fab = id => ({ id, channel: 'La Fábrica Podcast', handle: '@LaFabricaPodcast_ok', title: 'Episodio ' + id, description: '', status: 'none', start: null, publishedAt: at(8).toISOString() });
const fo = id => ({ ...fab(id), channel: 'La Fórmula Podcast', handle: '@laformulapod' });
const run = async (videos, cfg, st, now) => { const out = []; await step(videos, cfg, st, now, async t => { out.push(t); }); return out; };
let n = 0;
const t = async (name, fn) => { try { await fn(); n++; console.log('ok  ' + name); } catch (e) { console.error('FALLA ' + name + '\n', e.message); process.exitCode = 1; } };

(async () => {
  await t('normaliza tildes y mayúsculas', () => assert.equal(norm('GalperÍn'), 'galperin'));
  await t('encuentra palabra completa, no fragmentos', () => { assert.ok(hasTerm('Marcos Galperín habla', 'Galperin')); assert.ok(!hasTerm('Galperinski', 'Galperin')); });
  await t('filtra Sin Manual dentro del canal de El Cronista', () => {
    assert.deepEqual(enrich(cr('a', 'Otro programa', 'nada'), base).programs, []);
    assert.deepEqual(enrich(cr('b', 'Charla', 'Hoy en Sin Manual'), base).programs, ['Sin Manual']);
  });
  await t('nombre en el título = aparición (alta); en la descripción = mención (media)', () => {
    assert.equal(enrich(cr('c', 'CLAUDIO ZUCHOVICKI: el mercado', ''), base).people[0].confidence, 'alta');
    assert.equal(enrich(cr('d', 'Entrevista', 'con Marcos Galperín'), base).people[0].confidence, 'media');
  });
  await t('avisos de directo: 5 h y 1 h antes, sin duplicados, sin avisar el pasado', async () => {
    const cfg = mkCfg({ digest: { enabled: false } }), st = {};
    const v = cr('live1', 'Claudio Zuchovicki en vivo', 'Sin Manual', { status: 'upcoming', start: at(16).toISOString() });
    assert.equal((await run([v], cfg, st, at(10))).length, 0);      // primera corrida: silenciosa
    assert.equal((await run([v], cfg, st, at(10, 30))).length, 0);  // faltan 5 h 30 min
    const a = await run([v], cfg, st, at(11));                      // faltan 5 h
    assert.equal(a.length, 1); assert.match(a[0], /5 h/);
    assert.equal((await run([v], cfg, st, at(11))).length, 0);      // no repite
    const b = await run([v], cfg, st, at(15)); assert.equal(b.length, 1); assert.match(b[0], /1 h/);
    assert.equal((await run([v], cfg, st, at(15, 30))).length, 0);
  });
  await t('video nuevo después de iniciar: un solo aviso', async () => {
    const cfg = mkCfg({ digest: { enabled: false } }), st = {};
    await run([], cfg, st, at(10));
    assert.equal((await run([fab('n1')], cfg, st, at(11))).length, 1);
    assert.equal((await run([fab('n1')], cfg, st, at(12))).length, 0);
  });
  await t('horas de silencio: espera y avisa al terminar', async () => {
    const cfg = mkCfg({ digest: { enabled: false } }), st = {};
    await run([], cfg, st, at(12, 0, 19));
    assert.equal((await run([fab('q1')], cfg, st, at(2, 0, 20))).length, 0);
    assert.equal((await run([fab('q1')], cfg, st, at(8, 0, 20))).length, 1);
  });
  await t('tope diario', async () => {
    const cfg = mkCfg({ digest: { enabled: false }, dailyCap: 1 }), st = {};
    await run([], cfg, st, at(10));
    assert.equal((await run([fab('c1'), fab('c2')], cfg, st, at(11))).length, 1);
  });
  await t('resumen diario: una vez por día, incluye lo "solo resumen" y las menciones', async () => {
    const cfg = mkCfg({}), st = {};
    await run([], cfg, st, at(8, 0, 19));
    const a = await run([fo('r1'), cr('r2', 'Entrevista', 'con Marcos Galperín')], cfg, st, at(9, 30, 20));
    assert.equal(a.length, 1); assert.match(a[0], /resumen/i); assert.match(a[0], /mención: Marcos Galperin/);
    assert.equal((await run([fo('r1')], cfg, st, at(10, 30, 20))).length, 0);
  });
  await t('la página se genera con apariciones y directos', () => {
    const st = { items: { x: { ...enrich(cr('x', 'Claudio Zuchovicki en vivo', 'Sin Manual', { status: 'upcoming', start: new Date(Date.now() + 36e5).toISOString() }), base), firstSeen: 1 } } };
    const html = render(st, base);
    assert.match(html, /Aparece/); assert.match(html, /Directo/); assert.match(html, /Porque sigues a Sin Manual y Claudio Zuchovicki/);
  });
  console.log(`\n${n} pruebas pasaron`);
})();
