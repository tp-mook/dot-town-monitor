// 計測タグと同じ形式で、模擬の訪問者を収集サーバーへ送り続ける（ローカル確認用）
//   node scripts/simulate.mjs [--url http://localhost:8787] [--key dev] [--minutes 10] [--speed 1]
// --speed 2 で滞在時間を半分にする
const arg = (name, def) => { const i = process.argv.indexOf('--' + name); return i > 0 ? process.argv[i + 1] : def; };
const BASE = arg('url', 'http://localhost:8787');
const KEY = arg('key', 'dev');
const MINUTES = Number(arg('minutes', 10));
const SPEED = Number(arg('speed', 1));

const R = Math.random;
const pick = a => a[Math.floor(R() * a.length)];
const sleep = ms => new Promise(r => setTimeout(r, ms / SPEED));
const rid = () => [...crypto.getRandomValues(new Uint8Array(12))].map(b => b.toString(16).padStart(2, '0')).join('');

const UAS = [
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36 Edg/141.0.0.0',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_6) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15',
];
const BOTS = [
  'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
  'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; GPTBot/1.2; +https://openai.com/gptbot)',
  'Mozilla/5.0 (compatible; ClaudeBot/1.0; +claudebot@anthropic.com)',
];
const REFS = [
  ...Array(5).fill('https://www.google.com/'), 'https://search.yahoo.co.jp/', 'https://www.bing.com/',
  '', '', '', 'https://chatgpt.com/', 'https://claude.ai/', 'https://t.co/x', 'https://www.instagram.com/', 'https://example.org/links',
];

async function send(ua, body) {
  const res = await fetch(BASE + '/collect', {
    method: 'POST', body: JSON.stringify(body),
    headers: {'content-type': 'text/plain', 'origin': BASE, 'user-agent': ua},
  });
  if (res.status !== 204) console.error('送信失敗', res.status, body.k, body.p);
}

let pages = [];
async function loadPages() {
  const res = await fetch(BASE + '/api/town', {headers: {'x-passcode': KEY}});
  if (!res.ok) throw new Error('町のつくりを読めません: HTTP ' + res.status + '（合言葉 --key を確認）');
  pages = (await res.json()).pages;
  if (pages.length < 3) console.warn('ページが少ないので、先に POST /api/sync-sitemap を実行してください');
}

let count = 0;
async function visitor() {
  const ua = pick(UAS), v = rid(), s = rid(), n = R() < .25 ? 2 + (R() * 5 | 0) : 1;
  const id = ++count;
  const ref = pick(REFS);
  const blog = pages.filter(p => p.zone === 'ブログ');
  let page = ref.includes('google') && blog.length && R() < .6 ? pick(blog) : pages.find(p => p.path === '/') || pick(pages);
  const steps = 1 + (R() * 5 | 0);
  console.log(`#${id} 来訪 ${ref || '(直接)'} ${steps}ページ`);
  for (let i = 0; i < steps; i++) {
    await send(ua, {k: 'v', v, s, n, p: page.path, t: page.title + ' | ビジョンマーケティング', r: i === 0 ? ref : ''});
    const dwell = 5000 + R() * 40000;
    await sleep(dwell);
    const last = i === steps - 1;
    await send(ua, {k: 'l', v, s, n, p: page.path, d: Math.round(dwell), x: last ? 1 : undefined});
    if (!last) {
      page = R() < .15 ? (pages.find(p => p.form) || pick(pages)) : pick(pages);
      if (page.form && R() < .4) { await sleep(8000); await send(ua, {k: 'f', v, s, n, p: page.path}); }
    }
  }
}

async function crawler() {
  const ua = pick(BOTS), v = rid(), s = rid();
  for (let i = 0; i < 4; i++) {
    const p = pick(pages);
    await send(ua, {k: 'v', v, s, n: 1, p: p.path, t: p.title, r: ''});
    await sleep(1500);
  }
  await send(ua, {k: 'l', v, s, n: 1, p: '/', d: 1500, x: 1});
}

async function spam() {
  const ua = pick(UAS), v = rid(), s = rid();
  const form = pages.find(p => p.form);
  if (!form) return;
  await send(ua, {k: 'v', v, s, n: 1, p: form.path, t: form.title, r: ''});
  await sleep(1200);
  await send(ua, {k: 'f', v, s, n: 1, p: form.path});
  await send(ua, {k: 'l', v, s, n: 1, p: form.path, d: 1500, x: 1});
}

await loadPages();
console.log(`${pages.length}ページの町に、${MINUTES}分間 模擬の訪問者を送ります（${BASE}）`);
const end = Date.now() + MINUTES * 60000 / SPEED;
const running = [];
while (Date.now() < end) {
  running.push(visitor());
  if (R() < .15) running.push(crawler());
  if (R() < .05) running.push(spam());
  await sleep(4000 + R() * 8000);
}
await Promise.all(running);
console.log(`おわり（訪問者 ${count}人）`);
