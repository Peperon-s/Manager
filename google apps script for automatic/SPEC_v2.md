# CFS（Claude For Self）仕様書 v2

## 概要

GFS（Gemini For Slack）を発展させた個人用ライフマネジメントシステム。  
**Claude Pro を主窓口**として、Toggl・Google Calendar・Todoist・進捗管理・メモを自然言語で操作する。  
学習相談・教材理解は Gemini / NotebookLM に完全分業し、統合の複雑さを排除する。

| 項目 | 内容 |
|---|---|
| 実行環境 | Google Apps Script (V8 ランタイム) |
| 主窓口 | Claude Pro（claude.ai）+ MCP Server |
| バックエンド | GAS Webhook（MCP Server として公開） |
| AI（操作系） | Claude Tool Use（MCP 経由） |
| AI（処理エンジン） | Gemini API 無料枠（GAS から呼び出し） |
| 学習系（別窓口） | Gemini チャット / NotebookLM（独立・連携なし） |
| 通知出力 | Slack（入力ではなく出力・通知のみ） |
| ダッシュボード | GAS WebApp（既存流用） |
| バージョン管理 | clasp によるローカル↔GAS 同期 |

---

## 設計思想

### 役割分担の原則

| 役割 | ツール | 理由 |
|---|---|---|
| 操作・管理の窓口 | Claude Pro | Tool Use 精度・指示遵守・長い文脈維持が最高水準 |
| 理科系質問・大量データ処理 | Gemini チャット | DeepMind 由来の理科系精度・1M token |
| 教材理解・PDF Q&A | NotebookLM | 出典付き回答・教材特化 |
| バックグラウンド処理 | Gemini API 無料枠 | 1,500 req/日 無料・GAS から直接呼び出し可 |
| 通知・ログ確認 | Slack | 既存インフラ流用・プッシュ通知が強み |

### 統合しない判断

学習系（Gemini / NotebookLM）と操作系（Claude）は**意図的に分離**する。  
無理に A2A 連携を狙うと複雑性が増し使いにくくなるため、接点は「進捗スプレッドシートへの手動記録」のみとする。

### コスト制約

- **API 従量課金なし**（Claude API・Gemini API の従量課金は使用しない）
- Claude Pro サブスクリプション（月額）は許容
- Gemini API 無料枠（15 req/分・1,500 req/日）を GAS バックエンドで継続使用
- GAS・Slack・Todoist・Toggl の無料プランを継続使用

---

## アーキテクチャ

```
あなた
  │
  ├─── 操作・管理したい ──────────────────────────────────────────┐
  │                                                               │
  │    Claude Pro（claude.ai）                                    │
  │      │  自然言語で指示                                         │
  │      │  Tool Use で MCP Server を呼び出し                      │
  │      ▼                                                        │
  │    MCP Server（GAS Webhook / doPost）                         │
  │      │                                                        │
  │      ├─ toggl.js        → Toggl Track API                    │
  │      ├─ tasks.js        → Todoist API                        │
  │      ├─ calendar.js     → Google Calendar                    │
  │      ├─ spreadsheet.js  → Google Spreadsheet（進捗）          │
  │      ├─ memo.js         → Google Spreadsheet（メモ）          │
  │      └─ notify.js       → Slack Incoming Webhook（通知）      │
  │                                                               │
  │    GAS WebApp（doGet）                                        │
  │      └─ dashboard.html  ← ブラウザで直接アクセス              │
  │                                                               │
  └─── 学習したい・相談したい ────────────────────────────────────┘
       │
       ├─ Gemini チャット（gemini.google.com）
       │    ├─ 理科系の問題解説・計算
       │    ├─ 大量テキストの要約・整理
       │    └─ 学習内容の深掘り相談
       │
       └─ NotebookLM（notebooklm.google.com）
            ├─ PDF 教材のアップロード・理解
            ├─ 章構成・問題番号の抽出
            └─ Google Docs へのエクスポート
                 └─（手動）→ Claude に URL を渡して進捗表を作成

Slack（出力のみ）
  └─ GAS から Incoming Webhook で Push
       ├─ 朝の自動サマリー（Time Trigger）
       ├─ タイマー完了通知
       └─ エラー通知
```

---

## ファイル構成

### 継続使用（既存ファイル・変更最小）

| ファイル | 役割 | 変更内容 |
|---|---|---|
| `toggl.js` | Toggl Track API 連携 | 変更なし |
| `tasks.js` | Todoist API 連携 | 変更なし |
| `spreadsheet.js` | 学習進捗スプレッドシート操作 | 変更なし |
| `memo.js` | メモ機能 | 変更なし |
| `webapp.js` | WebApp エントリー・データ集約 | 変更なし |
| `dashboard.html` | WebApp ダークテーマ UI | 変更なし |
| `config.js` | 定数・APIキー定義 | MCP 関連定数を追加 |
| `appsscript.json` | GAS プロジェクト設定 | 変更なし |

### 新規作成・大幅変更

| ファイル | 役割 |
|---|---|
| `mcp.js` | MCP Server エントリーポイント（旧 main.js を置き換え） |
| `notify.js` | Slack Incoming Webhook 通知・朝のサマリー送信 |
| `trigger.js` | Time Trigger 管理（朝のサマリー自動送信） |

### 削除・廃止

| ファイル | 理由 |
|---|---|
| `main.js`（Slack Webhook 受信部分） | Claude が窓口になるため不要 |
| `utils.js`（joinAllPublicChannels） | Slack 入力窓口を廃止するため不要 |

---

## MCP Server 仕様（mcp.js）

### 概要

GAS を MCP（Model Context Protocol）Server として公開する。  
Claude の Tool Use からの HTTP リクエストを受け取り、各ツール関数を実行して結果を返す。

### エンドポイント

```
POST https://{GAS_WEBAPP_URL}
Content-Type: application/json

{
  "tool": "togglStartTimer",
  "params": { "description": "数学の勉強", "workspaceId": 9048938, ... }
}
```

### レスポンス形式

```json
{
  "ok": true,
  "result": "タイマーを開始しました。数学の勉強 / Study / 大学"
}
```

### 公開ツール一覧

#### Toggl 系

| ツール名 | 説明 |
|---|---|
| `togglStartTimer` | タイマー開始 |
| `togglStopTimer` | タイマー停止 |
| `togglCreateEntry` | 手動記録追加（開始・終了時間指定） |
| `togglEditEntry` | 記録編集（直近3日・説明文で検索） |
| `togglDeleteEntry` | 記録削除（直近3日） |
| `togglGetTodayEntries` | 今日の記録一覧 |
| `togglGetWeeklySummary` | 週次サマリー（直近7日） |

#### Google Calendar 系

| ツール名 | 説明 |
|---|---|
| `createCalendarEvent` | イベント追加 |
| `updateCalendarEvent` | イベント編集（タイトル部分一致で検索） |
| `deleteCalendarEvent` | イベント削除 |
| `getTodayEvents` | 今日の予定一覧 |
| `getUpcomingEvents` | 直近予定（デフォルト7日） |

#### Todoist 系

| ツール名 | 説明 |
|---|---|
| `tasksCreate` | タスク追加（1件） |
| `tasksCreateMultiple` | タスク追加（複数） |
| `tasksList` | タスク一覧 |
| `tasksComplete` | タスク完了 |
| `tasksUpdate` | タスク編集 |
| `tasksSetDue` | 期限設定 |

#### 進捗管理系

| ツール名 | 説明 |
|---|---|
| `createProgressSheet` | 進捗表作成（Google Docs URL から） |
| `updateProgressSheet` | 進捗更新 |
| `getProgressSummary` | 進捗確認（プログレスバー付き） |

#### メモ系

| ツール名 | 説明 |
|---|---|
| `memoSave` | メモ保存（タグあり・なし） |
| `memoList` | メモ一覧（タグ絞り込み可） |
| `memoSearch` | メモ検索 |
| `memoDelete` | メモ削除 |

#### ダッシュボード系

| ツール名 | 説明 |
|---|---|
| `getDashboardSummary` | 全データ集約サマリーを返す |

---

## Claude Project 設定

### System Prompt（操作系 Project）

Claude.ai の Project に以下を設定する。チャンネルルーティングの代わりにここでコンテキストを定義する。

```
あなたは私の個人ライフマネジメントアシスタントです。
以下の MCP ツールを使って私の指示を実行してください。

## Toggl 構成
- Life Log ワークスペース（id: 21030286）: 日常生活・食事・運動・休憩・外出
- Study ワークスペース（id: 9048938）
  - クライアント: 大学 → 大学の授業・レポート
  - クライアント: 高校学習 → 再受験・高校範囲
  - クライアント: 趣味の勉強 → 個人的な学習・開発
  - クライアント: 開発 → プログラミング・ツール開発

## Google Calendar 構成
- Life Log: 日常生活・食事・運動・休憩・外出
- Study: 大学・趣味の勉強・開発（高校学習を除く）
- 高校学習: 再受験・高校範囲の学習

## 行動指針
- 内容からワークスペース・クライアント・カレンダーを自動判定する
- 操作の実行前に確認は不要。指示通りに即実行する
- 結果は簡潔に日本語で返す
- 曖昧な指示は最も自然な解釈で実行し、実行後に判断理由を添える
```

---

## Toggl 仕様（既存から継続）

**Toggl 構造**

```
1アカウント
├── Life Log ワークスペース（id: 21030286）
│   └── プロジェクト → タグ
└── Study ワークスペース（id: 9048938）
    ├── クライアント: 大学        → プロジェクト → タグ
    ├── クライアント: 高校学習    → プロジェクト → タグ
    ├── クライアント: 趣味の勉強  → プロジェクト → タグ
    └── クライアント: 開発        → プロジェクト → タグ
```

**使用例**

```
数学の勉強始める
→ togglStartTimer（Study / 大学 or 趣味の勉強 を自動選択）

さっきのランニング記録を終わりにして
→ togglStopTimer

今日の9時から10時半に英語の勉強を記録して
→ togglCreateEntry（startTime: 09:00, stopTime: 10:30）

今週のサマリーを見せて
→ togglGetWeeklySummary
```

---

## Google Calendar 仕様（既存から継続）

| カレンダー名 | 用途 |
|---|---|
| Life Log | 日常生活・食事・運動・休憩・外出 |
| Study | 大学・趣味の勉強・開発（高校学習を除く） |
| 高校学習 | 再受験・高校範囲の学習 |

**使用例**

```
明日14時から1時間、歯医者の予約を入れて
→ createCalendarEvent（Life Log カレンダーに自動振り分け）

「歯医者」の予定を15時に変えて
→ updateCalendarEvent

来週の予定を教えて
→ getUpcomingEvents（days: 7）
```

---

## Todoist 仕様（既存から継続）

**API：** `https://api.todoist.com/api/v1/`

**優先度**

| 表記 | API値 | 表示 |
|---|---|---|
| p1 | 4 | 🔴 緊急 |
| p2 | 3 | 🟠 高 |
| p3 | 2 | 🔵 中 |
| p4 | 1 | ⚪ 通常 |

**使用例**

```
レポート提出を追加して、期限は3月31日でp1で
→ tasksCreate

以下を追加して
・数学のレポート（期限3/31・p1）
・英語の予習（p3）
・買い物
→ tasksCreateMultiple

タスク一覧を見せて
→ tasksList
```

---

## 学習進捗管理仕様（既存から継続）

### フロー

```
1. ユーザーが NotebookLM に PDF 教材をアップロード
2. 「章と問題番号の一覧を出して」と NotebookLM に質問
3. 出力を Google Docs にエクスポートして Drive の指定フォルダに保存
4. Claude に Docs の URL を貼り付けて「進捗表を作って」と指示
5. Claude が createProgressSheet ツールを呼び出し
6. GAS が Docs を読み込み → Gemini が構造を抽出 → スプレッドシートに進捗表を生成
```

### 進捗表スプレッドシート列構成

| 章 | 問題番号 | 種別 | 状態 | 完了日 | メモ |
|---|---|---|---|---|---|
| 第1章 数列 | 例題1 | 例題 | ✅ 完了 | 2026/03/18 | |

**状態の種類：** `⬜ 未着手` / `🔄 進行中` / `✅ 完了`

**管理方法：** 科目名 → スプレッドシート URL のマッピングを Script Properties（`PROGRESS_SHEETS`）に保存

**使用例**

```
この教材の進捗表を作って [Google Docs URL]
→ createProgressSheet

数学IIIの例題1〜5完了
→ updateProgressSheet

全科目の進捗を確認
→ getProgressSummary
```

---

## メモ仕様（既存から継続）

保存先：メインスプレッドシートの「メモ」シート  
列構成：`ID` / `日時` / `タグ` / `内容`

| 操作 | 使用例 |
|---|---|
| 保存 | `メモ: 積分の公式を確認する` |
| タグ付き保存 | `メモ #数学 #積分 置換積分の注意点` |
| 一覧 | `メモ一覧` / `メモ一覧 #数学` |
| 検索 | `メモ検索: 積分` |
| 削除 | `メモ削除: 5` |

---

## Slack 通知仕様（新規・notify.js）

Slack は**入力窓口ではなく通知出力先**として使用する。  
Incoming Webhook URL に POST するだけで実装できるため、Bot Token・チャンネル管理が不要。

### 通知の種類

| 通知 | トリガー | 内容 |
|---|---|---|
| 朝のサマリー | Time Trigger（毎朝指定時刻） | Toggl・Calendar・Tasks・進捗のサマリー |
| タイマー完了 | togglStopTimer 実行後 | 停止した記録の内容・時間 |
| エラー通知 | GAS の例外キャッチ時 | エラー内容・発生箇所 |

### 朝のサマリー形式（既存 buildDashboardMessage_ を流用）

```
📊 デイリーサマリー  2026/03/30 (Mon)
━━━━━━━━━━━━━━━━━━
⏱ TIME TRACKER（昨日）
  Study:    3時間15分
  Life Log:  45分
  合計:  4時間00分

📅 TODAY
  10:00  数学の講義
  14:00  歯医者

✅ TASKS（期限近い順）
  🔴  レポート提出  3/31
  🔵  英単語100個

📖 STUDY PROGRESS
  数学III  ████████░░  82%

🔗 [ダッシュボードを開く]
```

---

## ダッシュボード仕様（既存から継続）

**アクセス：** GAS WebApp デプロイ URL をブラウザで開く  
**アクセス権限：** 自分のみ（Google アカウント認証）

### 画面構成（2カラムグリッド）

| 左カラム | 右カラム |
|---|---|
| ⏱ TIME TRACKER（ライブタイマー付き） | 📅 CALENDAR（今日・直近予定） |
| ✅ TASKS（優先度別・期限表示） | 📖 STUDY PROGRESS（プログレスバー） |

### UI 仕様

- ダーク背景（`#0d1117`）・カード型レイアウト
- 実行中タイマーはブラウザ側で毎秒カウントアップ
- プログレスバーはページ読み込み時にアニメーション
- 「↻ 更新」ボタンでページリロードなしにデータ再取得
- レスポンシブ対応（768px 以下で1カラム）

---

## Gemini API 仕様（バックエンド処理エンジン）

Claude の窓口化後も、GAS バックエンド内で以下の用途に Gemini API を継続使用する。

### 用途

| 用途 | 関数 | 理由 |
|---|---|---|
| 進捗表作成時の構造抽出 | `createProgressSheet` 内 | Docs テキストから章・問題番号を解析 |
| 朝のサマリー文章生成 | `buildDashboardMessage_` 内 | 自然な文章で整形 |

### モデルフォールバック（既存から継続）

```javascript
const GEMINI_MODELS = [
  "gemini-2.5-flash",    // 第1候補・最高性能
  "gemini-2.0-flash",    // 第2候補・バランス型
  "gemini-2.0-flash-lite" // 第3候補・最終手段
];
// ※ gemini-1.5-flash は廃止済みのため使用不可
```

無料枠（15 req/分・1,500 req/日）を超えた場合、自動で次のモデルに切り替える。

---

## 設定値一覧（config.js）

| 定数名 | 内容 | 変更 |
|---|---|---|
| `TOGGL_API_KEY` | Toggl Track API キー | 既存 |
| `GEMINI_API_KEY` | Google Gemini API キー | 既存 |
| `SLACK_INCOMING_WEBHOOK_URL` | Slack 通知用 Incoming Webhook URL | **新規**（Bot Token から変更） |
| `SPREADSHEET_ID` | メインスプレッドシート ID（ログ・メモ共用） | 既存 |
| `TODOIST_API_TOKEN` | Todoist API トークン | 既存 |
| `WEBAPP_URL` | WebApp デプロイ URL | 既存 |
| `NOTEBOOKLM_DOCS_FOLDER_ID` | NotebookLM エクスポート先 Drive フォルダ ID | 既存 |
| `TOGGL_WORKSPACES` | ワークスペース名・ID マッピング | 既存 |
| `MORNING_SUMMARY_HOUR` | 朝のサマリー送信時刻（例: 7） | **新規** |
| `GEMINI_MODELS` | Gemini モデル優先順リスト | 既存 |
| `CALENDAR_HINTS` | カレンダー名→用途説明 | 既存 |
| `MCP_SECRET` | MCP リクエスト認証用シークレットキー | **新規** |

**削除する定数：**
- `SLACK_BOT_TOKEN` → Incoming Webhook に移行するため不要
- `CHANNEL_CONTEXT_MAP` → チャンネルルーティングを廃止するため不要
- `SCHEDULE_CHANNELS` / `STUDY_CHANNELS` → 同上

---

## OAuth スコープ（appsscript.json）

```json
"oauthScopes": [
  "https://www.googleapis.com/auth/calendar",
  "https://www.googleapis.com/auth/spreadsheets",
  "https://www.googleapis.com/auth/drive",
  "https://www.googleapis.com/auth/documents",
  "https://www.googleapis.com/auth/script.external_request"
]
```

変更なし。

---

## 移行手順

### Phase 1：MCP Server の構築（最優先）

```
1. mcp.js を新規作成
   - doPost で JSON を受け取り tool 名でルーティング
   - 既存の toggl.js / tasks.js 等の関数をそのまま呼び出す
   - MCP_SECRET でリクエスト認証

2. config.js に MCP_SECRET を追加

3. clasp push → GAS WebApp を新バージョンで再デプロイ

4. Claude.ai の Project に MCP Server URL を登録

5. System Prompt を設定（本仕様書の「Claude Project 設定」参照）
```

### Phase 2：Slack 通知への移行

```
1. notify.js を新規作成
   - postToSlack_(message) 関数を実装
   - Incoming Webhook URL に POST するだけ

2. config.js に SLACK_INCOMING_WEBHOOK_URL を追加

3. trigger.js を新規作成
   - 朝のサマリー Time Trigger を設定
   - installTrigger() を手動実行してセットアップ

4. 既存 Slack App の Bot Token 依存箇所を Incoming Webhook に切り替え
```

### Phase 3：旧 Slack 入力系の廃止（Phase 1・2 完了後）

```
1. main.js の Slack Webhook 受信処理を削除
2. utils.js を削除
3. config.js から SLACK_BOT_TOKEN 等の不要定数を削除
4. Slack App の Event Subscriptions を無効化
```

---

## 学習系ツールの使い方（Claude とは独立）

### NotebookLM の役割

1. PDF 教材をアップロード
2. 「章と問題番号の一覧を出して」と質問
3. 回答を Google Docs にエクスポート → Drive の所定フォルダに保存
4. Docs URL を Claude に渡して進捗表を作成（ここだけ Claude と接点を持つ）

### Gemini チャットの役割

- 理科系（物理・化学・数学）の問題解説・計算
- 教科書・参考書の大量テキスト要約
- 学習内容の深掘り・概念の整理
- Claude とは**完全に独立**して使う

### Claude との接点（最小限）

```
NotebookLM / Gemini チャット
        │
        │ 人間が手動で進捗をメモ or Docs URL を渡す
        ▼
  Claude（進捗シートへの記録）
        │
        ▼
  Google Spreadsheet（進捗データ）
```

---

## デプロイ手順

### 初回セットアップ

```bash
# 1. clasp でログイン
clasp login

# 2. .clasp.json にスクリプト ID を記載済みであることを確認

# 3. ファイルをプッシュ
clasp push
```

### MCP Server デプロイ

```
GAS エディタ → デプロイを管理 → 新しいデプロイ
  種類: ウェブアプリ
  実行ユーザー: 自分
  アクセス: 全員（Claude からのアクセスを許可するため）
  → URL を config.js の WEBAPP_URL に設定
  → Claude Project の MCP Server URL に登録
```

### WebApp（ダッシュボード）デプロイ

```
GAS エディタ → デプロイを管理 → 新しいデプロイ
  種類: ウェブアプリ
  実行ユーザー: 自分
  アクセス: 自分のみ
```

### Time Trigger セットアップ

```javascript
// GAS エディタのコンソールで手動実行
installTrigger(); // 朝のサマリー送信トリガーを登録
```

### コード変更時

```bash
clasp push
# → GAS エディタで既存デプロイを「新しいバージョン」で再デプロイ
```

---

## 未着手・今後の検討

| 機能 | 概要 | 優先度 |
|---|---|---|
| 夜の振り返りサマリー | 就寝前に当日の記録をまとめて Slack に通知 | 中 |
| 中長期学習計画 | 週次・月次の目標設定と進捗の可視化 | 中 |
| ダッシュボード追加機能 | 随時要望に応じて追加 | 低 |
| Toggl レポートの自動週次送信 | 週末に週次サマリーを Slack に自動通知 | 低 |
