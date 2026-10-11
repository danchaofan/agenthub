export const labels: Record<string, string> = {
  planning: '领队分析中',
  awaiting_confirmation: '等待确认分工',
  executing: '顺序执行中',
  reviewing: '独立审查中',
  reworking: '返工中 · 1/1',
  summarizing: '汇总中',
  completed: '本轮已交付',
  failed: '执行失败',
  cancelled: '已取消',
  interrupted: '执行已中断',
};
export const roles: Record<string, string> = {
  leader: '领队',
  worker: '执行者',
  reviewer: '审查员',
};
export const initialPrompt =
  '在这个目录创建一个轻量任务列表网页，支持新增、完成、删除、按全部/未完成/已完成筛选，刷新后数据保留。使用原生 HTML/CSS/JavaScript，不引入外部运行依赖；业务逻辑独立成模块，用 node:test 编写并运行测试。界面用中文。提供 README 启动与测试说明。先查看目录，保留已有文件，只修改本任务需要的文件。不要提交或发布。';
