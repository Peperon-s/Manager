# CFS Web Application (Standalone Edition) 仕様書 v4.0

## 1. 概要

本仕様書は、GAS（Google Apps Script）依存から完全に脱却し、**Node.js + Express** ベースの独立型Webアプリケーションとして再構築したCFS（Comprehensive Flow System）の設計を定める。

v3（GAS Edition）との最大の違いは以下の3点：

| 項目 | v3 (GAS) | v4 (Standalone) |
| :--- | :--- | :--- |
| バックエンド | Google Apps Script | Node.js + Express |
| Google API通信 | `CalendarApp`等GAS内蔵サービス | Google OAuth2 + REST API |
| クライアント通信 | `google.script.run`（非同期RPC） | 通常のHTTP REST (`fetch`) |
| デプロイ | GASのデプロイ管理画面 | Railway / Render / Fly.io 等 |
| 設定管理 | `config.js`にハードコード | `.env`ファイル（環境変数） |

機能セット（Toggl・Todoist・Google Calendar・進捗管理・Gemini AI）はv3と完全に同一。

---

## 2. アーキテクチャ

### 2.1 全体構成

```
[ブラウザ (PWA)]
      │  HTTP REST (fetch / HTTPS)
      ▼
[Express サーバー]
  ├── /api/auth        ← PIN認証 → JWTトークン発行
  ├── /api/dashboard   ← ダッシュボードデータ集約
  ├── /api/chat        ← AIチャット処理
  └── /api/oauth/*     ← Google OAuth2フロー

[Express サーバー内部]
  ├── Gemini API       ← AIリクエスト（Gemini REST API）
  ├── Toggl API        ← 時間記録
  ├── Todoist API      ← タスク管理
  ├── Google Calendar API  ← 予定管理（OAuth2トークン使用）
  └── Google Sheets API    ← 学習進捗（OAuth2トークン使用）
```

### 2.2 使用技術スタック

| 層 | 技術 |
| :--- | :--- |
| **サーバー** | Node.js (>=20) + Express |
| **フロントエンド** | HTML / CSS / Vanilla JS (v3の`dashboard.html`を移植) |
| **AI エンジン** | Gemini API REST (`gemini-2.5-flash` 他フォールバック構成) |
| **認証** | PINコード → JWT（`jsonwebtoken`）発行・検証 |
| **Google連携** | `google-auth-library` + OAuth2フロー |
| **デプロイ** | Railway / Render / Fly.io（任意のNode.jsホスト） |
| **設定管理** | `.env`ファイル（`dotenv`） |

---

## 3. ファイル構造

```
cfs-webapp/
├── .env                    # 環境変数（APIキー等 / git管理外）
├── .env.example            # .envのサンプル（git管理内）
├── package.json
├── server.js               # Expressエントリーポイント
│
├── routes/
│   ├── auth.js             # POST /api/auth/pin（PIN認証 → JWT発行）
│   ├── dashboard.js        # GET  /api/dashboard（データ集約）
│   ├── chat.js             # POST /api/chat（AIチャット処理）
│   └── oauth.js            # GET  /api/oauth/google（GoogleOAuth2フロー）
│
├── services/
│   ├── gemini.js           # Gemini API呼び出し・フォールバック
│   ├── toggl.js            # Toggl Track API
│   ├── todoist.js          # Todoist REST API
│   ├── googleCalendar.js   # Google Calendar API (OAuth2)
│   └── googleSheets.js     # Google Sheets API (OAuth2)
│
├── middleware/
│   └── auth.js             # JWTトークン検証ミドルウェア
│
├── ai/
│   ├── router.js           # handleChatMessage（v3の handleWebChatMessage_ 相当）
│   ├── tools.js            # 全21ツール宣言（v3の getUniversalToolDeclarations_ 相当）
│   └── executor.js         # executeFunctionCall（v3の executeFunctionCall_ 相当）
│
└── public/
    └── index.html          # フロントエンド（v3の dashboard.html を移植・修正）
```

---

## 4. 環境変数（.env）

```env
# サーバー
PORT=3000
JWT_SECRET=任意のランダム文字列

# 認証
WEBAPP_PIN=2026

# AI
GEMINI_API_KEY=...
CLAUDE_API_KEY=   # 将来の従量課金移行用（省略可）

# Toggl
TOGGL_API_KEY=...
TOGGL_WS_LIFELOG_ID=21030286
TOGGL_WS_STUDY_ID=9048938

# Todoist
TODOIST_API_TOKEN=...

# Google OAuth2（Google Cloud Console で取得）
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
GOOGLE_REDIRECT_URI=http://localhost:3000/api/oauth/google/callback

# Google Sheets（進捗管理用スプレッドシートID）
SPREADSHEET_ID=...
```

---

## 5. 認証フロー

### 5.1 PIN認証（v3と同じロジック、通信方式のみ変更）

1. ブラウザから `POST /api/auth/pin` に `{ pin: "2026" }` を送信。
2. サーバーが`.env`の`WEBAPP_PIN`と照合。
3. 一致したら`jsonwebtoken`でJWTを発行し、レスポンスに含める。
4. ブラウザはJWTを`localStorage`に保存し、以降のAPIリクエストに `Authorization: Bearer <token>` ヘッダーを付与。

### 5.2 Googleアカウント連携（新規）

Google CalendarとGoogle Sheetsへのアクセスには、Google OAuth2が必要。

1. ブラウザが `GET /api/oauth/google` へリダイレクト。
2. サーバーがGoogle認証URLを生成してリダイレクト。
3. Googleログイン・スコープ許可後、`/api/oauth/google/callback` に認証コードが返る。
4. サーバーがアクセストークン・リフレッシュトークンを取得し、**サーバー側の安全なストレージ（ファイルまたはDB）に保存**。
5. 以降のCalendar/Sheets API呼び出し時にトークンを自動的に使用・更新。

> **必要なOAuthスコープ**
> - `https://www.googleapis.com/auth/calendar`
> - `https://www.googleapis.com/auth/spreadsheets`

---

## 6. APIエンドポイント仕様

### `GET /api/dashboard`

**認証**: JWT必須

**レスポンス（JSON）**:
```json
{
  "date": "2026/04/06",
  "dayOfWeek": "Mon",
  "time": "14:30",
  "toggl": { "byWorkspace": [...], "totalFormatted": "3h 20m", "running": {...} | null },
  "calendar": { "today": [...], "upcoming": [...] },
  "tasks": { "byPriority": { "p1": [...], "p2": [...], "p3": [...], "p4": [...] }, "total": 5 },
  "progress": [{ "subject": "数学", "done": 12, "total": 30, "pct": 40 }]
}
```

v3の`getDashboardData()`と完全に同一の構造を保つことで、フロントエンドのJS変更を最小化する。

---

### `POST /api/chat`

**認証**: JWT必須

**リクエスト（JSON）**:
```json
{
  "message": "数学の課題開始",
  "history": [
    { "role": "user", "text": "..." },
    { "role": "ai", "text": "..." }
  ]
}
```

**レスポンス（JSON）**:
```json
{
  "message": "✅ Togglタイマーを開始しました！...",
  "shouldRefresh": true,
  "newHistory": [...]
}
```

v3の`processChatMessage()`と完全に同一の入出力構造。

---

## 7. フロントエンド（`public/index.html`）

v3の`dashboard.html`からの変更点は**通信方式のみ**。

| v3 (GAS) | v4 (Standalone) |
| :--- | :--- |
| `google.script.run.getDashboardData(...)` | `fetch('/api/dashboard', { headers: { Authorization: ... } })` |
| `google.script.run.processChatMessage(...)` | `fetch('/api/chat', { method: 'POST', ... })` |
| `google.script.run.verifyWebAppPin(...)` | `fetch('/api/auth/pin', { method: 'POST', ... })` |

ロジック（`loadDashboard`、`sendChatMessage`、`chatHistoryContext`管理等）はv3のまま流用可能。

---

## 8. AIルーター（`ai/router.js`）

v3の`handleWebChatMessage_()` / `executeFunctionCall_()` / `getUniversalToolDeclarations_()` をそのまま移植。

変更点：
- GAS固有の`Utilities.formatDate()` → `date-fns`等のnpmパッケージで代替
- `PropertiesService` → `process.env` または JSONファイルで代替
- `logToSheet()` → `console.log()`またはログファイルで代替（Google Sheets Loggingは任意）

全21ツール定義（Toggl×7、Calendar×4、Todoist×6、Progress×4）はそのまま維持。

---

## 9. Google APIサービス層の差異

### v3 → v4 の対応表

| v3 (GAS) | v4 (Standalone) |
| :--- | :--- |
| `CalendarApp.getAllCalendars()` | `calendar.calendarList.list()` (Calendar API v3) |
| `cal.getEvents(start, end)` | `calendar.events.list({ calendarId, timeMin, timeMax })` |
| `cal.createEvent(title, start, end)` | `calendar.events.insert({ calendarId, resource: {...} })` |
| `SpreadsheetApp.openById(id)` | `sheets.spreadsheets.values.get({ spreadsheetId, range })` |
| `sheet.appendRow([...])` | `sheets.spreadsheets.values.append({ spreadsheetId, range, resource })` |
| `UrlFetchApp.fetch(url, opts)` | `node-fetch` / ネイティブ`fetch` |

---

## 10. v3からの移行手順

1. **Google Cloud Projectを作成**し、Calendar API・Sheets APIを有効化。OAuth2クライアントIDを取得。
2. `npm init` → `npm install express jsonwebtoken dotenv google-auth-library node-fetch`
3. `services/`層を実装（Toggl/Todoistは単純なHTTP呼び出しなのでそのまま移植）。
4. `services/googleCalendar.js`・`services/googleSheets.js`をOAuth2対応で実装。
5. `ai/`層（router, tools, executor）はv3の関数をほぼそのままペースト。GAS固有APIを置き換える。
6. `public/index.html`のJSを`fetch`ベースに書き換え（30行程度の変更）。
7. `.env`にAPIキーを設定し、ローカルで`node server.js`で動作確認。
8. RailwayまたはRenderにリポジトリをプッシュしてデプロイ。

---

## 11. 旧バージョンとの比較・変更点まとめ

| 項目 | v3 (GAS) | v4 (Standalone) |
| :--- | :--- | :--- |
| デプロイ手間 | GASエディタ上でのデプロイ操作が必要 | git push → 自動デプロイ（CI/CD） |
| ローカル開発 | GASはブラウザエディタのみ、ローカル実行不可 | `node server.js`でローカル実行可 |
| デバッグ | `console.log`はGAS実行ログのみ | 標準的なNode.jsデバッグ（VSCode等） |
| Google API | GAS内蔵サービスで認証不要 | OAuthフロー実装が必要（初回のみ） |
| テスト | 書きにくい | Jest等の標準テストツールが使える |
| 無料枠 | GASの実行時間制限（6分/実行）あり | ホスティング費用次第（Railway Free等） |
| Geminiコスト | 無料枠に依存（v3と同様） | 同様。`CLAUDE_API_KEY`へのフォールバック対応を維持 |

---

## 12. データベース設計

### 12.1 設計方針

| データ種別 | 管理場所 | 理由 |
| :--- | :--- | :--- |
| 進捗管理（科目・問題） | **Google Sheets（現状維持）** | NotebookLM → Google Docs → Sheets の連携フローがGoogle内で完結しており、SQLに移すと連携が複雑化する |
| ログ（操作・エラー） | **SQLite** | Sheetsの "Logs" シートより検索・フィルタが容易 |
| チャット履歴 | **SQLite**（将来用） | 現状はJSメモリのみ。セッション跨ぎで保持したくなったときに追加 |

### 12.2 SQLテーブル構成

詳細は `schema.sql` を参照。

**logs**（ログテーブル）
| 列 | 型 | 説明 |
| :--- | :--- | :--- |
| id | INTEGER PK | |
| level | TEXT | 'info' / 'warn' / 'error' |
| message | TEXT | |
| created_at | DATETIME | |

**chat_history**（チャット履歴テーブル・将来用）
| 列 | 型 | 説明 |
| :--- | :--- | :--- |
| id | INTEGER PK | |
| role | TEXT | 'user' / 'ai' |
| message | TEXT | |
| created_at | DATETIME | |

### 12.3 DBエンジン選択

| 環境 | 推奨 | 理由 |
| :--- | :--- | :--- |
| ローカル開発 / 個人運用 | **SQLite**（`better-sqlite3`） | ファイル1つで完結。設定ゼロ。 |
| 将来スケールが必要な場合 | PostgreSQL | `schema.sql`の型宣言を一部変更するだけで移行可能 |

---

## 14. 今後の展望・保守

- **Linear連携**: `ai/executor.js`に`executeLinearFunctionCall_`を追加するだけで拡張可能（v3と同様の拡張性）。
- **AIエンジン切り替え**: `services/gemini.js`の実装を差し替えるか、`CLAUDE_API_KEY`を`.env`に設定することでClaude APIへフォールバック可能。
- **認証強化**: 現状のPIN認証で十分だが、将来的には`express-session` + Cookieベースのセッション管理への移行も容易。
- **DB導入**: 進捗管理にGoogle Sheetsを使い続ける場合はそのままでよいが、よりリッチな機能が必要な場合はSQLite（`better-sqlite3`）等の軽量DBを追加可能。
