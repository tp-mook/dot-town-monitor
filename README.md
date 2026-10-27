# ドット町モニター

ホームページを「町」、ページを「家」、訪れた人を「小人」にして、アクセス状況をドット絵で見える化する監視アプリです。

- 来た人は帽子の色で来訪元（検索・直接・AIチャット・SNS・ほかのサイト）がわかる
- クローラー・フォーム営業ロボット・攻撃の疑いのある相手を見分けて表示する
- 小人や家をクリックすると、道のり・ページごとの滞在時間などの数値が見られる

設計は [docs/design.md](docs/design.md) を見てください。

## つくり

```
public/index.html        町の画面（?demo を付けるとデモデータで動く）
public/t.js              計測タグ（監視するサイトに入れる）
public/dev/              計測タグの確認用ページ（ローカル確認用）
src/index.js             収集サーバー（Cloudflare Workers）
src/lib.js               判定処理（ロボット・端末・来訪元・区画）
sites/*.json             サイトごとの設定（区画の割り当てルール）
schema.sql               データベース（D1）の表
scripts/simulate.mjs     模擬の訪問者を送るスクリプト
test/                    判定処理のテスト
```

## ローカルで動かす

```bash
npm install
```

```bash
cp .dev.vars.example .dev.vars
```

```bash
npm run db:init
```

```bash
npm run dev
```

http://localhost:8787/ を開き、合言葉 `dev` を入れます。別のターミナルで次を実行すると、町のページ一覧を取り込み、模擬の訪問者が歩き出します。

```bash
curl -X POST -H "x-passcode: dev" http://localhost:8787/api/sync-sitemap
```

```bash
npm run simulate -- --minutes 10 --speed 2
```

計測タグの動きは http://localhost:8787/dev/sample-site.html で確かめられます。デモデータの町は http://localhost:8787/?demo です。

テスト:

```bash
npm test
```

## 本番（Cloudflare）

- 画面: https://dot-town-monitor.vision-marketing.workers.dev/ （合言葉が必要）
- 合言葉は Cloudflare の secrets（`PASSCODE`）に入れてある。リポジトリには書かない
- デプロイ:

```bash
npx wrangler deploy
```

- 合言葉を変える:

```bash
npx wrangler secret put PASSCODE
```

## 計測タグの入れかた

監視するサイトの `</body>` の前（Wix は「設定 → カスタムコード」の「body - 末尾」）に入れます。

```html
<script src="https://dot-town-monitor.vision-marketing.workers.dev/t.js" async></script>
```

### 社内の人を数えないようにする

社内のパソコン・スマホで、監視しているサイトのどれかのページを `?dtm=off` を付けて一度開きます（例: https://www.vision-marketing.co.jp/?dtm=off ）。右下に「このブラウザは計測しません」と出たら、そのブラウザは以後計測されません。元に戻すには `?dtm=on` を付けて開きます。ブラウザごとの設定なので、使うブラウザそれぞれで行います。

## 無料枠とデータの保存期間

- 画面は、見ているときは 5 秒ごと、隠れているときは 1 分ごとに新しいイベントだけを取りにいく
- 計測タグの受け口は、同じ IP アドレスから 1 分に 120 回まで
- IP アドレスは 30 日、イベントは 400 日で消す（毎時の定期実行。`wrangler.toml` の `IP_RETENTION_DAYS` / `EVENT_RETENTION_DAYS`）

## ライセンス

未定
