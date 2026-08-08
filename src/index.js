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
          ORDER BY study_date DESC
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
      // GETパラメータから学習計画を登録
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
      // =======================================================
      if (
        request.method === "GET" &&
        url.pathname === "/study-plan/add"
      ) {

        const studyDate =
          url.searchParams.get("study_date");

        const title =
          url.searchParams.get("title");

        const description =
          url.searchParams.get("description");

        // 必須項目
        if (!studyDate || !title) {
          return Response.json(
            {
              success: false,
              message: "study_date and title are required"
            },
            {
              status: 400,
              headers: corsHeaders
            }
          );
        }

        // -----------------------------------------------------
        // 学習計画を登録
        // -----------------------------------------------------
        const planResult = await env.DB.prepare(`
          INSERT INTO study_plans (
            study_date,
            title,
            description
          )
          VALUES (?, ?, ?)
        `)
          .bind(
            studyDate,
            title,
            description ?? null
          )
          .run();

        const planId =
          planResult.meta.last_row_id;

        // -----------------------------------------------------
        // タスク登録
        // task1, task2, task3...
        // -----------------------------------------------------
        let taskCount = 0;

        for (let i = 1; i <= 100; i++) {

          const taskTitle =
            url.searchParams.get(`task${i}`);

          // 連番が途切れたら終了
          if (!taskTitle) {
            break;
          }

          const taskDescription =
            url.searchParams.get(
              `task${i}_description`
            );

          const taskMinutes =
            url.searchParams.get(
              `task${i}_minutes`
            );

          await env.DB.prepare(`
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
              taskTitle,
              taskDescription ?? null,
              taskMinutes
                ? Number(taskMinutes)
                : null,
              0,
              i
            )
            .run();

          taskCount++;
        }

        return Response.json(
          {
            success: true,
            message: "Study plan saved!",
            plan_id: planId,
            task_count: taskCount
          },
          {
            headers: corsHeaders
          }
        );
      }


      // =======================================================
      // POST /study-plan
      // JSONから学習計画を登録
      //
      // {
      //   "study_date": "2026-08-09",
      //   "title": "TOEIC",
      //   "description": "今日の勉強",
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

        // -----------------------------------------------------
        // 学習計画登録
        // -----------------------------------------------------
        const planResult = await env.DB.prepare(`
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

        const planId =
          planResult.meta.last_row_id;

        // -----------------------------------------------------
        // タスク登録
        // -----------------------------------------------------
        if (Array.isArray(data.tasks)) {

          for (
            let i = 0;
            i < data.tasks.length;
            i++
          ) {

            const task =
              data.tasks[i];

            await env.DB.prepare(`
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
        }

        return Response.json(
          {
            success: true,
            message: "Study plan saved!",
            plan_id: planId
          },
          {
            headers: corsHeaders
          }
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
            ORDER BY study_date DESC
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
      // タスク完了状態を変更
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
      // 今日の学習チェック表
      // =======================================================
      if (
        request.method === "GET" &&
        url.pathname === "/checklist"
      ) {

        // -----------------------------------------------------
        // 日本時間で今日の日付を取得
        // -----------------------------------------------------
        const parts =
          new Intl.DateTimeFormat(
            "ja-JP",
            {
              timeZone: "Asia/Tokyo",
              year: "numeric",
              month: "2-digit",
              day: "2-digit"
            }
          ).formatToParts(new Date());

        const year =
          parts.find(
            x => x.type === "year"
          ).value;

        const month =
          parts.find(
            x => x.type === "month"
          ).value;

        const day =
          parts.find(
            x => x.type === "day"
          ).value;

        const studyDate =
          `${year}-${month}-${day}`;


        // -----------------------------------------------------
        // 今日の学習計画
        // -----------------------------------------------------
        const plan =
          await env.DB.prepare(`
            SELECT *
            FROM study_plans
            WHERE study_date = ?
            ORDER BY id DESC
            LIMIT 1
          `)
            .bind(studyDate)
            .first();


        // -----------------------------------------------------
        // 今日の計画が存在しない
        // -----------------------------------------------------
        if (!plan) {

          return new Response(
            createNoPlanHtml(studyDate),
            {
              headers: {
                "Content-Type":
                  "text/html; charset=UTF-8"
              }
            }
          );
        }


        // -----------------------------------------------------
        // タスク取得
        // -----------------------------------------------------
        const tasks =
          await env.DB.prepare(`
            SELECT *
            FROM study_tasks
            WHERE plan_id = ?
            ORDER BY sort_order
          `)
            .bind(plan.id)
            .all();

        const taskResults =
          tasks.results;


        // -----------------------------------------------------
        // タスクHTML
        // -----------------------------------------------------
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
                  ? `<span class="minutes">
                       ${task.minutes}分
                     </span>`
                  : "";

              const description =
                task.description
                  ? `<div class="task-description">
                       ${escapeHtml(
                         task.description
                       )}
                     </div>`
                  : "";

              return `
                <div class="task">

                  <label class="task-main">

                    <input
                      type="checkbox"
                      ${checked}
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


        // -----------------------------------------------------
        // 初期進捗
        // -----------------------------------------------------
        const completedCount =
          taskResults.filter(
            task => task.completed
          ).length;


        // -----------------------------------------------------
        // HTML
        // -----------------------------------------------------
        return new Response(
          createChecklistHtml({
            studyDate,
            title: plan.title,
            description: plan.description,
            taskList,
            completedCount,
            totalCount: taskResults.length
          }),
          {
            headers: {
              "Content-Type":
                "text/html; charset=UTF-8"
            }
          }
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

      // =======================================================
      // エラー処理
      // =======================================================
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
// 学習計画がない場合のHTML
// =============================================================
function createNoPlanHtml(studyDate) {

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

    <p>${studyDate}</p>

    <p>
      今日の学習計画はありません。
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
            'input[type="checkbox"][onchange*="'
            + taskId
            + '"]'
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


        // -----------------------------------------------------
        // 進捗更新
        // -----------------------------------------------------
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


      // -------------------------------------------------------
      // プログレスバー
      // -------------------------------------------------------
      const percentage =
        total > 0
          ? (completed / total) * 100
          : 0;


      document.getElementById(
        "progressValue"
      ).style.width =
        percentage + "%";


      // -------------------------------------------------------
      // 全タスク完了
      // -------------------------------------------------------
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
