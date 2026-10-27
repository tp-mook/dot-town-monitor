CREATE TABLE IF NOT EXISTS events (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  ts        INTEGER NOT NULL,          -- 受け取った時刻（ミリ秒）
  site      TEXT NOT NULL,
  source    TEXT NOT NULL,             -- tag | log
  type      TEXT NOT NULL,             -- page_view | page_leave | form_submit | request
  visitor   TEXT,
  session   TEXT,
  visits    INTEGER,                   -- 何回目の訪問か（タグがブラウザに保存した回数）
  path      TEXT,
  title     TEXT,
  referrer  TEXT,
  src       TEXT,                      -- search | direct | ai | sns | other
  src_name  TEXT,
  kind      TEXT NOT NULL,             -- human | crawler | spam | attacker
  bot       TEXT,
  device    TEXT,
  os        TEXT,
  browser   TEXT,
  ip        TEXT,                      -- 末尾を伏せたもの
  status    INTEGER,
  method    TEXT,
  dwell_ms  INTEGER,
  final     INTEGER DEFAULT 0          -- 1 = サイトを離れた
);
CREATE INDEX IF NOT EXISTS idx_events_site_ts ON events (site, ts);
CREATE INDEX IF NOT EXISTS idx_events_session ON events (site, session);

CREATE TABLE IF NOT EXISTS pages (
  site       TEXT NOT NULL,
  path       TEXT NOT NULL,
  title      TEXT NOT NULL DEFAULT '',
  first_seen INTEGER,
  in_sitemap INTEGER DEFAULT 0,
  PRIMARY KEY (site, path)
);
