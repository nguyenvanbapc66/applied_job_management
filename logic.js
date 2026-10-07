// Pure logic, shared by browser (window.Logic) and node test (require).
const Logic = (() => {
  const STAGES = [
    { id: 'wish', label: 'Dự kiến apply' },
    { id: 'applied', label: 'Đã apply' },
    { id: 'interview', label: 'Phỏng vấn' },
    { id: 'offer', label: 'Offer' },
    { id: 'closed', label: 'Đã đóng' },
  ];
  const STAGE_IDS = new Set(STAGES.map(s => s.id));
  const ACTIVE = new Set(['wish', 'applied', 'interview']);
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
        out.updatedAt = Number(j.updatedAt) || Date.now();
        return out;
      });
  }

  return { STAGES, FIELDS, iso, dayDiff, agenda, week, relDay, sanitize, STALE_DAYS };
})();

if (typeof module !== 'undefined') module.exports = Logic;
