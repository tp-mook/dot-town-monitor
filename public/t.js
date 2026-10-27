/* ドット町モニター 計測タグ
 * 監視するサイトの </body> の前などに次の1行を入れる:
 *   <script src="https://（収集サーバー）/t.js" async></script>
 * 送るもの: 表示したページ・離れたページと滞在時間・フォーム送信・来る前のURL
 * 氏名などは取らない。ブラウザには乱数の識別子と訪問回数だけを保存する。
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
    set: function (k, v) { try { localStorage.setItem(k, v); } catch (e) { /* 保存できなくても計測は続ける */ } return v; }
  };
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

  var cur = null, t0 = 0, first = true, pending = null;
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
    cur = null;
  }

  // Wix などはページを切り替えても読み込み直さないので、URL の変化を見張る
  ['pushState', 'replaceState'].forEach(function (m) {
    var orig = history[m];
    history[m] = function () { var r = orig.apply(this, arguments); setTimeout(view, 0); return r; };
  });
  addEventListener('popstate', function () { setTimeout(view, 0); });
  setInterval(view, 1000);

  addEventListener('pagehide', leave);
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'hidden') leave();
    else if (!cur) view();
  });

  // フォーム送信（素の form と、「送信」ボタンのクリック）
  var lastForm = 0;
  function formSent() {
    if (Date.now() - lastForm < 3000) return;
    lastForm = Date.now();
    touchSession();
    send({k: 'f', p: cur || currentPath()});
  }
  document.addEventListener('submit', formSent, true);
  document.addEventListener('click', function (e) {
    var el = e.target && e.target.closest && e.target.closest('button, [role="button"], input[type="submit"]');
    if (el && /送信|submit|send/i.test(el.textContent || el.value || '')) formSent();
  }, true);

  view();
})();
