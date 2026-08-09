export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // =========================================================
    // CORS
    // =========================================================
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, PATCH, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type"
    };

    // OPTIONS
    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: corsHeaders
      });
    }

    try {

      // =======================================================
      // GET /db_show
      // DB確認用
      // =======================================================
      if (
        request.method === "GET" &&
        url.pathname === "/db_show"
      ) {
        const plans = await env.DB.prepare(`
          SELECT *
          FROM study_plans
          ORDER BY study_date DESC, id DESC
        `).all();

        const tasks = await env.DB.prepare(`
          SELECT *
          FROM study_tasks
          ORDER BY plan_id, sort_order
        `).all();

        return Response.json(
          {
            success: true,
            database: "connected",
            study_plans: plans.results,
            study_tasks: tasks.results
          },
          {
            headers: corsHeaders
          }
        );
      }


      // =======================================================
      // GET /study-plan/add
      //
      // 既存方式との互換性を維持
      //
      // 例:
      //
      // /study-plan/add
      // ?study_date=2026-08-09
      // &title=TOEIC
      // &description=9月27日のTOEICに向けた学習
      // &task1=英単語
      // &task1_description=金のフレーズ
      // &task1_minutes=30
      // &task2=Part5
      // &task2_description=文法問題
      // &task2_minutes=30
      //
      // 同じstudy_dateが存在する場合は更新
      // =======================================================
      if (
        request.method === "GET" &&
        url.pathname === "/study-plan/add"
      ) {

        const data = {
          study_date:
            url.searchParams.get("study_date"),

          title:
            url.searchParams.get("title"),

          description:
            url.searchParams.get("description"),

          tasks: []
        };


        // -----------------------------------------------------
        // task1, task2, task3...
        // -----------------------------------------------------
        for (let i = 1; i <= 100; i++) {

          const taskTitle =
            url.searchParams.get(`task${i}`);

          if (!taskTitle) {
            break;
          }

          data.tasks.push({
            title: taskTitle,

            description:
              url.searchParams.get(
                `task${i}_description`
              ),

            minutes:
              url.searchParams.get(
                `task${i}_minutes`
              )
                ? Number(
                    url.searchParams.get(
                      `task${i}_minutes`
                    )
                  )
                : null
          });
        }


        return await saveStudyPlan(
          env.DB,
          data,
          corsHeaders
        );
      }


      // =======================================================
      // POST /study-plan
      //
      // ChatGPTからの正式な登録用API
      //
      // JSON:
      //
      // {
      //   "study_date": "2026-08-10",
      //   "title": "TOEIC",
      //   "description": "...",
      //   "tasks": [
      //     {
      //       "title": "英単語",
      //       "description": "金のフレーズ",
      //       "minutes": 30
      //     }
      //   ]
      // }
      // =======================================================
      if (
        request.method === "POST" &&
        url.pathname === "/study-plan"
      ) {

        const data =
          await request.json();

        return await saveStudyPlan(
          env.DB,
          data,
          corsHeaders
        );
      }


      // =======================================================
      // GET /study-plan
      // 全学習計画を取得
      // =======================================================
      if (
        request.method === "GET" &&
        url.pathname === "/study-plan"
      ) {

        const plans =
          await env.DB.prepare(`
            SELECT *
            FROM study_plans
            ORDER BY study_date DESC, id DESC
          `).all();

        return Response.json(
          {
            success: true,
            plans: plans.results
          },
          {
            headers: corsHeaders
          }
        );
      }


      // =======================================================
      // GET /study-plan/:date
      // 指定日の学習計画を取得
      // =======================================================
      if (
        request.method === "GET" &&
        url.pathname.startsWith("/study-plan/")
      ) {

        const date =
          url.pathname.split("/")[2];

        const plan =
          await env.DB.prepare(`
            SELECT *
            FROM study_plans
            WHERE study_date = ?
            ORDER BY id DESC
            LIMIT 1
          `)
            .bind(date)
            .first();

        if (!plan) {
          return Response.json(
            {
              success: false,
              message: "Study plan not found"
            },
            {
              status: 404,
              headers: corsHeaders
            }
          );
        }

        const tasks =
          await env.DB.prepare(`
            SELECT *
            FROM study_tasks
            WHERE plan_id = ?
            ORDER BY sort_order
          `)
            .bind(plan.id)
            .all();

        return Response.json(
          {
            success: true,

            plan: {
              ...plan,
              tasks: tasks.results
            }
          },
          {
            headers: corsHeaders
          }
        );
      }


      // =======================================================
      // PATCH /study-task/:id
      //
      // チェック状態を変更
      // =======================================================
      if (
        request.method === "PATCH" &&
        url.pathname.startsWith("/study-task/")
      ) {

        const taskId =
          url.pathname.split("/")[2];

        const data =
          await request.json();

        const completed =
          data.completed ? 1 : 0;

        const result =
          await env.DB.prepare(`
            UPDATE study_tasks
            SET
              completed = ?,
              updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
          `)
            .bind(
              completed,
              taskId
            )
            .run();

        if (
          result.meta.changes === 0
        ) {
          return Response.json(
            {
              success: false,
              message: "Task not found"
            },
            {
              status: 404,
              headers: corsHeaders
            }
          );
        }

        return Response.json(
          {
            success: true,
            message: "Task updated!",
            task_id: Number(taskId),
            completed: completed === 1
          },
          {
            headers: corsHeaders
          }
        );
      }


      // =======================================================
      // GET /checklist
      //
      // 最新の学習計画をチェック表として表示
      //
      // 重要:
      // 「今日の日付」ではなく、
      // DBに登録された最新のstudy_dateを使用する。
      //
      // そのため、
      //
      // 8/9 デイリーブリーフィング
      //      ↓
      // 8/9の計画
      //
      // 8/10 デイリーブリーフィング
      //      ↓
      // 8/10の計画
      //
      // と自動的に切り替わる。
      // =======================================================
      if (
        request.method === "GET" &&
        url.pathname === "/checklist"
      ) {

        const plan =
          await env.DB.prepare(`
            SELECT *
            FROM study_plans
            ORDER BY study_date DESC, id DESC
            LIMIT 1
          `)
            .first();

        if (!plan) {

          return new Response(
            createNoPlanHtml(),
            {
              headers: {
                "Content-Type":
                  "text/html; charset=UTF-8"
              }
            }
          );
        }

        return await createChecklistResponse(
          env.DB,
          plan
        );
      }


      // =======================================================
      // GET /checklist/:date
      //
      // 指定日のチェック表
      //
      // 例:
      // /checklist/2026-08-09
      // =======================================================
      if (
        request.method === "GET" &&
        url.pathname.startsWith("/checklist/")
      ) {

        const date =
          url.pathname.split("/")[2];

        const plan =
          await env.DB.prepare(`
            SELECT *
            FROM study_plans
            WHERE study_date = ?
            ORDER BY id DESC
            LIMIT 1
          `)
            .bind(date)
            .first();

        if (!plan) {

          return new Response(
            createNoPlanHtml(date),
            {
              headers: {
                "Content-Type":
                  "text/html; charset=UTF-8"
              }
            }
          );
        }

        return await createChecklistResponse(
          env.DB,
          plan
        );
      }


      // =======================================================
      // 404
      // =======================================================
      return Response.json(
        {
          success: false,
          message: "Not Found"
        },
        {
          status: 404,
          headers: corsHeaders
        }
      );


    } catch (error) {

      console.error(error);

      return Response.json(
        {
          success: false,
          message: error.message
        },
        {
          status: 500,
          headers: corsHeaders
        }
      );
    }
  }
};


// =============================================================
// 学習計画保存
//
// 同じstudy_dateが存在する場合:
//   → 既存計画を更新
//   → タスクを更新
//
// 存在しない場合:
//   → 新規登録
// =============================================================
async function saveStudyPlan(
  DB,
  data,
  corsHeaders
) {

  // -----------------------------------------------------------
  // 入力チェック
  // -----------------------------------------------------------
  if (
    !data.study_date ||
    !data.title
  ) {

    return Response.json(
      {
        success: false,
        message:
          "study_date and title are required"
      },
      {
        status: 400,
        headers: corsHeaders
      }
    );
  }

  // -----------------------------------------------------------
  // tasksの正規化
  // -----------------------------------------------------------
  const tasks =
    Array.isArray(data.tasks)
      ? data.tasks
      : [];

  // -----------------------------------------------------------
  // 既存計画を検索
  // -----------------------------------------------------------
  const existingPlan =
    await DB.prepare(`
      SELECT *
      FROM study_plans
      WHERE study_date = ?
      ORDER BY id DESC
      LIMIT 1
    `)
      .bind(data.study_date)
      .first();

  let planId;

  // ===========================================================
  // 既存計画あり
  // ===========================================================
  if (existingPlan) {

    planId =
      existingPlan.id;


    // ---------------------------------------------------------
    // 計画更新
    // ---------------------------------------------------------
    await DB.prepare(`
      UPDATE study_plans
      SET
        title = ?,
        description = ?
      WHERE id = ?
    `)
      .bind(
        data.title,
        data.description ?? null,
        planId
      )
      .run();


    // ---------------------------------------------------------
    // 既存タスク削除
    //
    // デイリーブリーフィングが再実行された場合、
    // 新しい学習計画に置き換える。
    // ---------------------------------------------------------
    await DB.prepare(`
      DELETE FROM study_tasks
      WHERE plan_id = ?
    `)
      .bind(planId)
      .run();

  }

  // ===========================================================
  // 新規計画
  // ===========================================================
  else {

    const result =
      await DB.prepare(`
        INSERT INTO study_plans (
          study_date,
          title,
          description
        )
        VALUES (?, ?, ?)
      `)
        .bind(
          data.study_date,
          data.title,
          data.description ?? null
        )
        .run();

    planId =
      result.meta.last_row_id;
  }

  // ===========================================================
  // タスク登録
  // ===========================================================
  for (
    let i = 0;
    i < tasks.length;
    i++
  ) {

    const task =
      tasks[i];

    if (!task.title) {
      continue;
    }

    await DB.prepare(`
      INSERT INTO study_tasks (
        plan_id,
        title,
        description,
        minutes,
        completed,
        sort_order
      )
      VALUES (?, ?, ?, ?, ?, ?)
    `)
      .bind(
        planId,
        task.title,
        task.description ?? null,
        task.minutes ?? null,
        0,
        i + 1
      )
      .run();
  }

  // ===========================================================
  // 登録結果
  // ===========================================================
  return Response.json(
    {
      success: true,

      message:
        existingPlan
          ? "Study plan updated!"
          : "Study plan saved!",

      plan_id: planId,

      study_date:
        data.study_date,

      task_count:
        tasks.length,

      updated:
        Boolean(existingPlan)
    },
    {
      headers: corsHeaders
    }
  );
}


// =============================================================
// チェック表レスポンス
// =============================================================
async function createChecklistResponse(
  DB,
  plan
) {

  const tasks =
    await DB.prepare(`
      SELECT *
      FROM study_tasks
      WHERE plan_id = ?
      ORDER BY sort_order
    `)
      .bind(plan.id)
      .all();

  const taskResults =
    tasks.results;

  const completedCount =
    taskResults.filter(
      task => task.completed
    ).length;

  const taskList =
    taskResults
      .map(task => {

        const checked =
          task.completed
            ? "checked"
            : "";

        const completedClass =
          task.completed
            ? "completed"
            : "";

        // =====================================================
        // 学習時間タイマー
        // =====================================================
        const timer =
          task.minutes != null
            ? `
              <div
                class="task-timer"
                data-task-id="${task.id}"
                data-minutes="${task.minutes}"
              >

                <div
                  class="timer-display"
                  id="timer-${task.id}"
                >
                  ${String(task.minutes).padStart(2, "0")}:00
                </div>

                <div class="timer-buttons">

                  <button
                    type="button"
                    class="timer-button start-button"
                    onclick="
                      startTimer(
                        ${task.id},
                        ${task.minutes}
                      )
                    "
                  >
                    ▶ 開始
                  </button>

                  <button
                    type="button"
                    class="timer-button pause-button"
                    onclick="
                      pauseTimer(
                        ${task.id}
                      )
                    "
                  >
                    ⏸ 一時停止
                  </button>

                  <button
                    type="button"
                    class="timer-button reset-button"
                    onclick="
                      resetTimer(
                        ${task.id},
                        ${task.minutes}
                      )
                    "
                  >
                    ↻ リセット
                  </button>

                </div>

              </div>
            `
            : "";

        const description =
          task.description
            ? `
              <div class="task-description">
                ${escapeHtml(
                  task.description
                )}
              </div>
            `
            : "";

        return `
          <div
            class="task"
            data-task-container="${task.id}"
          >

            <label class="task-main">

              <input
                type="checkbox"
                ${checked}
                data-task-id="${task.id}"
                onchange="
                  updateTask(
                    ${task.id},
                    this.checked
                  )
                "
              >

              <div class="task-content">

                <div
                  class="task-title ${completedClass}"
                  id="task-title-${task.id}"
                >
                  ${escapeHtml(
                    task.title
                  )}
                </div>

                ${description}

              </div>

            </label>

            ${timer}

          </div>
        `;
      })
      .join("");


  return new Response(
    createChecklistHtml({
      studyDate:
        plan.study_date,

      title:
        plan.title,

      description:
        plan.description,

      taskList,

      completedCount,

      totalCount:
        taskResults.length
    }),
    {
      headers: {
        "Content-Type":
          "text/html; charset=UTF-8"
      }
    }
  );
}


// =============================================================
// HTMLエスケープ
// =============================================================
function escapeHtml(value) {

  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}


// =============================================================
// 学習計画がない場合
// =============================================================
function createNoPlanHtml(
  date = null
) {

  return `
<!DOCTYPE html>
<html lang="ja">

<head>

  <meta charset="UTF-8">

  <meta
    name="viewport"
    content="width=device-width, initial-scale=1.0"
  >

  <title>学習チェック表</title>

</head>

<body>

  <h1>学習チェック表</h1>

  ${
    date
      ? `<p>${escapeHtml(date)}</p>`
      : ""
  }

  <p>
    学習計画がありません。
  </p>

</body>

</html>
  `;
}


// =============================================================
// チェック表HTML
// =============================================================
function createChecklistHtml({
  studyDate,
  title,
  description,
  taskList,
  completedCount,
  totalCount
}) {

  return `
<!DOCTYPE html>
<html lang="ja">

<head>

  <meta charset="UTF-8">

  <meta
    name="viewport"
    content="width=device-width, initial-scale=1.0"
  >

  <title>
    ${escapeHtml(title)}
  </title>


  <style>

    /* ========================================================
       全体
       ======================================================== */

    * {
      box-sizing: border-box;
    }

    body {

      margin: 0;
      padding: 20px;

      font-family:
        -apple-system,
        BlinkMacSystemFont,
        "Segoe UI",
        sans-serif;

      background: #f7f7f7;
      color: #222;

    }


    /* ========================================================
       タイトル
       ======================================================== */

    h1 {

      margin: 0 0 8px 0;

      font-size: 28px;

    }


    .date {

      color: #666;

      margin-bottom: 16px;

    }


    .description {

      background: #fff;

      padding: 14px;

      border-radius: 10px;

      margin-bottom: 20px;

      line-height: 1.6;

    }


    /* ========================================================
       進捗
       ======================================================== */

    .progress {

      font-weight: bold;

      margin-bottom: 8px;

    }


    .progress-bar {

      width: 100%;

      height: 12px;

      background: #ddd;

      border-radius: 10px;

      overflow: hidden;

      margin-bottom: 20px;

    }


    .progress-value {

      width: 0%;

      height: 100%;

      background: #4caf50;

      transition:
        width 0.3s ease;

    }


    /* ========================================================
       タスク
       ======================================================== */

    #tasks {

      display: flex;

      flex-direction: column;

      gap: 12px;

    }


    .task {

      background: #fff;

      border-radius: 12px;

      padding: 16px;

      box-shadow:
        0 2px 6px
        rgba(0, 0, 0, 0.08);

    }


    .task-main {

      display: flex;

      align-items: flex-start;

      gap: 12px;

      cursor: pointer;

    }


    .task-main input {

      width: 22px;

      height: 22px;

      flex-shrink: 0;

      margin-top: 2px;

      cursor: pointer;

    }


    .task-content {

      flex: 1;

      min-width: 0;

    }


    .task-title {

      font-size: 18px;

      font-weight: bold;

      line-height: 1.4;

    }


    .task-title.completed {

      text-decoration: line-through;

      color: #999;

    }


    .task-description {

      margin-top: 5px;

      color: #666;

      line-height: 1.5;

      font-size: 14px;

    }


    /* ========================================================
       タイマー
       ======================================================== */

    .task-timer {

      margin-top: 14px;

      padding: 12px;

      background: #f3f4f6;

      border-radius: 10px;

    }


    .timer-display {

      text-align: center;

      font-family: monospace;

      font-size: 32px;

      font-weight: bold;

      letter-spacing: 1px;

      margin-bottom: 10px;

    }


    .timer-display.running {

      color: #1976d2;

    }


    .timer-display.paused {

      color: #777;

    }


    .timer-display.timer-finished {

      color: #d32f2f;

    }


    .timer-buttons {

      display: flex;

      justify-content: center;

      gap: 7px;

      flex-wrap: wrap;

    }


    .timer-button {

      border: 1px solid #ccc;

      background: #fff;

      border-radius: 7px;

      padding: 8px 12px;

      font-size: 14px;

      cursor: pointer;

      transition:
        background 0.15s ease;

    }


    .timer-button:hover {

      background: #e9e9e9;

    }


    .timer-button:active {

      transform: scale(0.97);

    }


    .start-button {

      border-color: #81c784;

    }


    .pause-button {

      border-color: #ffb74d;

    }


    .reset-button {

      border-color: #90caf9;

    }


    /* ========================================================
       完了メッセージ
       ======================================================== */

    .complete-message {

      display: none;

      margin-top: 20px;

      padding: 16px;

      text-align: center;

      background: #e8f5e9;

      border-radius: 10px;

      font-weight: bold;

    }


    /* ========================================================
       スマートフォン
       ======================================================== */

    @media (max-width: 600px) {

      body {

        padding: 14px;

      }


      h1 {

        font-size: 24px;

      }


      .task {

        padding: 14px;

      }


      .timer-display {

        font-size: 28px;

      }


      .timer-button {

        flex: 1;

        min-width: 90px;

      }

    }

  </style>

</head>


<body>

  <!-- ========================================================
       タイトル
       ======================================================== -->

  <h1>
    ${escapeHtml(title)}
  </h1>


  <div class="date">
    ${escapeHtml(studyDate)}
  </div>


  ${
    description
      ? `
        <div class="description">
          ${escapeHtml(description)}
        </div>
      `
      : ""
  }


  <!-- ========================================================
       進捗
       ======================================================== -->

  <div
    class="progress"
    id="progress"
  >

    進捗：

    <span id="completedCount">
      ${completedCount}
    </span>

    /

    <span id="totalCount">
      ${totalCount}
    </span>

  </div>


  <div class="progress-bar">

    <div
      class="progress-value"
      id="progressValue"
    ></div>

  </div>


  <!-- ========================================================
       タスク一覧
       ======================================================== -->

  <div id="tasks">

    ${taskList}

  </div>


  <!-- ========================================================
       完了メッセージ
       ======================================================== -->

  <div
    class="complete-message"
    id="completeMessage"
  >
    🎉 今日の学習完了！
  </div>


  <script>

    // ========================================================
    // タイマー管理
    //
    // taskId:
    // {
    //   remaining: 残り秒数,
    //   endTime: 終了予定時刻(ms),
    //   interval: setInterval ID,
    //   running: true / false
    // }
    // ========================================================

    const timers = {};


    // ========================================================
    // localStorageキー
    //
    // study_dateごとに保存する。
    //
    // これにより、別の日の学習計画と
    // タイマー状態が混ざらない。
    // ========================================================

    const TIMER_STORAGE_KEY =
      "toeic_study_timers_${escapeHtml(studyDate)}";


    // ========================================================
    // localStorageからタイマー状態を読み込む
    // ========================================================

    function loadTimerStates() {

      try {

        const saved =
          localStorage.getItem(
            TIMER_STORAGE_KEY
          );

        if (!saved) {
          return {};
        }

        return JSON.parse(saved);

      } catch (error) {

        console.error(
          "Failed to load timer states:",
          error
        );

        return {};
      }
    }


    // ========================================================
    // localStorageへタイマー状態を保存
    // ========================================================

    function saveTimerStates() {

      try {

        const data = {};

        Object.keys(timers).forEach(
          taskId => {

            const timer =
              timers[taskId];

            data[taskId] = {

              remaining:
                timer.remaining,

              endTime:
                timer.endTime,

              running:
                Boolean(
                  timer.running
                )

            };

          }
        );

        localStorage.setItem(
          TIMER_STORAGE_KEY,
          JSON.stringify(data)
        );

      } catch (error) {

        console.error(
          "Failed to save timer states:",
          error
        );

      }
    }


    // ========================================================
    // 秒数を MM:SS に変換
    // ========================================================

    function formatTime(seconds) {

      seconds =
        Math.max(
          0,
          Math.floor(seconds)
        );

      const minutes =
        Math.floor(
          seconds / 60
        );

      const remainingSeconds =
        seconds % 60;

      return (
        String(minutes).padStart(2, "0")
        +
        ":"
        +
        String(
          remainingSeconds
        ).padStart(2, "0")
      );
    }


    // ========================================================
    // タイマー表示更新
    // ========================================================

    function updateTimerDisplay(
      taskId,
      seconds
    ) {

      const display =
        document.getElementById(
          "timer-" + taskId
        );

      if (!display) {
        return;
      }

      display.textContent =
        formatTime(seconds);

    }


    // ========================================================
    // タイマー状態のCSS更新
    // ========================================================

    function updateTimerClass(
      taskId
    ) {

      const display =
        document.getElementById(
          "timer-" + taskId
        );

      if (!display) {
        return;
      }

      display.classList.remove(
        "running",
        "paused",
        "timer-finished"
      );


      const timer =
        timers[taskId];

      if (!timer) {
        return;
      }


      if (
        timer.remaining <= 0
      ) {

        display.classList.add(
          "timer-finished"
        );

      } else if (
        timer.running
      ) {

        display.classList.add(
          "running"
        );

      } else {

        display.classList.add(
          "paused"
        );

      }

    }


    // ========================================================
    // タイマー開始
    // ========================================================

    function startTimer(
      taskId,
      initialMinutes
    ) {

      // ------------------------------------------------------
      // 初回
      // ------------------------------------------------------

      if (!timers[taskId]) {

        timers[taskId] = {

          remaining:
            initialMinutes * 60,

          endTime:
            null,

          interval:
            null,

          running:
            false

        };

      }


      const timer =
        timers[taskId];


      // ------------------------------------------------------
      // すでに実行中なら何もしない
      // ------------------------------------------------------

      if (timer.running) {
        return;
      }


      // ------------------------------------------------------
      // 0秒の場合は開始しない
      // ------------------------------------------------------

      if (
        timer.remaining <= 0
      ) {
        return;
      }


      // ------------------------------------------------------
      // 終了予定時刻を計算
      //
      // Date.now()を使うことで、
      // setIntervalが多少ずれても
      // 実時間に合わせてカウントできる。
      // ------------------------------------------------------

      timer.endTime =
        Date.now()
        +
        timer.remaining * 1000;


      timer.running =
        true;


      updateTimerClass(taskId);


      // ------------------------------------------------------
      // 既存intervalがあれば停止
      // ------------------------------------------------------

      if (timer.interval) {

        clearInterval(
          timer.interval
        );

      }


      // ------------------------------------------------------
      // タイマー処理
      // ------------------------------------------------------

      timer.interval =
        setInterval(
          () => {

            const remaining =
              Math.ceil(
                (
                  timer.endTime
                  -
                  Date.now()
                ) / 1000
              );


            timer.remaining =
              Math.max(
                0,
                remaining
              );


            updateTimerDisplay(
              taskId,
              timer.remaining
            );


            // ------------------------------------------------
            // タイマー終了
            // ------------------------------------------------

            if (
              timer.remaining <= 0
            ) {

              finishTimer(
                taskId
              );

            }

          },
          250
        );


      saveTimerStates();

    }


    // ========================================================
    // タイマー一時停止
    // ========================================================

    function pauseTimer(
      taskId
    ) {

      const timer =
        timers[taskId];

      if (!timer) {
        return;
      }


      if (
        !timer.running
      ) {
        return;
      }


      // ------------------------------------------------------
      // 現在の残り時間を計算
      // ------------------------------------------------------

      timer.remaining =
        Math.max(
          0,
          Math.ceil(
            (
              timer.endTime
              -
              Date.now()
            ) / 1000
          )
        );


      // ------------------------------------------------------
      // 停止
      // ------------------------------------------------------

      if (timer.interval) {

        clearInterval(
          timer.interval
        );

      }


      timer.interval =
        null;

      timer.endTime =
        null;

      timer.running =
        false;


      updateTimerDisplay(
        taskId,
        timer.remaining
      );

      updateTimerClass(
        taskId
      );

      saveTimerStates();

    }


    // ========================================================
    // タイマーリセット
    // ========================================================

    function resetTimer(
      taskId,
      initialMinutes
    ) {

      const oldTimer =
        timers[taskId];


      // ------------------------------------------------------
      // 現在のタイマー停止
      // ------------------------------------------------------

      if (
        oldTimer?.interval
      ) {

        clearInterval(
          oldTimer.interval
        );

      }


      // ------------------------------------------------------
      // 初期状態へ戻す
      // ------------------------------------------------------

      timers[taskId] = {

        remaining:
          initialMinutes * 60,

        endTime:
          null,

        interval:
          null,

        running:
          false

      };


      updateTimerDisplay(
        taskId,
        initialMinutes * 60
      );

      updateTimerClass(
        taskId
      );

      saveTimerStates();

    }


    // ========================================================
    // タイマー終了
    // ========================================================

    function finishTimer(
      taskId
    ) {

      const timer =
        timers[taskId];

      if (!timer) {
        return;
      }


      if (timer.interval) {

        clearInterval(
          timer.interval
        );

      }


      timer.interval =
        null;

      timer.endTime =
        null;

      timer.remaining =
        0;

      timer.running =
        false;


      updateTimerDisplay(
        taskId,
        0
      );

      updateTimerClass(
        taskId
      );


      saveTimerStates();


      // ------------------------------------------------------
      // 完了通知
      // ------------------------------------------------------

      try {

        if (
          "Notification" in window &&
          Notification.permission ===
            "granted"
        ) {

          new Notification(
            "学習時間終了",
            {
              body:
                "設定した学習時間が終了しました。"
            }
          );

        }

      } catch (error) {

        console.error(
          "Notification error:",
          error
        );

      }


      // ------------------------------------------------------
      // 通知が利用できない場合はalert
      // ------------------------------------------------------

      if (
        !(
          "Notification" in window
        ) ||
        Notification.permission !==
          "granted"
      ) {

        alert(
          "⏰ 学習時間が終了しました！"
        );

      }

    }


    // ========================================================
    // 保存されているタイマー状態を復元
    // ========================================================

    function restoreTimerStates() {

      const saved =
        loadTimerStates();


      document
        .querySelectorAll(
          ".task-timer"
        )
        .forEach(
          timerElement => {

            const taskId =
              timerElement.dataset.taskId;

            const minutes =
              Number(
                timerElement.dataset.minutes
              );

            const savedTimer =
              saved[taskId];


            // ------------------------------------------------
            // 保存データがない場合
            // ------------------------------------------------

            if (!savedTimer) {

              timers[taskId] = {

                remaining:
                  minutes * 60,

                endTime:
                  null,

                interval:
                  null,

                running:
                  false

              };

              updateTimerDisplay(
                taskId,
                minutes * 60
              );

              updateTimerClass(
                taskId
              );

              return;

            }


            // ------------------------------------------------
            // 実行中だった場合
            //
            // ページ更新中に時間が経過しているので、
            // 現在時刻から残り時間を再計算する。
            // ------------------------------------------------

            let remaining =
              Number(
                savedTimer.remaining
              );


            if (
              savedTimer.running &&
              savedTimer.endTime
            ) {

              remaining =
                Math.ceil(
                  (
                    Number(
                      savedTimer.endTime
                    )
                    -
                    Date.now()
                  ) / 1000
                );

            }


            remaining =
              Math.max(
                0,
                remaining
              );


            timers[taskId] = {

              remaining:
                remaining,

              endTime:
                null,

              interval:
                null,

              running:
                false

            };


            updateTimerDisplay(
              taskId,
              remaining
            );


            // ------------------------------------------------
            // ページ更新中に終了していた場合
            // ------------------------------------------------

            if (
              remaining <= 0
            ) {

              timers[taskId].remaining =
                0;

              updateTimerClass(
                taskId
              );

              return;

            }


            // ------------------------------------------------
            // 更新前に実行中だった場合
            // ------------------------------------------------

            if (
              savedTimer.running
            ) {

              startTimer(
                taskId,
                minutes
              );

            } else {

              updateTimerClass(
                taskId
              );

            }

          }
        );

    }


    // ========================================================
    // タスクチェック状態更新
    //
    // 既存APIをそのまま使用
    // ========================================================

    async function updateTask(
      taskId,
      completed
    ) {

      try {

        const response =
          await fetch(
            "/study-task/" + taskId,
            {

              method: "PATCH",

              headers: {
                "Content-Type":
                  "application/json"
              },

              body:
                JSON.stringify({
                  completed:
                    completed
                })

            }
          );


        const result =
          await response.json();


        if (
          !result.success
        ) {

          throw new Error(
            result.message ||
            "Task update failed"
          );

        }


        // ----------------------------------------------------
        // 見た目更新
        // ----------------------------------------------------

        const checkbox =
          document.querySelector(
            'input[data-task-id="' +
            taskId +
            '"]'
          );


        const title =
          document.getElementById(
            "task-title-" +
            taskId
          );


        if (
          checkbox &&
          title
        ) {

          if (
            checkbox.checked
          ) {

            title.classList.add(
              "completed"
            );

          } else {

            title.classList.remove(
              "completed"
            );

          }

        }


        updateProgress();


      } catch (error) {

        console.error(
          error
        );

        alert(
          "チェック状態の更新に失敗しました。"
        );

      }

    }


    // ========================================================
    // 進捗更新
    // ========================================================

    function updateProgress() {

      const checkboxes =
        document.querySelectorAll(
          'input[type="checkbox"][data-task-id]'
        );


      const completed =
        Array.from(
          checkboxes
        )
          .filter(
            checkbox =>
              checkbox.checked
          )
          .length;


      const total =
        checkboxes.length;


      const completedCount =
        document.getElementById(
          "completedCount"
        );


      const totalCount =
        document.getElementById(
          "totalCount"
        );


      const progressValue =
        document.getElementById(
          "progressValue"
        );


      const completeMessage =
        document.getElementById(
          "completeMessage"
        );


      if (
        completedCount
      ) {

        completedCount.textContent =
          completed;

      }


      if (
        totalCount
      ) {

        totalCount.textContent =
          total;

      }


      if (
        progressValue
      ) {

        const percentage =
          total > 0
            ? (
                completed /
                total
              ) * 100
            : 0;

        progressValue.style.width =
          percentage + "%";

      }


      if (
        completeMessage
      ) {

        if (
          total > 0 &&
          completed === total
        ) {

          completeMessage.style.display =
            "block";

        } else {

          completeMessage.style.display =
            "none";

        }

      }

    }


    // ========================================================
    // 通知許可
    //
    // ユーザーがページを操作した際に許可を要求する。
    // ========================================================

    document.addEventListener(
      "click",
      () => {

        if (
          "Notification" in window &&
          Notification.permission ===
            "default"
        ) {

          Notification.requestPermission()
            .catch(
              () => {}
            );

        }

      },
      {
        once: true
      }
    );


    // ========================================================
    // ページ読み込み時
    // ========================================================

    document.addEventListener(
      "DOMContentLoaded",
      () => {

        restoreTimerStates();

        updateProgress();

      }
    );

  </script>

</body>

</html>
  `;
}