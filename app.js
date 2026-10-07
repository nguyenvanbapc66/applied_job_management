const { STAGES, FIELDS, agenda, week, relDay, sanitize, dayDiff } = Logic;
const KEY = 'job-desk.v1';
const PENDING_KEY = 'job-desk.pending';
const $ = s => document.querySelector(s);
const db = supabase.createClient(CONFIG.url, CONFIG.key);

// Local cache renders instantly; Supabase is the source of truth.
// Ids in `pending` changed locally but haven't reached the server yet (offline, error).
let jobs = readLocal(KEY, []);
let pending = new Set(readLocal(PENDING_KEY, []));
// First run after adding sync: jobs saved before have never been uploaded.
try { if (localStorage.getItem(PENDING_KEY) === null) jobs.forEach(j => pending.add(j.id)); } catch {}
let query = '';
let editingId = null;

function readLocal(key, fallback) {
  try { return key === KEY ? sanitize(JSON.parse(localStorage.getItem(key) || '[]')) : JSON.parse(localStorage.getItem(key)) ?? fallback; }
  catch { return fallback; }
}
function saveLocal() {
  try {
    localStorage.setItem(KEY, JSON.stringify(jobs));
    localStorage.setItem(PENDING_KEY, JSON.stringify([...pending]));
  } catch { /* cache only; server still has the data */ }
}

// Push every pending id: upsert if it still exists locally, delete otherwise.
let flushing = null;
async function flush() {
  if (flushing || !pending.size) return flushing;
  flushing = (async () => {
    const ids = [...pending];
    const rows = jobs.filter(j => pending.has(j.id)).map(j => ({ id: j.id, data: j, updated_at: new Date(j.updatedAt).toISOString() }));
    const gone = ids.filter(id => !jobs.some(j => j.id === id));
    const results = await Promise.all([
      rows.length ? db.from('jobs').upsert(rows) : {},
      gone.length ? db.from('jobs').delete().in('id', gone) : {},
    ]);
    const err = results.find(r => r.error)?.error;
    if (err) { setSync('offline'); toast(`Chưa đồng bộ được, sẽ thử lại: ${err.message}`); return; }
    ids.forEach(id => pending.delete(id));
    saveLocal();
    setSync('ok');
  })().finally(() => { flushing = null; });
  return flushing;
}

async function pull() {
  await flush();
  const { data, error } = await db.from('jobs').select('data');
  if (error) { setSync('offline'); return; }
  const server = sanitize(data.map(r => r.data));
  // Keep local versions of anything still waiting to upload.
  jobs = [...server.filter(j => !pending.has(j.id)), ...jobs.filter(j => pending.has(j.id))];
  saveLocal();
  render();
  setSync(pending.size ? 'offline' : 'ok');
}

function setSync(state) {
  const n = $('#sync');
  n.dataset.state = state;
  n.textContent = state === 'ok' ? 'Đã đồng bộ' : state === 'busy' ? 'Đang lưu…' : 'Chưa đồng bộ';
}

const today = () => Logic.iso(new Date());
const stageColor = id => `var(--${id})`;
const el = (tag, props = {}, ...kids) => {
  const n = Object.assign(document.createElement(tag), props);
  n.append(...kids.filter(k => k != null && k !== false));
  return n;
};

/* ---------- Today panel ---------- */
function renderToday() {
  const t = today();
  $('#todayDate').textContent = new Date().toLocaleDateString('vi-VN', { weekday: 'long', day: 'numeric', month: 'long' });

  const { due, stale } = agenda(jobs, t);
  const active = jobs.filter(j => ['wish', 'applied', 'interview'].includes(j.stage)).length;
  const late = due.filter(d => d.in < 0).length;
  $('#greeting').textContent =
    !jobs.length ? 'Bàn trống. Thêm job đầu tiên bạn đang để mắt tới.' :
    late ? `${late} việc đã quá hạn, xử lý trước nhé.` :
    due.length ? `${due.length} việc cần làm trong 3 ngày tới.` :
    stale.length ? `Không có hạn gấp. ${stale.length} chỗ đã lâu chưa phản hồi.` :
    `Mọi thứ đang ổn. ${active} job đang theo.`;

  const list = $('#agenda');
  list.replaceChildren(
    ...due.map(({ job, in: n }) => agendaItem(job, `${job.nextNote || 'Bước tiếp theo'}, ${relDay(n)}`, n < 0)),
    ...stale.slice(0, 3).map(({ job, since }) => agendaItem(job, `chưa phản hồi ${since} ngày`)),
  );

  const days = week(jobs, t);
  const labels = ['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN'];
  $('#week').replaceChildren(...days.map((d, i) => {
    const li = el('li', { title: `${labels[i]}: ${d.count} job đã apply` });
    li.style.setProperty('--n', Math.min(d.count, 4));
    li.style.setProperty('--i', i);
    li.dataset.n = d.count;
    li.classList.toggle('future', d.future);
    li.classList.toggle('is-today', d.date === t);
    return li;
  }));
  const sent = days.reduce((s, d) => s + d.count, 0);
  $('#weekCap').textContent = sent ? `Tuần này đã apply ${sent} job` : 'Tuần này chưa apply job nào';
}

function agendaItem(job, when, isLate) {
  const btn = el('button', { type: 'button', onclick: () => openDrawer(job.id) },
    el('span', { className: 'dot' }),
    el('span', { textContent: job.company }),
    el('span', { className: 'when', textContent: when }));
  btn.style.setProperty('--c', stageColor(job.stage));
  return el('li', { className: isLate ? 'late' : '' }, btn);
}

/* ---------- Board ---------- */
function renderBoard() {
  const q = query.trim().toLowerCase();
  const visible = jobs.filter(j => !q || `${j.company} ${j.role} ${j.location}`.toLowerCase().includes(q));
  const t = today();

  $('#board').replaceChildren(...STAGES.map(stage => {
    const items = visible.filter(j => j.stage === stage.id).sort((a, b) => b.updatedAt - a.updatedAt);
    const col = el('section', { className: 'column', ariaLabel: stage.label },
      el('h2', {}, stage.label, el('span', { className: 'count', textContent: items.length })),
      el('div', { className: 'cards' }, ...items.map(j => card(j, t))),
      !items.length && el('p', { className: 'empty', textContent: q ? 'Không có kết quả.' : emptyCopy[stage.id] }),
      stage.id !== 'closed' && el('button', { className: 'add', type: 'button', textContent: '+ Thêm', onclick: () => openDrawer(null, stage.id) }),
    );
    col.style.setProperty('--c', stageColor(stage.id));
    col.dataset.stage = stage.id;
    col.addEventListener('dragover', e => { e.preventDefault(); col.classList.add('over'); });
    col.addEventListener('dragleave', e => { if (!col.contains(e.relatedTarget)) col.classList.remove('over'); });
    col.addEventListener('drop', e => {
      e.preventDefault(); col.classList.remove('over');
      moveTo(e.dataTransfer.getData('text/plain'), stage.id);
    });
    return col;
  }));
}

const emptyCopy = {
  wish: 'Lưu lại những job bạn muốn apply.',
  applied: 'Kéo job vào đây khi đã gửi CV.',
  interview: 'Chưa có lịch phỏng vấn.',
  offer: 'Offer sẽ nằm ở đây.',
  closed: 'Job bị từ chối hoặc bạn bỏ qua.',
};

function card(job, t) {
  const meta = [];
  if (job.nextDate) {
    const n = dayDiff(t, job.nextDate);
    meta.push(el('span', { className: `chip ${n < 0 ? 'late' : 'next'}`, textContent: `${job.nextNote || 'Bước tiếp'} · ${relDay(n)}` }));
  }
  if (job.location) meta.push(el('span', { className: 'chip', textContent: job.location }));
  if (job.salary) meta.push(el('span', { className: 'chip', textContent: job.salary }));

  const b = el('button', { className: 'card', type: 'button', draggable: true, onclick: () => openDrawer(job.id) },
    el('span', { className: 'co', textContent: job.company }),
    el('span', { className: 'role', textContent: job.role }),
    meta.length > 0 && el('span', { className: 'meta' }, ...meta));
  b.style.setProperty('--c', stageColor(job.stage));
  b.addEventListener('dragstart', e => { e.dataTransfer.setData('text/plain', job.id); b.classList.add('dragging'); });
  b.addEventListener('dragend', () => b.classList.remove('dragging'));
  b.addEventListener('contextmenu', e => e.preventDefault());
  b.addEventListener('pointerdown', e => { if (e.pointerType !== 'mouse') touchDrag(e, b, job.id); });
  return b;
}

// Touch: HTML5 drag events don't fire on mobile. Long-press lifts the card, finger moves it.
const LIFT_MS = 280;
function touchDrag(down, cardEl, id) {
  const board = $('#board');
  const sx = down.clientX, sy = down.clientY;
  let ghost = null, over = null, x = sx, y = sy, raf = 0;

  const timer = setTimeout(lift, LIFT_MS);
  const cancelIfScrolling = e => { if (!ghost && Math.hypot(e.clientX - sx, e.clientY - sy) > 8) cleanup(); };

  function lift() {
    const r = cardEl.getBoundingClientRect();
    ghost = cardEl.cloneNode(true);
    ghost.classList.add('drag-ghost');
    Object.assign(ghost.style, { width: `${r.width}px`, left: `${r.left}px`, top: `${r.top}px` });
    ghost.dataset.dx = sx - r.left; ghost.dataset.dy = sy - r.top;
    document.body.append(ghost);
    cardEl.classList.add('lifting');
    navigator.vibrate?.(15);
    raf = requestAnimationFrame(tick);
  }
  function tick() {
    ghost.style.left = `${x - ghost.dataset.dx}px`;
    ghost.style.top = `${y - ghost.dataset.dy}px`;
    // Edge auto-scroll so other columns can be reached on a narrow screen.
    const edge = 40;
    if (x < edge) board.scrollLeft -= 12; else if (x > innerWidth - edge) board.scrollLeft += 12;
    const col = document.elementFromPoint(x, y)?.closest('.column');
    if (col !== over) { over?.classList.remove('touch-over'); col?.classList.add('touch-over'); over = col; }
    raf = requestAnimationFrame(tick);
  }
  function onMove(e) { x = e.clientX; y = e.clientY; cancelIfScrolling(e); }
  function onTouchMove(e) { if (ghost) e.preventDefault(); }
  function onUp() {
    const target = ghost && over?.dataset.stage;
    const lifted = !!ghost;
    cleanup();
    if (lifted) {
      // Swallow the click that follows so the drawer doesn't open.
      // Some browsers skip that click after a long-press; drop the guard so the next tap still works.
      const swallow = e => e.stopImmediatePropagation();
      cardEl.addEventListener('click', swallow, { capture: true, once: true });
      setTimeout(() => cardEl.removeEventListener('click', swallow, { capture: true }), 400);
      if (target) moveTo(id, target);
    }
  }
  function cleanup() {
    clearTimeout(timer); cancelAnimationFrame(raf);
    ghost?.remove(); ghost = null;
    over?.classList.remove('touch-over');
    cardEl.classList.remove('lifting');
    removeEventListener('pointermove', onMove);
    removeEventListener('pointerup', onUp);
    removeEventListener('pointercancel', cleanup);
    removeEventListener('touchmove', onTouchMove);
  }
  addEventListener('pointermove', onMove);
  addEventListener('pointerup', onUp);
  addEventListener('pointercancel', cleanup);
  addEventListener('touchmove', onTouchMove, { passive: false });
}

function moveTo(id, stage) {
  const job = jobs.find(j => j.id === id);
  if (!job || job.stage === stage) return;
  job.stage = stage;
  if (stage === 'applied' && !job.appliedDate) job.appliedDate = today();
  job.updatedAt = Date.now();
  commit(id);
  toast(`Đã chuyển ${job.company} sang ${STAGES.find(s => s.id === stage).label}`);
}

/* ---------- Drawer ---------- */
const drawer = $('#drawer');
const form = $('#jobForm');

$('#stagePick').append(...STAGES.map(s => {
  const l = el('label', {}, el('input', { type: 'radio', name: 'stage', value: s.id }), el('span', { textContent: s.label }));
  l.style.setProperty('--c', stageColor(s.id));
  return l;
}));
form.addEventListener('change', e => {
  if (e.target.name === 'stage') drawer.style.setProperty('--c', stageColor(e.target.value));
});

function openDrawer(id, stage = 'wish') {
  editingId = id;
  const job = jobs.find(j => j.id === id) || { stage };
  for (const f of FIELDS) if (form.elements[f]) form.elements[f].value = job[f] || '';
  form.elements.stage.value = job.stage;
  drawer.style.setProperty('--c', stageColor(job.stage));
  $('#drawerTitle').textContent = id ? job.company : 'Thêm job';
  $('#deleteBtn').hidden = !id;
  drawer.showModal();
  form.elements.company.focus();
}

form.addEventListener('submit', () => {
  const data = Object.fromEntries(FIELDS.map(f => [f, (form.elements[f]?.value ?? '').trim()]));
  if (data.stage !== 'wish' && data.stage !== 'closed' && !data.appliedDate) data.appliedDate = today();
  const existing = jobs.find(j => j.id === editingId);
  const id = existing?.id ?? crypto.randomUUID();
  if (existing) Object.assign(existing, data, { updatedAt: Date.now() });
  else jobs.push({ id, ...data, updatedAt: Date.now() });
  commit(id);
  toast(existing ? 'Đã lưu' : `Đã thêm ${data.company}`);
});

drawer.querySelector('[data-close]').onclick = () => drawer.close();
drawer.addEventListener('click', e => { if (e.target === drawer) drawer.close(); });

$('#deleteBtn').onclick = () => {
  const idx = jobs.findIndex(j => j.id === editingId);
  if (idx < 0) return;
  const [removed] = jobs.splice(idx, 1);
  drawer.close();
  commit(removed.id);
  toast(`Đã xoá ${removed.company}`, 'Hoàn tác', () => { jobs.splice(idx, 0, removed); commit(removed.id); });
};

/* ---------- Toolbar ---------- */
$('#addBtn').onclick = () => openDrawer(null);
$('#search').addEventListener('input', e => { query = e.target.value; renderBoard(); });

$('#exportBtn').onclick = () => {
  const a = el('a', {
    href: URL.createObjectURL(new Blob([JSON.stringify(jobs, null, 2)], { type: 'application/json' })),
    download: `jobs-${today()}.json`,
  });
  a.click();
  URL.revokeObjectURL(a.href);
};

$('#importInput').addEventListener('change', async e => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  try {
    const incoming = sanitize(JSON.parse(await file.text()));
    if (jobs.length && !confirm(`Thay ${jobs.length} job hiện tại bằng ${incoming.length} job trong file?`)) return;
    const ids = [...jobs, ...incoming].map(j => j.id);
    jobs = incoming;
    commit(...ids);
    toast(`Đã nhập ${incoming.length} job`);
  } catch (err) {
    toast(err instanceof SyntaxError ? 'File không phải JSON hợp lệ.' : err.message);
  }
});

document.addEventListener('keydown', e => {
  if (!signedIn || drawer.open || e.metaKey || e.ctrlKey || e.altKey || /INPUT|TEXTAREA/.test(document.activeElement.tagName)) return;
  if (e.key === 'n') { e.preventDefault(); openDrawer(null); }
  if (e.key === '/') { e.preventDefault(); $('#search').focus(); }
});

/* ---------- Toast ---------- */
let toastTimer;
function toast(msg, actionLabel, action) {
  const t = $('#toast');
  t.replaceChildren(el('span', { textContent: msg }),
    actionLabel && el('button', { type: 'button', textContent: actionLabel, onclick: () => { action(); t.classList.remove('show'); } }));
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), action ? 6000 : 2500);
}

function commit(...ids) {
  ids.forEach(id => pending.add(id));
  saveLocal();
  render();
  setSync('busy');
  flush();
}
function render() { renderToday(); renderBoard(); }

/* ---------- Auth ---------- */
// Accounts are created in the Supabase dashboard only; sign-ups are disabled there.
$('#loginForm').addEventListener('submit', async e => {
  e.preventDefault();
  const f = e.target, btn = f.querySelector('button');
  btn.disabled = true;
  $('#loginError').textContent = '';
  const { error } = await db.auth.signInWithPassword({ email: f.email.value.trim(), password: f.password.value });
  btn.disabled = false;
  if (error) $('#loginError').textContent = error.message === 'Invalid login credentials'
    ? 'Sai email hoặc mật khẩu.' : `Không đăng nhập được: ${error.message}`;
});

$('#logoutBtn').onclick = async () => {
  await flush();
  if (pending.size && !confirm('Còn thay đổi chưa đồng bộ. Đăng xuất sẽ mất các thay đổi đó. Vẫn đăng xuất?')) return;
  await db.auth.signOut();
};

let signedIn = false;
function applySession(session) {
  const now = !!session;
  document.body.dataset.auth = now ? 'in' : 'out';
  if (now && !signedIn) { render(); pull(); }
  if (!now && signedIn) {
    // Clear the cache so the next person on this device sees nothing.
    jobs = []; pending.clear(); saveLocal();
  }
  signedIn = now;
}
db.auth.onAuthStateChange((_event, session) => applySession(session));
// Fallback if the initial event never arrives (bad config, blocked storage): show login.
db.auth.getSession().then(({ data }) => applySession(data.session), () => applySession(null));

// Pick up edits made on the other device when this tab comes back into view.
document.addEventListener('visibilitychange', () => { if (signedIn && !document.hidden) pull(); });
addEventListener('online', () => signedIn && pull());
