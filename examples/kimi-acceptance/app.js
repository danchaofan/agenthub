/**
 * 页面逻辑：渲染、事件绑定与 localStorage 持久化。
 * 业务规则（新增/切换/删除/筛选/序列化）全部由 store.js 的 TodoStore 提供。
 */
(function () {
  'use strict';

  var STORAGE_KEY = 'todo-list-tasks';

  var PRIORITY_LABELS = { high: '高', medium: '中', low: '低' };

  var form = document.getElementById('todo-form');
  var input = document.getElementById('todo-input');
  var prioritySelect = document.getElementById('priority-select');
  var listEl = document.getElementById('todo-list');
  var emptyTip = document.getElementById('empty-tip');
  var filterBtns = Array.prototype.slice.call(
    document.querySelectorAll('.filter-btn[data-filter]'),
  );
  var priorityFilterBtns = Array.prototype.slice.call(
    document.querySelectorAll('.filter-btn[data-priority-filter]'),
  );

  var tasks = load();
  var currentFilter = 'all';
  var currentPriorityFilter = 'all';

  function load() {
    var raw = null;
    try {
      raw = window.localStorage.getItem(STORAGE_KEY);
    } catch (e) {
      raw = null;
    }
    return TodoStore.deserialize(raw);
  }

  function save() {
    try {
      window.localStorage.setItem(STORAGE_KEY, TodoStore.serialize(tasks));
    } catch (e) {
      /* 存储不可用（如隐私模式）时静默忽略，页面仍可正常使用 */
    }
  }

  function render() {
    var visible = TodoStore.filterTasks(tasks, currentFilter, currentPriorityFilter);
    listEl.innerHTML = '';

    visible.forEach(function (task) {
      var li = document.createElement('li');
      li.className = 'todo-item' + (task.completed ? ' is-done' : '');
      li.dataset.id = task.id;

      var checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.checked = task.completed;
      checkbox.setAttribute('aria-label', '标记完成');
      checkbox.addEventListener('change', function () {
        tasks = TodoStore.toggleTask(tasks, task.id);
        save();
        render();
      });

      var title = document.createElement('span');
      title.className = 'todo-title';
      title.textContent = task.title;

      var badge = document.createElement('select');
      badge.className = 'priority-badge priority-editor priority-' + task.priority;
      badge.setAttribute('aria-label', '修改“' + task.title + '”的优先级');
      TodoStore.PRIORITIES.forEach(function (priority) {
        var option = document.createElement('option');
        option.value = priority;
        option.textContent = PRIORITY_LABELS[priority];
        badge.appendChild(option);
      });
      badge.value = task.priority || TodoStore.DEFAULT_PRIORITY;
      badge.addEventListener('change', function () {
        tasks = TodoStore.setPriority(tasks, task.id, badge.value);
        save();
        render();
      });

      var del = document.createElement('button');
      del.type = 'button';
      del.className = 'btn-delete';
      del.textContent = '删除';
      del.addEventListener('click', function () {
        tasks = TodoStore.removeTask(tasks, task.id);
        save();
        render();
      });

      li.appendChild(checkbox);
      li.appendChild(title);
      li.appendChild(badge);
      li.appendChild(del);
      listEl.appendChild(li);
    });

    emptyTip.hidden = visible.length > 0;

    filterBtns.forEach(function (btn) {
      btn.classList.toggle('is-active', btn.dataset.filter === currentFilter);
    });
    priorityFilterBtns.forEach(function (btn) {
      btn.classList.toggle('is-active', btn.dataset.priorityFilter === currentPriorityFilter);
    });
  }

  form.addEventListener('submit', function (event) {
    event.preventDefault();
    try {
      tasks = TodoStore.addTask(tasks, input.value, prioritySelect.value);
    } catch (e) {
      input.focus();
      return;
    }
    input.value = '';
    input.focus();
    save();
    render();
  });

  filterBtns.forEach(function (btn) {
    btn.addEventListener('click', function () {
      currentFilter = btn.dataset.filter;
      render();
    });
  });

  priorityFilterBtns.forEach(function (btn) {
    btn.addEventListener('click', function () {
      currentPriorityFilter = btn.dataset.priorityFilter;
      render();
    });
  });

  render();
})();
