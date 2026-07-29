/* ===== 记账台 · 核心逻辑 ===== */
(() => {
  'use strict';

  const STORAGE_KEY = 'ledger.app.v1';

  // 分类定义
  const CATEGORIES = {
    expense: [
      { id: 'food', name: '餐饮', emoji: '🍜', color: '#f97316' },
      { id: 'transport', name: '通勤', emoji: '🚌', color: '#0ea5e9' },
      { id: 'shopping', name: '购物', emoji: '🛍️', color: '#ec4899' },
      { id: 'fun', name: '娱乐', emoji: '🎮', color: '#8b5cf6' },
      { id: 'home', name: '居家', emoji: '🏠', color: '#14b8a6' },
      { id: 'medical', name: '医疗', emoji: '💊', color: '#ef4444' },
      { id: 'study', name: '学习', emoji: '📚', color: '#3b82f6' },
      { id: 'social', name: '社交', emoji: '🎁', color: '#f59e0b' },
      { id: 'other_e', name: '其他', emoji: '📦', color: '#94a3b8' },
    ],
    income: [
      { id: 'salary', name: '工资', emoji: '💰', color: '#16a34a' },
      { id: 'bonus', name: '奖金', emoji: '🎉', color: '#22c55e' },
      { id: 'invest', name: '理财', emoji: '📈', color: '#10b981' },
      { id: 'parttime', name: '兼职', emoji: '💼', color: '#84cc16' },
      { id: 'other_i', name: '其他', emoji: '📦', color: '#94a3b8' },
    ],
    transfer: [
      { id: 'transfer', name: '转账', emoji: '🔄', color: '#8b5cf6' },
    ],
  };

  function catDef(type, id) {
    const list = CATEGORIES[type] || [];
    return list.find(c => c.id === id) || { name: '其他', emoji: '📦', color: '#94a3b8' };
  }

  // 默认状态
  function defaultState() {
    const month = new Date().toISOString().slice(0, 7);
    return {
      bills: [],            // {id, type, category, amount, account, toAccount, note, date, receipt}
      accounts: [
        { id: 'cash', name: '现金', type: 'asset', balance: 500 },
        { id: 'wechat', name: '微信钱包', type: 'asset', balance: 1200 },
        { id: 'alipay', name: '支付宝', type: 'asset', balance: 2000 },
        { id: 'card', name: '储蓄卡', type: 'asset', balance: 15000 },
        { id: 'credit', name: '信用卡', type: 'liability', balance: -3000 },
      ],
      budgets: {},          // { '2026-07': 5000, ... }
      catBudgets: {},       // { '2026-07': { food: 1000, ... } }
      plans: [
        { id: 'p1', type: 'income', name: '工资', amount: 8000, cycle: 'monthly', day: 10 },
        { id: 'p2', type: 'expense', name: '房租', amount: 2500, cycle: 'monthly', day: 5 },
      ],
      goals: [
        { id: 'g1', name: '紧急备用金', target: 20000, saved: 8200, emoji: '🛡️', deadline: '' },
        { id: 'g2', name: '旅行基金', target: 10000, saved: 3400, emoji: '✈️', deadline: '' },
      ],
      settings: { currency: '¥' },
    };
  }

  let state = defaultState();

  // ===== 工具 =====
  const $ = s => document.querySelector(s);
  const $$ = s => document.querySelectorAll(s);
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const cur = () => state.settings.currency;
  const monthKey = d => (d || new Date()).toISOString().slice(0, 7);
  const todayStr = () => new Date().toISOString().slice(0, 10);

  function fmt(n) {
    const v = Math.round((n + Number.EPSILON) * 100) / 100;
    return cur() + v.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  function fmtShort(n) {
    const abs = Math.abs(n);
    if (abs >= 10000) return cur() + (n / 10000).toFixed(1) + '万';
    return cur() + Math.round(n).toLocaleString('zh-CN');
  }
  function escapeHtml(s) {
    const d = document.createElement('div');
    d.textContent = s ?? '';
    return d.innerHTML;
  }

  // ===== 持久化 =====
  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const s = JSON.parse(raw);
        state = Object.assign(defaultState(), s);
        state.accounts = s.accounts || defaultState().accounts;
        state.budgets = s.budgets || {};
        state.plans = s.plans || defaultState().plans;
        state.goals = s.goals || defaultState().goals;
      }
    } catch (e) { console.error(e); }
  }
  function save() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }

  // ===== 账单操作 =====
  function addBill(bill) {
    const b = Object.assign({
      id: uid(),
      type: 'expense',
      category: 'food',
      amount: 0,
      account: state.accounts[0]?.id,
      toAccount: null,
      note: '',
      date: todayStr(),
      receipt: null,
    }, bill);
    b.amount = Math.abs(parseFloat(b.amount) || 0);
    state.bills.unshift(b);
    applyAccountEffect(b);
    save();
    renderAll();
    toast('已记录 ✓');
  }

  function deleteBill(id) {
    const b = state.bills.find(x => x.id === id);
    if (b) reverseAccountEffect(b);
    state.bills = state.bills.filter(x => x.id !== id);
    save();
    renderAll();
    toast('已删除');
  }

  // 账户余额联动
  function applyAccountEffect(b) {
    const acc = id => state.accounts.find(a => a.id === id);
    if (b.type === 'expense') {
      const a = acc(b.account); if (a) a.balance -= b.amount;
    } else if (b.type === 'income') {
      const a = acc(b.account); if (a) a.balance += b.amount;
    } else if (b.type === 'transfer') {
      const f = acc(b.account), t = acc(b.toAccount);
      if (f) f.balance -= b.amount;
      if (t) t.balance += b.amount;
    }
  }
  function reverseAccountEffect(b) {
    const acc = id => state.accounts.find(a => a.id === id);
    if (b.type === 'expense') {
      const a = acc(b.account); if (a) a.balance += b.amount;
    } else if (b.type === 'income') {
      const a = acc(b.account); if (a) a.balance -= b.amount;
    } else if (b.type === 'transfer') {
      const f = acc(b.account), t = acc(b.toAccount);
      if (f) f.balance += b.amount;
      if (t) t.balance -= b.amount;
    }
  }

  // ===== 统计 =====
  function billsOfMonth(mk) {
    return state.bills.filter(b => monthKey(new Date(b.date)) === mk);
  }
  function sumBy(list, type) {
    return list.filter(b => b.type === type).reduce((s, b) => s + b.amount, 0);
  }

  function monthOverview(mk) {
    const list = billsOfMonth(mk);
    const income = sumBy(list, 'income');
    const expense = sumBy(list, 'expense');
    return { income, expense, balance: income - expense };
  }

  function categoryBreakdown(mk) {
    const list = billsOfMonth(mk).filter(b => b.type === 'expense');
    const map = {};
    list.forEach(b => {
      map[b.category] = (map[b.category] || 0) + b.amount;
    });
    const entries = Object.entries(map)
      .map(([id, amount]) => ({ ...catDef('expense', id), id, amount }))
      .sort((a, b) => b.amount - a.amount);
    const total = entries.reduce((s, e) => s + e.amount, 0);
    return { entries, total };
  }

  function last6Months() {
    const res = [];
    const now = new Date();
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const mk = d.toISOString().slice(0, 7);
      const o = monthOverview(mk);
      res.push({ mk, label: (d.getMonth() + 1) + '月', income: o.income, expense: o.expense, balance: o.balance });
    }
    return res;
  }

  // ===== 资产 =====
  function assetSummary() {
    let asset = 0, liability = 0;
    state.accounts.forEach(a => {
      if (a.type === 'asset') asset += a.balance;
      else liability += a.balance; // 负债为负值
    });
    return { asset, liability, net: asset + liability };
  }

  // ===== 预算 =====
  function getBudget(mk) {
    return state.budgets[mk] || 0;
  }
  function setBudget(mk, amount) {
    if (amount > 0) state.budgets[mk] = amount;
    else delete state.budgets[mk];
    save();
  }

  // ===== 计划 =====
  function addPlan(p) {
    state.plans.push(Object.assign({ id: uid() }, p));
    save();
    renderAll();
    toast('计划已添加');
  }
  function deletePlan(id) {
    state.plans = state.plans.filter(p => p.id !== id);
    save();
    renderAll();
  }

  // 计划是否"临近"：本月该日未过
  function planStatus(p) {
    const now = new Date();
    const day = p.day || 1;
    const today = now.getDate();
    const mk = monthKey(now);
    const done = state.bills.some(b =>
      b.type === p.type && b.category === (p.type === 'income' ? 'salary' : 'other_e') &&
      b.note && b.note.includes(p.name) && monthKey(new Date(b.date)) === mk
    );
    const upcoming = today <= day;
    return { upcoming, day, done };
  }

  // ===== 渲染 =====
  function renderAll() {
    renderOverview();
    renderCategoryPie();
    renderAssets();
    renderGoals();
    renderTrend();
    renderPlans();
    renderBills();
  }

  function renderOverview() {
    const mk = monthKey();
    const o = monthOverview(mk);
    $('#ov-balance').textContent = fmt(o.balance);
    $('#ov-income').textContent = fmtShort(o.income);
    $('#ov-expense').textContent = fmtShort(o.expense);

    const budget = getBudget(mk);
    const pct = budget > 0 ? Math.min(100, (o.expense / budget) * 100) : 0;
    $('#budget-fill').style.width = pct + '%';
    $('#budget-text').textContent = budget > 0
      ? `${fmtShort(o.expense)} / ${fmtShort(budget)}`
      : '未设置预算';
    const warn = $('#budget-warn');
    if (budget > 0 && o.expense > budget) {
      warn.hidden = false;
    } else {
      warn.hidden = true;
    }
  }

  function renderCategoryPie() {
    const mk = monthKey();
    const { entries, total } = categoryBreakdown(mk);
    $('#pie-total').textContent = fmtShort(total);
    $('#cat-month').textContent = (new Date().getMonth() + 1) + '月';

    drawPie('pie', entries, total);

    const legend = $('#pie-legend');
    if (entries.length === 0) {
      legend.innerHTML = '<div class="empty-tip">本月暂无支出</div>';
    } else {
      legend.innerHTML = entries.map(e => `
        <div class="legend-item">
          <span class="legend-dot" style="background:${e.color}"></span>
          <span class="legend-name">${e.emoji} ${e.name}</span>
          <span class="legend-amount">${fmtShort(e.amount)}</span>
          <span class="legend-pct">${total > 0 ? Math.round(e.amount / total * 100) : 0}%</span>
        </div>
      `).join('');
    }
  }

  function renderAssets() {
    const s = assetSummary();
    $('#asset-net').textContent = fmt(s.net);
    $('#asset-total').textContent = fmt(s.asset);
    $('#liability-total').textContent = fmt(s.liability);
    $('#asset-date').textContent = todayStr().slice(5);

    const list = $('#account-list');
    list.innerHTML = state.accounts.map(a => `
      <div class="account-item">
        <span class="account-name">${a.type === 'liability' ? '🔻' : '🔵'} ${escapeHtml(a.name)}</span>
        <span class="account-bal" style="color:${a.type === 'liability' ? 'var(--expense)' : 'var(--text-1)'}">${fmt(a.balance)}</span>
      </div>
    `).join('');
  }

  function renderGoals() {
    const wrap = $('#goal-list');
    if (!wrap) return;
    if (!state.goals || state.goals.length === 0) {
      wrap.innerHTML = '<div class="empty-tip">还没有存钱目标，点击右上角「管理」添加 →</div>';
      return;
    }
    wrap.innerHTML = state.goals.map(g => {
      const saved = Math.max(0, g.saved || 0);
      const target = Math.max(1, g.target || 1);
      const pct = Math.min(100, Math.round(saved / target * 100));
      const done = saved >= target;
      return `
        <div class="goal-item" data-goal="${g.id}">
          <div class="goal-top">
            <span class="goal-emoji">${g.emoji || '🎯'}</span>
            <span class="goal-name">${escapeHtml(g.name)}</span>
            ${g.deadline ? `<span class="goal-deadline">📅 ${escapeHtml(g.deadline)}</span>` : ''}
          </div>
          <div class="goal-bar">
            <div class="goal-fill" style="width:${pct}%"></div>
          </div>
          <div class="goal-bottom">
            <span class="goal-saved">${fmt(saved)}</span>
            <span class="goal-target">/ ${fmtShort(target)} · ${pct}%</span>
            ${done ? '<span class="goal-done">已达成 🎉</span>' : ''}
          </div>
        </div>
      `;
    }).join('');
  }

  function renderTrend() {
    const data = last6Months();
    drawTrend('trend', data, false);
    if (!$('#sheet-trend').hidden) drawTrend('trend-big', data, true);
    renderMonthTable(data);
  }

  function renderMonthTable(data) {
    const el = $('#month-table');
    if (!el) return;
    const maxV = Math.max(...data.map(d => Math.max(d.income, d.expense)), 1);
    el.innerHTML = data.map(d => `
      <div class="month-row">
        <span class="month-name">${d.label}</span>
        <div class="month-bars">
          <div class="month-bar income" style="width:${d.income / maxV * 100}%"></div>
          <div class="month-bar expense" style="width:${d.expense / maxV * 100}%"></div>
        </div>
        <div class="month-nums">
          <span class="month-in">+${fmtShort(d.income)}</span>
          <span class="month-out"> -${fmtShort(d.expense)}</span>
        </div>
      </div>
    `).join('');
  }

  function renderPlans() {
    const list = $('#plan-list');
    const all = $('#plan-all');
    const items = state.plans;
    const html = items.length === 0
      ? '<div class="empty-tip">暂无计划，点右上角管理添加</div>'
      : items.map(p => {
          const st = planStatus(p);
          const badge = st.done ? '<span style="color:var(--income);font-size:11px">✓已记录</span>'
            : st.upcoming ? `<span style="color:var(--warn);font-size:11px">${p.day}日待办</span>`
            : '<span style="color:var(--text-3);font-size:11px">已过期</span>';
          return `
            <div class="plan-item">
              <div class="plan-ico ${p.type}">${p.type === 'income' ? '💰' : '📅'}</div>
              <div class="plan-info">
                <div class="plan-name">${escapeHtml(p.name)} ${badge}</div>
                <div class="plan-meta">${p.cycle === 'monthly' ? '每月' : p.cycle === 'weekly' ? '每周' : '每年'} ${p.day ? p.day + '日' : ''}</div>
              </div>
              <span class="plan-amt ${p.type}">${p.type === 'income' ? '+' : '-'}${fmtShort(p.amount)}</span>
              ${all ? `<button class="plan-del" data-del="${p.id}">✕</button>` : ''}
            </div>
          `;
        }).join('');
    if (list) list.innerHTML = html;
    if (all) {
      all.innerHTML = html;
      all.querySelectorAll('[data-del]').forEach(btn => {
        btn.addEventListener('click', () => deletePlan(btn.dataset.del));
      });
    }
  }

  function renderGoalsSheet() {
    const list = $('#goal-all');
    if (!list) return;
    if (!state.goals || state.goals.length === 0) {
      list.innerHTML = '<div class="empty-tip">还没有存钱目标，点下方添加 →</div>';
      return;
    }
    list.innerHTML = state.goals.map(g => {
      const saved = Math.max(0, g.saved || 0);
      const target = Math.max(1, g.target || 1);
      const pct = Math.min(100, Math.round(saved / target * 100));
      const done = saved >= target;
      return `
        <div class="goal-manage-item">
          <div class="goal-manage-top">
            <span>${g.emoji || '🎯'} ${escapeHtml(g.name)}</span>
            <button class="plan-del" data-goal-del="${g.id}">✕</button>
          </div>
          <div class="goal-bar">
            <div class="goal-fill" style="width:${pct}%"></div>
          </div>
          <div class="goal-manage-meta">
            <span>${fmt(saved)} / ${fmt(target)} (${pct}%)</span>
            ${done ? '<span class="goal-done">已达成 🎉</span>' : ''}
          </div>
          <div class="goal-manage-actions">
            <button class="mini-btn" data-goal-add="${g.id}">+ 存入</button>
            <button class="mini-btn ghost" data-goal-edit="${g.id}">编辑</button>
          </div>
        </div>
      `;
    }).join('');

    list.querySelectorAll('[data-goal-del]').forEach(btn => {
      btn.addEventListener('click', () => {
        if (confirm('删除该存钱目标？')) {
          state.goals = state.goals.filter(g => g.id !== btn.dataset.goalDel);
          save(); renderGoalsSheet(); renderGoals();
        }
      });
    });
    list.querySelectorAll('[data-goal-add]').forEach(btn => {
      btn.addEventListener('click', () => {
        const g = state.goals.find(x => x.id === btn.dataset.goalAdd);
        const amt = prompt(`为「${g.name}」存入金额：`, '100');
        if (amt === null) return;
        const v = parseFloat(amt);
        if (isNaN(v) || v <= 0) return alert('请输入有效金额');
        g.saved = (g.saved || 0) + v;
        save(); renderGoalsSheet(); renderGoals();
      });
    });
    list.querySelectorAll('[data-goal-edit]').forEach(btn => {
      btn.addEventListener('click', () => editGoal(btn.dataset.goalEdit));
    });
  }

  function editGoal(id) {
    const g = id ? state.goals.find(x => x.id === id) : null;
    const name = prompt('目标名称：', g ? g.name : '');
    if (name === null) return;
    const emoji = prompt('图标 emoji（可选）：', g ? (g.emoji || '🎯') : '🎯');
    if (emoji === null) return;
    const target = prompt('目标金额：', g ? g.target : '');
    if (target === null) return;
    const t = parseFloat(target);
    if (isNaN(t) || t <= 0) return alert('请输入有效目标金额');
    const saved = prompt('已存金额（可选，默认0）：', g ? g.saved : '0');
    if (saved === null) return;
    const sv = parseFloat(saved) || 0;
    const deadline = prompt('目标日期（可选，如 2026-12-31）：', g ? (g.deadline || '') : '');

    if (g) {
      g.name = name.trim() || g.name;
      g.emoji = emoji.trim() || '🎯';
      g.target = t;
      g.saved = sv;
      g.deadline = deadline.trim();
    } else {
      state.goals.push({ id: uid(), name: name.trim(), target: t, saved: sv, emoji: emoji.trim() || '🎯', deadline: deadline.trim() });
    }
    save(); renderGoalsSheet(); renderGoals();
  }

  function renderBills() {
    const list = $('#bill-list');
    const all = $('#bills-all');
    let bills = [...state.bills].sort((a, b) => new Date(b.date) - new Date(a.date));
    if (billFilter !== 'all') bills = bills.filter(b => b.type === billFilter);

    const recent = bills.slice(0, 8);
    renderBillItems(list, recent, false);
    if (all) renderBillItems(all, bills.slice(0, 200), true);
  }

  function renderBillItems(container, bills, withReceipt) {
    if (!container) return;
    if (bills.length === 0) {
      container.innerHTML = '<div class="empty-tip">暂无记录</div>';
      return;
    }
    container.innerHTML = bills.map(b => {
      const c = catDef(b.type, b.category);
      const sign = b.type === 'income' ? '+' : (b.type === 'transfer' ? '' : '-');
      const cls = b.type;
      const note = b.note || c.name;
      const accName = state.accounts.find(a => a.id === b.account)?.name || '';
      const toName = b.toAccount ? state.accounts.find(a => a.id === b.toAccount)?.name : '';
      const sub = b.type === 'transfer' ? `${accName} → ${toName}` : accName;
      const receipt = withReceipt && b.receipt ? `<span class="bill-receipt" data-receipt="${b.id}">🧾</span>` : '';
      return `
        <div class="bill-item" data-id="${b.id}">
          <div class="bill-ico">${c.emoji}</div>
          <div class="bill-body">
            <div class="bill-cat">${escapeHtml(note)}</div>
            <div class="bill-note">${sub} · ${b.date.slice(5)}</div>
          </div>
          ${receipt}
          <span class="bill-amt ${cls}">${sign}${fmt(b.amount)}</span>
        </div>
      `;
    }).join('');

    // 绑定删除与收据查看
    container.querySelectorAll('.bill-item').forEach(item => {
      item.addEventListener('click', e => {
        if (e.target.closest('[data-receipt]')) {
          const id = e.target.closest('[data-receipt]').dataset.receipt;
          const b = state.bills.find(x => x.id === id);
          if (b && b.receipt) showReceipt(b.receipt);
          return;
        }
        if (confirm('删除这条记录？')) deleteBill(item.dataset.id);
      });
    });
  }

  function showReceipt(dataUrl) {
    const w = window.open('', '_blank');
    if (w) {
      w.document.write(`<img src="${dataUrl}" style="max-width:100%">`);
      w.document.title = '小票';
    } else {
      toast('请允许弹出窗口查看小票');
    }
  }

  // ===== 图表绘制 =====
  function drawPie(canvasId, entries, total) {
    const cv = document.getElementById(canvasId);
    if (!cv) return;
    const ctx = cv.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    const size = 160;
    cv.width = size * dpr; cv.height = size * dpr;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, size, size);

    const cx = size / 2, cy = size / 2, r = size / 2 - 4, inner = r * 0.62;
    if (total <= 0) {
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.arc(cx, cy, inner, 0, Math.PI * 2, true);
      ctx.fillStyle = '#eef1f4';
      ctx.fill('evenodd');
      return;
    }
    let start = -Math.PI / 2;
    entries.forEach(e => {
      const angle = (e.amount / total) * Math.PI * 2;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.arc(cx, cy, r, start, start + angle);
      ctx.closePath();
      ctx.fillStyle = e.color;
      ctx.fill();
      start += angle;
    });
    // 挖空中心
    ctx.beginPath();
    ctx.arc(cx, cy, inner, 0, Math.PI * 2);
    ctx.fillStyle = '#fff';
    ctx.fill();
  }

  function drawTrend(canvasId, data, big) {
    const cv = document.getElementById(canvasId);
    if (!cv) return;
    const ctx = cv.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    const W = 640, H = big ? 320 : 200;
    cv.width = W * dpr; cv.height = H * dpr;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, W, H);

    const padL = 50, padR = 16, padT = 20, padB = 28;
    const plotW = W - padL - padR, plotH = H - padT - padB;
    const maxV = Math.max(...data.map(d => Math.max(d.income, d.expense)), 1);
    const xStep = plotW / (data.length - 1);
    const y = v => padT + plotH - (v / maxV) * plotH;
    const x = i => padL + i * xStep;

    // 网格线
    ctx.strokeStyle = '#eef1f4';
    ctx.lineWidth = 1;
    for (let i = 0; i <= 4; i++) {
      const gy = padT + plotH * i / 4;
      ctx.beginPath(); ctx.moveTo(padL, gy); ctx.lineTo(W - padR, gy); ctx.stroke();
      ctx.fillStyle = '#9aa3af'; ctx.font = '11px sans-serif';
      ctx.textAlign = 'right';
      ctx.fillText(fmtShort(maxV * (4 - i) / 4), padL - 8, gy + 4);
    }

    // X 轴标签
    ctx.fillStyle = '#9aa3af'; ctx.font = '11px sans-serif'; ctx.textAlign = 'center';
    data.forEach((d, i) => ctx.fillText(d.label, x(i), H - 8));

    // 线
    function line(key, color) {
      ctx.beginPath();
      data.forEach((d, i) => {
        const px = x(i), py = y(d[key]);
        if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      });
      ctx.strokeStyle = color; ctx.lineWidth = 2.5; ctx.lineJoin = 'round';
      ctx.stroke();
      // 点
      data.forEach((d, i) => {
        ctx.beginPath(); ctx.arc(x(i), y(d[key]), 3.5, 0, Math.PI * 2);
        ctx.fillStyle = color; ctx.fill();
        if (big) {
          ctx.fillStyle = '#5b6470'; ctx.font = '11px sans-serif'; ctx.textAlign = 'center';
          ctx.fillText(fmtShort(d[key]), x(i), y(d[key]) - 10);
        }
      });
    }
    line('income', '#16a34a');
    line('expense', '#ef4444');
    if (big) line('balance', '#3b82f6');
  }

  // ===== 弹窗 =====
  let activeSheet = null;
  let addType = 'expense';
  let selectedCat = 'food';
  let receiptData = null;

  function openSheet(id) {
    closeSheet();
    const el = document.getElementById('sheet-' + id);
    if (!el) return;
    activeSheet = id;
    el.hidden = false;
    $('#mask').hidden = false;
    if (id === 'add') resetAddForm();
    if (id === 'bills') renderBills();
    if (id === 'trend') renderTrend();
    if (id === 'plan') renderPlans();
    if (id === 'goal') renderGoalsSheet();
    if (id === 'budget') renderBudgetSheet();
    if (id === 'accounts') renderAccounts();
  }

  function closeSheet() {
    $$('.sheet').forEach(s => s.hidden = true);
    $('#mask').hidden = true;
    activeSheet = null;
  }

  // 记一笔表单
  function resetAddForm() {
    addType = 'expense';
    selectedCat = 'food';
    receiptData = null;
    $$('.type-tab').forEach(t => t.classList.toggle('active', t.dataset.type === 'expense'));
    $('#f-amount').value = '';
    $('#f-note').value = '';
    $('#f-date').value = todayStr();
    $('#receipt-preview').hidden = true;
    $('#receipt-label').textContent = '📷 上传小票';
    renderCatChips();
    renderAccountSelects();
    updateAddFields();
  }

  function renderCatChips() {
    const wrap = $('#cat-chips');
    const list = CATEGORIES[addType];
    wrap.innerHTML = list.map(c => `
      <span class="cat-chip ${c.id === selectedCat ? 'active' : ''}" data-cat="${c.id}">
        <span class="c-emoji">${c.emoji}</span>${c.name}
      </span>
    `).join('');
    wrap.querySelectorAll('.cat-chip').forEach(ch => {
      ch.addEventListener('click', () => {
        selectedCat = ch.dataset.cat;
        wrap.querySelectorAll('.cat-chip').forEach(x => x.classList.toggle('active', x === ch));
      });
    });
  }

  function renderAccountSelects() {
    const sel = $('#f-account');
    const toSel = $('#f-to-account');
    const opts = state.accounts.map(a => `<option value="${a.id}">${escapeHtml(a.name)}</option>`).join('');
    sel.innerHTML = opts;
    toSel.innerHTML = opts;
    if (toSel.options.length > 1) toSel.selectedIndex = 1;
  }

  function updateAddFields() {
    $('#field-category').hidden = addType === 'transfer';
    $('#field-account').hidden = false;
    $('#field-to').hidden = addType !== 'transfer';
  }

  // 预算表单
  function renderBudgetSheet() {
    const mk = monthKey();
    const budget = getBudget(mk);
    $('#budget-input').value = budget || '';
    const o = monthOverview(mk);
    const pct = budget > 0 ? Math.min(100, o.expense / budget * 100) : 0;
    $('#budget-fill2').style.width = pct + '%';
    $('#budget-used').textContent = '已用 ' + fmtShort(o.expense);
    $('#budget-left').textContent = budget > 0 ? '剩余 ' + fmtShort(budget - o.expense) : '未设置';

    // 分类预算
    const { entries, total } = categoryBreakdown(mk);
    const catBud = state.catBudgets[mk] || {};
    const el = $('#cat-budget-list');
    if (entries.length === 0) { el.innerHTML = ''; return; }
    el.innerHTML = entries.map(e => {
      const cb = catBud[e.id] || 0;
      const cp = cb > 0 ? Math.min(100, e.amount / cb * 100) : 0;
      const col = cp > 100 ? 'var(--expense)' : cp > 80 ? 'var(--warn)' : e.color;
      return `
        <div class="cat-budget-item">
          <div class="cat-budget-head">
            <span>${e.emoji} ${e.name}</span>
            <span>${fmtShort(e.amount)}${cb > 0 ? ' / ' + fmtShort(cb) : ''}</span>
          </div>
          <div class="cat-budget-bar">
            <div class="cat-budget-fill" style="width:${cp}%;background:${col}"></div>
          </div>
        </div>
      `;
    }).join('');
  }

  // 账户表单
  function renderAccounts() {
    const el = $('#account-edit-list');
    el.innerHTML = state.accounts.map(a => `
      <div class="account-edit-item" data-id="${a.id}">
        <input value="${escapeHtml(a.name)}" data-f="name" style="flex:1.2">
        <select data-f="type" style="flex:0.8">
          <option value="asset" ${a.type === 'asset' ? 'selected' : ''}>资产</option>
          <option value="liability" ${a.type === 'liability' ? 'selected' : ''}>负债</option>
        </select>
        <input value="${a.balance}" data-f="balance" type="number" step="0.01" style="flex:1">
        <button class="ae-del" data-del="${a.id}">✕</button>
      </div>
    `).join('');
    el.querySelectorAll('.ae-del').forEach(btn => {
      btn.addEventListener('click', () => {
        state.accounts = state.accounts.filter(a => a.id !== btn.dataset.del);
        save(); renderAccounts(); renderAll();
      });
    });
    el.querySelectorAll('.account-edit-item').forEach(row => {
      row.querySelectorAll('input, select').forEach(inp => {
        inp.addEventListener('change', () => {
          const a = state.accounts.find(x => x.id === row.dataset.id);
          if (!a) return;
          const f = inp.dataset.f;
          if (f === 'name') a.name = inp.value;
          else if (f === 'type') a.type = inp.value;
          else if (f === 'balance') a.balance = parseFloat(inp.value) || 0;
          save(); renderAll();
        });
      });
    });
  }

  // ===== Toast =====
  let toastTimer;
  function toast(msg) {
    const el = $('#toast');
    el.textContent = msg;
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.hidden = true; }, 2000);
  }

  // ===== 导入导出 =====
  function exportData() {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `ledger-${todayStr()}.json`;
    a.click(); URL.revokeObjectURL(url);
    toast('已导出备份');
  }
  function importData(file) {
    const reader = new FileReader();
    reader.onload = e => {
      try {
        const data = JSON.parse(e.target.result);
        state = Object.assign(defaultState(), data);
        save(); renderAll();
        toast('导入成功');
      } catch (err) { toast('文件格式错误'); }
    };
    reader.readAsText(file);
  }

  // ===== 事件绑定 =====
  let billFilter = 'all';
  function bind() {
    // 顶部
    $('#btn-export').addEventListener('click', exportData);
    $('#btn-export2').addEventListener('click', exportData);
    $('#btn-import').addEventListener('click', () => $('#file-import').click());
    $('#file-import').addEventListener('change', e => {
      if (e.target.files[0]) importData(e.target.files[0]);
      e.target.value = '';
    });

    // 记一笔
    $('#btn-quick-add').addEventListener('click', () => openSheet('add'));
    $('#fab-add').addEventListener('click', () => openSheet('add'));
    $('#mask').addEventListener('click', closeSheet);

    // 类型切换
    $$('.type-tab').forEach(t => {
      t.addEventListener('click', () => {
        $$('.type-tab').forEach(x => x.classList.remove('active'));
        t.classList.add('active');
        addType = t.dataset.type;
        selectedCat = CATEGORIES[addType][0].id;
        renderCatChips();
        updateAddFields();
      });
    });

    // 保存账单
    $('#btn-save-bill').addEventListener('click', () => {
      const amount = parseFloat($('#f-amount').value);
      if (!amount || amount <= 0) { toast('请输入金额'); return; }
      if (addType === 'transfer' && $('#f-account').value === $('#f-to-account').value) {
        toast('转出转入账户不能相同'); return;
      }
      addBill({
        type: addType,
        category: addType === 'transfer' ? 'transfer' : selectedCat,
        amount,
        account: $('#f-account').value,
        toAccount: addType === 'transfer' ? $('#f-to-account').value : null,
        note: $('#f-note').value.trim(),
        date: $('#f-date').value || todayStr(),
        receipt: receiptData,
      });
      closeSheet();
    });

    // 小票
    $('#f-receipt').addEventListener('change', e => {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = ev => {
        receiptData = ev.target.result;
        $('#receipt-img').src = receiptData;
        $('#receipt-preview').hidden = false;
        $('#receipt-label').textContent = '📷 重新上传';
      };
      reader.readAsDataURL(file);
    });
    $('#receipt-del').addEventListener('click', () => {
      receiptData = null;
      $('#receipt-preview').hidden = true;
      $('#receipt-label').textContent = '📷 上传小票';
      $('#f-receipt').value = '';
    });

    // 快捷按钮
    $$('.quick-btn[data-page]').forEach(b => {
      b.addEventListener('click', () => openSheet(b.dataset.page));
    });
    $$('.card-link[data-page]').forEach(b => {
      b.addEventListener('click', () => openSheet(b.dataset.page));
    });

    // 账单筛选
    $$('.filter-chip').forEach(c => {
      c.addEventListener('click', () => {
        $$('.filter-chip').forEach(x => x.classList.remove('active'));
        c.classList.add('active');
        billFilter = c.dataset.f;
        renderBills();
      });
    });

    // 计划添加
    $('#btn-add-plan').addEventListener('click', () => {
      const name = $('#plan-name').value.trim();
      const amount = parseFloat($('#plan-amount').value);
      if (!name || !amount) { toast('请填写完整'); return; }
      addPlan({
        type: $('#plan-type').value,
        name, amount,
        cycle: $('#plan-cycle').value,
        day: new Date().getDate(),
      });
      $('#plan-name').value = ''; $('#plan-amount').value = '';
    });

    // 预算保存
    $('#btn-save-budget').addEventListener('click', () => {
      const v = parseFloat($('#budget-input').value) || 0;
      setBudget(monthKey(), v);
      renderBudgetSheet(); renderAll();
      toast('预算已设置');
    });

    // 存钱目标
    $('#btn-add-goal').addEventListener('click', () => editGoal(null));

    // 账户添加
    $('#btn-add-account').addEventListener('click', () => {
      const name = $('#acc-name').value.trim();
      const balance = parseFloat($('#acc-balance').value) || 0;
      if (!name) { toast('请输入账户名'); return; }
      state.accounts.push({ id: uid(), name, type: $('#acc-type').value, balance });
      save(); renderAccounts(); renderAll();
      $('#acc-name').value = ''; $('#acc-balance').value = '';
      toast('账户已添加');
    });

    // 初始日期
    $('#f-date').value = todayStr();
  }

  // ===== 初始化 =====
  function init() {
    load();
    bind();
    const now = new Date();
    $('#today-label').textContent = `${now.getMonth() + 1}月${now.getDate()}日 · 记账理财工作台`;
    renderAll();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();