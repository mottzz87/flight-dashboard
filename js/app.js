/* flight-dashboard — 暖色 Apple 风格 · 数据来自自建 flight-prices API */
'use strict';

const API = 'https://ops.nnde.de/flights/api';

const COMBOS = [
  { outbound: '2026-12-17', ret: '2027-01-10' },
  { outbound: '2026-12-17', ret: '2027-01-11' },
  { outbound: '2026-12-18', ret: '2027-01-10' },
  { outbound: '2026-12-18', ret: '2027-01-11' },
];

const DIM_LABEL = { cheapest: '最低价', direct: '直飞', fastest: '最快' };
const EASE = [0.28, 0.11, 0.32, 1];
const PAGE_SIZE = 7;

let currentCombo = 0;
let latestRecords = [];
let historyRecords = [];
let shownPrice = 0;
let historyPage = 0;

/* ---------- 工具 ---------- */
const $ = (id) => document.getElementById(id);

function fmtYen(n) {
  if (n == null) return '—';
  return '¥' + Number(n).toLocaleString('en-US');
}

function fmtDur(min) {
  if (min == null) return '';
  const h = Math.floor(min / 60), m = min % 60;
  return h > 0 ? `${h}h${m > 0 ? m + 'm' : ''}` : `${m}m`;
}

function fmtCheckedAt(iso) {
  if (!iso) return '';
  const m = iso.match(/(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  return m ? `${+m[2]}/${+m[3]} ${m[4]}:${m[5]}` : iso;
}

function jstDay(iso) {
  return iso ? iso.slice(0, 10) : '';
}

function fmtDayLabel(ymd) {
  const [y, mo, d] = ymd.split('-').map(Number);
  const week = ['日', '一', '二', '三', '四', '五', '六'][new Date(Date.UTC(y, mo - 1, d)).getUTCDay()];
  return `${mo}/${d} 周${week}`;
}

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/* ---------- 动画 ---------- */
function motionLib() { return window.Motion || null; }

function canAnimate() {
  if (!motionLib()) return false;
  return !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function playIntro() {
  const M = motionLib();
  if (!canAnimate()) return;
  M.animate([...document.querySelectorAll('.hero .reveal')],
    { opacity: [0, 1], y: [26, 0] }, { duration: 0.8, ease: EASE, delay: M.stagger(0.09) });
  M.animate('.nav', { opacity: [0, 1], y: [-12, 0] }, { duration: 0.6, ease: EASE });
  document.querySelectorAll('.reveal-scroll').forEach((el) => {
    M.inView(el, () => {
      if (el.dataset.shown) return;
      el.dataset.shown = '1';
      M.animate(el, { opacity: [0, 1], y: [36, 0] }, { duration: 0.8, ease: EASE });
    }, { amount: 0.08 });
  });
}

/* ---------- 卡片 ---------- */
function legHtml(tag, summary, transit) {
  if (!summary) return '';
  // 摘要自带"去/返"前缀时去掉，避免和标签叠字成"去去"
  const clean = String(summary).replace(/^[去返]\s*/, '');
  // 中转信息若已写在摘要里（如 ｜广州白云中转等待3h30m），不再另起一行重复
  const t = transit && transit !== '直飞无中转' ? String(transit) : '';
  const dup = t && clean.replace(/\s+/g, '').includes(t.replace(/\s+/g, ''));
  return `<div class="leg"><span class="leg-tag">${tag}</span>${esc(clean)}` +
    (t && !dup ? `<span class="transit">${esc(t)}</span>` : '') +
    `</div>`;
}

function deltaPill(d) {
  if (d == null || d === 0) return '<span class="delta-pill flat">持平</span>';
  const cls = d < 0 ? 'down' : 'up';
  const arrow = d < 0 ? '↓' : '↑';
  return `<span class="delta-pill ${cls}">${arrow}${Math.abs(d).toLocaleString('en-US')}</span>`;
}

function dimCard(r) {
  const label = DIM_LABEL[r.dimension] || r.dimension;
  if (!r || r.available === false || r.priceYen == null) {
    return `<div class="card"><div class="card-eyebrow">${label}</div>` +
      `<p class="empty-note">本组合暂无直飞方案</p></div>`;
  }
  return `<div class="card">
    <div class="card-eyebrow">${label}</div>
    <div class="card-price">${fmtYen(r.priceYen)}</div>
    <div class="card-meta"><b>${esc(r.airline || '')}</b>${r.provider ? ' · ' + esc(r.provider) : ''}${r.totalDurationMinutes ? ' · 共' + fmtDur(r.totalDurationMinutes) : ''}</div>
    <div class="journey">
      ${legHtml('去', r.outboundSummary, r.outboundTransferDetails)}
      ${legHtml('返', r.returnSummary, r.returnTransferDetails)}
    </div>
    ${r.warnings ? `<div class="warn">⚠️ ${esc(r.warnings)}</div>` : ''}
  </div>`;
}

function latestFor(dim) {
  const c = COMBOS[currentCombo];
  return latestRecords.find((r) =>
    r.outboundDate === c.outbound && r.returnDate === c.ret && r.dimension === dim);
}

/* ---------- 组合切换器 ---------- */
function renderCombos() {
  const box = $('combos');
  box.querySelectorAll('.seg-btn').forEach((b) => b.remove());
  COMBOS.forEach((c, i) => {
    const o = c.outbound.slice(5).replace('-', '/');
    const r = c.ret.slice(5).replace('-', '/');
    const b = document.createElement('button');
    b.className = 'seg-btn' + (i === currentCombo ? ' active' : '');
    b.setAttribute('role', 'tab');
    b.innerHTML = `${o} → ${r}<small>去 ${o} · 返 ${r}</small>`;
    b.addEventListener('click', () => transitionCombo(i));
    box.appendChild(b);
  });
  moveIndicator(false);
}

function moveIndicator(animated) {
  const M = motionLib();
  const btns = [...document.querySelectorAll('.seg-btn')];
  const active = btns[currentCombo];
  const ind = $('seg-ind');
  if (!active) return;
  const x = active.offsetLeft, w = active.offsetWidth;
  if (animated && canAnimate()) {
    M.animate(ind, { x, width: w }, { type: 'spring', stiffness: 480, damping: 42 });
  } else {
    ind.style.transform = `translateX(${x}px)`;
    ind.style.width = w + 'px';
  }
}

/* ---------- Hero ---------- */
function setHeroPrice(to, animated) {
  const M = motionLib();
  const el = $('hero-price');
  if (animated && canAnimate()) {
    M.animate(shownPrice, to, {
      duration: 0.9, ease: EASE,
      onUpdate: (v) => { el.textContent = fmtYen(Math.round(v)); },
    });
  } else {
    el.textContent = fmtYen(to);
  }
  shownPrice = to;
}

function renderHero(animated) {
  const c = COMBOS[currentCombo];
  const r = latestFor('cheapest');
  $('hero-combo').textContent = `${c.outbound.slice(5).replace('-', '/')} → ${c.ret.slice(5).replace('-', '/')}`;
  if (!r || r.priceYen == null) {
    setHeroPrice(0, false);
    $('hero-price').textContent = '¥—';
    $('hero-delta').innerHTML = '';
    $('hero-sub').innerHTML = '';
    return;
  }
  setHeroPrice(r.priceYen, animated);
  $('hero-delta').innerHTML = deltaPill(r.deltaYen);
  $('hero-sub').innerHTML =
    `<b>${esc(r.airline || '')}</b>${r.provider ? ' · ' + esc(r.provider) : ''}${r.totalDurationMinutes ? ' · 共' + fmtDur(r.totalDurationMinutes) : ''}`;
}

/* ---------- Bento ---------- */
function renderBento(animated) {
  const order = ['cheapest', 'direct', 'fastest'];
  $('bento').innerHTML = order.map((dim, i) =>
    `<div class="${i === 0 ? 'bento-main' : ''}">${dimCard(latestFor(dim))}</div>`).join('');
  const M = motionLib();
  if (animated && canAnimate()) {
    M.animate($('bento').querySelectorAll('.card'),
      { opacity: [0, 1], y: [24, 0] }, { duration: 0.6, ease: EASE, delay: M.stagger(0.08) });
  }
}

/* 组合切换：旧内容淡出 → 重渲染 → 新内容浮现 */
function transitionCombo(i) {
  if (i === currentCombo) return;
  currentCombo = i;
  historyPage = 0;
  const M = motionLib();
  document.querySelectorAll('.seg-btn').forEach((b, bi) => b.classList.toggle('active', bi === i));
  moveIndicator(true);
  const finish = () => {
    renderHero(true);
    renderBento(true);
    renderUpdated();
    renderChart(true);
    renderHistory(true);
  };
  if (canAnimate()) {
    const kids = [$('hero-price'), $('hero-delta'), $('hero-sub'), $('hero-combo')];
    M.animate(kids, { opacity: [1, 0], y: [0, 10] }, { duration: 0.16, ease: 'easeIn' })
      .finished.then(() => {
        finish();
        M.animate(kids, { opacity: [0, 1], y: [10, 0] }, { duration: 0.4, ease: EASE });
      }, () => { finish(); });
  } else {
    finish();
  }
}

/* ---------- 历史聚合 ---------- */
function dailyMin(dimension) {
  const c = COMBOS[currentCombo];
  const map = new Map();
  for (const r of historyRecords) {
    if (r.outboundDate !== c.outbound || r.returnDate !== c.ret) continue;
    if (r.dimension !== dimension) continue;
    if (r.available === false || r.priceYen == null) continue;
    const day = jstDay(r.checkedAt);
    const prev = map.get(day);
    if (!prev || r.priceYen < prev.priceYen) map.set(day, r);
  }
  return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
}

/* ---------- 走势图 ---------- */
function chartGeom() {
  const days = dailyMin('cheapest');
  if (!days.length) return null;
  const canvas = $('chart');
  const W = canvas.clientWidth, H = canvas.clientHeight;
  if (!W || !H) return null;
  const prices = days.map(([, r]) => r.priceYen);
  const min = Math.min(...prices), max = Math.max(...prices);
  const pad = { l: 48, r: 12, t: 14, b: 22 };
  const iw = W - pad.l - pad.r, ih = H - pad.t - pad.b;
  const span = Math.max(max - min, 1);
  return {
    canvas, days, W, H, pad, min, span,
    x: (i) => pad.l + (days.length === 1 ? iw / 2 : (iw * i) / (days.length - 1)),
    y: (p) => pad.t + ih - ((p - min) / span) * ih,
  };
}

function paintChart(g, progress) {
  const { canvas, days, W, H, pad, x, y, min, span } = g;
  const dpr = window.devicePixelRatio || 1;
  canvas.width = W * dpr;
  canvas.height = H * dpr;
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, W, H);

  ctx.font = '11px -apple-system, sans-serif';
  ctx.fillStyle = '#b8ad9c';
  ctx.strokeStyle = 'rgba(244,239,230,0.08)';
  ctx.lineWidth = 1;
  for (let i = 0; i <= 4; i++) {
    const v = min + (span * i) / 4;
    const yy = y(v);
    ctx.beginPath(); ctx.moveTo(pad.l, yy); ctx.lineTo(W - pad.r, yy); ctx.stroke();
    ctx.fillText('¥' + Math.round(v / 1000) + 'k', 6, yy + 4);
  }
  const step = Math.max(1, Math.ceil(days.length / 6));
  ctx.textAlign = 'center';
  days.forEach(([day], i) => {
    if (i % step === 0 || i === days.length - 1) ctx.fillText(day.slice(5).replace('-', '/'), x(i), H - 6);
  });
  ctx.textAlign = 'left';

  const iw = W - pad.l - pad.r;
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, pad.l + iw * progress, H);
  ctx.clip();
  const grad = ctx.createLinearGradient(0, pad.t, 0, pad.t + (H - pad.t - pad.b));
  grad.addColorStop(0, 'rgba(217,167,95,0.32)');
  grad.addColorStop(1, 'rgba(217,167,95,0.02)');
  ctx.beginPath();
  days.forEach(([, r], i) => { i ? ctx.lineTo(x(i), y(r.priceYen)) : ctx.moveTo(x(i), y(r.priceYen)); });
  ctx.strokeStyle = '#d9a75f';
  ctx.lineWidth = 2.5;
  ctx.lineJoin = 'round';
  ctx.stroke();
  ctx.lineTo(x(days.length - 1), pad.t + (H - pad.t - pad.b));
  ctx.lineTo(x(0), pad.t + (H - pad.t - pad.b));
  ctx.closePath();
  ctx.fillStyle = grad;
  ctx.fill();
  ctx.restore();

  days.forEach(([, r], i) => {
    const a = Math.max(0, Math.min(1, progress * days.length - i));
    if (a <= 0) return;
    ctx.globalAlpha = a;
    ctx.fillStyle = '#d9a75f';
    ctx.beginPath(); ctx.arc(x(i), y(r.priceYen), 3, 0, Math.PI * 2); ctx.fill();
  });
  ctx.globalAlpha = 1;
}

function renderChart(animated) {
  const canvas = $('chart');
  const g = chartGeom();
  if (!g) {
    canvas.style.display = 'none';
    $('chart-empty').hidden = false;
    return;
  }
  canvas.style.display = '';
  $('chart-empty').hidden = true;
  const M = motionLib();
  if (animated && canAnimate()) {
    const gg = chartGeom();
    M.animate(0, 1, { duration: 1.1, ease: EASE, onUpdate: (v) => paintChart(gg, v) });
  } else {
    paintChart(g, 1);
  }
}

/* ---------- 每日汇总 + 分页 ---------- */
function renderHistory(animated) {
  const cheapDays = dailyMin('cheapest');
  const directDays = new Map(dailyMin('direct'));
  const box = $('history');
  const pager = $('pager');
  if (!cheapDays.length) {
    box.innerHTML = '<div class="loading">暂无历史数据</div>';
    pager.hidden = true;
    return;
  }
  const totalPages = Math.max(1, Math.ceil(cheapDays.length / PAGE_SIZE));
  historyPage = Math.min(historyPage, totalPages - 1);
  const rows = cheapDays.slice().reverse()
    .slice(historyPage * PAGE_SIZE, (historyPage + 1) * PAGE_SIZE);
  box.innerHTML = rows.map(([day, r]) => {
    const d = directDays.get(day);
    return `<div class="day" data-day="${day}">
      <button class="day-head">
        <span class="day-date">${fmtDayLabel(day)}</span>
        <span class="day-direct">直飞 <b>${d ? fmtYen(d.priceYen) : '无'}</b></span>
        <span class="day-cheap">${fmtYen(r.priceYen)}</span>
        <span class="chev">›</span>
      </button>
      <div class="day-body"><div class="day-body-inner"><div class="day-detail">
        <div><h4>当天最低 · ${esc(r.airline || '')}${r.provider ? ' · ' + esc(r.provider) : ''}</h4>
          ${legHtml('去', r.outboundSummary, r.outboundTransferDetails)}
          ${legHtml('返', r.returnSummary, r.returnTransferDetails)}</div>
        ${d ? `<div><h4>当天直飞最低 · ${esc(d.airline || '')}${d.provider ? ' · ' + esc(d.provider) : ''}</h4>
          ${legHtml('去', d.outboundSummary, d.outboundTransferDetails)}
          ${legHtml('返', d.returnSummary, d.returnTransferDetails)}</div>` : ''}
      </div></div></div>
    </div>`;
  }).join('');
  box.querySelectorAll('.day-head').forEach((b) =>
    b.addEventListener('click', () => b.closest('.day').classList.toggle('open')));
  if (totalPages > 1) {
    pager.hidden = false;
    $('pg-info').textContent = `${historyPage + 1} / ${totalPages}`;
    $('pg-prev').disabled = historyPage === 0;
    $('pg-next').disabled = historyPage === totalPages - 1;
  } else {
    pager.hidden = true;
  }
  const M = motionLib();
  if (animated && canAnimate()) {
    M.animate(box.querySelectorAll('.day'),
      { opacity: [0, 1], y: [14, 0] }, { duration: 0.45, ease: EASE, delay: M.stagger(0.05) });
  }
}

function gotoPage(p) {
  const totalPages = Math.max(1, Math.ceil(dailyMin('cheapest').length / PAGE_SIZE));
  const next = Math.max(0, Math.min(totalPages - 1, p));
  if (next === historyPage) return;
  const M = motionLib();
  const box = $('history');
  const apply = () => { historyPage = next; renderHistory(true); };
  if (canAnimate()) {
    M.animate(box.querySelectorAll('.day'), { opacity: [1, 0], x: [0, -14] },
      { duration: 0.16, ease: 'easeIn' }).finished.then(apply, apply);
  } else {
    apply();
  }
}

/* ---------- 更新时间 ---------- */
function renderUpdated() {
  const c = COMBOS[currentCombo];
  const recs = latestRecords.filter((r) => r.outboundDate === c.outbound && r.returnDate === c.ret);
  const newest = recs.map((r) => r.checkedAt).filter(Boolean).sort().pop();
  const el = $('nav-status');
  if (newest) {
    $('updated-text').textContent = '更新于 ' + fmtCheckedAt(newest);
    const ageH = (Date.now() - new Date(newest).getTime()) / 36e5;
    el.classList.toggle('stale', ageH > 6);
  } else {
    $('updated-text').textContent = '暂无数据';
    el.classList.remove('stale');
  }
}

/* ---------- 启动 ---------- */
async function load() {
  if (!canAnimate()) document.documentElement.classList.remove('anim');
  renderCombos();
  try {
    const [latestRes, histRes] = await Promise.all([
      fetch(`${API}/latest`).then((r) => { if (!r.ok) throw new Error('latest ' + r.status); return r.json(); }),
      fetch(`${API}/history?limit=1000`).then((r) => { if (!r.ok) throw new Error('history ' + r.status); return r.json(); }),
    ]);
    latestRecords = (latestRes.records || []).filter((r) => r.ok !== false);
    historyRecords = histRes.records || [];
    renderHero(false);
    renderBento(false);
    renderUpdated();
    renderChart(false);
    renderHistory(false);
    requestAnimationFrame(() => {
      moveIndicator(false);
      playIntro();
      setHeroPrice((latestFor('cheapest') || {}).priceYen || 0, true);
      const M = motionLib();
      if (canAnimate()) {
        M.animate($('bento').querySelectorAll('.card'),
          { opacity: [0, 1], y: [28, 0] }, { duration: 0.7, ease: EASE, delay: M.stagger(0.1) });
        renderChart(true);
        renderHistory(true);
      }
    });
  } catch (e) {
    document.documentElement.classList.remove('anim');
    $('bento').innerHTML = `<div class="error">数据加载失败：${esc(e.message)}<br>请检查网络或稍后重试。</div>`;
    $('updated-text').textContent = '加载失败';
  }
}

function boot() {
  $('pg-prev').addEventListener('click', () => gotoPage(historyPage - 1));
  $('pg-next').addEventListener('click', () => gotoPage(historyPage + 1));
  window.addEventListener('resize', () => { moveIndicator(false); if (latestRecords.length) renderChart(false); });
  load();
}

document.addEventListener('DOMContentLoaded', boot);
