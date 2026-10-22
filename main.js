import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { Sky } from 'three/addons/objects/Sky.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';

const FOX_URL = 'https://cdn.jsdelivr.net/gh/KhronosGroup/glTF-Sample-Assets@main/Models/Fox/glTF-Binary/Fox.glb';

// ---------- noise ----------
const perm = new Uint8Array(512);
{
  const p = [...Array(256).keys()];
  let s = 1337;
  const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
  for (let i = 255; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [p[i], p[j]] = [p[j], p[i]]; }
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255];
}
const G2D = [[1, 1], [-1, 1], [1, -1], [-1, -1], [1, 0], [-1, 0], [0, 1], [0, -1]];
function snoise(x, y) {
  const F2 = 0.3660254, G2 = 0.2113249;
  const s = (x + y) * F2, i = Math.floor(x + s), j = Math.floor(y + s);
  const t = (i + j) * G2, x0 = x - (i - t), y0 = y - (j - t);
  const i1 = x0 > y0 ? 1 : 0, j1 = 1 - i1;
  const x1 = x0 - i1 + G2, y1 = y0 - j1 + G2, x2 = x0 - 1 + 2 * G2, y2 = y0 - 1 + 2 * G2;
  const ii = i & 255, jj = j & 255;
  let n = 0, tt;
  tt = 0.5 - x0 * x0 - y0 * y0; if (tt > 0) { const g = G2D[perm[ii + perm[jj]] & 7]; tt *= tt; n += tt * tt * (g[0] * x0 + g[1] * y0); }
  tt = 0.5 - x1 * x1 - y1 * y1; if (tt > 0) { const g = G2D[perm[ii + i1 + perm[jj + j1]] & 7]; tt *= tt; n += tt * tt * (g[0] * x1 + g[1] * y1); }
  tt = 0.5 - x2 * x2 - y2 * y2; if (tt > 0) { const g = G2D[perm[ii + 1 + perm[jj + 1]] & 7]; tt *= tt; n += tt * tt * (g[0] * x2 + g[1] * y2); }
  return 70 * n;
}
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const lerp = (a, b, t) => a + (b - a) * t;

function duneHeight(x, z) {
  const u = x * 0.8 + z * 0.6, v = -x * 0.6 + z * 0.8;
  const warp = snoise(u * 0.003, v * 0.003) * 1.5;
  const s = snoise(u * 0.0045 + warp, v * 0.011);
  const ridge = 1 - Math.sqrt(s * s + 0.012); // rounded crests: no sawtooth along the ridge lines
  let h = Math.pow(Math.max(ridge, 0), 2.4) * 34;
  h += snoise(u * 0.018 + warp, v * 0.03) * 2.0 * (0.5 + 0.5 * ridge);
  h += snoise(x * 0.0012, z * 0.0012) * 22;
  const d = Math.hypot(x, z);
  return h * (0.16 + 0.84 * smooth(30, 260, d));
}

// ---------- renderer / scene ----------
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance', preserveDrawingBuffer: new URLSearchParams(location.search).has('director') });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.55;
document.getElementById('app').appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(48, innerWidth / innerHeight, 0.1, 8000);

const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.3, 0.6, 0.85);
composer.addPass(bloom);
composer.addPass(new OutputPass());
const QS0 = new URLSearchParams(location.search);
const gradePass = new ShaderPass({
  uniforms: { tDiffuse: { value: null }, uTime: { value: 0 }, uVig: { value: QS0.has('cover') ? 0.42 : 0.2 }, uGrain: { value: QS0.has('cover') ? 0.045 : 0.018 } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: `uniform sampler2D tDiffuse; uniform float uTime, uVig, uGrain; varying vec2 vUv;
    float h(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
    void main(){
      vec3 c = texture2D(tDiffuse, vUv).rgb;
      float l = dot(c, vec3(0.299, 0.587, 0.114));
      c = mix(c * vec3(0.96, 0.99, 1.04), c * vec3(1.03, 1.0, 0.95), smoothstep(0.15, 0.75, l)); // cool shade, warm light
      vec2 q = vUv - 0.5; c *= 1.0 - uVig * smoothstep(0.25, 0.85, dot(q, q) * 2.2);
      c += (h(vUv * 1000.0 + fract(uTime) * 61.0) - 0.5) * uGrain;
      gl_FragColor = vec4(c, 1.0);
    }`,
});
composer.addPass(gradePass);

// ---------- sky & light ----------
const sky = new Sky();
sky.scale.setScalar(6000);
scene.add(sky);
const skyU = sky.material.uniforms;
skyU.turbidity.value = 2.6;
skyU.rayleigh.value = 2.4;
skyU.mieCoefficient.value = 0.0045;
skyU.mieDirectionalG.value = 0.86;

const SUN_AZ = THREE.MathUtils.degToRad(+(new URLSearchParams(location.search).get('sunaz') ?? 205));
const sunDir = new THREE.Vector3();
const sun = new THREE.DirectionalLight(0xffb978, 4.2);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
const sc = sun.shadow.camera; sc.left = -22; sc.right = 22; sc.top = 22; sc.bottom = -22; sc.near = 1; sc.far = 400;
sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.03;
scene.add(sun, sun.target);
const moon = new THREE.DirectionalLight(0x8fa8e8, 0.0);
scene.add(moon, moon.target);
const hemi = new THREE.HemisphereLight(0x9fb2d0, 0x9a6a44, 0.9);
scene.add(hemi);

const fogDay = new THREE.Color(0.92, 0.60, 0.38), fogNight = new THREE.Color(0.03, 0.05, 0.1);
scene.fog = new THREE.FogExp2(fogDay.clone(), 0.0031);

// stars
{
  const n = 4000, pos = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const v = new THREE.Vector3().randomDirection(); v.y = Math.abs(v.y) * 0.95 + 0.05; v.normalize().multiplyScalar(4000);
    pos.set([v.x, v.y, v.z], i * 3);
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  var starMat = new THREE.PointsMaterial({ color: 0xdfe8ff, size: 1.6, sizeAttenuation: false, transparent: true, opacity: 0, fog: false, depthWrite: false });
  scene.add(new THREE.Points(g, starMat));
}

// ---------- wet / bloom map ----------
const WET_RES = 512, WET_SIZE = 512, WET_MIN = -WET_SIZE / 2;
const wetData = new Uint8Array(WET_RES * WET_RES * 4);
const cellCount = new Uint16Array(WET_RES * WET_RES);
const wetTex = new THREE.DataTexture(wetData, WET_RES, WET_RES, THREE.RGBAFormat);
wetTex.magFilter = THREE.LinearFilter; wetTex.minFilter = THREE.LinearFilter; wetTex.needsUpdate = true;
let greenCells = 0, wetDirty = false;
function paintWet(x, z, amt) {
  const fx = (x - WET_MIN) / WET_SIZE * WET_RES, fz = (z - WET_MIN) / WET_SIZE * WET_RES;
  const cx = Math.floor(fx), cz = Math.floor(fz);
  for (let dz = -3; dz <= 3; dz++) for (let dx = -3; dx <= 3; dx++) {
    const ix = cx + dx, iz = cz + dz;
    if (ix < 0 || iz < 0 || ix >= WET_RES || iz >= WET_RES) continue;
    const d2 = (ix + 0.5 - fx) ** 2 + (iz + 0.5 - fz) ** 2;
    const w = Math.max(0, 1 - d2 / 10.5) ** 2;
    if (w <= 0) continue;
    const k = (iz * WET_RES + ix) * 4;
    wetData[k] = Math.min(255, wetData[k] + amt * w * 22);
    const g0 = wetData[k + 1];
    const g1 = Math.min(255, g0 + amt * Math.max(0, 1 - d2 / 3.2) * 9);
    if (g0 < 60 && g1 >= 60) greenCells++;
    wetData[k + 1] = g1;
  }
  wetDirty = true;
}
function cellIndex(x, z) {
  const ix = Math.floor((x - WET_MIN) / WET_SIZE * WET_RES), iz = Math.floor((z - WET_MIN) / WET_SIZE * WET_RES);
  if (ix < 0 || iz < 0 || ix >= WET_RES || iz >= WET_RES) return -1;
  return iz * WET_RES + ix;
}

// ---------- terrain ----------
const T_SIZE = 2400, T_SEG = 900;
const tg = new THREE.PlaneGeometry(T_SIZE, T_SIZE, T_SEG, T_SEG);
tg.rotateX(-Math.PI / 2);
const hgrid = new Float32Array((T_SEG + 1) ** 2);
{
  const p = tg.attributes.position;
  for (let i = 0; i < p.count; i++) { const h = duneHeight(p.getX(i), p.getZ(i)); p.setY(i, h); hgrid[i] = h; }
  tg.computeVertexNormals();
}
function groundH(x, z) {
  const step = T_SIZE / T_SEG, fx = (x + T_SIZE / 2) / step, fz = (z + T_SIZE / 2) / step;
  const ix = Math.floor(fx), iz = Math.floor(fz);
  if (ix < 0 || iz < 0 || ix >= T_SEG || iz >= T_SEG) return duneHeight(x, z);
  const tx = fx - ix, tz = fz - iz, r = T_SEG + 1;
  const A = hgrid[iz * r + ix], B = hgrid[iz * r + ix + 1], C = hgrid[(iz + 1) * r + ix], D = hgrid[(iz + 1) * r + ix + 1];
  return tx + tz <= 1 ? A + (B - A) * tx + (C - A) * tz : D + (C - D) * (1 - tx) + (B - D) * (1 - tz);
}

const U = {
  uTime: { value: 0 }, uNight: { value: 0 }, uWind: { value: 0 },
  uWindDir: { value: new THREE.Vector2(0.8, 0.6).normalize() },
  uSunDir: { value: new THREE.Vector3() }, uSunCol: { value: new THREE.Color() }, uAmb: { value: new THREE.Color() },
  uFogCol: { value: scene.fog.color }, uFogDen: { value: scene.fog.density },
  uWet: { value: wetTex }, uWetRect: { value: new THREE.Vector3(WET_MIN, WET_MIN, WET_SIZE) },
};
const GLSL_NOISE = /* glsl */`
float hash12(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float vnoise(vec2 p){ vec2 i = floor(p), f = fract(p); vec2 u = f*f*(3.0-2.0*f);
  return mix(mix(hash12(i), hash12(i+vec2(1,0)), u.x), mix(hash12(i+vec2(0,1)), hash12(i+vec2(1,1)), u.x), u.y); }
`;
const sandMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.93, metalness: 0 });
sandMat.onBeforeCompile = (sh) => {
  Object.assign(sh.uniforms, { uWet: U.uWet, uWetRect: U.uWetRect, uTime: U.uTime, uNight: U.uNight });
  sh.vertexShader = sh.vertexShader
    .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;')
    .replace('#include <project_vertex>', '#include <project_vertex>\nvWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
  sh.fragmentShader = sh.fragmentShader
    .replace('#include <common>', `#include <common>
varying vec3 vWPos; uniform sampler2D uWet; uniform vec3 uWetRect; uniform float uTime; uniform float uNight;
${GLSL_NOISE}
vec3 perturbRipple(vec3 sp, vec3 sn, vec2 dH){ vec3 sx = dFdx(sp), sy = dFdy(sp); vec3 r1 = cross(sy, sn), r2 = cross(sn, sx);
  float det = dot(sx, r1); vec3 g = sign(det) * (dH.x * r1 + dH.y * r2); return normalize(abs(det) * sn - g); }`)
    .replace('#include <color_fragment>', `#include <color_fragment>
vec2 wuv = (vWPos.xz - uWetRect.xy) / uWetRect.z;
vec4 wm = (wuv.x > 0.0 && wuv.y > 0.0 && wuv.x < 1.0 && wuv.y < 1.0) ? texture2D(uWet, wuv) : vec4(0.0);
float n1 = vnoise(vWPos.xz * 0.05) * 0.6 + vnoise(vWPos.xz * 0.4) * 0.4;
vec3 sand = mix(vec3(0.62, 0.37, 0.17), vec3(0.88, 0.58, 0.31), n1);
float wetK = smoothstep(0.02, 0.5, wm.r);
float grnK = smoothstep(0.05, 0.8, wm.g);
sand *= mix(1.0, 0.62, wetK);
sand = mix(sand, vec3(0.20, 0.31, 0.07), grnK * 0.85);
diffuseColor.rgb = sand;`)
    .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
roughnessFactor = mix(roughnessFactor, 0.38, wetK * (1.0 - grnK * 0.6));`)
    .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
{
  float rd = length(vWPos - cameraPosition);
  float rf = 1.0 - smoothstep(4.0, 16.0, rd);
  if (rf > 0.001) {
    vec2 p = vWPos.xz;
    float warp = vnoise(p * 0.22) * 7.0 + vnoise(p * 1.3) * 0.8;
    float rh = sin(dot(p, vec2(0.6, 0.8)) * 16.0 + warp) * 0.5 + 0.5;
    rh = rh * rh * (1.0 - wetK * 0.85) * (0.35 + 0.65 * vnoise(p * 0.45));
    vec2 dH = vec2(dFdx(rh), dFdy(rh)) * 0.018 * rf;
    normal = perturbRipple(-vViewPosition, normal, dH);
  }
}`);
};
const terrain = new THREE.Mesh(tg, sandMat);
terrain.receiveShadow = true;
scene.add(terrain);

// ---------- grass (instanced, grows where rain falls) ----------
const MAX_GRASS = 180000, MAX_FLOWER = 14000;
function makeBladeGeo() {
  const segs = 4, pos = [], idx = [];
  for (let i = 0; i < segs; i++) { const y = i / segs; pos.push(-1, y, 0, 1, y, 0); }
  pos.push(0, 1, 0);
  for (let i = 0; i < segs - 1; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  const a = (segs - 1) * 2; idx.push(a, a + 1, segs * 2);
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  return g;
}
function makeInstanced(geo, max) {
  const aPos = new THREE.InstancedBufferAttribute(new Float32Array(max * 4), 4).setUsage(THREE.DynamicDrawUsage);
  const aPar = new THREE.InstancedBufferAttribute(new Float32Array(max * 4), 4).setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute('aPos', aPos); geo.setAttribute('aPar', aPar);
  geo.instanceCount = 0;
  return { geo, aPos, aPar, max, head: 0, total: 0, lo: Infinity, hi: -1 };
}
function pushInstance(pool, x, y, z, t, a, b, c, d) {
  const i = pool.head; pool.head = (pool.head + 1) % pool.max; pool.total++;
  pool.aPos.array.set([x, y, z, t], i * 4); pool.aPar.array.set([a, b, c, d], i * 4);
  pool.lo = Math.min(pool.lo, i); pool.hi = Math.max(pool.hi, i);
}
function flushPool(pool) {
  if (pool.hi < 0) return;
  for (const attr of [pool.aPos, pool.aPar]) {
    attr.addUpdateRange(pool.lo * 4, (pool.hi - pool.lo + 1) * 4); attr.needsUpdate = true; // ranges accumulate until the renderer uploads them
  }
  pool.geo.instanceCount = Math.min(pool.total, pool.max);
  pool.lo = Infinity; pool.hi = -1;
}
const COMMON_VS = /* glsl */`
uniform float uTime; uniform float uWind; uniform vec2 uWindDir; uniform float uFogDen;
attribute vec4 aPos; attribute vec4 aPar;
varying float vFog; varying vec3 vW;
float growK(float birth, float dur){ float g = clamp((uTime - birth) / dur, 0.0, 1.0); float e = 1.0 - pow(1.0 - g, 3.0); return e + 0.18 * sin(g * 3.14159) * (1.0 - g); }
vec2 swayAt(vec3 wp, float seed){ float ph = dot(wp.xz, uWindDir) * 0.32 - uTime * 2.1;
  float s = (0.10 + uWind * 0.55) * (0.65 + 0.35 * sin(ph)) + 0.04 * sin(uTime * 3.1 + seed * 17.0);
  return uWindDir * s; }
`;
const grassMat = new THREE.ShaderMaterial({
  uniforms: U, side: THREE.DoubleSide,
  vertexShader: COMMON_VS + /* glsl */`
varying float vY; varying float vCV;
void main(){
  float grow = growK(aPos.w, 1.4);
  float h = aPar.y * grow;
  float y = position.y;
  float w = position.x * 0.038 * (1.0 - y * 0.8) * (0.5 + 0.5 * grow);
  float c = cos(aPar.x), s = sin(aPar.x);
  vec3 p = vec3(c * w, y * h, -s * w);
  vec2 bend = swayAt(aPos.xyz, aPar.x) + vec2(cos(aPar.x * 3.0), sin(aPar.x * 3.0)) * aPar.z;
  p.xz += bend * y * y * h;
  p.y -= length(bend) * y * y * h * 0.35;
  vec4 wp = vec4(aPos.xyz + p, 1.0);
  vW = wp.xyz;
  vec4 mv = viewMatrix * wp;
  gl_Position = projectionMatrix * mv;
  vY = y; vCV = aPar.w;
  float d = length(mv.xyz); vFog = 1.0 - exp(-uFogDen * uFogDen * d * d);
}`,
  fragmentShader: /* glsl */`
uniform vec3 uSunDir; uniform vec3 uSunCol; uniform vec3 uAmb; uniform vec3 uFogCol; uniform float uNight;
varying float vFog; varying vec3 vW; varying float vY; varying float vCV;
void main(){
  vec3 base = mix(vec3(0.03, 0.07, 0.014), vec3(0.08, 0.15, 0.03), vCV);
  vec3 tip = mix(vec3(0.30, 0.48, 0.07), vec3(0.55, 0.60, 0.13), vCV);
  vec3 col = mix(base, tip, vY);
  float sunUp = clamp(uSunDir.y * 4.0, 0.0, 1.0);
  vec3 V = normalize(vW - cameraPosition);
  float back = pow(max(dot(V, uSunDir), 0.0), 5.0);
  vec3 lit = col * (uAmb + uSunCol * (0.35 + 0.5 * vY) * sunUp);
  lit += uSunCol * vec3(0.55, 0.62, 0.18) * back * vY * vY * 1.4 * sunUp;
  gl_FragColor = vec4(mix(lit, uFogCol, vFog), 1.0);
}`,
});
const grass = makeInstanced(makeBladeGeo(), MAX_GRASS);
const grassMesh = new THREE.Mesh(grass.geo, grassMat);
grassMesh.frustumCulled = false;
scene.add(grassMesh);

const flowerGeo = new THREE.InstancedBufferGeometry();
flowerGeo.setAttribute('position', new THREE.Float32BufferAttribute([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0], 3));
flowerGeo.setIndex([0, 1, 2, 0, 2, 3]);
const flowerMat = new THREE.ShaderMaterial({
  uniforms: U, side: THREE.DoubleSide, transparent: false,
  vertexShader: COMMON_VS + /* glsl */`
varying vec2 vUv; varying float vKind;
void main(){
  float grow = growK(aPos.w + 0.6, 1.8);
  vec3 base = aPos.xyz;
  vec2 sw = swayAt(base, aPar.x) * 0.6;
  vec3 head = base + vec3(sw.x * aPar.y, aPar.y * grow, sw.y * aPar.y);
  vec3 toCam = normalize(cameraPosition - head);
  vec3 n = normalize(mix(vec3(0.0, 1.0, 0.0), toCam, 0.55));
  vec3 t = normalize(cross(n, vec3(0.0, 0.0, 1.0)));
  vec3 b = cross(n, t);
  float r = aPar.z * grow;
  vec4 wp = vec4(head + (t * position.x + b * position.y) * r, 1.0);
  vW = wp.xyz;
  vec4 mv = viewMatrix * wp;
  gl_Position = projectionMatrix * mv;
  vUv = position.xy; vKind = aPar.w;
  float d = length(mv.xyz); vFog = 1.0 - exp(-uFogDen * uFogDen * d * d);
}`,
  fragmentShader: /* glsl */`
uniform vec3 uSunDir; uniform vec3 uSunCol; uniform vec3 uAmb; uniform vec3 uFogCol; uniform float uNight;
varying float vFog; varying vec3 vW; varying vec2 vUv; varying float vKind;
void main(){
  float r = length(vUv) * 2.0;
  float a = atan(vUv.y, vUv.x);
  float petal = 0.5 + 0.5 * cos(a * 5.0 + vKind * 6.0);
  float edge = 0.55 + 0.45 * pow(petal, 0.6);
  if (r > edge) discard;
  vec3 pc = vKind < 0.45 ? vec3(0.95, 0.93, 0.86) : (vKind < 0.8 ? vec3(0.98, 0.78, 0.30) : vec3(0.95, 0.62, 0.66));
  vec3 col = mix(vec3(0.95, 0.62, 0.12), pc, smoothstep(0.16, 0.24, r));
  col *= 0.75 + 0.25 * smoothstep(edge, 0.2, r);
  float sunUp = clamp(uSunDir.y * 4.0, 0.0, 1.0);
  vec3 lit = col * (uAmb * 1.2 + uSunCol * 0.85 * sunUp);
  lit += pc * uNight * 0.55;
  gl_FragColor = vec4(mix(lit, uFogCol, vFog * (1.0 - uNight * 0.5)), 1.0);
}`,
});
const flowers = makeInstanced(flowerGeo, MAX_FLOWER);
const flowerMesh = new THREE.Mesh(flowers.geo, flowerMat);
flowerMesh.frustumCulled = false;
scene.add(flowerMesh);

function spawnGrass(x, z, t) {
  const ci = cellIndex(x, z);
  if (ci < 0 || cellCount[ci] > 110) return;
  cellCount[ci] += 4;
  for (let k = 0; k < 4; k++) {
    const gx = x + (Math.random() - 0.5) * 0.5, gz = z + (Math.random() - 0.5) * 0.5;
    pushInstance(grass, gx, groundH(gx, gz) - 0.02, gz, t + Math.random() * 0.4,
      Math.random() * Math.PI * 2, 0.1 + Math.random() ** 2.2 * 0.42, Math.random() * 0.25, Math.random());
  }
}
function spawnFlower(x, z, t) {
  chime();
  const gx = x + (Math.random() - 0.5) * 0.6, gz = z + (Math.random() - 0.5) * 0.6;
  pushInstance(flowers, gx, groundH(gx, gz), gz, t, Math.random() * 6.28, 0.1 + Math.random() * 0.2, 0.07 + Math.random() * 0.06, Math.random());
}

// ---------- the little cloud ----------
function makePuffTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 256;
  const g = c.getContext('2d');
  // a lumpy cumulus puff: several firm-edged blobs, brighter toward the top
  for (let i = 0; i < 14; i++) {
    const a = Math.random() * 6.28, d = Math.random() * 52;
    const x = 128 + Math.cos(a) * d, y = 136 + Math.sin(a) * d * 0.7, r = 38 + Math.random() * 34;
    const gr = g.createRadialGradient(x, y - r * 0.25, r * 0.1, x, y, r);
    gr.addColorStop(0, 'rgba(255,255,255,0.95)');
    gr.addColorStop(0.62, 'rgba(250,250,252,0.9)');
    gr.addColorStop(1, 'rgba(250,250,252,0)');
    g.fillStyle = gr; g.beginPath(); g.arc(x, y, r, 0, 7); g.fill();
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
const puffTex = makePuffTexture();
const cloud = new THREE.Group();
const puffs = [];
for (let i = 0; i < 64; i++) {
  const v = new THREE.Vector3().randomDirection().multiply(new THREE.Vector3(1.3, 0.6, 1.0)).multiplyScalar(0.3 + Math.random() * 0.7);
  if (v.y < -0.1) v.y *= 0.25; // flat belly, billowing top
  const m = new THREE.SpriteMaterial({ map: puffTex, transparent: true, depthWrite: false, fog: true, rotation: Math.random() * 6.28 });
  const s = new THREE.Sprite(m);
  s.position.copy(v);
  const size = 0.8 + Math.random() * 0.9;
  s.scale.setScalar(size);
  s.userData = { base: v.clone(), size, ph: Math.random() * 6.28 };
  cloud.add(s); puffs.push(s);
}
scene.add(cloud);
const cloudState = { pos: new THREE.Vector3(0, 6, 0), vel: new THREE.Vector3(), rain: 1, gustT: 0, callT: 0, stiff: 6 };

// rain lines + night fireflies share drop state
const N_DROPS = 700;
const drops = [];
const rainPos = new Float32Array(N_DROPS * 6), flyPos = new Float32Array(N_DROPS * 3);
const rainGeo = new THREE.BufferGeometry(); rainGeo.setAttribute('position', new THREE.BufferAttribute(rainPos, 3).setUsage(THREE.DynamicDrawUsage));
const rainMat = new THREE.LineBasicMaterial({ color: 0xdfe6ee, transparent: true, opacity: 0.42, depthWrite: false });
const rainLines = new THREE.LineSegments(rainGeo, rainMat); rainLines.frustumCulled = false; scene.add(rainLines);
const flyGeo = new THREE.BufferGeometry(); flyGeo.setAttribute('position', new THREE.BufferAttribute(flyPos, 3).setUsage(THREE.DynamicDrawUsage));
const FLY_VS = /* glsl */`
uniform float uTime; uniform float uPx; attribute float aPh; varying float vA;
void main(){
  vec3 p = position;
  p.x += sin(uTime * 0.7 + aPh * 9.0) * 0.18; p.y += sin(uTime * 0.9 + aPh * 5.0) * 0.12; p.z += cos(uTime * 0.6 + aPh * 7.0) * 0.18;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  float blink = smoothstep(0.35, 1.0, sin(uTime * (1.3 + fract(aPh * 13.0)) + aPh * 40.0) * 0.5 + 0.5);
  vA = 0.25 + 0.75 * blink;
  gl_PointSize = max(3.0, uPx * (0.6 + 0.4 * blink) / max(-mv.z, 0.5));
}`;
const FLY_FS = /* glsl */`
uniform float uOpacity; varying float vA;
void main(){ float d = length(gl_PointCoord - 0.5); float a = smoothstep(0.5, 0.0, d); a = a * a;
  gl_FragColor = vec4(vec3(0.85, 1.0, 0.45) * (1.0 + a), a * vA * uOpacity); }`;
const makeFlyMat = () => new THREE.ShaderMaterial({ uniforms: { uTime: U.uTime, uPx: { value: 0 }, uOpacity: { value: 0 } },
  vertexShader: FLY_VS, fragmentShader: FLY_FS, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
const flyMat = makeFlyMat();
const flies = new THREE.Points(flyGeo, flyMat); flies.frustumCulled = false; scene.add(flies);
{ const ph = new Float32Array(N_DROPS); for (let i = 0; i < N_DROPS; i++) ph[i] = Math.random(); flyGeo.setAttribute('aPh', new THREE.BufferAttribute(ph, 1)); }
// fireflies that stay behind on the grass after the night rain lands
const MAX_RES = 7000;
const resPos = new Float32Array(MAX_RES * 3).fill(-9999), resPh = new Float32Array(MAX_RES).map(() => Math.random());
const resGeo = new THREE.BufferGeometry();
resGeo.setAttribute('position', new THREE.BufferAttribute(resPos, 3).setUsage(THREE.DynamicDrawUsage));
resGeo.setAttribute('aPh', new THREE.BufferAttribute(resPh, 1));
const resMat = makeFlyMat();
const residents = new THREE.Points(resGeo, resMat); residents.frustumCulled = false; scene.add(residents);
let resHead = 0, resDirty = false, resSeeded = 0;
function addResident(x, z) {
  const y = groundH(x, z) + 0.25 + Math.random() * 0.9;
  resPos.set([x + (Math.random() - 0.5) * 0.8, y, z + (Math.random() - 0.5) * 0.8], resHead * 3);
  resHead = (resHead + 1) % MAX_RES; resDirty = true;
}
function respawnDrop(d, spread) {
  const a = Math.random() * 6.28, r = Math.sqrt(Math.random()) * 1.9;
  d.x = cloudState.pos.x + Math.cos(a) * r; d.z = cloudState.pos.z + Math.sin(a) * r;
  d.y = cloudState.pos.y - 0.35 - Math.random() * (spread ? 5 : 0.3);
  d.ph = Math.random() * 6.28;
}
for (let i = 0; i < N_DROPS; i++) { const d = {}; respawnDrop(d, true); drops.push(d); }

// a small rainbow that appears in the rain when you call the cloud
const rainbowMat = new THREE.ShaderMaterial({
  uniforms: { uO: { value: 0 } }, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: `uniform float uO; varying vec2 vUv;
    vec3 spec(float t){ return clamp(vec3(abs(t * 6.0 - 3.0) - 1.0, 2.0 - abs(t * 6.0 - 2.0), 2.0 - abs(t * 6.0 - 4.0)), 0.0, 1.0); }
    void main(){ float r = vUv.y; float band = smoothstep(0.0, 0.25, r) * smoothstep(1.0, 0.75, r);
      float ends = smoothstep(0.0, 0.18, vUv.x) * smoothstep(1.0, 0.82, vUv.x);
      gl_FragColor = vec4(spec(1.0 - r) * 0.9, band * ends * uO * 0.55); }`,
});
const rainbow = new THREE.Mesh(new THREE.RingGeometry(2.3, 2.75, 64, 1, 0, Math.PI), rainbowMat);
{ // remap ring uvs: x along the arc, y across the band
  const uv = rainbow.geometry.attributes.uv, pos = rainbow.geometry.attributes.position;
  for (let i = 0; i < uv.count; i++) { const x = pos.getX(i), y = pos.getY(i); uv.setXY(i, 1 - Math.atan2(y, x) / Math.PI, (Math.hypot(x, y) - 2.3) / 0.45); }
}
scene.add(rainbow);

// sand lifted by a gust
const N_DUST = 1800;
const dustPos = new Float32Array(N_DUST * 3), dust = [];
const dustGeo = new THREE.BufferGeometry(); dustGeo.setAttribute('position', new THREE.BufferAttribute(dustPos, 3).setUsage(THREE.DynamicDrawUsage));
const dustMat = new THREE.PointsMaterial({ color: 0xe8b98a, size: 0.05, transparent: true, opacity: 0, depthWrite: false });
const dustPts = new THREE.Points(dustGeo, dustMat); dustPts.frustumCulled = false; scene.add(dustPts);
for (let i = 0; i < N_DUST; i++) dust.push({ x: 0, y: -999, z: 0, v: 0 });

// ---------- fox ----------
const fox = { obj: null, mixer: null, actions: {}, cur: '', pos: new THREE.Vector3(0, 0, 0), heading: 0, speed: 0 };
let foxReady = false;
new GLTFLoader().load(FOX_URL, (gltf) => {
  const root = gltf.scene;
  const box = new THREE.Box3().setFromObject(root), size = box.getSize(new THREE.Vector3());
  const k = 0.95 / Math.max(size.x, size.z);
  root.scale.setScalar(k);
  const foxShadow = !new URLSearchParams(location.search).has('noshadow');
  root.traverse((o) => { if (o.isMesh) { o.castShadow = foxShadow; o.receiveShadow = true; o.frustumCulled = false;
    if (o.material) { o.material.roughness = 0.85; o.material.metalness = 0; } } });
  const holder = new THREE.Group(); holder.add(root); scene.add(holder);
  fox.obj = holder;
  fox.mixer = new THREE.AnimationMixer(root);
  for (const clip of gltf.animations) fox.actions[clip.name] = fox.mixer.clipAction(clip);
  setAnim('Survey');
  foxReady = true;
  if (CREST) setupCrest();
  const L = document.getElementById('loading');
  const qs = new URLSearchParams(location.search);
  if (qs.has('auto') || qs.has('director')) L.remove(); else { L.style.opacity = 0; setTimeout(() => L.remove(), 1300); }
}, undefined, (e) => { document.querySelector('#loading p').textContent = '狐狸模型加载失败，请检查网络'; console.error(e); });
function setAnim(name) {
  if (fox.cur === name || !fox.actions[name]) return;
  const next = fox.actions[name];
  next.reset().setEffectiveWeight(1).fadeIn(0.35).play();
  if (fox.cur) fox.actions[fox.cur].fadeOut(0.35);
  fox.cur = name;
}

// ---------- input ----------
const keys = new Set();
// ?auto=1 drives the fox on its own (demo / headless checks); &night=<sec> &cine=<sec> schedule the switches
const AUTO = new URLSearchParams(location.search);
const autoOn = AUTO.has('auto'), autoNight = +(AUTO.get('night') ?? -1), autoCine = +(AUTO.get('cine') ?? -1), autoGust = +(AUTO.get('gust') ?? -1), autoCall = +(AUTO.get('call') ?? -1);
const DIRECTOR = AUTO.has('director');
const cam = { yaw: 0, pitch: 0.42, dist: 11, mode: 'follow', cineT: 0, introT: 0 };
cam.yaw = Math.atan2(-Math.sin(SUN_AZ), -Math.cos(SUN_AZ)) + 1.05; // sun from the front-left: dunes split into light and shade
let moveTarget = null;
window.__xy = { get fox() { return fox; }, cloudState, scene };
const S = { night: 0, nightTarget: 0, sound: true, quality: 3, rec: null };
addEventListener('keydown', (e) => {
  if (e.repeat) return;
  const k = e.key.toLowerCase();
  keys.add(k); ensureAudio();
  if (k === 'e') { cloudState.callT = 3.6; setAnim('Survey'); }
  if (k === 'r') { S.nightTarget = S.nightTarget > 0.5 ? 0 : 1; }
  if (k === 'g') { cloudState.gustT = 5.5; }
  if (k === 'c') { cam.mode = cam.mode === 'cine' ? 'follow' : 'cine'; cam.cineT = 0; }
  if (k === 'h') document.getElementById('panel').classList.toggle('hidden');
  if (k === 'm') { S.sound = !S.sound; }
  if (k === 'v') toggleRecord();
  if (k === '1' || k === '2' || k === '3') setQuality(+k);
  if (['w', 'a', 's', 'd'].includes(k)) moveTarget = null;
  updateUI();
});
addEventListener('keyup', (e) => keys.delete(e.key.toLowerCase()));
let drag = null;
renderer.domElement.addEventListener('pointerdown', (e) => { drag = { x: e.clientX, y: e.clientY, moved: 0 }; ensureAudio(); });
addEventListener('pointermove', (e) => {
  if (!drag) return;
  const dx = e.clientX - drag.x, dy = e.clientY - drag.y; drag.x = e.clientX; drag.y = e.clientY; drag.moved += Math.abs(dx) + Math.abs(dy);
  cam.yaw -= dx * 0.005; cam.pitch = THREE.MathUtils.clamp(cam.pitch + dy * 0.004, 0.02, 1.25);
});
const ray = new THREE.Raycaster();
addEventListener('pointerup', (e) => {
  if (drag && drag.moved < 6) {
    ray.setFromCamera(new THREE.Vector2(e.clientX / innerWidth * 2 - 1, -(e.clientY / innerHeight) * 2 + 1), camera);
    const hit = ray.intersectObject(terrain)[0];
    if (hit) moveTarget = hit.point.clone();
  }
  drag = null;
});
addEventListener('wheel', (e) => { cam.dist = THREE.MathUtils.clamp(cam.dist * (1 + e.deltaY * 0.001), 3, 22); });

function setQuality(q) {
  S.quality = q;
  renderer.setPixelRatio(q === 1 ? 0.7 : q === 2 ? 1 : Math.min(devicePixelRatio, 2));
  renderer.setSize(innerWidth, innerHeight); composer.setSize(innerWidth, innerHeight);
  sun.shadow.mapSize.set(q === 1 ? 1024 : 2048, q === 1 ? 1024 : 2048);
  if (sun.shadow.map) { sun.shadow.map.dispose(); sun.shadow.map = null; }
}
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight); composer.setSize(innerWidth, innerHeight);
});

// ---------- audio ----------
let AC = null, master, rainGain, windGain, cricketGain, audioDest;
function ensureAudio() {
  if (AC) { if (AC.state === 'suspended') AC.resume(); return; }
  AC = new AudioContext();
  master = AC.createGain(); master.gain.value = 0.9; master.connect(AC.destination);
  audioDest = AC.createMediaStreamDestination(); master.connect(audioDest);
  const len = AC.sampleRate * 3, buf = AC.createBuffer(1, len, AC.sampleRate), d = buf.getChannelData(0);
  let last = 0;
  for (let i = 0; i < len; i++) { const w = Math.random() * 2 - 1; d[i] = w; }
  const brown = AC.createBuffer(1, len, AC.sampleRate), bd = brown.getChannelData(0);
  for (let i = 0; i < len; i++) { last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02; bd[i] = last * 3.5; }
  const src = (b) => { const s = AC.createBufferSource(); s.buffer = b; s.loop = true; s.start(); return s; };
  // rain: bright patter
  const r = src(buf), hp = AC.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 900;
  const lp = AC.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 6500;
  rainGain = AC.createGain(); rainGain.gain.value = 0; r.connect(hp).connect(lp).connect(rainGain).connect(master);
  // wind
  const w = src(brown), wl = AC.createBiquadFilter(); wl.type = 'lowpass'; wl.frequency.value = 420;
  windGain = AC.createGain(); windGain.gain.value = 0; w.connect(wl).connect(windGain).connect(master);
  // crickets (night)
  const osc = AC.createOscillator(); osc.frequency.value = 4300;
  const am = AC.createOscillator(); am.frequency.value = 28; const amG = AC.createGain(); amG.gain.value = 0.5;
  const chirp = AC.createGain(); chirp.gain.value = 0.5; am.connect(amG).connect(chirp.gain);
  const pulse = AC.createOscillator(); pulse.type = 'square'; pulse.frequency.value = 1.6; const pG = AC.createGain(); pG.gain.value = 0.5;
  const pulseGain = AC.createGain(); pulseGain.gain.value = 0.5; pulse.connect(pG).connect(pulseGain.gain);
  cricketGain = AC.createGain(); cricketGain.gain.value = 0;
  osc.connect(chirp).connect(pulseGain).connect(cricketGain).connect(master);
  osc.start(); am.start(); pulse.start();
  // a soft room for the flower chimes
  const ir = AC.createBuffer(2, AC.sampleRate * 2.5, AC.sampleRate);
  for (let c = 0; c < 2; c++) { const d2 = ir.getChannelData(c); for (let i = 0; i < d2.length; i++) d2[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d2.length, 3); }
  chimeBus = AC.createGain(); chimeBus.gain.value = 0.5;
  const verb = AC.createConvolver(); verb.buffer = ir; const wet = AC.createGain(); wet.gain.value = 0.55;
  chimeBus.connect(master); chimeBus.connect(verb).connect(wet).connect(master);
}
// every flower that opens rings one note of a pentatonic scale, so walking plays a tune
let chimeBus = null, lastChime = 0;
const PENTA = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21];
function chime() {
  if (!DIRECTOR && (!AC || !S.sound || !chimeBus)) return;
  const now = DIRECTOR ? tAccum : AC.currentTime;
  if (now - lastChime < 0.28 + Math.random() * 0.25) return;
  lastChime = now;
  const root = S.night > 0.5 ? 57 : 69; // A3 at night, A4 by day
  const midi = root + PENTA[Math.floor(Math.random() * PENTA.length)];
  if (DIRECTOR) { audioLog.chimes.push([+now.toFixed(3), midi]); return; }
  const f = 440 * Math.pow(2, (midi - 69) / 12);
  const g = AC.createGain(); g.gain.setValueAtTime(0, now);
  g.gain.linearRampToValueAtTime(0.06 + Math.random() * 0.04, now + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, now + 2.2);
  const o1 = AC.createOscillator(); o1.type = 'sine'; o1.frequency.value = f;
  const o2 = AC.createOscillator(); o2.type = 'sine'; o2.frequency.value = f * 2.01;
  const g2 = AC.createGain(); g2.gain.value = 0.25;
  o1.connect(g); o2.connect(g2).connect(g); g.connect(chimeBus);
  o1.start(now); o2.start(now); o1.stop(now + 2.4); o2.stop(now + 2.4);
}
function updateAudio() {
  if (!AC) return;
  const t = AC.currentTime, on = S.sound ? 1 : 0;
  const gust = cloudState.gustT > 0 ? Math.min(1, cloudState.gustT / 2) : 0;
  rainGain.gain.setTargetAtTime(on * 0.16 * cloudState.rain * (1 - S.night * 0.85), t, 0.3);
  windGain.gain.setTargetAtTime(on * (0.05 + gust * 0.3), t, 0.4);
  cricketGain.gain.setTargetAtTime(on * 0.012 * S.night, t, 0.6);
}

// ---------- recording ----------
function toggleRecord() {
  if (S.rec) { S.rec.stop(); return; }
  const stream = renderer.domElement.captureStream(60);
  if (audioDest) for (const tr of audioDest.stream.getAudioTracks()) stream.addTrack(tr);
  const mime = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'].find((m) => MediaRecorder.isTypeSupported(m));
  const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 16e6 });
  const chunks = [];
  rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  rec.onstop = () => {
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(chunks, { type: 'video/webm' }));
    a.download = `xiaoyuyun-${Date.now()}.webm`; a.click(); S.rec = null; updateUI();
  };
  rec.start(); S.rec = rec; updateUI();
}

// ---------- UI ----------
const $ = (id) => document.getElementById(id);
function updateUI() {
  const night = S.nightTarget > 0.5;
  $('lR').textContent = night ? '夜晚' : '白天'; $('tod').textContent = night ? '夜晚' : '白天';
  $('kC').classList.toggle('on', cam.mode === 'cine'); $('lC').textContent = cam.mode === 'cine' ? '开' : '关';
  $('kV').classList.toggle('on', !!S.rec); $('lV').textContent = S.rec ? '开' : '关'; $('rec').style.display = S.rec ? 'block' : 'none';
  $('kM').classList.toggle('on', S.sound); $('lM').textContent = S.sound ? '开' : '关';
  for (const q of [1, 2, 3]) $('q' + q).classList.toggle('on', S.quality === q);
  $('lQ').textContent = ['', '低', '中', '高'][S.quality];
}
updateUI();
if (AUTO.has('clean')) for (const el of document.querySelectorAll('.panel, .hint, .chips, #rec')) el.style.display = 'none';
// framing overrides and cover mode for thumbnails: &dist= &pitch= &yaw= (offset) &cover=day|night
if (AUTO.has('dist')) cam.dist = +AUTO.get('dist');
if (AUTO.has('pitch')) cam.pitch = +AUTO.get('pitch');
if (AUTO.has('yaw')) cam.yaw += +AUTO.get('yaw');
if (AUTO.has('shiftx') || AUTO.has('shifty')) { // slide the frame (fractions of width/height) without moving the camera
  const sx = +(AUTO.get('shiftx') ?? 0), sy = +(AUTO.get('shifty') ?? 0);
  const applyShift = () => camera.setViewOffset(innerWidth, innerHeight, sx * innerWidth, sy * innerHeight, innerWidth, innerHeight);
  applyShift(); addEventListener('resize', applyShift);
}
const autoStop = +(AUTO.get('stop') ?? -1), autoGo = +(AUTO.get('go') ?? Infinity); // auto-walk rests between stop and go (seconds)
// ---------- cover scene (?cover=day|night&scene=crest): low telephoto shot of the fox on a dune crest ----------
const CREST = AUTO.get('scene') === 'crest', AERIAL = AUTO.get('scene') === 'aerial';
const pathPts = [];
// straight-down aerial framing of the whole trail (?scene=aerial): fits the walked path into the frame
const _up = new THREE.Vector3(), _r = new THREE.Vector3();
function aerialCamera() {
  if (pathPts.length < 2) return;
  const rot = THREE.MathUtils.degToRad(+(AUTO.get('rot') ?? 0));
  const ux = Math.sin(rot), uz = -Math.cos(rot);           // screen-up direction on the ground
  const rx = -uz, rz = ux;                                  // screen-right
  let minU = 1e9, maxU = -1e9, minR = 1e9, maxR = -1e9;
  for (const [x, z] of pathPts) {
    const u = x * ux + z * uz, r = x * rx + z * rz;
    minU = Math.min(minU, u); maxU = Math.max(maxU, u); minR = Math.min(minR, r); maxR = Math.max(maxR, r);
  }
  const cu = (minU + maxU) / 2, cr = (minR + maxR) / 2;
  const cx = cu * ux + cr * rx, cz = cu * uz + cr * rz;
  const vf = THREE.MathUtils.degToRad(camera.fov) / 2, hf = Math.atan(Math.tan(vf) * camera.aspect);
  const margin = +(AUTO.get('zoom') ?? 1.35);
  const H = Math.max((maxU - minU + 8) / 2 / Math.tan(vf), (maxR - minR + 8) / 2 / Math.tan(hf)) * margin;
  const gy = groundH(cx, cz);
  camera.position.set(cx, gy + H, cz);
  camera.up.set(ux, 0, uz);
  camera.lookAt(cx, gy, cz);
}
const DAY_ELEV = +(AUTO.get('elev') ?? 15), EXPO = +(AUTO.get('exp') ?? 0.55);
if (AUTO.has('fog')) { scene.fog.density = +AUTO.get('fog'); U.uFogDen.value = scene.fog.density; }
const coverCam = { pos: new THREE.Vector3(), target: new THREE.Vector3(), dir: new THREE.Vector3() };
let crestReady = false;
const moonTex = (() => {
  const c = document.createElement('canvas'); c.width = c.height = 256; const g = c.getContext('2d');
  const gl = g.createRadialGradient(128, 128, 0, 128, 128, 128);
  gl.addColorStop(0, 'rgba(255,250,236,1)'); gl.addColorStop(0.16, 'rgba(255,248,230,1)'); gl.addColorStop(0.2, 'rgba(255,240,215,0.35)');
  gl.addColorStop(0.45, 'rgba(255,236,210,0.08)'); gl.addColorStop(1, 'rgba(255,236,210,0)');
  g.fillStyle = gl; g.fillRect(0, 0, 256, 256);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
})();
const moonSprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: moonTex, transparent: true, depthWrite: false, fog: false, opacity: 0 }));
moonSprite.scale.setScalar(260); scene.add(moonSprite);
function updateMoon() {
  const a = +(AUTO.get('moonaz') ?? -0.16), e = +(AUTO.get('moonel') ?? 0.2);
  const d = coverCam.dir.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), a);
  d.y = Math.tan(e); d.normalize();
  moonSprite.position.copy(camera.position).addScaledVector(d, 3500);
  moonSprite.material.opacity = smooth(0.5, 1, S.night);
}
function setupCrest() {
  const camAz = THREE.MathUtils.degToRad(+(AUTO.get('camaz') ?? 143)); // across the dune ridges, so the crest becomes the skyline
  const dir = coverCam.dir.set(Math.sin(camAz), 0, Math.cos(camAz));
  const F = new THREE.Vector3(); let best = -1e9;
  for (let x = -170; x <= 170; x += 3) for (let z = -170; z <= 170; z += 3) {
    if (x * x + z * z > 170 * 170) continue;
    const h = groundH(x, z); if (h > best) { best = h; F.set(x, h, z); }
  }
  F.addScaledVector(dir, +(AUTO.get('back') ?? -1.5)); F.y = groundH(F.x, F.z);
  fox.pos.copy(F);
  fox.heading = Math.atan2(dir.z, -dir.x) + (AUTO.has('faceleft') ? Math.PI : 0);
  cloudState.pos.set(F.x, F.y + 3.9, F.z);
  const D = +(AUTO.get('dist') ?? 40);
  const C = F.clone().addScaledVector(dir, -D);
  let eye = groundH(C.x, C.z) + 1.6;
  for (let k = 0; k < 80; k++) { // raise the eye until no dune blocks the line to the fox's feet
    let blocked = false;
    for (let i = 1; i < 30; i++) {
      const t = i / 30, px = C.x + (F.x - C.x) * t, pz = C.z + (F.z - C.z) * t;
      if (groundH(px, pz) > eye + (F.y + 0.15 - eye) * t) { blocked = true; break; }
    }
    if (!blocked) break; eye += 0.4;
  }
  coverCam.pos.set(C.x, eye + +(AUTO.get('lift') ?? 0), C.z);
  coverCam.target.set(F.x, F.y + +(AUTO.get('aim') ?? 2.2), F.z);
  camera.fov = +(AUTO.get('fov') ?? 20); camera.updateProjectionMatrix();
  rainMat.color.set(0xfff1dc);
  if (AUTO.get('cover') === 'night') { S.night = S.nightTarget = 1; updateUI(); }
  crestReady = true;
}

if (AERIAL && AUTO.has('fov')) { camera.fov = +AUTO.get('fov'); camera.updateProjectionMatrix(); }
if (AUTO.has('cover')) {
  for (const el of document.querySelectorAll('.panel, .hint, .chips, #rec, .title')) el.style.display = 'none';
  const cv = $('cover'); cv.style.display = 'block'; cv.classList.toggle('night', AUTO.get('cover') === 'night');
  if (AUTO.has('nocredit')) cv.querySelector('.cc').style.display = 'none';
}

// ---------- time of day ----------
const sunColDay = new THREE.Color(1.0, 0.70, 0.42), ambDay = new THREE.Color(0.30, 0.27, 0.27), ambNight = new THREE.Color(0.05, 0.07, 0.12);
const puffTop = new THREE.Color(), puffBot = new THREE.Color(), tmpC = new THREE.Color();
function applyTimeOfDay() {
  const n = S.night;
  const elev = THREE.MathUtils.degToRad(lerp(DAY_ELEV, -9, n));
  sunDir.setFromSphericalCoords(1, Math.PI / 2 - elev, SUN_AZ);
  skyU.sunPosition.value.copy(sunDir);
  skyU.rayleigh.value = lerp(2.4, 0.4, n);
  U.uSunDir.value.copy(sunDir);
  const sunUp = THREE.MathUtils.clamp(sunDir.y * 6, 0, 1);
  sun.intensity = 4.2 * sunUp;
  U.uSunCol.value.copy(sunColDay).multiplyScalar(1.6 * sunUp);
  moon.intensity = 1.5 * n;
  hemi.intensity = lerp(1.25, 0.3, n);
  hemi.color.setRGB(lerp(0.62, 0.22, n), lerp(0.68, 0.32, n), lerp(0.82, 0.62, n));
  hemi.groundColor.setRGB(lerp(0.6, 0.04, n), lerp(0.42, 0.05, n), lerp(0.28, 0.09, n));
  U.uAmb.value.copy(ambDay).lerp(ambNight, n);
  scene.fog.color.copy(fogDay).lerp(fogNight, n);
  starMat.opacity = smooth(0.5, 1, n);
  renderer.toneMappingExposure = lerp(EXPO, 0.9, n);
  bloom.strength = lerp(0.28, 0.85, n);
  bloom.threshold = lerp(0.85, 0.35, n);
  // cloud shading: sunlit warm top, cool belly
  puffTop.setRGB(1.0, 0.93, 0.86).lerp(tmpC.setRGB(0.42, 0.48, 0.62), n);
  puffBot.setRGB(0.72, 0.74, 0.82).lerp(tmpC.setRGB(0.14, 0.17, 0.26), n);
  rainMat.opacity = (CREST ? 0.75 : 0.42) * (1 - n);
  flyMat.uniforms.uOpacity.value = n; resMat.uniforms.uOpacity.value = smooth(0.3, 1, n);
  const px = 0.11 * renderer.domElement.height / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2));
  flyMat.uniforms.uPx.value = px; resMat.uniforms.uPx.value = px * 0.9;
}

// ---------- loop ----------
const clock = new THREE.Clock();
const tmpV = new THREE.Vector3(), camTarget = new THREE.Vector3(), camPos = new THREE.Vector3(0, 4, 8);
let tAccum = 0, decayAcc = 0, uiAcc = 0, wetFrame = 0;
const windVec = new THREE.Vector3(0.8, 0, 0.6).normalize();

const perf = { js: 0, render: 0 };
window.__xy.perf = perf;
// ?ff=N fast-forwards N fixed 1/60 s simulation steps per rendered frame (headless checks)
const FF = Math.max(1, +(new URLSearchParams(location.search).get('ff') ?? 1));
const FREEZE = +(new URLSearchParams(location.search).get('freeze') ?? -1); // stop the clock at t seconds (headless checks)
function step() {
  const pt0 = performance.now();
  const realDt = Math.min(clock.getDelta(), 0.05);
  if (FREEZE >= 0) { if (foxReady) while (tAccum < FREEZE) simulate(1 / 60); }
  else for (let i = 0; i < FF; i++) simulate(FF > 1 ? 1 / 60 : realDt);
  const pt1 = performance.now();
  composer.render();
  const pt2 = performance.now();
  perf.js = perf.js * 0.9 + (pt1 - pt0) * 0.1; perf.render = perf.render * 0.9 + (pt2 - pt1) * 0.1;
  requestAnimationFrame(step);
}
if (new URLSearchParams(location.search).has('debug')) setTimeout(() => {
  const list = []; scene.traverse((o) => { if (o.castShadow) list.push(o.type + ':' + (o.name || '') ); });
  const pre = document.createElement('pre'); pre.id = 'dbg'; pre.textContent = JSON.stringify({ casters: list, t: tAccum, fox: fox.pos.toArray() });
  document.body.appendChild(pre);
}, 3000);
function simulate(dt) {
  if (DIRECTOR) direct(dt);
  tAccum += dt; U.uTime.value = tAccum;

  // day / night
  S.night += (S.nightTarget - S.night) * (1 - Math.exp(-dt * 0.8));
  applyTimeOfDay();

  // ---- fox movement
  let ix = 0, iz = 0;
  if (keys.has('w')) iz += 1; if (keys.has('s')) iz -= 1; if (keys.has('a')) ix -= 1; if (keys.has('d')) ix += 1;
  const fwd = tmpV.set(-Math.sin(cam.yaw), 0, -Math.cos(cam.yaw));
  let mx = fwd.x * iz + (-fwd.z) * ix, mz = fwd.z * iz + fwd.x * ix;
  if (moveTarget && !ix && !iz) {
    const dx = moveTarget.x - fox.pos.x, dz = moveTarget.z - fox.pos.z, d = Math.hypot(dx, dz);
    if (d < 0.4) moveTarget = null; else { mx = dx / d; mz = dz / d; }
  }
  if (autoOn) {
    if (!(autoStop >= 0 && tAccum > autoStop && tAccum < autoGo)) {
      const steer = Math.sin(tAccum * 0.23) * 0.9 + Math.sin(tAccum * 0.61) * 0.35;
      mx = Math.sin(steer); mz = Math.cos(steer);
    }
    if (autoNight >= 0 && tAccum > autoNight && S.nightTarget < 1) { S.nightTarget = 1; updateUI(); }
    if (autoCall >= 0 && tAccum > autoCall && tAccum - dt <= autoCall) cloudState.callT = 3.6;
    if (autoCine >= 0 && tAccum > autoCine && cam.mode !== 'cine') { cam.mode = 'cine'; cam.cineT = 0; updateUI(); }
    if (autoGust >= 0 && tAccum > autoGust && tAccum - dt <= autoGust) cloudState.gustT = 5.5;
  }
  const ml = Math.hypot(mx, mz);
  const running = keys.has('shift');
  const want = ml > 0 ? (running ? 4.6 : 1.7) : 0;
  fox.speed += (want - fox.speed) * (1 - Math.exp(-dt * 5));
  if (ml > 0) {
    const th = Math.atan2(mx / ml, mz / ml);
    let dh = th - fox.heading; dh = Math.atan2(Math.sin(dh), Math.cos(dh));
    fox.heading += dh * (1 - Math.exp(-dt * 8));
  }
  fox.pos.x += Math.sin(fox.heading) * fox.speed * dt;
  fox.pos.z += Math.cos(fox.heading) * fox.speed * dt;
  fox.pos.y = groundH(fox.pos.x, fox.pos.z);
  if (foxReady) {
    fox.obj.position.copy(fox.pos);
    fox.obj.rotation.y = fox.heading;
    const state = fox.speed > 3 ? 'Run' : fox.speed > 0.25 ? 'Walk' : 'Survey';
    if (cloudState.callT <= 0 || state !== 'Survey') setAnim(state);
    if (fox.actions.Walk) fox.actions.Walk.timeScale = THREE.MathUtils.clamp(fox.speed / 1.5, 0.6, 1.6);
    if (fox.actions.Run) fox.actions.Run.timeScale = THREE.MathUtils.clamp(fox.speed / 4.2, 0.7, 1.3);
    fox.mixer.update(dt);
    $('state').textContent = state === 'Run' ? '奔跑' : state === 'Walk' ? '漫步' : '休息';
  }

  // ---- cloud follows (critically damped spring, with gusts and calls)
  const cs = cloudState;
  cs.gustT = Math.max(0, cs.gustT - dt); cs.callT = Math.max(0, cs.callT - dt);
  U.uWind.value += ((cs.gustT > 3.5 ? 1 : cs.gustT > 0 ? 0.35 : 0) - U.uWind.value) * (1 - Math.exp(-dt * 2));
  const lag = THREE.MathUtils.clamp(fox.speed * 0.9, 0, 2.2); // the cloud trails half a step behind, so green grows behind the fox
  const target = tmpV.set(fox.pos.x - Math.sin(fox.heading) * lag, fox.pos.y + 3.9 + Math.sin(tAccum * 1.3) * 0.15, fox.pos.z - Math.cos(fox.heading) * lag);
  if (cs.callT > 0) {
    const a = tAccum * 2.4, k = Math.sin(Math.min(1, (3.6 - cs.callT) / 0.8) * Math.PI / 2) * Math.min(1, cs.callT / 0.8);
    target.x += Math.cos(a) * 1.3 * k; target.z += Math.sin(a) * 1.3 * k; target.y -= 2.2 * k;
  }
  let stiff = 6;
  if (cs.gustT > 0) {
    stiff = cs.gustT > 3.5 ? 0.25 : lerp(6, 0.6, cs.gustT / 3.5);
    if (cs.gustT > 3.5) cs.vel.addScaledVector(windVec, dt * 26);
  }
  const damp = 2 * Math.sqrt(stiff) * 0.9;
  cs.vel.x += ((target.x - cs.pos.x) * stiff - cs.vel.x * damp) * dt;
  cs.vel.y += ((target.y - cs.pos.y) * stiff - cs.vel.y * damp) * dt;
  cs.vel.z += ((target.z - cs.pos.z) * stiff - cs.vel.z * damp) * dt;
  cs.pos.addScaledVector(cs.vel, dt);
  cs.pos.y = Math.max(cs.pos.y, groundH(cs.pos.x, cs.pos.z) + 1.4);
  cloud.position.copy(cs.pos);
  cloud.rotation.z = THREE.MathUtils.clamp(-cs.vel.x * 0.04, -0.3, 0.3);
  cloud.rotation.x = THREE.MathUtils.clamp(cs.vel.z * 0.04, -0.3, 0.3);
  cs.rain = cs.callT > 0 ? 1.6 : 1;
  for (const p of puffs) {
    const u = p.userData;
    const br = 1 + Math.sin(tAccum * 0.9 + u.ph) * 0.06;
    p.position.set(u.base.x * br, u.base.y + Math.sin(tAccum * 0.7 + u.ph) * 0.05, u.base.z * br);
    p.scale.setScalar(u.size * br);
    const h = THREE.MathUtils.clamp((u.base.y + 0.15) / 0.75, 0, 1);
    const side = Math.max(0, u.base.clone().normalize().dot(sunDir)) * (1 - S.night);
    p.material.color.copy(puffBot).lerp(puffTop, Math.min(1, h * 0.8 + side * 0.5));
    p.material.opacity = 1.0;
  }

  // ---- rain / fireflies
  const night = S.night;
  const active = Math.floor(N_DROPS * Math.min(1, 0.55 * cs.rain) * (1 - night * 0.82));
  const fall = lerp(10, 1.1, night);
  let impacts = 0;
  for (let i = 0; i < N_DROPS; i++) {
    const d = drops[i];
    if (i >= active) { rainPos.fill(0, i * 6, i * 6 + 6); flyPos.fill(-9999, i * 3, i * 3 + 3); continue; }
    d.y -= fall * dt;
    const wob = night * 0.25;
    const fx = d.x + Math.sin(tAccum * 1.7 + d.ph) * wob, fz = d.z + Math.cos(tAccum * 1.3 + d.ph) * wob;
    const gy = groundH(d.x, d.z);
    if (d.y < gy) {
      impacts++;
      paintWet(d.x, d.z, night > 0.5 ? 0.25 : 1);
      if (Math.random() < 0.5) spawnGrass(d.x, d.z, tAccum);
      if (Math.random() < 0.012 + night * 0.02) spawnFlower(d.x, d.z, tAccum);
      if (night > 0.5 && Math.random() < 0.35) addResident(d.x, d.z);
      respawnDrop(d, false);
    }
    const len = 0.32;
    rainPos.set([d.x, d.y, d.z, d.x - cs.vel.x * 0.03, d.y + len, d.z - cs.vel.z * 0.03], i * 6);
    flyPos.set([fx, d.y, fz], i * 3);
  }
  rainGeo.attributes.position.needsUpdate = true;
  flyGeo.attributes.position.needsUpdate = true;
  flushPool(grass); flushPool(flowers);
  // when night falls, fireflies rise out of the grass you already grew
  if (night > 0.3 && resSeeded < 6000 && grass.total > 0) {
    const n = Math.min(grass.total, grass.max);
    for (let k = 0; k < 60; k++) { const i = Math.floor(Math.random() * n) * 4; addResident(grass.aPos.array[i], grass.aPos.array[i + 2]); resSeeded++; }
  }
  if (night < 0.05) resSeeded = 0;
  if (resDirty) { resGeo.attributes.position.needsUpdate = true; resDirty = false; }

  // rainbow follows the cloud during a call, facing the camera
  const rbK = cs.callT > 0 ? Math.min(1, (3.6 - cs.callT) / 0.6) * Math.min(1, cs.callT / 0.9) : 0;
  rainbowMat.uniforms.uO.value = rbK * (1 - night);
  rainbow.visible = rbK > 0.001;
  if (rainbow.visible) {
    rainbow.position.set(fox.pos.x, fox.pos.y + 0.1, fox.pos.z);
    rainbow.lookAt(camera.position.x, rainbow.position.y, camera.position.z);
  }

  // dust streams along the wind while a gust blows
  const gustK = cs.gustT > 3.5 ? 1 : cs.gustT / 3.5;
  dustMat.opacity = 0.55 * gustK * (1 - night * 0.7);
  if (gustK > 0.01) {
    for (let i = 0; i < N_DUST; i++) {
      const p = dust[i];
      if (p.y < -900 || Math.abs(p.x - fox.pos.x) > 30 || Math.abs(p.z - fox.pos.z) > 30) {
        p.x = fox.pos.x + (Math.random() - 0.5) * 50 - windVec.x * 18; p.z = fox.pos.z + (Math.random() - 0.5) * 50 - windVec.z * 18;
        p.y = groundH(p.x, p.z) + Math.random() * 0.6; p.v = 6 + Math.random() * 8;
      }
      p.x += windVec.x * p.v * dt; p.z += windVec.z * p.v * dt;
      const gy = groundH(p.x, p.z); p.y = Math.max(gy + 0.02, p.y + (Math.sin(tAccum * 3 + i) * 0.4) * dt);
      dustPos[i * 3] = p.x; dustPos[i * 3 + 1] = p.y; dustPos[i * 3 + 2] = p.z;
    }
    dustGeo.attributes.position.needsUpdate = true;
  }

  // wet map: slow drying, throttled upload
  decayAcc += dt;
  if (decayAcc > 0.3) {
    decayAcc = 0;
    for (let k = 0; k < wetData.length; k += 4) if (wetData[k] > 0) wetData[k] = Math.max(0, wetData[k] - 2);
    wetDirty = true;
  }
  if (wetDirty && ++wetFrame % 3 === 0) { wetTex.needsUpdate = true; wetDirty = false; }

  // ---- camera
  camTarget.set(fox.pos.x, fox.pos.y + 1.2, fox.pos.z);
  if (cam.mode === 'cine') {
    cam.cineT += dt;
    const k = smooth(0, 6, cam.cineT);
    const a = cam.yaw + cam.cineT * 0.04;
    const dist = lerp(cam.dist, 70, k), h = lerp(2.5, 55, k);
    tmpV.set(camTarget.x + Math.sin(a) * dist, camTarget.y + h, camTarget.z + Math.cos(a) * dist);
    camPos.lerp(tmpV, 1 - Math.exp(-dt * 2.5));
  } else {
    cam.introT += dt;
    const intro = 1 - smooth(0.6, 5.5, cam.introT);
    const cp = Math.cos(cam.pitch);
    tmpV.set(camTarget.x + Math.sin(cam.yaw) * cp * cam.dist, camTarget.y + Math.sin(cam.pitch) * cam.dist, camTarget.z + Math.cos(cam.yaw) * cp * cam.dist);
    if (intro > 0) { // opening shot: start high over the dune sea and glide down to the fox
      const k = intro * intro;
      tmpV.x += Math.sin(cam.yaw + 0.6) * 60 * k; tmpV.z += Math.cos(cam.yaw + 0.6) * 60 * k; tmpV.y += 38 * k;
      camPos.copy(tmpV);
    } else camPos.lerp(tmpV, 1 - Math.exp(-dt * 5));
  }
  camPos.y = Math.max(camPos.y, groundH(camPos.x, camPos.z) + 0.6);
  camera.position.copy(camPos);
  camera.lookAt(camTarget);
  if (crestReady) { camera.position.copy(coverCam.pos); camera.lookAt(coverCam.target); updateMoon(); }
  if (AERIAL) { if (Math.floor(tAccum * 2) !== Math.floor((tAccum - dt) * 2)) pathPts.push([fox.pos.x, fox.pos.z]); aerialCamera(); camera.far = 20000; camera.updateProjectionMatrix(); }
  gradePass.uniforms.uTime.value = tAccum;

  // shadows follow the fox
  sun.position.copy(fox.pos).addScaledVector(sunDir, 150);
  sun.target.position.copy(fox.pos);
  moon.position.copy(fox.pos).add(tmpV.set(-60, 120, 40));
  moon.target.position.copy(fox.pos);

  uiAcc += dt;
  if (uiAcc > 0.25) { uiAcc = 0; $('area').textContent = greenCells.toLocaleString('zh-CN'); }
  if (tAccum > 8) $('hint').style.opacity = cam.mode === 'cine' || tAccum > 20 ? 0 : 1;

  updateAudio();
}
// ---------- director (?director=1): a scripted 30 s tour of every control, rendered frame by frame ----------
const audioLog = { chimes: [], samples: [] };
const flashUntil = new Map();
const keyEls = {};
document.querySelectorAll('.panel .k').forEach((el) => { (keyEls[el.textContent] ||= []).push(el); });
const CAPTIONS = [
  [0.6, 4.0, '', '一只狐狸，和一朵只属于它的云'],
  [4.4, 9.0, 'W A S D', '行走 · 雨落下的地方会长草开花'],
  [9.2, 12.1, 'Shift', '奔跑 · 小云追不上了'],
  [12.3, 15.0, 'E', '呼唤小云'],
  [15.2, 18.3, '拖动 / 滚轮', '环绕镜头 · 拉远拉近'],
  [18.6, 21.0, 'G', '一阵风'],
  [21.2, 24.0, 'R', '入夜 · 雨变成萤火虫'],
  [24.2, 27.2, 'C', '回望你走出的来路'],
];
let dPrev = -1, capShown = -1;
function direct(dt) {
  const t = tAccum;
  const at = (x) => dPrev < x && t >= x;
  const hold = (k, a, b, label) => {
    if (t >= a && t < b) { keys.add(k); flashUntil.set(label, t + 0.12); } else if (at(b)) keys.delete(k);
  };
  hold('w', 4.4, 15.0, 'W'); hold('w', 18.4, 31, 'W');
  hold('a', 5.8, 6.7, 'A'); hold('d', 7.6, 8.5, 'D');
  hold('shift', 9.2, 12.1, 'Shift'); hold('d', 9.2, 12.1, 'D'); // run on a diagonal so the lagging cloud stays out of the lens
  if (t >= 8.8 && t < 12.3) cam.dist = lerp(cam.dist, 16, 1 - Math.exp(-dt * 2));
  if (t >= 12.3 && t < 15.2) cam.dist = lerp(cam.dist, 11, 1 - Math.exp(-dt * 2));
  hold('a', 19.2, 19.9, 'A'); hold('d', 25.0, 25.8, 'D');
  if (at(12.3)) { cloudState.callT = 3.6; flashUntil.set('E', t + 0.45); }
  if (t >= 15.2 && t < 16.9) { cam.yaw += dt * 0.9; flashUntil.set('拖动', t + 0.12); }
  if (t >= 16.9 && t < 17.6) { cam.dist = lerp(cam.dist, 20, 1 - Math.exp(-dt * 4)); flashUntil.set('滚轮', t + 0.12); }
  if (t >= 17.6 && t < 18.3) { cam.dist = lerp(cam.dist, 7, 1 - Math.exp(-dt * 4)); flashUntil.set('滚轮', t + 0.12); }
  if (t >= 18.3 && t < 21) cam.dist = lerp(cam.dist, 11, 1 - Math.exp(-dt * 2));
  if (at(18.6)) { cloudState.gustT = 5.5; flashUntil.set('G', t + 0.45); }
  if (at(21.2)) { S.nightTarget = 1; updateUI(); flashUntil.set('R', t + 0.45); }
  if (at(24.2)) { cam.mode = 'cine'; cam.cineT = 0; updateUI(); flashUntil.set('C', t + 0.45); }
  for (const [label, els] of Object.entries(keyEls)) {
    const on = (flashUntil.get(label) ?? -1) > t;
    for (const el of els) el.classList.toggle('press', on);
  }
  const ci = CAPTIONS.findIndex(([a, b]) => t >= a && t < b);
  if (ci !== capShown) {
    capShown = ci;
    const cap = $('cap');
    if (ci >= 0) { const [, , k, txt] = CAPTIONS[ci]; cap.innerHTML = (k ? `<b>${k}</b>` : '') + txt; cap.style.opacity = 1; }
    else cap.style.opacity = 0;
  }
  $('endcard').style.opacity = t >= 27.2 ? 1 : 0;
  $('hint').style.display = 'none';
  // sound cues for the offline mix: rain heard from the camera, night, gust
  if (Math.floor(t * 30) !== Math.floor(dPrev * 30)) {
    const d = camera.position.distanceTo(cloud.position);
    const rain = Math.min(1, 0.55 * cloudState.rain) * (1 - S.night * 0.82);
    const gust = cloudState.gustT > 3.5 ? 1 : cloudState.gustT / 3.5;
    audioLog.samples.push([+t.toFixed(3), +(rain / (1 + d / 14)).toFixed(4), +S.night.toFixed(3), +gust.toFixed(3)]);
  }
  dPrev = t;
}

// pre-place the cloud above the start and let it rain for a moment so the opening frame already has life
cloudState.pos.set(0, groundH(0, 0) + 4.3, 0);
camPos.set(Math.sin(cam.yaw) * 10, groundH(0, 0) + 6, Math.cos(cam.yaw) * 10);
if (DIRECTOR) {
  window.__ready = () => foxReady;
  window.__renderAt = (t) => { while (tAccum < t) simulate(1 / 60); composer.render(); return tAccum; };
  window.__audioLog = audioLog;
} else requestAnimationFrame(step);
