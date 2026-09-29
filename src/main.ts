import { createApp } from "vue";
import { createRouter, createWebHashHistory } from "vue-router";
// Self-hosted Inter (portable look-alike for machines without SF Pro). The
// MiSans CJK fallback stays in the font stack by name only; Chinese text
// falls back to the system CJK font when it is not installed locally.
import "@fontsource/inter/400.css";
import "@fontsource/inter/500.css";
import "@fontsource/inter/600.css";
import "@fontsource/inter/700.css";
import App from "./App.vue";
import Dashboard from "./views/Dashboard.vue";
import Login from "./views/Login.vue";
import Logs from "./views/Logs.vue";
import AdminLogin from "./views/AdminLogin.vue";
import ApiKeys from "./views/ApiKeys.vue";
import Usage from "./views/Usage.vue";
import { api } from "./api";
import "./styles.css";

const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: "/", redirect: "/dashboard" },
    { path: "/dashboard", component: Dashboard, meta: { title: "本地代理", subtitle: "服务状态、接入端点与可用模型" } },
    { path: "/login", component: Login, meta: { title: "小米账号", subtitle: "登录后即可使用超级小爱积分额度" } },
    { path: "/logs", component: Logs, meta: { title: "实时日志", subtitle: "代理请求实时事件流" } },
    { path: "/keys", component: ApiKeys, meta: { title: "API 密钥", subtitle: "管理 /v1 接口的 Bearer 鉴权" } },
    { path: "/usage", component: Usage, meta: { title: "用量统计", subtitle: "Token 消耗趋势、输入输出拆分与模型分布" } },
    { path: "/admin-login", component: AdminLogin, meta: { title: "后台登录", authGate: true } },
  ],
});

// Admin-session guard.
//   - Once a password is configured: redirect to the login page until the
//     session cookie is valid.
//   - Before any password is configured: steer first-time visitors to the
//     setup page (the "首次访问引导设密码" flow), unless they explicitly chose
//     to skip it in this browser. The login/setup page itself is always exempt.
router.beforeEach(async (to) => {
  if (to.path === "/admin-login") return true;
  try {
    const s = await api.adminSession();
    if (s.configured) {
      if (!s.authenticated) return "/admin-login";
    } else if (localStorage.getItem("miclaw.skipPwSetup") !== "1") {
      return "/admin-login";
    }
  } catch {
    /* if the status check fails, let the page load and surface errors itself */
  }
  return true;
});

createApp(App).use(router).mount("#app");
