<script setup lang="ts">
import { onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import { api } from "../api";

const router = useRouter();
const ready = ref(false);
const configured = ref(false);
const password = ref("");
const confirm = ref("");
const busy = ref(false);
const error = ref("");

async function load() {
  try {
    const s = await api.adminSession();
    configured.value = s.configured;
    if (s.configured && s.authenticated) {
      router.replace("/dashboard");
      return;
    }
  } catch (e: any) {
    error.value = String(e);
  } finally {
    ready.value = true;
  }
}

async function submit() {
  error.value = "";
  if (!configured.value && password.value !== confirm.value) {
    error.value = "两次输入的密码不一致";
    return;
  }
  busy.value = true;
  try {
    if (configured.value) {
      await api.adminLogin(password.value);
    } else {
      await api.adminSetup(password.value);
    }
    // Password is now set (or we just logged in); the first-run guide flag is
    // no longer relevant.
    localStorage.removeItem("miclaw.skipPwSetup");
    router.replace("/dashboard");
  } catch (e: any) {
    error.value = e?.message ?? String(e);
  } finally {
    busy.value = false;
  }
}

// First-run guide opt-out: remember the choice in this browser so the guard
// stops steering here, then continue to the dashboard.
function skipSetup() {
  localStorage.setItem("miclaw.skipPwSetup", "1");
  router.replace("/dashboard");
}

onMounted(load);
</script>

<template>
  <section class="center-page" v-if="ready">
    <div class="center-card card">
      <h2 class="card-title">{{ configured ? "后台登录" : "设置管理密码" }}</h2>
      <p class="card-desc">
        <template v-if="configured">输入管理密码以进入后台。</template>
        <template v-else>首次访问，请为管理后台设置一个密码（至少 6 位）。设置后访问后台都需要登录。</template>
      </p>

      <form class="form-stack" @submit.prevent="submit">
        <label class="field">
          <span>管理密码</span>
          <input
            type="password"
            v-model="password"
            autocomplete="current-password"
            placeholder="••••••"
          />
        </label>
        <label v-if="!configured" class="field">
          <span>确认密码</span>
          <input type="password" v-model="confirm" autocomplete="new-password" />
        </label>
        <button
          class="btn btn-primary btn-block"
          type="submit"
          :disabled="busy || !password || (!configured && !confirm)"
        >
          {{ configured ? "登录" : "设置并进入" }}
        </button>
        <button v-if="!configured" class="ghost-action" type="button" @click="skipSetup">
          暂不设置，先进入后台
        </button>
      </form>

      <div v-if="error" style="margin-top: 16px">
        <p class="notice bad">{{ error }}</p>
      </div>

      <div class="auth-steps" style="margin-top: 22px">
        <div class="list-group">
          <div class="list-row" style="grid-template-columns: 28px minmax(0, 1fr); min-height: 0; padding: 10px 0">
            <span class="step-num">1</span>
            <div>
              <strong style="font-size: 13px; font-weight: 600">本地优先</strong>
              <p class="muted" style="margin: 2px 0 0; font-size: 12px">密码以 argon2 哈希保存在本机。</p>
            </div>
          </div>
          <div class="list-row" style="grid-template-columns: 28px minmax(0, 1fr); min-height: 0; padding: 10px 0">
            <span class="step-num">2</span>
            <div>
              <strong style="font-size: 13px; font-weight: 600">会话 Cookie</strong>
              <p class="muted" style="margin: 2px 0 0; font-size: 12px">登录后通过 HttpOnly Cookie 维持。</p>
            </div>
          </div>
          <div class="list-row" style="grid-template-columns: 28px minmax(0, 1fr); min-height: 0; padding: 10px 0">
            <span class="step-num">3</span>
            <div>
              <strong style="font-size: 13px; font-weight: 600">忘记密码</strong>
              <p class="muted" style="margin: 2px 0 0; font-size: 12px">删除数据目录下 security.json 可重置。</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  </section>
</template>
