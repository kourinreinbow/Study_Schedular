export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // GET /api/test
    if (url.pathname === "/api/test" && request.method === "GET") {
      return Response.json({
        success: true,
        method: "GET",
        message: "API is working!"
      });
    }

    // POST /api/test
    if (url.pathname === "/api/test" && request.method === "POST") {
      try {
        const body = await request.json();

        return Response.json({
          success: true,
          method: "POST",
          message: "POST request received!",
          received: body
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

    return Response.json(
      {
        success: false,
        message: "Not Found"
      },
      { status: 404 }
    );
  }
};