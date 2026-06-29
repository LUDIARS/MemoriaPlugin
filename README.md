# MemoriaPlugin

Memoria 本体の **「ユーザーアプリ」タブ**に機能を足すための**プラグインフレームワーク**。
Memoria 本体に **git submodule** として取り込まれ、 本体プロセスに in-process マウントされる。

- このリポは **土台 (host/) のみ**。 個々のプラグイン実体は同梱しない。
- プラグインは **ユーザが固有に追加する**もの。 リポ外 (`MEMORIA_PLUGINS_DIR`) に置き、
  push しない (各自ローカル / 任意で別 private リポ)。 共有したい汎用プラグインだけ
  `plugins/` に入れてこのリポへ PR する。

## アーキテクチャ (2 つの消費形態)

このリポは「プラグインの土台 (host/) + 実体 (plugins/)」で、 **2 通りに消費できる**。

### A. Memoria 本体 in-process (既定 / Concordia 方式)

Memoria 本体が**このリポを git submodule** (`server/plugins/memoria-plugin`) として取り込み、
起動時に `host/registry.ts: mountPlugins(app, plugins, cfg)` で**本体の Hono に直接マウント**する。
別プロセス・別ポート・接続 URL は不要 (同一オリジン)。

```
[ブラウザ] Memoria UI (5180) ── 「ユーザーアプリ」タブ
   └─ iframe ─▶ /plugins/<id>   ← 本体が同一オリジンで配信
[Memoria 本体 (5180)]
   ├─ mountPlugins() で /plugins/<id> を本体 app に登録
   ├─ jobs を本体プロセス内で起動
   └─ announce は announceToDiscord(db, text) を in-process 呼び出し
```

### B. サイドカー単体 (開発 / 任意)

`src/index.ts` (= `buildApp`) で専用 Hono を建て、 `/manifest` を公開する従来形態。
本体から切り離して単体で動作確認するときに使う (port 既定 5191)。

- **接続**: プラグインは設定画面で入れた認証情報で外部サービスに繋ぐ。
- **通知**: `MemoriaClient` 経由。 in-process は `createInProcessMemoriaClient(announce)`、
  サイドカーは `createMemoriaClient({baseUrl, token})` (HTTP)。
- **拡張**: `plugins/<id>/plugin.ts` で `MemoriaPlugin` を default export するだけ
  (動的 import で自動探索、 後述)。
- **モジュール解決**: host/plugins は **NodeNext** (相対 import は `.js` 付き) で書く。
  本体 (tsx, NodeNext) からソース import され、 hono は本体の `server/node_modules` を共有する。

## ディレクトリ

| パス | 役割 |
|---|---|
| `host/` | プラグイン契約・設定ストア・プロキシ・スケジューラ・registry (機能横断の土台) |
| `plugins/<id>/` | 各プラグイン実体 |
| `src/index.ts` | エントリ (プラグイン登録 + 起動) |
| `scripts/` | 一過性スクリプト (接続テスト等) |
| `data/` | ローカル設定 / 秘密 (**gitignore 済・コミット禁止**) |

## セットアップ

```bash
npm install
```

### 環境変数

| 変数 | 既定 | 説明 |
|---|---|---|
| `MEMORIA_PLUGIN_PORT` | `5191` | ホスト待受ポート |
| `MEMORIA_PLUGIN_PUBLIC_URL` | `http://localhost:5191` | manifest の URL 生成元 |
| `MEMORIA_BASE_URL` | `http://localhost:5180` | Memoria 本体 |
| `MEMORIA_PLUGIN_TOKEN` | (空) | Memoria 側 `plugins.api_token` と一致させる |
| `MEMORIA_PLUGIN_DATA` | `./data` | 設定/秘密の保存先 |
| `MEMORIA_PLUGINS_DIR` | (空) | **外部 (ユーザカスタム) プラグインフォルダ**。`;` か `,` 区切りで複数可。同梱 `plugins/` の後に走査され、同 id は外部が上書きする |

`MEMORIA_PLUGIN_TOKEN` は秘密なので `.env.secrets` に置く (gitignore 済)。

## 起動

> サービス常駐は Excubitor か人手で。 セッションから直接 dev server は立てない方針
> ([[feedback_service_start_delegate_excubitor]] / [[feedback_no_dev_server]])。

```bash
npm start          # 本番相当
npm run dev        # 開発 (watch)
```

## 非公開送迎サービス位置通知 (`plugins/private-transit`)

毎朝 `window_start`〜`window_end` に非公開送迎サービス (`route`, 既定「既定便」) の
GPS を確認し、自宅との距離が `radius_m` (既定 1500m) 以内になると Memoria の
`#announce` に通知する。

### 接続テスト

設定画面で ID/パスを保存後:

```bash
npm run test:connection
```

→ `[200] 接続成功` なら認証 OK。

### 状態

- 接続 (Basic 認証プロキシ + モバイル地図表示): **実装済**
- GPS 抽出 (`private-transit-service.ts: fetchBusGps`): **未配線**。認証後の `endpoint.php` が
  叩く座標エンドポイントの形を解析してから実装する (`throw` で明示)。

## 新プラグインの足し方

1. `plugins/<id>/plugin.ts` で `MemoriaPlugin` を default export
2. Memoria 「ユーザーアプリ」タブに自動で子として現れる (manifest 経由)

`plugins/` 配下は **起動時に動的 import で自動探索** される (`host/loader.ts`、
Concordia の reaction-workflow-loader と同じディレクトリ走査方式)。 静的な登録配列は無く、
フォルダを足すだけでよい (`plugin.ts` / `plugin.js` を置く。 `.`/`_` 始まりは除外)。

テンプレートは Memoria 本体リポ (`docs/plugin-template/`) にもコミットしてある。

### 外部 (ユーザカスタム) フォルダ — Concordia 方式

ユーザ独自のプラグインは**このリポ外**のフォルダに置き、`MEMORIA_PLUGINS_DIR` で
指す (Concordia が RWF を `CONCORDIA_RWF_PLUGIN_PATH` で外部読みするのと同じ
「外部フォルダ優先 + 同梱フォールバック」方式)。

```bash
# 例: 自分専用プラグインを別フォルダで管理し、push しない
MEMORIA_PLUGINS_DIR=E:/Document/Ars/MemoriaPlugin-Custom/plugins npm start
```

- 走査順は **同梱 `plugins/` → 外部** で、同じ `id` は**外部が上書き**する
  (共有プラグインをユーザがローカルで差し替えられる)。
- 外部フォルダの中身は `plugins/<id>/plugin.ts` と同じ構造 (フォルダ単位)。
- カスタムはリポにコミットせず各自ローカルで足す。共有したい変更だけ
  `plugins/` に入れてこのリポへ。
