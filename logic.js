// Pure logic, shared by browser (window.Logic) and node test (require).
const Logic = (() => {
  const STAGES = [
    { id: 'wish', label: 'Dự kiến apply' },
    { id: 'applied', label: 'Đã apply' },
    { id: 'screening', label: 'HR đang xem xét' },
    { id: 'interview', label: 'Phỏng vấn' },
    { id: 'offer', label: 'Offer' },
    { id: 'rejected', label: 'Không đi tiếp' },
    { id: 'closed', label: 'Đã đóng' },
  ];
  const STAGE_IDS = new Set(STAGES.map(s => s.id));
  const ACTIVE = new Set(['wish', 'applied', 'screening', 'interview']);
  const FIELDS = ['company', 'role', 'url', 'location', 'salary', 'stage', 'appliedDate', 'nextDate', 'nextNote', 'notes'];

  // 'YYYY-MM-DD' parsed as local date (new Date(str) would be UTC).
  const parseDate = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
  const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const dayDiff = (from, to) => Math.round((parseDate(to) - parseDate(from)) / 864e5);

  const STALE_DAYS = 10;

  function agenda(jobs, todayIso) {
    const due = [], stale = [];
    for (const job of jobs) {
      if (!ACTIVE.has(job.stage)) continue;
      if (job.nextDate) {
        const d = dayDiff(todayIso, job.nextDate);
        if (d <= 3) { due.push({ job, in: d }); continue; }
      }
      if (job.stage === 'applied' && job.appliedDate) {
        const d = dayDiff(job.appliedDate, todayIso);
        if (d >= STALE_DAYS) stale.push({ job, since: d });
      }
    }
    due.sort((a, b) => a.in - b.in);
    stale.sort((a, b) => b.since - a.since);
    return { due, stale };
  }

  // Mon..Sun of the current ISO week, with applications sent per day.
  function week(jobs, todayIso) {
    const t = parseDate(todayIso);
    const mon = new Date(t); mon.setDate(t.getDate() - ((t.getDay() + 6) % 7));
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(mon); d.setDate(mon.getDate() + i);
      const date = iso(d);
      return { date, count: jobs.filter(j => j.appliedDate === date).length, future: date > todayIso };
    });
  }

  // Journey log: one entry per stage change plus free notes, each tied to the stage it was written in.
  // A move entry may later get text, so the step and what was said about it stay together.
  const logEntry = (stage, date, text = '', move = false) => ({ id: crypto.randomUUID(), date, stage, text, move });

  const withMove = (log, stage, date) => [...log, logEntry(stage, date, '', true)];

  // Newest first; same day keeps insertion order reversed.
  const sortedLog = log => log.map((e, i) => [e, i]).sort((a, b) => b[0].date.localeCompare(a[0].date) || b[1] - a[1]).map(([e]) => e);

  const lastNote = log => sortedLog(log).find(e => e.text.trim())?.text.trim() || '';

  // Split text into plain strings and {url} parts. Only http(s): never javascript: or data:.
  // Trailing punctuation stays text so "xem https://a.vn." doesn't link the dot.
  function linkify(text) {
    const out = [];
    let last = 0;
    for (const m of text.matchAll(/https?:\/\/[^\s<>"']+/gi)) {
      const url = m[0].replace(/[.,;:!?)\]}>'"]+$/, '');
      if (m.index > last) out.push(text.slice(last, m.index));
      out.push({ url });
      last = m.index + url.length;
    }
    if (last < text.length) out.push(text.slice(last));
    return out;
  }

  const relDay = n => n < 0 ? `trễ ${-n} ngày` : n === 0 ? 'hôm nay' : n === 1 ? 'ngày mai' : `${n} ngày nữa`;

  // Trust boundary: imported JSON.
  function sanitize(data) {
    if (!Array.isArray(data)) throw new Error('File không đúng định dạng: cần một danh sách job.');
    const isDate = v => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
    return data
      .filter(j => j && typeof j.company === 'string' && typeof j.role === 'string')
      .map(j => {
        const out = { id: typeof j.id === 'string' ? j.id : crypto.randomUUID() };
        for (const f of FIELDS) out[f] = typeof j[f] === 'string' ? j[f] : '';
        if (!STAGE_IDS.has(out.stage)) out.stage = 'wish';
        if (!isDate(out.appliedDate)) out.appliedDate = '';
        if (!isDate(out.nextDate)) out.nextDate = '';
        out.log = (Array.isArray(j.log) ? j.log : [])
          .filter(e => e && STAGE_IDS.has(e.stage) && isDate(e.date))
          .map(e => ({
            id: typeof e.id === 'string' ? e.id : crypto.randomUUID(),
            date: e.date, stage: e.stage,
            text: typeof e.text === 'string' ? e.text.slice(0, 10000) : '',
            move: e.move === true,
          }));
        out.updatedAt = Number(j.updatedAt) || Date.now();
        return out;
      });
  }

  return { STAGES, ACTIVE, FIELDS, iso, dayDiff, agenda, week, relDay, sanitize, STALE_DAYS, logEntry, withMove, sortedLog, lastNote, linkify };
})();

if (typeof module !== 'undefined') module.exports = Logic;
