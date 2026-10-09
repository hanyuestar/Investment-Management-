import { ElMessage, ElMessageBox } from 'element-plus';
import { usePortfolioStore } from '../stores/portfolio';

/**
 * 删除确认的统一封装。
 *
 * 统一了原先散落在 9 个视图里的同一段逻辑：
 *   ElMessageBox.confirm → 调删除接口 → 成功提示 → 全量刷新
 *
 * @param {object} o
 * @param {string}   o.text          确认弹窗文案
 * @param {Function} o.request       实际执行删除的异步函数
 * @param {string}  [o.successText]  成功提示（默认「已删除」）
 * @param {Function}[o.beforeRefresh] 刷新前的钩子，如清理当前选中项
 * @param {boolean} [o.refresh]      是否全量刷新（默认 true）
 * @returns {Promise<boolean>} 是否真正删除成功（取消返回 false）
 *
 * @example
 * const confirmRemove = useRemoveConfirm();
 * await confirmRemove({ text: `确定删除「${row.name}」？`, request: () => accountsApi.remove(row.id) });
 */
export function useRemoveConfirm() {
  const store = usePortfolioStore();

  return async function confirmRemove({ text, request, successText = '已删除', beforeRefresh, refresh = true }) {
    try {
      await ElMessageBox.confirm(text, '删除确认', {
        type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消',
      });
    } catch {
      return false;                       // 用户取消，静默返回
    }
    try {
      await request();
      ElMessage.success(successText);
      if (beforeRefresh) await beforeRefresh();
      if (refresh) await store.refreshAll();
      return true;
    } catch (e) {
      ElMessage.error(e?.message || '删除失败');
      return false;
    }
  };
}
