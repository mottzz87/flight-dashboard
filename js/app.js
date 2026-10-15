/* flight-dashboard — 数据来自自建 flight-prices API */
'use strict';

const API = 'https://ops.nnde.de/flights/api';

const COMBOS = [
  { outbound: '2026-12-17', ret: '2027-01-10' },
  { outbound: '2026-12-17', ret: '2027-01-11' },
  { outbound: '2026-12-18', ret: '2027-01-10' },
  { outbound: '2026-12-18', ret: '2027-01-11' },
];

const DIM_LABEL = { cheapest: '最低价', direct: '直飞', fastest: '最快' };

let currentCombo = 0;
let latestRecords = [];
let historyRecords = [];

/* ---------- 工具 ---------- */
const $ = (id) => document.getElementById(id);

function fmtYen(n) {
  if (n == null) return '—';
  return '¥' + Number(n).toLocaleString('en-US');
}

function fmtDelta(d) {
  if (d == null || d === 0) return '<span class="delta flat">持平</span>';
  const cls = d < 0 ? 'down' : 'up';
  const arrow = d < 0 ? '↓' : '↑';
  return `<span class="delta ${cls}">${arrow}${Math.abs(d).toLocaleString('en-US')}</span>`;
}

function fmtDur(min) {
  if (min == null) return '';
  const h = Math.floor(min / 60), m = min % 60;
  return h > 0 ? `${h}h${m > 0 ? m + 'm' : ''}` : `${m}m`;
}

function fmtCheckedAt(iso) {
  if (!iso) return '';
  // "2026-10-16T07:20:13+09:00" -> 10/16 07:20
  const m = iso.match(/(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  return m ? `${+m[2]}/${+m[3]} ${m[4]}:${m[5]}` : iso;
}

function jstDay(iso) {
  // checkedAt 已是 +09:00，直接取日期部分
  return iso ? iso.slice(0, 10) : '';
}

function fmtDayLabel(ymd) {
  const [, mo, d] = ymd.split('-').map(Number);
  const dt = new Date(Date.UTC(2026, mo - 1, d));
  const week = ['日', '一', '二', '三', '四', '五', '六'][dt.getUTCDay()];
  return `${mo}/${d} 周${week}`;
}

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function legHtml(tag, summary, transit) {
  if (!summary) return '';
  return `<div class="leg"><span class="leg-tag">${tag}</span>${esc(summary)}` +
    (transit && transit !== '直飞无中转' ? `<span class="transit">${esc(transit)}</span>` : '') +
    `</div>`;
}

function recordCard(r, hero) {
  if (!r || r.available === false || r.priceYen == null) {
    return `<div class="${hero ? 'price-hero' : 'dim-card'}">
      <div class="dim-label">${DIM_LABEL[r ? r.dimension : 'direct'] || ''}</div>
      <div class="empty">本组合暂无直飞方案</div></div>`;
  }
  const label = DIM_LABEL[r.dimension] || r.dimension;
  const pill = r.dimension === 'cheapest' ? '<span class="pill">含税总价</span>' : '';
  return `<div class="${hero ? 'price-hero' : 'dim-card'}">
    <div class="price-row">
      <div><span class="dim-label">${label}${pill}</span></div>
    </div>
    <div class="price-row" style="margin-top:2px">
      <div class="price">${fmtYen(r.priceYen)}${fmtDelta(r.deltaYen)}</div>
    </div>
    <div class="meta"><b>${esc(r.airline || '')}</b>${r.provider ? ' · ' + esc(r.provider) : ''}${r.totalDurationMinutes ? ' · 共' + fmtDur(r.totalDurationMinutes) : ''}</div>
    <div class="journey">
      ${legHtml('去', r.outboundSummary, r.outboundTransferDetails)}
      ${legHtml('返', r.returnSummary, r.returnTransferDetails)}
    </div>
    ${r.warnings ? `<div class="warn">⚠️ ${esc(r.warnings)}</div>` : ''}
  </div>`;
}

/* ---------- 渲染 ---------- */
function renderCombos() {
  $('combos').innerHTML = COMBOS.map((c, i) => {
    const o = c.outbound.slice(5).replace('-', '/');
    const r = c.ret.slice(5).replace('-', '/');
    return `<button class="combo${i === currentCombo ? ' active' : ''}" data-i="${i}">
      ${o} → ${r}<small>去 ${o} · 返 ${r}</small></button>`;
  }).join('');
  document.querySelectorAll('.combo').forEach((b) =>
    b.addEventListener('click', () => {
      if (+b.dataset.i === currentCombo) return;
      currentCombo = +b.dataset.i;
      renderAll();
    })
  );
}

function latestFor(dim) {
  const c = COMBOS[currentCombo];
  return latestRecords.find((r) =>
    r.outboundDate === c.outbound && r.returnDate === c.ret && r.dimension === dim);
}

function renderLatest() {
  const cheap = latestFor('cheapest');
  const direct = latestFor('direct');
  const fast = latestFor('fastest');
  $('latest').innerHTML =
    recordCard(cheap, true) +
    `<div class="dim-grid">${recordCard(direct, false)}${recordCard(fast, false)}</div>`;
}

function dailyMin(dimension) {
  // { 'YYYY-MM-DD': record }
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

function renderChart() {
  const canvas = $('chart');
  const days = dailyMin('cheapest');
  if (!days.length) {
    canvas.style.display = 'none';
    $('chart-empty').hidden = false;
    return;
  }
  canvas.style.display = '';
  $('chart-empty').hidden = true;

  const dpr = window.devicePixelRatio || 1;
  const W = canvas.clientWidth, H = canvas.clientHeight;
  canvas.width = W * dpr;
  canvas.height = H * dpr;
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, W, H);

  const prices = days.map(([, r]) => r.priceYen);
  const min = Math.min(...prices), max = Math.max(...prices);
  const pad = { l: 46, r: 10, t: 12, b: 20 };
  const iw = W - pad.l - pad.r, ih = H - pad.t - pad.b;
  const span = Math.max(max - min, 1);
  const x = (i) => pad.l + (days.length === 1 ? iw / 2 : (iw * i) / (days.length - 1));
  const y = (p) => pad.t + ih - ((p - min) / span) * ih;

  // 网格 + 标签
  ctx.font = '10px -apple-system, sans-serif';
  ctx.fillStyle = '#6b7484';
  ctx.strokeStyle = 'rgba(255,255,255,0.07)';
  ctx.lineWidth = 1;
  const ticks = 4;
  for (let i = 0; i <= ticks; i++) {
    const v = min + (span * i) / ticks;
    const yy = y(v);
    ctx.beginPath(); ctx.moveTo(pad.l, yy); ctx.lineTo(W - pad.r, yy); ctx.stroke();
    ctx.fillText('¥' + Math.round(v / 1000) + 'k', 4, yy + 3);
  }
  // 日期标签（最多 6 个）
  const step = Math.max(1, Math.ceil(days.length / 6));
  ctx.textAlign = 'center';
  days.forEach(([day], i) => {
    if (i % step === 0 || i === days.length - 1) {
      ctx.fillText(day.slice(5).replace('-', '/'), x(i), H - 6);
    }
  });
  ctx.textAlign = 'left';

  // 面积 + 折线
  const grad = ctx.createLinearGradient(0, pad.t, 0, pad.t + ih);
  grad.addColorStop(0, 'rgba(10,132,255,0.35)');
  grad.addColorStop(1, 'rgba(10,132,255,0.02)');
  ctx.beginPath();
  days.forEach(([, r], i) => { i ? ctx.lineTo(x(i), y(r.priceYen)) : ctx.moveTo(x(i), y(r.priceYen)); });
  ctx.strokeStyle = '#0a84ff';
  ctx.lineWidth = 2;
  ctx.lineJoin = 'round';
  ctx.stroke();
  ctx.lineTo(x(days.length - 1), pad.t + ih);
  ctx.lineTo(x(0), pad.t + ih);
  ctx.closePath();
  ctx.fillStyle = grad;
  ctx.fill();

  // 数据点
  ctx.fillStyle = '#0a84ff';
  days.forEach(([, r], i) => {
    ctx.beginPath(); ctx.arc(x(i), y(r.priceYen), 2.5, 0, Math.PI * 2); ctx.fill();
  });
}

function renderHistory() {
  const cheapDays = dailyMin('cheapest');
  const directDays = new Map(dailyMin('direct'));
  const box = $('history');
  if (!cheapDays.length) {
    box.innerHTML = '<div class="loading">暂无历史数据</div>';
    return;
  }
  const rows = cheapDays.slice().reverse();
  box.innerHTML = rows.map(([day, r]) => {
    const d = directDays.get(day);
    return `<div class="day" data-day="${day}">
      <button class="day-head">
        <span class="day-date">${fmtDayLabel(day)}</span>
        <span class="day-direct">直飞 <b>${d ? fmtYen(d.priceYen) : '无'}</b></span>
        <span class="day-cheap">${fmtYen(r.priceYen)}</span>
        <span class="chev">▾</span>
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
    b.addEventListener('click', () => b.closest('.day').classList.toggle('open'))
  );
}

function renderUpdated() {
  const c = COMBOS[currentCombo];
  const recs = latestRecords.filter((r) => r.outboundDate === c.outbound && r.returnDate === c.ret);
  const newest = recs.map((r) => r.checkedAt).filter(Boolean).sort().pop();
  const el = $('updated');
  if (newest) {
    $('updated-text').textContent = '更新于 ' + fmtCheckedAt(newest);
    const ageH = (Date.now() - new Date(newest).getTime()) / 36e5;
    el.classList.toggle('stale', ageH > 6);
  } else {
    $('updated-text').textContent = '暂无数据';
  }
}

function renderAll() {
  renderCombos();
  renderLatest();
  renderChart();
  renderHistory();
  renderUpdated();
}

/* ---------- 启动 ---------- */
async function load() {
  $('latest').innerHTML = '<div class="loading">正在加载价格数据…</div>';
  try {
    const [latestRes, histRes] = await Promise.all([
      fetch(`${API}/latest`).then((r) => { if (!r.ok) throw new Error('latest ' + r.status); return r.json(); }),
      fetch(`${API}/history?limit=1000`).then((r) => { if (!r.ok) throw new Error('history ' + r.status); return r.json(); }),
    ]);
    latestRecords = (latestRes.records || []).filter((r) => r.ok !== false);
    historyRecords = histRes.records || [];
    renderAll();
  } catch (e) {
    $('latest').innerHTML = `<div class="error">数据加载失败：${esc(e.message)}<br>请检查网络或稍后重试。</div>`;
    $('updated-text').textContent = '加载失败';
  }
}

window.addEventListener('resize', () => { if (latestRecords.length) renderChart(); });
document.addEventListener('DOMContentLoaded', load);
