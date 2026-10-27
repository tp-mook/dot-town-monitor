// 収集サーバーと画面の両方から使う判定処理（Cloudflare Workers / Node のどちらでも動く素のJS）

// 名乗り（User-Agent）からロボットを見分ける。上から順に当てる
const BOTS = [
  [/googlebot|google-inspectiontool|googleother/i, 'Googlebot'],
  [/bingbot|bingpreview/i, 'Bingbot'],
  [/gptbot/i, 'GPTBot'],
  [/chatgpt-user|oai-searchbot/i, 'ChatGPT'],
  [/claudebot|claude-user|claude-searchbot/i, 'ClaudeBot'],
  [/perplexity/i, 'PerplexityBot'],
  [/applebot/i, 'Applebot'],
  [/yandex/i, 'YandexBot'],
  [/baiduspider/i, 'Baiduspider'],
  [/ahrefsbot/i, 'AhrefsBot'],
  [/semrushbot/i, 'SemrushBot'],
  [/headlesschrome|phantomjs|puppeteer|playwright/i, '自動ブラウザ'],
  [/bot\b|crawler|spider|crawl|slurp|curl\/|wget\/|python-requests|go-http-client/i, 'その他のロボット'],
];

export function detectBot(ua = '') {
  if (!ua) return 'その他のロボット';
  for (const [re, name] of BOTS) if (re.test(ua)) return name;
  return null;
}

export function parseDevice(ua = '') {
  const tablet = /ipad|tablet|android(?!.*mobile)/i.test(ua);
  const mobile = !tablet && /iphone|ipod|android.*mobile|mobile/i.test(ua);
  const os = /iphone|ipad|ipod/i.test(ua) ? (tablet ? 'iPad' : 'iPhone')
    : /android/i.test(ua) ? 'Android'
    : /windows/i.test(ua) ? 'Windows'
    : /mac os x|macintosh/i.test(ua) ? 'Mac'
    : /linux/i.test(ua) ? 'Linux' : 'その他';
  const browser = /edg\//i.test(ua) ? 'Edge'
    : /line\//i.test(ua) ? 'LINE'
    : /instagram/i.test(ua) ? 'Instagram'
    : /fban|fbav/i.test(ua) ? 'Facebook'
    : /firefox|fxios/i.test(ua) ? 'Firefox'
    : /chrome|crios/i.test(ua) ? 'Chrome'
    : /safari/i.test(ua) ? 'Safari' : 'その他';
  return {device: mobile ? 'スマホ' : tablet ? 'タブレット' : 'パソコン', os, browser};
}

// 来る前の場所（リファラ）を、帽子の色の分類にする
const REF_RULES = [
  // AI は Google のドメインもあるので検索より先に見る
  ['ai', 'ChatGPT', /(^|\.)(chatgpt\.com|chat\.openai\.com)$/],
  ['ai', 'Claude', /(^|\.)claude\.ai$/],
  ['ai', 'Perplexity', /(^|\.)perplexity\.ai$/],
  ['ai', 'Gemini', /(^|\.)gemini\.google\.com$/],
  ['ai', 'Copilot', /(^|\.)copilot\.microsoft\.com$/],
  ['search', 'Google', /(^|\.)google\.[a-z.]+$/],
  ['search', 'Yahoo!', /(^|\.)(search\.)?yahoo\.(co\.jp|com)$/],
  ['search', 'Bing', /(^|\.)bing\.com$/],
  ['search', 'DuckDuckGo', /(^|\.)duckduckgo\.com$/],
  ['search', 'Baidu', /(^|\.)baidu\.com$/],
  ['sns', 'X', /(^|\.)(x\.com|twitter\.com|t\.co)$/],
  ['sns', 'Facebook', /(^|\.)(facebook\.com|fb\.me)$/],
  ['sns', 'Instagram', /(^|\.)instagram\.com$/],
  ['sns', 'LINE', /(^|\.)line\.me$/],
  ['sns', 'YouTube', /(^|\.)youtube\.com$/],
  ['sns', 'TikTok', /(^|\.)tiktok\.com$/],
  ['sns', 'LinkedIn', /(^|\.)(linkedin\.com|lnkd\.in)$/],
];

export function classifyReferrer(ref, siteHost) {
  if (!ref) return {src: 'direct', name: 'なし（ブックマーク・URL直接）'};
  let host;
  try { host = new URL(ref).hostname.toLowerCase(); } catch { return {src: 'direct', name: 'なし（ブックマーク・URL直接）'}; }
  const bare = h => h.replace(/^www\./, '');
  if (siteHost && bare(host) === bare(siteHost.toLowerCase())) return {src: 'direct', name: 'サイト内'};
  for (const [src, name, re] of REF_RULES) if (re.test(host)) return {src, name};
  return {src: 'other', name: bare(host)};
}

// 保存するIPアドレスは末尾を伏せる
export function maskIp(ip = '') {
  if (/^\d+\.\d+\.\d+\.\d+$/.test(ip)) return ip.replace(/\.\d+$/, '.0');
  if (ip.includes(':')) return ip.split(':').slice(0, 3).join(':') + '::';
  return '';
}

// 「会社概要 | ビジョンマーケティング」→「会社概要」
export function cleanTitle(title = '') {
  return title.split(/\s+[|｜\-–—]\s+/)[0].trim().slice(0, 80);
}

export function decodePath(p = '/') {
  let s = p;
  try { s = decodeURIComponent(p); } catch { /* そのまま使う */ }
  s = s.split(/[?#]/)[0] || '/';
  if (s.length > 1) s = s.replace(/\/+$/, '');
  return s.slice(0, 300);
}

// 区画のルールに当てはまるか。match は完全一致、末尾 * は前方一致。当てはまらなければ null
export function knownZone(path, zones) {
  for (const z of zones) {
    for (const m of z.match || []) {
      if (m.endsWith('*') ? path.startsWith(m.slice(0, -1)) : path === m) return z.name;
    }
  }
  return null;
}

// 区画の割り当て。どのルールにも当てはまらないページは「その他」の区画へ
export function zoneOf(path, zones) {
  return knownZone(path, zones) ?? (zones.find(z => z.other) || zones[zones.length - 1]).name;
}

// ページをほとんど見ずにフォームを送ったものは営業ロボットとみなす
export function isSpamForm(viewsInSession, msSinceFirstView) {
  return viewsInSession <= 1 && (msSinceFirstView == null || msSinceFirstView < 5000);
}
