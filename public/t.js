/* ドット町モニター 計測タグ
 * 監視するサイトの </body> の前などに次の1行を入れる:
 *   <script src="https://（収集サーバー）/t.js" async></script>
 * 送るもの: 表示したページ・離れたページと滞在時間・フォーム送信・来る前のURL
 * 氏名などは取らない。ブラウザには乱数の識別子と訪問回数だけを保存する。
 * 社内の人のブラウザは、どれかのページを ?dtm=off を付けて一度開くと、以後は計測しない（?dtm=on で戻す）。
 */
(function () {
  if (window.__dtm) return;
  window.__dtm = 1;
  var me = document.currentScript && document.currentScript.src;
  if (!me) return;
  var END = me.replace(/\/t\.js(\?.*)?$/, '') + '/collect';
  var SESSION_GAP = 30 * 60 * 1000;

  var store = {
    get: function (k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set: function (k, v) { try { localStorage.setItem(k, v); } catch (e) { /* 保存できなくても計測は続ける */ } return v; },
    del: function (k) { try { localStorage.removeItem(k); } catch (e) { /* なにもしない */ } }
  };

  // 社内の人の除外
  function note(text) {
    var d = document.createElement('div');
    d.textContent = 'ドット町モニター：' + text;
    d.style.cssText = 'position:fixed;right:12px;bottom:12px;z-index:2147483647;background:#2b2118;color:#fff;padding:8px 12px;border-radius:6px;font:13px sans-serif;box-shadow:0 2px 8px rgba(0,0,0,.3)';
    (document.body || document.documentElement).appendChild(d);
    setTimeout(function () { d.remove(); }, 5000);
  }
  var q = location.search;
  if (/[?&]dtm=off(&|$)/.test(q)) { store.set('dtm_off', '1'); note('このブラウザは計測しません'); }
  if (/[?&]dtm=on(&|$)/.test(q)) { store.del('dtm_off'); note('このブラウザも計測します'); }
  if (store.get('dtm_off') === '1') return;

  function rid() {
    var a = new Uint8Array(12);
    (window.crypto || window.msCrypto).getRandomValues(a);
    return Array.prototype.map.call(a, function (b) { return ('0' + b.toString(16)).slice(-2); }).join('');
  }

  var visitor = store.get('dtm_v') || store.set('dtm_v', rid());
  var session, visits;
  function touchSession() {
    var now = Date.now();
    var last = +store.get('dtm_last') || 0;
    session = store.get('dtm_s');
    visits = +store.get('dtm_n') || 0;
    if (!session || now - last > SESSION_GAP) {
      session = store.set('dtm_s', rid());
      visits = +store.set('dtm_n', String(visits + 1));
    }
    store.set('dtm_last', String(now));
  }

  function send(o) {
    o.v = visitor; o.s = session; o.n = visits;
    var body = JSON.stringify(o);
    try {
      if (navigator.sendBeacon && navigator.sendBeacon(END, new Blob([body], {type: 'text/plain'}))) return;
    } catch (e) { /* 下の fetch で送る */ }
    try { fetch(END, {method: 'POST', body: body, keepalive: true, mode: 'cors', headers: {'Content-Type': 'text/plain'}}); } catch (e) { /* あきらめる */ }
  }

  function currentPath() {
    try { return decodeURIComponent(location.pathname); } catch (e) { return location.pathname; }
  }

  var cur = null, t0 = 0, first = true, pending = null, hiddenPath = null;
  function flushView() {
    if (!pending) return;
    clearTimeout(pending.timer);
    send({k: 'v', p: pending.p, t: document.title, r: pending.r, w: screen.width});
    pending = null;
  }
  function view() {
    var p = currentPath();
    if (p === cur) return;
    touchSession();
    if (cur) { flushView(); send({k: 'l', p: cur, d: Date.now() - t0}); }
    cur = p; t0 = Date.now();
    // ページの切り替え直後はタイトルがまだ古いことがあるので、少し待ってから送る
    pending = {p: p, r: first ? document.referrer : '', timer: setTimeout(flushView, 700)};
    first = false;
  }
  function leave() {
    if (!cur) return;
    flushView();
    send({k: 'l', p: cur, d: Date.now() - t0, x: 1});
    hiddenPath = cur;
    cur = null;
  }
  function resume() {
    // 別のタブから戻ってきただけなら、同じページの見直しとして送る（閲覧数には数えない）
    var p = currentPath();
    if (cur || hiddenPath !== p) { view(); return; }
    touchSession();
    cur = p; t0 = Date.now(); hiddenPath = null;
    send({k: 'r', p: p});
  }

  // ページを切り替えても読み込み直さないサイトでは、URL の変化を見張る
  ['pushState', 'replaceState'].forEach(function (m) {
    var orig = history[m];
    history[m] = function () { var r = orig.apply(this, arguments); setTimeout(view, 0); return r; };
  });
  addEventListener('popstate', function () { setTimeout(view, 0); });
  setInterval(function () { if (cur) view(); }, 1000);

  addEventListener('pagehide', leave);
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'hidden') leave();
    else resume();
  });

  // フォーム送信
  var lastForm = 0;
  function formSent() {
    if (Date.now() - lastForm < 3000) return;
    lastForm = Date.now();
    touchSession();
    send({k: 'f', p: cur || currentPath()});
  }
  // 素の form は submit で送信が決まる
  document.addEventListener('submit', formSent, true);

  // Wix などのフォームは「送信」ボタンを押しても、入力漏れなら送られない。
  // 押したあとに送信完了のしるし（完了の文言が出る・入れた内容が消える）を確かめてから送る
  var DONE = /ありがとう|送信(が|は)?(完了|しました|されました)|受け付けました|thank\s*you|thanks for/ig;
  // 入力漏れのときは内容が残り完了の文言も出ないので、15秒たっても何も送らない。押し直したら見張り直す
  var watchTimer = null;
  function countDone() { return ((document.body && document.body.innerText) || '').match(DONE) || []; }
  function watchForm(btn) {
    clearInterval(watchTimer);
    var form = btn.closest('form') || btn.closest('[role="form"]') || document.body;
    var fields = Array.prototype.filter.call(form.querySelectorAll('input:not([type=hidden]):not([type=checkbox]):not([type=radio]), textarea'),
      function (el) { return el.value; });
    var doneBefore = countDone().length;
    var start = Date.now();
    watchTimer = setInterval(function () {
      if (Date.now() - start > 15000) return clearInterval(watchTimer);
      var cleared = fields.length > 0 && fields.every(function (el) { return !document.contains(el) || !el.value; });
      if (countDone().length > doneBefore || cleared) { clearInterval(watchTimer); formSent(); }
    }, 400);
  }
  document.addEventListener('click', function (e) {
    var el = e.target && e.target.closest && e.target.closest('button, [role="button"], input[type="submit"]');
    if (el && /送信|submit|send/i.test(el.textContent || el.value || '')) watchForm(el);
  }, true);

  view();
})();
