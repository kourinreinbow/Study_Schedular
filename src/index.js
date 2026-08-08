export default {
  async fetch(request, env, ctx) {
    // POST以外は受け付けない
    if (request.method !== "POST") {
      return Response.json(
        {
          success: false,
          message: "POST request only"
        },
        { status: 405 }
      );
    }

    try {
      // POSTされたJSONを取得
      const data = await request.json();

      // 受け取った内容をログに出力
      console.log("Received data:", data);

      // 受け取った内容をそのまま返す
      return Response.json({
        success: true,
        message: "POST received successfully!",
        received: data
      });

    } catch (error) {
      return Response.json(
        {
          success: false,
          message: "Invalid JSON"
        },
        { status: 400 }
      );
    }
  }
};