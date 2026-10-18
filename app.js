'use strict';

/* =====================================================
   الإعدادات — عدّل هنا فقط
   ===================================================== */
const CONFIG = {
  EXAM_COUNTS: { mcq: 7, fixCode: 7, writeCode: 6 }, // توزيع الامتحان الشامل
  EXAM_MINUTES: 30,
  PRACTICE_COUNT: 10,
  PASS_PERCENT: 50,

  // اختياري: رابط Google Apps Script لاستلام النتائج في جدول (انظر README.md).
  // اتركه فارغاً لتبقى النتائج على جهاز الطالب فقط.
  SHEETS_URL: '',

  // اختياري: رابط وسيط (Cloudflare Worker مثلاً) يصحح أسئلة الكود بالذكاء الاصطناعي.
  // لا تضع مفتاح الـ API هنا أبداً، ضعه داخل الوسيط (انظر README.md).
  AI_GRADER_URL: ''
};

const TOPICS = {
  files: 'الملفات',
  arrays: 'المصفوفات',
  functions: 'الدوال',
  pointers: 'المؤشرات',
  recursion: 'التكرار'
};

const TYPE_LABEL = {
  mcq: 'اختر الإجابة الصحيحة',
  fixCode: 'صحح الكود',
  writeCode: 'اكتب الكود'
};

const KEYS = {
  session: 'cppExam.session.v1',
  history: 'cppExam.history.v1',
  name: 'cppExam.name',
  theme: 'cppExam.theme',
  seen: 'cppExam.seen.v1'
};

/* =====================================================
   أدوات مساعدة
   ===================================================== */
const $ = (id) => document.getElementById(id);

const store = {
  get(key, fallback = null) {
    try {
      const raw = localStorage.getItem(key);
      return raw === null ? fallback : JSON.parse(raw);
    } catch (e) { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* التخزين ممتلئ أو معطّل */ }
  },
  remove(key) {
    try { localStorage.removeItem(key); } catch (e) { /* تجاهل */ }
  }
};

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));

// يهرّب النص ثم يحوّل `code` إلى وسم <code>
const fmt = (s) => esc(s).replace(/`([^`]+)`/g, '<code>$1</code>');

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function formatDate(ts) {
  try {
    return new Date(ts).toLocaleString('ar-EG-u-nu-latn', { dateStyle: 'medium', timeStyle: 'short' });
  } catch (e) { return new Date(ts).toLocaleDateString(); }
}

function formatDuration(sec) {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

let toastTimer;
function toast(msg) {
  const el = $('toast');
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 3500);
}

/* =====================================================
   الحالة
   ===================================================== */
let bank = [];            // كل الأسئلة
let byId = {};            // id -> سؤال
let session = null;       // الجلسة الحالية
let selectedTopic = 'all';
let timerInterval = null;
let reviewFilter = 'all';

/* =====================================================
   الواجهة العامة
   ===================================================== */
function showScreen(id) {
  document.querySelectorAll('.screen').forEach((el) => { el.hidden = el.id !== id; });
  window.scrollTo(0, 0);
}

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', theme === 'dark' ? '#0b1522' : '#0b6e6e');
}

function initTheme() {
  const saved = store.get(KEYS.theme);
  const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
  applyTheme(saved || (prefersDark ? 'dark' : 'light'));
  $('theme-btn').addEventListener('click', () => {
    const next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    applyTheme(next);
    store.set(KEYS.theme, next);
  });
}

/* =====================================================
   الصفحة الرئيسية
   ===================================================== */
function countsAvailable() {
  const c = {};
  Object.keys(CONFIG.EXAM_COUNTS).forEach((t) => {
    c[t] = Math.min(CONFIG.EXAM_COUNTS[t], bank.filter((q) => q.type === t).length);
  });
  return c;
}

function renderHome() {
  const c = countsAvailable();
  const total = c.mcq + c.fixCode + c.writeCode;
  $('exam-desc').textContent =
    `${total} سؤالاً عشوائياً من بنك فيه ${bank.length} سؤالاً: ${c.mcq} اختيار، ${c.fixCode} تصحيح كود، ${c.writeCode} كتابة كود. المدة ${CONFIG.EXAM_MINUTES} دقيقة.`;

  $('privacy-note').textContent = CONFIG.SHEETS_URL
    ? 'اسمك ونتيجتك يُحفظان على جهازك، وتُرسل النتيجة أيضاً إلى معلمك لمتابعة مستواك.'
    : 'اسمك ونتائجك تُحفظ على جهازك فقط، ولا تخرج منه إلا إذا شاركتها بنفسك.';

  // شرائح المواضيع
  const chips = $('topic-chips');
  const topicsInBank = Object.keys(TOPICS).filter((t) => bank.some((q) => q.topic === t));
  const entries = [['all', 'الكل'], ...topicsInBank.map((t) => [t, TOPICS[t]])];
  chips.innerHTML = entries
    .map(([k, label]) => `<button type="button" class="chip" data-topic="${k}" aria-pressed="${k === selectedTopic}">${esc(label)}</button>`)
    .join('');

  renderHistory();
  renderResume();
}

function renderHistory() {
  const history = store.get(KEYS.history, []);
  const box = $('history');
  if (!history.length) { box.hidden = true; return; }
  box.hidden = false;
  $('history-list').innerHTML = history.slice(-5).reverse().map((h) => {
    const pass = h.percent >= CONFIG.PASS_PERCENT;
    const mode = h.mode === 'practice' ? `تدريب${h.topic && h.topic !== 'all' ? ' ' + (TOPICS[h.topic] || '') : ''}` : 'امتحان شامل';
    return `<li><span><span class="pct ${pass ? 'pass' : 'fail'}">${h.percent}%</span> <span class="meta">${esc(mode)}، ${h.score} من ${h.total}</span></span><span class="meta">${esc(formatDate(h.finishedAt))}</span></li>`;
  }).join('');
}

function renderResume() {
  const s = store.get(KEYS.session);
  const box = $('resume-box');
  if (s && !s.submitted) {
    const answered = Object.keys(s.answers || {}).filter((k) => hasAnswer(s.answers[k])).length;
    $('resume-info').textContent = ` أجبت عن ${answered} من ${s.items.length} سؤالاً.`;
    box.hidden = false;
  } else {
    box.hidden = true;
  }
}

function getName() {
  const name = $('student-name').value.trim();
  if (name.length < 2) {
    $('name-error').hidden = false;
    $('student-name').focus();
    return null;
  }
  $('name-error').hidden = true;
  store.set(KEYS.name, name);
  return name;
}

/* =====================================================
   بناء الجلسة
   ===================================================== */
function pickType(type, n, preferUnseen) {
  const all = bank.filter((q) => q.type === type);
  if (!preferUnseen) return shuffle(all).slice(0, n);
  const seen = new Set(store.get(KEYS.seen, []));
  const fresh = shuffle(all.filter((q) => !seen.has(q.id)));
  const old = shuffle(all.filter((q) => seen.has(q.id)));
  return fresh.concat(old).slice(0, n);
}

function rememberSeen(ids) {
  let seen = store.get(KEYS.seen, []);
  seen = Array.from(new Set(seen.concat(ids)));
  if (seen.length >= bank.length) seen = ids.slice(); // دورة جديدة بعد استهلاك البنك كله
  store.set(KEYS.seen, seen);
}

function startSession(mode, topic) {
  const name = getName();
  if (!name) return;

  let picked;
  if (mode === 'exam') {
    picked = [];
    Object.entries(CONFIG.EXAM_COUNTS).forEach(([type, n]) => { picked = picked.concat(pickType(type, n, true)); });
    picked = shuffle(picked);
    rememberSeen(picked.map((q) => q.id));
  } else {
    const pool = bank.filter((q) => topic === 'all' || q.topic === topic);
    picked = shuffle(pool).slice(0, CONFIG.PRACTICE_COUNT);
  }

  if (!picked.length) { toast('لا توجد أسئلة متاحة لهذا الاختيار.'); return; }

  const now = Date.now();
  session = {
    id: now,
    mode,
    topic: mode === 'practice' ? topic : null,
    name,
    startedAt: now,
    endsAt: mode === 'exam' ? now + CONFIG.EXAM_MINUTES * 60 * 1000 : null,
    items: picked.map((q) => ({
      id: q.id,
      order: q.type === 'mcq' ? shuffle(q.options.map((_, i) => i)) : null
    })),
    answers: {},
    flags: {},
    current: 0,
    submitted: false
  };
  persist();
  openExam();
}

function persist() { if (session) store.set(KEYS.session, session); }

function hasAnswer(a) {
  return typeof a === 'number' || (typeof a === 'string' && a.trim() !== '');
}

/* =====================================================
   شاشة الامتحان
   ===================================================== */
function openExam() {
  showScreen('exam-screen');
  $('timer').hidden = !session.endsAt;
  buildNavigator();
  renderQuestion();
  stopTimer();
  if (session.endsAt) { tick(); timerInterval = setInterval(tick, 1000); }
}

function stopTimer() { clearInterval(timerInterval); timerInterval = null; }

function remainingSeconds() {
  return Math.max(0, Math.round((session.endsAt - Date.now()) / 1000));
}

function tick() {
  if (!session || session.submitted) return;
  const left = remainingSeconds();
  const el = $('timer');
  el.textContent = formatDuration(left);
  el.classList.toggle('low', left <= 300);
  if (left <= 0) {
    stopTimer();
    toast('انتهى الوقت وتم إرسال إجاباتك تلقائياً.');
    submitExam();
  }
}

function currentItem() { return session.items[session.current]; }

function renderQuestion() {
  const item = currentItem();
  const q = byId[item.id];
  const n = session.items.length;
  const idx = session.current;
  const isLast = idx === n - 1;
  const flagged = !!session.flags[q.id];

  let body = '';
  body += `<div class="q-meta"><span class="tag">${esc(TYPE_LABEL[q.type])}</span><span class="tag">${esc(TOPICS[q.topic] || q.topic)}</span></div>`;
  body += `<div class="q-text">${fmt(q.prompt)}</div>`;

  if (q.type === 'mcq') {
    const chosen = session.answers[q.id];
    body += `<fieldset class="options" aria-label="الخيارات">`;
    item.order.forEach((origIdx) => {
      body += `<label class="opt"><input type="radio" name="opt" value="${origIdx}" ${chosen === origIdx ? 'checked' : ''}><span dir="auto">${fmt(q.options[origIdx])}</span></label>`;
    });
    body += `</fieldset>`;
  } else {
    if (q.type === 'fixCode') body += `<pre class="code-block">${esc(q.code)}</pre>`;
    const placeholder = q.type === 'fixCode' ? 'اكتب الكود بعد التصحيح هنا' : 'اكتب الكود هنا';
    body += `<textarea class="code" id="code-answer" spellcheck="false" autocapitalize="off" autocomplete="off" autocorrect="off" aria-label="إجابتك" placeholder="${placeholder}">${esc(session.answers[q.id] || '')}</textarea>`;
  }

  body += `<div class="q-actions">
    <button class="btn ghost" id="prev-btn" type="button" ${idx === 0 ? 'disabled' : ''}>السابق</button>
    <button class="btn ghost flag-btn" id="flag-btn" type="button" aria-pressed="${flagged}">${flagged ? 'إزالة علامة المراجعة' : 'علّم للمراجعة'}</button>
    <button class="btn" id="next-btn" type="button">${isLast ? 'مراجعة وإنهاء' : 'التالي'}</button>
  </div>`;

  $('question-card').innerHTML = body;

  // الأحداث
  $('prev-btn').onclick = () => goTo(idx - 1);
  $('next-btn').onclick = () => (isLast ? askFinish() : goTo(idx + 1));
  $('flag-btn').onclick = () => {
    session.flags[q.id] = !session.flags[q.id];
    if (!session.flags[q.id]) delete session.flags[q.id];
    persist();
    renderQuestion();
    updateNavigator();
  };

  if (q.type === 'mcq') {
    document.querySelectorAll('input[name="opt"]').forEach((input) => {
      input.addEventListener('change', () => {
        session.answers[q.id] = Number(input.value);
        persist();
        updateNavigator();
      });
    });
  } else {
    const ta = $('code-answer');
    let saveTimer;
    ta.addEventListener('input', () => {
      session.answers[q.id] = ta.value;
      clearTimeout(saveTimer);
      saveTimer = setTimeout(persist, 300);
      updateNavigator();
    });
    ta.addEventListener('blur', persist);
    ta.addEventListener('keydown', (e) => {
      if (e.key === 'Tab' && !e.shiftKey) {
        e.preventDefault();
        const { selectionStart: s, selectionEnd: en } = ta;
        ta.value = ta.value.slice(0, s) + '  ' + ta.value.slice(en);
        ta.selectionStart = ta.selectionEnd = s + 2;
        ta.dispatchEvent(new Event('input'));
      }
    });
  }

  updateNavigator();
}

function goTo(i) {
  if (i < 0 || i >= session.items.length) return;
  session.current = i;
  persist();
  renderQuestion();
  window.scrollTo({ top: 0 });
}

function buildNavigator() {
  $('nav-grid').innerHTML = session.items
    .map((_, i) => `<button type="button" data-i="${i}" aria-label="السؤال ${i + 1}">${i + 1}</button>`)
    .join('');
}

function answeredCount() {
  return session.items.filter((it) => hasAnswer(session.answers[it.id])).length;
}

function updateNavigator() {
  const n = session.items.length;
  const done = answeredCount();
  $('counter').textContent = `سؤال ${session.current + 1} من ${n}`;
  $('progress-fill').style.width = `${(done / n) * 100}%`;
  document.querySelectorAll('#nav-grid button').forEach((btn, i) => {
    const id = session.items[i].id;
    btn.classList.toggle('answered', hasAnswer(session.answers[id]));
    btn.classList.toggle('flagged', !!session.flags[id]);
    btn.classList.toggle('current', i === session.current);
    btn.setAttribute('aria-current', i === session.current ? 'true' : 'false');
  });
}

function askFinish() {
  const n = session.items.length;
  const left = n - answeredCount();
  const flagged = Object.keys(session.flags).length;
  let text = left ? `لم تجب عن ${left} من ${n} سؤالاً.` : 'أجبت عن كل الأسئلة.';
  if (flagged) text += ` وعندك ${flagged} سؤالاً عليه علامة مراجعة.`;
  $('confirm-text').textContent = text;
  const dlg = $('confirm-dialog');
  if (typeof dlg.showModal === 'function') dlg.showModal();
  else if (window.confirm(text + ' هل تريد الإنهاء؟')) submitExam();
}

/* =====================================================
   التصحيح
   ===================================================== */
// يحوّل النص لشكل موحّد للمقارنة: أحرف صغيرة وبلا مسافات
const normalize = (t) => String(t || '').toLowerCase().replace(/\s+/g, '');

function matchCode(answer, q) {
  const clean = normalize(answer);
  if (!clean) return false;
  if (clean === normalize(q.sample)) return true;
  const hits = q.keywords.filter((k) => clean.includes(normalize(k))).length;
  return hits / q.keywords.length >= 0.6;
}

function gradeItem(q, answer) {
  if (q.type === 'mcq') return typeof answer === 'number' && answer === q.correct;
  return matchCode(answer, q);
}

function submitExam() {
  if (!session || session.submitted) return;
  stopTimer();
  const dlg = $('confirm-dialog');
  if (dlg.open) dlg.close();

  session.results = {};
  session.items.forEach((item) => {
    const q = byId[item.id];
    session.results[q.id] = { correct: gradeItem(q, session.answers[q.id]), self: false, ai: null };
  });
  session.submitted = true;
  session.finishedAt = Date.now();
  persist();

  saveHistory();
  sendToSheets();
  openResult();
}

function computeScore() {
  return session.items.filter((it) => session.results[it.id].correct).length;
}

function topicBreakdown() {
  const map = {};
  session.items.forEach((it) => {
    const q = byId[it.id];
    map[q.topic] = map[q.topic] || { total: 0, correct: 0 };
    map[q.topic].total++;
    if (session.results[it.id].correct) map[q.topic].correct++;
  });
  return map;
}

function saveHistory() {
  const history = store.get(KEYS.history, []);
  const score = computeScore();
  const total = session.items.length;
  const entry = {
    id: session.id,
    name: session.name,
    mode: session.mode,
    topic: session.topic,
    score,
    total,
    percent: Math.round((score / total) * 100),
    finishedAt: session.finishedAt
  };
  const i = history.findIndex((h) => h.id === session.id);
  if (i >= 0) history[i] = entry; else history.push(entry);
  store.set(KEYS.history, history.slice(-50));
}

function sendToSheets() {
  if (!CONFIG.SHEETS_URL) return;
  const score = computeScore();
  const total = session.items.length;
  const payload = {
    attemptId: String(session.id),
    name: session.name,
    mode: session.mode,
    topic: session.topic || '',
    score,
    total,
    percent: Math.round((score / total) * 100),
    durationSec: Math.round((session.finishedAt - session.startedAt) / 1000),
    finishedAt: new Date(session.finishedAt).toISOString(),
    topics: topicBreakdown()
  };
  fetch(CONFIG.SHEETS_URL, {
    method: 'POST',
    mode: 'no-cors',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify(payload),
    keepalive: true
  }).catch(() => { /* الإرسال اختياري ولا يعطّل الامتحان */ });
}

/* =====================================================
   شاشة النتيجة
   ===================================================== */
function openResult() {
  showScreen('result-screen');
  reviewFilter = 'all';
  document.querySelectorAll('.review-tabs .chip').forEach((c) => {
    c.setAttribute('aria-pressed', String(c.dataset.filter === 'all'));
  });
  renderResultSummary();
  renderReview();
}

function renderResultSummary() {
  const total = session.items.length;
  const score = computeScore();
  const percent = Math.round((score / total) * 100);
  const pass = percent >= CONFIG.PASS_PERCENT;

  const ring = $('ring');
  ring.style.setProperty('--p', percent);
  ring.style.setProperty('--c', pass ? 'var(--ok)' : 'var(--bad)');
  $('ring-text').textContent = `${percent}%`;

  const verdict = $('verdict');
  verdict.className = `verdict ${pass ? 'pass' : 'fail'}`;
  verdict.textContent = pass ? 'أحسنت، نتيجة ناجحة' : 'تحتاج لمزيد من التدريب';

  $('result-name').textContent = session.name;
  const duration = formatDuration(Math.round((session.finishedAt - session.startedAt) / 1000));
  $('result-stats').innerHTML =
    `<span>أجبت صحيحاً عن ${score} من ${total}</span><span>الزمن ${duration}</span>`;

  // تفصيل المواضيع
  const bd = topicBreakdown();
  let weakest = null;
  const rows = Object.keys(TOPICS).filter((t) => bd[t]).map((t) => {
    const p = Math.round((bd[t].correct / bd[t].total) * 100);
    if (p < 100 && (!weakest || p < weakest.p)) weakest = { t, p };
    return `<div class="topic-row"><span>${esc(TOPICS[t])}</span><div class="track"><i class="${p < 50 ? 'weak' : ''}" style="width:${p}%"></i></div><span class="num">${bd[t].correct}/${bd[t].total}</span></div>`;
  });
  $('topic-bars').innerHTML = rows.length > 1 ? `<h3>أداؤك حسب الموضوع</h3>${rows.join('')}` : '';

  const weakBtn = $('weak-btn');
  weakBtn.hidden = !weakest;
  if (weakest) { weakBtn.dataset.topic = weakest.t; weakBtn.textContent = `تدرّب على ${TOPICS[weakest.t]}`; }

  $('cert-btn').hidden = !(pass && session.mode === 'exam');
}

function statusHTML(res) {
  if (!res.correct) return '<span class="bad">✘ إجابة خاطئة</span>';
  let note = '';
  if (res.self) note = ' (تقييم ذاتي)';
  else if (res.aiGraded) note = ' (تقييم الذكاء الاصطناعي)';
  return `<span class="ok">✔ إجابة صحيحة${note}</span>`;
}

function renderReview() {
  const parts = [];
  session.items.forEach((item, i) => {
    const q = byId[item.id];
    const res = session.results[q.id];
    if (reviewFilter === 'wrong' && res.correct) return;
    const ans = session.answers[q.id];

    let html = `<div class="review-item" data-id="${q.id}">`;
    html += `<div class="review-q">${i + 1}. ${fmt(q.prompt)}`;
    if (q.type === 'fixCode') html += `<pre class="code-block">${esc(q.code)}</pre>`;
    html += `</div>`;

    if (q.type === 'mcq') {
      const mine = typeof ans === 'number' ? q.options[ans] : 'لم تُجب';
      html += `<div class="answer-line">إجابتك: <span class="${res.correct ? 'ok' : 'bad'}" dir="auto">${fmt(mine)}</span></div>`;
      if (!res.correct) html += `<div class="answer-line">الإجابة الصحيحة: <span class="ok" dir="auto">${fmt(q.options[q.correct])}</span></div>`;
      if (q.explanation) html += `<div class="explain">${esc(q.explanation)}</div>`;
    } else {
      html += `<div class="label-sm">إجابتك</div><pre class="code-block">${esc(hasAnswer(ans) ? ans : 'لم تُجب')}</pre>`;
      html += `<div class="label-sm">الإجابة النموذجية</div><pre class="code-block">${esc(q.sample)}</pre>`;
      if (res.ai) html += `<div class="ai-feedback">${esc(res.ai)}</div>`;
    }

    html += `<div class="status">${statusHTML(res)}`;
    if (q.type !== 'mcq' && !res.correct && hasAnswer(ans)) {
      html += `<button class="btn ghost small" type="button" data-action="self">إجابتي صحيحة، احتسبها</button>`;
      if (CONFIG.AI_GRADER_URL) html += `<button class="btn ghost small" type="button" data-action="ai">اطلب تقييماً بالذكاء الاصطناعي</button>`;
    }
    html += `</div></div>`;
    parts.push(html);
  });

  $('review-container').innerHTML = parts.length
    ? parts.join('')
    : '<p>لا توجد أخطاء لعرضها، عمل ممتاز.</p>';
}

function afterGradeChange() {
  persist();
  saveHistory();
  sendToSheets();
  renderResultSummary();
  renderReview();
}

function markSelf(id) {
  session.results[id].correct = true;
  session.results[id].self = true;
  afterGradeChange();
}

async function aiGrade(id, btn) {
  const q = byId[id];
  btn.disabled = true;
  btn.textContent = 'جارٍ التقييم...';
  try {
    const r = await fetch(CONFIG.AI_GRADER_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: q.type,
        question: q.type === 'fixCode' ? `${q.prompt}\n${q.code}` : q.prompt,
        answer: session.answers[id],
        reference: q.sample
      })
    });
    if (!r.ok) throw new Error('bad status');
    const d = await r.json();
    session.results[id].ai = d.feedback || '';
    session.results[id].aiGraded = true;
    if (d.correct === true) session.results[id].correct = true;
    afterGradeChange();
  } catch (e) {
    toast('تعذّر الاتصال بالمصحح الذكي. حاول لاحقاً.');
    btn.disabled = false;
    btn.textContent = 'اطلب تقييماً بالذكاء الاصطناعي';
  }
}

function shareResult() {
  const score = computeScore();
  const total = session.items.length;
  const percent = Math.round((score / total) * 100);
  const text = `🎓 نتيجتي في امتحان \u2066C++\u2069\n👤 ${session.name}\n📊 ${percent}% (${score} من ${total})\n\n💻 منصة م. محمد عبدو للتدريب على الامتحانات\n${location.href.split('#')[0]}`;
  if (navigator.share) {
    navigator.share({ title: 'نتيجة امتحان C++', text }).catch(() => {});
  } else if (navigator.clipboard) {
    navigator.clipboard.writeText(text).then(() => toast('تم نسخ النتيجة، الصقها حيث تريد.'), () => toast('تعذّر نسخ النتيجة.'));
  }
}

function printCertificate() {
  const score = computeScore();
  const total = session.items.length;
  const percent = Math.round((score / total) * 100);
  $('cert-name').textContent = session.name;
  $('cert-score').textContent = `اجتاز الامتحان الشامل في \u2066C++\u2069 بنتيجة ${percent}% (${score} من ${total})`;
  $('cert-date').textContent = formatDate(session.finishedAt);
  document.body.classList.add('printing-cert');
  window.print();
}

/* =====================================================
   الربط والتهيئة
   ===================================================== */
function bindEvents() {
  $('start-exam').addEventListener('click', () => startSession('exam'));
  $('start-practice').addEventListener('click', () => startSession('practice', selectedTopic));

  $('topic-chips').addEventListener('click', (e) => {
    const chip = e.target.closest('[data-topic]');
    if (!chip) return;
    selectedTopic = chip.dataset.topic;
    document.querySelectorAll('#topic-chips .chip').forEach((c) => c.setAttribute('aria-pressed', String(c === chip)));
  });

  $('student-name').addEventListener('input', () => { $('name-error').hidden = true; });
  $('student-name').addEventListener('keydown', (e) => { if (e.key === 'Enter') startSession('exam'); });

  $('resume-btn').addEventListener('click', () => {
    const s = store.get(KEYS.session);
    if (!s || s.submitted) return;
    session = s;
    openExam();
  });

  $('discard-btn').addEventListener('click', () => {
    store.remove(KEYS.session);
    session = null;
    renderResume();
  });

  $('clear-history').addEventListener('click', () => {
    if (window.confirm('هل تريد مسح سجل نتائجك من هذا الجهاز؟')) {
      store.remove(KEYS.history);
      renderHistory();
    }
  });

  $('nav-grid').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-i]');
    if (b) goTo(Number(b.dataset.i));
  });

  $('finish-btn').addEventListener('click', askFinish);
  $('confirm-yes').addEventListener('click', submitExam);
  $('confirm-no').addEventListener('click', () => $('confirm-dialog').close());

  $('share-btn').addEventListener('click', shareResult);
  $('cert-btn').addEventListener('click', printCertificate);
  window.addEventListener('afterprint', () => document.body.classList.remove('printing-cert'));

  $('retry-btn').addEventListener('click', () => {
    const mode = session.mode;
    const topic = session.topic;
    $('student-name').value = session.name;
    startSession(mode, topic);
  });

  $('weak-btn').addEventListener('click', (e) => {
    $('student-name').value = session.name;
    selectedTopic = e.currentTarget.dataset.topic;
    startSession('practice', selectedTopic);
  });

  $('home-btn').addEventListener('click', () => {
    store.remove(KEYS.session);
    session = null;
    renderHome();
    showScreen('home-screen');
  });

  document.querySelector('.review-tabs').addEventListener('click', (e) => {
    const chip = e.target.closest('[data-filter]');
    if (!chip) return;
    reviewFilter = chip.dataset.filter;
    document.querySelectorAll('.review-tabs .chip').forEach((c) => c.setAttribute('aria-pressed', String(c === chip)));
    renderReview();
  });

  $('review-container').addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-action]');
    if (!btn) return;
    const id = btn.closest('.review-item').dataset.id;
    if (btn.dataset.action === 'self') markSelf(id);
    else if (btn.dataset.action === 'ai') aiGrade(id, btn);
  });

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && session && !session.submitted && session.endsAt) tick();
  });
}

async function loadQuestions() {
  const res = await fetch('questions.json', { cache: 'no-cache' });
  if (!res.ok) throw new Error('questions.json');
  const data = await res.json();
  bank = data.questions;
  byId = {};
  bank.forEach((q) => { byId[q.id] = q; });
}

async function init() {
  initTheme();
  $('student-name').value = store.get(KEYS.name, '') || '';
  bindEvents();

  try {
    await loadQuestions();
  } catch (e) {
    $('home-title').textContent = 'تعذّر تحميل الأسئلة';
    toast('تحقق من اتصالك بالإنترنت ثم أعد تحميل الصفحة.');
    $('start-exam').disabled = true;
    $('start-practice').disabled = true;
    return;
  }

  renderHome();

  // استعادة جلسة سابقة: نتيجة معروضة أو امتحان لم يكتمل (يُعرض زر المتابعة في الرئيسية)
  const saved = store.get(KEYS.session);
  if (saved && saved.submitted && saved.results && saved.items.every((it) => byId[it.id])) {
    session = saved;
    openResult();
  }

  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}

init();
