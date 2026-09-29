<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { api, UsageModelBreakdown, UsageReport } from "../api";

const WINDOWS = ["1h", "1d", "7d", "30d"] as const;
type Win = (typeof WINDOWS)[number];
const WINDOW_LABEL: Record<Win, string> = {
  "1h": "近 1 小时",
  "1d": "近 24 小时",
  "7d": "近 7 天",
  "30d": "近 30 天",
};

const METRICS = ["total", "prompt", "completion"] as const;
type Metric = (typeof METRICS)[number];
const METRIC_LABEL: Record<Metric, string> = { total: "总量", prompt: "输入", completion: "输出" };

const win = ref<Win>("1d");
const metric = ref<Metric>("total");
const report = ref<UsageReport | null>(null);
const error = ref("");
const loading = ref(false);

const buckets = computed(() => report.value?.buckets ?? []);
const models = computed(() => (report.value ? Object.keys(report.value.model_totals) : []));

// Stable model → chart-token mapping, ordered by total so the biggest
// consumer always gets the primary blue. Colors are CSS vars and therefore
// theme-aware for free.
const modelOrder = computed(() => {
  const r = report.value;
  if (!r) return [] as string[];
  return Object.entries(r.model_totals)
    .sort((a, b) => b[1] - a[1])
    .map(([m]) => m);
});
const colorOf = computed<Record<string, string>>(() => {
  const map: Record<string, string> = {};
  modelOrder.value.forEach((m, i) => {
    map[m] = `var(--chart-${(i % 8) + 1})`;
  });
  return map;
});

function metricValue(m: UsageModelBreakdown | undefined): number {
  if (!m) return 0;
  if (metric.value === "prompt") return m.prompt;
  if (metric.value === "completion") return m.completion;
  return m.total;
}

const totals = computed(() => {
  let prompt = 0;
  let completion = 0;
  let active = 0;
  for (const b of buckets.value) {
    let bt = 0;
    for (const name of models.value) {
      const mm = b.models[name];
      prompt += mm?.prompt ?? 0;
      completion += mm?.completion ?? 0;
      bt += mm?.total ?? 0;
    }
    if (bt > 0) active += 1;
  }
  return { prompt, completion, active };
});

const modelRows = computed(() => {
  const r = report.value;
  if (!r) return [];
  const grand = r.grand_total || 1;
  return modelOrder.value.map((m) => {
    const tokens = r.model_totals[m] ?? 0;
    return { id: m, tokens, share: (tokens / grand) * 100 };
  });
});

// ---- chart geometry -----------------------------------------------------
// The chart is laid out 1:1 against the measured container width (no
// preserveAspectRatio scaling), so rounded corners and axis text stay crisp.
const CHART_H = 220;
const AXIS_H = 28;
const BAR_FILL = 0.62;

const chartWrap = ref<HTMLElement | null>(null);
const svgEl = ref<SVGSVGElement | null>(null);
const containerW = ref(0);
let ro: ResizeObserver | null = null;

const bucketCount = computed(() => buckets.value.length);
const chartWidth = computed(() => Math.max(containerW.value, 1));
const slotW = computed(() => (bucketCount.value > 0 ? chartWidth.value / bucketCount.value : 0));
const barW = computed(() => Math.max(slotW.value * BAR_FILL, 1));

const metricMax = computed(() => {
  let max = 0;
  for (const b of buckets.value) {
    let bt = 0;
    for (const name of models.value) bt += metricValue(b.models[name]);
    max = Math.max(max, bt);
  }
  return max;
});

function measure() {
  const el = chartWrap.value;
  if (!el) return;
  const cs = getComputedStyle(el);
  const pad = parseFloat(cs.paddingLeft || "0") + parseFloat(cs.paddingRight || "0");
  containerW.value = Math.max(0, el.clientWidth - pad);
}

function barX(i: number): number {
  return i * slotW.value + (slotW.value - barW.value) / 2;
}

interface Seg {
  model: string;
  color: string;
  d: string;
  value: number;
}

// Rounded-top bar as a path (a rect's rx would round all four corners).
function topRoundedBar(x: number, y: number, w: number, h: number): string {
  if (h <= 0) return "";
  const r = Math.min(3, w / 2, h);
  const x2 = x + w;
  const yb = y + h;
  return `M ${x.toFixed(2)} ${yb.toFixed(2)} L ${x.toFixed(2)} ${(y + r).toFixed(2)} Q ${x.toFixed(2)} ${y.toFixed(2)} ${(x + r).toFixed(2)} ${y.toFixed(2)} L ${(x2 - r).toFixed(2)} ${y.toFixed(2)} Q ${x2.toFixed(2)} ${y.toFixed(2)} ${x2.toFixed(2)} ${(y + r).toFixed(2)} L ${x2.toFixed(2)} ${yb.toFixed(2)} Z`;
}

function bucketTotal(i: number): number {
  const b = buckets.value[i];
  if (!b) return 0;
  let bt = 0;
  for (const name of models.value) bt += metricValue(b.models[name]);
  return bt;
}

function segmentsFor(i: number): Seg[] {
  const max = metricMax.value;
  if (max === 0) return [];
  const b = buckets.value[i];
  if (!b) return [];
  const segs: Seg[] = [];
  let acc = 0;
  for (const name of modelOrder.value) {
    const v = metricValue(b.models[name]);
    if (v <= 0) continue;
    const h = (v / max) * CHART_H;
    const y = CHART_H - acc - h;
    segs.push({
      model: name,
      color: colorOf.value[name] ?? "var(--muted)",
      d: topRoundedBar(barX(i), y, barW.value, Math.max(h, 1)),
      value: v,
    });
    acc += h;
  }
  return segs;
}

// ---- hover / tooltip ----------------------------------------------------
const hover = ref<number | null>(null);

function onMove(ev: MouseEvent) {
  const rect = svgEl.value?.getBoundingClientRect();
  if (!rect || bucketCount.value === 0) return;
  const idx = Math.floor((ev.clientX - rect.left) / slotW.value);
  hover.value = Math.min(bucketCount.value - 1, Math.max(0, idx));
}

const tipStyle = computed(() => {
  if (hover.value === null) return {};
  const center = Math.min(
    Math.max(barX(hover.value) + barW.value / 2, 96),
    Math.max(chartWidth.value - 96, 96),
  );
  return { left: `${center}px` };
});

// ---- labels -------------------------------------------------------------
function bucketLabel(b: { t: number }): string {
  const d = new Date(b.t);
  if (win.value === "1h") {
    return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  }
  if (win.value === "1d") {
    return `${String(d.getHours()).padStart(2, "0")}:00`;
  }
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

function bucketLabelFull(b: { t: number }): string {
  const d = new Date(b.t);
  if (win.value === "7d" || win.value === "30d") {
    return `${d.getMonth() + 1}月${d.getDate()}日`;
  }
  return d.toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

const labelEvery = computed(() => Math.max(1, Math.ceil(bucketCount.value / 6)));

// ---- formatting ---------------------------------------------------------
function fmtInt(n: number): string {
  return n.toLocaleString("zh-CN");
}

// ---- data ---------------------------------------------------------------
async function load() {
  loading.value = true;
  error.value = "";
  try {
    report.value = await api.usage(win.value);
  } catch (e: any) {
    error.value = e?.message ?? String(e);
  } finally {
    loading.value = false;
  }
}

function setWindow(w: Win) {
  if (win.value === w) return;
  win.value = w;
  hover.value = null;
  load();
}

onMounted(() => {
  load();
  measure();
  ro = new ResizeObserver(() => measure());
  if (chartWrap.value) ro.observe(chartWrap.value);
});

onBeforeUnmount(() => {
  ro?.disconnect();
  ro = null;
});
</script>

<template>
  <p v-if="error" class="notice bad" style="margin-bottom: 16px">{{ error }}</p>

  <section class="status-grid" aria-label="用量概览">
    <div class="status-card">
      <span class="label">合计 Tokens</span>
      <strong>{{ fmtInt(report?.grand_total ?? 0) }}</strong>
      <small class="status-meta">{{ WINDOW_LABEL[win] }}</small>
    </div>
    <div class="status-card">
      <span class="label">输入 Tokens</span>
      <strong>{{ fmtInt(totals.prompt) }}</strong>
      <small class="status-meta">发送给模型的上下文</small>
    </div>
    <div class="status-card">
      <span class="label">输出 Tokens</span>
      <strong>{{ fmtInt(totals.completion) }}</strong>
      <small class="status-meta">模型生成的内容</small>
    </div>
    <div class="status-card">
      <span class="label">活跃模型</span>
      <strong>{{ models.length || "—" }}</strong>
      <small class="status-meta">{{ modelOrder[0] ?? "暂无调用" }}</small>
    </div>
  </section>

  <section class="card">
    <div class="usage-toolbar">
      <div>
        <h2 class="card-title">用量趋势</h2>
        <p class="card-desc">
          {{ WINDOW_LABEL[win] }} · 按{{ METRIC_LABEL[metric] }}查看，柱内按模型堆叠
        </p>
      </div>
      <div class="usage-controls">
        <div class="seg" role="group" aria-label="统计指标">
          <button
            v-for="m in METRICS"
            :key="m"
            type="button"
            :class="{ active: metric === m }"
            :aria-pressed="metric === m"
            @click="metric = m"
          >
            {{ METRIC_LABEL[m] }}
          </button>
        </div>
        <div class="seg" role="group" aria-label="时间窗口">
          <button
            v-for="w in WINDOWS"
            :key="w"
            type="button"
            :class="{ active: win === w }"
            :aria-pressed="win === w"
            @click="setWindow(w)"
          >
            {{ WINDOW_LABEL[w] }}
          </button>
        </div>
      </div>
    </div>

    <div ref="chartWrap" class="chart-wrap" @mouseleave="hover = null">
      <div v-if="loading && !report" class="skeleton chart-skeleton"></div>

      <div v-else-if="report && metricMax === 0" class="empty-usage">
        <p class="empty-title">该时间段内还没有用量记录</p>
        <p class="empty-hint">用任意 OpenAI / Anthropic 兼容客户端发起一次对话，数据就会出现在这里。</p>
      </div>

      <svg
        v-else-if="report && containerW > 0"
        ref="svgEl"
        class="bars"
        :width="chartWidth"
        :height="CHART_H + AXIS_H"
        role="img"
        :aria-label="`Token 用量柱状图，${WINDOW_LABEL[win]}，按${METRIC_LABEL[metric]}`"
        @mousemove="onMove"
      >
        <line
          v-for="f in [0.25, 0.5, 0.75]"
          :key="f"
          class="gridline"
          :x1="0"
          :x2="chartWidth"
          :y1="CHART_H - f * CHART_H"
          :y2="CHART_H - f * CHART_H"
        />
        <g v-for="(b, i) in buckets" :key="i">
          <path
            v-for="seg in segmentsFor(i)"
            :key="seg.model"
            :d="seg.d"
            :style="{ fill: seg.color }"
            :opacity="hover === null || hover === i ? 1 : 0.45"
          />
          <text
            v-if="i % labelEvery === 0"
            class="axis-label"
            :x="barX(i) + barW / 2"
            :y="CHART_H + 18"
            text-anchor="middle"
          >
            {{ bucketLabel(b) }}
          </text>
        </g>
      </svg>

      <div v-if="hover !== null && report && metricMax > 0" class="chart-tip" :style="tipStyle">
        <strong>{{ bucketLabelFull(buckets[hover]) }}</strong>
        <div class="tip-total">
          {{ METRIC_LABEL[metric] }} {{ fmtInt(bucketTotal(hover)) }} tokens
        </div>
        <div v-for="seg in segmentsFor(hover)" :key="seg.model" class="tip-row">
          <i :style="{ background: seg.color }"></i>
          <span class="tip-model">{{ seg.model }}</span>
          <span class="tip-val">{{ fmtInt(seg.value) }}</span>
        </div>
      </div>
    </div>
  </section>

  <section v-if="modelRows.length" class="card">
    <h2 class="card-title">模型明细</h2>
    <p class="card-desc">{{ WINDOW_LABEL[win] }}内的 token 消耗排序与占比。</p>
    <div class="model-usage-list">
      <div v-for="row in modelRows" :key="row.id" class="model-usage-row">
        <i class="dot" :style="{ background: colorOf[row.id] }"></i>
        <code class="code-chip model-name">{{ row.id }}</code>
        <div class="share">
          <div
            class="share-bar"
            :style="{ width: Math.max(row.share, 0.5) + '%', background: colorOf[row.id] }"
          ></div>
        </div>
        <span class="share-num">{{ fmtInt(row.tokens) }}</span>
        <span class="share-pct">{{ row.share.toFixed(1) }}%</span>
      </div>
    </div>
  </section>
</template>

<style scoped>
.bars path {
  transition: opacity 0.12s ease;
}
.gridline {
  stroke: var(--hairline);
  stroke-dasharray: 3 4;
}

.usage-toolbar {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 12px;
  margin-bottom: 16px;
}
.usage-controls {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.chart-wrap {
  position: relative;
}
.chart-skeleton {
  height: 248px;
}
.empty-usage {
  display: grid;
  place-content: center;
  gap: 6px;
  height: 248px;
  text-align: center;
}
.empty-title {
  font-size: 15px;
  font-weight: 600;
}
.empty-hint {
  color: var(--muted);
  font-size: 12.5px;
}

.chart-tip {
  position: absolute;
  top: 8px;
  transform: translateX(-50%);
  min-width: 180px;
  max-width: 260px;
  padding: 10px 12px;
  border-radius: 12px;
  background: var(--surface);
  border: 1px solid var(--hairline);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.12);
  pointer-events: none;
  z-index: 2;
  font-size: 12px;
}
.chart-tip strong {
  display: block;
  font-size: 12.5px;
}
.tip-total {
  color: var(--muted);
  margin: 2px 0 6px;
}
.tip-row {
  display: flex;
  align-items: center;
  gap: 6px;
  padding-top: 3px;
}
.tip-row i {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex: none;
}
.tip-model {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.tip-val {
  color: var(--muted);
  font-variant-numeric: tabular-nums;
}

.model-usage-list {
  display: grid;
  gap: 4px;
}
.model-usage-row {
  display: grid;
  grid-template-columns: 12px minmax(0, 220px) minmax(80px, 1fr) 110px 56px;
  align-items: center;
  gap: 12px;
  padding: 8px 0;
  border-bottom: 1px solid var(--hairline);
}
.model-usage-row:last-child {
  border-bottom: none;
}
.model-usage-row .dot {
  width: 9px;
  height: 9px;
  border-radius: 50%;
  justify-self: center;
}
.model-usage-row .share {
  height: 8px;
  border-radius: 4px;
  background: var(--fill);
  overflow: hidden;
}
.model-usage-row .share-bar {
  height: 100%;
  border-radius: 4px;
  min-width: 2px;
}
.model-usage-row .share-num {
  text-align: right;
  font-variant-numeric: tabular-nums;
  font-size: 13px;
  font-weight: 600;
}
.model-usage-row .share-pct {
  text-align: right;
  color: var(--muted);
  font-size: 12px;
  font-variant-numeric: tabular-nums;
}

@media (max-width: 720px) {
  .model-usage-row {
    grid-template-columns: 12px minmax(0, 1fr) 90px 48px;
  }
  .model-usage-row .share {
    display: none;
  }
}
</style>
