'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const store = require('./store.js');

describe('addTask', () => {
  test('新增任务生成 id、标题、未完成状态', () => {
    const tasks = store.addTask([], '买牛奶');
    assert.equal(tasks.length, 1);
    assert.equal(tasks[0].title, '买牛奶');
    assert.equal(tasks[0].completed, false);
    assert.ok(typeof tasks[0].id === 'string' && tasks[0].id.length > 0);
  });

  test('追加到已有列表，且不修改原数组', () => {
    const original = store.addTask([], '任务一');
    const next = store.addTask(original, '任务二');
    assert.equal(original.length, 1);
    assert.equal(next.length, 2);
    assert.equal(next[1].title, '任务二');
  });

  test('生成唯一 id', () => {
    const tasks = store.addTask(store.addTask([], 'a'), 'b');
    assert.notEqual(tasks[0].id, tasks[1].id);
  });

  test('标题首尾空白被裁剪', () => {
    const tasks = store.addTask([], '  带空白的标题  ');
    assert.equal(tasks[0].title, '带空白的标题');
  });

  test('空标题抛出错误', () => {
    assert.throws(() => store.addTask([], ''), /不能为空/);
    assert.throws(() => store.addTask([], '   '), /不能为空/);
    assert.throws(() => store.addTask([], null), /不能为空/);
    assert.throws(() => store.addTask([], undefined), /不能为空/);
    assert.throws(() => store.addTask([], 123), /不能为空/);
  });

  test('非数组输入按空列表处理', () => {
    const tasks = store.addTask(null, 'x');
    assert.equal(tasks.length, 1);
  });
});

describe('toggleTask', () => {
  test('切换完成状态', () => {
    let tasks = store.addTask([], '任务');
    tasks = store.toggleTask(tasks, tasks[0].id);
    assert.equal(tasks[0].completed, true);
    tasks = store.toggleTask(tasks, tasks[0].id);
    assert.equal(tasks[0].completed, false);
  });

  test('切换不存在的 id 时列表不变', () => {
    const tasks = store.addTask([], '任务');
    const result = store.toggleTask(tasks, '不存在的id');
    assert.deepEqual(result, tasks);
  });

  test('不影响其他任务，且不修改原数组', () => {
    let tasks = store.addTask([], '一');
    tasks = store.addTask(tasks, '二');
    const snapshot = JSON.parse(JSON.stringify(tasks));
    const result = store.toggleTask(tasks, tasks[0].id);
    assert.deepEqual(tasks, snapshot);
    assert.equal(result[0].completed, true);
    assert.equal(result[1].completed, false);
  });

  test('非数组输入返回空数组', () => {
    assert.deepEqual(store.toggleTask(null, 'x'), []);
  });
});

describe('removeTask', () => {
  test('删除指定任务', () => {
    let tasks = store.addTask([], '一');
    tasks = store.addTask(tasks, '二');
    const result = store.removeTask(tasks, tasks[0].id);
    assert.equal(result.length, 1);
    assert.equal(result[0].title, '二');
  });

  test('删除不存在的 id 时列表内容不变', () => {
    const tasks = store.addTask([], '任务');
    const result = store.removeTask(tasks, '不存在的id');
    assert.deepEqual(result, tasks);
  });

  test('不修改原数组', () => {
    const tasks = store.addTask([], '任务');
    store.removeTask(tasks, tasks[0].id);
    assert.equal(tasks.length, 1);
  });

  test('非数组输入返回空数组', () => {
    assert.deepEqual(store.removeTask(undefined, 'x'), []);
  });
});

describe('filterTasks', () => {
  function sampleTasks() {
    let tasks = store.addTask([], '未完成');
    tasks = store.addTask(tasks, '已完成');
    return store.toggleTask(tasks, tasks[1].id);
  }

  test('all 返回全部任务', () => {
    const tasks = sampleTasks();
    const result = store.filterTasks(tasks, 'all');
    assert.equal(result.length, 2);
    assert.notEqual(result, tasks);
  });

  test('active 仅返回未完成任务', () => {
    const result = store.filterTasks(sampleTasks(), 'active');
    assert.equal(result.length, 1);
    assert.equal(result[0].title, '未完成');
    assert.equal(result[0].completed, false);
  });

  test('completed 仅返回已完成任务', () => {
    const result = store.filterTasks(sampleTasks(), 'completed');
    assert.equal(result.length, 1);
    assert.equal(result[0].title, '已完成');
    assert.equal(result[0].completed, true);
  });

  test('未知筛选值按 all 处理', () => {
    assert.equal(store.filterTasks(sampleTasks(), 'unknown').length, 2);
  });

  test('空列表与非数组输入返回空数组', () => {
    assert.deepEqual(store.filterTasks([], 'all'), []);
    assert.deepEqual(store.filterTasks(null, 'active'), []);
  });
});

describe('serialize / deserialize', () => {
  test('序列化后可完整还原', () => {
    let tasks = store.addTask([], '一');
    tasks = store.addTask(tasks, '二');
    tasks = store.toggleTask(tasks, tasks[0].id);
    const restored = store.deserialize(store.serialize(tasks));
    assert.deepEqual(restored, tasks);
  });

  test('非 JSON 字符串返回空数组', () => {
    assert.deepEqual(store.deserialize('not json'), []);
    assert.deepEqual(store.deserialize('{broken'), []);
  });

  test('非数组 JSON 返回空数组', () => {
    assert.deepEqual(store.deserialize('{}'), []);
    assert.deepEqual(store.deserialize('"字符串"'), []);
    assert.deepEqual(store.deserialize('42'), []);
  });

  test('非法输入类型返回空数组', () => {
    assert.deepEqual(store.deserialize(null), []);
    assert.deepEqual(store.deserialize(undefined), []);
    assert.deepEqual(store.deserialize(''), []);
    assert.deepEqual(store.deserialize(123), []);
    assert.deepEqual(store.deserialize(['不是字符串']), []);
  });

  test('过滤非法条目并规整字段', () => {
    const raw = JSON.stringify([
      { id: 'a', title: '正常', completed: true },
      { id: 'b', title: '缺 completed' },
      null,
      '字符串',
      { title: '缺 id' },
      { id: '', title: '空 id' },
      { id: 'c', title: 'completed 非布尔', completed: 'yes', extra: 1 },
    ]);
    const result = store.deserialize(raw);
    assert.deepEqual(result, [
      { id: 'a', title: '正常', completed: true, priority: 'medium' },
      { id: 'b', title: '缺 completed', completed: false, priority: 'medium' },
      { id: 'c', title: 'completed 非布尔', completed: false, priority: 'medium' },
    ]);
  });

  test('serialize 非数组输入输出空数组 JSON', () => {
    assert.equal(store.serialize(null), '[]');
  });
});

describe('addTask 优先级', () => {
  test('缺省优先级默认为 medium', () => {
    const tasks = store.addTask([], '任务');
    assert.equal(tasks[0].priority, 'medium');
  });

  test('接受指定的合法优先级', () => {
    assert.equal(store.addTask([], 'a', 'high')[0].priority, 'high');
    assert.equal(store.addTask([], 'b', 'low')[0].priority, 'low');
    assert.equal(store.addTask([], 'c', 'medium')[0].priority, 'medium');
  });

  test('非法优先级回落为 medium', () => {
    assert.equal(store.addTask([], 'a', 'urgent')[0].priority, 'medium');
    assert.equal(store.addTask([], 'b', 'HIGH')[0].priority, 'medium');
    assert.equal(store.addTask([], 'c', 1)[0].priority, 'medium');
    assert.equal(store.addTask([], 'd', null)[0].priority, 'medium');
  });

  test('导出 PRIORITIES 常量', () => {
    assert.deepEqual(store.PRIORITIES, ['high', 'medium', 'low']);
    assert.equal(store.DEFAULT_PRIORITY, 'medium');
  });
});

describe('setPriority', () => {
  test('正常修改指定任务优先级', () => {
    const tasks = store.addTask([], '任务');
    const result = store.setPriority(tasks, tasks[0].id, 'high');
    assert.equal(result[0].priority, 'high');
    assert.equal(result[0].title, '任务');
    assert.equal(result[0].completed, false);
  });

  test('id 不存在时返回等效新列表', () => {
    const tasks = store.addTask([], '任务');
    const result = store.setPriority(tasks, '不存在的id', 'high');
    assert.notEqual(result, tasks);
    assert.deepEqual(result, tasks);
  });

  test('非法优先级被忽略，返回等效新列表', () => {
    const tasks = store.addTask([], '任务', 'low');
    const result = store.setPriority(tasks, tasks[0].id, 'urgent');
    assert.deepEqual(result, tasks);
    assert.equal(result[0].priority, 'low');
  });

  test('不修改原数组，且不影响其他任务', () => {
    let tasks = store.addTask([], '一', 'high');
    tasks = store.addTask(tasks, '二', 'low');
    const snapshot = JSON.parse(JSON.stringify(tasks));
    const result = store.setPriority(tasks, tasks[0].id, 'low');
    assert.deepEqual(tasks, snapshot);
    assert.equal(result[0].priority, 'low');
    assert.equal(result[1].priority, 'low');
    assert.equal(result[1].title, '二');
  });
});

describe('filterTasks 组合筛选', () => {
  function priorityTasks() {
    // 高（已完成）、高（未完成）、中（未完成）、低（已完成）
    let tasks = store.addTask([], '高一', 'high');
    tasks = store.addTask(tasks, '高二', 'high');
    tasks = store.addTask(tasks, '中一', 'medium');
    tasks = store.addTask(tasks, '低一', 'low');
    tasks = store.toggleTask(tasks, tasks[0].id);
    tasks = store.toggleTask(tasks, tasks[3].id);
    return tasks;
  }

  test('all + 具体优先级', () => {
    const tasks = priorityTasks();
    assert.deepEqual(
      store.filterTasks(tasks, 'all', 'high').map((t) => t.title),
      ['高一', '高二'],
    );
    assert.deepEqual(
      store.filterTasks(tasks, 'all', 'medium').map((t) => t.title),
      ['中一'],
    );
    assert.deepEqual(
      store.filterTasks(tasks, 'all', 'low').map((t) => t.title),
      ['低一'],
    );
  });

  test('active + 具体优先级', () => {
    const tasks = priorityTasks();
    assert.deepEqual(
      store.filterTasks(tasks, 'active', 'high').map((t) => t.title),
      ['高二'],
    );
    assert.deepEqual(store.filterTasks(tasks, 'active', 'low'), []);
  });

  test('completed + 具体优先级', () => {
    const tasks = priorityTasks();
    assert.deepEqual(
      store.filterTasks(tasks, 'completed', 'high').map((t) => t.title),
      ['高一'],
    );
    assert.deepEqual(
      store.filterTasks(tasks, 'completed', 'low').map((t) => t.title),
      ['低一'],
    );
    assert.deepEqual(store.filterTasks(tasks, 'completed', 'medium'), []);
  });

  test("priorityFilter 为 'all' 时不按优先级过滤", () => {
    const tasks = priorityTasks();
    assert.equal(store.filterTasks(tasks, 'all', 'all').length, 4);
    assert.equal(store.filterTasks(tasks, 'active', 'all').length, 2);
    assert.equal(store.filterTasks(tasks, 'completed', 'all').length, 2);
  });

  test('缺省或非法 priorityFilter 不按优先级过滤（兼容旧单参数调用）', () => {
    const tasks = priorityTasks();
    assert.deepEqual(store.filterTasks(tasks, 'active'), store.filterTasks(tasks, 'active', 'all'));
    assert.equal(store.filterTasks(tasks, 'active').length, 2);
    assert.equal(store.filterTasks(tasks, 'all', 'bogus').length, 4);
  });
});

describe('优先级持久化兼容', () => {
  test('旧数据无 priority 字段补 medium', () => {
    const raw = JSON.stringify([{ id: 'a', title: '旧任务', completed: true }]);
    const result = store.deserialize(raw);
    assert.deepEqual(result, [{ id: 'a', title: '旧任务', completed: true, priority: 'medium' }]);
  });

  test('非法 priority 值规整为 medium', () => {
    const raw = JSON.stringify([
      { id: 'a', title: '一', completed: false, priority: 'urgent' },
      { id: 'b', title: '二', completed: false, priority: 5 },
      { id: 'c', title: '三', completed: false, priority: 'high' },
    ]);
    const result = store.deserialize(raw);
    assert.equal(result[0].priority, 'medium');
    assert.equal(result[1].priority, 'medium');
    assert.equal(result[2].priority, 'high');
  });

  test('serialize / deserialize 往返保留优先级', () => {
    let tasks = store.addTask([], '高', 'high');
    tasks = store.addTask(tasks, '低', 'low');
    const restored = store.deserialize(store.serialize(tasks));
    assert.deepEqual(restored, tasks);
    assert.equal(restored[0].priority, 'high');
    assert.equal(restored[1].priority, 'low');
  });

  test('toggleTask 后 priority 字段保留', () => {
    const tasks = store.addTask([], '任务', 'high');
    const toggled = store.toggleTask(tasks, tasks[0].id);
    assert.equal(toggled[0].completed, true);
    assert.equal(toggled[0].priority, 'high');
  });
});

describe('模块纯净性', () => {
  test('模块不引用 DOM 与 localStorage', () => {
    const fs = require('node:fs');
    const path = require('node:path');
    const source = fs.readFileSync(path.join(__dirname, 'store.js'), 'utf8');
    // 去除注释后再检查，避免文档性描述造成误报
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
    assert.equal(code.includes('document.'), false);
    assert.equal(code.includes('localStorage'), false);
    assert.equal(code.includes('window.'), false);
  });
});
