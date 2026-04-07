# CFS（Claude For Self）仕様書 v2.1

## 概要

GFS（Gemini For Slack）を発展させた個人用ライフマネジメントシステム。  
**Claude Pro を主窓口**として、Toggl・Google Calendar・Todoist・Linear・進捗管理・メモを自然言語で操作する。  
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

### v2.1 変更点

- **Linear を追加**：学習・開発タスクの週次サイクル管理ツールとして新規追加
- **タスク管理の役割分担を明確化**：Todoist（日常タスク）と Linear（学習・開発の週次管理）を併用

---

## 設計思想

### 役割分担の原則

| 役割 | ツール | 理由 |
|---|---|---|
| 操作・管理の窓口 | Claude Pro | Tool Use 精度・指示遵守・長い文脈維持が最高水準 |
| 日常タスク管理 | Todoist | 締め切りドリブン・繰り返しタスク・自然言語期限指定が得意 |
| 学習・開発の週次管理 | Linear | 1週間サイクル・未完了の自動持ち越し・振り返りが得意 |
| 理科系質問・大量データ処理 | Gemini チャット | DeepMind 由来の理科系精度・1M token |
| 教材理解・PDF Q&A | NotebookLM | 出典付き回答・教材特化 |
| バックグラウンド処理 | Gemini API 無料枠 | 1,500 req/日 無料・GAS から直接呼び出し可 |
| 通知・ログ確認 | Slack | 既存インフラ流用・プッシュ通知が強み |

### タスク管理の使い分け

```
Todoist（日常・雑務）              Linear（学習・開発）
─────────────────────             ──────────────────────
買い物・病院・生活系の締め切り      今週やる教材・問題範囲のコミット
レポート提出など期限明確なもの      完了しなかった分の自動持ち越し
繰り返しタスク（毎週・毎日）        CFS 開発の Issue 管理
p1〜p4 の優先度管理               週次レビュー・振り返り
```

### 統合しない判断

学習系（Gemini / NotebookLM）と操作系（Claude）は**意図的に分離**する。  
無理に A2A 連携を狙うと複雑性が増し使いにくくなるため、接点は「進捗スプレッドシートへの手動記録」のみとする。

### コスト制約

- **API 従量課金なし**（Claude API・Gemini API の従量課金は使用しない）
- Claude Pro サブスクリプション（月額）は許容
- Gemini API 無料枠（15 req/分・1,500 req/日）を GAS バックエンドで継続使用
- GAS・Slack・Todoist・Toggl・Linear の無料プランを継続使用
- Linear API：個人利用は無料枠で API 使用可能

---

## アーキテクチャ

```
あなた
  │
  ├─── 操作・管理したい ─────────────────────────────────────────┐
  │                                                              │
  │    Claude Pro（claude.ai）                                   │
  │      │  自然言語で指示                                        │
  │      │  Tool Use で MCP Server を呼び出し                     │
  │      ▼                                                       │
  │    MCP Server（GAS Webhook / doPost）                        │
  │      │                                                       │
  │      ├─ toggl.js        → Toggl Track API                   │
  │      ├─ tasks.js        → Todoist API（日常タスク）           │
  │      ├─ linear.js       → Linear API（学習・開発サイクル）    │  ← 新規
  │      ├─ calendar.js     → Google Calendar                   │
  │      ├─ spreadsheet.js  → Google Spreadsheet（進捗）         │
  │      ├─ memo.js         → Google Spreadsheet（メモ）         │
  │      └─ notify.js       → Slack Incoming Webhook（通知）     │
  │                                                              │
  │    GAS WebApp（doGet）                                       │
  │      └─ dashboard.html  ← ブラウザで直接アクセス             │
  │                                                              │
  └─── 学習したい・相談したい ───────────────────────────────────┘
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
| `tasks.js` | Todoist API 連携（日常タスク） | 変更なし |
| `spreadsheet.js` | 学習進捗スプレッドシート操作 | 変更なし |
| `memo.js` | メモ機能 | 変更なし |
| `webapp.js` | WebApp エントリー・データ集約 | Linear データを追加 |
| `dashboard.html` | WebApp ダークテーマ UI | Linear サイクル表示を追加 |
| `config.js` | 定数・APIキー定義 | LINEAR_API_KEY 等を追加 |
| `appsscript.json` | GAS プロジェクト設定 | 変更なし |

### 新規作成

| ファイル | 役割 |
|---|---|
| `mcp.js` | MCP Server エントリーポイント（旧 main.js を置き換え） |
| `linear.js` | Linear API 連携（学習・開発の週次サイクル管理） |
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
X-MCP-Secret: {MCP_SECRET}

{
  "tool": "togglStartTimer",
  "params": { "description": "数学の勉強", "workspaceId": 9048938 }
}
```

### レスポンス形式

```json
{ "ok": true, "result": "タイマーを開始しました。数学の勉強 / Study / 大学" }
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

#### Todoist 系（日常タスク）

| ツール名 | 説明 |
|---|---|
| `tasksCreate` | タスク追加（1件） |
| `tasksCreateMultiple` | タスク追加（複数） |
| `tasksList` | タスク一覧 |
| `tasksComplete` | タスク完了 |
| `tasksUpdate` | タスク編集 |
| `tasksSetDue` | 期限設定 |

#### Linear 系（学習・開発の週次管理）

| ツール名 | 説明 |
|---|---|
| `linearIssueCreate` | Issue 作成（タイトル・説明・優先度・サイクル指定） |
| `linearIssueCreateMultiple` | Issue 複数作成 |
| `linearIssueList` | Issue 一覧（今週のサイクル・ステータス絞り込み可） |
| `linearIssueComplete` | Issue 完了マーク |
| `linearIssueUpdate` | Issue 編集（タイトル・優先度・ステータス変更） |
| `linearCycleGet` | 現在のサイクル情報取得（今週・来週） |
| `linearCycleSummary` | 今週のサイクル進捗サマリー（完了数・残数・達成率） |

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

## タスク管理の使い分け
- Todoist：買い物・病院・締め切りが明確な日常タスク・繰り返しタスク
- Linear：今週やる学習タスク・教材の問題範囲・CFS 開発 Issue

## 行動指針
- 内容からワークスペース・クライアント・カレンダー・タスクツールを自動判定する
- 操作の実行前に確認は不要。指示通りに即実行する
- 結果は簡潔に日本語で返す
- 曖昧な指示は最も自然な解釈で実行し、実行後に判断理由を添える
```

---

## Todoist 仕様（既存から継続・日常タスク専用）

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

買い物リストに牛乳・卵・パンを追加して
→ tasksCreateMultiple

今日締め切りのタスクを見せて
→ tasksList（due: today）
```

---

## Linear 仕様（新規・学習・開発の週次管理）

### API 概要

- **エンドポイント：** `https://api.linear.app/graphql`
- **認証：** Bearer Token（Personal API Key）
- **形式：** GraphQL
- **無料枠：** 個人利用は API 含め実質無料

### Linear の概念

| 概念 | 説明 | 対応する使い方 |
|---|---|---|
| Issue | タスクの単位 | 「数学III 例題1〜10を解く」等 |
| Cycle | 1週間のスプリント | 今週やることをまとめたバケツ |
| Status | Todo / In Progress / Done | 未着手・進行中・完了 |
| Priority | No / Low / Medium / High / Urgent | 重要度の設定 |

### 優先度

| 表記 | Linear値 | 表示 |
|---|---|---|
| urgent | 1 | 🔴 緊急 |
| high | 2 | 🟠 高 |
| medium | 3 | 🔵 中 |
| low | 4 | ⚪ 低 |
| no | 0 | − なし |

### ステータス遷移

```
Todo（未着手）→ In Progress（進行中）→ Done（完了）
                                    ↓
                              次サイクルへ自動持ち越し（未完了分）
```

### linear.js 実装仕様

GraphQL クエリを GAS の `UrlFetchApp.fetch` で呼び出す。

```javascript
function linearRequest_(query, variables) {
  const res = UrlFetchApp.fetch("https://api.linear.app/graphql", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": LINEAR_API_KEY
    },
    payload: JSON.stringify({ query, variables })
  });
  return JSON.parse(res.getContentText());
}
```

### 主要 GraphQL クエリ

**Issue 作成**
```graphql
mutation IssueCreate($title: String!, $description: String, $priority: Int, $cycleId: String) {
  issueCreate(input: {
    title: $title
    description: $description
    priority: $priority
    teamId: "{TEAM_ID}"
    cycleId: $cycleId
  }) {
    success
    issue { id title url }
  }
}
```

**今週のサイクル Issue 一覧**
```graphql
query CycleIssues($cycleId: String!) {
  cycle(id: $cycleId) {
    id name startsAt endsAt
    issues {
      nodes {
        id title priority
        state { name }
        completedAt
      }
    }
  }
}
```

**現在のサイクル取得**
```graphql
query ActiveCycle($teamId: String!) {
  team(id: $teamId) {
    activeCycle {
      id name startsAt endsAt
      completedIssueCountHistory
      issueCountHistory
    }
  }
}
```

### 使用例

```
今週の数学の学習タスクを作って
→ linearIssueCreate（title: "数学III 例題1〜10", cycle: 今週）

数学III の例題1〜5が終わった
→ linearIssueComplete（title部分一致で検索 → Done に更新）

今週の学習進捗を見せて
→ linearCycleSummary（完了数・残数・達成率を返す）

来週のサイクルに英語の予習を追加して
→ linearIssueCreate（cycle: 来週のサイクルID）

今週残ってるタスクは？
→ linearIssueList（status: Todo/InProgress, cycle: 今週）
```

### config.js に追加する定数

```javascript
const LINEAR_API_KEY = "lin_api_xxxxxxxx"; // Linear Personal API Key
const LINEAR_TEAM_ID = "xxxxxxxx";          // チーム ID（個人ワークスペースのチーム）
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

### Linear との連携イメージ

```
進捗表（Spreadsheet）：例題・問題単位の細かい完了状態を管理
Linear（サイクル）  ：「今週は例題1〜10を終わらせる」という週次コミットを管理
→ 両者は独立。Linear の Issue 完了 = 進捗表を更新する、という運用で連動させる
```

### 進捗表スプレッドシート列構成

| 章 | 問題番号 | 種別 | 状態 | 完了日 | メモ |
|---|---|---|---|---|---|
| 第1章 数列 | 例題1 | 例題 | ✅ 完了 | 2026/03/18 | |

**状態の種類：** `⬜ 未着手` / `🔄 進行中` / `✅ 完了`

**管理方法：** 科目名 → スプレッドシート URL のマッピングを Script Properties（`PROGRESS_SHEETS`）に保存

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

### 通知の種類

| 通知 | トリガー | 内容 |
|---|---|---|
| 朝のサマリー | Time Trigger（毎朝指定時刻） | Toggl・Calendar・Todoist・Linear サイクル・進捗のサマリー |
| タイマー完了 | togglStopTimer 実行後 | 停止した記録の内容・時間 |
| エラー通知 | GAS の例外キャッチ時 | エラー内容・発生箇所 |

### 朝のサマリー形式

```
📊 デイリーサマリー  2026/03/30 (Mon)  Week 14/52
━━━━━━━━━━━━━━━━━━
⏱ TIME TRACKER（昨日）
  Study:    3時間15分
  Life Log:  45分
  合計:  4時間00分

📅 TODAY
  10:00  数学の講義
  14:00  歯医者

✅ TODOIST（期限近い順）
  🔴  レポート提出  3/31
  🔵  英単語100個

📋 LINEAR 今週のサイクル  5/12 完了（41%）
  🔄  数学III 例題6〜10
  ⬜  物理 第3章 演習問題
  ✅  英語 長文読解 2本

📖 STUDY PROGRESS
  数学III  ████████░░  82%

🔗 [ダッシュボードを開く]
```

---

## ダッシュボード仕様（Linear カード追加）

**アクセス：** GAS WebApp デプロイ URL をブラウザで開く  
**アクセス権限：** 自分のみ（Google アカウント認証）

### 画面構成（2カラムグリッド）

| 左カラム | 右カラム |
|---|---|
| ⏱ TIME TRACKER（ライブタイマー付き） | 📅 CALENDAR（今日・直近予定） |
| ✅ TODOIST（優先度別・期限表示） | 📋 LINEAR（今週のサイクル進捗） |
| 📖 STUDY PROGRESS（プログレスバー） | |

### Linear カードの表示内容

```
📋 LINEAR  今週のサイクル（3/25〜3/31）
  進捗  ████████░░░░  5 / 12 完了

  🔄 In Progress
    数学III 例題6〜10

  ⬜ Todo
    物理 第3章 演習問題
    英語 長文読解 2本

  ✅ Done（5件）
    ...
```

---

## Gemini API 仕様（バックエンド処理エンジン）

Claude の窓口化後も、GAS バックエンド内で以下の用途に Gemini API を継続使用する。

| 用途 | 関数 | 理由 |
|---|---|---|
| 進捗表作成時の構造抽出 | `createProgressSheet` 内 | Docs テキストから章・問題番号を解析 |
| 朝のサマリー文章生成 | `buildDashboardMessage_` 内 | 自然な文章で整形 |

### モデルフォールバック（既存から継続）

```javascript
const GEMINI_MODELS = [
  "gemini-2.5-flash",     // 第1候補・最高性能
  "gemini-2.0-flash",     // 第2候補・バランス型
  "gemini-2.0-flash-lite" // 第3候補・最終手段
];
// ※ gemini-1.5-flash は廃止済みのため使用不可
```

---

## 設定値一覧（config.js）

| 定数名 | 内容 | 変更 |
|---|---|---|
| `TOGGL_API_KEY` | Toggl Track API キー | 既存 |
| `GEMINI_API_KEY` | Google Gemini API キー | 既存 |
| `SLACK_INCOMING_WEBHOOK_URL` | Slack 通知用 Incoming Webhook URL | 新規（Bot Token から変更） |
| `SPREADSHEET_ID` | メインスプレッドシート ID（ログ・メモ共用） | 既存 |
| `TODOIST_API_TOKEN` | Todoist API トークン | 既存 |
| `LINEAR_API_KEY` | Linear Personal API Key | **新規** |
| `LINEAR_TEAM_ID` | Linear チーム ID | **新規** |
| `WEBAPP_URL` | WebApp デプロイ URL | 既存 |
| `NOTEBOOKLM_DOCS_FOLDER_ID` | NotebookLM エクスポート先 Drive フォルダ ID | 既存 |
| `TOGGL_WORKSPACES` | ワークスペース名・ID マッピング | 既存 |
| `MORNING_SUMMARY_HOUR` | 朝のサマリー送信時刻（例: 7） | 新規 |
| `GEMINI_MODELS` | Gemini モデル優先順リスト | 既存 |
| `CALENDAR_HINTS` | カレンダー名→用途説明 | 既存 |
| `MCP_SECRET` | MCP リクエスト認証用シークレットキー | 新規 |

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

変更なし。Linear API は `script.external_request` スコープで対応可能。

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

### Phase 2：Linear の追加

```
1. Linear でワークスペース・チームを作成
   - チーム ID を取得して config.js に設定
   - Personal API Key を発行して config.js に設定
   - 最初のサイクル（1週間）を作成

2. linear.js を新規作成
   - linearRequest_() 共通関数
   - 各ツール関数の実装

3. mcp.js に Linear ツールのルーティングを追加

4. clasp push → 再デプロイ
```

### Phase 3：Slack 通知への移行

```
1. notify.js を新規作成（Linear サマリーを朝のサマリーに追加）
2. config.js に SLACK_INCOMING_WEBHOOK_URL を追加
3. trigger.js を新規作成・installTrigger() を手動実行
4. 既存 Slack App の Bot Token 依存箇所を Incoming Webhook に切り替え
```

### Phase 4：旧 Slack 入力系の廃止（Phase 1〜3 完了後）

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
- Claude とは完全に独立して使う

---

## デプロイ手順

### 初回セットアップ

```bash
clasp login
# .clasp.json にスクリプト ID を記載済みであることを確認
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
installTrigger();
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
| 週次レビュー自動生成 | Linear サイクル終了時に完了・未完了を Slack に通知 | 高 |
| 夜の振り返りサマリー | 就寝前に当日の記録をまとめて Slack に通知 | 中 |
| 中長期学習計画 | 月次の目標設定と Linear サイクルとの紐づけ | 中 |
| ダッシュボード追加機能 | 随時要望に応じて追加 | 低 |
| Toggl 週次レポートの自動送信 | 週末に週次サマリーを Slack に自動通知 | 低 |
