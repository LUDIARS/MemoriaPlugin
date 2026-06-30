# MemoriaPlugin

Memoria 本体の **「ユーザーアプリ」タブ**に機能を足すための**プラグインフレームワーク**。
Memoria 本体に **git submodule** として取り込まれ、 本体プロセスに in-process マウントされる。

- このリポは **土台 (host/) のみ**。 個々のプラグイン実体は同梱しない。
- プラグインは **ユーザが固有に追加する**もの。 本体が読む固定パス（隣接リポ
  `../MemoriaPlugin-Local/plugins`）に置き、 push しない (各自ローカル / 任意で別 private リポ)。
  共有したい汎用プラグインだけ `plugins/` に入れてこのリポへ PR する。

## アーキテクチャ (Memoria 本体 in-process)

Memoria 本体が**このリポを git submodule** (`server/plugins/memoria-plugin`) として取り込み、
起動時に `host/registry.ts: mountPlugins(app, plugins, cfg)` で**本体の Hono に直接マウント**する。
**別プロセス・別ポート・接続 URL は不要**（同一オリジン、 相対パス `/plugins/<id>`）。

```
[ブラウザ] Memoria UI (5180) ── 「ユーザーアプリ」タブ
   └─ iframe ─▶ /plugins/<id>   ← 本体が同一オリジンで配信
[Memoria 本体 (5180)]
   ├─ mountPlugins() で /plugins/<id> を本体 app に登録
   ├─ jobs を本体プロセス内で起動
   └─ announce は announceToDiscord(db, text) を in-process 呼び出し
```

- **機能参照**: `ctx.memoria` (= `HostCapabilities`) 経由。 本体 db に結線した実装
  (`createCapabilityProviders(db)`) が注入される。
- **拡張**: `plugins/<id>/plugin.ts` で `MemoriaPlugin` を default export するだけ
  (動的 import で自動探索、 後述)。
- **モジュール解決**: host/plugins は **NodeNext** (相対 import は `.js` 付き) で書く。
  本体 (tsx, NodeNext) からソース import され、 hono は本体の `server/node_modules` を共有する。

## ディレクトリ

| パス | 役割 |
|---|---|
| `host/` | プラグイン契約・設定ストア・プロキシ・スケジューラ・registry (機能横断の土台) |
| `plugins/<id>/` | 各プラグイン実体（共有プラグイン） |
| `scripts/smoke.ts` | 一過性スクリプト (同梱 plugins/ の読込検証) |
| `data/` | ローカル設定 / 秘密 (**gitignore 済・コミット禁止**) |

## セットアップ

submodule なので Memoria 本体の `server/node_modules` (hono) を共有する。 本体起動時に
in-process マウントされるため、 このリポ単体での起動・待受ポート・環境変数は不要。

読込だけ検証する一過性スモーク:

```bash
npm run smoke     # 同梱 plugins/ を loader で import できるか確認 (ポート/DB は開かない)
```

## プラグイン契約 (`PluginContext`)

`routes(r, ctx)` / `jobs[].run(ctx)` に渡る `ctx` で、 出力先と本体機能にアクセスする。

| `ctx.*` | 用途 |
|---|---|
| `settings` | プラグイン固有設定 (Wireshark 等の接続先/秘密)。 `<dataDir>/plugins/<id>.json`、 gitignore 済 |
| `db` | **SQLite アクセサ**。 `db.table(name)` で `plugin_<id>_*` の物理名を得て自由スキーマで read/write。 `db.query(sql)` は本体含む他テーブルへの**読取り専用** SELECT (書込み文は throw) |
| `memoria` | **本体機能** (`HostCapabilities`、 下表) |
| `log(msg)` | プレフィックス付きログ出力 |
| `basePath` | 公開ベースパス (例 `/plugins/<id>`) |

### `ctx.memoria` (HostCapabilities)

| メソッド | 機能 |
|---|---|
| `announce(text)` | Discord `#announce` へ通知 |
| `latestGps()` | 最新 GPS 位置 (`{lat, lon, recordedAt}` / なければ null) |
| `diary({date?, summary, data?})` | **日記出力**: その日の記事生成にデータを寄稿する (`plugin_diary_entries` → 本体 diary が narration に織り込む) |
| `trend({series, value, unit?, at?})` | **傾向出力**: グラフ化用に系列値を集積する (`plugin_trends` → 「ユーザーアプリ」タブで簡易グラフ表示) |

### 前提条件 (`requirements`) — 要インストール物

Wireshark (`tshark`) のような OS 側インストールが要るものは `requirements` で宣言する。
host がマウント時に `detect()` を走らせ、 **未充足なら `status='needs-setup'`** で
マウントする (ルートは生やすが jobs は起動しない)。 UI に理由が表示される。

```ts
requirements: [{ id: 'tshark', label: 'Wireshark (tshark)',
  hint: 'choco install wireshark', detect: async () => /* PATH 確認等 */ true }]
```

### ライフサイクル / ホットリロード

- `jobs[]` は**起動時にタイマー登録** (`setInterval(intervalMs)` + 起動直後 1 回)。 例外はログに出して継続。
- `POST /api/plugins/<id>/reload` で**プラグイン単体をホットリロード** (旧タイマー破棄 →
  entry を再 import → ルート/ジョブ組み直し)。 「ユーザーアプリ」タブの ⟳ ボタンからも実行可。

## 新プラグインの足し方

1. `plugins/<id>/plugin.ts` で `MemoriaPlugin` を default export
2. Memoria 「ユーザーアプリ」タブに自動で子として現れる (manifest 経由)

`plugins/` 配下は **起動時に動的 import で自動探索** される (`host/loader.ts`、
Concordia の reaction-workflow-loader と同じディレクトリ走査方式)。 静的な登録配列は無く、
フォルダを足すだけでよい (`plugin.ts` / `plugin.js` を置く。 `.`/`_` 始まりは除外)。

テンプレートは Memoria 本体リポ (`docs/plugin-template/`) にもコミットしてある。

### 個人 (ユーザカスタム) フォルダ — 固定パス

ユーザ独自のプラグインは**このリポ外**の固定パス、 隣接リポ
`../MemoriaPlugin-Local/plugins` に置く。 本体 (`server/plugins/host.ts`) が同梱 `plugins/`
の後にここを走査する (env 設定は不要)。

- 走査順は **同梱 `plugins/` → 個人フォルダ** で、同じ `id` は**個人フォルダが上書き**する
  (共有プラグインをユーザがローカルで差し替えられる)。
- 個人フォルダの中身は `plugins/<id>/plugin.ts` と同じ構造 (フォルダ単位)。
- カスタムはリポにコミットせず各自ローカルで足す。共有したい変更だけ
  `plugins/` に入れてこのリポへ。
