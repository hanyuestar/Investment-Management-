<template>
  <div ref="el" class="chart-box" :style="{ height: height }"></div>
</template>

<script setup>
import { ref, onMounted, onBeforeUnmount, watch, nextTick } from 'vue';
import * as echarts from 'echarts';

const props = defineProps({
  option: { type: Object, required: true },
  height: { type: String, default: '300px' },
});
const el = ref(null);
let chart = null;
let ro = null;

function render() {
  if (!chart || !props.option) return;
  // 容器曾被隐藏或宽度为 0 时，ECharts 会以 0 尺寸初始化导致图表空白；
  // 渲染前先按当前容器尺寸 resize 一次，保证首次可见即正确布局。
  if (el.value && el.value.clientWidth > 0) chart.resize();
  chart.setOption(props.option, true);
}

onMounted(async () => {
  chart = echarts.init(el.value);
  render();
  // 初次挂载后容器宽度可能仍在变化（栅格降级/字体加载），追加一次布局后校准
  await nextTick();
  requestAnimationFrame(() => { if (chart && el.value && el.value.clientWidth > 0) chart.resize(); });
  ro = new ResizeObserver(() => { if (chart && el.value && el.value.clientWidth > 0) chart.resize(); });
  ro.observe(el.value);
});

watch(() => props.option, render, { deep: true });
watch(() => props.height, () => { if (chart) chart.resize(); });

onBeforeUnmount(() => {
  ro && ro.disconnect();
  chart && chart.dispose();
  chart = null;
});

defineExpose({
  getChart: () => chart,
});
</script>

<style scoped>
/* 图表容器必须允许收缩：否则内部 canvas 的固定像素宽度会通过
   min-content 反向撑破父级栅格（移动端横向溢出主因之一）。 */
.chart-box {
  width: 100%;
  min-width: 0;
  max-width: 100%;
}
</style>
