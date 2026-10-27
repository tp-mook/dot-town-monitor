// 収集サーバー（Cloudflare Workers）
//   POST /collect          計測タグからの受け口
//   GET  /api/town         町のつくり（区画とページ）
//   GET  /api/events       イベント（?after=ID で続きだけ、?from=ミリ秒 でその時刻以降）
//   POST /api/sync-sitemap サイトマップからページ一覧を取り込む（毎日の定期実行でも動く）
// 画面（public/）は静的ファイルとしてそのまま配る
import site from '../sites/vision-marketing.json';
import {detectBot, parseDevice, classifyReferrer, maskIp, cleanTitle, decodePath, zoneOf, isSpamForm} from './lib.js';

const TYPES = {v: 'page_view', l: 'page_leave', f: 'form_submit'};
const str = (v, n) => typeof v === 'string' ? v.slice(0, n) : '';

export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);
    try {
      if (url.pathname === '/collect') return await collect(req, env);
      if (url.pathname.startsWith('/api/')) {
        if (!authorized(req, env)) return json({error: 'unauthorized'}, 401);
        if (url.pathname === '/api/town' && req.method === 'GET') return await town(env);
        if (url.pathname === '/api/events' && req.method === 'GET') return await events(url, env);
        if (url.pathname === '/api/sync-sitemap' && req.method === 'POST') return json(await syncSitemap(env));
        return json({error: 'not found'}, 404);
      }
    } catch (e) {
      console.error(e);
      return json({error: 'server error'}, 500);
    }
    return env.ASSETS.fetch(req);
  },
  async scheduled(event, env, ctx) {
    ctx.waitUntil(syncSitemap(env));
  },
};

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {status, headers: {'content-type': 'application/json; charset=utf-8'}});
}

function authorized(req, env) {
  const key = req.headers.get('x-passcode') || '';
  return !!env.PASSCODE && key === env.PASSCODE;
}

function allowedOrigins(env) {
  return (env.ALLOWED_ORIGINS || site.origin).split(',').map(s => s.trim()).filter(Boolean);
}

async function collect(req, env) {
  const origin = req.headers.get('origin') || '';
  const allowed = allowedOrigins(env);
  const cors = {'access-control-allow-origin': allowed.includes(origin) ? origin : allowed[0], 'vary': 'origin'};
  if (req.method === 'OPTIONS') return new Response(null, {status: 204, headers: {...cors, 'access-control-allow-methods': 'POST', 'access-control-allow-headers': 'content-type'}});
  if (req.method !== 'POST') return new Response(null, {status: 405});
  // よそのサイトから送られたものは捨てる
  if (!allowed.includes(origin)) return new Response(null, {status: 403, headers: cors});

  const text = await req.text();
  if (text.length > 4000) return new Response(null, {status: 413, headers: cors});
  let b;
  try { b = JSON.parse(text); } catch { return new Response(null, {status: 400, headers: cors}); }
  const type = TYPES[b.k];
  if (!type || !/^[a-z0-9]{8,40}$/i.test(b.v || '') || !/^[a-z0-9]{8,40}$/i.test(b.s || '')) {
    return new Response(null, {status: 400, headers: cors});
  }

  const now = Date.now();
  const ua = str(req.headers.get('user-agent') || '', 400);
  const bot = detectBot(ua);
  const dev = parseDevice(ua);
  const path = decodePath(str(b.p, 600) || '/');
  const ref = type === 'page_view' && b.r ? classifyReferrer(str(b.r, 500), new URL(site.origin).hostname) : null;
  let kind = bot ? 'crawler' : 'human';

  if (type === 'form_submit' && kind === 'human') {
    const row = await env.DB.prepare(`SELECT COUNT(*) AS c, MIN(ts) AS t0 FROM events WHERE site=? AND session=? AND type='page_view'`)
      .bind(site.id, b.s).first();
    if (isSpamForm(row?.c ?? 0, row?.t0 ? now - row.t0 : null)) kind = 'spam';
  }

  const title = type === 'page_view' ? cleanTitle(str(b.t, 200)) : '';
  await env.DB.prepare(`INSERT INTO events (ts, site, source, type, visitor, session, visits, path, title, referrer, src, src_name,
      kind, bot, device, os, browser, ip, dwell_ms, final) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .bind(now, site.id, 'tag', type, b.v, b.s, Math.max(1, Math.min(9999, b.n | 0)), path, title,
      ref ? str(b.r, 500) : null, ref?.src ?? null, ref?.name ?? null,
      kind, bot, dev.device, dev.os, dev.browser, maskIp(req.headers.get('cf-connecting-ip') || ''),
      type === 'page_leave' ? Math.max(0, Math.min(86400000, b.d | 0)) : null, b.x ? 1 : 0)
    .run();

  if (type === 'page_view' && kind === 'human') {
    await env.DB.prepare(`INSERT INTO pages (site, path, title, first_seen) VALUES (?,?,?,?)
        ON CONFLICT(site, path) DO UPDATE SET title = CASE WHEN excluded.title <> '' THEN excluded.title ELSE pages.title END`)
      .bind(site.id, path, title, now).run();
  }
  return new Response(null, {status: 204, headers: cors});
}

async function town(env) {
  const {results} = await env.DB.prepare(`SELECT path, title, in_sitemap FROM pages WHERE site=?`).bind(site.id).all();
  const pages = results.map(p => ({
    path: p.path,
    title: p.title || nameFromPath(p.path),
    zone: p.path === site.top ? null : zoneOf(p.path, site.zones),
    form: site.formPaths.includes(p.path),
  }));
  if (!pages.some(p => p.path === site.top)) pages.push({path: site.top, title: 'トップページ', zone: null, form: false});
  return json({site: {id: site.id, name: site.name, origin: site.origin}, zones: site.zones.map(z => z.name), top: site.top, pages});
}

function nameFromPath(path) {
  if (path === '/') return 'トップページ';
  const last = path.split('/').filter(Boolean).pop() || path;
  return last.replace(/[-_]/g, ' ').slice(0, 40);
}

async function events(url, env) {
  const after = Number(url.searchParams.get('after')) || 0;
  const from = Number(url.searchParams.get('from')) || 0;
  const limit = Math.min(5000, Number(url.searchParams.get('limit')) || 2000);
  const {results} = await env.DB.prepare(`SELECT id, ts, type, visitor, session, visits, path, title, src, src_name, kind, bot,
      device, os, browser, ip, dwell_ms, final FROM events WHERE site=? AND id>? AND ts>=? ORDER BY id LIMIT ?`)
    .bind(site.id, after, from, limit).all();
  return json({events: results, now: Date.now()});
}

// サイトマップ（入れ子のものも）からページを集める
export async function syncSitemap(env) {
  const seen = new Set();
  const queue = [site.origin + '/sitemap.xml'];
  const paths = new Set();
  while (queue.length && seen.size < 30) {
    const u = queue.shift();
    if (seen.has(u)) continue;
    seen.add(u);
    const res = await fetch(u, {headers: {'user-agent': 'dot-town-monitor (sitemap)'}});
    if (!res.ok) continue;
    const xml = await res.text();
    const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map(m => m[1].trim());
    if (/<sitemapindex/.test(xml)) queue.push(...locs);
    else for (const l of locs) { try { paths.add(decodePath(new URL(l).pathname)); } catch { /* 壊れたURLは飛ばす */ } }
  }
  const now = Date.now();
  const stmts = [...paths].map(p => env.DB.prepare(`INSERT INTO pages (site, path, title, first_seen, in_sitemap) VALUES (?,?,?,?,1)
      ON CONFLICT(site, path) DO UPDATE SET in_sitemap = 1`).bind(site.id, p, '', now));
  for (let i = 0; i < stmts.length; i += 50) await env.DB.batch(stmts.slice(i, i + 50));

  // まだ名前のないページは、ページを開いて <title> を取る
  // （Workers の無料プランは 1 回の実行で外部への取得が 50 回までなので、残りは次回にまわす）
  const budget = Math.max(0, 45 - seen.size);
  const {results} = await env.DB.prepare(`SELECT path FROM pages WHERE site=? AND title='' LIMIT ?`).bind(site.id, budget).all();
  let titled = 0;
  for (const {path} of results) {
    try {
      const res = await fetch(site.origin + encodeURI(path), {headers: {'user-agent': 'dot-town-monitor (title)'}});
      const m = res.ok && (await res.text()).match(/<title[^>]*>([^<]*)<\/title>/i);
      const title = m ? cleanTitle(decodeEntities(m[1])) : '';
      if (title) { await env.DB.prepare(`UPDATE pages SET title=? WHERE site=? AND path=?`).bind(title, site.id, path).run(); titled++; }
    } catch { /* 取れなかったページは次回 */ }
  }
  return {sitemaps: seen.size, pages: paths.size, titled};
}

function decodeEntities(s) {
  return s.replace(/&(amp|lt|gt|quot|#39|#x27);/g, m => ({'&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&#x27;': "'"}[m]))
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n));
}
