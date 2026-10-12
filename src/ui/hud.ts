import { DEG, KN } from '../sim/boat';
import type { TrimHint } from '../sim/autotrim';
import type { CoachMsg } from '../sim/coach';
import type { LessonRun } from '../sim/lessons';
import { mainLimit, type Telltale } from '../sim/physics';

const f0 = (x: number) => Math.round(x).toString();
const f1 = (x: number) => x.toFixed(1);
const deg = (r: number) => (r / DEG + 360) % 360;
const signedDeg = (r: number) => r / DEG;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, html?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  return e;
}

export interface HudActions {
  [k: string]: () => void;
}

export interface ReplayInfo {
  label: string;
  rows: [number, number, number, number][];
  startHour: number;
  compression: number;
}

export class Hud {
  root = el('div', 'hud');
  private inst = el('div', 'panel inst');
  private trim = el('div', 'panel trim');
  private coachBox = el('div', 'coach');
  private banner = el('div', 'banner');
  private obj = el('div', 'panel objectives');
  private status = el('div', 'statusbar');
  private timeline = el('canvas', 'timeline') as HTMLCanvasElement;
  private svgDiagram: SVGSVGElement;
  private tellSvg: SVGSVGElement;
  replay: ReplayInfo | null = null;
  showHint = false;
  private bars: Record<string, { fill: HTMLElement; ghost: HTMLElement; val: HTMLElement }> = {};
  private toggles: Record<string, HTMLElement> = {};

  constructor(actions: HudActions) {
    this.root.append(this.inst, this.trim, this.coachBox, this.banner, this.obj, this.status, this.timeline);
    this.timeline.width = 720;
    this.timeline.height = 130;

    // ---- instruments ----
    this.inst.innerHTML = `
      <div class="big"><span id="h-spd">0.0</span><small>kn</small><label>Boat speed</label></div>
      <div class="grid">
        <div><label>Heading</label><b id="h-hdg">000°</b></div>
        <div><label>VMG</label><b id="h-vmg">0.0</b></div>
        <div><label>TWS</label><b id="h-tws">0.0</b></div>
        <div><label>TWA</label><b id="h-twa">0°</b></div>
        <div><label>AWS</label><b id="h-aws">0.0</b></div>
        <div><label>AWA</label><b id="h-awa">0°</b></div>
      </div>
      <div class="heel"><label>Heel <b id="h-heel">0°</b></label><div class="heelbar"><i id="h-heelbar"></i><em></em></div></div>
    `;
    this.svgDiagram = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    this.svgDiagram.setAttribute('viewBox', '-100 -100 200 200');
    this.svgDiagram.classList.add('diagram');
    this.svgDiagram.innerHTML = `
      <circle r="92" class="dial"/>
      ${Array.from({ length: 36 }, (_, i) => {
        const a = i * 10 * DEG;
        const r0 = i % 3 === 0 ? 82 : 87;
        return `<line x1="${Math.sin(a) * r0}" y1="${-Math.cos(a) * r0}" x2="${Math.sin(a) * 92}" y2="${-Math.cos(a) * 92}" class="tick"/>`;
      }).join('')}
      <path d="M0,-40 C14,-20 16,10 12,38 L-12,38 C-16,10 -14,-20 0,-40 Z" class="hull"/>
      <line id="d-boom" x1="0" y1="-8" x2="0" y2="22" class="boom"/>
      <path id="d-jib" d="" class="jib"/>
      <g id="d-tw"><line x1="0" y1="-92" x2="0" y2="-58" class="tw"/><path d="M-7,-66 L0,-56 L7,-66" class="tw"/></g>
      <g id="d-aw"><line x1="0" y1="-92" x2="0" y2="-50" class="aw"/><path d="M-7,-58 L0,-48 L7,-58" class="aw"/></g>
      <text x="0" y="-68" class="lbl" id="d-n">N</text>
    `;
    this.inst.append(this.svgDiagram);
    const legend = el('div', 'legend', '<i class="tw"></i>true wind <i class="aw"></i>apparent <i class="bm"></i>boom/jib');
    this.inst.append(legend);

    // ---- trim panel ----
    this.trim.innerHTML = '<h3>Sail controls</h3>';
    const bar = (key: string, label: string, keys: string, minus: string, plus: string) => {
      const row = el('div', 'bar');
      row.innerHTML = `<div class="lab">${label}<kbd>${keys}</kbd><span class="v"></span></div>
        <div class="track"><i class="fill"></i><i class="ghost"></i></div>
        <div class="btns"><button data-a="${minus}">−</button><button data-a="${plus}">+</button></div>`;
      this.trim.append(row);
      this.bars[key] = {
        fill: row.querySelector('.fill')!,
        ghost: row.querySelector('.ghost')!,
        val: row.querySelector('.v')!,
      };
    };
    bar('main', 'Mainsheet (eased →)', 'W/S', 'mainIn', 'mainOut');
    bar('trav', 'Traveler (down →)', '[ ]', 'travUp', 'travDown');
    bar('jib', 'Jib sheet (eased →)', 'E/Q', 'jibIn', 'jibOut');
    const tg = el('div', 'toggles');
    const toggle = (key: string, label: string, kbd: string, action: string) => {
      const b = el('button', 'tog', `${label} <kbd>${kbd}</kbd><span></span>`);
      b.dataset.a = action;
      tg.append(b);
      this.toggles[key] = b.querySelector('span')!;
    };
    toggle('jibSide', 'Jib sheet', 'T', 'switchJib');
    toggle('vang', 'Vang', 'V', 'vang');
    toggle('backstay', 'Backstay', 'B', 'backstay');
    toggle('reef', 'Reef', 'R/⇧R', 'reef');
    toggle('headsail', 'Headsail', 'G', 'headsail');
    toggle('hike', 'Hike', 'H', 'hike');
    toggle('lock', 'Tiller lock', 'L', 'lock');
    toggle('hint', 'Hint', 'I', 'hint');
    this.trim.append(tg);
    const tt = el('div', 'tells');
    tt.innerHTML = '<h3>Jib telltales</h3>';
    this.tellSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    this.tellSvg.setAttribute('viewBox', '0 0 220 120');
    tt.append(this.tellSvg);
    this.trim.append(tt);
    this.trim.addEventListener('click', (e) => {
      const a = (e.target as HTMLElement).closest('[data-a]') as HTMLElement | null;
      if (a?.dataset.a && actions[a.dataset.a]) actions[a.dataset.a]();
    });
    // hold-to-repeat for +/- buttons
    let rep: number | undefined;
    this.trim.addEventListener('pointerdown', (e) => {
      const a = (e.target as HTMLElement).closest('.btns [data-a]') as HTMLElement | null;
      if (!a) return;
      rep = window.setInterval(() => actions[a.dataset.a!]?.(), 60);
    });
    const stop = () => window.clearInterval(rep);
    window.addEventListener('pointerup', stop);
    window.addEventListener('pointercancel', stop);
  }

  update(run: LessonRun, coach: CoachMsg | null, hint: TrimHint | null, extras: { timeScale: number; camera: string; paused: boolean }) {
    const sim = run.sim;
    const d = sim.diag;
    const s = sim.state;
    const c = sim.controls;
    const $ = (id: string) => this.root.querySelector('#' + id) as HTMLElement;
    $('h-spd').textContent = f1(d.speed / KN);
    $('h-hdg').textContent = f0(deg(s.heading)).padStart(3, '0') + '°';
    $('h-vmg').textContent = f1(d.vmg / KN);
    $('h-tws').textContent = f1(d.tws / KN);
    $('h-twa').textContent = `${f0(Math.abs(signedDeg(d.twa)))}° ${d.twa >= 0 ? 'S' : 'P'}`;
    $('h-aws').textContent = f1(d.aws / KN);
    $('h-awa').textContent = `${f0(Math.abs(signedDeg(d.awa)))}° ${d.awa >= 0 ? 'S' : 'P'}`;
    const heel = signedDeg(s.heel);
    $('h-heel').textContent = `${f0(Math.abs(heel))}°`;
    const hb = $('h-heelbar');
    hb.style.width = `${Math.min(100, (Math.abs(heel) / 45) * 50)}%`;
    hb.style.left = heel >= 0 ? '50%' : `${50 - Math.min(50, (Math.abs(heel) / 45) * 50)}%`;
    hb.className = Math.abs(heel) > 30 ? 'bad' : Math.abs(heel) > 22 ? 'warn' : '';

    // Diagram (boat-up): wind arrows relative to the bow, boom and jib angles
    const rot = (id: string, a: number) => this.svgDiagram.getElementById(id)?.setAttribute('transform', `rotate(${a})`);
    rot('d-tw', signedDeg(d.twa));
    rot('d-aw', signedDeg(d.awa));
    const north = -deg(s.heading) * DEG;
    const n = this.svgDiagram.getElementById('d-n');
    n?.setAttribute('x', f1(Math.sin(north) * 72));
    n?.setAttribute('y', f1(-Math.cos(north) * 72 + 4));
    const boomA = s.boom;
    const boomLen = 34;
    const by = -8;
    this.svgDiagram
      .getElementById('d-boom')
      ?.setAttributeNS(null, 'x2', f1(Math.sin(boomA) * boomLen));
    this.svgDiagram.getElementById('d-boom')?.setAttributeNS(null, 'y2', f1(by + Math.cos(boomA) * boomLen));
    const jib = this.svgDiagram.getElementById('d-jib');
    if (d.jib) {
      const ja = d.jib.angle;
      const jl = c.headsail === 'genoa' ? 40 : 28;
      const x2 = Math.sin(ja) * jl;
      const y2 = -38 + Math.cos(ja) * jl;
      const sideSign = d.jib.backed ? -Math.sign(ja) : Math.sign(ja);
      const cx = x2 / 2 + sideSign * 6 * Math.cos(ja);
      const cy = (-38 + y2) / 2 + 3;
      jib?.setAttribute('d', `M0,-38 Q${f1(cx)},${f1(cy)} ${f1(x2)},${f1(y2)}`);
      jib?.setAttribute('class', d.jib.backed ? 'jib backed' : d.jib.luff[1] ? 'jib luff' : 'jib');
    } else jib?.setAttribute('d', '');
    this.svgDiagram.getElementById('d-boom')?.setAttribute('class', d.main.luff[1] ? 'boom luff' : 'boom');

    // Trim bars
    const setBar = (k: string, v: number, h: number | null, txt: string) => {
      const b = this.bars[k];
      b.fill.style.width = `${v * 100}%`;
      b.val.textContent = txt;
      b.ghost.style.display = h === null || !this.showHint ? 'none' : 'block';
      if (h !== null) b.ghost.style.left = `calc(${h * 100}% - 2px)`;
    };
    setBar('main', c.mainsheet, hint?.mainsheet ?? null, `boom ${f0(Math.abs(s.boom / DEG))}° · limit ${f0(mainLimit(c) / DEG)}°`);
    setBar('trav', c.traveler, hint?.traveler ?? null, `${f0(c.traveler * 12)}°`);
    setBar('jib', c.jibSheet, hint?.jibSheet ?? null, d.jib ? `jib ${f0(Math.abs(d.jib.angle / DEG))}°` : '—');
    const t = this.toggles;
    t.jibSide.textContent = c.jibSide > 0 ? 'starboard' : 'port';
    t.jibSide.className = hint && this.showHint && hint.jibSide !== c.jibSide ? 'hint' : '';
    t.vang.textContent = ['slack', 'medium', 'hard'][c.vang];
    t.backstay.textContent = `${c.backstay * 50}%`;
    t.reef.textContent = sim.reefing ? 'reefing…' : ['full main', '1 reef', '2 reefs'][c.reef];
    t.headsail.textContent = sim.headsailChange ? `→ ${sim.headsailChange.target}…` : c.headsail;
    t.hike.textContent = c.hike ? 'on' : 'off';
    t.lock.textContent = sim.tillerLock ? 'locked' : 'free';
    t.hint.textContent = this.showHint ? 'on' : 'off';
    this.drawTelltales(run);

    // Coach & banner
    const msg = coach;
    this.coachBox.className = `coach ${msg?.level ?? 'none'}`;
    this.coachBox.textContent = msg?.text ?? '';
    this.banner.textContent = run.announcement && sim.t - (run.lesson.announcements?.[0]?.t ?? 0) < 25 ? run.announcement : '';
    this.banner.style.display = this.banner.textContent ? 'block' : 'none';

    // Objectives
    const L = run.lesson;
    const remaining = Number.isFinite(L.timeLimit) ? Math.max(0, L.timeLimit - sim.t) : null;
    let html = `<h3>${L.n ? `Lesson ${L.n}: ` : ''}${L.title}</h3>`;
    if (remaining !== null) html += `<div class="timer">⏱ ${Math.floor(remaining / 60)}:${String(Math.floor(remaining % 60)).padStart(2, '0')}</div>`;
    html += '<ul>';
    run.objectives.forEach((o, i) => {
      const st = run.states[i];
      const cls = st?.failed ? 'fail' : st?.done && o.kind === 'goal' ? 'done' : o.kind === 'avoid' ? 'avoid' : '';
      html += `<li class="${cls}"><span>${o.label}</span><em>${st?.progress ?? ''}</em></li>`;
    });
    html += '</ul>';
    for (const m of run.marks) {
      const dx = m.x - s.x;
      const dy = m.y - s.y;
      const brg = (Math.atan2(dx, dy) / DEG + 360) % 360;
      const rel = ((brg - deg(s.heading) + 540) % 360) - 180;
      html += `<div class="mark"><span class="arrow" style="transform:rotate(${rel}deg)">⬆</span> ${m.label}: ${f0(Math.hypot(dx, dy))} m, bearing ${f0(brg)}°</div>`;
    }
    if (this.replay) {
      const hour = this.replay.startHour + (sim.t * this.replay.compression) / 3600;
      const hh = Math.floor(hour);
      const mm = Math.floor((hour - hh) * 60);
      html += `<div class="clock">${this.replay.label} · ${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')} local · ${this.replay.compression}× time</div>`;
    }
    this.obj.innerHTML = html;

    this.status.textContent = `${extras.paused ? '⏸ PAUSED · ' : ''}${extras.timeScale}× · camera ${extras.camera} (C) · Esc menu · Space pause · 1/2/3 speed`;
    this.timeline.style.display = this.replay ? 'block' : 'none';
    if (this.replay) this.drawTimeline(sim.t);
  }

  private drawTelltales(run: LessonRun) {
    const j = run.sim.diag.jib;
    const svg = this.tellSvg;
    if (!j) {
      svg.innerHTML = '<text x="110" y="60" class="lbl">no headsail</text>';
      return;
    }
    const ribbon = (y: number, state: Telltale, color: string, side: number) => {
      const t = performance.now() / 90;
      const w = Math.sin(t + y) * 6;
      let d: string;
      if (state === 'stream') d = `M60,${y} q40,${w * 0.2} 80,${w * 0.3}`;
      else if (state === 'lift') d = `M60,${y} q12,${-20 + w} ${10 + w},${-34 + w}`;
      else if (state === 'stall') d = `M60,${y} q8,${18 + w} ${-6 + w},${30}`;
      else d = `M60,${y} q20,${w * 2} 30,${-w * 2}`;
      return `<path d="${d}" stroke="${color}" stroke-width="${side > 0 ? 4 : 3}" fill="none" stroke-linecap="round" opacity="${side > 0 ? 1 : 0.75}"/>`;
    };
    const wwColor = j.angle > 0 ? '#e33' : '#2c2'; // windward side is opposite the clew
    const lwColor = j.angle > 0 ? '#2c2' : '#e33';
    const state = j.backed ? 'BACKED' : j.windward === 'stream' && j.leeward === 'stream' ? 'streaming ✓' : '';
    svg.innerHTML = `
      <line x1="60" y1="5" x2="60" y2="115" stroke="#ddd" stroke-width="3"/>
      ${ribbon(40, j.windward, wwColor, 1)}
      ${ribbon(80, j.leeward, lwColor, -1)}
      <text x="150" y="35" class="lbl">windward: ${j.windward}</text>
      <text x="150" y="85" class="lbl">leeward: ${j.leeward}</text>
      <text x="150" y="110" class="lbl strong">${state}</text>`;
  }

  private drawTimeline(simT: number) {
    const r = this.replay!;
    const cv = this.timeline;
    const ctx = cv.getContext('2d')!;
    const W = cv.width;
    const H = cv.height;
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = 'rgba(8,20,32,0.82)';
    ctx.fillRect(0, 0, W, H);
    const pad = 34;
    const maxKn = Math.max(20, ...r.rows.map((x) => Math.min(x[3], 1.6 * x[1])));
    const X = (h: number) => pad + ((W - pad - 10) * h) / 23;
    const Y = (kn: number) => H - 22 - ((H - 64) * kn) / maxKn;
    ctx.strokeStyle = 'rgba(255,255,255,0.15)';
    ctx.fillStyle = 'rgba(255,255,255,0.6)';
    ctx.font = '10px system-ui';
    for (let k = 0; k <= maxKn; k += 5) {
      ctx.beginPath();
      ctx.moveTo(pad, Y(k));
      ctx.lineTo(W - 10, Y(k));
      ctx.stroke();
      ctx.fillText(`${k}`, 8, Y(k) + 3);
    }
    for (let h = 0; h < 24; h += 3) ctx.fillText(`${String(h).padStart(2, '0')}`, X(h) - 6, H - 6);
    // gusts (capped) band and mean line
    ctx.fillStyle = 'rgba(255,170,60,0.25)';
    ctx.beginPath();
    r.rows.forEach((x, i) => (i ? ctx.lineTo(X(x[0]), Y(Math.min(x[3], 1.6 * x[1]))) : ctx.moveTo(X(x[0]), Y(Math.min(x[3], 1.6 * x[1])))));
    [...r.rows].reverse().forEach((x) => ctx.lineTo(X(x[0]), Y(x[1])));
    ctx.fill();
    ctx.strokeStyle = '#5ec8ff';
    ctx.lineWidth = 2;
    ctx.beginPath();
    r.rows.forEach((x, i) => (i ? ctx.lineTo(X(x[0]), Y(x[1])) : ctx.moveTo(X(x[0]), Y(x[1]))));
    ctx.stroke();
    // direction arrows (pointing where the wind blows to)
    ctx.strokeStyle = 'rgba(255,255,255,0.8)';
    ctx.lineWidth = 1.5;
    for (const x of r.rows) {
      const a = (x[2] + 180) * DEG;
      const cx = X(x[0]);
      const cy = 14;
      ctx.beginPath();
      ctx.moveTo(cx - Math.sin(a) * 6, cy + Math.cos(a) * 6);
      ctx.lineTo(cx + Math.sin(a) * 6, cy - Math.cos(a) * 6);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(cx + Math.sin(a) * 6, cy - Math.cos(a) * 6, 1.8, 0, 7);
      ctx.fill();
    }
    const hour = r.startHour + (simT * r.compression) / 3600;
    ctx.strokeStyle = '#ffd34d';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(X(hour), 40);
    ctx.lineTo(X(hour), H - 20);
    ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.8)';
    ctx.fillText('wind kn (blue) · gust band, capped (orange) · arrows: where the wind blows', pad + 4, 36);
  }
}
