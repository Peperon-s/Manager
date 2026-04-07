# GFS（Gemini For Slack）仕様書

## 概要

GFS は Google Apps Script (GAS) で実装した個人用 Slack ボット。
Gemini AI の Function Calling を活用し、自然言語メッセージからAPIを呼び出して各種サービスを操作する。

| 項目 | 内容 |
|---|---|
| 実行環境 | Google Apps Script (V8 ランタイム) |
| デプロイ形態 | WebApp（doPost: Slack Webhook / doGet: ダッシュボード） |
| AI | Google Gemini API（Function Calling） |
| バージョン管理 | clasp によるローカル↔GAS同期 |

---

## アーキテクチャ

```
Slack
  │  メンション (@GFS ...)
  ▼
doPost (main.js)
  │
  ├─ コマンド即時処理（Gemini不使用）
  │    ├─ help / ヘルプ         → 例文ガイドを返す
  │    ├─ ダッシュボード / db   → Slackサマリーを返す
  │    └─ メモ: / メモ一覧 ...  → メモ操作を実行
  │
  └─ チャンネル種別でルーティング
       ├─ togglチャンネル   → callGemini()        → Toggl / Calendar
       ├─ scheduleチャンネル → callGeminiSchedule() → Calendar / Todoist
       └─ studyチャンネル   → callGeminiStudy()    → 進捗管理 / Spreadsheet

ブラウザ
  │  URL アクセス
  ▼
doGet (webapp.js)
  └─ dashboard.html を返す（ダークUI WebApp）
```

---

## ファイル構成

| ファイル | 役割 |
|---|---|
| `config.js` | APIキー・チャンネルマッピング・定数定義 |
| `main.js` | エントリーポイント・Gemini呼び出し・全ハンドラ |
| `toggl.js` | Toggl Track API 連携 |
| `tasks.js` | Todoist API 連携 |
| `spreadsheet.js` | 学習進捗スプレッドシート操作 |
| `memo.js` | メモ機能 |
| `webapp.js` | WebApp エントリー・データ集約・Slackサマリー生成 |
| `dashboard.html` | WebApp ダークテーマ UI |
| `utils.js` | 手動実行用ユーティリティ（joinAllPublicChannels 等） |
| `appsscript.json` | GAS プロジェクト設定・OAuth スコープ |

---

## Slack チャンネル構成

### セクション：時間記録

| チャンネル | Toggl ワークスペース | クライアント | 備考 |
|---|---|---|---|
| `#general_toggl` | Gemini が自動判定 | Gemini が自動判定 | 何でも受け付けるメイン |
| `#study_toggl` | Study 固定 | Gemini が自動判定 | 学習・開発全般 |
| `#lifelog_toggl` | Life Log 固定 | なし | 日常生活 |
| `#retake_toggl` | Study 固定 | 高校学習 固定 | 再受験専用 |
| `#help_toggl` | Gemini が自動判定 | Gemini が自動判定 | 分類理由も説明 |

### セクション：タスク＆スケジュール

| チャンネル | 役割 |
|---|---|
| `#general_schedule` | Google Calendar + Todoist タスク管理 |

### セクション：学習進捗管理

| チャンネル | 役割 |
|---|---|
| `#study` | 大学・自習の進捗管理（NotebookLM→Docs→スプレッドシート） |
| `#retake` | 高校学習・再受験の進捗管理 |
| `#help_management_study` | 使い方ガイド（何を送っても説明を返す） |

---

## 共通コマンド（全チャンネルで使用可能）

### ヘルプ
```
help / ヘルプ / 使い方 / ? / ？
```
チャンネル固有の例文一覧と共通コマンドを返す。

### ダッシュボード
```
ダッシュボード / dashboard / dash / db
```
Toggl・カレンダー・タスク・進捗をまとめたサマリーを返す。

### メモ

| 操作 | 書式 | 例 |
|---|---|---|
| 保存（タグなし） | `メモ: 内容` | `メモ: 積分の公式を確認する` |
| 保存（タグあり） | `メモ #タグ 内容` | `メモ #数学 #積分 置換積分の注意点` |
| 一覧 | `メモ一覧` | |
| タグ絞り込み | `メモ一覧 #タグ` | `メモ一覧 #数学` |
| 検索 | `メモ検索: キーワード` | `メモ検索: 積分` |
| 削除 | `メモ削除: ID` | `メモ削除: 5` |

保存先：`SPREADSHEET_ID` と同じスプレッドシートの「メモ」シート
列構成：`ID` / `日時` / `チャンネル` / `タグ` / `内容`

---

## 機能仕様

### 1. Toggl Track 連携

**対象チャンネル：** togglチャンネル系

| 機能 | Gemini 関数名 | 動作 |
|---|---|---|
| タイマー開始 | `togglStartTimer` | 現在時刻から計測開始 |
| タイマー停止 | `togglStopTimer` | 実行中タイマーを停止 |
| 手動記録追加 | `togglCreateEntry` | 開始・終了時間を指定して記録 |
| 記録編集 | `togglEditEntry` | 直近3日以内の記録を説明文で検索して変更 |
| 記録削除 | `togglDeleteEntry` | 直近3日以内の記録を削除 |
| 今日の記録 | `togglGetTodayEntries` | 当日全記録を整形して返す |
| 週次サマリー | `togglGetWeeklySummary` | 直近7日をワークスペース別・日別に集計 |

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

**チャンネル別ルーティングロジック**

- `#retake_toggl`：ワークスペース=Study・クライアント=高校学習 に固定
- `#study_toggl`：ワークスペース=Study 固定・クライアントは Gemini が推定
- `#lifelog_toggl`：ワークスペース=Life Log 固定
- `#general_toggl`：全て Gemini が推定
- `#help_toggl`：全て Gemini が推定 + 判断理由をレスポンスに含める

**使用例**
```
数学の勉強始める
→ Study / 大学 or 趣味の勉強 / プロジェクト / タグ を自動選択してタイマー開始

さっきのランニングの記録を終わりにして
→ togglStopTimer

今日の9時から10時半に英語の勉強をしてたので記録して
→ togglCreateEntry（startTime: 09:00, stopTime: 10:30）

今週のサマリーを見せて
→ togglGetWeeklySummary
```

---

### 2. Google Calendar 連携

**対象チャンネル：** `#general_schedule`（Gemini 経由）、toggl チャンネル（Gemini 経由）

| 機能 | Gemini 関数名 | 動作 |
|---|---|---|
| イベント追加 | `createCalendarEvent` | 指定カレンダーにイベント作成 |
| イベント編集 | `updateCalendarEvent` | タイトル部分一致で検索して変更 |
| イベント削除 | `deleteCalendarEvent` | タイトル・日付で検索して削除 |
| 今日の予定 | `getTodayEvents` | 当日全カレンダーの予定を返す |
| 直近予定 | `getUpcomingEvents` | 指定日数分の予定を返す（デフォルト7日） |

**カレンダー設定（`CALENDAR_HINTS`）**

| カレンダー名 | 用途 |
|---|---|
| Life Log | 日常生活・食事・運動・休憩・外出 |
| Study | 大学・趣味の勉強・開発（高校学習を除く） |
| 高校学習 | 再受験・高校範囲の学習 |

**チャンネル別デフォルトカレンダー（`CHANNEL_CALENDAR_DEFAULTS`）**

| チャンネル | デフォルト |
|---|---|
| `#retake_toggl` | 高校学習 |
| `#lifelog_toggl` | Life Log |
| `#study_toggl` | Study |
| その他 | Gemini が内容から判断 |

**使用例**
```
明日14時から1時間、歯医者の予約を入れて
→ createCalendarEvent（適切なカレンダーに自動振り分け）

「歯医者」の予定を15時に変えて
→ updateCalendarEvent

来週の予定を教えて
→ getUpcomingEvents（days: 7）
```

---

### 3. Todoist 連携

**対象チャンネル：** `#general_schedule`（メイン）、他チャンネルでも利用可

**API：** `https://api.todoist.com/api/v1/`（REST API v2 は廃止済み）

| 機能 | Gemini 関数名 | 動作 |
|---|---|---|
| タスク追加（1件） | `tasksCreate` | プロジェクト・優先度・期限・メモを指定可 |
| タスク追加（複数） | `tasksCreateMultiple` | 2件以上は自動でこちらを使用 |
| タスク一覧 | `tasksList` | プロジェクト絞り込み可。優先度・期限付きで表示 |
| タスク完了 | `tasksComplete` | タイトル部分一致で検索して完了 |
| タスク編集 | `tasksUpdate` | タイトル・メモ・期限・優先度・プロジェクトを変更 |
| 期限設定 | `tasksSetDue` | タスク名で検索して期限のみ変更 |

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

「レポート提出」の優先度をp2にして
→ tasksUpdate

タスク一覧を見せて
→ tasksList
```

---

### 4. 学習進捗管理

**対象チャンネル：** `#study`、`#retake`

**フロー**

```
1. ユーザーが NotebookLM でPDFを解析
2. 「章と問題番号の一覧を出して」と NotebookLM に質問
3. 出力を Google Docs にエクスポートして指定フォルダに保存
4. #study または #retake に Docs の URL を貼り付け
5. GFS が Docs を読み込み → Gemini が構造を抽出
6. スプレッドシートに進捗表を自動生成
```

| 機能 | Gemini 関数名 | 動作 |
|---|---|---|
| 進捗表作成 | `createProgressSheet` | Docs の内容から章・問題番号を抽出してシート生成 |
| 進捗更新 | `updateProgressSheet` | 問題IDと状態（完了・進行中・未着手）を更新 |
| 進捗確認 | `getProgressSummary` | プログレスバー付きで達成率を表示 |

**スプレッドシート列構成**

| 章 | 問題番号 | 種別 | 状態 | 完了日 | メモ |
|---|---|---|---|---|---|
| 第1章 数列 | 例題1 | 例題 | ✅ 完了 | 2026/03/18 | |

**状態の種類：** `⬜ 未着手` / `🔄 進行中` / `✅ 完了`

**進捗表の管理方法**
科目名 → スプレッドシートURL のマッピングを Script Properties（`PROGRESS_SHEETS`）に保存。
「数学IIIの進捗を見せて」のように科目名で参照可能。

**使用例**
```
この教材の進捗表を作って [Google Docs URL]
→ createProgressSheet

数学IIIの例題1〜5完了
→ updateProgressSheet（subject: "数学III", problems: ["例題1",...], status: "✅ 完了"）

全科目の進捗を確認
→ getProgressSummary
```

---

### 5. ダッシュボード

#### Slack サマリー

**トリガーワード：** `ダッシュボード` / `dashboard` / `dash` / `db`

**表示内容**
```
📊 GFS ダッシュボード  2026/03/18 (Wed)  14:30
━━━━━━━━━━━━━━━━━━
⏱ TIME TRACKER
  🟢 数学の勉強（実行中）  1:23:45
  Study:    2時間30分
  Life Log:  45分
  合計:  3時間15分

📅 CALENDAR
  今日  14:00  歯医者
  03/19(Thu)  10:00  数学の講義

✅ TASKS（3件）
  🔴  レポート提出  3/20
  🔵  英単語100個

📖 STUDY PROGRESS
  数学III  ████████░░  82%
  42 / 51問完了

━━━━━━━━━━━━━━━━━━
🔗 [ダッシュボードを開く]
```

#### WebApp（ダークテーマ UI）

**アクセス：** GAS デプロイ URL をブラウザで開く
**アクセス権限：** 自分のみ（Google アカウント認証）

**画面構成（2カラムグリッド）**

| 左カラム | 右カラム |
|---|---|
| ⏱ TIME TRACKER（ライブタイマー付き） | 📅 CALENDAR（今日・直近予定） |
| ✅ TASKS（優先度別・期限表示） | 📖 STUDY PROGRESS（プログレスバー） |

**主な UI 仕様**
- ダーク背景（`#0d1117`）・カード型レイアウト
- 実行中タイマーはブラウザ側で毎秒カウントアップ
- プログレスバーはページ読み込み時にアニメーション
- 「↻ 更新」ボタンでページリロードなしにデータ再取得
- レスポンシブ対応（768px以下で1カラム）

---

## Gemini 連携仕様

### モデルフォールバック

無料枠の上限に達した場合、自動で次のモデルに切り替え：

```
1. gemini-2.5-flash  （第1候補・最高性能）
2. gemini-2.0-flash  （第2候補・バランス型）
3. gemini-2.0-flash-lite（第3候補・最終手段）
```

※ `gemini-1.5-flash` は廃止済みのため使用不可。

### Gemini 呼び出し関数

| 関数名 | 対象チャンネル | 利用できる関数 |
|---|---|---|
| `callGemini` | togglチャンネル系 | Toggl全機能 + Calendar追加 |
| `callGeminiSchedule` | `#general_schedule` | Calendar全機能 + Todoist全機能 |
| `callGeminiStudy` | `#study` / `#retake` | 進捗管理全機能 |

---

## 二重処理防止

Slack は3秒以内に応答がない場合リトライを送信する。
GAS の処理が遅延した場合の2重実行を防ぐため、以下を実装：

```
1. LockService.getScriptLock() でロック取得（最大5秒待機）
2. CacheService に event_id を保存（5分間）
3. 処理済みイベントは即座に "ok" を返して無視

event_id の取得順：
  json.event_id → json.event.client_msg_id → json.event.ts → ペイロード先頭80文字
```

---

## 設定値一覧（config.js）

| 定数名 | 内容 |
|---|---|
| `TOGGL_API_KEY` | Toggl Track API キー |
| `GEMINI_API_KEY` | Google Gemini API キー |
| `SLACK_BOT_TOKEN` | Slack Bot Token（`xoxb-...`） |
| `SPREADSHEET_ID` | GFS 用メインスプレッドシート ID（ログ・メモ共用） |
| `TODOIST_API_TOKEN` | Todoist API トークン |
| `MEMO_SPREADSHEET_ID` | メモ保存先（= SPREADSHEET_ID） |
| `WEBAPP_URL` | WebApp デプロイ URL（設定後 Slack サマリーにリンク表示） |
| `NOTEBOOKLM_DOCS_FOLDER_ID` | NotebookLM エクスポート先 Drive フォルダ ID |
| `TOGGL_WORKSPACES` | ワークスペース名・ID マッピング |
| `CHANNEL_CONTEXT_MAP` | チャンネル→Togglコンテキスト マッピング |
| `SCHEDULE_CHANNELS` | スケジュール系チャンネル一覧 |
| `STUDY_CHANNELS` | 学習進捗管理チャンネル一覧 |
| `GEMINI_MODELS` | Gemini モデル優先順リスト |
| `CALENDAR_HINTS` | カレンダー名→用途説明（Gemini ヒント） |
| `CHANNEL_CALENDAR_DEFAULTS` | チャンネル別デフォルトカレンダー |

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

---

## デプロイ手順

### 初回セットアップ

```bash
# 1. clasp でログイン
clasp login

# 2. .clasp.json にスクリプトID を記載済みであることを確認
# 3. ファイルをプッシュ
clasp push
```

### Slack Webhook デプロイ（既存）

GAS エディタ → デプロイを管理 → 編集 → 新しいバージョンで更新

### WebApp デプロイ

GAS エディタ → 新しいデプロイ → ウェブアプリ
- 実行ユーザー：自分
- アクセス：自分のみ
- デプロイ後 URL を `config.js` の `WEBAPP_URL` に設定

### コード変更時

```bash
clasp push
# → GASエディタで既存デプロイを「新しいバージョン」で再デプロイ
```

---

## 未着手・検討中

| 機能 | 概要 |
|---|---|
| ダッシュボード追加機能 | 随時ユーザーから要望に応じて追加 |
| 中長期学習計画 | 週次・月次の目標設定と進捗の可視化 |
| 朝の自動サマリー送信 | 指定時刻に指定チャンネルへ自動投稿 |
