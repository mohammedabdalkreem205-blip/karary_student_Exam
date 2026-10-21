'use strict';

const SUPABASE_URL = 'https://iicsvudgycyloovrdgro.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlpY3N2dWRneWN5bG9vdnJkZ3JvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTIzNDA4NjcsImV4cCI6MjEwNzkxNjg2N30.UEPdBr15XUnK8cB6-9iqFPQcBwghDL52OdGYmrl4osI';
const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const CONFIG = {
  EXAM_COUNTS: { mcq: 10, fixCode: 5, writeCode: 5, true_false: 5 },
  EXAM_MINUTES: 30,
  PRACTICE_COUNT: 10,
  PASS_PERCENT: 50
};

// ترجمة المواضيع عشان تظهر بالعربي (ضفنا كل المواضيع هنا)
const TOPICS = {
  // C++ Topics
  'files': 'الملفات', 'arrays': 'المصفوفات', 'functions': 'الدوال', 'pointers': 'المؤشرات', 'recursion': 'التكرار',
  // File Management Topics
  'Storage Media': 'وسائط التخزين', 'File Organization': 'تنظيم الملفات', 'Hashing': 'البعثرة', 'Indexing': 'الفهرسة', 'Trees': 'الأشجار'
};

const TYPE_LABEL = { mcq: 'اختر الإجابة الصحيحة', true_false: 'صح أم خطأ', fixCode: 'صحح الكود', writeCode: 'اكتب الكود' };
const KEYS = { session: 'cppExam.session.v1', theme: 'cppExam.theme' };
const $ = (id) => document.getElementById(id);

const store = {
  get(key, fallback = null) { try { const raw = localStorage.getItem(key); return raw === null ? fallback : JSON.parse(raw); } catch (e) { return fallback; } },
  set(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) {} },
  remove(key) { try { localStorage.removeItem(key); } catch (e) {} }
};

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = (s) => esc(s).replace(/`([^`]+)`/g, '<code>$1</code>');

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

function formatDate(ts) { try { return new Date(ts).toLocaleString('ar-EG-u-nu-latn', { dateStyle: 'medium', timeStyle: 'short' }); } catch (e) { return new Date(ts).toLocaleDateString(); } }
function formatDuration(sec) { const m = Math.floor(sec / 60); const s = sec % 60; return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`; }

let toastTimer;
function toast(msg) {
  const el = $('toast'); if(!el) return; el.textContent = msg; el.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { el.hidden = true; }, 4000);
}

let bank = [], byId = {}, session = null, selectedTopic = 'all', timerInterval = null, reviewFilter = 'all';

function showScreen(id) { document.querySelectorAll('.screen').forEach((el) => { el.hidden = el.id !== id; }); window.scrollTo(0, 0); }

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  const btn = $('theme-btn');
  if(btn) btn.setAttribute('aria-pressed', theme === 'dark');
}

function initTheme() {
  const saved = store.get(KEYS.theme);
  const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
  applyTheme(saved || (prefersDark ? 'dark' : 'light'));
  const btn = $('theme-btn');
  if(btn) btn.addEventListener('click', () => {
    const next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    applyTheme(next); store.set(KEYS.theme, next);
  });
}

// جلب المواد من الداتابيز
async function loadSubjects() {
  const { data, error } = await supabaseClient.from('subjects').select('*');
  const select = $('subject-select');
  if (!select) return;

  if (error) { 
    console.error('Error loading subjects:', error); 
    select.innerHTML = '<option value="">خطأ في تحميل المواد</option>';
    return; 
  }
  select.innerHTML = '<option value="">-- اختر المادة --</option>' + 
    data.map(sub => `<option value="${sub.id}">${sub.name}</option>`).join('');
    
  // إضافة حدث عند تغيير المادة
  select.addEventListener('change', (e) => {
      const subjectId = e.target.value;
      loadTopicsForSubject(subjectId);
  });
}

// جلب المواضيع الخاصة بالمادة المختارة
async function loadTopicsForSubject(subjectId) {
  const chips = $('topic-chips');
  if (!chips) return;
  
  // تصفير المواضيع المختارة
  selectedTopic = 'all';

  if (!subjectId) {
      chips.innerHTML = '<span style="color:var(--muted); font-size:0.9rem;">يرجى اختيار المادة أولاً لتظهر المواضيع</span>';
      return;
  }

  chips.innerHTML = '<span style="color:var(--muted); font-size:0.9rem;">جارٍ تحميل المواضيع...</span>';

  // جلب المواضيع الفريدة لهذه المادة فقط
  const { data, error } = await supabaseClient
      .from('questions')
      .select('topic')
      .eq('subject_id', subjectId);

  if (error) {
      chips.innerHTML = '<span style="color:var(--danger); font-size:0.9rem;">خطأ في تحميل المواضيع</span>';
      return;
  }

  // استخراج المواضيع الفريدة
  const uniqueTopics = [...new Set(data.map(q => q.topic))];

  if (uniqueTopics.length === 0) {
      chips.innerHTML = '<span style="color:var(--muted); font-size:0.9rem;">لا توجد مواضيع مسجلة لهذه المادة</span>';
      return;
  }

  // عرض المواضيع
  const entries = [['all', 'الكل'], ...uniqueTopics.map((t) => [t, TOPICS[t] || t])];
  chips.innerHTML = entries.map(([k, label]) => `<button type="button" class="chip" data-topic="${k}" aria-pressed="${k === selectedTopic}">${esc(label)}</button>`).join('');
}

async function loadStudentHistory() {
  const { data: { user } } = await supabaseClient.auth.getUser();
  if (!user) return;
  const { data, error } = await supabaseClient.from('results').select('*').eq('student_id', user.id).order('finished_at', { ascending: false }).limit(5);
  const box = $('history');
  if (error || !data || data.length === 0) { if(box) box.hidden = true; return; }
  box.hidden = false;
  $('history-list').innerHTML = data.map((h) => {
    const pass = h.percent >= CONFIG.PASS_PERCENT;
    const mode = h.mode === 'practice' ? `تدريب ${h.topic ? (TOPICS[h.topic] || h.topic) : ''}` : 'امتحان شامل';
    return `<li style="display:flex;justify-content:space-between;padding:10px;border-bottom:1px solid var(--line);"><span><span style="color:${pass ? 'var(--success)' : 'var(--danger)'};font-weight:bold;">${h.percent}%</span> <span style="color:var(--muted);font-size:0.9rem;">${esc(mode)}، ${h.score} من ${h.total}</span></span><span style="color:var(--muted);font-size:0.8rem;">${esc(formatDate(h.finished_at))}</span></li>`;
  }).join('');
}

function renderHome() {
  loadStudentHistory();
  loadSubjects();
  // إفراغ المواضيع لحد ما الطالب يختار مادة
  const chips = $('topic-chips');
  if(chips) chips.innerHTML = '<span style="color:var(--muted); font-size:0.9rem;">يرجى اختيار المادة أولاً لتظهر المواضيع</span>';
  renderResume();
}

function renderResume() {
  const s = store.get(KEYS.session); const box = $('resume-box');
  if (!box) return;
  if (s && !s.submitted) {
    const answered = Object.keys(s.answers || {}).filter((k) => hasAnswer(s.answers[k])).length;
    $('resume-info').textContent = ` أجبت عن ${answered} من ${s.items.length} سؤالاً.`; box.hidden = false;
  } else { box.hidden = true; }
}

async function signInStudent() {
  const fullName = $('student-name').value.trim();
  const uniId = $('university-id').value.trim();
  const dept = $('department').value;

  if (fullName.length < 3) { $('name-error').hidden = false; $('student-name').focus(); return null; }
  $('name-error').hidden = true;
  if (!uniId || isNaN(uniId) || uniId.length < 4) { $('id-error').hidden = false; $('university-id').focus(); return null; }
  $('id-error').hidden = true;

  const { data, error } = await supabaseClient.auth.signInAnonymously({ options: { data: { full_name: fullName, university_id: uniId, department: dept } } });
  if (error) { toast('تعذّر الاتصال: ' + error.message); return null; }

  const { error: profileError } = await supabaseClient.from('students').upsert({ id: data.user.id, university_id: uniId, full_name: fullName, department: dept }, { onConflict: 'id' });
  if (profileError) { console.error(profileError); toast('تعذّر حفظ البيانات.'); return null; }
  return fullName;
}

async function loadQuestions(subjectId, topic = 'all') {
  let query = supabaseClient.from('questions').select('*').eq('subject_id', subjectId);
  if (topic !== 'all') { query = query.eq('topic', topic); }

  const { data, error } = await query;
  if (error) throw error;
  
  bank = data || [];
  byId = {};
  bank.forEach((q) => { byId[q.id] = q; });
}

async function startSession(mode, topic) {
  const selectedSubjectId = $('subject-select').value;
  if (!selectedSubjectId) { $('subject-error').hidden = false; $('subject-select').focus(); return; }
  $('subject-error').hidden = true;

  const name = await signInStudent();
  if (!name) return;

  try {
    toast('جارٍ جلب الأسئلة...');
    await loadQuestions(selectedSubjectId, topic);
    if (bank.length === 0) { toast('لا توجد أسئلة في هذه المادة/الموضوع حالياً.'); return; }
  } catch (e) { toast('خطأ في تحميل الأسئلة: ' + e.message); return; }

  let picked;
  if (mode === 'exam') { picked = shuffle(bank).slice(0, 20); } 
  else { picked = shuffle(bank).slice(0, CONFIG.PRACTICE_COUNT); }

  const now = Date.now();
  session = {
    id: now, mode, topic: mode === 'practice' ? topic : null, name, subject_id: selectedSubjectId,
    startedAt: now, endsAt: mode === 'exam' ? now + CONFIG.EXAM_MINUTES * 60 * 1000 : null,
    items: picked.map((q) => ({ id: q.id, order: (q.type === 'mcq' || q.type === 'true_false') ? shuffle(q.options.map((_, i) => i)) : null })),
    answers: {}, flags: {}, current: 0, submitted: false
  };
  persist(); openExam();
}

function persist() { if (session) store.set(KEYS.session, session); }
function hasAnswer(a) { return typeof a === 'number' || (typeof a === 'string' && a.trim() !== ''); }

function openExam() {
  showScreen('exam-screen'); $('timer').hidden = !session.endsAt; buildNavigator(); renderQuestion(); stopTimer();
  if (session.endsAt) { tick(); timerInterval = setInterval(tick, 1000); }
}

function stopTimer() { clearInterval(timerInterval); timerInterval = null; }
function remainingSeconds() { return Math.max(0, Math.round((session.endsAt - Date.now()) / 1000)); }

function tick() {
  if (!session || session.submitted) return;
  const left = remainingSeconds(); const el = $('timer');
  el.textContent = formatDuration(left);
  el.dataset.state = left <= 60 ? 'danger' : (left <= 300 ? 'warning' : 'normal');
  if (left <= 0) { stopTimer(); toast('انتهى الوقت وتم إرسال إجاباتك تلقائياً.'); submitExam(); }
}

function currentItem() { return session.items[session.current]; }

function renderQuestion() {
  const item = currentItem(); const q = byId[item.id]; const n = session.items.length; const idx = session.current; const isLast = idx === n - 1; const flagged = !!session.flags[q.id];
  let body = `<div class="q-meta" style="margin-bottom:10px;"><span class="tag" style="background:var(--line);padding:4px 8px;border-radius:6px;font-size:0.85rem;margin-inline-end:8px;">${esc(TYPE_LABEL[q.type])}</span><span class="tag" style="background:var(--line);padding:4px 8px;border-radius:6px;font-size:0.85rem;">${esc(TOPICS[q.topic] || q.topic)}</span></div><div class="q-text" style="font-size:1.15rem;font-weight:600;margin-bottom:16px;">${fmt(q.prompt)}</div>`;

  if (q.type === 'mcq' || q.type === 'true_false') {
    const chosen = session.answers[q.id];
    body += `<fieldset class="options" style="display:grid;gap:10px;border:none;">`;
    item.order.forEach((origIdx) => { body += `<label class="opt" style="display:flex;align-items:center;gap:10px;padding:12px;border:1px solid var(--line);border-radius:8px;cursor:pointer;"><input type="radio" name="opt" value="${origIdx}" ${chosen === origIdx ? 'checked' : ''} style="width:18px;height:18px;"><span dir="auto">${fmt(q.options[origIdx])}</span></label>`; });
    body += `</fieldset>`;
  } else {
    if (q.type === 'fixCode') body += `<pre class="code-block" style="background:#0f172a;color:#e2e8f0;padding:14px;border-radius:8px;direction:ltr;text-align:left;overflow:auto;">${esc(q.code)}</pre>`;
    const placeholder = q.type === 'fixCode' ? 'اكتب الكود بعد التصحيح هنا' : 'اكتب الكود هنا';
    body += `<textarea class="code" id="code-answer" spellcheck="false" autocapitalize="off" autocomplete="off" autocorrect="off" aria-label="إجابتك" placeholder="${placeholder}" style="width:100%;min-height:150px;padding:12px;border-radius:8px;border:1px solid var(--line);font-family:monospace;direction:ltr;">${esc(session.answers[q.id] || '')}</textarea>`;
  }

  body += `<div class="q-actions" style="display:flex;gap:10px;justify-content:space-between;margin-top:20px;flex-wrap:wrap;"><button class="btn ghost" id="prev-btn" type="button" ${idx === 0 ? 'disabled' : ''}>السابق</button><button class="btn ghost" id="flag-btn" type="button" aria-pressed="${flagged}" style="${flagged ? 'background:var(--mark);color:#111;border-color:var(--mark);' : ''}">${flagged ? 'إزالة علامة المراجعة' : 'علّم للمراجعة'}</button><button class="btn" id="next-btn" type="button">${isLast ? 'مراجعة وإنهاء' : 'التالي'}</button></div>`;
  $('question-card').innerHTML = body;

  $('prev-btn').onclick = () => goTo(idx - 1);
  $('next-btn').onclick = () => (isLast ? askFinish() : goTo(idx + 1));
  $('flag-btn').onclick = () => { session.flags[q.id] = !session.flags[q.id]; if (!session.flags[q.id]) delete session.flags[q.id]; persist(); renderQuestion(); updateNavigator(); };

  if (q.type === 'mcq' || q.type === 'true_false') {
    document.querySelectorAll('input[name="opt"]').forEach((input) => { input.addEventListener('change', () => { session.answers[q.id] = Number(input.value); persist(); updateNavigator(); }); });
  } else {
    const ta = $('code-answer'); let saveTimer;
    ta.addEventListener('input', () => { session.answers[q.id] = ta.value; clearTimeout(saveTimer); saveTimer = setTimeout(persist, 300); updateNavigator(); });
    ta.addEventListener('blur', persist);
  }
  updateNavigator();
}

function goTo(i) { if (i < 0 || i >= session.items.length) return; session.current = i; persist(); renderQuestion(); window.scrollTo({ top: 0 }); }
function buildNavigator() { $('nav-grid').innerHTML = session.items.map((_, i) => `<button type="button" data-i="${i}" aria-label="السؤال ${i + 1}">${i + 1}</button>`).join(''); }
function answeredCount() { return session.items.filter((it) => hasAnswer(session.answers[it.id])).length; }

function updateNavigator() {
  const n = session.items.length; const done = answeredCount();
  $('counter').textContent = `سؤال ${session.current + 1} من ${n}`; $('progress-fill').style.width = `${(done / n) * 100}%`;
  document.querySelectorAll('#nav-grid button').forEach((btn, i) => { 
    const id = session.items[i].id; 
    btn.classList.toggle('answered', hasAnswer(session.answers[id])); 
    btn.classList.toggle('marked', !!session.flags[id]); 
    btn.setAttribute('aria-current', i === session.current ? 'true' : 'false');
  });
}

function askFinish() {
  const n = session.items.length; const left = n - answeredCount(); const flagged = Object.keys(session.flags).length;
  let text = left ? `لم تجب عن ${left} من ${n} سؤالاً.` : 'أجبت عن كل الأسئلة.';
  if (flagged) text += ` وعندك ${flagged} سؤالاً عليه علامة مراجعة.`;
  $('confirm-text').textContent = text;
  const dlg = $('confirm-dialog');
  if (typeof dlg.showModal === 'function') dlg.showModal(); else if (window.confirm(text + ' هل تريد الإنهاء؟')) submitExam();
}

const normalize = (t) => String(t || '').toLowerCase().replace(/\s+/g, '');
function matchCode(answer, q) { const clean = normalize(answer); if (!clean) return false; if (clean === normalize(q.sample)) return true; const hits = q.keywords ? q.keywords.filter((k) => clean.includes(normalize(k))).length : 0; return hits / q.keywords.length >= 0.6; }
function gradeItem(q, answer) { 
  if (q.type === 'mcq' || q.type === 'true_false') return typeof answer === 'number' && answer === q.correct; 
  return matchCode(answer, q); 
}

async function submitExam() {
  if (!session || session.submitted) return;
  stopTimer(); const dlg = $('confirm-dialog'); if (dlg.open) dlg.close();
  session.results = {}; session.items.forEach((item) => { const q = byId[item.id]; session.results[q.id] = { correct: gradeItem(q, session.answers[q.id]) }; });
  session.submitted = true; session.finishedAt = Date.now(); persist();
  await saveResultToDatabase(); openResult();
}

function computeScore() { return session.items.filter((it) => session.results[it.id].correct).length; }

function topicBreakdown() {
  const map = {}; session.items.forEach((it) => { const q = byId[it.id]; map[q.topic] = map[q.topic] || { total: 0, correct: 0 }; map[q.topic].total++; if (session.results[it.id].correct) map[q.topic].correct++; }); return map;
}

async function saveResultToDatabase() {
  const score = computeScore(); const total = session.items.length; const percent = Math.round((score / total) * 100);
  const { data: { user } } = await supabaseClient.auth.getUser();
  if (!user) { toast('لم يتم العثور على حسابك.'); return; }
  const { error } = await supabaseClient.from('results').insert({ 
    student_id: user.id, subject_id: session.subject_id, score: score, total: total, percent: percent, mode: session.mode, topic: session.topic || null, answers: session.answers 
  });
  if (error) { console.error(error); toast('حدث خطأ أثناء حفظ النتيجة.'); }
}

function openResult() {
  showScreen('result-screen'); reviewFilter = 'all';
  document.querySelectorAll('.review-tabs .chip').forEach((c) => { c.setAttribute('aria-pressed', String(c.dataset.filter === 'all')); });
  renderResultSummary(); renderReview();
}

function renderResultSummary() {
  const total = session.items.length; const score = computeScore(); const percent = Math.round((score / total) * 100); const pass = percent >= CONFIG.PASS_PERCENT;
  const ring = $('ring'); ring.style.background = `conic-gradient(${pass ? 'var(--success)' : 'var(--danger)'} ${percent}%, var(--line) ${percent}%)`; $('ring-text').textContent = `${percent}%`;
  const verdict = $('verdict'); verdict.style.color = pass ? 'var(--success)' : 'var(--danger)'; verdict.textContent = pass ? 'أحسنت، نتيجة ناجحة' : 'تحتاج لمزيد من التدريب';
  $('result-name').textContent = session.name;
  const duration = formatDuration(Math.round((session.finishedAt - session.startedAt) / 1000));
  $('result-stats').innerHTML = `<span style="margin-inline-end:15px;">أجبت صحيحاً عن ${score} من ${total}</span><span>الزمن ${duration}</span>`;
  const bd = topicBreakdown(); let weakest = null;
  const rows = Object.keys(TOPICS).filter((t) => bd[t]).map((t) => { const p = Math.round((bd[t].correct / bd[t].total) * 100); if (p < 100 && (!weakest || p < weakest.p)) weakest = { t, p }; return `<div class="topic-row"><span>${esc(TOPICS[t])}</span><div class="track"><i class="${p < 50 ? 'weak' : ''}" style="width:${p}%"></i></div><span class="num">${bd[t].correct}/${bd[t].total}</span></div>`; });
  $('topic-bars').innerHTML = rows.length > 1 ? `<h3 style="margin-bottom:12px;">أداؤك حسب الموضوع</h3>${rows.join('')}` : '';
  $('cert-btn').hidden = !(pass && session.mode === 'exam');
}

function renderReview() {
  const parts = [];
  session.items.forEach((item, i) => {
    const q = byId[item.id]; const res = session.results[q.id]; if (reviewFilter === 'wrong' && res.correct) return; const ans = session.answers[q.id];
    let html = `<div class="review-item" data-id="${q.id}" style="padding:15px 0;border-bottom:1px solid var(--line);"><div class="review-q" style="font-weight:600;margin-bottom:8px;">${i + 1}. ${fmt(q.prompt)}`;
    if (q.type === 'fixCode') html += `<pre class="code-block" style="margin-top:8px;">${esc(q.code)}</pre>`; html += `</div>`;
    if (q.type === 'mcq' || q.type === 'true_false') {
      const mine = typeof ans === 'number' ? q.options[ans] : 'لم تُجب';
      html += `<div class="answer-line" style="margin-top:6px;">إجابتك: <span style="color:${res.correct ? 'var(--success)' : 'var(--danger)'};font-weight:bold;" dir="auto">${fmt(mine)}</span></div>`;
      if (!res.correct) html += `<div class="answer-line" style="margin-top:6px;">الإجابة الصحيحة: <span style="color:var(--success);font-weight:bold;" dir="auto">${fmt(q.options[q.correct])}</span></div>`;
      if (q.explanation) html += `<div class="explain" style="background:var(--bg);padding:10px;border-radius:8px;margin-top:8px;font-size:0.9rem;">${esc(q.explanation)}</div>`;
    } else {
      html += `<div class="label-sm" style="margin-top:8px;color:var(--muted);">إجابتك</div><pre class="code-block" style="background:#0f172a;color:#e2e8f0;padding:10px;border-radius:8px;direction:ltr;">${esc(hasAnswer(ans) ? ans : 'لم تُجب')}</pre><div class="label-sm" style="margin-top:8px;color:var(--muted);">الإجابة النموذجية</div><pre class="code-block" style="background:#0f172a;color:#e2e8f0;padding:10px;border-radius:8px;direction:ltr;">${esc(q.sample)}</pre>`;
    }
    html += `<div class="status" style="margin-top:10px;">${res.correct ? '<span style="color:var(--success);font-weight:bold;">✔ إجابة صحيحة</span>' : '<span style="color:var(--danger);font-weight:bold;">✘ إجابة خاطئة</span>'}</div></div>`; parts.push(html);
  });
  $('review-container').innerHTML = parts.length ? parts.join('') : '<p style="text-align:center;padding:20px;">لا توجد أخطاء، عمل ممتاز.</p>';
}

function shareResult() {
  const score = computeScore(); const total = session.items.length; const percent = Math.round((score / total) * 100);
  const text = `🎓 نتيجتي في امتحان\n👤 ${session.name}\n📊 ${percent}% (${score} من ${total})\n\n💻 منصة الباش مهندس محمد عبد الكريم\n${location.href.split('#')[0]}`;
  if (navigator.share) navigator.share({ title: 'نتيجة امتحان', text }).catch(() => {}); else if (navigator.clipboard) navigator.clipboard.writeText(text).then(() => toast('تم النسخ!'), () => toast('تعذّر النسخ.'));
}

function printCertificate() {
  const score = computeScore(); const total = session.items.length; const percent = Math.round((score / total) * 100);
  $('cert-name').textContent = session.name; $('cert-score').textContent = `اجتاز الامتحان بنتيجة ${percent}% (${score} من ${total})`;
  $('cert-date').textContent = formatDate(session.finishedAt); document.body.classList.add('printing-cert'); window.print();
}

function bindEvents() {
  $('start-exam').addEventListener('click', () => startSession('exam', 'all'));
  $('start-practice').addEventListener('click', () => startSession('practice', selectedTopic));
  $('topic-chips').addEventListener('click', (e) => { const chip = e.target.closest('[data-topic]'); if (!chip) return; selectedTopic = chip.dataset.topic; document.querySelectorAll('#topic-chips .chip').forEach((c) => c.setAttribute('aria-pressed', String(c === chip))); });
  $('resume-btn').addEventListener('click', () => { const s = store.get(KEYS.session); if (!s || s.submitted) return; session = s; openExam(); });
  $('discard-btn').addEventListener('click', () => { store.remove(KEYS.session); session = null; renderResume(); });
  $('nav-grid').addEventListener('click', (e) => { const b = e.target.closest('button[data-i]'); if (b) goTo(Number(b.dataset.i)); });
  $('finish-btn').addEventListener('click', askFinish);
  $('confirm-yes').addEventListener('click', submitExam);
  $('confirm-no').addEventListener('click', () => $('confirm-dialog').close());
  $('share-btn').addEventListener('click', shareResult);
  $('cert-btn').addEventListener('click', printCertificate);
  window.addEventListener('afterprint', () => document.body.classList.remove('printing-cert'));
  $('retry-btn').addEventListener('click', () => { const mode = session.mode; const topic = session.topic; startSession(mode, topic); });
  $('home-btn').addEventListener('click', () => { store.remove(KEYS.session); session = null; renderHome(); showScreen('home-screen'); });
  document.querySelector('.review-tabs').addEventListener('click', (e) => { const chip = e.target.closest('[data-filter]'); if (!chip) return; reviewFilter = chip.dataset.filter; document.querySelectorAll('.review-tabs .chip').forEach((c) => c.setAttribute('aria-pressed', String(c === chip))); renderReview(); });
  
  // زر مسح السجل
  const clearBtn = $('clear-history');
  if(clearBtn) clearBtn.addEventListener('click', () => {
    if(confirm('هل تريد مسح سجل النتائج المحلي فقط؟ (النتائج في السيرفر لن تُمسح)')) {
       store.remove(KEYS.session);
       $('history').hidden = true;
       toast('تم مسح السجل المحلي');
    }
  });

  // شريط الأوفلاين
  const banner = $('offline-banner');
  if(banner) {
    window.addEventListener('offline', () => banner.classList.add('show'));
    window.addEventListener('online', () => banner.classList.remove('show'));
    if (!navigator.onLine) banner.classList.add('show');
  }
}

async function init() {
  initTheme(); bindEvents();
  renderHome(); 
  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) { navigator.serviceWorker.register('sw.js').catch(() => {}); }
}

init();