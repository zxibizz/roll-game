import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { LANGS, LANG_ORDER, pickLang, t } from '../public/i18n.js';

const pub = (f) => new URL('../public/' + f, import.meta.url);

test('i18n: language comes from the first supported locale, English otherwise', () => {
  assert.equal(pickLang(['ru-RU', 'en-US']), 'ru');
  assert.equal(pickLang(['kk-KZ', 'ru']), 'ru');
  assert.equal(pickLang(['de-DE', 'ru']), 'de');
  assert.equal(pickLang(['pt-PT']), 'pt');
  assert.equal(pickLang(['zh-TW']), 'zh');
  assert.equal(pickLang(['sv-SE', 'fi']), 'en');
  assert.equal(pickLang([]), 'en');
  assert.equal(pickLang([undefined]), 'en');
});

test('i18n: the language picker lists every language once, each under its own name', () => {
  assert.deepEqual([...LANG_ORDER].sort(), Object.keys(LANGS).sort());
  const names = Object.values(LANGS).map((d) => d['lang.name']);
  assert.equal(new Set(names).size, names.length);
});

test('i18n: every language has exactly the keys of English, all of them non-empty text', () => {
  const ref = Object.keys(LANGS.en);
  for (const [code, d] of Object.entries(LANGS)) {
    assert.deepEqual(Object.keys(d).sort(), [...ref].sort(), code);
    for (const k of ref) assert.ok(typeof d[k] === 'string' && d[k].trim(), `${code}: ${k}`);
  }
  assert.equal(t('no.such.key'), 'no.such.key');
});

test('i18n: every key the page asks for exists, and every key exists for a reason', async () => {
  const html = await readFile(pub('index.html'), 'utf8');
  const used = new Set([...html.matchAll(/data-t-aria="([^"]+)"/g)].map((m) => m[1]));
  for (const k of used) assert.ok(k in LANGS.en, `index.html asks for ${k}`);
  for (const k of Object.keys(LANGS.en)) assert.ok(used.has(k) || ['app.name', 'app.desc', 'lang.name', 'lang.auto'].includes(k), `${k} is not used`);
});

test('i18n: manifests differ from the English one only in their texts', async () => {
  const read = async (f) => JSON.parse(await readFile(pub(f), 'utf8'));
  const base = await read('manifest.webmanifest');
  const strip = (m) => { const { name, short_name: sn, description, lang, ...rest } = m; return rest; };
  assert.equal(base.name, LANGS.en['app.name']);
  for (const code of Object.keys(LANGS)) {
    if (code === 'en') continue;
    const m = await read(`manifest.${code}.webmanifest`);
    assert.equal(m.lang, code);
    assert.equal(m.name, LANGS[code]['app.name']);
    assert.equal(m.description, LANGS[code]['app.desc']);
    assert.deepEqual(strip(m), strip(base), `manifest.${code}.webmanifest`);
  }
});

test('i18n: localized files are cached for offline play', async () => {
  const sw = await readFile(pub('sw.js'), 'utf8');
  assert.ok(sw.includes(`'i18n.js'`));
  for (const code of Object.keys(LANGS)) {
    assert.ok(sw.includes(`'lang/${code}.js'`), `lang/${code}.js in sw.js`);
    if (code !== 'en') assert.ok(sw.includes(`'manifest.${code}.webmanifest'`), `manifest.${code} in sw.js`);
  }
  for (const f of await readdir(pub('icons'))) assert.ok(sw.includes(`'icons/${f}'`), `icons/${f} in sw.js`);
});

test('i18n: Cyrillic lives only in the Russian dictionary and manifest — code, comments and docs are English', async () => {
  const files = ['README.md', 'Dockerfile', 'package.json', ...(await readdir(new URL('../public/', import.meta.url))).map((f) => 'public/' + f),
    ...(await readdir(new URL('../public/lang/', import.meta.url))).map((f) => 'public/lang/' + f),
    ...(await readdir(new URL('../test/', import.meta.url))).map((f) => 'test/' + f),
    ...(await readdir(new URL('../server/', import.meta.url))).map((f) => 'server/' + f)];
  for (const f of files) {
    if (!/\.(js|html|md|json|webmanifest)$|Dockerfile$/.test(f) || f.endsWith('/ru.js') || f.endsWith('manifest.ru.webmanifest')) continue;
    const src = await readFile(new URL('../' + f, import.meta.url), 'utf8');
    assert.ok(!/[\u0400-\u04FF]/.test(src), `${f} has Cyrillic`);
  }
});
