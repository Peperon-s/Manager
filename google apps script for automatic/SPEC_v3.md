# CFS Web Application (PWA Edition) 仕様書

## 1. 概要
本プロジェクト（旧称: GFS / CFS MCP）は、ユーザーの「スケジュール管理」「タスク管理」「時間記録（Toggl）」「学習進捗管理」を一元化し、LLM（Gemini API）を通じた対話的なエージェント機能を提供する自立型のWebアプリケーション（システム）です。

Slack連携やMCP（Claudeデスクトップ専用プロトコル）の制約（3秒ルールによる二重登録、メンションの手間、モバイル利用のループバグ等）を解消するため、**機能すべてを単一のPWA（Progressive Web App）として統合**しました。

---

## 2. アーキテクチャ

### 2.1 構成
*   **プラットフォーム**: Google Apps Script (GAS)
*   **デプロイ形式**: ウェブアプリ
    *   実行者: 開発者自身（Execute as: me）
    *   アクセス権: **全員**（Any access）
*   **フロントエンド**: HTML/CSS/JavaScript (Vanilla)
*   **AI エンジン**: Gemini API (`gemini-2.5-flash` など複数モデルフォールバック構成)

### 2.2 ロギング・通信仕様
*   **通信方式**: クライアントから `google.script.run` を使用した非同期通信
*   **認証方式**: スクリプト側にハードコードされた独自の「4桁暗証番号（PIN）」による簡易認証

---

## 3. ファイル構造と各モジュールの役割

| ファイル名 | 種別 | 役割・機能概要 |
| :--- | :--- | :--- |
| `dashboard.html` | UI | アプリ表示のすべてを担うVIEW層。ログイン画面、ダッシュボード、チャットUIを一つのページに構成し、VanillaJSによる状態管理・更新（`loadDashboard`, `sendChatMessage`等）を行う。 |
| `webapp.js` | Controller | クライアントとの通信エンドポイント。`doGet()` (HTMLの生成)、`getDashboardData()` (各モジュールからのデータ集約)、`processChatMessage()` (チャットエントリ) を定義。 |
| `main.js` | AI Router | 受信したメッセージと会話の文脈を元に、Geminiのプロンプトを動的に構築してAPIを叩く心臓部。全機能のツール宣言の保持と、関数実行（Function Calling ルーティング）を担当する。 |
| `config.js` | Config | APIキー (Toggl, Todoist, Geminiなど)、環境変数（PIN、スプレッドシートID）、およびシステムプロンプト用のヒント情報（TogglのワークスペースID等）の定数管理。 |
| `toggl.js` | API | Toggl Track APIとの通信を担当。タイマーの開始・停止、過去のログの編集や取得など。 |
| `tasks.js` | API | Todoist APIとの通信を担当。タスクの作成、完了、期限の変更など。 |
| `spreadsheet.js` | API | SpreadsheetおよびGoogle Docsを利用した「学習進捗管理」の読み書きを担当。 |
| `bridge.js` | Wrapper | TodoistやTogglなどの複数モジュール間にまたがる処理等（旧アーキテクチャの名残を含む）。 |

---

## 4. UI と ユーザーフロー

### 4.1 起動（ログイン）フロー
1. ブラウザでWebアプリのURLへアクセスする。
2. `.login-screen` 要素が表示され、PINコードの入力を要求される。
3. `verifyWebAppPin()` でGAS側と照合を行い、正解ならばUIの非表示ロックを解除し、`loadDashboard()` によるメインダッシュボードの描画処理が走る。

### 4.2 ダッシュボード
*   **今日の経過**：当日のToggl総記録時間（グラフ付き）
*   **稼働中タイマー**：アクティブなTogglタイマーとその経過時間をライブ表示
*   **カレンダー**：Googleカレンダーからの「今日の予定」一覧
*   **タスク**：Todoistからの「期限切れ」「今日」「近日」のタスク一覧
*   **進捗サマリー**：作成済みの進捗表シートの進行度合い（%)を表示

### 4.3 チャットアシスタントフロー
1. ユーザーが `#chat-input` に依頼（例：「数学の課題開始」）を入力する。
2. JS内に保存されている「会話履歴（`chatHistoryContext`）」と一緒に `processChatMessage()` へPOSTされる。
3. `main.js` は会話履歴＋全コンテキスト情報＋**全21のツール設定**をバンドルしてGeminiへ送信。
4. Geminiがツール呼び出し（Function Call）を返却すると、`executeFunctionCall_()` によって対象の関数（例：`togglStartTimer`）がGAS上で実行される。
5. 成功結果（またはエラー）のテキストがクライアントに返送される。
6. 返送された情報に設定変更（更新作業）が含まれていた場合（`shouldRefresh: true`）、画面上で裏側で `loadDashboard()` をサイレントに再実行し、Toggl表示やタスク表示を自動で更新する。

---

## 5. 登録されているAIツール（Function Declarations）

システムには単一のルーティング上に全21機能（ツール）が搭載されており、Geminiがすべてのツールの中から適切なアクションを思考して選択します。

### 時間管理（Toggl）
*   `togglStartTimer` / `togglStopTimer` / `togglCreateEntry`
*   `togglEditEntry` / `togglDeleteEntry`
*   `togglGetWeeklySummary` / `togglGetTodayEntries`

### 予定管理（Google Calendar）
*   `createCalendarEvent` / `getUpcomingEvents`
*   `updateCalendarEvent` / `deleteCalendarEvent`

### タスク管理（Todoist）
*   `tasksCreate` / `tasksCreateMultiple`
*   `tasksList` / `tasksComplete`
*   `tasksSetDue` / `tasksUpdate`

### 学習進捗管理（Spreadsheet）
*   `createProgressSheet` / `updateProgressSheet`
*   `getProgressSummary` / `listProgressSheets`

---

## 6. 旧バージョン (v1/v2) からの変更点（デプロイメント履歴）
*   **Slackの廃止**:
    *   3秒ルールによりTogglタイマーが2重起動するバグを解消。
    *   用途別チャンネル制覇の廃止。汎用プロンプトへと統合。
*   **Claudeデスクトップ MCP(v2)の廃止**:
    *   スマートフォン（モバイル）端末で利用できないという致命的問題を回避。
*   **単一アプリケーション化**:
    *   情報の「表示（ダッシュボード）」と「追加・操作（チャット）」が別のアプリ（WebとSlack）に分かれていた問題を統合した。
    *   フロントエンドでの状態（履歴）保持により、コンテキスト引継ぎ型の滑らかな対話が可能となった。

---

## 7. 今後の展望・保守
*   **APIコスト**: 現状はGeminiの無料枠に依存。1つのプロンプトに大量のツール宣言を含めるアーキテクチャのため、利用率が高く（リクエストが巨大に）なる。無料枠で枯渇した場合は、`config.js` に `CLAUDE_API_KEY` 等を定義し、Anthropic APIをコールバックするように `main.js` の `geminiGenerate_()` 部分を差し替えることができる。
*   **Linear連携の手動復元**: v2.1で計画されていたLinear連携は統合過程で一旦保留（Todoist主体）となっているため、長期タスク管理が必要な場合、`executeFunctionCall_` に新たにLinearスクリプト群を追加することで容易に拡張可能。
