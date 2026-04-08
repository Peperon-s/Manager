// ==========================================
// CFS Web App: メイン処理 (MCP / Slackから完全移行)
// ==========================================

function handleWebChatMessage_(userMessage, history, userEmail, imageBase64, imageMimeType) {
  // 1. 会話履歴をGemini用フォーマットに変換（コンテキスト管理: 直近20件に絞る）
  const MAX_HISTORY_SEND = 20;
  const trimmedHistory = (history && history.length > MAX_HISTORY_SEND)
    ? history.slice(history.length - MAX_HISTORY_SEND)
    : (history || []);

  const contents = [];
  trimmedHistory.forEach(function(msg) {
    if (msg.role === "user") {
      contents.push({ role: "user", parts: [{ text: msg.text || "" }] });
    } else if (msg.role === "ai" || msg.role === "model") {
      contents.push({ role: "model", parts: [{ text: msg.text || "" }] });
    }
  });

  // 今の送信内容を追加（画像があればinlineDataを含める）
  const userParts = [];
  if (imageBase64 && imageMimeType) {
    userParts.push({ inlineData: { mimeType: imageMimeType, data: imageBase64 } });
  }
  userParts.push({ text: userMessage });
  contents.push({ role: "user", parts: userParts });

  // 2. コンテキスト情報の構築
  const nowStr = Utilities.formatDate(new Date(), "JST", "yyyy-MM-dd(E) HH:mm:ss");
  const lifeCtx  = togglBuildContext("lifelog", null);
  const studyCtx = togglBuildContext("study", null);
  const togglContextText = "【Life Logワークスペース】\n" + lifeCtx.text + "\n\n【Studyワークスペース】\n" + studyCtx.text;
  
  const tasksContext = tasksBuildContext();
  const calContext  = calendarsBuildContext_();
  
  const props    = PropertiesService.getScriptProperties();
  const sheetMap = JSON.parse(props.getProperty("PROGRESS_SHEETS") || "{}");
  const sheetCtx = Object.keys(sheetMap).length
    ? "作成済み進捗表: " + Object.keys(sheetMap).join(", ")
    : "進捗表はまだ作成されていません。";

  // メモリ取得
  const memoryText = userEmail ? memoryBuildPromptText_(userEmail) : '';

  // システムプロンプト
  const systemPrompt =
    "あなたはユーザーの活動をサポートするライフマネジメントAIです。現在は " + nowStr + " です。\n\n" +
    (memoryText ? memoryText + "\n\n" : "") +
    "【各種コンテキスト情報】\n" +
    "■ Toggl Track (時間記録)\n" + togglContextText + "\n" +
    "・Studyワークスペースのクライアント用途目安: " + JSON.stringify(STUDY_CLIENT_HINTS) + "\n\n" +
    "■ Google Calendar (予定)\n" + calContext + "\n" +
    "・普段の記録はデフォルトカレンダーで構いません。学習や大学などは「Study」などを選ぶと良いでしょう。\n\n" +
    "■ Todoist (タスク)\n" + tasksContext + "\n\n" +
    "■ 学習進捗管理\n" + sheetCtx + "\n\n" +
    "【指示】\n" +
    "ユーザーのメッセージの文脈から最も適切なツールを呼び出してください。ツール呼び出しが不要な場合はテキストで回答してください。タスク追加やタイマー開始は対象を明確にしてください。日付を指定するツールは必ず ISO 8601形式 または YYYY-MM-DD形式 をツールの仕様に合わせて使用してください。\n" +
    "ユーザーが「〜を覚えておいて」「〜を記録して」「メモリに保存して」のように言った場合はsaveMemoryを呼び出してください。「〜を忘れて」「メモリから削除して」の場合はdeleteMemoryを、「メモリを見せて」「覚えていることを教えて」の場合はlistMemoriesを呼び出してください。\n" +
    "画像が添付されている場合は、まず画像の内容を読み取ってください。手書きのスケジュール・予定・タスクが含まれている場合は内容を整理して提示し、カレンダー登録やタスク追加が必要かユーザーに確認した上でツールを呼び出してください。";

  // 3. ツール一覧の定義 (全21ツールを統合)
  const fnDeclarations = getUniversalToolDeclarations_();

  // 4. エージェントループ（最大8ツール呼び出し → テキスト応答まで継続）
  const MAX_TOOL_CALLS = 8;
  let toolCallCount = 0;
  let finalMessage  = "";
  let shouldRefresh = false;
  const workingContents = contents.slice(); // 作業用コピー

  while (true) {
    const result = geminiGenerate_({
      contents: workingContents,
      tools: [{ function_declarations: fnDeclarations }],
      system_instruction: { parts: [{ text: systemPrompt }] }
    });

    if (result.error) return { error: "APIエラー: " + result.error.message };
    if (!result.candidates || !result.candidates.length) return { error: "有効な回答がありませんでした" };

    const responseParts = result.candidates[0].content
      ? result.candidates[0].content.parts
      : [];

    // Function call があるか確認
    const funcPart = responseParts.find(function(p) { return p.functionCall; });

    if (!funcPart || toolCallCount >= MAX_TOOL_CALLS) {
      // テキスト応答 → ループ終了
      const textPart = responseParts.find(function(p) { return p.text; });
      finalMessage = textPart
        ? textPart.text
        : (toolCallCount >= MAX_TOOL_CALLS ? "処理の上限に達しました。再度お試しください。" : "処理が完了しました。");
      break;
    }

    // ツール実行
    const call = funcPart.functionCall;
    logToSheet("ツール呼び出し(" + (toolCallCount + 1) + "): " + call.name + " " + JSON.stringify(call.args));
    shouldRefresh = true;

    let toolResult;
    try {
      toolResult = String(executeFunctionCall_(call, userEmail || null));
    } catch (e) {
      toolResult    = "ツール実行エラー: " + e.message;
      shouldRefresh = false;
    }

    // モデル応答 + ツール結果を会話に追加して次のループへ
    workingContents.push({ role: "model", parts: responseParts });
    workingContents.push({
      role: "user",
      parts: [{ functionResponse: { name: call.name, response: { result: toolResult } } }]
    });

    toolCallCount++;
  }

  // 5. 履歴を更新（最大30件保持）
  const newHistory = (history || []).slice();
  newHistory.push({ role: "user", text: userMessage });
  newHistory.push({ role: "ai",   text: finalMessage });
  if (newHistory.length > 30) newHistory.splice(0, newHistory.length - 30);

  return { message: finalMessage, shouldRefresh: shouldRefresh, newHistory: newHistory };
}

// ツール呼び出しのルーティング
function executeFunctionCall_(call, userEmail) {
  const name = call.name;
  const args = call.args;

  // -- Toggl
  if (name === "togglStartTimer") {
    const wsName = args.workspaceKey || "study";
    const wsId = TOGGL_WORKSPACES[wsName] ? TOGGL_WORKSPACES[wsName].id : TOGGL_WORKSPACES["study"].id;
    const projId = args.projectName ? resolveProjectId(wsId, args.projectName, args.clientName||null) : null;
    return togglStartTimer(args.description, wsId, projId, args.tags||[]);
  }
  if (name === "togglCreateEntry") {
    const wsName = args.workspaceKey || "study";
    const wsId = TOGGL_WORKSPACES[wsName] ? TOGGL_WORKSPACES[wsName].id : TOGGL_WORKSPACES["study"].id;
    const projId = args.projectName ? resolveProjectId(wsId, args.projectName, args.clientName||null) : null;
    return togglCreateEntry(args.description, args.startTime, args.stopTime, wsId, projId, args.tags||[]);
  }
  if (name === "togglEditEntry") {
    return togglEditEntry(args.description, args.workspaceKey||null, args.newDescription||null, args.newStartTime||null, args.newStopTime||null);
  }
  if (name === "togglDeleteEntry") { return togglDeleteEntry(args.description, args.workspaceKey||null); }
  if (name === "togglGetWeeklySummary") { return togglGetWeeklySummary(); }
  if (name === "togglStopTimer") { return togglStopTimer(); }
  if (name === "togglGetTodayEntries") { return togglGetTodayEntries(); }

  // -- Calendar
  if (name === "createCalendarEvent") { return createCalendarEvent(args.title, args.startTime, args.endTime, args.calendarName||null); }
  if (name === "getUpcomingEvents") { return getUpcomingEvents(args.days||7); }
  if (name === "updateCalendarEvent") { return updateCalendarEvent(args.searchTitle, args.newTitle||null, args.newStartTime||null, args.newEndTime||null); }
  if (name === "deleteCalendarEvent") { return deleteCalendarEvent(args.searchTitle, args.searchDate||null); }

  // -- Tasks
  if (name === "tasksCreate") { return tasksCreate(args.title, args.notes||null, args.dueDate||null, args.projectName||null, args.priority||null); }
  if (name === "tasksCreateMultiple") { return tasksCreateMultiple(args.tasks); }
  if (name === "tasksList") { return tasksList(args.projectName||null); }
  if (name === "tasksComplete") { return tasksComplete(args.taskTitle, args.projectName||null); }
  if (name === "tasksSetDue") { return tasksSetDue(args.taskTitle, args.dueDate, args.projectName||null); }
  if (name === "tasksUpdate") { return tasksUpdate(args.taskTitle, args.newTitle||null, args.newNotes||null, args.newDueDate||null, args.newProjectName||null, args.newPriority||null); }

  // -- Progress
  if (name === "createProgressSheet") { return createProgressSheet(args.title, args.subject, args.rows||[]); }
  if (name === "updateProgressSheet") { return updateProgressSheet(args.subject, args.problems, args.status||null, args.note||null); }
  if (name === "getProgressSummary") { return getProgressSummary(args.subject||null); }
  if (name === "listProgressSheets") { return listProgressSheets(); }

  // -- Linear
  if (name === "linearCreateIssue")    { return linearCreateIssue(args.title, args.projectKey, args.priority||null, args.description||null); }
  if (name === "linearListIssues")     { return linearListIssues(args.projectKey, args.includeCompleted||false); }
  if (name === "linearCompleteIssue")  { return linearCompleteIssue(args.issueTitle, args.projectKey); }
  if (name === "linearUpdateIssue")    { return linearUpdateIssue(args.issueTitle, args.projectKey, args.newTitle||null, args.newPriority||null, args.newStateName||null); }
  if (name === "linearGetCycleSummary"){ return linearGetCycleSummary(args.projectKey); }

  // -- Memory
  if (name === "saveMemory")       { return saveMemory(userEmail||null, args.key, args.value); }
  if (name === "deleteMemory")     { return deleteMemory(userEmail||null, args.key); }
  if (name === "listMemories")     { return listMemories(userEmail||null); }
  if (name === "readSheetFromUrl") { return readSheetFromUrl(args.url, args.sheetName||null); }

  // -- NotebookLM
  if (name === "notebookLMCreate")    { return notebookLMCreate(args.title); }
  if (name === "notebookLMList")      { return notebookLMList(); }
  if (name === "notebookLMAddSource") { return notebookLMAddSource(args.notebookId, args.sourceType, args.content, args.title||null); }
  if (name === "notebookLMDelete")    { return notebookLMDelete(args.notebookId); }

  return "不明なツール呼び出しです: " + name;
}

// ------------------------------------------
// ツール定義全集
// ------------------------------------------
function getUniversalToolDeclarations_() {
  const workspaceEnum = ["lifelog", "study"];
  const clientNameProp = { type: "STRING", description: "クライアント名（Lifelogの場合は不要、Studyの場合は用途に応じて指定）" };
  const priorityEnum = ["p1", "p2", "p3", "p4"];

  return [
    {
      name: "togglStartTimer",
      description: "Togglのタイマーを開始します。対象のワークスペース、クライアント等の情報を必要に応じて指定します。",
      parameters: {
        type: "OBJECT",
        properties: {
          description:  { type: "STRING", description: "作業内容の説明（簡潔に）" },
          workspaceKey: { type: "STRING", description: "使用するワークスペース", enum: workspaceEnum },
          clientName:   clientNameProp,
          projectName:  { type: "STRING", description: "プロジェクト名" },
          tags: { type: "ARRAY", items: { type: "STRING" }, description: "タグ名配列" }
        },
        required: ["description", "workspaceKey"]
      }
    },
    {
      name: "togglCreateEntry",
      description: "開始時間と終了時間を指定して記録を追加",
      parameters: {
        type: "OBJECT",
        properties: {
          description: { type: "STRING" },
          startTime: { type: "STRING", description: "ISO 8601形式" },
          stopTime: { type: "STRING", description: "ISO 8601形式" },
          workspaceKey: { type: "STRING", enum: workspaceEnum },
          clientName: clientNameProp,
          projectName: { type: "STRING" },
          tags: { type: "ARRAY", items: { type: "STRING" } }
        },
        required: ["description", "startTime", "stopTime", "workspaceKey"]
      }
    },
    {
      name: "togglEditEntry",
      description: "Togglの直近の記録を編集",
      parameters: {
        type: "OBJECT",
        properties: {
          description: { type: "STRING" },
          workspaceKey: { type: "STRING", enum: workspaceEnum },
          newDescription: { type: "STRING" },
          newStartTime: { type: "STRING" },
          newStopTime: { type: "STRING" }
        },
        required: ["description"]
      }
    },
    {
      name: "togglDeleteEntry",
      description: "Togglの直近記録を削除",
      parameters: {
        type: "OBJECT",
        properties: { description: { type: "STRING" }, workspaceKey: { type: "STRING", enum: workspaceEnum } },
        required: ["description"]
      }
    },
    { name: "togglGetWeeklySummary", description: "直近7日間のサマリー", parameters: { type: "OBJECT", properties: {} } },
    { name: "togglStopTimer", description: "実行中タイマーを停止", parameters: { type: "OBJECT", properties: {} } },
    { name: "togglGetTodayEntries", description: "今日の作業記録を取得", parameters: { type: "OBJECT", properties: {} } },
    
    // Calendar tools
    {
      name: "createCalendarEvent",
      description: "Googleカレンダーに予定を登録",
      parameters: {
        type: "OBJECT",
        properties: {
          title: { type: "STRING" },
          startTime: { type: "STRING", description: "ISO 8601" },
          endTime: { type: "STRING", description: "ISO 8601" },
          calendarName: { type: "STRING" }
        },
        required: ["title", "startTime", "endTime"]
      }
    },
    {
      name: "getUpcomingEvents",
      description: "今後の予定を取得",
      parameters: { type: "OBJECT", properties: { days: { type: "NUMBER" } } }
    },
    {
      name: "updateCalendarEvent",
      description: "既存の予定を編集",
      parameters: {
        type: "OBJECT",
        properties: {
          searchTitle: { type: "STRING" }, newTitle: { type: "STRING" }, newStartTime: { type: "STRING" }, newEndTime: { type: "STRING" }
        },
        required: ["searchTitle"]
      }
    },
    {
      name: "deleteCalendarEvent",
      description: "予定を削除",
      parameters: { type: "OBJECT", properties: { searchTitle: { type: "STRING" }, searchDate: { type: "STRING" } }, required: ["searchTitle"] }
    },

    // Task tools
    {
      name: "tasksCreate",
      description: "Todoistにタスク1件追加",
      parameters: {
        type: "OBJECT",
        properties: {
          title: { type: "STRING" }, notes: { type: "STRING" }, dueDate: { type: "STRING" },
          projectName: { type: "STRING" }, priority: { type: "STRING", enum: priorityEnum }
        },
        required: ["title"]
      }
    },
    {
      name: "tasksCreateMultiple",
      description: "複数タスク追加",
      parameters: {
        type: "OBJECT",
        properties: {
          tasks: { type: "ARRAY", items: { type: "OBJECT", properties: { title: {type:"STRING"}, notes: {type:"STRING"}, dueDate: {type:"STRING"}, projectName: {type:"STRING"}, priority: {type:"STRING", enum:priorityEnum} }, required: ["title"] } }
        },
        required: ["tasks"]
      }
    },
    { name: "tasksList", description: "タスク一覧表示", parameters: { type: "OBJECT", properties: { projectName: { type: "STRING" } } } },
    { name: "tasksComplete", description: "タスク完了", parameters: { type: "OBJECT", properties: { taskTitle: { type: "STRING" }, projectName: { type: "STRING" } }, required: ["taskTitle"] } },
    { name: "tasksSetDue", description: "期限設定", parameters: { type: "OBJECT", properties: { taskTitle: { type: "STRING" }, dueDate: { type: "STRING" }, projectName: { type: "STRING" } }, required: ["taskTitle", "dueDate"] } },
    { name: "tasksUpdate", description: "タスク情報更新", parameters: { type: "OBJECT", properties: { taskTitle: { type: "STRING" }, newTitle: { type: "STRING" }, newNotes: { type: "STRING" }, newDueDate: { type: "STRING" }, newProjectName: { type: "STRING" }, newPriority: { type: "STRING", enum: priorityEnum } }, required: ["taskTitle"] } },

    // Progress tools
    {
      name: "createProgressSheet",
      description: "進捗表新規作成",
      parameters: {
        type: "OBJECT",
        properties: {
          title: { type: "STRING" }, subject: { type: "STRING" },
          rows: { type: "ARRAY", items: { type: "OBJECT", properties: { chapter: {type:"STRING"}, problemId: {type:"STRING"}, type: {type:"STRING"} }, required: ["chapter", "problemId"] } }
        },
        required: ["title", "subject", "rows"]
      }
    },
    {
      name: "updateProgressSheet",
      description: "進捗ステータスを更新",
      parameters: {
        type: "OBJECT",
        properties: {
          subject: { type: "STRING" }, problems: { type: "ARRAY", items: { type: "STRING" } },
          status: { type: "STRING", enum: ["✅ 完了", "🔄 進行中", "⬜ 未着手"] }, note: { type: "STRING" }
        },
        required: ["subject", "problems"]
      }
    },
    { name: "getProgressSummary", description: "進捗サマリー", parameters: { type: "OBJECT", properties: { subject: { type: "STRING" } } } },
    { name: "listProgressSheets", description: "進捗表一覧", parameters: { type: "OBJECT", properties: {} } },

    // Linear tools
    {
      name: "linearCreateIssue",
      description: "Linearにイシュー（週次タスク）を作成する。retakeは再受験・高校学習、weeklyは大学など週次の自主学習タスク。",
      parameters: {
        type: "OBJECT",
        properties: {
          title:      { type: "STRING", description: "イシューのタイトル" },
          projectKey: { type: "STRING", enum: ["retake", "weekly"], description: "retake=再受験・高校学習 / weekly=週次自主学習" },
          priority:   { type: "STRING", enum: ["urgent", "high", "medium", "low"], description: "優先度（省略時: medium）" },
          description:{ type: "STRING", description: "詳細説明（省略可）" }
        },
        required: ["title", "projectKey"]
      }
    },
    {
      name: "linearListIssues",
      description: "Linearのイシュー一覧を取得する",
      parameters: {
        type: "OBJECT",
        properties: {
          projectKey:       { type: "STRING", enum: ["retake", "weekly"] },
          includeCompleted: { type: "BOOLEAN", description: "完了済みも含める場合はtrue（デフォルト: false）" }
        },
        required: ["projectKey"]
      }
    },
    {
      name: "linearCompleteIssue",
      description: "Linearのイシューを完了にする",
      parameters: {
        type: "OBJECT",
        properties: {
          issueTitle: { type: "STRING", description: "完了するイシューのタイトル（部分一致）" },
          projectKey: { type: "STRING", enum: ["retake", "weekly"] }
        },
        required: ["issueTitle", "projectKey"]
      }
    },
    {
      name: "linearUpdateIssue",
      description: "Linearのイシューを更新する（タイトル・優先度・ステータス変更）",
      parameters: {
        type: "OBJECT",
        properties: {
          issueTitle:   { type: "STRING", description: "検索するイシュータイトル（部分一致）" },
          projectKey:   { type: "STRING", enum: ["retake", "weekly"] },
          newTitle:     { type: "STRING", description: "新しいタイトル（省略可）" },
          newPriority:  { type: "STRING", enum: ["urgent", "high", "medium", "low"], description: "新しい優先度（省略可）" },
          newStateName: { type: "STRING", description: "新しいステータス名（例: In Progress, Todo 省略可）" }
        },
        required: ["issueTitle", "projectKey"]
      }
    },
    {
      name: "linearGetCycleSummary",
      description: "Linearの今週のサイクル（週次スプリント）の進捗サマリーを取得する",
      parameters: {
        type: "OBJECT",
        properties: {
          projectKey: { type: "STRING", enum: ["retake", "weekly"] }
        },
        required: ["projectKey"]
      }
    },

    // ── Memory ──────────────────────────────────
    {
      name: "readSheetFromUrl",
      description: "GoogleスプレッドシートのURLまたはIDからシートの内容を読み取る。ユーザーのメモリにスプレッドシートのURLが登録されている場合や、シートの内容を参照したい場合に使用する。",
      parameters: {
        type: "OBJECT",
        properties: {
          url:       { type: "STRING", description: "GoogleスプレッドシートのURL（https://docs.google.com/spreadsheets/d/...）またはID" },
          sheetName: { type: "STRING", description: "読み取るシート名（省略時はアクティブシート）" }
        },
        required: ["url"]
      }
    },

    {
      name: "saveMemory",
      description: "ユーザーの個人データをメモリに保存する。講義時間・習慣・好み・住所・定型情報など、将来の会話で参照したい情報を登録する。ユーザーが「覚えておいて」「記録して」「メモリに保存して」と言ったときに呼び出す。",
      parameters: {
        type: "OBJECT",
        properties: {
          key:   { type: "STRING", description: "メモリのキー名（例: 講義時間、自宅住所、好きな食べ物）" },
          value: { type: "STRING", description: "保存する内容（複数行可）" }
        },
        required: ["key", "value"]
      }
    },
    {
      name: "deleteMemory",
      description: "ユーザーのメモリから特定のデータを削除する。「〜を忘れて」「メモリから削除して」と言ったときに呼び出す。",
      parameters: {
        type: "OBJECT",
        properties: {
          key: { type: "STRING", description: "削除するメモリのキー名" }
        },
        required: ["key"]
      }
    },
    {
      name: "listMemories",
      description: "登録されているメモリの一覧を表示する。「メモリを見せて」「覚えていることを教えて」と言ったときに呼び出す。",
      parameters: {
        type: "OBJECT",
        properties: {}
      }
    },

    // ── NotebookLM ──────────────────────────────
    {
      name: "notebookLMCreate",
      description: "NotebookLM Enterprise に新しいノートブックを作成する。「ノートブックを作って」「NotebookLMに保存して」と言ったときに呼び出す。",
      parameters: {
        type: "OBJECT",
        properties: {
          title: { type: "STRING", description: "ノートブックのタイトル" }
        },
        required: ["title"]
      }
    },
    {
      name: "notebookLMList",
      description: "NotebookLM のノートブック一覧（最近閲覧したもの）を取得する。「ノートブックの一覧を見せて」と言ったときに呼び出す。",
      parameters: { type: "OBJECT", properties: {} }
    },
    {
      name: "notebookLMAddSource",
      description: "NotebookLM のノートブックにソース（URL・テキスト・Driveファイル）を追加する。「このURLをノートブックに追加して」「資料を登録して」と言ったときに呼び出す。",
      parameters: {
        type: "OBJECT",
        properties: {
          notebookId: { type: "STRING", description: "追加先ノートブックのID" },
          sourceType: { type: "STRING", enum: ["url", "text", "drive"], description: "ソース種別: url / text / drive" },
          content:    { type: "STRING", description: "URLの場合はURL、textの場合は本文、driveの場合はファイルID" },
          title:      { type: "STRING", description: "テキストソースのタイトル（sourceType=text のときのみ使用）" }
        },
        required: ["notebookId", "sourceType", "content"]
      }
    },
    {
      name: "notebookLMDelete",
      description: "NotebookLM のノートブックを削除する。「ノートブックを削除して」と言ったときに呼び出す。",
      parameters: {
        type: "OBJECT",
        properties: {
          notebookId: { type: "STRING", description: "削除するノートブックのID" }
        },
        required: ["notebookId"]
      }
    }
  ];
}


// ==========================================
// Gemini API 呼び出し (フォールバック)
// ==========================================
function geminiGenerate_(payload) {
  // 一時エラー（高負荷）時のリトライ待機時間(ms)
  var RETRY_DELAYS = [3000, 8000];

  for (var i = 0; i < GEMINI_MODELS.length; i++) {
    var model = GEMINI_MODELS[i];
    var url   = "https://generativelanguage.googleapis.com/v1beta/models/" + model
                + ":generateContent?key=" + GEMINI_API_KEY;
    var transient = false;

    for (var attempt = 0; attempt <= RETRY_DELAYS.length; attempt++) {
      if (attempt > 0) {
        logToSheet("⏳ " + model + " リトライ " + attempt + "回目 ("
                   + (RETRY_DELAYS[attempt - 1] / 1000) + "秒待機)");
        Utilities.sleep(RETRY_DELAYS[attempt - 1]);
      }

      var response = UrlFetchApp.fetch(url, {
        method: "post", contentType: "application/json",
        payload: JSON.stringify(payload), muteHttpExceptions: true
      });
      var result = JSON.parse(response.getContentText());

      if (!result.error) return result; // 成功

      var status = result.error.status || "";
      var code   = result.error.code   || 0;

      // クォータ超過 → リトライ不要、即次モデルへ
      if (status === "RESOURCE_EXHAUSTED" || code === 429) {
        logToSheet("⚠️ " + model + " クォータ超過 → 次モデルへ");
        transient = false;
        break;
      }

      // 高負荷・一時停止 → リトライ
      if (status === "UNAVAILABLE" || code === 503 || code === 500) {
        logToSheet("⚠️ " + model + " 一時エラー(" + code + "): " + result.error.message);
        transient = true;
        continue;
      }

      // その他のエラー（パラメータ不正など）→ リトライしても無駄なので即返却
      return result;
    }

    if (transient) {
      logToSheet("⚠️ " + model + " リトライ上限 → 次モデルへ");
    }
  }

  return { error: { message: "全モデルで応答が得られませんでした。しばらくしてから再度お試しください。" } };
}

// ==========================================
// カレンダー補助関数
// ==========================================
function resolveCalendar_(name) {
  if (!name) return CalendarApp.getDefaultCalendar();
  const cals = CalendarApp.getAllCalendars().filter(function(c) { return !c.getName().includes("祝日"); });
  return cals.find(function(c) { return c.getName() === name; }) ||
         cals.find(function(c) { return c.getName().includes(name) || name.includes(c.getName()); }) ||
         CalendarApp.getDefaultCalendar();
}
function calendarsBuildContext_() {
  const cals = CalendarApp.getAllCalendars().filter(function(c) { return !c.getName().includes("祝日"); }).map(function(c) { return c.getName(); });
  const hints = Object.keys(CALENDAR_HINTS).map(function(name) { return '  - "' + name + '": ' + CALENDAR_HINTS[name]; });
  const others = cals.filter(function(n) { return !CALENDAR_HINTS[n]; }).map(function(n) { return '  - "' + n + '"'; });
  return "利用可能なGoogleカレンダー:\n" + hints.concat(others).join("\n");
}
function createCalendarEvent(title, startTime, endTime, calendarName) {
  const cal = resolveCalendar_(calendarName);
  cal.createEvent(title, new Date(startTime), new Date(endTime));
  const fmt = function(t) { return Utilities.formatDate(new Date(t), "JST", "MM/dd HH:mm"); };
  return "✅ カレンダーに登録しました！\n内容: " + title + "\n日時: " + fmt(startTime) + " 〜 " + Utilities.formatDate(new Date(endTime), "JST", "HH:mm") + "\nカレンダー: " + cal.getName();
}

// ==========================================
// ログ出力補助関数
// ==========================================
function logToSheet(text) {
  try {
    if (!SPREADSHEET_ID) return;
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    let sheet = ss.getSheetByName("Logs");
    if (!sheet) {
      sheet = ss.insertSheet("Logs");
      sheet.appendRow(["Timestamp", "Message"]);
    }
    const timestamp = Utilities.formatDate(new Date(), "JST", "yyyy/MM/dd HH:mm:ss");
    sheet.appendRow([timestamp, text]);
  } catch (e) {
    console.error("Log error: " + e);
  }
}

