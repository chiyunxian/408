(() => {
  'use strict';
  const DATA = window.__408_DATA__;
  if (!DATA || !Array.isArray(DATA.questions)) {
    document.getElementById('content').innerHTML = '<div class="empty-state"><h3>题库数据未加载</h3><p>请确认 data/questions.js 与 index.html 在同一目录下。</p></div>';
    return;
  }
  const QUESTIONS = DATA.questions;
  const BOOKS = DATA.books;
  const POINTS = DATA.points;
  const BOOK_BY_ID = Object.fromEntries(BOOKS.map(b => [b.id, b]));
  const POINT_BY_ID = Object.fromEntries(POINTS.map(p => [p.id, p]));
  const CHAPTER_BY_ID = {};
  BOOKS.forEach(b => b.chapters.forEach(c => { CHAPTER_BY_ID[c.id] = { ...c, book: b.id, bookName: b.name, color: b.color }; }));
  const BOOK_INDEX = Object.fromEntries(BOOKS.map((b, i) => [b.id, i]));
  const SOFT = { ds: '#e4f2ef', co: '#fbf0df', os: '#fbe9e7', cn: '#e9eefc' };
  const TOTAL_BY_BOOK = {};
  const TOTAL_BY_CHAPTER = {};
  const TOTAL_BY_POINT = {};
  QUESTIONS.forEach(q => {
    TOTAL_BY_BOOK[q.book] = (TOTAL_BY_BOOK[q.book] || 0) + 1;
    TOTAL_BY_CHAPTER[q.chapter] = (TOTAL_BY_CHAPTER[q.chapter] || 0) + 1;
    TOTAL_BY_POINT[q.point] = (TOTAL_BY_POINT[q.point] || 0) + 1;
  });
  const YEARS = DATA.meta.years;
  const PAGE_SIZE = 20;

  const state = {
    view: 'bank', book: null, chapter: null, point: null, year: null,
    q: '', sort: 'year-desc', limit: PAGE_SIZE,
    revealed: new Set(), selected: new Map()
  };

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const content = $('#content');
  const sidebar = $('#sidebar');
  const overlay = $('#sidebarOverlay');
  const searchInput = $('#searchInput');
  const searchClear = $('#searchClear');
  const yearSelect = $('#yearSelect');
  const sortSelect = $('#sortSelect');
  const activeFilters = $('#activeFilters');
  const toolbar = $('#toolbar');

  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const escRe = s => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const chapterOf = q => CHAPTER_BY_ID[q.chapter] || { title: '', num: 0, book: q.book };
  const pointOf = q => POINT_BY_ID[q.point] || { title: '', chapter: q.chapter };
  const bookOf = q => BOOK_BY_ID[q.book] || BOOKS[0];
  const tokens = () => state.q.trim().toLowerCase().split(/\s+/).filter(Boolean);

  function highlight(text, toks) {
    let out = esc(text);
    if (!toks.length) return out;
    for (const t of toks) {
      const needle = esc(t);
      if (!needle) continue;
      try {
        out = out.replace(new RegExp(escRe(needle), 'gi'), m => `<mark>${m}</mark>`);
      } catch (_) {}
    }
    return out;
  }

  function looksCode(block) {
    const lines = block.split('\n').map(l => l.trim()).filter(Boolean);
    if (lines.length < 2) return false;
    const codey = lines.filter(l => /[{};]/.test(l) || /^(for|while|if|else|int|char|float|double|void|return|struct|typedef)\b/.test(l));
    return codey.length >= 1 && /[;{}]/.test(block);
  }

  function formatStem(text, toks) {
    const raw = String(text || '').trim();
    if (!raw) return '';
    const blocks = raw.split(/\n{2,}/).map(s => s.trim()).filter(Boolean);
    return blocks.map(block => {
      if (looksCode(block)) return `<pre class="code-block">${highlight(block, toks)}</pre>`;
      return `<p class="plain">${highlight(block, toks).replace(/\n/g, '<br>')}</p>`;
    }).join('');
  }

  function formatInline(text, toks) {
    return highlight(String(text || ''), toks).replace(/\n/g, '<br>');
  }

  function imageHTML(q, toks) {
    if (!q.imgs || !q.imgs.length) return '';
    const placeholder = q.options && Object.values(q.options).some(v => /见题图|见图/.test(String(v)));
    const referencesFigure = /图|如下表|下表|表格|所示|如下/.test(q.stem);
    const textTable = /\n[^\n]*\d+%[^\n]*\n[^\n]*\d+%/.test(q.stem);
    const textStruct = /\[\s*页目录号|\[页目录号|\[data\|next\]/.test(q.stem);
    if (q.options && !placeholder && (!referencesFigure || textTable || textStruct)) return '';
    const caption = !q.options ? 'A / B / C / D 选项见下图' : '题图';
    return q.imgs.map((src, i) => `<figure class="q-figure"><img src="${esc(src)}" alt="第 ${q.num} 题配图" loading="lazy" decoding="async"><figcaption>${i === 0 ? caption : '题图 ' + (i + 1)}</figcaption></figure>`).join('');
  }

  function optionHTML(q, letter, value, toks) {
    const revealed = state.revealed.has(q.id);
    const selected = state.selected.get(q.id);
    const isCorrect = letter === q.answer;
    const isSelected = selected === letter;
    let cls = 'option';
    if (revealed && isCorrect) cls += ' is-correct';
    else if (revealed && isSelected) cls += ' is-wrong';
    else if (revealed) cls += ' is-muted';
    else if (isSelected) cls += ' is-selected';
    return `<button class="${cls}" type="button" data-action="option" data-id="${q.id}" data-opt="${letter}" aria-label="选择 ${letter}">
      <span class="option-letter">${letter}</span><span class="option-text">${formatInline(value, toks)}</span>
    </button>`;
  }

  function cardHTML(q, toks) {
    const b = bookOf(q);
    const ch = chapterOf(q);
    const pt = pointOf(q);
    const revealed = state.revealed.has(q.id);
    const selected = state.selected.get(q.id);
    const style = `--book-color:${b.color};--book-soft:${SOFT[b.id] || '#eee'}`;
    const options = q.options
      ? `<div class="q-options">${['A','B','C','D'].map(L => optionHTML(q, L, q.options[L], toks)).join('')}</div>`
      : `<div class="option-note"><b>A / B / C / D</b> 选项见${q.imgs && q.imgs.length ? '下图' : '原题配图'}，请结合题图作答。</div>`;
    const answer = revealed ? `<div class="answer-strip">
        <span class="answer-badge">答案 <strong>${esc(q.answer)}</strong></span>
        <span class="answer-note">教材位置 · <b>第${ch.num}章 ${esc(ch.title)}</b> / ${esc(pt.title)}</span>
        ${selected ? `<span class="answer-note">${selected === q.answer ? '回答正确' : `你的选择：<b>${esc(selected)}</b>`}</span>` : ''}
      </div>` : '';
    return `<article class="q-card fade-in${revealed ? ' is-revealed' : ''}" id="q-${q.id}" style="${style}">
      <header class="q-head">
        <div class="q-id"><span class="q-year">${q.year}</span><span class="q-num">第 ${q.num} 题</span></div>
        <div class="q-tags"><span class="tag book">${esc(b.name)}</span><span class="tag">第${ch.num}章 ${esc(ch.title)}</span></div>
      </header>
      <div class="q-stem">${formatStem(q.stem, toks)}</div>
      ${imageHTML(q)}
      ${options}
      <footer class="q-foot">
        <span class="q-point">知识点 · <button class="point-link" type="button" data-action="point" data-point="${q.point}" data-book="${q.book}" data-chapter="${q.chapter}">${esc(pt.title)}</button></span>
        <button class="reveal-btn" type="button" data-action="reveal" data-id="${q.id}"><svg class="icon"><use href="#i-chevron"></use></svg>${revealed ? '收起答案' : '查看答案'}</button>
      </footer>
      ${answer}
    </article>`;
  }

  function filtered() {
    const toks = tokens();
    const arr = QUESTIONS.filter(q => {
      if (state.book && q.book !== state.book) return false;
      if (state.chapter && q.chapter !== state.chapter) return false;
      if (state.point && q.point !== state.point) return false;
      if (state.year && q.year !== state.year) return false;
      if (toks.length) {
        const ch = chapterOf(q), pt = pointOf(q), b = bookOf(q);
        const hay = [q.stem, q.year, q.num, ...(q.options ? Object.values(q.options) : []), pt.title, ch.title, b.name].join(' ').toLowerCase();
        if (!toks.every(t => hay.includes(t))) return false;
      }
      return true;
    });
    arr.sort((a, b) => {
      if (state.sort === 'year-asc') return a.year - b.year || a.num - b.num;
      if (state.sort === 'chapter') {
        return (BOOK_INDEX[a.book] - BOOK_INDEX[b.book]) || (chapterOf(a).num - chapterOf(b).num) || (a.year - b.year) || (a.num - b.num);
      }
      return b.year - a.year || a.num - b.num;
    });
    return arr;
  }

  function activeFilterChips() {
    const chips = [];
    if (state.book) chips.push({ key: 'book', label: '教材', value: bookOf({ book: state.book }).name });
    if (state.chapter) chips.push({ key: 'chapter', label: '章节', value: `第${chapterOf({ chapter: state.chapter }).num}章 ${chapterOf({ chapter: state.chapter }).title}` });
    if (state.point) chips.push({ key: 'point', label: '知识点', value: pointOf({ point: state.point }).title });
    if (state.year) chips.push({ key: 'year', label: '年份', value: String(state.year) });
    if (state.q.trim()) chips.push({ key: 'q', label: '搜索', value: state.q.trim() });
    return chips;
  }

  function renderActiveFilters() {
    const chips = activeFilterChips();
    activeFilters.hidden = chips.length === 0;
    activeFilters.innerHTML = chips.map(c => `<span class="filter-chip"><span>${esc(c.label)}</span><b>${esc(c.value.length > 24 ? c.value.slice(0, 24) + '…' : c.value)}</b><button type="button" data-clear="${c.key}" aria-label="移除筛选">×</button></span>`).join('');
  }

  function renderToolbar() {
    yearSelect.innerHTML = `<option value="">全部年份</option>${YEARS.slice().sort((a, b) => b - a).map(y => `<option value="${y}">${y} 年</option>`).join('')}`;
    yearSelect.value = state.year ? String(state.year) : '';
    sortSelect.value = state.sort;
    if (searchInput.value !== state.q) searchInput.value = state.q;
    searchClear.hidden = !state.q;
    toolbar.hidden = state.view === 'about';
    renderActiveFilters();
  }

  function buildSidebar() {
    const nav = $('#sideBooks');
    nav.innerHTML = BOOKS.map(b => {
      const chapters = b.chapters.filter(c => TOTAL_BY_CHAPTER[c.id]).map(c => `<button class="side-chapter" type="button" data-chapter="${c.id}" data-book="${b.id}">
        <span class="num">${String(c.num).padStart(2, '0')}</span><span class="name">${esc(c.title)}</span><span class="cnt">${TOTAL_BY_CHAPTER[c.id]}</span>
      </button>`).join('');
      return `<button class="side-book" type="button" data-book="${b.id}">
        <span class="side-book-dot" style="background:${b.color}"></span><span class="side-book-name">${esc(b.name)}</span><span class="side-book-count">${TOTAL_BY_BOOK[b.id] || 0}</span>
      </button><div class="side-chapters">${chapters}</div>`;
    }).join('');
  }

  function updateSidebar() {
    $$('#sideBooks .side-book').forEach(el => el.classList.toggle('is-active', el.dataset.book === state.book));
    $$('#sideBooks .side-chapter').forEach(el => el.classList.toggle('is-active', el.dataset.chapter === state.chapter));
  }

  function updateTopnav() {
    $$('#topnav button').forEach(el => el.classList.toggle('is-active', el.dataset.view === state.view));
  }

  function heroHTML() {
    const total = QUESTIONS.length;
    const bookCounts = BOOKS.map(b => ({ ...b, count: TOTAL_BY_BOOK[b.id] || 0 }));
    const max = Math.max(...bookCounts.map(b => b.count));
    return `<section class="hero">
      <div class="hero-copy">
        <p class="eyebrow">2009 — 2026 · 18 年真题</p>
        <h1>把 408 的 720 道选择题，<br><em>放回它该在的章节。</em></h1>
        <p class="lede">按数据结构、计算机组成原理、操作系统、计算机网络四本教材，整理为 26 个章节与 58 个知识点。可检索题干、选项和考点，点开即可对答案。</p>
        <div class="hero-actions">
          <button class="btn btn-primary" type="button" data-action="scroll-results">开始浏览 <svg class="icon"><use href="#i-arrow"></use></svg></button>
          <button class="btn btn-ghost" type="button" data-view="chapters">按章节看</button>
        </div>
        <div class="hero-stats">
          <div class="stat"><span class="stat-num">18<small>年</small></span><span class="stat-label">真题跨度</span></div>
          <div class="stat"><span class="stat-num">720<small>题</small></span><span class="stat-label">选择题</span></div>
          <div class="stat"><span class="stat-num">26<small>章</small></span><span class="stat-label">教材章节</span></div>
          <div class="stat"><span class="stat-num">58<small>个</small></span><span class="stat-label">知识点</span></div>
        </div>
      </div>
      <div class="hero-board">
        <div class="board-head"><span>题库构成 / BY BOOK</span><strong>${total}</strong></div>
        <div class="book-bars">${bookCounts.map(b => `<div class="book-bar-row"><span>${esc(b.name)}</span><div class="book-bar-track"><div class="book-bar-fill" style="width:${Math.round(b.count / max * 100)}%;background:${b.color}"></div></div><b>${b.count}</b></div>`).join('')}</div>
        <div class="board-foot"><span>2009 → 2026</span><span>每年 40 题</span></div>
      </div>
    </section>`;
  }

  function resultTitle() {
    if (state.q.trim()) return `“${state.q.trim()}” 的搜索结果`;
    if (state.point) return pointOf({ point: state.point }).title;
    if (state.chapter) { const c = chapterOf({ chapter: state.chapter }); return `第${c.num}章 ${c.title}`; }
    if (state.book) return bookOf({ book: state.book }).name;
    return '全部选择题';
  }

  function resultSub(count) {
    const parts = [];
    if (state.book) parts.push(bookOf({ book: state.book }).name);
    if (state.chapter) { const c = chapterOf({ chapter: state.chapter }); parts.push(`第${c.num}章 ${c.title}`); }
    if (state.point) parts.push(pointOf({ point: state.point }).title);
    if (state.year) parts.push(`${state.year} 年`);
    if (!parts.length) parts.push('2009—2026 年');
    return `${parts.join(' · ')} · 共 ${count} 题`;
  }

  function bankHTML() {
    const list = filtered();
    const toks = tokens();
    const noFilter = !state.book && !state.chapter && !state.point && !state.year && !state.q.trim();
    const slice = list.slice(0, state.limit);
    let html = noFilter ? heroHTML() : '';
    html += `<div class="result-head">
      <div><p class="eyebrow">${state.q.trim() ? 'Search result' : 'Question bank'}</p><h2>${esc(resultTitle())} <span>·</span></h2><p class="result-sub">${esc(resultSub(list.length))}</p></div>
      <div class="result-count"><strong>${list.length}</strong>题</div>
    </div>`;
    if (!list.length) {
      html += `<div class="empty-state"><div class="empty-mark">?</div><h3>没有找到匹配的题目</h3><p>试试更短的关键词，或清除年份、章节等筛选条件。</p><button class="btn btn-ghost" type="button" data-action="reset">清除全部筛选</button></div>`;
    } else {
      html += `<div class="results-grid" id="resultsGrid">${slice.map(q => cardHTML(q, toks)).join('')}</div>`;
      if (list.length > state.limit) {
        html += `<button class="load-more" type="button" data-action="load-more">继续加载 <b>${Math.min(PAGE_SIZE, list.length - state.limit)}</b> 题 <span>· 还剩 ${list.length - state.limit} 题</span></button>`;
      }
    }
    return html;
  }

  function chapterCounts() {
    const list = filtered();
    const map = {};
    list.forEach(q => { map[q.chapter] = (map[q.chapter] || 0) + 1; });
    return map;
  }

  function chaptersHTML() {
    const counts = chapterCounts();
    const total = Object.values(counts).reduce((a, b) => a + b, 0);
    let html = `<div class="page-head"><p class="eyebrow">Chapters / 按章节</p><h1>四本教材，26 个章节</h1><p>每一章都对应一组真题。点击章节卡片，即可进入该章的选择题列表。</p><div class="head-meta"><span class="meta-pill">当前范围 <b>${total}</b> 题</span><span class="meta-pill">4 本教材</span><span class="meta-pill">26 个章节</span><span class="meta-pill">58 个知识点</span></div></div>`;
    for (const b of BOOKS) {
      const rows = b.chapters.filter(c => counts[c.id]);
      if (!rows.length) continue;
      const bookCount = rows.reduce((a, c) => a + counts[c.id], 0);
      html += `<section class="book-section" style="--book-color:${b.color}">
        <div class="book-section-head"><span class="book-dot" style="background:${b.color}"></span><h2>${esc(b.name)}</h2><span>${bookCount} 题</span><span class="line"></span></div>
        <div class="chapter-grid">${rows.map(c => {
          const n = counts[c.id];
          const pts = POINTS.filter(p => p.chapter === c.id && TOTAL_BY_POINT[p.id]).sort((x, y) => TOTAL_BY_POINT[y.id] - TOTAL_BY_POINT[x.id]).slice(0, 2).map(p => p.title);
          return `<button class="chapter-card" type="button" data-action="chapter" data-chapter="${c.id}" data-book="${b.id}" style="--book-color:${b.color}">
            <span class="chapter-num">CHAPTER ${String(c.num).padStart(2, '0')}</span>
            <h3>${esc(c.title)}</h3>
            <p>${esc(pts.join(' · ') || '本章知识点')}</p>
            <span class="chapter-meta"><span>${n} 题</span><b>进入本章 →</b></span>
          </button>`;
        }).join('')}</div>
      </section>`;
    }
    if (!html.includes('book-section')) html += `<div class="empty-state"><div class="empty-mark">?</div><h3>没有匹配的章节</h3><p>试试清除搜索词或年份筛选。</p></div>`;
    return html;
  }

  function pointsHTML() {
    const list = filtered();
    const counts = {};
    list.forEach(q => { counts[q.point] = (counts[q.point] || 0) + 1; });
    const totalPoints = Object.keys(counts).length;
    let html = `<div class="page-head"><p class="eyebrow">Knowledge points / 知识点</p><h1>58 个知识点，一张索引</h1><p>每道题标注一个主知识点。点击任意知识点，筛出考过它的全部选择题。</p><div class="head-meta"><span class="meta-pill">当前范围 <b>${totalPoints}</b> 个知识点</span><span class="meta-pill">共 <b>${list.length}</b> 题</span></div></div>`;
    let any = false;
    for (const b of BOOKS) {
      const bookPoints = POINTS.filter(p => p.book === b.id && counts[p.id]);
      if (!bookPoints.length) continue;
      any = true;
      const max = Math.max(...bookPoints.map(p => counts[p.id]));
      html += `<section class="point-section" style="--book-color:${b.color}"><div class="point-section-head"><span class="book-dot" style="background:${b.color};--book-color:${b.color}"></span><h2>${esc(b.name)}</h2></div>`;
      for (const c of b.chapters) {
        const rows = bookPoints.filter(p => p.chapter === c.id);
        if (!rows.length) continue;
        html += `<div class="point-group"><div class="point-group-head"><b>第${c.num}章</b><span>${esc(c.title)}</span><span style="margin-left:auto">${rows.reduce((a, p) => a + counts[p.id], 0)} 题</span></div><div class="point-rows">${rows.map(p => `<button class="point-row" type="button" data-action="point" data-point="${p.id}" data-book="${b.id}" data-chapter="${p.chapter}">
          <span class="point-row-main"><span class="point-name">${esc(p.title)}</span><span class="point-bar"><i style="width:${Math.max(8, Math.round(counts[p.id] / max * 100))}%;background:${b.color}"></i></span></span>
          <span class="point-count"><b>${counts[p.id]}</b> 题</span>
        </button>`).join('')}</div></div>`;
      }
      html += `</section>`;
    }
    if (!any) html += `<div class="empty-state"><div class="empty-mark">?</div><h3>没有匹配的知识点</h3><p>试试清除搜索词或年份筛选。</p></div>`;
    return html;
  }

  function aboutHTML() {
    const rows = BOOKS.map(b => `<tr><td><b>${esc(b.name)}</b></td><td>${b.chapters.map(c => c.title).join('、')}</td><td>${TOTAL_BY_BOOK[b.id] || 0}</td></tr>`).join('');
    const total = QUESTIONS.length;
    return `<div class="page-head"><p class="eyebrow">About / 使用说明</p><h1>关于这份题库</h1><p>把 2009—2026 年 408 选择题按教材章节和知识点重新整理，方便按章节刷题、按关键词查题、按考点回顾。</p><div class="head-meta"><span class="meta-pill">18 年</span><span class="meta-pill">720 题</span><span class="meta-pill">26 章</span><span class="meta-pill">58 个知识点</span></div></div>
    <div class="about-grid">
      <div class="note-card"><h3><svg class="icon"><use href="#i-book"></use></svg>收录范围</h3><p>2009—2026 年全国硕士研究生招生考试 408 计算机学科专业基础综合的单项选择题（第 1—40 题），每年 40 道，共 720 道。不收录综合应用题。</p><p style="margin-top:8px">2026 年真题为 2025 年 12 月考试卷，已按最新一年收录。</p></div>
      <div class="note-card"><h3><svg class="icon"><use href="#i-layers"></use></svg>分类口径</h3><p>按四本教材分为数据结构、计算机组成原理、操作系统、计算机网络；章节采用 408 大纲与常见教材的章节体例。知识点为每道题标注的一个主考点，便于快速定位，不等同于完整解析。</p></div>
      <div class="note-card"><h3><svg class="icon"><use href="#i-search"></use></svg>怎么用</h3><ul><li>左侧选择教材和章节，或直接搜索题干、选项、知识点。</li><li>点击选项可直接作答并显示答案；点“查看答案”只看答案。</li><li>点击题卡下方的知识点，可筛出同考点的全部真题。</li><li>按 <kbd>/</kbd> 快速聚焦搜索框，<kbd>Esc</kbd> 清空搜索。</li></ul></div>
      <div class="note-card"><h3><svg class="icon"><use href="#i-info"></use></svg>答案与配图</h3><p>答案以公开真题标准答案为准，题干和选项保留原题表述。带图题保留题图；个别选项本身为图片的题目，会在题卡中标注“选项见下图”。</p><p style="margin-top:8px">题目文字、公式和图表在整理过程中可能有排版差异，若发现错漏，以原卷为准。</p></div>
    </div>
    <div class="note-card" style="margin-bottom:14px"><h3><svg class="icon"><use href="#i-grid"></use></svg>分册统计</h3>
      <table class="about-table"><thead><tr><th>教材</th><th>章节</th><th>题数</th></tr></thead><tbody>${rows}</tbody><tfoot><tr><td><b>合计</b></td><td></td><td><b>${total}</b></td></tr></tfoot></table>
    </div>
    <div class="note-card"><h3><svg class="icon"><use href="#i-spark"></use></svg>数据说明</h3><p>题目与答案由公开的 408 历年真题资料整理、校对而成，仅用于个人复习。题目版权归原命题机构所有。若需修改题目或知识点，可直接编辑 <code>data/questions.js</code> 中的 JSON 数据。</p>
      <div class="about-source">参考与核对来源：<a href="https://zhenti.beokayy.club/" target="_blank" rel="noopener">四〇八档案室</a>、<a href="https://noobdream.com/" target="_blank" rel="noopener">N诺考研</a>、<a href="https://github.com/neville-studio/408-exam-paper" target="_blank" rel="noopener">408-exam-paper</a>。题目解析从略，仅保留答案与主知识点。</div>
    </div>`;
  }

  function renderView() {
    if (state.view === 'chapters') content.innerHTML = chaptersHTML();
    else if (state.view === 'points') content.innerHTML = pointsHTML();
    else if (state.view === 'about') content.innerHTML = aboutHTML();
    else content.innerHTML = bankHTML();
    updateTopnav();
    updateSidebar();
  }

  function renderAll() {
    renderToolbar();
    renderView();
    syncHash();
  }

  function syncHash() {
    const p = new URLSearchParams();
    if (state.book) p.set('book', state.book);
    if (state.chapter) p.set('chapter', state.chapter);
    if (state.point) p.set('point', state.point);
    if (state.year) p.set('year', state.year);
    if (state.q.trim()) p.set('q', state.q.trim());
    if (state.sort !== 'year-desc') p.set('sort', state.sort);
    const hash = '#/' + state.view + (p.toString() ? '?' + p.toString() : '');
    try { history.replaceState(null, '', hash); } catch (_) { /* file:// may block */ }
  }

  function applyHash() {
    const raw = location.hash.replace(/^#\/?/, '');
    const [viewRaw, query] = raw.split('?');
    const p = new URLSearchParams(query || '');
    const view = ['bank', 'chapters', 'points', 'about'].includes(viewRaw) ? viewRaw : 'bank';
    state.view = view;
    state.book = BOOK_BY_ID[p.get('book')] ? p.get('book') : null;
    state.chapter = CHAPTER_BY_ID[p.get('chapter')] ? p.get('chapter') : null;
    state.point = POINT_BY_ID[p.get('point')] ? p.get('point') : null;
    const y = Number(p.get('year'));
    state.year = YEARS.includes(y) ? y : null;
    state.q = p.get('q') || '';
    state.sort = ['year-desc', 'year-asc', 'chapter'].includes(p.get('sort')) ? p.get('sort') : 'year-desc';
    state.limit = PAGE_SIZE;
    // 保证 book/chapter/point 一致
    if (state.chapter && !state.book) state.book = CHAPTER_BY_ID[state.chapter].book;
    if (state.point) {
      const pt = POINT_BY_ID[state.point];
      if (!state.chapter) state.chapter = pt.chapter;
      if (!state.book) state.book = pt.book;
    }
    renderAll();
  }

  function setView(view) {
    state.view = view;
    state.limit = PAGE_SIZE;
    if (view === 'bank') {
      // keep filters
    }
    closeSidebar();
    renderAll();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function setFilter(patch) {
    Object.assign(state, patch);
    state.limit = PAGE_SIZE;
    if (state.chapter && !state.book) state.book = CHAPTER_BY_ID[state.chapter]?.book || null;
    if (state.chapter) state.point = state.point && POINT_BY_ID[state.point]?.chapter === state.chapter ? state.point : null;
    renderAll();
  }

  function clearFilter(key) {
    if (key === 'book') { state.book = null; state.chapter = null; state.point = null; }
    if (key === 'chapter') { state.chapter = null; state.point = null; }
    if (key === 'point') state.point = null;
    if (key === 'year') state.year = null;
    if (key === 'q') { state.q = ''; searchInput.value = ''; }
    state.limit = PAGE_SIZE;
    renderAll();
  }

  function resetAll() {
    state.book = state.chapter = state.point = state.year = null;
    state.q = '';
    state.limit = PAGE_SIZE;
    state.sort = 'year-desc';
    searchInput.value = '';
    renderAll();
  }

  function openSidebar() {
    sidebar.classList.add('is-open');
    overlay.classList.add('is-open');
    document.body.style.overflow = 'hidden';
  }
  function closeSidebar() {
    sidebar.classList.remove('is-open');
    overlay.classList.remove('is-open');
    document.body.style.overflow = '';
  }

  // ---- events ----
  $('#topnav').addEventListener('click', e => {
    const btn = e.target.closest('[data-view]');
    if (!btn) return;
    setView(btn.dataset.view);
  });

  $('#sideBooks').addEventListener('click', e => {
    const chapterBtn = e.target.closest('[data-chapter]');
    if (chapterBtn) {
      setFilter({ book: chapterBtn.dataset.book, chapter: chapterBtn.dataset.chapter, point: null });
      closeSidebar();
      return;
    }
    const bookBtn = e.target.closest('[data-book]');
    if (bookBtn) {
      if (state.book === bookBtn.dataset.book) setFilter({ book: null, chapter: null, point: null });
      else setFilter({ book: bookBtn.dataset.book, chapter: null, point: null });
      closeSidebar();
    }
  });

  activeFilters.addEventListener('click', e => {
    const btn = e.target.closest('[data-clear]');
    if (btn) clearFilter(btn.dataset.clear);
  });

  yearSelect.addEventListener('change', () => {
    state.year = yearSelect.value ? Number(yearSelect.value) : null;
    state.limit = PAGE_SIZE;
    renderAll();
  });

  sortSelect.addEventListener('change', () => {
    state.sort = sortSelect.value;
    state.limit = PAGE_SIZE;
    renderAll();
  });

  let searchTimer = null;
  searchInput.addEventListener('input', () => {
    state.q = searchInput.value;
    state.limit = PAGE_SIZE;
    searchClear.hidden = !state.q;
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      renderActiveFilters();
      renderView();
      syncHash();
    }, 90);
  });

  searchClear.addEventListener('click', () => {
    state.q = '';
    searchInput.value = '';
    searchClear.hidden = true;
    state.limit = PAGE_SIZE;
    renderActiveFilters();
    renderView();
    syncHash();
    searchInput.focus();
  });

  $('#resetBtn').addEventListener('click', resetAll);

  content.addEventListener('click', e => {
    const action = e.target.closest('[data-action]');
    if (action) {
      const a = action.dataset.action;
      if (a === 'scroll-results') {
        const head = $('.result-head');
        if (head) head.scrollIntoView({ behavior: 'smooth', block: 'start' });
        return;
      }
      if (a === 'chapter') {
        setFilter({ book: action.dataset.book, chapter: action.dataset.chapter, point: null });
        state.view = 'bank';
        renderAll();
        window.scrollTo({ top: 0, behavior: 'smooth' });
        return;
      }
      if (a === 'point') {
        setFilter({ book: action.dataset.book, chapter: action.dataset.chapter, point: action.dataset.point });
        state.view = 'bank';
        renderAll();
        window.scrollTo({ top: 0, behavior: 'smooth' });
        return;
      }
      if (a === 'reveal') {
        const id = action.dataset.id;
        if (state.revealed.has(id)) { state.revealed.delete(id); state.selected.delete(id); }
        else state.revealed.add(id);
        renderView();
        return;
      }
      if (a === 'option') {
        const id = action.dataset.id;
        state.selected.set(id, action.dataset.opt);
        state.revealed.add(id);
        renderView();
        return;
      }
      if (a === 'load-more') {
        state.limit += PAGE_SIZE;
        renderView();
        return;
      }
      if (a === 'reset') { resetAll(); return; }
    }
    const viewBtn = e.target.closest('[data-view]');
    if (viewBtn) { setView(viewBtn.dataset.view); return; }
  });

  // image fallback
  content.addEventListener('error', e => {
    if (e.target && e.target.tagName === 'IMG') {
      const fig = e.target.closest('figure');
      if (fig) fig.style.display = 'none';
    }
  }, true);

  $('#menuBtn').addEventListener('click', openSidebar);
  $('#sideClose').addEventListener('click', closeSidebar);
  overlay.addEventListener('click', closeSidebar);

  document.addEventListener('keydown', e => {
    const tag = (document.activeElement && document.activeElement.tagName) || '';
    if (e.key === '/' && !/INPUT|TEXTAREA|SELECT/.test(tag)) {
      e.preventDefault();
      searchInput.focus();
      searchInput.select();
    }
    if (e.key === 'Escape') {
      if (document.activeElement === searchInput && state.q) {
        state.q = ''; searchInput.value = ''; searchClear.hidden = true;
        renderActiveFilters(); renderView(); syncHash();
      } else {
        closeSidebar();
      }
    }
  });

  window.addEventListener('hashchange', applyHash);

  // boot
  buildSidebar();
  if (!location.hash) {
    renderAll();
  } else {
    applyHash();
  }
})();

