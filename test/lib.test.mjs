import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {detectBot, parseDevice, classifyReferrer, maskIp, cleanTitle, decodePath, zoneOf, knownZone, isSpamForm} from '../src/lib.js';

const site = JSON.parse(readFileSync(new URL('../sites/vision-marketing.json', import.meta.url)));
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const WIN_CHROME = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';
const WIN_EDGE = WIN_CHROME + ' Edg/141.0.0.0';

test('ロボットを名乗りで見分ける', () => {
  assert.equal(detectBot('Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)'), 'Googlebot');
  assert.equal(detectBot('Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; GPTBot/1.2; +https://openai.com/gptbot)'), 'GPTBot');
  assert.equal(detectBot('Mozilla/5.0 (compatible; ClaudeBot/1.0; +claudebot@anthropic.com)'), 'ClaudeBot');
  assert.equal(detectBot('python-requests/2.32'), 'その他のロボット');
  assert.equal(detectBot(''), 'その他のロボット');
  assert.equal(detectBot(IPHONE), null);
  assert.equal(detectBot(WIN_CHROME), null);
});

test('端末とブラウザ', () => {
  assert.deepEqual(parseDevice(IPHONE), {device: 'スマホ', os: 'iPhone', browser: 'Safari'});
  assert.deepEqual(parseDevice(WIN_CHROME), {device: 'パソコン', os: 'Windows', browser: 'Chrome'});
  assert.equal(parseDevice(WIN_EDGE).browser, 'Edge');
  assert.equal(parseDevice('Mozilla/5.0 (Linux; Android 14; SM-X200) AppleWebKit/537.36 Chrome/141 Safari/537.36').device, 'タブレット');
  assert.equal(parseDevice('Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/141 Mobile Safari/537.36').device, 'スマホ');
});

test('来る前の場所の分類', () => {
  const host = 'www.vision-marketing.co.jp';
  assert.deepEqual(classifyReferrer('https://www.google.com/', host), {src: 'search', name: 'Google'});
  assert.deepEqual(classifyReferrer('https://www.google.co.jp/', host), {src: 'search', name: 'Google'});
  assert.deepEqual(classifyReferrer('https://search.yahoo.co.jp/search?p=x', host), {src: 'search', name: 'Yahoo!'});
  assert.deepEqual(classifyReferrer('https://gemini.google.com/app', host), {src: 'ai', name: 'Gemini'});
  assert.deepEqual(classifyReferrer('https://chatgpt.com/', host), {src: 'ai', name: 'ChatGPT'});
  assert.deepEqual(classifyReferrer('https://t.co/abc', host), {src: 'sns', name: 'X'});
  assert.deepEqual(classifyReferrer('https://l.facebook.com/l.php', host), {src: 'sns', name: 'Facebook'});
  assert.deepEqual(classifyReferrer('https://vision-marketing.co.jp/blog', host), {src: 'direct', name: 'サイト内'});
  assert.deepEqual(classifyReferrer('https://example.org/links', host), {src: 'other', name: 'example.org'});
  assert.equal(classifyReferrer('', host).src, 'direct');
  assert.equal(classifyReferrer('not a url', host).src, 'direct');
  // ドメイン名の一部が同じだけのものは検索にしない
  assert.equal(classifyReferrer('https://notgoogle.example.com/', host).src, 'other');
});

test('IPアドレスの末尾を伏せる', () => {
  assert.equal(maskIp('203.0.113.45'), '203.0.113.0');
  assert.equal(maskIp('2001:db8:85a3:8d3:1319:8a2e:370:7348'), '2001:db8:85a3::');
  assert.equal(maskIp(''), '');
});

test('タイトルからサイト名を外す', () => {
  assert.equal(cleanTitle('会社概要 | ビジョンマーケティング'), '会社概要');
  assert.equal(cleanTitle('LEDビジョン販売 ｜ VM'), 'LEDビジョン販売');
  assert.equal(cleanTitle('ブログ - 会社名'), 'ブログ');
  assert.equal(cleanTitle('A-B テスト'), 'A-B テスト');
});

test('パスの正規化', () => {
  assert.equal(decodePath('/%E4%BC%9A%E7%A4%BE%E6%A6%82%E8%A6%81'), '/会社概要');
  assert.equal(decodePath('/blog/?x=1#top'), '/blog');
  assert.equal(decodePath('/'), '/');
  assert.equal(decodePath('/%E0%A4%A'), '/%E0%A4%A');
});

test('会社HPの区画の割り当て', () => {
  const z = p => zoneOf(p, site.zones);
  assert.equal(z('/post/hpを公開しました-1'), 'ブログ');
  assert.equal(z('/blog/categories/ledビジョン'), 'ブログ');
  assert.equal(z('/projects/abc'), '実績');
  assert.equal(z('/ledビジョン販売'), 'LEDビジョン');
  assert.equal(z('/お問い合わせ'), 'お問い合わせ');
  assert.equal(z('/会社概要'), '会社・その他');
  assert.equal(z('/まだない新しいページ'), '会社・その他');
  // 前方一致は「/blog」で始まる別ページを取り込まない
  assert.equal(z('/blogger'), '会社・その他');
});

test('ルールに当てはまらないページは家にしない判定に使う', () => {
  assert.equal(knownZone('/post/new-article', site.zones), 'ブログ');
  assert.equal(knownZone('/会社概要', site.zones), '会社・その他');
  assert.equal(knownZone('/wp-admin/setup.php', site.zones), null);
  assert.equal(knownZone('/まだない新しいページ', site.zones), null);
});

test('営業ロボットのフォーム送信', () => {
  assert.equal(isSpamForm(0, null), true);
  assert.equal(isSpamForm(1, 2000), true);
  assert.equal(isSpamForm(1, 60000), false);
  assert.equal(isSpamForm(4, 1000), false);
});
