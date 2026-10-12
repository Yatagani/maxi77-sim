import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { Sky } from 'three/examples/jsm/objects/Sky.js';
import { KN } from '../sim/boat';
import type { Mark } from '../sim/lessons';
import type { Simulation } from '../sim/sim';
import { rng } from '../sim/wind';
import { BoatView } from './boatModel';
import { Sea } from './sea';

export type CameraMode = 'chase' | 'helm' | 'top';

/** Compass/world (east, north) -> three (x, z=-north). */
const toThree = (x: number, y: number) => new THREE.Vector3(x, 0, -y);

function island(seed: number, radius: number, height: number): THREE.Mesh {
  const r = rng(seed);
  const geo = new THREE.IcosahedronGeometry(1, 4);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const cols: number[] = [];
  const rock = new THREE.Color('#7d7a72');
  const rockPink = new THREE.Color('#8f7466'); // Oslofjord granite
  const pine = new THREE.Color('#2c3f26');
  const pine2 = new THREE.Color('#3d5232');
  const ph = [r() * 6, r() * 6, r() * 6];
  for (let i = 0; i < pos.count; i++) {
    const v = new THREE.Vector3().fromBufferAttribute(pos, i);
    const n = 1 + 0.25 * Math.sin(v.x * 3 + ph[0]) * Math.cos(v.z * 2.5 + ph[1]) + 0.12 * Math.sin(v.x * 7 + v.z * 5 + ph[2]);
    let y = v.y * n;
    y = y < 0 ? -0.3 : y; // flat bottom under water
    pos.setXYZ(i, v.x * n * radius, y * height, v.z * n * radius);
    const h = y;
    const c = h < 0.22 ? rock.clone().lerp(rockPink, r() * 0.6) : pine.clone().lerp(pine2, r());
    cols.push(c.r, c.g, c.b);
  }
  geo.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
  geo.computeVertexNormals();
  return new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, flatShading: true }));
}

/** Distant fjord shores: hills all around except an opening to the south (the outer fjord). */
function shoreline(): THREE.Mesh {
  const r = rng(99);
  const N = 256;
  const R0 = 9000;
  const R1 = 12500;
  const pos: number[] = [];
  const idx: number[] = [];
  const cols: number[] = [];
  const green = new THREE.Color('#33452f');
  const blue = new THREE.Color('#6c8296');
  const ph = Array.from({ length: 6 }, () => r() * 6.28);
  for (let i = 0; i <= N; i++) {
    const a = (i / N) * Math.PI * 2; // compass bearing
    const bearing = (a * 180) / Math.PI;
    const gap = THREE.MathUtils.smoothstep(Math.abs(((bearing - 190 + 540) % 360) - 180), 12, 35);
    const h =
      gap *
      (140 + 90 * Math.sin(a * 3 + ph[0]) + 60 * Math.sin(a * 7 + ph[1]) + 35 * Math.sin(a * 17 + ph[2]) + 20 * Math.sin(a * 31 + ph[3]));
    const sx = Math.sin(a);
    const sy = Math.cos(a);
    pos.push(sx * R0, -5, -sy * R0, sx * (R0 + 1500), Math.max(h, 0), -sy * (R0 + 1500), sx * R1, h * 0.7, -sy * R1);
    for (const c of [green, green, blue]) cols.push(c.r, c.g, c.b);
  }
  for (let i = 0; i < N; i++) {
    for (let k = 0; k < 2; k++) {
      const a = i * 3 + k;
      const b = a + 3;
      idx.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return new THREE.Mesh(g, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, side: THREE.DoubleSide, fog: true }));
}

function buoy(): THREE.Group {
  const g = new THREE.Group();
  const orange = new THREE.MeshStandardMaterial({ color: '#ff6a13', roughness: 0.5 });
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.6, 1.6, 16), orange);
  body.position.y = 0.5;
  const top = new THREE.Mesh(new THREE.ConeGeometry(0.55, 0.6, 16), orange);
  top.position.y = 1.6;
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 2.2), new THREE.MeshStandardMaterial({ color: '#222' }));
  pole.position.y = 2.6;
  const flag = new THREE.Mesh(
    new THREE.PlaneGeometry(0.7, 0.45),
    new THREE.MeshStandardMaterial({ color: '#ffdd00', side: THREE.DoubleSide }),
  );
  flag.position.set(0.35, 3.4, 0);
  g.add(body, top, pole, flag);
  return g;
}

class Wake {
  mesh: THREE.Mesh;
  private pts: { p: THREE.Vector3; side: THREE.Vector3; t: number; speed: number }[] = [];
  private geo = new THREE.BufferGeometry();
  private last = -1;
  constructor() {
    this.mesh = new THREE.Mesh(
      this.geo,
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.35, depthWrite: false, vertexColors: true }),
    );
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 1;
  }
  update(time: number, sim: Simulation) {
    const s = sim.state;
    if (time - this.last > 0.25) {
      this.last = time;
      const stern = new THREE.Vector3(s.x - Math.sin(s.heading) * 3.5, 0.06, -(s.y - Math.cos(s.heading) * 3.5));
      const side = new THREE.Vector3(Math.cos(s.heading), 0, Math.sin(s.heading));
      this.pts.push({ p: stern, side, t: time, speed: sim.diag.speed });
      if (this.pts.length > 160) this.pts.shift();
    }
    const pos: number[] = [];
    const col: number[] = [];
    const idx: number[] = [];
    this.pts.forEach((w, i) => {
      const age = time - w.t;
      const width = 0.6 + age * 0.35 * Math.min(1, w.speed / (4 * KN));
      const a = Math.max(0, 1 - age / 40) * Math.min(1, w.speed / (2 * KN));
      pos.push(w.p.x + w.side.x * width, 0.06, w.p.z + w.side.z * width, w.p.x - w.side.x * width, 0.06, w.p.z - w.side.z * width);
      col.push(a, a, a, a, a, a);
      if (i > 0) {
        const k = i * 2;
        idx.push(k - 2, k - 1, k, k, k - 1, k + 1);
      }
    });
    this.geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    this.geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    this.geo.setIndex(idx);
  }
  reset() {
    this.pts = [];
  }
}

export class World {
  renderer: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  boat = new BoatView();
  sea: Sea;
  mode: CameraMode = 'chase';
  private marks = new THREE.Group();
  private wake = new Wake();
  private lastBoat = new THREE.Vector3();
  private sun: THREE.DirectionalLight;
  private gustVecs = Array.from({ length: 24 }, () => new THREE.Vector4());

  constructor(container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
    this.renderer.setSize(container.clientWidth, container.clientHeight);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.55;
    this.renderer.shadowMap.enabled = true;
    container.appendChild(this.renderer.domElement);

    this.camera = new THREE.PerspectiveCamera(55, container.clientWidth / container.clientHeight, 0.1, 30000);
    this.camera.position.set(-14, 6, 10);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.maxPolarAngle = Math.PI * 0.49;
    this.controls.minDistance = 6;
    this.controls.maxDistance = 220;

    // Sky with an afternoon sun from the SW (sea-breeze afternoon in the Oslofjord)
    const sky = new Sky();
    sky.scale.setScalar(20000);
    const su = sky.material.uniforms;
    su.turbidity.value = 3.5;
    su.rayleigh.value = 1.1;
    su.mieCoefficient.value = 0.004;
    su.mieDirectionalG.value = 0.8;
    const sunDir = new THREE.Vector3().setFromSphericalCoords(1, THREE.MathUtils.degToRad(90 - 32), THREE.MathUtils.degToRad(180 - 225)); // theta = 180° - compass bearing (SW sun)
    su.sunPosition.value.copy(sunDir);
    this.scene.add(sky);
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    const envScene = new THREE.Scene();
    envScene.add(sky.clone());
    this.scene.environment = pmrem.fromScene(envScene).texture;

    this.sun = new THREE.DirectionalLight('#fff4e0', 2.2);
    this.sun.position.copy(sunDir).multiplyScalar(60);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const sc = this.sun.shadow.camera;
    sc.left = sc.bottom = -12;
    sc.right = sc.top = 12;
    this.scene.add(this.sun, this.sun.target);
    this.scene.add(new THREE.HemisphereLight('#cfe3ff', '#20384a', 0.6));
    this.scene.fog = new THREE.Fog('#b9cfdf', 3000, 14000);

    this.sea = new Sea(sunDir);
    this.scene.add(this.sea.mesh);
    this.scene.add(this.wake.mesh);
    this.scene.add(this.boat.root);
    this.scene.add(this.marks);

    // Islands: granite skerries and pine-covered holms, kept clear of the practice area
    const r = rng(2024);
    for (let i = 0; i < 18; i++) {
      const bearing = r() * Math.PI * 2;
      const dist = 1700 + r() * 5000;
      const big = r() < 0.3;
      const m = island(100 + i, big ? 220 + r() * 300 : 40 + r() * 120, big ? 35 + r() * 30 : 8 + r() * 14);
      m.position.set(Math.sin(bearing) * dist, 0, -Math.cos(bearing) * dist);
      m.rotation.y = r() * 6;
      this.scene.add(m);
    }
    this.scene.add(shoreline());

    window.addEventListener('resize', () => this.resize(container));
  }

  resize(container: HTMLElement) {
    this.camera.aspect = container.clientWidth / container.clientHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(container.clientWidth, container.clientHeight);
  }

  setMarks(marks: Mark[]) {
    this.marks.clear();
    for (const m of marks) {
      const b = buoy();
      b.position.copy(toThree(m.x, m.y));
      b.userData.mark = m;
      this.marks.add(b);
    }
  }

  reset(sim: Simulation) {
    this.wake.reset();
    const s = sim.state;
    const p = toThree(s.x, s.y);
    this.lastBoat.copy(p);
    // place chase camera behind and to windward
    const back = new THREE.Vector3(-Math.sin(s.heading), 0, Math.cos(s.heading));
    this.camera.position.copy(p).addScaledVector(back, 16).add(new THREE.Vector3(0, 6, 0));
    this.controls.target.copy(p).add(new THREE.Vector3(0, 3, 0));
    this.controls.update();
  }

  cycleCamera(): CameraMode {
    this.mode = this.mode === 'chase' ? 'helm' : this.mode === 'helm' ? 'top' : 'chase';
    this.controls.enabled = this.mode === 'chase';
    if (this.mode === 'chase') this.camera.up.set(0, 1, 0);
    return this.mode;
  }

  render(sim: Simulation, time: number, headsailVisible: boolean) {
    const s = sim.state;
    const d = sim.diag;
    // gust cells -> shader (three coords)
    const cells = sim.wind.cells;
    const amp = Math.max(0.3, Math.min(1.5, sim.wind.base.gustAmp / 5));
    const n = Math.min(cells.length, this.gustVecs.length);
    for (let i = 0; i < n; i++) {
      const c = cells[i];
      const env = Math.min(1, c.age / 20, (c.life - c.age) / 20);
      this.gustVecs[i].set(c.x, -c.y, c.radius, c.strength * env * amp);
    }
    const p = toThree(s.x, s.y);
    this.sea.update(time, d.tws / KN, sim.wind.baseDir() * (Math.PI / 180), p.x, p.z, this.gustVecs.slice(0, n));
    const waveY = this.sea.heightAt(p.x, p.z) * 0.6;
    this.boat.update(s, sim.effectiveControls(), d, time, waveY, headsailVisible);
    this.wake.update(time, sim);
    for (const m of this.marks.children) m.position.y = this.sea.heightAt(m.position.x, m.position.z) * 0.8 - 0.2;

    this.sun.position.copy(p).add((this.sea.uniforms.uSunDir.value as THREE.Vector3).clone().multiplyScalar(60));
    this.sun.target.position.copy(p);

    // Cameras
    if (this.mode === 'chase') {
      const delta = p.clone().sub(this.lastBoat);
      this.camera.position.add(delta);
      this.controls.target.add(delta);
      this.controls.update();
    } else if (this.mode === 'helm') {
      const windSide = d.twa > 0 ? 1 : -1; // helmsman sits to windward
      // on the windward cockpit coaming, looking past the mast at the jib luff and its telltales
      const eye = this.boat.root.localToWorld(new THREE.Vector3(-2.6, 1.85, windSide * 1.05));
      const look = this.boat.root.localToWorld(new THREE.Vector3(2.4, 2.6, -windSide * 0.15));
      this.camera.position.copy(eye);
      this.camera.up.set(0, 1, 0).applyQuaternion(this.boat.root.quaternion);
      this.camera.lookAt(look);
    } else {
      this.camera.position.set(p.x, 75, p.z + 0.01);
      this.camera.up.set(0, 0, -1); // north up
      this.camera.lookAt(p);
    }
    this.lastBoat.copy(p);
    this.renderer.render(this.scene, this.camera);
  }
}
