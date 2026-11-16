'use strict';

/* =========================================================================
   Dan's Gym — workout + daily weigh-in tracker
   All data lives in localStorage on this device. Weights are stored
   internally in kilograms and converted for display.
   ========================================================================= */

const STORAGE_KEY = 'dansgym.v1';
const KG_PER_LB = 0.45359237;
const DAY = 86400000;

const DEFAULT_EXERCISES = [
  'Bench Press', 'Incline Bench Press', 'Dumbbell Bench Press', 'Overhead Press',
  'Squat', 'Front Squat', 'Leg Press', 'Romanian Deadlift', 'Deadlift',
  'Barbell Row', 'Dumbbell Row', 'Lat Pulldown', 'Seated Cable Row', 'T-Bar Row',
  'Lateral Raise', 'Face Pull', 'Bicep Curl', 'Hammer Curl', 'Tricep Pushdown',
  'Skull Crusher', 'Overhead Tricep Extension', 'Shrug', 'Leg Curl', 'Leg Extension', 'Calf Raise', 'Hip Thrust',
  'Dumbbell Lunge', 'Goblet Squat', 'Hack Squat', 'Rear Delt Fly', 'Chest Fly', 'Cable Crunch'
];

/* ---------------------------------------------------------------- state */

function defaultState() {
  return {
    version: 1,
    settings: { unit: 'kg', goalKg: null },
    weighIns: [],   // { date: 'YYYY-MM-DD', kg: Number, note: String }
    workouts: [],   // { id, date, name, startedAt, finishedAt, notes, exercises: [{ name, sets: [{ kg, reps }] }] }
    draft: null     // in-progress workout: same shape as workout, sets have { kg, reps, done }
  };
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultState();
    const s = JSON.parse(raw);
    const d = defaultState();
    return {
      ...d, ...s,
      settings: { ...d.settings, ...(s.settings || {}) },
      weighIns: Array.isArray(s.weighIns) ? s.weighIns : [],
      workouts: Array.isArray(s.workouts) ? s.workouts : []
    };
  } catch (e) {
    console.error('Could not load data', e);
    return defaultState();
  }
}

let state = loadState();

function save() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (e) {
    toast('Could not save — storage may be full or blocked');
  }
}

/* -------------------------------------------------------------- helpers */

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function pad(n) { return String(n).padStart(2, '0'); }
function dateStr(d) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
function todayStr() { return dateStr(new Date()); }
function parseDate(s) { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); }
function addDays(s, n) { const d = parseDate(s); d.setDate(d.getDate() + n); return dateStr(d); }
function daysBetween(a, b) { return Math.round((parseDate(b) - parseDate(a)) / DAY); }

function fmtDate(s, opts = { weekday: 'short', month: 'short', day: 'numeric' }) {
  return parseDate(s).toLocaleDateString(undefined, opts);
}
function fmtDuration(ms) {
  const m = Math.max(0, Math.round(ms / 60000));
  return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`;
}

function unit() { return state.settings.unit; }
function toDisp(kg) { return unit() === 'lb' ? kg / KG_PER_LB : kg; }
function fromDisp(v) { return unit() === 'lb' ? v * KG_PER_LB : v; }
function num(v, dp = 1) {
  if (v == null || isNaN(v)) return '–';
  return (Math.round(v * 10 ** dp) / 10 ** dp).toLocaleString(undefined, { maximumFractionDigits: dp });
}
function w(kg, dp = 1) { return kg == null ? '–' : num(toDisp(kg), dp); }
function wu(kg, dp = 1) { return kg == null ? '–' : `${w(kg, dp)} ${unit()}`; }
function inputVal(kg) { return kg == null || kg === '' ? '' : String(Math.round(toDisp(kg) * 100) / 100); }

function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }

// Epley estimated one-rep max
function e1rm(kg, reps) {
  if (!kg || !reps) return 0;
  return reps === 1 ? kg : kg * (1 + reps / 30);
}

function startOfWeek(s) {
  const d = parseDate(s);
  const dow = (d.getDay() + 6) % 7; // Monday = 0
  d.setDate(d.getDate() - dow);
  return dateStr(d);
}

let toastTimer;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2200);
}

/* ------------------------------------------------------------ weigh-ins */

function sortedWeighIns() {
  return [...state.weighIns].sort((a, b) => a.date.localeCompare(b.date));
}

function upsertWeighIn(date, kg, note = '') {
  const existing = state.weighIns.find(x => x.date === date);
  if (existing) { existing.kg = kg; existing.note = note; }
  else state.weighIns.push({ date, kg, note });
  save();
}

function weighInOn(date) { return state.weighIns.find(x => x.date === date); }

// Entry on or before the given date (closest)
function weighInOnOrBefore(date) {
  const list = sortedWeighIns();
  let found = null;
  for (const e of list) { if (e.date <= date) found = e; else break; }
  return found;
}

function weighStreak() {
  const dates = new Set(state.weighIns.map(x => x.date));
  let day = todayStr();
  if (!dates.has(day)) day = addDays(day, -1); // today not logged yet doesn't break the streak
  let n = 0;
  while (dates.has(day)) { n++; day = addDays(day, -1); }
  return n;
}

// Trailing 7-day average for every logged date
function movingAverage(list, windowDays = 7) {
  return list.map((e, i) => {
    let sum = 0, n = 0;
    for (let j = i; j >= 0; j--) {
      if (daysBetween(list[j].date, e.date) >= windowDays) break;
      sum += list[j].kg; n++;
    }
    return { date: e.date, kg: sum / n };
  });
}

/* ------------------------------------------------------------- workouts */

function sortedWorkouts() {
  return [...state.workouts].sort((a, b) => (b.date + (b.startedAt || '')).localeCompare(a.date + (a.startedAt || '')));
}

function workoutVolume(wk) {
  let v = 0;
  for (const ex of wk.exercises) for (const s of ex.sets) v += (s.kg || 0) * (s.reps || 0);
  return v;
}
function workoutSets(wk) { return wk.exercises.reduce((n, ex) => n + ex.sets.length, 0); }

function allExerciseNames() {
  const names = new Set(DEFAULT_EXERCISES);
  for (const wk of state.workouts) for (const ex of wk.exercises) names.add(ex.name);
  if (state.draft) for (const ex of state.draft.exercises) names.add(ex.name);
  return [...names].sort((a, b) => a.localeCompare(b));
}

function normalizeName(name) {
  const trimmed = name.trim().replace(/\s+/g, ' ');
  const match = allExerciseNames().find(n => n.toLowerCase() === trimmed.toLowerCase());
  return match || trimmed;
}

// Last completed session containing this exercise
function lastSessionFor(name) {
  for (const wk of sortedWorkouts()) {
    const ex = wk.exercises.find(e => e.name.toLowerCase() === name.toLowerCase());
    if (ex && ex.sets.length) return { date: wk.date, sets: ex.sets };
  }
  return null;
}

function newDraft(fromWorkout) {
  state.draft = {
    id: uid(),
    date: todayStr(),
    name: fromWorkout ? fromWorkout.name : defaultWorkoutName(),
    startedAt: new Date().toISOString(),
    notes: '',
    exercises: fromWorkout
      ? fromWorkout.exercises.map(ex => ({ name: ex.name, sets: ex.sets.map(s => ({ kg: s.kg, reps: s.reps, done: false })) }))
      : []
  };
  save();
}

function defaultWorkoutName() {
  const h = new Date().getHours();
  const part = h < 12 ? 'Morning' : h < 17 ? 'Afternoon' : 'Evening';
  return `${part} workout`;
}

function finishDraft() {
  const d = state.draft;
  const exercises = d.exercises
    .map(ex => ({ name: ex.name, sets: ex.sets.filter(s => s.reps > 0).map(s => ({ kg: s.kg || 0, reps: s.reps })) }))
    .filter(ex => ex.sets.length);
  if (!exercises.length) {
    toast('Log at least one set with reps before finishing');
    return false;
  }
  state.workouts.push({
    id: d.id,
    date: d.date || dateStr(new Date(d.startedAt)),
    name: d.name.trim() || 'Workout',
    startedAt: d.startedAt,
    // A back-dated workout has no meaningful duration
    finishedAt: !d.date || d.date === dateStr(new Date(d.startedAt)) ? new Date().toISOString() : null,
    notes: d.notes.trim(),
    exercises
  });
  state.draft = null;
  save();
  return true;
}

/* ================================================================ RENDER */

function renderAll() {
  $('#todayLabel').textContent = new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });
  $$('.unitLabel').forEach(el => el.textContent = unit());
  $('#exerciseList').innerHTML = allExerciseNames().map(n => `<option value="${esc(n)}">`).join('');
  renderToday();
  renderWeight();
  renderHistory();
  renderProgress();
  renderSettings();
}

/* --------------------------------------------------------------- Today */

function renderToday() {
  renderWeighQuick();
  renderWeekStats();
  renderWorkout();
}

function renderWeighQuick() {
  const today = todayStr();
  const entry = weighInOn(today);
  const streak = weighStreak();
  $('#weighStreak').textContent = streak ? `🔥 ${streak}-day streak` : '';

  const body = $('#weighQuickBody');
  if (entry && !body.dataset.editing) {
    const prev = weighInOnOrBefore(addDays(today, -1));
    let diff = '';
    if (prev) {
      const delta = entry.kg - prev.kg;
      const cls = delta > 0 ? 'up' : delta < 0 ? 'down' : '';
      diff = `<span class="${cls}">${delta > 0 ? '+' : ''}${w(delta)} ${unit()}</span> <span class="muted small">vs ${fmtDate(prev.date)}</span>`;
    }
    body.innerHTML = `
      <div class="weigh-done">
        <span class="big">${w(entry.kg)}</span><span class="muted">${unit()}</span>
        ${diff}
        <button class="btn ghost small" id="editTodayWeigh" type="button" style="margin-left:auto">Edit</button>
      </div>`;
    $('#editTodayWeigh').onclick = () => { body.dataset.editing = '1'; renderWeighQuick(); };
  } else {
    const last = weighInOnOrBefore(today);
    body.innerHTML = `
      <form class="row-form" id="quickWeighForm">
        <label>Today's weight (${unit()})
          <input type="number" id="quickWeigh" step="0.1" min="20" max="700" inputmode="decimal"
            placeholder="${last ? w(last.kg) : ''}" value="${entry ? inputVal(entry.kg) : ''}" required>
        </label>
        <button class="btn primary" type="submit">Log</button>
      </form>
      ${last && !entry ? `<p class="muted small" style="margin:8px 0 0">Last: ${wu(last.kg)} on ${fmtDate(last.date)}</p>` : ''}`;
    $('#quickWeighForm').onsubmit = e => {
      e.preventDefault();
      const v = parseFloat($('#quickWeigh').value);
      if (!(v > 0)) return;
      upsertWeighIn(today, fromDisp(v), entry ? entry.note : '');
      delete body.dataset.editing;
      toast('Weigh-in saved');
      renderAll();
    };
  }
}

function renderWeekStats() {
  const today = todayStr();
  const weekStart = startOfWeek(today);
  const thisWeek = state.workouts.filter(x => x.date >= weekStart && x.date <= today);
  const vol = thisWeek.reduce((s, x) => s + workoutVolume(x), 0);
  const sets = thisWeek.reduce((s, x) => s + workoutSets(x), 0);
  const last = sortedWorkouts()[0];
  const since = last ? daysBetween(last.date, today) : null;

  $('#weekStats').innerHTML = `
    <div class="stat"><div class="label">This week</div>
      <div class="value">${thisWeek.length}</div>
      <div class="sub">${thisWeek.length === 1 ? 'workout' : 'workouts'} since Monday</div></div>
    <div class="stat"><div class="label">Weekly volume</div>
      <div class="value">${num(toDisp(vol), 0)}</div><div class="sub">${unit()} · ${sets} sets</div></div>
    <div class="stat"><div class="label">Last workout</div>
      <div class="value">${since == null ? '–' : since === 0 ? 'Today' : since === 1 ? '1 day' : since + ' days'}</div>
      <div class="sub">${last ? esc(last.name) : 'none yet'}</div></div>`;
}

let timerInterval;
function renderWorkout() {
  const body = $('#workoutBody');
  clearInterval(timerInterval);
  const d = state.draft;

  if (!d) {
    $('#workoutTitle').textContent = 'Workout';
    $('#workoutTimer').textContent = '';
    const recent = sortedWorkouts();
    const seen = new Set();
    const templates = recent.filter(x => !seen.has(x.name) && seen.add(x.name)).slice(0, 4);
    body.innerHTML = `
      <button class="btn primary block" id="startEmpty" type="button">+ Start empty workout</button>
      ${templates.length ? `<p class="muted small" style="margin:14px 0 6px">Or repeat a recent workout:</p>
        <div class="btn-row">${templates.map(t => `<button class="btn small" data-repeat="${t.id}" type="button">↻ ${esc(t.name)}</button>`).join('')}</div>` : ''}`;
    $('#startEmpty').onclick = () => { newDraft(); renderToday(); };
    $$('[data-repeat]', body).forEach(b => b.onclick = () => {
      newDraft(state.workouts.find(x => x.id === b.dataset.repeat));
      renderToday();
    });
    return;
  }

  $('#workoutTitle').textContent = 'Workout in progress';
  const tick = () => { $('#workoutTimer').textContent = '⏱ ' + fmtDuration(Date.now() - new Date(d.startedAt)); };
  tick();
  timerInterval = setInterval(tick, 15000);

  body.innerHTML = `
    <div class="row-form" style="margin-bottom:12px">
      <label>Date<input type="date" id="draftDate" value="${esc(d.date || todayStr())}" max="${todayStr()}" required></label>
      <label class="grow">Name<input type="text" id="draftName" value="${esc(d.name)}"></label>
    </div>
    <div id="exerciseBlocks">
      ${d.exercises.map((ex, i) => exerciseBlock(ex, i)).join('')}
    </div>
    <form class="add-ex" id="addExForm">
      <input type="text" id="newExName" list="exerciseList" placeholder="Add exercise (e.g. Bench Press)" autocomplete="off">
      <button class="btn" type="submit">Add</button>
    </form>
    <label>Notes<textarea id="draftNotes" placeholder="How did it feel?">${esc(d.notes)}</textarea></label>
    <div class="btn-row" style="margin-top:14px">
      <button class="btn primary" id="finishBtn" type="button" style="flex:1">✓ Finish workout</button>
      <button class="btn danger" id="discardBtn" type="button">Discard</button>
    </div>`;

  $('#draftName').oninput = e => { d.name = e.target.value; save(); };
  $('#draftDate').onchange = e => {
    const v = e.target.value;
    if (!v || v > todayStr()) { e.target.value = d.date || todayStr(); toast('Pick today or an earlier date'); return; }
    d.date = v; save();
  };
  $('#draftNotes').oninput = e => { d.notes = e.target.value; save(); };
  $('#addExForm').onsubmit = e => {
    e.preventDefault();
    const name = $('#newExName').value;
    if (!name.trim()) return;
    const n = normalizeName(name);
    const last = lastSessionFor(n);
    const first = last ? last.sets[0] : null;
    d.exercises.push({ name: n, sets: [{ kg: first ? first.kg : null, reps: first ? first.reps : null, done: false }] });
    save();
    renderWorkout();
    $('#exerciseList').innerHTML = allExerciseNames().map(x => `<option value="${esc(x)}">`).join('');
    $('#newExName').focus();
  };
  $('#finishBtn').onclick = () => {
    const undone = d.exercises.some(ex => ex.sets.some(s => s.reps > 0 && !s.done));
    if (undone && !confirm('Some sets aren\'t ticked as done. Save all sets with reps entered anyway?')) return;
    if (finishDraft()) { toast('Workout saved 💪'); renderAll(); }
  };
  $('#discardBtn').onclick = () => {
    if (!confirm('Discard this workout? Nothing will be saved.')) return;
    state.draft = null; save(); renderToday();
  };

  // Delegated handlers for sets
  const blocks = $('#exerciseBlocks');
  blocks.oninput = e => {
    const t = e.target;
    const ex = d.exercises[+t.dataset.ex];
    if (!ex) return;
    const set = ex.sets[+t.dataset.set];
    if (t.dataset.field === 'kg') set.kg = t.value === '' ? null : fromDisp(parseFloat(t.value));
    if (t.dataset.field === 'reps') set.reps = t.value === '' ? null : parseInt(t.value, 10);
    save();
  };
  blocks.onchange = e => {
    const t = e.target;
    if (t.dataset.field !== 'done') return;
    const set = d.exercises[+t.dataset.ex].sets[+t.dataset.set];
    set.done = t.checked;
    t.closest('tr').classList.toggle('done', t.checked);
    save();
  };
  blocks.onclick = e => {
    const b = e.target.closest('button');
    if (!b) return;
    const i = +b.dataset.ex;
    const ex = d.exercises[i];
    if (b.dataset.act === 'addSet') {
      const prev = ex.sets[ex.sets.length - 1];
      const last = lastSessionFor(ex.name);
      const ref = prev || (last && last.sets[ex.sets.length]);
      ex.sets.push({ kg: ref ? ref.kg : null, reps: ref ? ref.reps : null, done: false });
    } else if (b.dataset.act === 'delSet') {
      ex.sets.splice(+b.dataset.set, 1);
    } else if (b.dataset.act === 'delEx') {
      if (!confirm(`Remove ${ex.name}?`)) return;
      d.exercises.splice(i, 1);
    } else if (b.dataset.act === 'up' && i > 0) {
      [d.exercises[i - 1], d.exercises[i]] = [d.exercises[i], d.exercises[i - 1]];
    } else return;
    save();
    renderWorkout();
  };
}

function exerciseBlock(ex, i) {
  const last = lastSessionFor(ex.name);
  const hint = last
    ? `Last time (${fmtDate(last.date, { month: 'short', day: 'numeric' })}): ${last.sets.map(s => `${w(s.kg)}×${s.reps}`).join(', ')}`
    : 'First time logging this exercise';
  return `
    <div class="exercise">
      <div class="exercise-head">
        <h3>${esc(ex.name)}</h3>
        <div>
          ${i > 0 ? `<button class="btn ghost small" data-act="up" data-ex="${i}" type="button" title="Move up">↑</button>` : ''}
          <button class="btn ghost small" data-act="delEx" data-ex="${i}" type="button" title="Remove exercise">✕</button>
        </div>
      </div>
      <p class="hint">${hint}</p>
      <table class="sets">
        <thead><tr><th class="num">Set</th><th>${unit()}</th><th>Reps</th><th class="chk">Done</th><th class="del"></th></tr></thead>
        <tbody>
          ${ex.sets.map((s, j) => `
            <tr class="${s.done ? 'done' : ''}">
              <td class="num">${j + 1}</td>
              <td><input type="number" step="0.5" min="0" inputmode="decimal" data-ex="${i}" data-set="${j}" data-field="kg" value="${inputVal(s.kg)}" placeholder="0"></td>
              <td><input type="number" step="1" min="0" inputmode="numeric" data-ex="${i}" data-set="${j}" data-field="reps" value="${s.reps ?? ''}" placeholder="0"></td>
              <td class="chk"><input type="checkbox" data-ex="${i}" data-set="${j}" data-field="done" ${s.done ? 'checked' : ''} aria-label="Set done"></td>
              <td class="del"><button class="btn ghost small" data-act="delSet" data-ex="${i}" data-set="${j}" type="button" aria-label="Delete set">−</button></td>
            </tr>`).join('')}
        </tbody>
      </table>
      <button class="btn small" data-act="addSet" data-ex="${i}" type="button" style="margin-top:6px">+ Add set</button>
    </div>`;
}

/* -------------------------------------------------------------- Weight */

let weightRange = 30;

function renderWeight() {
  const form = $('#weighForm');
  if (!$('#wDate').value) $('#wDate').value = todayStr();
  $('#wDate').max = todayStr();

  const list = sortedWeighIns();
  const today = todayStr();
  const latest = list[list.length - 1];

  // Stats
  const stats = [];
  if (latest) {
    const ma = movingAverage(list);
    const latestAvg = ma[ma.length - 1].kg;
    stats.push(statBox('Current', wu(latest.kg), fmtDate(latest.date)));
    stats.push(statBox('7-day avg', wu(latestAvg), 'smooths daily swings'));
    const wk = weighInOnOrBefore(addDays(latest.date, -7));
    const mo = weighInOnOrBefore(addDays(latest.date, -30));
    stats.push(statBox('7-day change', wk ? signed(latest.kg - wk.kg) : '–', wk ? `since ${fmtDate(wk.date)}` : 'need more data', wk ? latest.kg - wk.kg : 0));
    stats.push(statBox('30-day change', mo ? signed(latest.kg - mo.kg) : '–', mo ? `since ${fmtDate(mo.date)}` : 'need more data', mo ? latest.kg - mo.kg : 0));
    if (state.settings.goalKg) {
      const togo = latest.kg - state.settings.goalKg;
      stats.push(statBox('To goal', `${w(Math.abs(togo))} ${unit()}`, Math.abs(togo) < 0.05 ? 'goal reached 🎉' : togo > 0 ? `to lose (goal ${w(state.settings.goalKg)})` : `to gain (goal ${w(state.settings.goalKg)})`));
    }
    stats.push(statBox('Streak', `${weighStreak()} days`, `${list.length} weigh-ins total`));
  }
  $('#weightStats').innerHTML = stats.join('');

  // Chart
  const cutoff = weightRange ? addDays(today, -weightRange) : '0000';
  const all = movingAverage(list);
  const shown = list.filter(e => e.date >= cutoff);
  const shownAvg = all.filter(e => e.date >= cutoff);
  lineChart($('#weightChart'), {
    a: shown.map(e => ({ x: parseDate(e.date).getTime(), y: toDisp(e.kg), label: `${fmtDate(e.date)}: ${wu(e.kg)}` })),
    b: shownAvg.map(e => ({ x: parseDate(e.date).getTime(), y: toDisp(e.kg) })),
    goal: state.settings.goalKg ? toDisp(state.settings.goalKg) : null,
    empty: 'Log your first weigh-in to see your trend.'
  });

  // List
  const rows = [...list].reverse().slice(0, 60);
  $('#weightList').innerHTML = rows.length ? rows.map((e, i) => {
    const prev = list[list.length - 2 - i];
    const delta = prev ? e.kg - prev.kg : null;
    return `<div class="list-row">
      <div><strong>${w(e.kg)}</strong> <span class="muted small">${unit()}</span>
        ${delta != null ? `<span class="small ${delta > 0 ? 'up' : delta < 0 ? 'down' : 'muted'}">${delta > 0 ? '+' : ''}${w(delta)}</span>` : ''}
        <div class="muted small">${fmtDate(e.date, { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' })}${e.note ? ' · ' + esc(e.note) : ''}</div>
      </div>
      <div>
        <button class="btn ghost small" data-edit-weigh="${e.date}" type="button">Edit</button>
        <button class="btn ghost small" data-del-weigh="${e.date}" type="button" aria-label="Delete">✕</button>
      </div>
    </div>`;
  }).join('') + (list.length > 60 ? `<p class="muted small">Showing latest 60 of ${list.length}. Export CSV for all.</p>` : '')
    : '<div class="empty">No weigh-ins yet.</div>';

  $$('[data-del-weigh]').forEach(b => b.onclick = () => {
    if (!confirm(`Delete weigh-in for ${fmtDate(b.dataset.delWeigh)}?`)) return;
    state.weighIns = state.weighIns.filter(x => x.date !== b.dataset.delWeigh);
    save(); renderAll();
  });
  $$('[data-edit-weigh]').forEach(b => b.onclick = () => {
    const e = weighInOn(b.dataset.editWeigh);
    $('#wDate').value = e.date;
    $('#wValue').value = inputVal(e.kg);
    $('#wNote').value = e.note || '';
    form.scrollIntoView({ behavior: 'smooth', block: 'center' });
    $('#wValue').focus();
  });
}

function signed(kg) { return `${kg > 0 ? '+' : ''}${w(kg)} ${unit()}`; }

function statBox(label, value, sub, trend) {
  const cls = trend > 0 ? 'up' : trend < 0 ? 'down' : '';
  return `<div class="stat"><div class="label">${label}</div><div class="value ${cls}">${value}</div><div class="sub">${sub}</div></div>`;
}

/* ------------------------------------------------------------- History */

function renderHistory() {
  const list = sortedWorkouts();
  const el = $('#historyList');
  if (!list.length) { el.innerHTML = '<div class="empty">No workouts yet. Start one from the Today tab.</div>'; return; }
  let month = '';
  el.innerHTML = list.map(wk => {
    const dur = wk.startedAt && wk.finishedAt ? fmtDuration(new Date(wk.finishedAt) - new Date(wk.startedAt)) : '';
    const bw = weighInOn(wk.date);
    const d = parseDate(wk.date);
    const m = d.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
    const header = m !== month ? `<h3 class="month">${m}</h3>` : '';
    month = m;
    return `${header}<div class="hist-item">
      <div class="hist-row">
        <div class="date-badge">
          <span class="dow">${d.toLocaleDateString(undefined, { weekday: 'short' })}</span>
          <span class="day">${d.getDate()}</span>
          <span class="mon">${d.toLocaleDateString(undefined, { month: 'short' })}</span>
        </div>
        <div class="hist-main">
          <strong>${esc(wk.name)}</strong>
          <div class="muted small">${[dur, `${workoutSets(wk)} ${workoutSets(wk) === 1 ? 'set' : 'sets'}`, `${num(toDisp(workoutVolume(wk)), 0)} ${unit()} volume`, bw ? `body weight ${wu(bw.kg)}` : ''].filter(Boolean).join(' · ')}</div>
          <details>
            <summary class="small" style="color:var(--accent);margin-top:4px">Show exercises (${wk.exercises.length})</summary>
            ${wk.exercises.map(ex => `<div class="hist-ex"><b>${esc(ex.name)}</b> — ${ex.sets.map(s => `${w(s.kg)}×${s.reps}`).join(', ')}</div>`).join('')}
            ${wk.notes ? `<div class="hist-ex muted">“${esc(wk.notes)}”</div>` : ''}
          </details>
          <div class="btn-row" style="margin-top:6px;align-items:center">
            <button class="btn small" data-hist-repeat="${wk.id}" type="button">↻ Repeat</button>
            <button class="btn ghost small" data-hist-del="${wk.id}" type="button">Delete</button>
            <label class="date-edit small">Change date <input type="date" data-hist-date="${wk.id}" value="${wk.date}" max="${todayStr()}"></label>
          </div>
        </div>
      </div>
    </div>`;
  }).join('');

  $$('[data-hist-date]', el).forEach(inp => inp.onchange = () => {
    const wk = state.workouts.find(x => x.id === inp.dataset.histDate);
    if (!inp.value || inp.value > todayStr()) { inp.value = wk.date; toast('Pick today or an earlier date'); return; }
    if (inp.value !== wk.date) {
      wk.date = inp.value;
      if (!wk.startedAt || dateStr(new Date(wk.startedAt)) !== wk.date) wk.finishedAt = null;
      save(); renderAll(); toast(`Moved to ${fmtDate(wk.date)}`);
    }
  });
  $$('[data-hist-repeat]', el).forEach(b => b.onclick = () => {
    if (state.draft && !confirm('You already have a workout in progress. Replace it?')) return;
    newDraft(state.workouts.find(x => x.id === b.dataset.histRepeat));
    showView('today');
    renderToday();
  });
  $$('[data-hist-del]', el).forEach(b => b.onclick = () => {
    const wk = state.workouts.find(x => x.id === b.dataset.histDel);
    if (!confirm(`Delete "${wk.name}" from ${fmtDate(wk.date)}?`)) return;
    state.workouts = state.workouts.filter(x => x.id !== wk.id);
    save(); renderAll();
  });
}

/* ------------------------------------------------------------ Progress */

function exerciseHistory() {
  // name -> [{ date, best1rm, topKg, topReps, volume }] oldest first
  const map = new Map();
  for (const wk of [...state.workouts].sort((a, b) => a.date.localeCompare(b.date))) {
    for (const ex of wk.exercises) {
      let best = 0, topKg = 0, topReps = 0, vol = 0;
      for (const s of ex.sets) {
        best = Math.max(best, e1rm(s.kg, s.reps));
        if (s.kg > topKg || (s.kg === topKg && s.reps > topReps)) { topKg = s.kg; topReps = s.reps; }
        vol += (s.kg || 0) * (s.reps || 0);
      }
      if (!map.has(ex.name)) map.set(ex.name, []);
      map.get(ex.name).push({ date: wk.date, best1rm: best, topKg, topReps, volume: vol });
    }
  }
  return map;
}

function renderProgress() {
  const hist = exerciseHistory();
  const sel = $('#progressExercise');
  const names = [...hist.keys()].sort((a, b) => hist.get(b).length - hist.get(a).length || a.localeCompare(b));
  const current = sel.value && hist.has(sel.value) ? sel.value : names[0];
  sel.innerHTML = names.length ? names.map(n => `<option ${n === current ? 'selected' : ''}>${esc(n)}</option>`).join('') : '<option>No exercises yet</option>';
  sel.disabled = !names.length;

  const series = current ? hist.get(current) : [];
  lineChart($('#progressChart'), {
    a: series.map(s => ({ x: parseDate(s.date).getTime(), y: toDisp(s.best1rm), label: `${fmtDate(s.date)}: e1RM ${wu(s.best1rm)}` })),
    b: series.map(s => ({ x: parseDate(s.date).getTime(), y: toDisp(s.topKg) })),
    bDots: true,
    empty: 'Finish a workout to start tracking progress.'
  });

  if (!names.length) { $('#prTable').innerHTML = '<div class="empty">Your personal records will show here.</div>'; return; }
  $('#prTable').innerHTML = `<div class="table-wrap"><table class="pr">
    <thead><tr><th>Exercise</th><th>Heaviest</th><th>Best e1RM</th><th>Sessions</th><th>Last</th></tr></thead>
    <tbody>${[...names].sort((a, b) => a.localeCompare(b)).map(n => {
      const s = hist.get(n);
      const heavy = s.reduce((m, x) => (x.topKg > m.topKg || (x.topKg === m.topKg && x.topReps > m.topReps)) ? x : m, s[0]);
      const best = s.reduce((m, x) => x.best1rm > m.best1rm ? x : m, s[0]);
      return `<tr><td>${esc(n)}</td><td>${w(heavy.topKg)}×${heavy.topReps}</td><td>${wu(best.best1rm)}</td><td>${s.length}</td><td>${fmtDate(s[s.length - 1].date, { month: 'short', day: 'numeric' })}</td></tr>`;
    }).join('')}</tbody></table></div>
    <p class="muted small" style="margin:8px 0 0">e1RM = estimated one-rep max using the Epley formula: weight × (1 + reps ÷ 30). It's an estimate, most reliable for sets under ~10 reps.</p>`;
}

/* --------------------------------------------------------------- Chart */

function lineChart(el, { a = [], b = [], goal = null, bDots = false, empty = 'No data yet.' }) {
  if (!a.length) { el.innerHTML = `<div class="empty">${esc(empty)}</div>`; return; }
  const W = Math.max(300, el.clientWidth || 600), H = 220, L = 42, R = 12, T = 12, B = 26;
  const xs = [...a, ...b].map(p => p.x);
  const ys = [...a, ...b].map(p => p.y);
  if (goal != null) ys.push(goal);
  let x0 = Math.min(...xs), x1 = Math.max(...xs);
  if (x0 === x1) { x0 -= DAY; x1 += DAY; }
  let y0 = Math.min(...ys), y1 = Math.max(...ys);
  const padY = Math.max((y1 - y0) * 0.12, 1);
  y0 -= padY; y1 += padY;

  const sx = x => L + (x - x0) / (x1 - x0) * (W - L - R);
  const sy = y => T + (1 - (y - y0) / (y1 - y0)) * (H - T - B);
  const path = pts => pts.map((p, i) => `${i ? 'L' : 'M'}${sx(p.x).toFixed(1)},${sy(p.y).toFixed(1)}`).join('');

  const yTicks = niceTicks(y0, y1, 4);
  const xTickCount = Math.min(W < 450 ? 3 : 5, Math.max(1, Math.round((x1 - x0) / DAY)));
  const xTicks = Array.from({ length: xTickCount + 1 }, (_, i) => x0 + (x1 - x0) * i / xTickCount);
  const spanDays = (x1 - x0) / DAY;
  const xFmt = t => new Date(t).toLocaleDateString(undefined, spanDays > 300 ? { month: 'short', year: '2-digit' } : { month: 'short', day: 'numeric' });

  el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Line chart">
    ${yTicks.map(t => `<line class="axis" x1="${L}" x2="${W - R}" y1="${sy(t)}" y2="${sy(t)}"/>
      <text class="tick" x="${L - 6}" y="${sy(t) + 4}" text-anchor="end">${num(t, 1)}</text>`).join('')}
    ${xTicks.map((t, i) => `<text class="tick" x="${sx(t)}" y="${H - 6}" text-anchor="${i === 0 ? 'start' : i === xTicks.length - 1 ? 'end' : 'middle'}">${xFmt(t)}</text>`).join('')}
    ${goal != null ? `<line class="goal" x1="${L}" x2="${W - R}" y1="${sy(goal)}" y2="${sy(goal)}"/>` : ''}
    <path class="line-a" d="${path(a)}"/>
    ${b.length ? `<path class="line-b" d="${path(b)}"/>` : ''}
    ${a.map(p => `<circle class="dot-a" cx="${sx(p.x)}" cy="${sy(p.y)}" r="${a.length > 60 ? 2 : 3.5}"><title>${esc(p.label || '')}</title></circle>`).join('')}
    ${bDots ? b.map(p => `<circle cx="${sx(p.x)}" cy="${sy(p.y)}" r="3" fill="var(--accent2)"/>`).join('') : ''}
  </svg>`;
}

function niceTicks(lo, hi, count) {
  const span = hi - lo;
  const step0 = span / count;
  const mag = 10 ** Math.floor(Math.log10(step0));
  const step = [1, 2, 2.5, 5, 10].map(m => m * mag).find(s => s >= step0) || step0;
  const out = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) out.push(v);
  return out;
}

/* ------------------------------------------------------------ Settings */

function renderSettings() {
  $('#sUnit').value = unit();
  $('#sGoal').value = state.settings.goalKg ? inputVal(state.settings.goalKg) : '';
}

function download(filename, content, type) {
  const blob = new Blob([content], { type });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
}

/* =============================================================== WIRING */

function showView(name) {
  $$('.view').forEach(v => v.classList.toggle('active', v.id === 'view-' + name));
  $$('.tabbar button').forEach(b => b.classList.toggle('on', b.dataset.view === name));
  window.scrollTo(0, 0);
  if (name === 'weight') renderWeight();
  if (name === 'progress') renderProgress();
  try { sessionStorage.setItem('dansgym.view', name); } catch (e) { /* ignore */ }
}

$$('.tabbar button').forEach(b => b.onclick = () => showView(b.dataset.view));

$('#weighForm').onsubmit = e => {
  e.preventDefault();
  const date = $('#wDate').value;
  const v = parseFloat($('#wValue').value);
  if (!date || !(v > 0)) return;
  if (date > todayStr()) { toast('Can\'t log a weigh-in in the future'); return; }
  upsertWeighIn(date, fromDisp(v), $('#wNote').value.trim());
  $('#wValue').value = '';
  $('#wNote').value = '';
  $('#wDate').value = todayStr();
  toast('Weigh-in saved');
  renderAll();
};

$('#weightRange').onclick = e => {
  const b = e.target.closest('button');
  if (!b) return;
  weightRange = +b.dataset.range;
  $$('#weightRange button').forEach(x => x.classList.toggle('on', x === b));
  renderWeight();
};

$('#progressExercise').onchange = renderProgress;

$('#settingsForm').onsubmit = e => {
  e.preventDefault();
  // Read the goal in the *old* unit before switching units
  const goalRaw = $('#sGoal').value;
  const goalKg = goalRaw === '' ? null : fromDisp(parseFloat(goalRaw));
  state.settings.goalKg = goalKg;
  state.settings.unit = $('#sUnit').value;
  save();
  toast('Settings saved');
  renderAll();
};

$('#exportBtn').onclick = () => {
  const { draft, ...data } = state;
  download(`dans-gym-backup-${todayStr()}.json`, JSON.stringify({ ...data, exportedAt: new Date().toISOString() }, null, 2), 'application/json');
};

$('#csvBtn').onclick = () => {
  const rows = [['date', `weight_${unit()}`, 'weight_kg', 'note']];
  for (const e of sortedWeighIns()) rows.push([e.date, num(toDisp(e.kg), 2), num(e.kg, 2), `"${(e.note || '').replace(/"/g, '""')}"`]);
  download(`weigh-ins-${todayStr()}.csv`, rows.map(r => r.join(',')).join('\n'), 'text/csv');
};

$('#importFile').onchange = async e => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    if (!Array.isArray(data.weighIns) || !Array.isArray(data.workouts)) throw new Error('Not a Dan\'s Gym backup');
    const mode = confirm(`Backup has ${data.workouts.length} workouts and ${data.weighIns.length} weigh-ins.\n\nOK = merge with current data\nCancel = choose replace instead`);
    if (mode) {
      const ids = new Set(state.workouts.map(x => x.id));
      state.workouts.push(...data.workouts.filter(x => !ids.has(x.id)));
      for (const wi of data.weighIns) if (!weighInOn(wi.date)) state.weighIns.push(wi);
    } else {
      if (!confirm('Replace ALL current data with the backup? This cannot be undone.')) return;
      state = { ...defaultState(), ...data, settings: { ...defaultState().settings, ...(data.settings || {}) }, draft: state.draft };
      delete state.exportedAt;
    }
    save(); renderAll();
    toast('Backup imported');
  } catch (err) {
    alert('Could not import: ' + err.message);
  }
};

$('#wipeBtn').onclick = () => {
  if (!confirm('Delete ALL workouts, weigh-ins and settings from this device?')) return;
  if (!confirm('Are you absolutely sure? Export a backup first if you might want this data.')) return;
  state = defaultState(); save(); renderAll();
  toast('All data deleted');
};

let resizeTimer;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => { renderWeight(); renderProgress(); }, 150);
});

// Refresh "today" if the app is left open past midnight or reopened later
document.addEventListener('visibilitychange', () => { if (!document.hidden) renderAll(); });

renderAll();
try {
  const v = sessionStorage.getItem('dansgym.view');
  if (v && $('#view-' + v)) showView(v);
} catch (e) { /* ignore */ }

// Offline support when served over http(s)
if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
