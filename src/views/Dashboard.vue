<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { RouterLink } from "vue-router";
import { api, AuthSnapshot, ModelInfo, ProxySnapshot, QuotaSnapshot } from "../api";

const auth = ref<AuthSnapshot | null>(null);
const proxy = ref<ProxySnapshot | null>(null);
const models = ref<ModelInfo[]>([]);
const quota = ref<QuotaSnapshot | null>(null);
const portInput = ref<number>(8765);
const busy = ref(false);
const err = ref("");

const proxyBase = computed(() => {
  const port = proxy.value?.active_port ?? proxy.value?.port ?? 8765;
  return `${window.location.protocol}//${window.location.hostname}:${port}`;
});
const health = computed(() => {
  if (!auth.value?.authenticated) return { label: "账号未登录", tone: "bad" };
  if (!proxy.value?.running) return { label: "服务未运行", tone: "warn" };
  if (proxy.value.restart_required) return { label: "需重启生效", tone: "warn" };
  return { label: "Ready", tone: "ok" };
});
const quotaTone = computed(() => {
  if (!auth.value?.authenticated || !quota.value) return "warn";
  if (quota.value.status === "exhausted") return "bad";
  if (quota.value.status === "low") return "warn";
  return "ok";
});
const quotaRemaining = computed(() =>
  quota.value ? new Intl.NumberFormat("zh-CN").format(quota.value.points_remaining) : "—",
);
const quotaMeta = computed(() => {
  if (!auth.value?.authenticated) return "登录后显示";
  if (!quota.value) return "暂时无法获取";
  const resetAt = new Date(quota.value.quota_reset_at).toLocaleString("zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
  return `${quota.value.points_used.toLocaleString("zh-CN")} / ${quota.value.points_limit.toLocaleString("zh-CN")} 已用 · ${resetAt} 重置`;
});

async function loadQuota() {
  quota.value = auth.value?.authenticated ? await api.quota() : null;
}

async function refreshAll() {
  err.value = "";
  try {
    auth.value = await api.authStatus();
    proxy.value = await api.proxyStatus();
    models.value = await api.listModels();
    portInput.value = proxy.value.port;
    await loadQuota().catch(() => {
      quota.value = null;
    });
  } catch (e: any) {
    err.value = e?.message ?? String(e);
  }
}

async function applyPort() {
  const port = Number(portInput.value);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) {
    err.value = "端口必须是 1024–65535 之间的整数。";
    return;
  }
  busy.value = true;
  try {
    proxy.value = await api.setProxyPort(portInput.value);
  } catch (e: any) {
    err.value = e?.message ?? String(e);
  } finally {
    busy.value = false;
  }
}

async function refreshAuth() {
  busy.value = true;
  try {
    auth.value = await api.refreshSession();
    await loadQuota();
  } catch (e: any) {
    err.value = e?.message ?? String(e);
  } finally {
    busy.value = false;
  }
}

async function refreshQuota() {
  busy.value = true;
  try {
    await loadQuota();
  } catch (e: any) {
    err.value = e?.message ?? String(e);
  } finally {
    busy.value = false;
  }
}

async function logout() {
  await api.logout();
  quota.value = null;
  await refreshAll();
}

onMounted(refreshAll);
</script>

<template>
  <p v-if="err" class="notice bad" style="margin-bottom: 16px">{{ err }}</p>

  <section class="status-grid" aria-label="运行状态">
    <div class="status-card">
      <span class="label">服务</span>
      <strong :class="health.tone">{{ health.label }}</strong>
    </div>
    <div class="status-card">
      <span class="label">账号</span>
      <strong>{{ auth?.authenticated ? auth.nick ?? auth.user_id ?? "已登录" : "未登录" }}</strong>
    </div>
    <div class="status-card">
      <span class="label">剩余积分</span>
      <strong :class="quotaTone">{{ quotaRemaining }}</strong>
      <small class="status-meta">{{ quotaMeta }}</small>
    </div>
    <div class="status-card">
      <span class="label">端口</span>
      <strong>{{ proxy?.active_port ?? proxy?.port ?? 8765 }}</strong>
    </div>
    <div class="status-card">
      <span class="label">模型</span>
      <strong>{{ models.length || "—" }}</strong>
    </div>
  </section>

  <section class="card">
    <h2 class="card-title">本地代理</h2>
    <p class="card-desc">启动后，任何 OpenAI / Claude 兼容客户端都可以连到本机。</p>

    <div class="inline-form" style="margin-bottom: 18px">
      <span :class="['pill', proxy?.running ? 'ok' : 'bad']">
        {{ proxy?.running ? "服务运行中" : "服务未运行" }}
      </span>
      <label class="field" for="proxy-port" style="max-width: 220px">
        <span>监听端口</span>
        <input id="proxy-port" type="number" v-model.number="portInput" min="1024" max="65535" />
      </label>
      <button class="btn btn-secondary" :disabled="busy" @click="applyPort">应用</button>
    </div>
    <p v-if="proxy?.restart_required" class="notice warn" style="margin-bottom: 14px">
      新端口 {{ proxy.port }} 已保存，重启服务后生效。当前仍在 {{ proxy.active_port }} 端口运行。
    </p>

    <div class="endpoint-grid">
      <div>
        <span class="label">OpenAI Chat</span>
        <code class="code-chip">{{ proxyBase }}/v1</code>
      </div>
      <div>
        <span class="label">Responses</span>
        <code class="code-chip">{{ proxyBase }}/v1/responses</code>
      </div>
      <div>
        <span class="label">Anthropic Messages</span>
        <code class="code-chip">{{ proxyBase }}/v1/messages</code>
      </div>
      <div>
        <span class="label">API Key</span>
        <RouterLink class="btn btn-tinted btn-sm" to="/keys">管理密钥</RouterLink>
      </div>
    </div>
  </section>

  <section class="login-grid">
    <article class="card">
      <h2 class="card-title">账号</h2>
      <p class="card-desc">serviceToken 过期时会自动刷新，也可以手动触发。</p>
      <div class="account-row" style="margin-bottom: 12px">
        <span :class="['pill', auth?.authenticated ? 'ok' : 'bad']">
          {{ auth?.authenticated ? "已认证" : "未认证" }}
        </span>
      </div>
      <div class="account-row">
        <button class="btn btn-secondary btn-sm" :disabled="busy || !auth?.authenticated" @click="refreshAuth">
          刷新令牌
        </button>
        <button class="btn btn-secondary btn-sm" :disabled="busy || !auth?.authenticated" @click="refreshQuota">
          刷新额度
        </button>
        <button class="btn btn-danger btn-sm" :disabled="busy || !auth?.authenticated" @click="logout">
          退出登录
        </button>
      </div>
      <div v-if="!auth?.authenticated" style="margin-top: 14px">
        <RouterLink class="btn btn-primary" to="/login">去登录</RouterLink>
      </div>
    </article>

    <article class="card">
      <h2 class="card-title">协议</h2>
      <p class="card-desc">Chat Completions 透传，Messages 和 Responses 做兼容转换。</p>
      <div class="list-group">
        <div class="list-row" style="grid-template-columns: 110px minmax(0, 1fr)">
          <strong style="font-size: 13.5px">Chat</strong>
          <code class="code-chip">/v1/chat/completions</code>
        </div>
        <div class="list-row" style="grid-template-columns: 110px minmax(0, 1fr)">
          <strong style="font-size: 13.5px">Responses</strong>
          <code class="code-chip">/v1/responses</code>
        </div>
        <div class="list-row" style="grid-template-columns: 110px minmax(0, 1fr)">
          <strong style="font-size: 13.5px">Anthropic</strong>
          <code class="code-chip">/v1/messages</code>
        </div>
      </div>
    </article>
  </section>

  <section class="card">
    <h2 class="card-title">可用模型</h2>
    <p class="card-desc">
      以下为超级小爱 PC v2 通道中已验证模型的静态列表，并非完整清单。请求中的
      <code>model</code> 会直接透传，列表里没有不代表不能调用；是否可用由上游及账号权限决定。能力与长度采用模型官方规格（别名预设另有标注），实际通道支持情况可能不同。
    </p>
    <div class="list-group">
      <div v-for="(m, index) in models" :key="m.id" class="list-row" style="grid-template-columns: 34px minmax(210px, 0.8fr) minmax(0, 1.4fr)">
        <span class="row-index">{{ String(index + 1).padStart(2, "0") }}</span>
        <code class="code-chip model-name">{{ m.id }}</code>
        <span class="muted" style="font-size: 12.5px">{{ m.family }}</span>
      </div>
    </div>
  </section>
</template>
