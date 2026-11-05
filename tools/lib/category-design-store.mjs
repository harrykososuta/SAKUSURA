import { readFile, writeFile, mkdir, rename, unlink } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { ROOT } from './project.mjs';
import { CATEGORIES } from '../../src/core.js';
import { validCategoryId } from '../../src/design-theme.js';
import { createDesignStore, withDesignLock } from './design-store.mjs';
const hash = raw => createHash('sha256').update(raw).digest('hex');
const fail = (status, message) => { throw Object.assign(new Error(message), { status }); };
export function createCategoryDesignStore({ directory = join(ROOT, 'designs'), designStore = createDesignStore({ directory }) } = {}) {
  directory = resolve(directory); const file = join(directory, 'category-presets.json');
  async function get() {
    try {
      const raw = await readFile(file); const data = JSON.parse(raw);
      if (data.version !== 1 || !Array.isArray(data.categories)) fail(422, 'カテゴリの設定ファイルを確認してください。');
      return { ...data, revision: hash(raw) };
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      return { version: 1, categories: Object.entries(CATEGORIES).map(([id, item]) => ({ id, name: item.name, designId: null })), revision: null };
    }
  }
  async function save(body) {
    return withDesignLock(directory, async () => {
      const previous = await get();
      if (!body || body.revision !== previous.revision) fail(409, 'カテゴリの設定が別の画面で変更されました。再読み込みしてください。');
      if (!Array.isArray(body.categories) || body.categories.length > 48) fail(422, 'カテゴリは48種類までです。');
      const ids = new Set(), names = new Set();
      for (const category of body.categories) {
        if (!category || !validCategoryId(category.id) || ids.has(category.id) || typeof category.name !== 'string' || !category.name.trim() || category.name.length > 32 || /[\u0000-\u001f\u007f]/.test(category.name)) fail(422, 'カテゴリのIDと名前を確認してください。');
        const name = category.name.trim().normalize('NFKC').toLocaleLowerCase('ja');
        if (names.has(name)) fail(422, 'カテゴリ名が重複しています。');
        ids.add(category.id); names.add(name);
        if (category.designId !== null) await designStore.get(category.designId);
      }
      const data = { version: 1, categories: body.categories.map(({ id, name, designId }) => ({ id, name: name.trim(), designId })) };
      await mkdir(directory, { recursive: true });
      const temp = join(directory, `.category-presets-${randomUUID()}.tmp`);
      try { await writeFile(temp, JSON.stringify(data, null, 2) + '\n', { flag: 'wx' }); await rename(temp, file); }
      finally { await unlink(temp).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
      return get();
    });
  }
  return { get, save };
}
