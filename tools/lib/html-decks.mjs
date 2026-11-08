import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { ROOT, slugOf } from './project.mjs';

// Standalone HTML slides keep their own player and embedded assets.
// The manifest never selects a path: the only document served is slides.html.
export async function readHtmlDeck(name, { directory = join(ROOT, 'lectures') } = {}) {
  const root = join(directory, slugOf(name));
  const manifestPath = join(root, 'html-deck.json');
  const deck = JSON.parse((await readFile(manifestPath, 'utf8')).replace(/^\uFEFF/, ''));
  if (deck.version !== 1 || deck.format !== 'html' || typeof deck.title !== 'string' || !deck.title.trim() || deck.title.length > 200 || !Number.isInteger(deck.slides) || deck.slides < 1 || deck.slides > 2000 || deck.description !== undefined && (typeof deck.description !== 'string' || deck.description.length > 1000) || deck.number !== undefined && !/^\d{0,6}$/.test(deck.number) || deck.category !== undefined && !/^[a-z][a-z0-9_-]{0,31}$/.test(deck.category)) {
    throw new Error('INVALID_HTML_DECK');
  }
  const path = join(root, 'slides.html');
  const [manifest, document] = await Promise.all([stat(manifestPath), stat(path)]);
  if (!document.isFile() || document.size > 50 * 1024 * 1024) throw new Error('INVALID_HTML_DOCUMENT');
  return {
    path,
    item: { name, title: deck.title, description: deck.description ?? '', number: deck.number ?? '', category: deck.category ?? 'other', demo: false, slides: deck.slides, updatedAt: Math.floor(Math.max(manifest.mtimeMs, document.mtimeMs)), format: 'html' },
  };
}

const escapeHtml = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
export function htmlDeckPage(item) {
  const title = escapeHtml(item.title);
  return `<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title} - スライドライブラリ</title><link rel="icon" href="data:,"><style>html,body{margin:0;height:100%;background:#20262c;color:#f6f6f4;font:14px system-ui,sans-serif}body{display:flex;flex-direction:column}header{display:flex;align-items:center;gap:24px;padding:10px 18px;flex:none}a{color:inherit;white-space:nowrap}header span{overflow:hidden;white-space:nowrap;text-overflow:ellipsis}small{margin-left:auto;white-space:nowrap;color:#c7cdd1}iframe{display:block;flex:1;width:100%;min-height:0;border:0}</style></head><body><header><a href="/library?category=${encodeURIComponent(item.category)}">← ライブラリ</a><span>${title}</span><small>${item.slides}枚</small></header><iframe title="${title}" src="/html-slides/document?name=${encodeURIComponent(item.name)}" sandbox="allow-scripts" allowfullscreen></iframe></body></html>`;
}

export const HTML_DECK_CSP = "sandbox allow-scripts; default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; font-src data:; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'self'";
