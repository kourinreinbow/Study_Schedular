export default {
  async fetch(request, env, ctx) {
    return Response.json({
      success: true,
      message: "Hello from study-schedular!"
    });
  }
};