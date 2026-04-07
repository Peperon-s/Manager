// ==========================================
// Linear API 統合
// プロジェクト構成:
//   retake → 再受験・高校学習の週次タスク
//   weekly → 大学・その他の週次自主学習
// ==========================================

// GraphQL リクエスト共通処理
function linearQuery_(query, variables) {
  const res = UrlFetchApp.fetch("https://api.linear.app/graphql", {
    method: "post",
    headers: {
      "Authorization": LINEAR_API_KEY,
      "Content-Type": "application/json"
    },
    payload: JSON.stringify({ query: query, variables: variables || {} }),
    muteHttpExceptions: true
  });
  const json = JSON.parse(res.getContentText());
  if (json.errors) throw new Error(json.errors[0].message);
  return json.data;
}

// プロジェクトキー（"retake" / "weekly"）→ プロジェクト情報
function linearResolveProject_(projectKey) {
  const proj = LINEAR_PROJECTS[projectKey];
  if (!proj) throw new Error("不明なプロジェクトキー: " + projectKey + "（retake / weekly を指定）");
  if (proj.id) return proj;

  // IDが未設定の場合、プロジェクト名で検索して自動取得
  const data = linearQuery_(
    'query($name: String!) { projects(filter: { name: { eq: $name } }) { nodes { id name } } }',
    { name: proj.name }
  );
  const found = data.projects.nodes[0];
  if (!found) throw new Error("Linearにプロジェクト「" + proj.name + "」が見つかりません。linearSetupProjects() で確認してください。");
  proj.id = found.id;
  return proj;
}

// チームのワークフロー状態一覧を取得
function linearGetStates_() {
  const data = linearQuery_(
    'query($teamId: String!) { workflowStates(filter: { team: { id: { eq: $teamId } } }) { nodes { id name type } } }',
    { teamId: LINEAR_TEAM_ID }
  );
  return data.workflowStates.nodes;
}

// 優先度文字列 → Linear priority 数値
// 0=なし, 1=Urgent, 2=High, 3=Medium, 4=Low
function linearPriority_(p) {
  const map = { urgent: 1, p1: 1, high: 2, p2: 2, medium: 3, p3: 3, low: 4, p4: 4 };
  return map[(p || "").toLowerCase()] || 3; // デフォルト: Medium
}

// ==========================================
// イシュー作成
// ==========================================
function linearCreateIssue(title, projectKey, priority, description) {
  const proj   = linearResolveProject_(projectKey);
  const states = linearGetStates_();
  const state  = states.find(function(s) { return s.type === "unstarted"; }) ||
                 states.find(function(s) { return s.type === "backlog"; });

  const input = {
    title:     title,
    teamId:    LINEAR_TEAM_ID,
    projectId: proj.id,
    priority:  linearPriority_(priority)
  };
  if (state)       input.stateId     = state.id;
  if (description) input.description = description;

  const data = linearQuery_(
    'mutation($input: IssueCreateInput!) { issueCreate(input: $input) { success issue { id identifier title url } } }',
    { input: input }
  );
  if (!data.issueCreate.success) throw new Error("イシューの作成に失敗しました");

  const issue = data.issueCreate.issue;
  return "✅ Linearにイシューを作成しました！\n" +
         "ID: "          + issue.identifier + "\n" +
         "タイトル: "    + issue.title + "\n" +
         "プロジェクト: "+ proj.name + "\n" +
         "URL: "         + issue.url;
}

// ==========================================
// イシュー一覧取得
// ==========================================
function linearListIssues(projectKey, includeCompleted) {
  const proj   = linearResolveProject_(projectKey);
  const filter = { project: { id: { eq: proj.id } } };
  if (!includeCompleted) {
    filter.state = { type: { nin: ["completed", "cancelled"] } };
  }

  const data = linearQuery_(
    'query($filter: IssueFilter) { issues(filter: $filter, orderBy: priority) { nodes { identifier title priority state { name type } dueDate cycle { number startsAt endsAt } } } }',
    { filter: filter }
  );

  const issues = data.issues.nodes;
  if (!issues.length) return "📋 " + proj.name + " にイシューはありません。";

  const pLabel = { 1: "🔴", 2: "🟠", 3: "🔵", 4: "⚪", 0: "  " };
  let msg = "📋 *" + proj.name + "* のイシュー（" + issues.length + "件）\n";
  issues.forEach(function(issue) {
    const p     = pLabel[issue.priority] || "  ";
    const state = issue.state ? issue.state.name : "不明";
    const due   = issue.dueDate ? "  期限: " + issue.dueDate : "";
    const cycle = issue.cycle   ? "  [W"    + issue.cycle.number + "]" : "";
    msg += "\n" + p + " [" + issue.identifier + "] " + issue.title;
    msg += "\n     状態: " + state + due + cycle;
  });
  return msg;
}

// ==========================================
// イシュー完了
// ==========================================
function linearCompleteIssue(issueTitle, projectKey) {
  const proj = linearResolveProject_(projectKey);

  const searchData = linearQuery_(
    'query($filter: IssueFilter) { issues(filter: $filter) { nodes { id identifier title } } }',
    { filter: { project: { id: { eq: proj.id } }, title: { containsIgnoreCase: issueTitle } } }
  );
  const issues = searchData.issues.nodes;
  if (!issues.length) return "⚠️ 「" + issueTitle + "」に一致するイシューが見つかりません。";

  const states    = linearGetStates_();
  const doneState = states.find(function(s) { return s.type === "completed"; });
  if (!doneState) throw new Error("Completedステートが見つかりません");

  const issue = issues[0];
  linearQuery_(
    'mutation($id: String!, $input: IssueUpdateInput!) { issueUpdate(id: $id, input: $input) { success } }',
    { id: issue.id, input: { stateId: doneState.id } }
  );
  return "✅ イシューを完了しました！\n[" + issue.identifier + "] " + issue.title;
}

// ==========================================
// イシュー更新
// ==========================================
function linearUpdateIssue(issueTitle, projectKey, newTitle, newPriority, newStateName) {
  const proj = linearResolveProject_(projectKey);

  const searchData = linearQuery_(
    'query($filter: IssueFilter) { issues(filter: $filter) { nodes { id identifier title } } }',
    { filter: { project: { id: { eq: proj.id } }, title: { containsIgnoreCase: issueTitle } } }
  );
  const issues = searchData.issues.nodes;
  if (!issues.length) return "⚠️ 「" + issueTitle + "」に一致するイシューが見つかりません。";

  const issue = issues[0];
  const input = {};
  if (newTitle)     input.title    = newTitle;
  if (newPriority)  input.priority = linearPriority_(newPriority);
  if (newStateName) {
    const states = linearGetStates_();
    const state  = states.find(function(s) { return s.name === newStateName; }) ||
                   states.find(function(s) { return s.name.toLowerCase().includes(newStateName.toLowerCase()); });
    if (state) input.stateId = state.id;
  }

  linearQuery_(
    'mutation($id: String!, $input: IssueUpdateInput!) { issueUpdate(id: $id, input: $input) { success } }',
    { id: issue.id, input: input }
  );
  return "📝 イシューを更新しました！\n[" + issue.identifier + "] " + (newTitle || issue.title);
}

// ==========================================
// 現在の週次サイクル サマリー
// ==========================================
function linearGetCycleSummary(projectKey) {
  const proj = linearResolveProject_(projectKey);
  const now  = new Date().toISOString();

  const data = linearQuery_(
    'query($teamId: ID!, $projId: ID!) { team(id: $teamId) { cycles(filter: { startsAt: { lte: "' + now + '" }, endsAt: { gte: "' + now + '" } }) { nodes { number startsAt endsAt issues(filter: { project: { id: { eq: $projId } } }) { nodes { identifier title priority state { name type } } } } } } }',
    { teamId: LINEAR_TEAM_ID, projId: proj.id }
  );

  const cycles = data.team.cycles.nodes;
  if (!cycles.length) return "📅 " + proj.name + " に現在進行中のサイクルはありません。";

  const cycle  = cycles[0];
  const issues = cycle.issues.nodes;
  const done   = issues.filter(function(i) { return i.state.type === "completed"; }).length;

  let msg = "🔄 *" + proj.name + "* 今週のサイクル W" + cycle.number + "\n";
  msg += "期間: " + cycle.startsAt.slice(0, 10) + " 〜 " + cycle.endsAt.slice(0, 10) + "\n";
  msg += "進捗: " + done + " / " + issues.length + "件完了\n";
  issues.forEach(function(issue) {
    const icon = issue.state.type === "completed" ? "✅" :
                 issue.state.type === "started"   ? "🔄" : "⬜";
    msg += "\n" + icon + " [" + issue.identifier + "] " + issue.title;
  });
  return msg;
}

// ==========================================
// セットアップ補助（初回実行用）
// GASエディタで関数名を選択して「実行」→ ログで確認
// ==========================================

// Step 1: チームIDを確認する
function linearSetupTeam() {
  const data = linearQuery_('query { teams { nodes { id name } } }');
  let msg = "【Linear チーム一覧】\nconfig.js の LINEAR_TEAM_ID に id を設定してください\n\n";
  data.teams.nodes.forEach(function(t) {
    msg += t.name + "\n  id: " + t.id + "\n";
  });
  Logger.log(msg);
  return msg;
}

// Step 2: プロジェクトIDを確認する（LINEAR_TEAM_ID設定後に実行）
function linearSetupProjects() {
  const data = linearQuery_('query { projects(first: 30) { nodes { id name } } }');
  let msg = "【Linear プロジェクト一覧】\nconfig.js の LINEAR_PROJECTS に id を設定してください\n\n";
  data.projects.nodes.forEach(function(p) {
    msg += p.name + "\n  id: " + p.id + "\n";
  });
  Logger.log(msg);
  return msg;
}
