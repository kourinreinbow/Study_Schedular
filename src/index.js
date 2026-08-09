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

    // =========================================================
    // OPTIONS
    // =========================================================
    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: corsHeaders
      });
    }

    try {

      // =======================================================
      // GET /db_show
      //
      // DB確認用
      // =======================================================
      if (
        request.method === "GET" &&
        url.pathname === "/db_show"
      ) {

        const plans =
          await env.DB.prepare(`
            SELECT *
            FROM study_plans
            ORDER BY study_date DESC, id DESC
          `).all();

        const tasks =
          await env.DB.prepare(`
            SELECT *
            FROM study_tasks
            ORDER BY plan_id, sort_order
          `).all();

        return Response.json(
          {
            success: true,
            database: "connected",

            study_plans:
              plans.results,

            study_tasks:
              tasks.results
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
      // =======================================================
      if (
        request.method === "GET" &&
        url.pathname === "/study-plan/add"
      ) {

        const data = {

          study_date:
            url.searchParams.get(
              "study_date"
            ),

          title:
            url.searchParams.get(
              "title"
            ),

          description:
            url.searchParams.get(
              "description"
            ),

          tasks: []
        };


        // -----------------------------------------------------
        // task1, task2, task3...
        // -----------------------------------------------------
        for (
          let i = 1;
          i <= 100;
          i++
        ) {

          const taskTitle =
            url.searchParams.get(
              `task${i}`
            );

          if (!taskTitle) {
            break;
          }

          data.tasks.push({

            title:
              taskTitle,

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
      //
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

            plans:
              plans.results
          },
          {
            headers: corsHeaders
          }
        );
      }


      // =======================================================
      // GET /study-plan/:date
      //
      // 指定日の学習計画を取得
      //
      // actual_secondsも含めて返す
      // =======================================================
      if (
        request.method === "GET" &&
        url.pathname.startsWith(
          "/study-plan/"
        )
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
              message:
                "Study plan not found"
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

              tasks:
                tasks.results
            }
          },
          {
            headers: corsHeaders
          }
        );
      }


      // =======================================================
      // GET /study-result/latest
      //
      // 最新の学習結果を取得
      //
      // IMPORTANT:
      // /study-result/:date より先に判定する。
      // =======================================================
      if (
        request.method === "GET" &&
        url.pathname ===
          "/study-result/latest"
      ) {

        return await getLatestStudyResult(
          env.DB,
          corsHeaders
        );
      }


      // =======================================================
      // GET /study-result/:date
      //
      // 指定日の学習結果を取得
      //
      // デイリーブリーフィングから
      // 前日の学習結果を参照するために使用
      // =======================================================
      if (
        request.method === "GET" &&
        url.pathname.startsWith(
          "/study-result/"
        )
      ) {

        const date =
          url.pathname.split("/")[2];

        return await getStudyResult(
          env.DB,
          date,
          corsHeaders
        );
      }


      // =======================================================
      // PATCH /study-task/:id/time
      //
      // タイマー実績時間をDBへ保存
      //
      // JSON:
      //
      // {
      //   "actual_seconds": 1234
      // }
      // =======================================================
      if (
        request.method === "PATCH" &&
        url.pathname.startsWith(
          "/study-task/"
        ) &&
        url.pathname.endsWith(
          "/time"
        )
      ) {

        const parts =
          url.pathname.split("/");

        const taskId =
          parts[2];

        const data =
          await request.json();

        const actualSeconds =
          Math.max(
            0,
            Math.floor(
              Number(
                data.actual_seconds
              ) || 0
            )
          );


        const result =
          await env.DB.prepare(`
            UPDATE study_tasks
            SET
              actual_seconds = ?,
              updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
          `)
            .bind(
              actualSeconds,
              taskId
            )
            .run();


        if (
          result.meta.changes === 0
        ) {

          return Response.json(
            {
              success: false,
              message:
                "Task not found"
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

            message:
              "Study time updated!",

            task_id:
              Number(taskId),

            actual_seconds:
              actualSeconds
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
      //
      // 既存API
      // =======================================================
      if (
        request.method === "PATCH" &&
        url.pathname.startsWith(
          "/study-task/"
        ) &&
        !url.pathname.endsWith(
          "/time"
        )
      ) {

        const taskId =
          url.pathname.split("/")[2];

        const data =
          await request.json();

        const completed =
          data.completed
            ? 1
            : 0;


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
              message:
                "Task not found"
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

            message:
              "Task updated!",

            task_id:
              Number(taskId),

            completed:
              completed === 1
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
      // 今日の日付ではなく、
      // DBに登録された最新のstudy_dateを使用
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
                ...corsHeaders,

                "Content-Type":
                  "text/html; charset=UTF-8"
              }
            }
          );
        }


        return await createChecklistResponse(
          env.DB,
          plan,
          corsHeaders
        );
      }


      // =======================================================
      // GET /checklist/:date
      //
      // 指定日のチェック表
      // =======================================================
      if (
        request.method === "GET" &&
        url.pathname.startsWith(
          "/checklist/"
        )
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
                ...corsHeaders,

                "Content-Type":
                  "text/html; charset=UTF-8"
              }
            }
          );
        }


        return await createChecklistResponse(
          env.DB,
          plan,
          corsHeaders
        );
      }


      // =======================================================
      // 404
      // =======================================================
      return Response.json(
        {
          success: false,
          message:
            "Not Found"
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

          message:
            error.message
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
    //
    // NOTE:
    // この仕様は既存コードから変更していない。
    // =========================================================
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
        actual_seconds,
        completed,
        sort_order
      )
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `)
      .bind(
        planId,

        task.title,

        task.description ??
          null,

        task.minutes ??
          null,

        0,

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

      plan_id:
        planId,

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
// 指定日の学習結果取得
// =============================================================
async function getStudyResult(
  DB,
  date,
  corsHeaders
) {

  const plan =
    await DB.prepare(`
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

        message:
          "Study result not found"
      },
      {
        status: 404,
        headers: corsHeaders
      }
    );
  }


  const tasks =
    await DB.prepare(`
      SELECT
        id,
        plan_id,
        title,
        description,
        minutes,
        actual_seconds,
        completed,
        sort_order,
        updated_at
      FROM study_tasks
      WHERE plan_id = ?
      ORDER BY sort_order
    `)
      .bind(plan.id)
      .all();


  const taskResults =
    tasks.results;


  const totalPlannedMinutes =
    taskResults.reduce(
      (
        sum,
        task
      ) =>
        sum +
        (
          Number(
            task.minutes
          ) || 0
        ),
      0
    );


  const totalActualSeconds =
    taskResults.reduce(
      (
        sum,
        task
      ) =>
        sum +
        (
          Number(
            task.actual_seconds
          ) || 0
        ),
      0
    );


  const completedCount =
    taskResults.filter(
      task =>
        task.completed
    ).length;


  return Response.json(
    {
      success: true,

      study_date:
        plan.study_date,

      title:
        plan.title,

      description:
        plan.description,

      summary: {

        total_planned_minutes:
          totalPlannedMinutes,

        total_actual_seconds:
          totalActualSeconds,

        total_actual_minutes:
          Math.floor(
            totalActualSeconds /
            60
          ),

        completed_count:
          completedCount,

        total_count:
          taskResults.length

      },

      tasks:
        taskResults
    },
    {
      headers: corsHeaders
    }
  );
}


// =============================================================
// 最新の学習結果取得
// =============================================================
async function getLatestStudyResult(
  DB,
  corsHeaders
) {

  const plan =
    await DB.prepare(`
      SELECT *
      FROM study_plans
      ORDER BY study_date DESC, id DESC
      LIMIT 1
    `)
      .first();


  if (!plan) {

    return Response.json(
      {
        success: false,

        message:
          "Study result not found"
      },
      {
        status: 404,
        headers: corsHeaders
      }
    );
  }


  const tasks =
    await DB.prepare(`
      SELECT
        id,
        plan_id,
        title,
        description,
        minutes,
        actual_seconds,
        completed,
        sort_order,
        updated_at
      FROM study_tasks
      WHERE plan_id = ?
      ORDER BY sort_order
    `)
      .bind(plan.id)
      .all();


  const taskResults =
    tasks.results;


  const totalPlannedMinutes =
    taskResults.reduce(
      (
        sum,
        task
      ) =>
        sum +
        (
          Number(
            task.minutes
          ) || 0
        ),
      0
    );


  const totalActualSeconds =
    taskResults.reduce(
      (
        sum,
        task
      ) =>
        sum +
        (
          Number(
            task.actual_seconds
          ) || 0
        ),
      0
    );


  const completedCount =
    taskResults.filter(
      task =>
        task.completed
    ).length;


  return Response.json(
    {
      success: true,

      study_date:
        plan.study_date,

      title:
        plan.title,

      description:
        plan.description,

      summary: {

        total_planned_minutes:
          totalPlannedMinutes,

        total_actual_seconds:
          totalActualSeconds,

        total_actual_minutes:
          Math.floor(
            totalActualSeconds /
            60
          ),

        completed_count:
          completedCount,

        total_count:
          taskResults.length

      },

      tasks:
        taskResults
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
  plan,
  corsHeaders
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
      task =>
        task.completed
    ).length;


  const taskList =
    taskResults
      .map(
        task => {

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
                  予定：
                  ${task.minutes}分
                </span>
              `
              : "";


          const actualSeconds =
            Number(
              task.actual_seconds
            ) || 0;


          const timer =
            createTimerHtml(
              task,
              actualSeconds
            );


          const description =
            task.description
              ? `
                <div
                  class="task-description"
                >
                  ${escapeHtml(
                    task.description
                  )}
                </div>
              `
              : "";


          return `
            <div
              class="task"
              data-task-id="${task.id}"
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


                <div>

                  <div
                    class="
                      task-title
                      ${completedClass}
                    "
                  >
                    ${escapeHtml(
                      task.title
                    )}
                  </div>


                  ${description}

                </div>

              </label>


              <div class="task-info">

                ${minutes}


                <span
                  class="actual-time"
                >
                  実績：
                  <span
                    id="actual-${task.id}"
                  >
                    ${formatSeconds(
                      actualSeconds
                    )}
                  </span>
                </span>

              </div>


              ${timer}

            </div>
          `;
        }
      )
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
        ...corsHeaders,

        "Content-Type":
          "text/html; charset=UTF-8"
      }
    }
  );
}


// =============================================================
// タイマーHTML
// =============================================================
function createTimerHtml(
  task,
  actualSeconds
) {

  const taskId =
    Number(task.id);


  const plannedSeconds =
    task.minutes != null
      ? Number(task.minutes) * 60
      : 0;


  return `
    <div
      class="timer"
      id="timer-${taskId}"

      data-task-id="${taskId}"

      data-planned-seconds="${plannedSeconds}"

      data-actual-seconds="${actualSeconds}"
    >

      <div
        class="timer-display"
      >
        ${formatSeconds(
          actualSeconds
        )}
      </div>


      <div
        class="timer-buttons"
      >

        <button
          type="button"

          onclick="
            startTimer(${taskId})
          "
        >
          ▶ 開始
        </button>


        <button
          type="button"

          onclick="
            pauseTimer(${taskId})
          "
        >
          ⏸ 一時停止
        </button>


        <button
          type="button"

          onclick="
            resetTimer(${taskId})
          "
        >
          ↻ リセット
        </button>

      </div>


      ${
        plannedSeconds > 0
          ? `
            <div
              class="timer-plan"
            >
              予定：
              ${task.minutes}分

              <span
                class="timer-plan-note"
              >
                （予定時間を超えても計測します）
              </span>
            </div>
          `
          : ""
      }

    </div>
  `;
}


// =============================================================
// 秒数 → HH:MM:SS / MM:SS
// =============================================================
function formatSeconds(
  totalSeconds
) {

  const seconds =
    Math.max(
      0,
      Math.floor(
        Number(
          totalSeconds
        ) || 0
      )
    );


  const hours =
    Math.floor(
      seconds / 3600
    );


  const minutes =
    Math.floor(
      (
        seconds % 3600
      ) / 60
    );


  const secs =
    seconds % 60;


  if (hours > 0) {

    return [
      String(hours)
        .padStart(
          2,
          "0"
        ),

      String(minutes)
        .padStart(
          2,
          "0"
        ),

      String(secs)
        .padStart(
          2,
          "0"
        )

    ].join(":");
  }


  return [
    String(minutes)
      .padStart(
        2,
        "0"
      ),

    String(secs)
      .padStart(
        2,
        "0"
      )

  ].join(":");
}


// =============================================================
// HTMLエスケープ
// =============================================================
function escapeHtml(
  value
) {

  return String(
    value ?? ""
  )
    .replaceAll(
      "&",
      "&amp;"
    )
    .replaceAll(
      "<",
      "&lt;"
    )
    .replaceAll(
      ">",
      "&gt;"
    )
    .replaceAll(
      '"',
      "&quot;"
    )
    .replaceAll(
      "'",
      "&#039;"
    );
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

      <meta
        charset="UTF-8"
      >

      <meta
        name="viewport"
        content="
          width=device-width,
          initial-scale=1.0
        "
      >

      <title>
        学習チェック表
      </title>

    </head>


    <body>

      <h1>
        学習チェック表
      </h1>


      ${
        date
          ? `
            <p>
              ${escapeHtml(date)}
            </p>
          `
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

      <meta
        charset="UTF-8"
      >


      <meta
        name="viewport"
        content="
          width=device-width,
          initial-scale=1.0
        "
      >


      <title>
        ${escapeHtml(title)}
      </title>


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

          margin: 0;

          padding: 20px;

          background:
            #f5f5f5;

          color:
            #222;
        }


        h1 {
          margin-bottom: 5px;
        }


        .date {

          color:
            #666;

          margin-bottom:
            15px;
        }


        .description {

          background:
            white;

          padding:
            15px;

          border-radius:
            10px;

          margin-bottom:
            20px;
        }


        .progress {

          font-weight:
            bold;

          margin-bottom:
            8px;
        }


        .progress-bar {

          width:
            100%;

          height:
            10px;

          background:
            #ddd;

          border-radius:
            5px;

          overflow:
            hidden;

          margin-bottom:
            20px;
        }


        .progress-value {

          width:
            0%;

          height:
            100%;

          background:
            #4caf50;

          transition:
            width 0.3s;
        }


        #tasks {

          display:
            flex;

          flex-direction:
            column;

          gap:
            12px;
        }


        .task {

          background:
            white;

          border-radius:
            12px;

          padding:
            15px;

          box-shadow:
            0 2px 5px
            rgba(
              0,
              0,
              0,
              0.08
            );
        }


        .task-main {

          display:
            flex;

          align-items:
            flex-start;

          gap:
            10px;
        }


        .task-main input {

          width:
            20px;

          height:
            20px;

          margin-top:
            2px;

          flex-shrink:
            0;
        }


        .task-title {

          font-size:
            18px;

          font-weight:
            bold;
        }


        .task-title.completed {

          text-decoration:
            line-through;

          color:
            #999;
        }


        .task-description {

          margin-top:
            5px;

          color:
            #666;

          font-size:
            14px;
        }


        .task-info {

          display:
            flex;

          gap:
            12px;

          margin-top:
            10px;

          color:
            #555;

          font-size:
            14px;

          flex-wrap:
            wrap;
        }


        .minutes {

          font-weight:
            bold;
        }


        .actual-time {

          color:
            #1976d2;
        }


        .timer {

          margin-top:
            12px;

          padding-top:
            12px;

          border-top:
            1px solid #eee;
        }


        .timer-display {

          font-size:
            32px;

          font-weight:
            bold;

          font-variant-numeric:
            tabular-nums;

          text-align:
            center;

          margin-bottom:
            10px;
        }


        .timer-buttons {

          display:
            flex;

          gap:
            8px;

          flex-wrap:
            wrap;
        }


        .timer-buttons button {

          flex:
            1;

          min-width:
            90px;

          padding:
            10px 12px;

          border:
            none;

          border-radius:
            8px;

          background:
            #eee;

          cursor:
            pointer;

          font-size:
            14px;
        }


        .timer-buttons button:hover {

          background:
            #ddd;
        }


        .timer-plan {

          text-align:
            center;

          color:
            #777;

          font-size:
            13px;

          margin-top:
            8px;
        }


        .timer-plan-note {

          font-size:
            12px;

          color:
            #999;
        }


        .complete-message {

          display:
            none;

          margin-top:
            20px;

          padding:
            15px;

          text-align:
            center;

          background:
            #e8f5e9;

          border-radius:
            10px;

          font-weight:
            bold;
        }

      </style>

    </head>


    <body>


      <h1>
        ${escapeHtml(title)}
      </h1>


      <div class="date">
        ${escapeHtml(studyDate)}
      </div>


      ${
        description
          ? `
            <div
              class="description"
            >
              ${escapeHtml(
                description
              )}
            </div>
          `
          : ""
      }


      <div
        class="progress"
        id="progress"
      >

        進捗：

        <span
          id="completedCount"
        >
          ${completedCount}
        </span>

        /

        <span
          id="totalCount"
        >
          ${totalCount}
        </span>

      </div>


      <div
        class="progress-bar"
      >

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


      <script>

        // =====================================================
        // タイマー状態
        //
        // タスクごとに独立したタイマーを持つ
        //
        // timers = {
        //   1: {
        //     interval: ...
        //   },
        //   2: {
        //     interval: ...
        //   }
        // }
        // =====================================================

        const timers = {};


        // =====================================================
        // タイマー要素取得
        // =====================================================

        function getTimerElement(
          taskId
        ) {

          return document.getElementById(
            "timer-" +
            taskId
          );

        }


        // =====================================================
        // タイマー表示更新
        // =====================================================

        function updateTimerDisplay(
          taskId,
          seconds
        ) {

          const timer =
            getTimerElement(
              taskId
            );


          if (!timer) {
            return;
          }


          const display =
            timer.querySelector(
              ".timer-display"
            );


          if (display) {

            display.textContent =
              formatSeconds(
                seconds
              );

          }


          const actual =
            document.getElementById(
              "actual-" +
              taskId
            );


          if (actual) {

            actual.textContent =
              formatSeconds(
                seconds
              );

          }


          timer.dataset.actualSeconds =
            seconds;
        }


        // =====================================================
        // タイマー開始
        // =====================================================

        function startTimer(
          taskId
        ) {

          /*
           * すでに動いている場合は
           * 二重起動しない
           */
          if (
            timers[taskId]
          ) {

            return;

          }


          const timer =
            getTimerElement(
              taskId
            );


          if (!timer) {
            return;
          }


          let actualSeconds =
            Number(
              timer.dataset.actualSeconds
            ) || 0;


          timers[taskId] = {

            interval:
              setInterval(
                async () => {

                  actualSeconds++;


                  updateTimerDisplay(
                    taskId,
                    actualSeconds
                  );


                  /*
                   * 10秒ごとにDB保存
                   *
                   * 毎秒APIを呼び出すと
                   * リクエスト数が多くなるため、
                   * 10秒ごとに保存する。
                   */
                  if (
                    actualSeconds %
                    10 ===
                    0
                  ) {

                    await saveStudyTime(
                      taskId,
                      actualSeconds
                    );

                  }

                },
                1000
              )

          };

        }


        // =====================================================
        // タイマー一時停止
        // =====================================================

        async function pauseTimer(
          taskId
        ) {

          if (
            !timers[taskId]
          ) {

            return;

          }


          clearInterval(
            timers[taskId].interval
          );


          delete timers[
            taskId
          ];


          const timer =
            getTimerElement(
              taskId
            );


          if (!timer) {
            return;
          }


          const actualSeconds =
            Number(
              timer.dataset.actualSeconds
            ) || 0;


          /*
           * 一時停止時は
           * 即座にDBへ保存
           */
          await saveStudyTime(
            taskId,
            actualSeconds
          );

        }


        // =====================================================
        // タイマーリセット
        //
        // DB上の実績時間も0にする
        // =====================================================

        async function resetTimer(
          taskId
        ) {

          if (
            timers[taskId]
          ) {

            clearInterval(
              timers[taskId].interval
            );


            delete timers[
              taskId
            ];

          }


          updateTimerDisplay(
            taskId,
            0
          );


          await saveStudyTime(
            taskId,
            0
          );

        }


        // =====================================================
        // 学習時間をDBへ保存
        // =====================================================

        async function saveStudyTime(
          taskId,
          actualSeconds
        ) {

          try {

            const response =
              await fetch(
                "/study-task/" +
                taskId +
                "/time",
                {
                  method:
                    "PATCH",

                  headers: {
                    "Content-Type":
                      "application/json"
                  },

                  body:
                    JSON.stringify({
                      actual_seconds:
                        actualSeconds
                    })
                }
              );


            const data =
              await response.json();


            if (
              !data.success
            ) {

              console.error(
                "Study time save failed:",
                data.message
              );

            }

          } catch (
            error
          ) {

            console.error(
              "Study time save error:",
              error
            );

          }

        }


        // =====================================================
        // チェック状態更新
        //
        // 既存機能
        // =====================================================

        async function updateTask(
          taskId,
          completed
        ) {

          try {

            const response =
              await fetch(
                "/study-task/" +
                taskId,
                {
                  method:
                    "PATCH",

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


            const data =
              await response.json();


            if (
              !data.success
            ) {

              console.error(
                data.message
              );

              return;

            }


            updateProgress();


            const task =
              document.querySelector(
                '.task[data-task-id="' +
                taskId +
                '"]'
              );


            if (task) {

              const title =
                task.querySelector(
                  ".task-title"
                );


              if (title) {

                if (
                  completed
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

            }

          } catch (
            error
          ) {

            console.error(
              "Task update error:",
              error
            );

          }

        }


        // =====================================================
        // 進捗更新
        // =====================================================

        function updateProgress() {

          const checkboxes =
            document.querySelectorAll(
              '#tasks input[type="checkbox"]'
            );


          let completedCount =
            0;


          checkboxes.forEach(
            checkbox => {

              if (
                checkbox.checked
              ) {

                completedCount++;

              }

            }
          );


          const totalCount =
            checkboxes.length;


          const completedElement =
            document.getElementById(
              "completedCount"
            );


          const totalElement =
            document.getElementById(
              "totalCount"
            );


          const progressValue =
            document.getElementById(
              "progressValue"
            );


          if (
            completedElement
          ) {

            completedElement.textContent =
              completedCount;

          }


          if (
            totalElement
          ) {

            totalElement.textContent =
              totalCount;

          }


          if (
            progressValue
          ) {

            const percentage =
              totalCount > 0
                ? (
                    completedCount /
                    totalCount
                  ) *
                  100
                : 0;


            progressValue.style.width =
              percentage +
              "%";

          }


          const completeMessage =
            document.getElementById(
              "completeMessage"
            );


          if (
            completeMessage
          ) {

            completeMessage.style.display =
              (
                totalCount > 0 &&
                completedCount ===
                  totalCount
              )
                ? "block"
                : "none";

          }

        }


        // =====================================================
        // 秒数フォーマット
        // =====================================================

        function formatSeconds(
          totalSeconds
        ) {

          const seconds =
            Math.max(
              0,
              Math.floor(
                Number(
                  totalSeconds
                ) || 0
              )
            );


          const hours =
            Math.floor(
              seconds /
              3600
            );


          const minutes =
            Math.floor(
              (
                seconds %
                3600
              ) /
              60
            );


          const secs =
            seconds %
            60;


          if (
            hours > 0
          ) {

            return [

              String(hours)
                .padStart(
                  2,
                  "0"
                ),

              String(minutes)
                .padStart(
                  2,
                  "0"
                ),

              String(secs)
                .padStart(
                  2,
                  "0"
                )

            ].join(":");

          }


          return [

            String(minutes)
              .padStart(
                2,
                "0"
              ),

            String(secs)
              .padStart(
                2,
                "0"
              )

          ].join(":");

        }


        // =====================================================
        // ページ読み込み時
        // =====================================================

        updateProgress();


        // =====================================================
        // ページを閉じる・離れる前
        //
        // 通常は10秒ごと＋一時停止時に保存。
        //
        // 最後の数秒も保存するため、
        // beforeunloadでも保存を試みる。
        // =====================================================

        window.addEventListener(
          "beforeunload",
          () => {

            Object.keys(
              timers
            ).forEach(
              taskId => {

                const timer =
                  getTimerElement(
                    taskId
                  );


                if (!timer) {
                  return;
                }


                const actualSeconds =
                  Number(
                    timer.dataset.actualSeconds
                  ) || 0;


                /*
                 * beforeunloadでは
                 * awaitを待てない可能性がある。
                 *
                 * そのため、基本的には
                 * 10秒ごとの保存を利用する。
                 */
                saveStudyTime(
                  taskId,
                  actualSeconds
                );

              }
            );

          }
        );

      </script>

    </body>

    </html>
  `;
}