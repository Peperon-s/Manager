// ==========================================
// 全APIキー・設定（ここを書き換えてください）
// ==========================================
// ==========================================
// Geminiモデル（無料枠・優先順に並べる）
// 上限に達したら自動で次のモデルにフォールバック
// ==========================================
const GEMINI_MODELS = [
  "gemini-2.5-flash",      // 第1候補：最高性能
  "gemini-2.0-flash",      // 第2候補：バランス型
  "gemini-2.0-flash-lite"  // 第3候補：最終手段
];

var TODOIST_API_TOKEN = "7eb9337d3f4475429e3ca1d7743a992e47759dde";
var TOGGL_API_KEY     = "727997c895e7843411517415ac11a4c8";
var GEMINI_API_KEY    = 'AIzaSyAB5DND0IjvX3qHFVN-L3nQMCWLf1cHmns';
var CLAUDE_API_KEY    = "";
var SPREADSHEET_ID    = '1Ar-vhALZucaEXsykc_UoWbtGxnr9Ym0EGN3aq3jCsZo';

// Google Sign-In 用 OAuth クライアントID
// Google Cloud Console → APIとサービス → 認証情報 → OAuth 2.0 クライアントID で取得
// 種類: ウェブアプリケーション / 承認済みJavaScriptオリジンにGASのURLを追加
var GOOGLE_CLIENT_ID = "652907894663-p0rihhdeam15qiubcaup32e2iej527be.apps.googleusercontent.com"; // ← 設定してください

// PropertiesService に保存された値があれば上書き（設定UIから変更した場合に反映）
(function() {
  var p = PropertiesService.getScriptProperties();
  if (p.getProperty("TOGGL_API_KEY"))    TOGGL_API_KEY    = p.getProperty("TOGGL_API_KEY");
  if (p.getProperty("TODOIST_API_TOKEN")) TODOIST_API_TOKEN = p.getProperty("TODOIST_API_TOKEN");
  if (p.getProperty("GEMINI_API_KEY"))   GEMINI_API_KEY   = p.getProperty("GEMINI_API_KEY");
  if (p.getProperty("LINEAR_API_KEY"))   LINEAR_API_KEY   = p.getProperty("LINEAR_API_KEY");
  if (p.getProperty("LINEAR_TEAM_ID"))   LINEAR_TEAM_ID   = p.getProperty("LINEAR_TEAM_ID");
  if (p.getProperty("SPREADSHEET_ID"))   SPREADSHEET_ID   = p.getProperty("SPREADSHEET_ID");
})();
// Togglワークスペース設定
// ※ togglSetupWorkspaces() を実行してIDを確認し、下記に入力してください
// ==========================================
const TOGGL_WORKSPACES = {
  lifelog: { id:21030286 , name: "Life Log" },  // ← Life Log ワークスペースIDを設定
  study:   { id: 9048938, name: "Study" }      // ← Study ワークスペースIDを設定
};

// ==========================================
// Slackチャンネル名 → Togglコンテキスト設定
// key = チャンネル名（# なし）
// ==========================================
const CHANNEL_CONTEXT_MAP = {
  "retake_toggl": {
    workspaceKey: "study",
    client: "高校学習",
    locked: true,        // workspace/client を固定（Geminiも変更不可）
    needsGuidance: false
  },
  "study_toggl": {
    workspaceKey: "study",
    client: null,        // Geminiがメッセージ内容から推定
    locked: false,
    needsGuidance: false
  },
  "lifelog_toggl": {
    workspaceKey: "lifelog",
    client: null,
    locked: false,
    needsGuidance: false
  },
  "general_toggl": {
    workspaceKey: null,  // Geminiがワークスペースから推定
    client: null,
    locked: false,
    needsGuidance: false
  },
  "help_toggl": {
    workspaceKey: null,  // Geminiが内容から推定し、理由も説明する
    client: null,
    locked: false,
    needsGuidance: true  // カテゴリ判断の理由をGeminiが説明する
  }
};

// ==========================================
// スケジュール系チャンネル設定（タスク＆スケジュール セクション）
// ==========================================
const SCHEDULE_CHANNELS = ["general_schedule"];

// ==========================================
// 学習進捗チャンネル設定（学習進捗管理 セクション）
// NotebookLM → Google Docs → スプレッドシート 連携
// ==========================================
const STUDY_CHANNELS = ["study", "retake", "help_management_study"];

// NotebookLMからエクスポートしたGoogle Docsの保存フォルダID
// Google Drive でフォルダを右クリック → 「リンクを取得」→ URLの folders/ 以降がID
const NOTEBOOKLM_DOCS_FOLDER_ID = "";  // ← 設定してください

// ==========================================
// メモ機能
// 専用スプレッドシートのIDを設定してください
// 新しいスプレッドシートを作成し、そのURLの /d/〇〇〇/ 部分を貼り付け
// ==========================================
const MEMO_SPREADSHEET_ID = SPREADSHEET_ID;  // 既存のGFS用スプレッドシートを使用

// ==========================================
// ダッシュボード WebApp URL
// GASエディタ → デプロイ → 新しいデプロイ → ウェブアプリ
// → URLをコピーしてここに貼り付け
// ==========================================
const WEBAPP_URL = "https://script.google.com/macros/s/AKfycbyATJlXvvSO78D8B6vKiKyLLmL3U0X_vmdleZczT3St9u1MBEPcYaNiTac5FpBTyUFn/exec";  // ← デプロイ後に設定してください

// ==========================================
// ヘルプコマンドのキーワード
// ==========================================
const HELP_KEYWORDS = ["help", "ヘルプ", "使い方", "?", "？", "例文", "わからない", "どうやって"];

// ==========================================
// チャンネル別 例文・説明
// ==========================================
const CHANNEL_EXAMPLES = {
  "general_schedule": {
    desc: "カレンダー登録・編集とタスク管理（タスク＆スケジュール セクション）",
    examples: [
      "明日14時から1時間、歯医者の予約を入れて",
      "来週月曜の数学の授業をカレンダーに追加",
      "今日の予定を教えて",
      "「レポート提出」というタスクを追加",
      "レポート提出の期限を3月31日に設定",
      "タスク一覧を見せて",
      "「レポート提出」を完了にして"
    ]
  },
  "general_toggl": {
    desc: "何でも対応するメインチャンネル",
    examples: [
      "数学の勉強始める",
      "大学のレポート書く",
      "昼ごはん食べる",
      "コード書く",
      "散歩に出かける"
    ]
  },
  "study_toggl": {
    desc: "学習・開発全般（クライアントを自動判定）",
    examples: [
      "Pythonの勉強開始",
      "大学の線形代数のレポート書く",
      "競プロの問題解く",
      "アプリ開発する",
      "英語の資格勉強"
    ]
  },
  "lifelog_toggl": {
    desc: "日常生活の記録",
    examples: [
      "昼ごはん食べる",
      "ランニング開始",
      "昼寝する",
      "買い物に行く",
      "お風呂入る"
    ]
  },
  "retake_toggl": {
    desc: "再受験・高校学習（Study / 高校学習 に固定）",
    examples: [
      "数学IAの問題集やる",
      "英語の長文読解始める",
      "化学基礎の復習",
      "日本史の暗記",
      "物理の演習問題"
    ]
  },
  "help_toggl": {
    desc: "カテゴリに迷ったときの相談チャンネル（Geminiが分類して説明）",
    examples: [
      "TOEICの勉強をしたい",
      "友達に教わりながら数学を解く",
      "論文を読む",
      "副業のコードを書く"
    ]
  },
  "help_management_study": {
    desc: "学習進捗管理セクションの使い方ガイド（#study / #retake チャンネル）",
    examples: [
      "【進捗表の作成】",
      "  「この教材の進捗表を作って [Google DocsのURL]」",
      "  「フォルダの最新Docで進捗表を作って」",
      "",
      "【進捗の更新】",
      "  「数学IIIの例題1〜5完了」",
      "  「英語の第2章の練習問題を進行中にして」",
      "  「物理の演習3を未着手に戻して」",
      "",
      "【進捗の確認】",
      "  「数学IIIの進捗を見せて」",
      "  「全科目の進捗を確認」",
      "  「進捗表の一覧を見せて」",
      "",
      "【NotebookLM → Docsの手順】",
      "  1. NotebookLMでPDFを読み込む",
      "  2. 「章と問題番号の一覧を出して」と質問",
      "  3. 「ノートに保存」→ Google Docsに出力",
      "  4. 指定フォルダ（NOTEBOOKLM_DOCS_FOLDER_ID）に保存",
      "  5. #study または #retake でDocのURLを送る"
    ]
  }
};

// ==========================================
// カレンダー設定
// key = Googleカレンダーの正式名称（またはGeminiが渡す名称）
// desc = どんな内容を記録するかの説明（Geminiへのヒント）
// ==========================================
const CALENDAR_HINTS = {
  "Life Log":  "日常生活・食事・運動・休憩・外出など（Life Logワークスペースに対応）",
  "Study":     "大学・趣味の勉強・開発の記録（高校学習を除くStudyワークスペースに対応）",
  "高校学習":  "再受験・高校範囲の学習（#retake_togglチャンネル・高校学習クライアントに対応）"
};

// チャンネル別のデフォルトカレンダー（nullはGeminiが内容から判断）
const CHANNEL_CALENDAR_DEFAULTS = {
  "retake_toggl":     "高校学習",
  "lifelog_toggl":    "Life Log",
  "study_toggl":      "Study",
  "general_toggl":    null,
  "general_schedule": null,
  "help_toggl":       null
};

// Studyワークスペースのクライアント用途（Gemini推定ガイド）
const STUDY_CLIENT_HINTS = {
  "大学":     "大学の授業・レポート・研究・ゼミなど",
  "高校学習": "再受験・高校範囲の学習（数学・英語・理科・社会など）",
  "趣味の勉強": "独学・資格・個人的な興味による学習",
  "開発":     "プログラミング・システム開発・エンジニアリング・ツール作成"
};

// ==========================================
// 旧連携設定（Slack/MCP） - WebApp完全移行に伴い使用しなくなります
// ==========================================

// Slack Incoming Webhook URL（Slack App → Incoming Webhooks）
const SLACK_INCOMING_WEBHOOK_URL = "https://hooks.slack.com/services/xxx/yyy/zzz";  // ← 取得後に設定

// ==========================================
// v2.1 追加設定（Phase 2: Linear 連携）
// ==========================================

// Linear Personal API Key（linear.app → Settings → API → Personal API Keys）
const LINEAR_API_KEY = "lin_api_jS1BbnhtXQWJ8DtkE5KrI9kor8y3hAuHJbxFOqR7";  // ← 取得後に設定

// Linear チーム ID（linear.app → Settings → Members → Team ID）
const LINEAR_TEAM_ID = "a7b65398-2a4a-43d1-a41e-236b4d6d1d4c";  // ← 取得後に設定

// Linear プロジェクト設定
// ※ linearSetupProjects() をGASエディタで実行してIDを確認し、下記に入力してください
const LINEAR_PROJECTS = {
  retake: { id: "f85ba591-0712-4465-a381-85dbe641dbf0", name: "Retake_project" },   // 再受験・高校学習の週次タスク
  weekly: { id: "c22eb873-fbc2-4daf-8adb-d1db241688b5", name: "Advanced_learning_project" }  // 大学・その他の週次自主学習（名前は作成したプロジェクト名に合わせる）
};


