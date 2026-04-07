#!/usr/bin/env node
/**
 * CFS MCP Bridge
 * Claude Desktop (stdio) → GAS WebApp の橋渡しサーバー
 */

const https    = require('https');
const readline = require('readline');

const GAS_URL    = "https://script.google.com/macros/s/AKfycbxzlvvsTXV-IWo431c-wkDKJ6bWxMjrHe8bgQwDMjWnlOJ2Ch_I8yHeJ3ofeabuR1Y/exec";
const MCP_SECRET = "cfs-secret-2026";

// ==========================================
// GAS 呼び出し（リダイレクト＋クッキー自動追従）
// ==========================================
function callGAS(tool, params) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ secret: MCP_SECRET, tool, params: params || {} });

    function request(url, depth, cookies, method) {
      if (depth > 5) return reject(new Error('Too many redirects'));
      method = method || 'POST';
      const u = new URL(url);
      const headers = {};
      if (cookies) headers['Cookie'] = cookies;

      // POST のときだけ body を送る
      if (method === 'POST') {
        headers['Content-Type']   = 'application/json';
        headers['Content-Length'] = Buffer.byteLength(body);
      }

      const opts = {
        hostname: u.hostname,
        path: u.pathname + u.search,
        method,
        headers
      };
      const req = https.request(opts, res => {
        const setCookie = res.headers['set-cookie'];
        const nextCookies = setCookie
          ? setCookie.map(c => c.split(';')[0]).join('; ')
          : cookies;

        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume();
          // 301/302/303 は GET に切り替え、307/308 は同メソッドを維持
          const nextMethod = (res.statusCode === 307 || res.statusCode === 308) ? method : 'GET';
          return request(res.headers.location, depth + 1, nextCookies, nextMethod);
        }
        let data = '';
        res.on('data', c => data += c);
        res.on('end', () => {
          try {
            const json = JSON.parse(data);
            if (json.ok) resolve(String(json.result));
            else reject(new Error(json.error || 'GAS error'));
          } catch (e) {
            reject(new Error('Parse error: ' + data.substring(0, 200)));
          }
        });
      });
      req.on('error', reject);
      if (method === 'POST') req.write(body);
      req.end();
    }

    request(GAS_URL, 0, null, 'POST');
  });
}

// ==========================================
// ツール定義
// ==========================================
const TOOLS = [
  // ---- Toggl ----
  {
    name: "togglStartTimer",
    description: "Toggl タイマーを開始する",
    inputSchema: {
      type: "object",
      properties: {
        description:  { type: "string", description: "作業内容" },
        workspaceKey: { type: "string", description: "'study' または 'lifelog'" },
        clientName:   { type: "string", description: "'大学'/'高校学習'/'趣味の勉強'/'開発'" }
      },
      required: ["description"]
    }
  },
  {
    name: "togglStopTimer",
    description: "実行中の Toggl タイマーを停止する",
    inputSchema: { type: "object", properties: {} }
  },
  {
    name: "togglCreateEntry",
    description: "開始・終了時間を指定して Toggl に記録を追加する",
    inputSchema: {
      type: "object",
      properties: {
        description:  { type: "string" },
        startTime:    { type: "string", description: "ISO8601 または 'HH:MM'" },
        stopTime:     { type: "string", description: "ISO8601 または 'HH:MM'" },
        workspaceKey: { type: "string" },
        clientName:   { type: "string" }
      },
      required: ["description", "startTime", "stopTime"]
    }
  },
  {
    name: "togglEditEntry",
    description: "直近の Toggl 記録を説明文で検索して編集する",
    inputSchema: {
      type: "object",
      properties: {
        searchDescription: { type: "string", description: "検索する説明文（部分一致）" },
        newDescription:    { type: "string" },
        newStartTime:      { type: "string" },
        newStopTime:       { type: "string" }
      },
      required: ["searchDescription"]
    }
  },
  {
    name: "togglDeleteEntry",
    description: "直近の Toggl 記録を説明文で検索して削除する",
    inputSchema: {
      type: "object",
      properties: {
        searchDescription: { type: "string" }
      },
      required: ["searchDescription"]
    }
  },
  {
    name: "togglGetTodayEntries",
    description: "今日の Toggl 記録一覧を取得する",
    inputSchema: { type: "object", properties: {} }
  },
  {
    name: "togglGetWeeklySummary",
    description: "直近7日間の Toggl 週次サマリーを取得する",
    inputSchema: { type: "object", properties: {} }
  },
  // ---- Google Calendar ----
  {
    name: "createCalendarEvent",
    description: "Google カレンダーにイベントを追加する",
    inputSchema: {
      type: "object",
      properties: {
        title:        { type: "string" },
        startTime:    { type: "string", description: "ISO8601" },
        endTime:      { type: "string", description: "ISO8601" },
        calendarName: { type: "string", description: "'Life Log' / 'Study' / '高校学習'" },
        description:  { type: "string" }
      },
      required: ["title", "startTime", "endTime"]
    }
  },
  {
    name: "updateCalendarEvent",
    description: "Google カレンダーのイベントをタイトル部分一致で検索して編集する",
    inputSchema: {
      type: "object",
      properties: {
        searchTitle:  { type: "string" },
        newTitle:     { type: "string" },
        newStartTime: { type: "string" },
        newEndTime:   { type: "string" },
        calendarName: { type: "string" }
      },
      required: ["searchTitle"]
    }
  },
  {
    name: "deleteCalendarEvent",
    description: "Google カレンダーのイベントをタイトル部分一致で検索して削除する",
    inputSchema: {
      type: "object",
      properties: {
        searchTitle:  { type: "string" },
        calendarName: { type: "string" }
      },
      required: ["searchTitle"]
    }
  },
  {
    name: "getTodayEvents",
    description: "今日のカレンダー予定一覧を取得する",
    inputSchema: { type: "object", properties: {} }
  },
  {
    name: "getUpcomingEvents",
    description: "直近の予定を取得する",
    inputSchema: {
      type: "object",
      properties: {
        days: { type: "number", description: "取得する日数（デフォルト7）" }
      }
    }
  },
  // ---- Todoist ----
  {
    name: "tasksCreate",
    description: "Todoist にタスクを1件追加する",
    inputSchema: {
      type: "object",
      properties: {
        content:  { type: "string" },
        priority: { type: "string", description: "p1/p2/p3/p4" },
        due:      { type: "string", description: "期限（例: '明日', '3月31日'）" }
      },
      required: ["content"]
    }
  },
  {
    name: "tasksCreateMultiple",
    description: "Todoist にタスクを複数件追加する",
    inputSchema: {
      type: "object",
      properties: {
        tasks: {
          type: "array",
          items: {
            type: "object",
            properties: {
              content:  { type: "string" },
              priority: { type: "string" },
              due:      { type: "string" }
            },
            required: ["content"]
          }
        }
      },
      required: ["tasks"]
    }
  },
  {
    name: "tasksList",
    description: "Todoist のタスク一覧を取得する",
    inputSchema: {
      type: "object",
      properties: {
        filter: { type: "string", description: "フィルター（例: 'today', 'overdue'）" }
      }
    }
  },
  {
    name: "tasksComplete",
    description: "Todoist のタスクを完了にする（タイトル部分一致）",
    inputSchema: {
      type: "object",
      properties: {
        content: { type: "string", description: "タスク名（部分一致）" }
      },
      required: ["content"]
    }
  },
  {
    name: "tasksUpdate",
    description: "Todoist のタスクを編集する",
    inputSchema: {
      type: "object",
      properties: {
        content:    { type: "string", description: "検索するタスク名" },
        newContent: { type: "string" },
        priority:   { type: "string" },
        due:        { type: "string" }
      },
      required: ["content"]
    }
  },
  {
    name: "tasksSetDue",
    description: "Todoist のタスクに期限を設定する",
    inputSchema: {
      type: "object",
      properties: {
        content: { type: "string" },
        due:     { type: "string" }
      },
      required: ["content", "due"]
    }
  },
  // ---- 進捗管理 ----
  {
    name: "createProgressSheet",
    description: "Google Docs URL から学習進捗スプレッドシートを作成する",
    inputSchema: {
      type: "object",
      properties: {
        subject: { type: "string", description: "科目名（例: '数学III'）" },
        docUrl:  { type: "string", description: "Google Docs の URL" }
      },
      required: ["subject", "docUrl"]
    }
  },
  {
    name: "updateProgressSheet",
    description: "学習進捗を更新する",
    inputSchema: {
      type: "object",
      properties: {
        subject:   { type: "string" },
        problemId: { type: "string", description: "問題番号（例: '例題1'）" },
        status:    { type: "string", description: "✅ 完了 / 🔄 進行中 / ⬜ 未着手" }
      },
      required: ["subject", "problemId", "status"]
    }
  },
  {
    name: "getProgressSummary",
    description: "学習進捗のサマリーをプログレスバー付きで取得する",
    inputSchema: {
      type: "object",
      properties: {
        subject: { type: "string", description: "科目名（省略時は全科目）" }
      }
    }
  },
  // ---- メモ ----
  {
    name: "memoSave",
    description: "メモを保存する",
    inputSchema: {
      type: "object",
      properties: {
        content: { type: "string" },
        tag:     { type: "string", description: "タグ（省略可）" }
      },
      required: ["content"]
    }
  },
  {
    name: "memoList",
    description: "メモ一覧を取得する",
    inputSchema: {
      type: "object",
      properties: {
        tag: { type: "string", description: "タグで絞り込み（省略時は全件）" }
      }
    }
  },
  {
    name: "memoSearch",
    description: "メモをキーワード検索する",
    inputSchema: {
      type: "object",
      properties: {
        keyword: { type: "string" }
      },
      required: ["keyword"]
    }
  },
  {
    name: "memoDelete",
    description: "ID を指定してメモを削除する",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string" }
      },
      required: ["id"]
    }
  },
  // ---- ダッシュボード ----
  {
    name: "getDashboardSummary",
    description: "Toggl・カレンダー・Todoist・進捗の全データサマリーを取得する",
    inputSchema: { type: "object", properties: {} }
  }
];

// ==========================================
// MCP stdio サーバー
// ==========================================
const rl = readline.createInterface({ input: process.stdin, terminal: false });

rl.on('line', async (line) => {
  line = line.trim();
  if (!line) return;

  let msg;
  try { msg = JSON.parse(line); } catch (e) { return; }

  const { id, method, params } = msg;

  // 通知（id なし）は返答不要
  if (id === undefined) return;

  try {
    if (method === 'initialize') {
      respond(id, {
        protocolVersion: (params && params.protocolVersion) || "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: { name: "cfs-bridge", version: "1.0.0" }
      });
    } else if (method === 'ping') {
      respond(id, {});
    } else if (method === 'tools/list') {
      respond(id, { tools: TOOLS });
    } else if (method === 'tools/call') {
      const result = await callGAS(params.name, params.arguments || {});
      respond(id, { content: [{ type: 'text', text: result }] });
    } else {
      respondError(id, -32601, 'Method not found: ' + method);
    }
  } catch (err) {
    process.stderr.write('CFS Bridge Error: ' + err.message + '\n');
    if (method === 'tools/call') {
      respond(id, {
        content: [{ type: 'text', text: 'エラー: ' + err.message }],
        isError: true
      });
    } else {
      respondError(id, -32603, err.message);
    }
  }
});

function respond(id, result) {
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, result }) + '\n');
}

function respondError(id, code, message) {
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, error: { code, message } }) + '\n');
}

process.stderr.write('CFS MCP Bridge started\n');
