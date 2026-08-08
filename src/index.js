export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // -------------------------
    // CORS
    // -------------------------
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, PATCH, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type"
    };

    // ブラウザからのOPTIONSリクエスト
    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: corsHeaders
      });
    }

    try {

      // =========================
      // GET /db_show
      // D1データベース確認用
      // =========================
      if (
        request.method === "GET" &&
        url.pathname === "/db_show"
      ) {
        // study_plansを取得
        const plans = await env.DB.prepare(`
          SELECT *
          FROM study_plans
          ORDER BY study_date DESC
        `).all();

        // study_tasksを取得
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


      // =========================
      // GET /study-plan/add
      // クエリパラメータから勉強計画を登録
      //
      // 例:
      // /study-plan/add
      //   ?study_date=2026-08-09
      //   &title=TOEIC
      //   &description=今日の勉強
      //   &task1=英単語
      //   &task1_description=金のフレーズ
      //   &task1_minutes=30
      //   &task2=Part5
      //   &task2_description=文法問題
      //   &task2_minutes=30
      // =========================
      if (
        request.method === "GET" &&
        url.pathname === "/study-plan/add"
      ) {

        // -------------------------
        // 勉強計画
        // -------------------------
        const studyDate = url.searchParams.get("study_date");
        const title = url.searchParams.get("title");
        const description =
          url.searchParams.get("description");

        // 必須項目チェック
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

        // -------------------------
        // 勉強計画を登録
        // -------------------------
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

        const planId = planResult.meta.last_row_id;

        // -------------------------
        // タスクを登録
        // task1, task2, task3...
        // -------------------------
        let taskCount = 0;

        for (let i = 1; i <= 100; i++) {

          const taskTitle =
            url.searchParams.get(`task${i}`);

          // task1が存在しない場合は終了
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

        // -------------------------
        // 登録結果
        // -------------------------
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


      // =========================
      // POST /study-plan
      // 勉強計画を登録
      // =========================
      if (
        request.method === "POST" &&
        url.pathname === "/study-plan"
      ) {
        const data = await request.json();

        // 勉強計画を登録
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

        const planId = planResult.meta.last_row_id;

        // タスクを登録
        if (Array.isArray(data.tasks)) {
          for (let i = 0; i < data.tasks.length; i++) {
            const task = data.tasks[i];

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


      // =========================
      // GET /study-plan
      // 勉強計画を全件取得
      // =========================
      if (
        request.method === "GET" &&
        url.pathname === "/study-plan"
      ) {
        const plans = await env.DB.prepare(`
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


      // =========================
      // GET /study-plan/:date
      // 指定日の勉強計画を取得
      // =========================
      if (
        request.method === "GET" &&
        url.pathname.startsWith("/study-plan/")
      ) {
        const date = url.pathname.split("/")[2];

        const plan = await env.DB.prepare(`
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

        const tasks = await env.DB.prepare(`
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


      // =========================
      // PATCH /study-task/:id
      // タスクの完了状態を変更
      // =========================
      if (
        request.method === "PATCH" &&
        url.pathname.startsWith("/study-task/")
      ) {
        const taskId = url.pathname.split("/")[2];
        const data = await request.json();

        const completed = data.completed ? 1 : 0;

        const result = await env.DB.prepare(`
          UPDATE study_tasks
          SET completed = ?,
              updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `)
          .bind(completed, taskId)
          .run();

        // 存在しないタスクの場合
        if (result.meta.changes === 0) {
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
            message: "Task updated!"
          },
          {
            headers: corsHeaders
          }
        );
      }


      // =========================
      // 404
      // =========================
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