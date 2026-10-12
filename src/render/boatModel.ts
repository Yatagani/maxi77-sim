import * as THREE from 'three';
import { BOAT, SAILS } from '../sim/boat';
import { LUFF, type BoatState, type Controls, type Diag, type SailDiag } from '../sim/physics';
import { halfBeam, hullPoint, keelLineZ, sheerZ, tAt, xAt, X_STEM, X_TRANSOM } from './hullShape';

const STATIONS = 72;
const SEGS = 28;

// Colours (typical 1970s Maxi 77: white hull, blue sheer stripe and boot top, red-brown antifouling)
const C_TOPSIDE = new THREE.Color('#f3f1ea');
const C_STRIPE = new THREE.Color('#1d3b6e');
const C_ANTIFOUL = new THREE.Color('#6b2a22');
const C_DECK = new THREE.Color('#e6e0d2');
const C_WINDOW = new THREE.Color('#1a252e');
const C_TEAK = new THREE.Color('#8a5a32');
const C_ALU = new THREE.Color('#c9ced4');
const C_SAIL = new THREE.Color('#f7f4ec');

/** Hull material with crisp painted bands computed per fragment from the local position. */
function hullMaterial(): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.35, metalness: 0.0, side: THREE.DoubleSide });
  m.onBeforeCompile = (shader) => {
    shader.uniforms.cTop = { value: C_TOPSIDE };
    shader.uniforms.cStripe = { value: C_STRIPE };
    shader.uniforms.cAnti = { value: C_ANTIFOUL };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vLocal;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvLocal = position;');
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
varying vec3 vLocal;
uniform vec3 cTop; uniform vec3 cStripe; uniform vec3 cAnti;`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
float t = (vLocal.x - (${X_TRANSOM.toFixed(3)})) / ${(X_STEM - X_TRANSOM).toFixed(3)};
float zs = 0.68 + 0.08 * t + 0.2 * t * t * t;
vec3 col = cTop;
float z = vLocal.y;
if (z > zs - 0.13 && z < zs - 0.05) col = cStripe;
if (z < 0.07) col = cStripe;
if (z < 0.0) col = cAnti;
diffuseColor.rgb *= col;`,
      );
  };
  return m;
}

function buildHull(): THREE.Mesh {
  const pos: number[] = [];
  const idx: number[] = [];
  // both sides: starboard (+Z) and port (-Z)
  for (const side of [1, -1]) {
    const base = pos.length / 3;
    for (let i = 0; i <= STATIONS; i++) {
      const t = i / STATIONS;
      for (let j = 0; j <= SEGS; j++) {
        const [x, y, z] = hullPoint(t, j / SEGS);
        pos.push(x, y, z * side);
      }
    }
    for (let i = 0; i < STATIONS; i++) {
      for (let j = 0; j < SEGS; j++) {
        const a = base + i * (SEGS + 1) + j;
        const b = a + SEGS + 1;
        if (side > 0) idx.push(a, b, a + 1, b, b + 1, a + 1);
        else idx.push(a, a + 1, b, b, a + 1, b + 1);
      }
    }
  }
  // Transom panel
  const tb = pos.length / 3;
  pos.push(X_TRANSOM, (sheerZ(0) + keelLineZ(0)) / 2, 0);
  for (let j = 0; j <= SEGS; j++) {
    const [x, y, z] = hullPoint(0, j / SEGS);
    pos.push(x, y, z);
  }
  for (let j = SEGS; j >= 0; j--) {
    const [x, y, z] = hullPoint(0, j / SEGS);
    pos.push(x, y, -z);
  }
  const nT = 2 * (SEGS + 1);
  for (let k = 0; k < nT - 1; k++) idx.push(tb, tb + 1 + k + 1, tb + 1 + k);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  const mesh = new THREE.Mesh(g, hullMaterial());
  mesh.castShadow = true;
  return mesh;
}

const COCKPIT = { x0: -3.25, x1: -1.0, halfW: 0.62 };

function buildDeck(): THREE.Group {
  const grp = new THREE.Group();
  const pos: number[] = [];
  const idx: number[] = [];
  const NX = 70;
  const NY = 14;
  for (let i = 0; i <= NX; i++) {
    const t = i / NX;
    const b = halfBeam(t);
    const zs = sheerZ(t);
    for (let j = 0; j <= NY; j++) {
      const v = (j / NY) * 2 - 1;
      const camber = 0.06 * (1 - v * v) * Math.min(1, b / 0.6);
      pos.push(xAt(t), zs + camber, v * b * 0.985);
    }
  }
  for (let i = 0; i < NX; i++) {
    for (let j = 0; j < NY; j++) {
      const a = i * (NY + 1) + j;
      const b = a + NY + 1;
      const cx = (pos[a * 3] + pos[b * 3]) / 2;
      const cz = (pos[a * 3 + 2] + pos[(a + 1) * 3 + 2]) / 2;
      if (cx > COCKPIT.x0 && cx < COCKPIT.x1 && Math.abs(cz) < COCKPIT.halfW) continue;
      idx.push(a, a + 1, b, b, a + 1, b + 1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  const deck = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: C_DECK, roughness: 0.85, side: THREE.DoubleSide }));
  deck.receiveShadow = true;
  grp.add(deck);

  // Cockpit well: sole + side walls + benches
  const well = new THREE.MeshStandardMaterial({ color: '#d8d2c4', roughness: 0.9, side: THREE.DoubleSide });
  const len = COCKPIT.x1 - COCKPIT.x0;
  const cx = (COCKPIT.x0 + COCKPIT.x1) / 2;
  const deckZ = sheerZ(tAt(cx)) + 0.05;
  const sole = new THREE.Mesh(new THREE.BoxGeometry(len, 0.04, COCKPIT.halfW * 2), well);
  sole.position.set(cx, deckZ - 0.45, 0);
  grp.add(sole);
  for (const s of [1, -1]) {
    const wall = new THREE.Mesh(new THREE.BoxGeometry(len, 0.47, 0.03), well);
    wall.position.set(cx, deckZ - 0.22, s * COCKPIT.halfW);
    grp.add(wall);
    const bench = new THREE.Mesh(new THREE.BoxGeometry(len - 0.3, 0.05, 0.36), new THREE.MeshStandardMaterial({ color: C_TEAK }));
    bench.position.set(cx + 0.1, deckZ - 0.08, s * (COCKPIT.halfW - 0.18));
    grp.add(bench);
    // cockpit coaming
    const coam = new THREE.Mesh(new THREE.BoxGeometry(len, 0.14, 0.04), new THREE.MeshStandardMaterial({ color: C_DECK }));
    coam.position.set(cx, deckZ + 0.06, s * (COCKPIT.halfW + 0.02));
    grp.add(coam);
  }
  const end = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.47, COCKPIT.halfW * 2), well);
  end.position.set(COCKPIT.x0, deckZ - 0.22, 0);
  grp.add(end);

  // Coachroof with the characteristic long tinted window band
  const roof = buildCoachroof();
  grp.add(roof);

  // Foredeck hatch
  const hatch = new THREE.Mesh(
    new THREE.BoxGeometry(0.5, 0.06, 0.5),
    new THREE.MeshStandardMaterial({ color: '#9fb3bf', roughness: 0.2, metalness: 0.1, transparent: true, opacity: 0.85 }),
  );
  hatch.position.set(2.1, sheerZ(tAt(2.1)) + 0.09, 0);
  grp.add(hatch);

  // Aluminium toerail along the sheer
  const rail: THREE.Vector3[] = [];
  for (let i = 0; i <= 60; i++) {
    const t = i / 60;
    rail.push(new THREE.Vector3(xAt(t), sheerZ(t) + 0.025, halfBeam(t)));
  }
  for (const s of [1, -1]) {
    const pts = rail.map((p) => new THREE.Vector3(p.x, p.y, p.z * s));
    const tube = new THREE.Mesh(
      new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 60, 0.018, 5),
      new THREE.MeshStandardMaterial({ color: C_ALU, metalness: 0.8, roughness: 0.3 }),
    );
    grp.add(tube);
  }
  grp.add(buildGuardrails());
  return grp;
}

function buildCoachroof(): THREE.Group {
  const g = new THREE.Group();
  const x0 = -1.0;
  const x1 = 2.0;
  const h = 0.46;
  const shape = (x: number) => {
    // half-width tapers forward, following the deck
    const t = tAt(x);
    return Math.min(0.8, halfBeam(t) - 0.38);
  };
  const N = 24;
  const pos: number[] = [];
  const idx: number[] = [];
  // ring of 4 points per station: port-low, port-high, stbd-high, stbd-low
  for (let i = 0; i <= N; i++) {
    const x = x0 + ((x1 - x0) * i) / N;
    const w = shape(x);
    const base = sheerZ(tAt(x)) + 0.04;
    const fwdSlope = Math.max(0, (x - (x1 - 0.55)) / 0.55); // front of the roof slopes down
    const top = base + h * (1 - 0.65 * fwdSlope);
    const inset = 0.12; // sides lean inward
    pos.push(x, base, -w, x, top, -(w - inset), x, top, w - inset, x, base, w);
  }
  for (let i = 0; i < N; i++) {
    for (let k = 0; k < 3; k++) {
      const a = i * 4 + k;
      const b = a + 4;
      idx.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
  // front and back caps
  const last = N * 4;
  idx.push(last, last + 1, last + 2, last, last + 2, last + 3);
  idx.push(0, 2, 1, 0, 3, 2);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  const roof = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: C_DECK, roughness: 0.7, side: THREE.DoubleSide }));
  roof.castShadow = true;
  g.add(roof);

  // Window band: a long dark trapezoid on each cabin side
  for (const s of [1, -1]) {
    const wp: number[] = [];
    const wx0 = -0.75;
    const wx1 = 1.25;
    for (const [x, f] of [
      [wx0, 0.3],
      [wx1, 0.42],
      [wx1 - 0.1, 0.8],
      [wx0 + 0.05, 0.85],
    ] as [number, number][]) {
      const w = shape(x);
      const base = sheerZ(tAt(x)) + 0.04;
      const top = base + h;
      const y = base + (top - base) * f;
      const zz = (w - 0.12 * f) * s + 0.006 * s;
      wp.push(x, y, zz);
    }
    const wg = new THREE.BufferGeometry();
    wg.setAttribute('position', new THREE.Float32BufferAttribute(wp, 3));
    wg.setIndex([0, 1, 2, 0, 2, 3]);
    wg.computeVertexNormals();
    g.add(
      new THREE.Mesh(
        wg,
        new THREE.MeshStandardMaterial({ color: C_WINDOW, roughness: 0.08, metalness: 0.3, side: THREE.DoubleSide }),
      ),
    );
  }
  // Sliding companionway hatch
  const slide = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.05, 0.62), new THREE.MeshStandardMaterial({ color: C_DECK }));
  slide.position.set(-0.6, sheerZ(tAt(-0.6)) + 0.04 + h + 0.03, 0);
  g.add(slide);
  return g;
}

function buildGuardrails(): THREE.Group {
  const g = new THREE.Group();
  const steel = new THREE.MeshStandardMaterial({ color: '#d7dbe0', metalness: 0.9, roughness: 0.25 });
  const wire = new THREE.LineBasicMaterial({ color: '#cfd5da' });
  const H = 0.6;
  const xs = [-3.35, -2.4, -1.4, -0.4, 0.6, 1.6, 2.6];
  for (const s of [1, -1]) {
    const tops: THREE.Vector3[] = [];
    for (const x of xs) {
      const t = tAt(x);
      const z = (halfBeam(t) - 0.06) * s;
      const y0 = sheerZ(t);
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, H, 6), steel);
      post.position.set(x, y0 + H / 2, z);
      g.add(post);
      tops.push(new THREE.Vector3(x, y0 + H, z));
    }
    // pulpit and pushpit joins
    tops.unshift(new THREE.Vector3(-3.55, sheerZ(0.02) + H, 0.75 * s));
    tops.push(new THREE.Vector3(3.3, sheerZ(0.93) + H, 0.32 * s));
    for (const f of [1, 0.5]) {
      const pts = tops.map((p) => new THREE.Vector3(p.x, p.y - H * (1 - f), p.z));
      g.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), wire));
    }
  }
  // Pulpit (bow) and pushpit (stern) tubes
  const pulpit = new THREE.CatmullRomCurve3([
    new THREE.Vector3(3.3, sheerZ(0.93) + H, -0.32),
    new THREE.Vector3(3.62, sheerZ(0.97) + H, 0),
    new THREE.Vector3(3.3, sheerZ(0.93) + H, 0.32),
  ]);
  g.add(new THREE.Mesh(new THREE.TubeGeometry(pulpit, 12, 0.014, 5), steel));
  const pushpit = new THREE.CatmullRomCurve3([
    new THREE.Vector3(-3.55, sheerZ(0.02) + H, -0.75),
    new THREE.Vector3(-3.6, sheerZ(0.0) + H, 0),
    new THREE.Vector3(-3.55, sheerZ(0.02) + H, 0.75),
  ]);
  g.add(new THREE.Mesh(new THREE.TubeGeometry(pushpit, 12, 0.014, 5), steel));
  return g;
}

/** Lofted symmetric foil (keel/rudder blade). Leading edge at x=0, chord toward -x, span downward. */
function foilBlade(rootChord: number, tipChord: number, span: number, sweep: number, thick: number, color: THREE.ColorRepresentation) {
  const N = 16;
  const rows = 6;
  const pos: number[] = [];
  const idx: number[] = [];
  const naca = (u: number) => 5 * thick * (0.2969 * Math.sqrt(u) - 0.126 * u - 0.3516 * u * u + 0.2843 * u ** 3 - 0.1036 * u ** 4);
  for (let r = 0; r <= rows; r++) {
    const f = r / rows;
    const c = rootChord + (tipChord - rootChord) * f;
    const le = -sweep * f;
    const y = -span * f;
    for (let i = 0; i <= N; i++) {
      const uu = i / N;
      const t = naca(uu * uu); // cluster points near the leading edge
      pos.push(le - c * uu, y, t * c);
    }
    for (let i = N; i >= 0; i--) {
      const uu = i / N;
      const t = naca(uu * uu);
      pos.push(le - c * uu, y, -t * c);
    }
  }
  const per = 2 * (N + 1);
  for (let r = 0; r < rows; r++) {
    for (let i = 0; i < per - 1; i++) {
      const a = r * per + i;
      const b = a + per;
      idx.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
  // tip cap
  const tip = rows * per;
  for (let i = 1; i < per - 1; i++) idx.push(tip, tip + i, tip + i + 1);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color, roughness: 0.6, side: THREE.DoubleSide }));
}

// ---------------- Sails ----------------

const ROWS = 14;
const COLS = 12;

interface SailMesh {
  mesh: THREE.Mesh;
  geo: THREE.BufferGeometry;
}

function sailMesh(texture: THREE.Texture): SailMesh {
  const geo = new THREE.BufferGeometry();
  const n = (ROWS + 1) * (COLS + 1);
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
  const uv: number[] = [];
  const idx: number[] = [];
  for (let r = 0; r <= ROWS; r++) for (let c = 0; c <= COLS; c++) uv.push(c / COLS, r / ROWS);
  for (let r = 0; r < ROWS; r++)
    for (let c = 0; c < COLS; c++) {
      const a = r * (COLS + 1) + c;
      const b = a + COLS + 1;
      idx.push(a, a + 1, b, b, a + 1, b + 1);
    }
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx);
  const mat = new THREE.MeshStandardMaterial({
    color: C_SAIL,
    map: texture,
    roughness: 0.75,
    side: THREE.DoubleSide,
    transparent: true,
    opacity: 0.97,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.castShadow = true;
  mesh.frustumCulled = false;
  return { mesh, geo };
}

function sailTexture(seams: number, label?: string): THREE.Texture {
  const cv = document.createElement('canvas');
  cv.width = 256;
  cv.height = 512;
  const ctx = cv.getContext('2d')!;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, 256, 512);
  ctx.strokeStyle = 'rgba(150,140,120,0.45)';
  ctx.lineWidth = 2;
  for (let i = 1; i < seams; i++) {
    const y = (512 * i) / seams;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(256, y - 30);
    ctx.stroke();
  }
  if (label) {
    ctx.fillStyle = 'rgba(30,50,100,0.85)';
    ctx.font = 'bold 54px sans-serif';
    ctx.fillText(label, 30, 170);
  }
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const lerpAngle = (angles: number[], h: number) => {
  // angles sampled at h = 1/6, 1/2, 5/6
  if (h <= 1 / 6) return angles[0];
  if (h >= 5 / 6) return angles[2];
  if (h <= 0.5) return angles[0] + (angles[1] - angles[0]) * ((h - 1 / 6) / (1 / 3));
  return angles[1] + (angles[2] - angles[1]) * ((h - 0.5) / (1 / 3));
};

/** Fill sail vertices. Luff from p0 (h=0) to p1 (h=1); chord length per row; angle per row; camber; flutter. */
function shapeSail(
  sm: SailMesh,
  luff0: THREE.Vector3,
  luff1: THREE.Vector3,
  chordAt: (h: number) => number,
  diag: SailDiag,
  depth: number,
  time: number,
  flutterSeed: number,
) {
  const arr = sm.geo.attributes.position.array as Float32Array;
  const sideOfSail = Math.sign(diag.angle) || 1;
  const camberSign = diag.backed ? -sideOfSail : sideOfSail;
  for (let r = 0; r <= ROWS; r++) {
    const h = r / ROWS;
    const lx = luff0.x + (luff1.x - luff0.x) * h;
    const ly = luff0.y + (luff1.y - luff0.y) * h;
    const lz = luff0.z + (luff1.z - luff0.z) * h;
    const ang = lerpAngle(diag.bandAngles, h);
    const alpha = lerpAngle(diag.alpha, h);
    const c = chordAt(h);
    const dx = -Math.cos(ang);
    const dz = Math.sin(ang);
    // horizontal perpendicular to the chord, flipped to point toward the camber side
    const px = -dz;
    const pz = dx;
    // choose perpendicular pointing to the sail's side (leeward)
    const sgn = Math.sign(pz) === Math.sign(camberSign) ? 1 : -1;
    const luffing = alpha < LUFF;
    const partial = luffing ? 1 : Math.max(0, 1 - (alpha - LUFF) / 4);
    const d = luffing ? depth * 0.25 : depth;
    for (let k = 0; k <= COLS; k++) {
      const u = k / COLS;
      let off = d * c * 4 * u * (1 - u) * (1 + 0.35 * (1 - 2 * u));
      // Flutter: travelling wave from luff (full luff) or a luff bubble (nearly luffing)
      const wave = Math.sin(u * 9 - time * 18 + h * 4 + flutterSeed) * Math.sin(time * 7 + h * 3);
      if (luffing) off += 0.12 * c * wave * (0.3 + u);
      else if (partial > 0) off -= partial * 0.06 * c * Math.max(0, 1 - u * 3) * (1 + 0.5 * wave);
      const i = (r * (COLS + 1) + k) * 3;
      arr[i] = lx + dx * c * u + px * sgn * off;
      arr[i + 1] = ly - 0.02 * c * u;
      arr[i + 2] = lz + dz * c * u + pz * sgn * off;
    }
  }
  sm.geo.attributes.position.needsUpdate = true;
  sm.geo.computeVertexNormals();
}

// ---------------- Boat view ----------------

export class BoatView {
  root = new THREE.Group(); // yaw + heel
  private rudder = new THREE.Group();
  private boom = new THREE.Group();
  private main: SailMesh;
  private jib: SailMesh;
  private telltales: THREE.LineSegments;
  private stays: THREE.LineSegments;
  private mainsheetLine: THREE.Line;
  private jibSheets: THREE.Line;

  constructor() {
    const r = this.root;
    r.rotation.order = 'YXZ';
    r.add(buildHull());
    r.add(buildDeck());

    // Cast-iron fin keel (swept, ~1.1 m below the canoe body) and transom-hung rudder
    const keel = foilBlade(1.35, 0.85, BOAT.draft - 0.32, 0.45, 0.12, '#3b3f44');
    keel.position.set(0.95, keelLineZ(tAt(0.3)) + 0.04, 0);
    r.add(keel);

    const blade = foilBlade(0.5, 0.36, 1.35, 0.06, 0.1, '#f0eee6');
    blade.position.set(0, 0.62, 0);
    this.rudder.add(blade);
    const tiller = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.03, 1.25, 8), new THREE.MeshStandardMaterial({ color: C_TEAK }));
    tiller.rotation.z = Math.PI / 2 - 0.12;
    tiller.position.set(0.62, 0.72, 0);
    this.rudder.add(tiller);
    this.rudder.position.set(X_TRANSOM - 0.04, 0, 0);
    r.add(this.rudder);

    // Mast (deck-stepped on the coachroof)
    const alu = new THREE.MeshStandardMaterial({ color: C_ALU, metalness: 0.85, roughness: 0.3 });
    const mastLen = BOAT.mastheadZ - BOAT.mastStepZ;
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.065, mastLen, 12), alu);
    mast.scale.set(1.3, 1, 1); // fore-aft oval section
    mast.position.set(BOAT.mastX, BOAT.mastStepZ + mastLen / 2, 0);
    mast.castShadow = true;
    r.add(mast);
    const sprZ = BOAT.mastStepZ + mastLen * 0.55;
    const spreader = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 1.5, 6), alu);
    spreader.rotation.x = Math.PI / 2;
    spreader.position.set(BOAT.mastX - 0.05, sprZ, 0);
    r.add(spreader);
    // masthead light/windex
    const windex = new THREE.Mesh(new THREE.ConeGeometry(0.03, 0.25, 6), new THREE.MeshStandardMaterial({ color: '#202020' }));
    windex.rotation.z = Math.PI / 2;
    windex.position.set(BOAT.mastX + 0.12, BOAT.mastheadZ + 0.08, 0);
    r.add(windex);

    // Standing rigging
    const top = new THREE.Vector3(BOAT.mastX, BOAT.mastheadZ, 0);
    const tack = new THREE.Vector3(X_STEM - 0.08, BOAT.tackZ, 0);
    const pts: THREE.Vector3[] = [top, tack, top, new THREE.Vector3(X_TRANSOM + 0.08, sheerZ(0.01) + 0.05, 0)];
    for (const s of [1, -1]) {
      const chain = new THREE.Vector3(BOAT.mastX - 0.05, sheerZ(tAt(BOAT.mastX)), s * (halfBeam(tAt(BOAT.mastX)) - 0.08));
      const sprTip = new THREE.Vector3(BOAT.mastX - 0.1, sprZ, s * 0.75);
      pts.push(top, sprTip, sprTip, chain);
      for (const dx of [0.4, -0.45]) {
        pts.push(new THREE.Vector3(BOAT.mastX, sprZ, 0), new THREE.Vector3(BOAT.mastX + dx, chain.y, chain.z * 0.95));
      }
    }
    this.stays = new THREE.LineSegments(
      new THREE.BufferGeometry().setFromPoints(pts),
      new THREE.LineBasicMaterial({ color: '#9aa3ab' }),
    );
    r.add(this.stays);

    // Boom
    const boomLen = BOAT.E + 0.15;
    const boomMesh = new THREE.Mesh(new THREE.BoxGeometry(boomLen, 0.11, 0.06), alu);
    boomMesh.position.set(-boomLen / 2, 0, 0);
    this.boom.add(boomMesh);
    this.boom.position.set(BOAT.mastX - 0.05, BOAT.boomZ, 0);
    r.add(this.boom);

    this.main = sailMesh(sailTexture(9, 'S 4077'));
    this.jib = sailMesh(sailTexture(8));
    r.add(this.main.mesh, this.jib.mesh);

    this.telltales = new THREE.LineSegments(
      new THREE.BufferGeometry(),
      new THREE.LineBasicMaterial({ vertexColors: true, linewidth: 2 }),
    );
    this.telltales.frustumCulled = false;
    r.add(this.telltales);

    const sheetMat = new THREE.LineBasicMaterial({ color: '#2f4f8f' });
    this.mainsheetLine = new THREE.Line(new THREE.BufferGeometry(), sheetMat);
    this.jibSheets = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: '#b03030' }));
    this.mainsheetLine.frustumCulled = false;
    this.jibSheets.frustumCulled = false;
    r.add(this.mainsheetLine, this.jibSheets);
  }

  /** Bounding box of hull + rig in boat coordinates (for R1 checks). */
  bounds(): THREE.Box3 {
    this.root.updateMatrixWorld(true);
    const saved = this.root.matrix.clone();
    this.root.position.set(0, 0, 0);
    this.root.rotation.set(0, 0, 0);
    this.root.updateMatrixWorld(true);
    const b = new THREE.Box3().setFromObject(this.root);
    this.root.matrix.copy(saved);
    return b;
  }

  update(s: BoatState, c: Controls, d: Diag, time: number, waveY = 0, headsailVisible = true) {
    // world: X east, Y up, Z south; heading compass -> rotation.y = PI/2 - heading
    this.root.position.set(s.x, waveY, -s.y);
    this.root.rotation.set(s.heel, Math.PI / 2 - s.heading, 0);

    this.rudder.rotation.y = c.rudder;
    this.boom.rotation.y = s.boom;

    // Mainsail
    const luffLen = BOAT.P * SAILS.reefLuff[c.reef];
    const tack = new THREE.Vector3(BOAT.mastX - 0.07, BOAT.boomZ + 0.06, 0);
    const head = new THREE.Vector3(BOAT.mastX - 0.07, BOAT.boomZ + luffLen, 0);
    const depthMain = 0.13 - 0.05 * (c.backstay / 2) - (c.vang === 2 ? 0.01 : 0);
    const mainDiag = { ...d.main, bandAngles: [s.boom, d.main.bandAngles[1] + (s.boom - d.main.angle), d.main.bandAngles[2] + (s.boom - d.main.angle)] };
    shapeSail(this.main, tack, head, (h) => 0.12 + BOAT.E * (1 - h), mainDiag, depthMain, time, 0);

    // Headsail
    this.jib.mesh.visible = !!d.jib && headsailVisible;
    if (d.jib) {
      const hs = c.headsail === 'none' ? SAILS.genoa : SAILS[c.headsail];
      const jt = new THREE.Vector3(X_STEM - 0.1, BOAT.tackZ + 0.1, 0);
      const top = new THREE.Vector3(BOAT.mastX + 0.05, BOAT.mastheadZ - 0.15, 0);
      const jh = jt.clone().lerp(top, c.headsail === 'genoa' ? 0.97 : 0.9);
      shapeSail(this.jib, jt, jh, (h) => 0.05 + hs.foot * (1 - h), d.jib, 0.14 - 0.04 * (c.backstay / 2), time, 2.1);
      this.updateTelltales(jt, jh, d, time);
      // Working sheet from the clew to the fairlead on the sheeted side
      const arr = this.jib.geo.attributes.position.array as Float32Array;
      const ci = COLS * 3;
      const clew = new THREE.Vector3(arr[ci], arr[ci + 1], arr[ci + 2]);
      const lead = new THREE.Vector3(-0.6, sheerZ(tAt(-0.6)) + 0.05, c.jibSide * 0.95);
      this.jibSheets.geometry.setFromPoints([clew, lead, new THREE.Vector3(-1.4, lead.y + 0.1, c.jibSide * 0.78)]);
    } else {
      this.telltales.geometry.setFromPoints([]);
      this.jibSheets.geometry.setFromPoints([]);
    }

    // Mainsheet: boom end to the traveler
    const be = new THREE.Vector3(BOAT.mastX - 0.05 - (BOAT.E - 0.1) * Math.cos(s.boom), BOAT.boomZ - 0.05, (BOAT.E - 0.1) * Math.sin(s.boom));
    const lee = Math.sign(s.boom) || 1;
    const trav = new THREE.Vector3(-2.2, sheerZ(tAt(-2.2)) - 0.05, lee * c.traveler * 0.45);
    this.mainsheetLine.geometry.setFromPoints([be, trav]);
  }

  private updateTelltales(jt: THREE.Vector3, jh: THREE.Vector3, d: Diag, time: number) {
    const jib = d.jib!;
    const pts: THREE.Vector3[] = [];
    const cols: number[] = [];
    const ang = jib.bandAngles;
    const sideOfSail = Math.sign(jib.angle) || 1;
    const windSide = -sideOfSail;
    for (const h of [0.25, 0.5, 0.72]) {
      const base = jt.clone().lerp(jh, h);
      const a = lerpAngle(ang, h);
      const dx = -Math.cos(a);
      const dz = Math.sin(a);
      base.x += dx * 0.35;
      base.z += dz * 0.35;
      for (const which of ['windward', 'leeward'] as const) {
        const state = jib[which];
        const sideZ = which === 'windward' ? windSide : -windSide;
        const p0 = base.clone();
        p0.z += sideZ * 0.04;
        let dir: THREE.Vector3;
        const wob = Math.sin(time * 25 + h * 10 + (which === 'windward' ? 0 : 2));
        if (state === 'stream') dir = new THREE.Vector3(dx, -0.05, dz).multiplyScalar(0.28);
        else if (state === 'lift') dir = new THREE.Vector3(dx * 0.3, 0.22 + 0.05 * wob, sideZ * 0.1 + dz * 0.3);
        else if (state === 'stall') dir = new THREE.Vector3(dx * 0.1 + 0.05 * wob, -0.25, sideZ * 0.05);
        else dir = new THREE.Vector3(dx * 0.15 * wob, 0.1 * wob, sideZ * 0.15 * wob);
        pts.push(p0, p0.clone().add(dir));
        // windward/leeward ribbons: green on starboard, red on port (convention)
        const col = sideZ > 0 ? [0.1, 0.8, 0.2] : [0.9, 0.15, 0.15];
        cols.push(...col, ...col);
      }
    }
    this.telltales.geometry.setFromPoints(pts);
    this.telltales.geometry.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
  }
}
