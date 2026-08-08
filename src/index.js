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

        const minutes =
          task.minutes != null
            ? `
              <span class="minutes">
                ${task.minutes}分
              </span>
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
          <div class="task">

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

              <div>

                <div
                  class="task-title ${completedClass}"
                >
                  ${escapeHtml(
                    task.title
                  )}
                </div>

                ${description}

              </div>

            </label>

            ${minutes}

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

  <style>

    body {
      font-family:
        -apple-system,
        BlinkMacSystemFont,
        "Segoe UI",
        sans-serif;

      max-width: 600px;

      margin: 0 auto;

      padding: 30px 20px;

      background: #f5f5f5;
    }

    .container {
      background: white;

      padding: 25px;

      border-radius: 16px;

      box-shadow:
        0 4px 15px
        rgba(0, 0, 0, 0.08);
    }

  </style>

</head>

<body>

  <div class="container">

    <h1>学習チェック表</h1>

    ${
      date
        ? `<p>${escapeHtml(date)}</p>`
        : ""
    }

    <p>
      学習計画がありません。
    </p>

  </div>

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

  <title>学習チェック表</title>


  <style>

    * {
      box-sizing: border-box;
    }


    body {

      font-family:
        -apple-system,
        BlinkMacSystemFont,
        "Segoe UI",
        sans-serif;

      max-width: 600px;

      margin: 0 auto;

      padding: 20px;

      background: #f5f5f5;

      color: #222;
    }


    .container {

      background: white;

      padding: 25px;

      border-radius: 16px;

      box-shadow:
        0 4px 15px
        rgba(0, 0, 0, 0.08);
    }


    h1 {

      margin:
        0 0 5px 0;

      font-size: 28px;
    }


    .date {

      color: #777;

      margin-bottom: 20px;
    }


    .description {

      padding: 15px;

      margin-bottom: 20px;

      background: #f7f7f7;

      border-radius: 10px;

      line-height: 1.6;
    }


    .progress {

      margin-bottom: 15px;

      font-weight: bold;

      font-size: 18px;
    }


    .progress-bar {

      height: 10px;

      background: #e5e5e5;

      border-radius: 5px;

      overflow: hidden;

      margin-bottom: 20px;
    }


    .progress-value {

      height: 100%;

      background: #4caf50;

      width: 0%;

      transition:
        width 0.2s ease;
    }


    .task {

      display: flex;

      justify-content:
        space-between;

      align-items:
        center;

      gap: 10px;

      padding: 16px 5px;

      border-bottom:
        1px solid #eee;
    }


    .task-main {

      display: flex;

      align-items:
        center;

      gap: 12px;

      cursor: pointer;

      flex: 1;
    }


    input[type="checkbox"] {

      width: 22px;

      height: 22px;

      cursor: pointer;

      flex-shrink: 0;
    }


    .task-title {

      font-size: 17px;

      transition:
        color 0.2s;
    }


    .task-description {

      color: #777;

      font-size: 14px;

      margin-top: 4px;
    }


    .completed {

      text-decoration:
        line-through;

      color: #999;
    }


    .minutes {

      color: #777;

      font-size: 14px;

      white-space:
        nowrap;
    }


    .complete-message {

      display: none;

      margin-top: 20px;

      padding: 15px;

      text-align: center;

      border-radius: 10px;

      background: #e8f5e9;

      color: #2e7d32;

      font-weight: bold;
    }

  </style>

</head>


<body>

  <div class="container">

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


    <div id="tasks">

      ${taskList}

    </div>


    <div
      class="complete-message"
      id="completeMessage"
    >
      🎉 今日の学習完了！
    </div>

  </div>


  <script>

    // =========================================================
    // タスク更新
    // =========================================================
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

              body: JSON.stringify({
                completed:
                  completed
              })
            }
          );


        const data =
          await response.json();


        if (!data.success) {

          alert(
            "タスクの更新に失敗しました。"
          );

          location.reload();

          return;
        }


        // -----------------------------------------------------
        // 見た目を更新
        // -----------------------------------------------------
        const checkbox =
          document.querySelector(
            'input[data-task-id="' +
            taskId +
            '"]'
          );


        if (checkbox) {

          const title =
            checkbox
              .parentElement
              .querySelector(
                ".task-title"
              );


          if (title) {

            if (completed) {

              title.classList.add(
                "completed"
              );

            } else {

              title.classList.remove(
                "completed"
              );
            }
          }
        }


        updateProgress();


      } catch (error) {

        console.error(error);

        alert(
          "通信エラーが発生しました。"
        );

        location.reload();
      }
    }


    // =========================================================
    // 進捗更新
    // =========================================================
    function updateProgress() {

      const checkboxes =
        document.querySelectorAll(
          '#tasks input[type="checkbox"]'
        );


      let completed = 0;


      checkboxes.forEach(
        checkbox => {

          if (checkbox.checked) {
            completed++;
          }

        }
      );


      const total =
        checkboxes.length;


      document.getElementById(
        "completedCount"
      ).textContent =
        completed;


      const percentage =
        total > 0
          ? (completed / total) * 100
          : 0;


      document.getElementById(
        "progressValue"
      ).style.width =
        percentage + "%";


      const completeMessage =
        document.getElementById(
          "completeMessage"
        );


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


    // =========================================================
    // 初期表示
    // =========================================================
    updateProgress();

  </script>

</body>

</html>
`;
}
