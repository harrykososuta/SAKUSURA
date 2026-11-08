import test from 'node:test';
import assert from 'node:assert/strict';
import { rank } from '../src/command-search.js';

const items = [
  { label: '#47 春の新商品について', keywords: 'sales 営業 #47 47', exact: ['47', '#47'] },
  { label: '#48 秋の新商品について', keywords: 'sales 営業 #48 48', exact: ['48', '#48'] },
  { label: '#04 SQL入門 Part1', keywords: 'sql-intro-part1 ai', exact: ['04', '#04'] },
  { label: 'PDFを書き出す', keywords: 'pdf 印刷 配布資料' },
];

test('演題番号は完全一致を最上位にし、題名の一部でも見つかる', () => {
  assert.equal(rank(items, '48')[0].label, '#48 秋の新商品について');
  assert.equal(rank(items, '#47')[0].label, '#47 春の新商品について');
  assert.deepEqual(rank(items, '新商品').map(item => item.label), ['#47 春の新商品について', '#48 秋の新商品について']);
});

test('空白で区切った言葉はすべて含むものだけ残し、全角・大文字の違いは無視する', () => {
  assert.deepEqual(rank(items, '営業 秋の').map(item => item.label), ['#48 秋の新商品について']);
  assert.equal(rank(items, 'ＳＱＬ')[0].label, '#04 SQL入門 Part1');
  assert.equal(rank(items, 'pdf')[0].label, 'PDFを書き出す');
  assert.deepEqual(rank(items, '存在しない言葉'), []);
  assert.equal(rank(items, '  ').length, items.length);
});
