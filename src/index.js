export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === "/api/test" && request.method === "GET") {
      return Response.json({
        success: true,
        message: "Hello from my Study Plan API!",
        timestamp: new Date().toISOString()
      });
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