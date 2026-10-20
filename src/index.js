// Worker entrypoint. Route modules register themselves on import; any path that
// reaches the Worker but matches no route gets the Persian 404 page. Static
// files (css/js/fonts) are served directly by the Static Assets pipeline and
// never execute this script (run_worker_first covers only dynamic paths).

import { dispatch } from "./router.js";
import { htmlResponse, layout, notFoundPage } from "./lib/html.js";

import "./routes/public.js";
import "./routes/api.js";
import "./routes/admin.js";
import "./routes/assets.js";

export default {
  async fetch(request, env, ctx) {
    try {
      if (!env.DB) {
        return error500("اتصال به پایگاه داده برقرار نشد.");
      }
      const response = await dispatch(request, env, ctx);
      if (response) return response;
      return htmlResponse(notFoundPage(), { status: 404 });
    } catch (err) {
      console.error("Unhandled worker error:", err);
      return error500("خطای داخلی سرور. بعداً دوباره تلاش کنید.");
    }
  },
};

function error500(message) {
  return htmlResponse(
    layout({
      title: "خطا — گزارش‌کار",
      body: `<div class="card empty-state">
  <h1>خطای سرور</h1>
  <p class="muted">${message}</p>
  <p><a class="btn btn-primary" href="/">بازگشت به خانه</a></p>
</div>`,
    }),
    { status: 500 }
  );
}
