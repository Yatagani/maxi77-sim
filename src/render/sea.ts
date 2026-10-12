import * as THREE from 'three';

export const MAX_GUSTS = 24;
const SIZE = 2400;


const vert = /* glsl */ `
uniform float uTime;
uniform float uAmp;
uniform vec2 uDir; // direction waves travel (unit, xz)
varying vec3 vWorld;
varying vec3 vNormal2;
varying float vCrest;

vec3 gerstner(vec2 p, vec2 d, float wl, float amp, float steep, inout vec3 T, inout vec3 B) {
  float k = 6.2831853 / wl;
  float c = sqrt(9.81 / k);
  float f = k * (dot(d, p) - c * uTime);
  float q = steep / (k * max(amp, 1e-4) * 4.0);
  float a = amp;
  T += vec3(-d.x * d.x * q * a * k * sin(f), d.x * a * k * cos(f), -d.x * d.y * q * a * k * sin(f));
  B += vec3(-d.x * d.y * q * a * k * sin(f), d.y * a * k * cos(f), -d.y * d.y * q * a * k * sin(f));
  return vec3(d.x * q * a * cos(f), a * sin(f), d.y * q * a * cos(f));
}

vec2 rot(vec2 v, float a) { float c = cos(a), s = sin(a); return vec2(c * v.x - s * v.y, s * v.x + c * v.y); }

void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vec2 p = wp.xz;
  vec3 T = vec3(1.0, 0.0, 0.0);
  vec3 B = vec3(0.0, 0.0, 1.0);
  vec3 off = vec3(0.0);
  off += gerstner(p, uDir, 19.0, uAmp * 0.45, 0.55, T, B);
  off += gerstner(p, rot(uDir, 0.45), 11.0, uAmp * 0.28, 0.6, T, B);
  off += gerstner(p, rot(uDir, -0.35), 7.0, uAmp * 0.18, 0.6, T, B);
  off += gerstner(p, rot(uDir, 0.9), 4.2, uAmp * 0.09, 0.5, T, B);
  // fade waves out with distance to avoid aliasing on the horizon
  float dist = length(p - cameraPosition.xz);
  float fade = 1.0 - smoothstep(400.0, 1100.0, dist);
  wp.xyz += off * fade;
  vCrest = off.y / max(uAmp, 0.01);
  vNormal2 = normalize(cross(B, T));
  vWorld = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const frag = /* glsl */ `
uniform float uTime;
uniform vec3 uSunDir;
uniform vec3 uDeep;
uniform vec3 uShallowTint;
uniform vec3 uHorizon;
uniform vec3 uZenith;
uniform float uFoam;
uniform float uRipple;
uniform vec4 uGusts[${MAX_GUSTS}];
uniform int uGustCount;
varying vec3 vWorld;
varying vec3 vNormal2;
varying float vCrest;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
}

void main() {
  float g = 0.0;
  for (int i = 0; i < ${MAX_GUSTS}; i++) {
    if (i >= uGustCount) break;
    vec4 c = uGusts[i];
    vec2 d = vWorld.xz - c.xy;
    g += c.w * exp(-dot(d, d) / (c.z * c.z));
  }
  float gp = clamp(g, 0.0, 1.5);
  float gn = clamp(-g, 0.0, 1.0);
  // Small ripples (cat's paws) — stronger in gusts, glassy in lulls
  float rip = uRipple * (1.0 + 1.6 * gp - 0.7 * gn);
  vec2 q = vWorld.xz * 1.7 + vec2(uTime * 0.9, uTime * 0.6);
  vec2 q2 = vWorld.xz * 3.1 - vec2(uTime * 1.3, -uTime * 0.4);
  vec3 n2 = vec3(noise(q) - 0.5 + noise(q2) - 0.5, 0.0, noise(q + 17.0) - 0.5 + noise(q2 + 9.0) - 0.5);
  vec3 N = normalize(vNormal2 + n2 * rip);
  vec3 V = normalize(cameraPosition - vWorld);
  float fres = 0.02 + 0.98 * pow(1.0 - max(dot(N, V), 0.0), 5.0);
  vec3 R = reflect(-V, N);
  vec3 sky = mix(uHorizon, uZenith, clamp(R.y * 1.6, 0.0, 1.0));
  vec3 water = uDeep * (1.0 - 0.32 * gp + 0.12 * gn);
  water += uShallowTint * max(vCrest, 0.0) * 0.15;
  vec3 col = mix(water, sky, fres);
  float spec = pow(max(dot(R, uSunDir), 0.0), 180.0);
  col += vec3(1.0, 0.95, 0.85) * spec * 1.2;
  // whitecaps on crests in a breeze
  float foamN = noise(vWorld.xz * 0.8 + uTime * 0.3);
  float foam = uFoam * smoothstep(0.55, 0.95, vCrest + foamN * 0.6 + gp * 0.25);
  col = mix(col, vec3(0.93, 0.96, 0.98), clamp(foam, 0.0, 0.85));
  // aerial perspective toward the horizon
  float dist = length(vWorld - cameraPosition);
  col = mix(col, uHorizon, smoothstep(300.0, 2200.0, dist) * 0.85);
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

export class Sea {
  mesh: THREE.Mesh;
  uniforms: Record<string, THREE.IUniform>;

  private seg: number;

  constructor(sunDir: THREE.Vector3, seg = 320) {
    this.seg = seg;
    const geo = new THREE.PlaneGeometry(SIZE, SIZE, seg, seg);
    geo.rotateX(-Math.PI / 2);
    this.uniforms = {
      uTime: { value: 0 },
      uAmp: { value: 0.2 },
      uDir: { value: new THREE.Vector2(0, 1) },
      uSunDir: { value: sunDir.clone().normalize() },
      uDeep: { value: new THREE.Color('#0d3147') },
      uShallowTint: { value: new THREE.Color('#2f7f86') },
      uHorizon: { value: new THREE.Color('#b9cfdf') },
      uZenith: { value: new THREE.Color('#5d8fc4') },
      uFoam: { value: 0 },
      uRipple: { value: 0.4 },
      uGusts: { value: Array.from({ length: MAX_GUSTS }, () => new THREE.Vector4()) },
      uGustCount: { value: 0 },
    };
    const mat = new THREE.ShaderMaterial({ vertexShader: vert, fragmentShader: frag, uniforms: this.uniforms });
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.frustumCulled = false;
    this.mesh.receiveShadow = false;
  }

  /** Approximate surface height at a world point (same wave set, CPU side, ignoring horizontal shift). */
  heightAt(x: number, z: number): number {
    const t = this.uniforms.uTime.value as number;
    const d = this.uniforms.uDir.value as THREE.Vector2;
    const A = this.uniforms.uAmp.value as number;
    const w = (dx: number, dz: number, wl: number, amp: number) => {
      const k = (2 * Math.PI) / wl;
      const c = Math.sqrt(9.81 / k);
      return amp * Math.sin(k * (dx * x + dz * z - c * t));
    };
    const rot = (a: number): [number, number] => [Math.cos(a) * d.x - Math.sin(a) * d.y, Math.sin(a) * d.x + Math.cos(a) * d.y];
    return (
      w(d.x, d.y, 19, A * 0.45) + w(...rot(0.45), 11, A * 0.28) + w(...rot(-0.35), 7, A * 0.18) + w(...rot(0.9), 4.2, A * 0.09)
    );
  }

  update(time: number, twsKn: number, twdRad: number, cx: number, cz: number, gusts: THREE.Vector4[]) {
    const u = this.uniforms;
    u.uTime.value = time;
    // Fetch-limited fjord sea: ~0.25 m at 10 kn, ~0.75 m at 20 kn (significant height)
    const hs = 0.05 + 0.0018 * twsKn * twsKn;
    u.uAmp.value = THREE.MathUtils.lerp(u.uAmp.value as number, hs * 0.5, 0.01);
    // waves travel toward where the wind blows: compass dir+180 => world xz (east, south)
    const tx = -Math.sin(twdRad);
    const tz = Math.cos(twdRad);
    (u.uDir.value as THREE.Vector2).set(tx, tz);
    u.uFoam.value = THREE.MathUtils.smoothstep(twsKn, 12, 22) * 0.9;
    u.uRipple.value = 0.06 + Math.min(0.4, twsKn / 55);
    const arr = u.uGusts.value as THREE.Vector4[];
    const n = Math.min(MAX_GUSTS, gusts.length);
    for (let i = 0; i < n; i++) arr[i].copy(gusts[i]);
    u.uGustCount.value = n;
    // follow the boat on a grid so the mesh doesn't swim
    const cell = SIZE / this.seg;
    this.mesh.position.set(Math.round(cx / cell) * cell, 0, Math.round(cz / cell) * cell);
  }
}
