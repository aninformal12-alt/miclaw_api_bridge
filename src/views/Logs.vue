<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from "vue";
import { api } from "../api";

interface LogRow {
  id: number;
  ts: number;
  kind: "request" | "response" | "error" | string;
  path?: string;
  model?: string;
  stream?: boolean;
  status?: number;
  elapsed_ms?: number;
  message?: string;
  body?: unknown;
}

const rows = ref<LogRow[]>([]);
const max = 500;
const verbose = ref(false);
const streamDown = ref(false);
const expanded = ref<Set<number>>(new Set());
let events: EventSource | null = null;
let seq = 0;

function push(row: LogRow) {
  row.id = ++seq;
  rows.value.unshift(row);
  if (rows.value.length > max) rows.value.length = max;
}

onMounted(async () => {
  try {
    verbose.value = (await api.getVerboseLogs()).enabled;
  } catch {
    /* keep default */
  }
  const resp = await fetch("/api/logs");
  if (resp.ok) {
    const snapshot = (await resp.json()) as LogRow[];
    rows.value = snapshot.map((r) => ({ ...r, id: ++seq }));
  }
  events = new EventSource("/api/logs/stream");
  events.onopen = () => (streamDown.value = false);
  events.onmessage = (event) => {
    try {
      push(JSON.parse(event.data) as LogRow);
      streamDown.value = false;
    } catch {
      /* ignore malformed frames */
    }
  };
  // EventSource retries on its own; just surface the gap so the UI doesn't
  // look live while it is actually disconnected.
  events.onerror = () => (streamDown.value = true);
});

onBeforeUnmount(() => {
  events?.close();
});

async function toggleVerbose() {
  const next = !verbose.value;
  try {
    verbose.value = (await api.setVerboseLogs(next)).enabled;
  } catch {
    /* leave unchanged on failure */
  }
}

function canExpand(r: LogRow) {
  return r.body != null && (r.kind === "request" || r.kind === "response");
}

function toggleRow(r: LogRow) {
  if (!canExpand(r)) return;
  const next = new Set(expanded.value);
  next.has(r.id) ? next.delete(r.id) : next.add(r.id);
  expanded.value = next;
}

function pretty(body: unknown) {
  if (typeof body === "string") return body;
  try {
    return JSON.stringify(body, null, 2);
  } catch {
    return String(body);
  }
}

function fmtTime(ts: number) {
  return new Date(ts).toLocaleTimeString();
}

function tagClass(kind: string, status?: number) {
  if (kind === "error") return "bad";
  if (kind === "response") {
    if (status && status >= 400) return "bad";
    if (status && status >= 200 && status < 300) return "ok";
    return "warn";
  }
  return "warn";
}

function logLabel(r: LogRow) {
  if (r.kind === "request") return "request";
  if (r.kind === "response") return `status ${r.status ?? "—"}`;
  return "error";
}

function clear() {
  rows.value = [];
  expanded.value = new Set();
}
</script>

<template>
  <div class="logs-toolbar">
    <span class="count">{{ rows.length }} / {{ max }} 条</span>
    <span class="spacer"></span>
    <div class="switch-row">
      <span class="switch-text">
        <strong>详细日志</strong>
        <small>开启后记录请求正文（含 prompt）</small>
      </span>
      <button
        class="switch"
        type="button"
        role="switch"
        :aria-checked="verbose"
        aria-label="详细日志"
        @click="toggleVerbose"
      ></button>
    </div>
    <button class="btn btn-secondary btn-sm" @click="clear">清空</button>
  </div>

  <p v-if="streamDown" class="notice warn" style="margin-bottom: 16px">
    实时日志流已断开，正在自动重连…
  </p>

  <p class="notice plain" style="margin-bottom: 16px">
    默认仅记录代理元数据；开启「详细日志」后会额外记录请求正文，点击请求行即可展开。
  </p>

  <section v-if="rows.length === 0" class="card empty-state">
    <h2>等待请求</h2>
    <p>启动代理后，用 OpenAI、Responses 或 Anthropic 客户端连接本地端口。</p>
  </section>

  <section v-else class="log-list" aria-label="代理日志列表">
    <template v-for="r in rows" :key="r.id">
      <article
        class="log-row"
        :class="{ clickable: canExpand(r) }"
        :role="canExpand(r) ? 'button' : undefined"
        :tabindex="canExpand(r) ? 0 : undefined"
        :aria-expanded="canExpand(r) ? expanded.has(r.id) : undefined"
        @click="toggleRow(r)"
        @keydown.enter.prevent="toggleRow(r)"
        @keydown.space.prevent="toggleRow(r)"
      >
        <span :class="['pill', 'pill-sm', tagClass(r.kind, r.status)]">{{ logLabel(r) }}</span>
        <code class="log-path">{{ r.path || "—" }}</code>
        <span class="log-meta">
          <template v-if="r.kind === 'request'">
            model={{ r.model || "—" }} · stream={{ r.stream ? "true" : "false" }}
            <span v-if="canExpand(r)">· {{ expanded.has(r.id) ? "收起" : "展开" }}</span>
          </template>
          <template v-else-if="r.kind === 'response'">
            {{ r.elapsed_ms ?? "—" }}ms
            <span v-if="canExpand(r)">· {{ expanded.has(r.id) ? "收起" : "展开" }}</span>
          </template>
          <template v-else>{{ r.message }} · {{ r.elapsed_ms ?? "—" }}ms</template>
        </span>
        <time class="log-time">{{ fmtTime(r.ts) }}</time>
      </article>
      <pre v-if="expanded.has(r.id) && r.body != null" class="log-detail">{{ pretty(r.body) }}</pre>
    </template>
  </section>
</template>
