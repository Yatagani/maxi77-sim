import { LESSONS, loadProgress, type Lesson } from '../sim/lessons';
import type { HourRow } from '../sim/wind';

export interface Preset {
  date: string;
  name: string;
  lat: number;
  lon: number;
  hours: HourRow[];
}

export type MenuChoice =
  | { kind: 'lesson'; lesson: Lesson }
  | { kind: 'free'; speed: number; dir: number; gust: number; shift: number; headsail: 'genoa' | 'jib' }
  | { kind: 'replay'; preset: Preset; startHour: number; compression: number };

const OSLO = { lat: 59.87, lon: 10.68 };

export async function fetchDay(date: string): Promise<Preset> {
  const url =
    `https://archive-api.open-meteo.com/v1/archive?latitude=${OSLO.lat}&longitude=${OSLO.lon}` +
    `&start_date=${date}&end_date=${date}&hourly=wind_speed_10m,wind_direction_10m,wind_gusts_10m` +
    `&wind_speed_unit=kn&timezone=Europe%2FOslo`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Open-Meteo responded ${res.status}`);
  const j = await res.json();
  const h = j.hourly;
  if (!h?.time?.length) throw new Error('No data for that date');
  const hours: HourRow[] = h.time.map((t: string, i: number) => [
    Number(t.slice(11, 13)),
    h.wind_speed_10m[i] ?? 0,
    h.wind_direction_10m[i] ?? 0,
    h.wind_gusts_10m[i] ?? h.wind_speed_10m[i] ?? 0,
  ]);
  if (hours.some((r) => r[1] === null)) throw new Error('Incomplete data for that date');
  return { date, name: `Custom day ${date}`, ...OSLO, hours };
}

export class Menu {
  root = document.createElement('div');
  private presets: Preset[] = [];

  constructor(private onChoose: (c: MenuChoice) => void) {
    this.root.className = 'menu';
  }

  async loadPresets() {
    try {
      const r = await fetch('./data/oslofjord-presets.json');
      this.presets = (await r.json()).presets;
    } catch {
      this.presets = [];
    }
  }

  show(tab: 'lessons' | 'free' | 'replay' = 'lessons') {
    const prog = loadProgress();
    const skills = ['Sail trim', 'Maneuvers', 'Heavy weather'] as const;
    const maxDate = new Date(Date.now() - 6 * 864e5).toISOString().slice(0, 10);
    this.root.innerHTML = `
      <div class="menu-inner">
        <header>
          <h1>Maxi 77 <span>Sail Trainer</span></h1>
          <p>Pelle Petterson's 1972 masthead sloop — 7.62 m LOA, 2.0 t, 32.9 m² with the 150% genoa.
          Learn to trim and handle her sails in real Oslofjord wind.</p>
        </header>
        <nav>
          <button data-tab="lessons" class="${tab === 'lessons' ? 'on' : ''}">Lessons</button>
          <button data-tab="free" class="${tab === 'free' ? 'on' : ''}">Free sail</button>
          <button data-tab="replay" class="${tab === 'replay' ? 'on' : ''}">Oslofjord replay</button>
        </nav>
        <section class="tab-lessons" ${tab !== 'lessons' ? 'hidden' : ''}>
          ${skills
            .map(
              (sk) => `<h2>${sk}</h2><div class="cards">${LESSONS.filter((l) => l.skill === sk)
                .map((l) => {
                  const p = prog[l.id];
                  return `<button class="card ${p?.passed ? 'passed' : ''}" data-lesson="${l.id}">
                    <b>${l.n}. ${l.title}</b>
                    <small>${l.briefing[0]}</small>
                    ${p?.passed ? `<em>✓ best ${p.best}</em>` : ''}
                  </button>`;
                })
                .join('')}</div>`,
            )
            .join('')}
        </section>
        <section class="tab-free" ${tab !== 'free' ? 'hidden' : ''}>
          <div class="form">
            <label>Wind speed <output id="o-spd">10</output> kn<input id="f-spd" type="range" min="3" max="28" value="10"></label>
            <label>Wind from <output id="o-dir">200</output>°<input id="f-dir" type="range" min="0" max="355" step="5" value="200"></label>
            <label>Gustiness <output id="o-gust">3</output> kn<input id="f-gust" type="range" min="0" max="12" value="3"></label>
            <label>Shifts ± <output id="o-shift">5</output>°<input id="f-shift" type="range" min="0" max="25" value="5"></label>
            <label>Headsail <select id="f-hs"><option value="genoa">Genoa 150% (23.2 m²)</option><option value="jib">Jib 100% (15 m²)</option></select></label>
            <button class="primary" id="go-free">Sail</button>
          </div>
        </section>
        <section class="tab-replay" ${tab !== 'replay' ? 'hidden' : ''}>
          <p>Real hourly wind (speed, direction, gusts) for the inner Oslofjord (59.87 N, 10.68 E) from the
          <a href="https://open-meteo.com/" target="_blank" rel="noopener">Open-Meteo</a> historical archive (ERA5/IFS reanalysis, CC BY 4.0).
          Reanalysis gusts over land-mixed grid cells run high, so gusts are capped at 1.6× the mean.</p>
          <div class="presets">
            ${this.presets
              .map(
                (p, i) => `<label class="preset"><input type="radio" name="preset" value="${i}" ${i === 0 ? 'checked' : ''}>
                <b>${p.date}</b> ${p.name}
                <small>${summary(p)}</small></label>`,
              )
              .join('')}
            <label class="preset"><input type="radio" name="preset" value="custom"> <b>Any date</b>
              <input type="date" id="r-date" min="1940-01-01" max="${maxDate}" value="2025-07-01"></label>
          </div>
          <div class="form row">
            <label>Start at <select id="r-hour">${Array.from({ length: 22 }, (_, h) => `<option value="${h}" ${h === 11 ? 'selected' : ''}>${String(h).padStart(2, '0')}:00</option>`).join('')}</select></label>
            <label>Time <select id="r-comp"><option value="1">real time (1×)</option><option value="30" selected>30× (1 h = 2 min)</option><option value="120">120× (1 h = 30 s)</option></select></label>
            <button class="primary" id="go-replay">Sail this day</button>
          </div>
          <p class="err" id="r-err"></p>
        </section>
        <footer>Keyboard: ←/→ steer · W/S main · E/Q jib · T switch jib sheet · [ ] traveler · V vang · B backstay · R reef · G headsail · H hike · L lock tiller · C camera · I hint · Space pause</footer>
      </div>`;
    this.root.style.display = 'flex';
    this.root.querySelectorAll<HTMLButtonElement>('nav button').forEach((b) => (b.onclick = () => this.show(b.dataset.tab as 'lessons')));
    this.root.querySelectorAll<HTMLButtonElement>('[data-lesson]').forEach(
      (b) => (b.onclick = () => this.onChoose({ kind: 'lesson', lesson: LESSONS.find((l) => l.id === b.dataset.lesson)! })),
    );
    for (const k of ['spd', 'dir', 'gust', 'shift']) {
      const inp = this.root.querySelector<HTMLInputElement>(`#f-${k}`);
      const out = this.root.querySelector<HTMLOutputElement>(`#o-${k}`);
      if (inp && out) inp.oninput = () => (out.value = inp.value);
    }
    const q = <T extends HTMLElement>(s: string) => this.root.querySelector<T>(s)!;
    const goFree = this.root.querySelector<HTMLButtonElement>('#go-free');
    if (goFree)
      goFree.onclick = () =>
        this.onChoose({
          kind: 'free',
          speed: +q<HTMLInputElement>('#f-spd').value,
          dir: +q<HTMLInputElement>('#f-dir').value,
          gust: +q<HTMLInputElement>('#f-gust').value,
          shift: +q<HTMLInputElement>('#f-shift').value,
          headsail: q<HTMLSelectElement>('#f-hs').value as 'genoa',
        });
    const goReplay = this.root.querySelector<HTMLButtonElement>('#go-replay');
    if (goReplay)
      goReplay.onclick = async () => {
        const sel = this.root.querySelector<HTMLInputElement>('input[name=preset]:checked')?.value ?? '0';
        const startHour = +q<HTMLSelectElement>('#r-hour').value;
        const compression = +q<HTMLSelectElement>('#r-comp').value;
        const err = q<HTMLElement>('#r-err');
        let preset: Preset | undefined = this.presets[+sel];
        if (sel === 'custom') {
          const date = q<HTMLInputElement>('#r-date').value;
          err.textContent = 'Fetching wind from Open-Meteo…';
          try {
            preset = await fetchDay(date);
            err.textContent = '';
          } catch (e) {
            err.textContent = `Could not load ${date}: ${(e as Error).message}. Pick one of the bundled days instead.`;
            return;
          }
        }
        if (preset) this.onChoose({ kind: 'replay', preset, startHour, compression });
      };
  }

  hide() {
    this.root.style.display = 'none';
  }
}

function summary(p: Preset): string {
  const day = p.hours.filter((h) => h[0] >= 10 && h[0] <= 18);
  const mean = day.reduce((a, h) => a + h[1], 0) / day.length;
  const max = Math.max(...day.map((h) => h[1]));
  const compass = (d: number) => ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round(d / 45) % 8];
  const aft = p.hours.find((h) => h[0] === 15)!;
  return `10–18h mean ${mean.toFixed(0)} kn, max ${max.toFixed(0)} kn, 15:00 from ${compass(aft[2])}`;
}
