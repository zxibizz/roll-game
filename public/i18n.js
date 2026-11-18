// Localization. The game has almost no words: the name, the install description and the labels screen readers
// read out for the buttons. By default the language follows the device (navigator.languages, first supported one
// wins); the globe on the home screen picks another one (setLang, remembered on the device), and `?lang=xx` in the
// URL does the same (`?lang=auto` goes back to the device language). English is the fallback.
// Adding a language: copy lang/en.js and manifest.webmanifest, translate them, register the language in LANGS
// and LANG_ORDER and add both files to ASSETS in sw.js (test/i18n.test.js checks all of that).
import en from './lang/en.js';
import de from './lang/de.js';
import es from './lang/es.js';
import fr from './lang/fr.js';
import it from './lang/it.js';
import ja from './lang/ja.js';
import ko from './lang/ko.js';
import nl from './lang/nl.js';
import pl from './lang/pl.js';
import pt from './lang/pt.js';
import ru from './lang/ru.js';
import tr from './lang/tr.js';
import zh from './lang/zh.js';

// Portuguese is Brazilian, Chinese is Simplified: other variants of these languages get them too
export const LANGS = { en, de, es, fr, it, ja, ko, nl, pl, pt, ru, tr, zh };
const STORE = 'roll.lang';

export function pickLang(wanted, langs = LANGS) {
  for (const tag of wanted) {
    const base = String(tag || '').toLowerCase().split(/[-_]/)[0];
    if (langs[base]) return base;
  }
  return 'en';
}

// the language list for the picker: Latin script alphabetically by native name, then the others
export const LANG_ORDER = ['de', 'en', 'es', 'fr', 'it', 'nl', 'pl', 'pt', 'tr', 'ru', 'ja', 'ko', 'zh'];

function chosen() {
  if (typeof location === 'undefined') return null;
  const q = new URLSearchParams(location.search).get('lang');
  try {
    if (q === 'auto') localStorage.removeItem(STORE);
    else if (q) localStorage.setItem(STORE, pickLang([q]));
    return localStorage.getItem(STORE);
  } catch { return q && q !== 'auto' ? q : null; }   // no storage (private mode): the URL alone carries the choice
}
const fromBrowser = typeof navigator === 'undefined' ? [] : (navigator.languages && navigator.languages.length ? navigator.languages : [navigator.language]);
export const pinned = chosen();            // the language picked by the player, or null — follow the device
export const deviceLang = pickLang(fromBrowser);
export const lang = pinned ? pickLang([pinned, ...fromBrowser]) : deviceLang;
const dict = LANGS[lang];

// pick a language (null — follow the device) and reload: every text is put in from the dictionary at startup
export function setLang(code) {
  let stored = true;
  try { if (code) localStorage.setItem(STORE, code); else localStorage.removeItem(STORE); } catch { stored = false; }
  const q = new URLSearchParams(location.search);
  q.delete('lang');
  if (!stored && code) q.set('lang', code);   // without storage the URL keeps the choice
  location.replace(location.pathname + (q.toString() ? '?' + q : ''));
}

export function t(key) {
  return dict[key] ?? en[key] ?? key;
}

// static page text: data-t-aria → aria-label; the title on the home screen letter by letter (each one bobs on its
// own beat, and the size follows the length of the name); the page title, the install name and <html lang>
export function translatePage(doc = document) {
  const name = t('app.name');
  doc.title = name;
  doc.querySelector('meta[name="apple-mobile-web-app-title"]')?.setAttribute('content', name);
  doc.querySelector('meta[name="description"]')?.setAttribute('content', t('app.desc'));
  if (lang !== 'en') doc.querySelector('link[rel="manifest"]')?.setAttribute('href', `manifest.${lang}.webmanifest`);
  for (const el of doc.querySelectorAll('[data-t-aria]')) el.setAttribute('aria-label', t(el.dataset.tAria));
  const h1 = doc.querySelector('h1[data-t-name]');
  if (h1) {
    const letters = [...name];
    h1.setAttribute('aria-label', name);
    h1.style.setProperty('--n', String(Math.max(4, letters.length)));
    h1.replaceChildren(...letters.map((ch, i) => {
      const s = doc.createElement('span'); s.textContent = ch; s.setAttribute('aria-hidden', 'true');
      s.style.animationDelay = `${(i * 0.15).toFixed(2)}s`;
      return s;
    }));
  }
  doc.documentElement.lang = lang;
}

if (typeof document !== 'undefined') translatePage();
