/**
 * 任务列表业务逻辑模块
 * 纯函数实现，不依赖 DOM 与 localStorage，可在浏览器与 Node 中加载。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.TodoStore = factory();
  }
})(typeof self !== 'undefined' ? self : globalThis, function () {
  'use strict';

  const FILTERS = ['all', 'active', 'completed'];

  const PRIORITIES = ['high', 'medium', 'low'];

  const DEFAULT_PRIORITY = 'medium';

  function normalizePriority(priority) {
    return PRIORITIES.indexOf(priority) !== -1 ? priority : DEFAULT_PRIORITY;
  }

  let nextId = 1;

  function generateId() {
    if (typeof Date !== 'undefined' && Math.random) {
      return (
        't-' +
        Date.now().toString(36) +
        '-' +
        (nextId++).toString(36) +
        '-' +
        Math.random().toString(36).slice(2, 8)
      );
    }
    return 't-' + nextId++;
  }

  /**
   * 新增任务。标题为空或仅空白时抛出错误。
   * priority 可选，缺省为 'medium'，非法值回落为默认优先级。
   * @returns {Array} 新数组，不修改原列表
   */
  function addTask(tasks, title, priority) {
    const list = Array.isArray(tasks) ? tasks : [];
    const trimmed = typeof title === 'string' ? title.trim() : '';
    if (!trimmed) {
      throw new Error('任务标题不能为空');
    }
    const task = {
      id: generateId(),
      title: trimmed,
      completed: false,
      priority: normalizePriority(priority),
    };
    return list.concat([task]);
  }

  /**
   * 切换任务完成状态。id 不存在时返回原列表。
   * @returns {Array} 新数组，不修改原列表
   */
  function toggleTask(tasks, id) {
    const list = Array.isArray(tasks) ? tasks : [];
    return list.map(function (task) {
      if (task && task.id === id) {
        return {
          id: task.id,
          title: task.title,
          completed: !task.completed,
          priority: normalizePriority(task.priority),
        };
      }
      return task;
    });
  }

  /**
   * 删除任务。id 不存在时返回等效的新列表。
   */
  function removeTask(tasks, id) {
    const list = Array.isArray(tasks) ? tasks : [];
    return list.filter(function (task) {
      return task && task.id !== id;
    });
  }

  /**
   * 修改任务优先级。id 不存在时返回等效的新列表，
   * 非法 priority 值忽略（返回等效的新列表）。
   * @returns {Array} 新数组，不修改原列表
   */
  function setPriority(tasks, id, priority) {
    const list = Array.isArray(tasks) ? tasks : [];
    if (PRIORITIES.indexOf(priority) === -1) {
      return list.slice();
    }
    return list.map(function (task) {
      if (task && task.id === id) {
        return {
          id: task.id,
          title: task.title,
          completed: task.completed === true,
          priority: priority,
        };
      }
      return task;
    });
  }

  /**
   * 按筛选条件返回任务。
   * statusFilter: 'all' | 'active' | 'completed'
   * priorityFilter 可选：'all' 或缺省时不按优先级过滤，
   * 否则只保留对应优先级的任务（'high' | 'medium' | 'low'）。
   */
  function filterTasks(tasks, statusFilter, priorityFilter) {
    const list = Array.isArray(tasks) ? tasks : [];
    let result;
    switch (statusFilter) {
      case 'active':
        result = list.filter(function (t) {
          return t && !t.completed;
        });
        break;
      case 'completed':
        result = list.filter(function (t) {
          return t && t.completed;
        });
        break;
      case 'all':
      default:
        result = list.slice();
    }
    if (PRIORITIES.indexOf(priorityFilter) !== -1) {
      result = result.filter(function (t) {
        return t && t.priority === priorityFilter;
      });
    }
    return result;
  }

  /**
   * 序列化任务列表为 JSON 字符串。
   */
  function serialize(tasks) {
    const list = Array.isArray(tasks) ? tasks : [];
    return JSON.stringify(list);
  }

  /**
   * 反序列化。非法输入（非 JSON、非数组、字段非法）时返回空数组，
   * 并对单条非法任务做容错过滤与字段规整。
   * 兼容旧持久化数据：缺少 priority 字段或值非法时补默认优先级 'medium'。
   */
  function deserialize(raw) {
    if (typeof raw !== 'string' || !raw) {
      return [];
    }
    let data;
    try {
      data = JSON.parse(raw);
    } catch (e) {
      return [];
    }
    if (!Array.isArray(data)) {
      return [];
    }
    return data
      .filter(function (item) {
        return (
          item &&
          typeof item === 'object' &&
          typeof item.id === 'string' &&
          item.id.length > 0 &&
          typeof item.title === 'string'
        );
      })
      .map(function (item) {
        return {
          id: item.id,
          title: item.title,
          completed: item.completed === true,
          priority: normalizePriority(item.priority),
        };
      });
  }

  return {
    FILTERS: FILTERS,
    PRIORITIES: PRIORITIES,
    DEFAULT_PRIORITY: DEFAULT_PRIORITY,
    addTask: addTask,
    toggleTask: toggleTask,
    removeTask: removeTask,
    setPriority: setPriority,
    filterTasks: filterTasks,
    serialize: serialize,
    deserialize: deserialize,
  };
});
