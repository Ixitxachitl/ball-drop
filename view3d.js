// Ball Drop's 3D view (?view=3d), drawn with three.js. The course and its physics are in course3d.js and
// the race itself in index.html; this draws them. The track is swept along its whole length as one
// continuous piece, so loops are real loops and banked turns lean: orange track with side rails, red I-beam
// girders, coaster rails on a plank deck, or a dark channel lined with neon, on columns down to the ground.
// On it stand chrome pachinko pins, dice, stacks of poker chips, drum bumpers, slingshots and flippers,
// boost pads, conveyors, a lane-splitting wall, dominoes and cones; beside it lamp posts, slot machines whose
// reels spin, and turning gears; over some of it a glass tube; funnels of glass to spiral down through; and
// a finish arch at the bottom. All under a night sky with a city on the horizon and searchlights sweeping.
// The racers are glossy balls in their chat colors with their initials on, rolling as they go.
//
// The camera orbits (drag), zooms (wheel) and pans (right-drag). Click a racer to follow them, double-click
// empty space to go back to auto; A = auto, O = the whole course, F = leave the camera where it is,
// ← / → = follow the next racer. Mods can type "!cam name", "!cam all" or "!cam" in chat. On auto it watches
// the starting pen, chases the leader during the race, and shows the winner crossing the line.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const TAU = Math.PI * 2;
const rnd = (a, b) => a + Math.random() * (b - a);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// ---- textures, drawn on little canvases (pixel art stays crisp) ----
function canvasTex(w, h, draw, smooth = false) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  return texOf(c, smooth);
}
function texOf(c, smooth = false) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  if (!smooth) t.magFilter = t.minFilter = THREE.NearestFilter;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}
const rowsTex = rows => canvasTex(rows[0].length, rows.length, (x) => rows.forEach((row, j) => row.forEach((c, i) => { x.fillStyle = c; x.fillRect(i, j, 1, 1); })));

export function create(g) {
  const { CFG, RW, C } = g;
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(2, devicePixelRatio || 1));
  renderer.setSize(innerWidth, innerHeight);
  renderer.shadowMap.enabled = !!CFG.shadows;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.domElement.id = 'gl';
  document.body.insertBefore(renderer.domElement, document.getElementById('ui'));

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0x1a1030, 1400, 4200);
  const camera = new THREE.PerspectiveCamera(40, innerWidth / innerHeight, 1, 12000);
  const controls = new OrbitControls(camera, renderer.domElement);
  Object.assign(controls, { enableDamping: true, dampingFactor: 0.12, minDistance: 15, maxDistance: 5000, screenSpacePanning: true, zoomSpeed: 1.3 });

  // moonlight from above, a warm fill from the city glow, a cool one from below
  scene.add(new THREE.HemisphereLight(0xfff2e0, 0x3a2c60, 1.9));
  const sun = new THREE.DirectionalLight(0xffffff, 2.2);
  sun.castShadow = true;
  sun.shadow.mapSize.set(4096, 4096);
  sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.4;
  scene.add(sun, sun.target);

  // ---- materials ----
  const mats = new Map();
  const lam = (color, o = {}) => { const k = 'l' + color + JSON.stringify(o); let m = mats.get(k); if (!m) mats.set(k, m = new THREE.MeshLambertMaterial({ color, ...o })); return m; };
  const shiny = (color, o = {}) => { const k = 's' + color + JSON.stringify(o); let m = mats.get(k); if (!m) mats.set(k, m = new THREE.MeshPhongMaterial({ color, shininess: 90, specular: 0x555566, ...o })); return m; };
  const glowing = color => { const k = 'b' + color; let m = mats.get(k); if (!m) mats.set(k, m = new THREE.MeshBasicMaterial({ color })); return m; };
  const STEEL = shiny('#d8d8e8'), IRON = lam('#3a3450'), IRON2 = lam('#5a5470'), DARK = lam('#2a2236'), BRASS = shiny('#e8b84a');
  const GLASS = new THREE.MeshPhongMaterial({ color: 0xbfe8ff, transparent: true, opacity: 0.2, depthWrite: false, side: THREE.DoubleSide, shininess: 120, specular: 0xffffff });
  const checker = rowsTex([['#fffaf0', '#1f1830'], ['#1f1830', '#fffaf0']]);
  const boostTex = canvasTex(12, 4, (x) => { for (let i = 0; i < 12; i++) for (let j = 0; j < 4; j++) { x.fillStyle = ((i + j) % 6) < 3 ? C.boostA : C.boostB; x.fillRect(i, j, 1, 1); } });
  const beltTex = rowsTex([['#e8e6f4', '#e8e6f4', '#3a2c40', '#3a2c40']]);
  const plankTex = rowsTex([['#8a5a3a', '#8a5a3a', '#8a5a3a', '#6a4028']]);
  const BOOST = new THREE.MeshBasicMaterial({ map: boostTex }), BELT = new THREE.MeshLambertMaterial({ map: beltTex });
  const CHECKER = new THREE.MeshLambertMaterial({ map: checker }), PLANKS = new THREE.MeshLambertMaterial({ map: plankTex });
  const dieMats = (() => {
    const face = n => new THREE.MeshLambertMaterial({ map: canvasTex(7, 7, (x) => { x.fillStyle = '#fffaf0'; x.fillRect(0, 0, 7, 7); x.drawImage(g.dieArt(n), 0, 0); }) });
    const f = [1, 2, 3, 4, 5, 6].map(face);
    return [f[2], f[3], f[1], f[4], f[0], f[5]];   // (opposite faces add up to 7)
  })();
  // poker chips: a rim of the chip's color with white inlays, and faces with a ring of inlays round the middle
  const chipMats = new Map();
  function chipMat([main, dark]) {
    let m = chipMats.get(main);
    if (m) return m;
    const rim = canvasTex(16, 1, (x) => { for (let i = 0; i < 16; i++) { x.fillStyle = i % 4 === 1 ? '#f4f0ff' : main; x.fillRect(i, 0, 1, 1); } });
    const face = canvasTex(32, 32, (x) => {
      x.fillStyle = main; x.beginPath(); x.arc(16, 16, 16, 0, TAU); x.fill();
      for (let i = 0; i < 8; i++) { x.fillStyle = '#f4f0ff'; x.save(); x.translate(16, 16); x.rotate(i / 8 * TAU); x.fillRect(-2, -16, 4, 6); x.restore(); }
      x.fillStyle = dark; x.beginPath(); x.arc(16, 16, 9, 0, TAU); x.fill();
    }, true);
    m = [new THREE.MeshLambertMaterial({ map: rim }), new THREE.MeshLambertMaterial({ map: face }), new THREE.MeshLambertMaterial({ map: face })];
    chipMats.set(main, m);
    return m;
  }
  // pop bumpers: a drum in bands of cyan, white and pink, its top ringed the same; yellow and white when hit
  const bumperMats = lit => {
    const [a, b, c] = lit ? ['#ffe600', '#fff3a8', '#ffffff'] : ['#3ff8ff', '#fffaf0', '#ff3bd0'];
    const side = rowsTex([[a], [a], [b], [c], [c], [b], [a], [a]]);
    const top = canvasTex(32, 32, (x) => { for (const [r, col] of [[16, a], [12, b], [8, c]]) { x.fillStyle = col; x.beginPath(); x.arc(16, 16, r, 0, TAU); x.fill(); } }, true);
    const M = lit ? THREE.MeshBasicMaterial : THREE.MeshLambertMaterial;
    return [new M({ map: side }), new M({ map: top }), new M({ map: top })];
  };
  const BUMP = [bumperMats(false), bumperMats(true)];
  const glow = canvasTex(64, 64, (x) => {
    const gr = x.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, 'rgba(255,255,255,0.75)'); gr.addColorStop(0.35, 'rgba(255,255,255,0.28)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = gr; x.fillRect(0, 0, 64, 64);
  }, true);
  const glowSprite = (color, size, opacity = 1) => {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow, color: new THREE.Color(color), blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, opacity }));
    s.scale.setScalar(size); return s;
  };
  const mesh = (geo, mat, shadow = true) => { const m = new THREE.Mesh(geo, mat); m.castShadow = m.receiveShadow = shadow; return m; };

  // ---- placing things on the track ----
  // the frame at s on piece p: where, and which ways are along (x), up off the track (y) and across (z)
  const _f = { P: [0, 0, 0], T: [0, 0, 0], N: [0, 0, 0], B: [0, 0, 0] }, _m = new THREE.Matrix4(), _vx = new THREE.Vector3(), _vy = new THREE.Vector3(), _vz = new THREE.Vector3();
  const frameAt = (p, s) => g.C3.at(p, clamp(s, 0, p.len), _f);
  function onTrack(obj, p, s, u = 0, h = 0) {
    const f = frameAt(p, s);
    obj.position.set(f.P[0] + f.B[0] * u + f.N[0] * h, f.P[1] + f.B[1] * u + f.N[1] * h, f.P[2] + f.B[2] * u + f.N[2] * h);
    obj.quaternion.setFromRotationMatrix(_m.makeBasis(_vx.fromArray(f.T), _vy.fromArray(f.N), _vz.fromArray(f.B)));
    return obj;
  }
  // beside the track, standing straight up, its front (+z) facing the track
  function beside(obj, p, s, u) {
    const f = frameAt(p, s), side = Math.sign(u);
    obj.position.set(f.P[0] + f.B[0] * u, f.P[1] + f.B[1] * u, f.P[2] + f.B[2] * u);
    const along = _vx.set(f.T[0], 0, f.T[2]).normalize(), up = _vy.set(0, 1, 0), front = _vz.crossVectors(along, up).multiplyScalar(-side);
    obj.quaternion.setFromRotationMatrix(_m.makeBasis(along.multiplyScalar(-side), up, front));
    return obj;
  }

  // Sweeps a cross-section (points [u, h], u across the track, h up off it) along samples a..b of piece p,
  // as one mesh. Faces point outward from the middle of the cross-section; `closed` joins its last point
  // back to its first; `su` stretches the texture along the track (repeats per unit).
  function sweep(p, profile, closed, a = 0, b = p.n - 1, su = 0.1) {
    const pos = [], uv = [], E = closed ? profile.length : profile.length - 1;
    let cu = 0, ch = 0; for (const [u, h] of profile) { cu += u / profile.length; ch += h / profile.length; }
    const pt = (i, k) => { const [u, h] = profile[k % profile.length], j = i * 3; return [p.P[j] + p.B[j] * u + p.N[j] * h, p.P[j + 1] + p.B[j + 1] * u + p.N[j + 1] * h, p.P[j + 2] + p.B[j + 2] * u + p.N[j + 2] * h]; };
    for (let i = a; i < b; i++) for (let k = 0; k < E; k++) {
      const q = [pt(i, k), pt(i + 1, k), pt(i + 1, k + 1), pt(i, k + 1)];
      // which way is out: from the middle of the cross-section toward this edge
      const [u0, h0] = profile[k], [u1, h1] = profile[(k + 1) % profile.length], mu = (u0 + u1) / 2 - cu, mh = (h0 + h1) / 2 - ch, j = i * 3;
      const ox = p.B[j] * mu + p.N[j] * mh, oy = p.B[j + 1] * mu + p.N[j + 1] * mh, oz = p.B[j + 2] * mu + p.N[j + 2] * mh;
      const e1 = q[1].map((v, n) => v - q[0][n]), e2 = q[3].map((v, n) => v - q[0][n]);
      const cx = e1[1] * e2[2] - e1[2] * e2[1], cy = e1[2] * e2[0] - e1[0] * e2[2], cz = e1[0] * e2[1] - e1[1] * e2[0];
      const order = cx * ox + cy * oy + cz * oz >= 0 ? [0, 1, 2, 0, 2, 3] : [0, 2, 1, 0, 3, 2];
      const s0 = i * p.ds * su, s1 = (i + 1) * p.ds * su, uvq = [[s0, 0], [s1, 0], [s1, 1], [s0, 1]];
      for (const o of order) { pos.push(...q[o]); uv.push(...uvq[o]); }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.computeVertexNormals();
    return geo;
  }
  const rect = (u0, u1, h0, h1) => [[u0, h0], [u1, h0], [u1, h1], [u0, h1]];

  // ---------------- the course, rebuilt for every race ----------------
  let K = null, world = null, D = null, started = false;
  function dispose(o) { o.traverse(m => { if (m.geometry) m.geometry.dispose(); }); }
  function rebuild() {
    if (world) { scene.remove(world); dispose(world); }
    K = g.K; world = new THREE.Group(); scene.add(world);
    D = { flippers: [], doms: [], cones: [], bumpers: [], cogs: [], decor: [], slots: [], beams: [], gate: null, solid: [] };
    const HW = K.HW, ground = K.lo[1] - 70, lists = new Map();
    const add = (geo, mat) => { let l = lists.get(mat); if (!l) lists.set(mat, l = []); l.push(geo); };

    // the track, piece by piece, in whatever it's made of there
    for (const p of K.pieces) {
      const st = p.style;
      if (st === 'girder') {
        add(sweep(p, rect(-HW, HW, -1.4, 0), true), lam('#e8344e'));
        add(sweep(p, rect(-1.3, 1.3, -6, -1.4), true), lam('#a3203a'));
        add(sweep(p, rect(-HW * 0.7, HW * 0.7, -7.2, -6), true), lam('#e8344e'));
        for (const sd of [-1, 1]) add(sweep(p, rect(sd * HW - (sd > 0 ? 1 : 0), sd * HW + (sd < 0 ? 1 : 0), 0, 2.2), true), lam('#a3203a'));
      } else if (st === 'rail') {
        add(sweep(p, rect(-HW + 1, HW - 1, -1.8, -0.5), true, 0, p.n - 1, 0.25), PLANKS);
        for (const sd of [-1, 1]) {
          add(sweep(p, rect(sd * (HW - 4) - 0.8, sd * (HW - 4) + 0.8, -0.5, 0), true), STEEL);
          add(sweep(p, rect(sd * HW - 0.5, sd * HW + 0.5, 2.6, 3.4), true), STEEL);
        }
      } else if (st === 'neon') {
        add(sweep(p, rect(-HW, HW, -3, 0), true), DARK);
        for (const sd of [-1, 1]) {
          add(sweep(p, rect(sd * (HW - 0.4) - 0.6, sd * (HW - 0.4) + 0.6, 0, 1.2), true), glowing(p.neonC ??= ['#ff3bd0', '#3ff8ff', '#ffe600'][p.i % 3]));
          add(sweep(p, rect(sd * HW - 0.3, sd * HW + 0.3, -2.6, -1.8), true), glowing(p.neonC));
        }
      } else {
        add(sweep(p, rect(-HW, HW, -3, -0.5), true), lam(C.body));
        add(sweep(p, rect(-HW + 0.6, HW - 0.6, -0.6, 0), true), lam(C.top));
        for (const sd of [-1, 1]) add(sweep(p, rect(sd * HW - (sd > 0 ? 1.2 : 0), sd * HW + (sd < 0 ? 1.2 : 0), -0.5, 3), true), lam(C.dark));
      }
      // boost pads and conveyors, laid on top; their textures scroll
      for (const r of p.regions) {
        const a = Math.floor(r.a / p.ds), b = Math.min(p.n - 1, Math.ceil(r.b / p.ds)), u0 = r.u0 ?? -HW, u1 = r.u1 ?? HW;
        add(sweep(p, rect(u0 + 1, u1 - 1, 0.02, 0.32), true, a, b, r.belt ? 0.25 : 1 / 12), r.belt ? BELT : BOOST);
      }
      // the start and finish lines
      if (p.kind === 'start') add(sweep(p, rect(-HW + 1, HW - 1, 0.02, 0.3), true, Math.floor(118 / p.ds), Math.floor(124 / p.ds), 0.5), CHECKER);
      if (p.kind === 'goal') add(sweep(p, rect(-HW + 1, HW - 1, 0.02, 0.3), true, Math.floor((K.finishS - 3) / p.ds), Math.ceil((K.finishS + 3) / p.ds), 0.5), CHECKER);
      // columns down to the ground (not where they'd go through track below)
      if (p.kind !== 'loop') for (let s = 20; s < p.len - 10; s += 55) {
        const f = frameAt(p, s), x = f.P[0] - f.N[0] * 7, y = f.P[1] - f.N[1] * 7, z = f.P[2] - f.N[2] * 7;
        const blocked = K.pieces.some(q => q !== p && Array.from({ length: q.n }, (_, i) => i).some(i => i % 3 === 0 && q.P[i * 3 + 1] < y - 4 && Math.hypot(q.P[i * 3] - x, q.P[i * 3 + 2] - z) < HW + 6));
        if (blocked || y - ground < 8) continue;
        add(new THREE.CylinderGeometry(1.3, 1.6, y - ground, 8).translate(x, (y + ground) / 2, z), IRON2);
        add(new THREE.BoxGeometry(6, 2, 6).translate(x, ground + 1, z), IRON);
        add(new THREE.BoxGeometry(4, 1.5, 4).translate(x, y - 0.75, z), IRON);
      }
      // a glass tube over some of the straights and turns
      if ((p.kind === 'turn' || p.kind === 'straight') && p.len > 60 && (p.i * 7919) % 5 === 0) {
        const arc = Array.from({ length: 13 }, (_, k) => { const a = Math.PI * k / 12; return [-(HW + 1.5) * Math.cos(a), (HW + 1.5) * 0.85 * Math.sin(a)]; });
        const m = mesh(sweep(p, arc, false), GLASS, false); m.renderOrder = 2; world.add(m);
      }
    }
    for (const [mat, l] of lists) {
      const m = mesh(mergeGeometries(l.map(q => q.index ? q.toNonIndexed() : q)), mat);
      world.add(m); l.forEach(q => q.dispose());
      if (mat !== BOOST && mat !== BELT && mat !== CHECKER) D.solid.push(m);   // (what the camera keeps out of)
    }

    // ---- what stands on the track ----
    const pinGeo = new THREE.CylinderGeometry(1.5, 1.5, 7, 10).translate(0, 3.5, 0), capGeo = new THREE.CylinderGeometry(2, 2, 0.8, 10).translate(0, 7.2, 0);
    for (const p of K.pieces) {
      for (const o of p.obs) {
        if (o.kind === 'pin') { world.add(onTrack(mesh(pinGeo, STEEL), p, o.s, o.u), onTrack(mesh(capGeo, BRASS), p, o.s, o.u)); }
        else if (o.kind === 'die') { const d = onTrack(mesh(new THREE.BoxGeometry(7, 7, 7).translate(0, 3.5, 0), dieMats), p, o.s, o.u); d.rotateY(rnd(0, TAU)); world.add(d); }
        else if (o.kind === 'chip') for (let i = 0; i < (o.h || 3); i++) world.add(onTrack(mesh(new THREE.CylinderGeometry(3.8, 3.8, 1.9, 20).translate(0, 1 + i * 2, 0), chipMat(g.CHIP_COLS[(i + Math.round(o.s)) % g.CHIP_COLS.length])), p, o.s, o.u));
        else if (o.kind === 'bumper') {
          const m = onTrack(mesh(new THREE.CylinderGeometry(o.r, o.r, 6, 24).translate(0, 3, 0), BUMP[0]), p, o.s, o.u);
          world.add(m, onTrack(mesh(new THREE.CylinderGeometry(o.r * 0.6, o.r * 0.8, 1.5, 16).translate(0, 0.75, 0), IRON2), p, o.s, o.u));
          D.bumpers.push({ o, m });
        }
      }
      for (const sg of p.segs) {
        if (sg === p.gate) continue;
        const fa = frameAt(p, sg.as), A = new THREE.Vector3(fa.P[0] + fa.B[0] * sg.au, fa.P[1] + fa.B[1] * sg.au, fa.P[2] + fa.B[2] * sg.au);
        const fb = frameAt(p, sg.bs), Bv = new THREE.Vector3(fb.P[0] + fb.B[0] * sg.bu, fb.P[1] + fb.B[1] * sg.bu, fb.P[2] + fb.B[2] * sg.bu);
        const len = A.distanceTo(Bv), h = sg.wall ? 5 : 4, m = mesh(new THREE.BoxGeometry(len, h, sg.wall ? 1.6 : 2.4), sg.wall ? IRON2 : lam('#ff3b5c'));
        const dir = Bv.clone().sub(A).normalize(), up = new THREE.Vector3().fromArray(fa.N), side = new THREE.Vector3().crossVectors(dir, up).normalize();
        m.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(dir, up, side));
        m.position.copy(A).add(Bv).multiplyScalar(0.5).addScaledVector(up, h / 2);
        world.add(m);
        if (sg.sling) { const top = mesh(new THREE.BoxGeometry(len, 0.6, 2.6), lam('#ffe600')); top.quaternion.copy(m.quaternion); top.position.copy(m.position).addScaledVector(up, h / 2 + 0.3); world.add(top); }
      }
      if (p.gate) {
        const gate = onTrack(new THREE.Group(), p, p.gate.as, 0, 0);
        gate.add(mesh(new THREE.BoxGeometry(2, 5, K.W).translate(0, 2.5, 0), lam('#ff3b5c')));
        for (const sd of [-1, 1]) gate.add(mesh(new THREE.BoxGeometry(2.4, 12, 2.4).translate(0, 6, sd * (HW + 1.2)), IRON));
        world.add(gate); D.gate = gate;
      }
      for (const F of p.flips || []) {
        const base = onTrack(new THREE.Group(), p, F.ps, F.pu, 0), pivot = new THREE.Group(), sh = new THREE.Shape();
        sh.moveTo(0, 2); sh.lineTo(F.len + 1, 1); sh.lineTo(F.len + 1, -1); sh.lineTo(0, -2); sh.closePath();
        pivot.add(mesh(new THREE.ExtrudeGeometry(sh, { depth: 4, bevelEnabled: false }).rotateX(-Math.PI / 2), lam('#ff3b5c', { side: THREE.DoubleSide })));
        pivot.add(mesh(new THREE.CylinderGeometry(2.2, 2.2, 5, 12).translate(0, 2.5, 0), lam('#e9e6ff')));
        base.add(pivot); world.add(base); D.flippers.push({ F, pivot });
      }
      for (const Dm of p.doms) {
        const pieces = Dm.ds.map(s => { const hinge = onTrack(new THREE.Group(), p, s, Dm.side * (K.HW - 2.5)), tip = new THREE.Group(); tip.add(mesh(domGeo, domMat)); hinge.add(tip); world.add(hinge); return tip; });
        D.doms.push({ Dm, pieces });
      }
      for (const c of p.cones) { const grp = onTrack(new THREE.Group(), p, c.s, c.u), inner = new THREE.Group(); inner.add(mesh(coneGeo, coneMat), mesh(new THREE.BoxGeometry(5, 0.8, 5).translate(0, 0.4, 0), DARK)); grp.add(inner); world.add(grp); D.cones.push({ c, inner }); }
      // lamp posts beside it, their globes glowing
      for (const L of p.lamps) {
        const u = L.side * (HW + 4), lamp = beside(new THREE.Group(), p, L.s, u);
        lamp.add(mesh(new THREE.CylinderGeometry(0.6, 0.8, 20, 8).translate(0, 10, 0), DARK), mesh(new THREE.BoxGeometry(8, 0.8, 0.8).translate(0, 20, 0), DARK));
        for (const gx of [-3.5, 3.5]) { lamp.add(mesh(new THREE.SphereGeometry(1.7, 12, 8).translate(gx, 18.4, 0), glowing('#fff3c0'), false)); const s = glowSprite('#ffe9a0', 16, 0.75); s.position.set(gx, 18.4, 0); lamp.add(s); }
        world.add(lamp);
      }
    }
    // the funnels: glass bowls with brass rims
    for (const p of K.pieces) if (p.fun) {
      const F = p.fun, pts = [];
      for (let i = 0; i <= 14; i++) { const k = i / 14; pts.push(new THREE.Vector2(F.R * (1 - k) + 1.6 * k + 0.6, -F.H * k)); }
      const f = new THREE.Mesh(new THREE.LatheGeometry(pts, 40), GLASS); f.position.set(F.cx, F.cy, F.cz); f.renderOrder = 2; world.add(f);
      const rim = mesh(new THREE.TorusGeometry(F.R + 0.6, 0.7, 8, 40).rotateX(Math.PI / 2), BRASS); rim.position.set(F.cx, F.cy, F.cz); world.add(rim);
      const spout = mesh(new THREE.TorusGeometry(2.4, 0.6, 6, 16).rotateX(Math.PI / 2), BRASS); spout.position.set(F.cx, F.cy - F.H, F.cz); world.add(spout);
    }
    // the finish arch
    {
      const p = K.goalPiece, arch = onTrack(new THREE.Group(), p, K.finishS, 0, 0);
      for (const sd of [-1, 1]) arch.add(mesh(new THREE.BoxGeometry(2.4, 30, 2.4).translate(0, 15, sd * (HW + 2)), lam('#c9c8d8')));
      const bannerTex = canvasTex(80, 16, (x) => {
        for (let i = 0; i < 80; i += 2) for (const r of [0, 14]) { x.fillStyle = ((i / 2 + r / 2) & 1) ? '#fffaf0' : '#1f1830'; x.fillRect(i, r, 2, 2); }
        x.fillStyle = '#1f1830'; x.fillRect(0, 2, 80, 12);
        const t = g.textArt('FINISH', '#ffe600'); x.imageSmoothingEnabled = false; x.drawImage(t, Math.round(40 - t.width), 1, t.width * 2, t.height * 2);
      });
      // (the banner reads across the track, from both ways)
      const bm = new THREE.MeshBasicMaterial({ map: bannerTex });
      arch.add(mesh(new THREE.BoxGeometry(2, 8, K.W + 6).translate(0, 30, 0), [bm, bm, DARK, DARK, DARK, DARK]));
      world.add(arch);
    }
    // slot machines beside the track, facing it, with reels that spin and a lever that pulls
    for (const S of K.slots) {
      const cab = beside(new THREE.Group(), S.p, S.s, S.side * (HW + 16));
      cab.add(mesh(new THREE.BoxGeometry(31, 20, 12).translate(0, 10, 0), lam('#c4203e')));
      cab.add(mesh(new THREE.BoxGeometry(25, 8, 10).translate(0, 24, 0), [lam('#e8a020'), lam('#e8a020'), lam('#ffd84a'), lam('#e8a020'), new THREE.MeshBasicMaterial({ map: sevens }), lam('#e8a020')]));
      cab.add(mesh(new THREE.BoxGeometry(25, 9, 1).translate(0, 13.5, 6), DARK));
      const reels = [-8, 0, 8].map(rx => {
        cab.add(mesh(new THREE.CylinderGeometry(4, 4, 7, 16).rotateZ(Math.PI / 2).translate(rx, 13.5, 4.5), lam('#fffaf0'), false));
        const face = new THREE.Mesh(new THREE.PlaneGeometry(6, 7), new THREE.MeshBasicMaterial({ map: symTex[0], transparent: true })); face.position.set(rx, 13.5, 8.6); cab.add(face);
        return face;
      });
      const lever = new THREE.Group(); lever.position.set(17, 8, 0); cab.add(lever);
      lever.add(mesh(new THREE.CylinderGeometry(0.5, 0.5, 12, 8).translate(0, 6, 0), STEEL), mesh(new THREE.SphereGeometry(1.8, 12, 8).translate(0, 12, 0), shiny('#ff3b5c')));
      for (let i = 0; i < 12; i++) cab.add(mesh(new THREE.SphereGeometry(0.6, 6, 4).translate(-11 + i * 2, 28.3, 5), glowing('#fff3a8'), false));
      world.add(cab); D.slots.push({ S, reels, lever });
    }
    // gears turning beside the track
    for (let k = 0; k < 10; k++) {
      const p = K.pieces[1 + Math.floor(Math.random() * (K.pieces.length - 2))];
      if (p.kind === 'loop') continue;
      const r = rnd(7, 16), teeth = Math.max(6, Math.round(r * 0.8)), col = ['#4a4660', '#5a4a3a', '#3a4a5a'][k % 3];
      const holder = beside(new THREE.Group(), p, rnd(0, p.len), (Math.random() < 0.5 ? -1 : 1) * (HW + r + 8));
      const gear = mesh(new THREE.ExtrudeGeometry(gearShape(r, teeth), { depth: 2.5, bevelEnabled: true, bevelSize: 0.3, bevelThickness: 0.3, bevelSegments: 1 }), lam(col), false);
      gear.position.y = rnd(-12, 10); holder.add(gear); world.add(holder);
      D.cogs.push({ m: gear, sp: rnd(0.3, 0.9) * (k & 1 ? 1 : -1), ph: rnd(0, TAU) });
    }
    // dice, chips, coins, stars and hearts drifting slowly up all round
    if (CFG.decor) for (let i = 0; i < 50; i++) {
      const kind = i % 6, m = kind === 0 ? new THREE.Mesh(new THREE.BoxGeometry(6, 6, 6), dieMats)
        : kind === 1 ? new THREE.Mesh(new THREE.CylinderGeometry(4, 4, 1.2, 20).rotateX(Math.PI / 2), chipMat(g.CHIP_COLS[i % g.CHIP_COLS.length]))
        : kind === 2 ? new THREE.Mesh(new THREE.CylinderGeometry(3.5, 3.5, 0.9, 20).rotateX(Math.PI / 2), shiny('#ffd84a'))
        : new THREE.Mesh(new THREE.ExtrudeGeometry([starShape(), heartShape(), diamondShape()][kind - 3], { depth: 1.2, bevelEnabled: false }).center(), kind === 3 ? shiny('#ffd84a') : lam('#ff3b5c'));
      m.scale.setScalar(rnd(1.2, 2.4));
      m.position.set(rnd(K.lo[0] - 200, K.hi[0] + 200), rnd(K.lo[1], K.hi[1] + 150), rnd(K.lo[2] - 200, K.hi[2] + 200));
      world.add(m); D.decor.push({ m, vy: rnd(3, 8), spin: rnd(-1, 1), ph: rnd(0, 6.3), top: K.hi[1] + 200, bottom: ground });
    }

    // the ground: dark, with a faint neon grid
    const gtex = canvasTex(64, 64, (x) => { x.fillStyle = '#140c24'; x.fillRect(0, 0, 64, 64); x.fillStyle = 'rgba(255,59,208,0.14)'; x.fillRect(0, 0, 64, 1); x.fillRect(0, 0, 1, 64); }, true);
    gtex.repeat.set(140, 140);
    const gr = mesh(new THREE.CircleGeometry(5000, 64).rotateX(-Math.PI / 2), new THREE.MeshLambertMaterial({ map: gtex }), false); gr.receiveShadow = true;
    gr.position.y = ground; world.add(gr);
    scenery(ground);

    // the light, and its shadows, cover the whole course
    const cx = (K.lo[0] + K.hi[0]) / 2, cy = (K.lo[1] + K.hi[1]) / 2, cz = (K.lo[2] + K.hi[2]) / 2;
    const span = Math.max(K.hi[0] - K.lo[0], K.hi[2] - K.lo[2], K.hi[1] - K.lo[1]) * 0.75 + 60;
    sun.position.set(cx - 300, K.hi[1] + 700, cz + 400); sun.target.position.set(cx, cy, cz);
    Object.assign(sun.shadow.camera, { left: -span, right: span, top: span, bottom: -span, near: 50, far: 3000 });
    sun.shadow.camera.updateProjectionMatrix();
    if (!started) { started = true; const st = startView(); controls.target.copy(st.t); camera.position.copy(st.t).add(new THREE.Vector3(0, 0.55, 0.85).multiplyScalar(st.d)); }
  }
  const domGeo = new THREE.BoxGeometry(1.6, 7, 4).translate(0.8, 3.5, 0), domMat = new THREE.MeshLambertMaterial({ map: rowsTex([0, 1, 2, 3, 4, 5, 6].map(j => [j === 1 || j === 3 || j === 5 ? '#1f1830' : '#fffaf0'])) });
  const coneGeo = new THREE.ConeGeometry(2.4, 6, 12).translate(0, 3.6, 0), coneMat = new THREE.MeshLambertMaterial({ map: rowsTex([['#ff7a1a'], ['#ff7a1a'], ['#fffaf0'], ['#ff7a1a'], ['#fffaf0'], ['#ff7a1a']]) });
  const sevens = canvasTex(25, 8, (x) => { x.fillStyle = '#ffd84a'; x.fillRect(0, 0, 25, 8); x.drawImage(g.textArt('777', '#e8344e'), 1, 0); });
  const symTex = g.SYMS.map(k => canvasTex(7, 8, (x) => { x.fillStyle = '#fffaf0'; x.fillRect(0, 0, 7, 8); x.drawImage(g.spriteArt(k), 1, 1); }));
  function gearShape(r, teeth) {
    const sh = new THREE.Shape(), n = teeth * 4;
    for (let i = 0; i <= n; i++) { const a = i / n * TAU, rr = (i % 4 < 2) ? r + 1.4 : r - 0.6; i ? sh.lineTo(Math.cos(a) * rr, Math.sin(a) * rr) : sh.moveTo(Math.cos(a) * rr, Math.sin(a) * rr); }
    const hole = new THREE.Path(); hole.absarc(0, 0, Math.max(1.2, r * 0.25), 0, TAU, true); sh.holes.push(hole);
    if (r >= 8) for (let k = 0; k < 4; k++) {
      const w = new THREE.Path(), a0 = k / 4 * TAU + 0.25, a1 = (k + 1) / 4 * TAU - 0.25, r0 = r * 0.4, r1 = r * 0.75;
      w.absarc(0, 0, r1, a0, a1, false); w.lineTo(Math.cos(a1) * r0, Math.sin(a1) * r0); w.absarc(0, 0, r0, a1, a0, true); w.closePath(); sh.holes.push(w);
    }
    return sh;
  }
  function starShape() { const sh = new THREE.Shape(); for (let i = 0; i <= 10; i++) { const a = Math.PI / 2 + i / 10 * TAU, r = i % 2 ? 1.6 : 4; i ? sh.lineTo(Math.cos(a) * r, Math.sin(a) * r) : sh.moveTo(Math.cos(a) * r, Math.sin(a) * r); } return sh; }
  function heartShape() { const sh = new THREE.Shape(); sh.moveTo(0, -3.5); sh.bezierCurveTo(-5, 0, -3, 4, 0, 2); sh.bezierCurveTo(3, 4, 5, 0, 0, -3.5); return sh; }
  function diamondShape() { return new THREE.Shape([new THREE.Vector2(0, 4), new THREE.Vector2(3, 0), new THREE.Vector2(0, -4), new THREE.Vector2(-3, 0)]); }

  // ---- the sky: a night gradient with stars and a lit-up city painted along the horizon, a handful of
  // towers standing in front of it, and searchlights sweeping up from among them ----
  const skyTex = canvasTex(2048, 1024, (x, w, h) => {
    const gr = x.createLinearGradient(0, 0, 0, h);
    gr.addColorStop(0, '#05030c'); gr.addColorStop(0.35, '#120a2a'); gr.addColorStop(0.47, '#3a1850'); gr.addColorStop(0.5, '#ff6a8a'); gr.addColorStop(0.53, '#1a1030'); gr.addColorStop(1, '#0a0614');
    x.fillStyle = gr; x.fillRect(0, 0, w, h);
    for (let i = 0; i < 900; i++) { const y = Math.random() * h * 0.45; x.fillStyle = `rgba(255,255,255,${rnd(0.2, 0.9) * (1 - y / (h * 0.5))})`; x.fillRect(Math.random() * w, y, Math.random() < 0.1 ? 2 : 1, Math.random() < 0.1 ? 2 : 1); }
    // the city: rows of towers, darker in front, with lit windows and neon
    for (const [shade, top, n] of [['#24183c', 0.36, 160], ['#160f28', 0.42, 130]]) for (let i = 0; i < n; i++) {
      const bw = rnd(8, 26), bh = rnd(0.02, top < 0.4 ? 0.14 : 0.08) * h, bx = Math.random() * w, by = h * 0.5 - bh;
      x.fillStyle = shade; x.fillRect(bx, by, bw, bh);
      for (let yy = by + 3; yy < h * 0.5 - 2; yy += 4) for (let xx = bx + 2; xx < bx + bw - 2; xx += 3) if (Math.random() < 0.3) { x.fillStyle = ['#ffe9a0', '#fff3d0', '#bfe8ff'][Math.floor(Math.random() * 3)]; x.fillRect(xx, yy, 1, 2); }
      if (Math.random() < 0.15) { x.fillStyle = ['#ff3bd0', '#3ff8ff', '#ffe600'][Math.floor(Math.random() * 3)]; x.fillRect(bx + bw / 2, by + 4, 2, bh * 0.5); }
    }
  }, true);
  const sky = new THREE.Mesh(new THREE.SphereGeometry(6000, 48, 24), new THREE.MeshBasicMaterial({ map: skyTex, side: THREE.BackSide, depthWrite: false, fog: false }));
  sky.renderOrder = -1; scene.add(sky);
  function scenery(ground) {
    const cx = (K.lo[0] + K.hi[0]) / 2, cz = (K.lo[2] + K.hi[2]) / 2;
    const win = canvasTex(8, 8, (x) => { for (let j = 1; j < 8; j += 2) for (let i = 1; i < 8; i += 2) { x.fillStyle = Math.random() < 0.45 ? ['#ffe9a0', '#fff3d0', '#bfe8ff'][Math.floor(Math.random() * 3)] : '#000'; x.fillRect(i, j, 1, 1); } });
    for (let k = 0; k < 9; k++) {
      const a = k / 9 * TAU + rnd(-0.2, 0.2), d = rnd(1500, 2100), w = rnd(70, 140), h = rnd(300, 800), dd = rnd(70, 140);
      const geo = new THREE.BoxGeometry(w, h, dd), uv = geo.attributes.uv;
      for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * w / 18, uv.getY(i) * h / 18);
      const t = mesh(geo, new THREE.MeshLambertMaterial({ color: ['#2c2650', '#35295e', '#24304f', '#3a2448'][k % 4], emissive: 0xffffff, emissiveMap: win, emissiveIntensity: 0.6 }), false);
      t.position.set(cx + Math.cos(a) * d, ground + h / 2, cz + Math.sin(a) * d); t.lookAt(cx, ground + h / 2, cz); world.add(t);
    }
    // searchlights: narrow where they shine from, wide up in the sky
    D.beams = [0, 1, 2, 3].map(k => {
      const a = (k + 0.5) / 4 * TAU, beam = new THREE.Mesh(new THREE.ConeGeometry(70, 2400, 20, 1, true).rotateX(Math.PI).translate(0, 1200, 0),
        new THREE.MeshBasicMaterial({ color: 0xfff8d2, transparent: true, opacity: 0.05, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false }));
      beam.position.set(cx + Math.cos(a) * 1300, ground, cz + Math.sin(a) * 1300); world.add(beam);
      const lamp = glowSprite('#fff8d2', 60, 0.8); lamp.position.copy(beam.position); world.add(lamp);
      return beam;
    });
  }

  // ---------------- the balls ----------------
  // Glossy balls in each racer's chat color, with a white spot on each side bearing their initial (like a
  // pool ball), so you can see them roll.
  const balls = new Map();
  let tick = 0;
  function ballTex(w) {
    return canvasTex(128, 64, (x) => {
      x.fillStyle = w.pal.main; x.fillRect(0, 0, 128, 64);
      x.fillStyle = 'rgba(255,255,255,0.18)'; x.fillRect(0, 26, 128, 12);
      const ch = ([...w.name.replace(/^[^\p{L}\p{N}]+/u, '')][0] || '?').toUpperCase();
      for (const u of [32, 96]) {
        x.fillStyle = '#fffaf0'; x.beginPath(); x.ellipse(u, 32, 13, 15, 0, 0, TAU); x.fill();
        x.fillStyle = '#1f1830'; x.font = "700 20px 'Pixelify Sans', system-ui, sans-serif"; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText(ch, u, 33);
      }
    }, true);
  }
  const ballGeo = new THREE.SphereGeometry(RW, 28, 18);
  const wheelPos = (w, out) => out.set(w.x, -w.y, w.z || 0);
  const _axis = new THREE.Vector3(), _rq = new THREE.Quaternion(), _d = new THREE.Vector3(), _n = new THREE.Vector3();
  function syncBalls() {
    tick++;
    for (const w of g.live) {
      let o = balls.get(w);
      if (!o) {
        const tex = ballTex(w), body = mesh(ballGeo, new THREE.MeshPhongMaterial({ map: tex, shininess: 110, specular: 0x666666 }));
        body.quaternion.setFromEuler(new THREE.Euler(rnd(0, 6), rnd(0, 6), 0));
        const halo = glowSprite(w.pal.main, 15, 0.5), grp = new THREE.Group();
        grp.add(body, halo); scene.add(grp);
        o = { grp, body, halo, tex, last: wheelPos(w, new THREE.Vector3()) }; balls.set(w, o);
      }
      o.tick = tick;
      wheelPos(w, o.grp.position);
      // rolling: it turns about the axis across its way of travel (on the track, square to the track's
      // surface), as far as it went
      _d.copy(o.grp.position).sub(o.last);
      const d = _d.length();
      if (d > 1e-4 && d < 20) {
        if (w.m3 === 'track' && w.fr) _n.fromArray(w.fr.N); else _n.set(0, 1, 0);
        _axis.crossVectors(_n, _d);
        if (_axis.lengthSq() > 1e-8) o.body.quaternion.premultiply(_rq.setFromAxisAngle(_axis.normalize(), d / RW));
      }
      o.last.copy(o.grp.position);
    }
    for (const [w, o] of balls) if (o.tick !== tick) { scene.remove(o.grp); o.body.material.dispose(); o.tex.dispose(); o.halo.material.dispose(); balls.delete(w); }
  }

  // ---------------- the moving parts, particles and score popups ----------------
  let reelT = 0;
  function animate(t, dt) {
    const simT = g.simT, ct = g.C3.time();
    boostTex.offset.x -= dt * 6; beltTex.offset.x -= dt * 24;
    for (const { F, pivot } of D.flippers) {
      const ds = Math.sin(F.a), du = -F.side * Math.cos(F.a);
      pivot.rotation.y = Math.atan2(-du, ds);
    }
    if (D.gate) D.gate.visible = !K.doorsOpen;
    for (const { o, m } of D.bumpers) m.material = BUMP[o.lit > 0 ? 1 : 0];
    for (const { Dm, pieces } of D.doms) pieces.forEach((tip, i) => {
      // (tipping over on whichever bottom edge it's falling toward)
      const a = g.domAngle(Dm, i);
      tip.rotation.z = -a; tip.position.x = a < 0 ? 0 : 1.6; tip.children[0].position.x = a < 0 ? 0 : -1.6;
    });
    for (const { c, inner } of D.cones) inner.rotation.z = c.hit ? -c.dir * Math.min(Math.PI / 2, (ct - c.hit) * 8) : 0;
    for (const { m, sp, ph } of D.cogs) m.rotation.z = ph + t * sp;
    reelT += dt;
    for (const { S, reels, lever } of D.slots) {
      let spinning = false;
      S.reels.forEach((r, i) => {
        const spin = r.until > ct; spinning ||= spin;
        const tex = symTex[spin ? Math.floor(reelT * 14 + i * 2) % symTex.length : r.s];
        if (reels[i].material.map !== tex) { reels[i].material.map = tex; reels[i].material.needsUpdate = true; }
        reels[i].position.y = 13.5 + (spin ? Math.sin(reelT * 60 + i) * 0.5 : 0);
      });
      lever.rotation.x += ((spinning ? 0.9 : 0) - lever.rotation.x) * Math.min(1, dt * 10);
    }
    for (const d of D.decor) {
      d.m.position.y += d.vy * dt; d.m.rotation.y = t * d.spin + d.ph; d.m.rotation.x = Math.sin(t * 0.4 + d.ph) * 0.5;
      if (d.m.position.y > d.top) d.m.position.y = d.bottom;
    }
    D.beams.forEach((b, i) => { b.rotation.z = Math.sin(t * 0.3 + i * 1.9) * 0.45; b.rotation.x = Math.sin(t * 0.23 + i) * 0.35; });
    // sparks, smoke and fireworks, as little glowing squares
    let n = 0;
    const put = (x, y, z, col, a) => {
      if (n >= MAXP) return;
      PP[n * 3] = x; PP[n * 3 + 1] = -y; PP[n * 3 + 2] = z;
      const c = colorOf(col); PC[n * 3] = c.r * a; PC[n * 3 + 1] = c.g * a; PC[n * 3 + 2] = c.b * a; n++;
    };
    for (const q of g.parts) put(q.x, q.y, q.z ?? 0, q.c, 1);
    for (const s of g.FW.shells) if (s.wait <= 0) put(s.x, s.y, s.z ?? 0, '#fff3a8', 1);
    for (const q of g.FW.sparks) put(q.x, q.y, q.z ?? 0, q.c, Math.min(1, q.l / 0.6));
    pGeo.setDrawRange(0, n);
    pGeo.attributes.position.needsUpdate = pGeo.attributes.color.needsUpdate = true;
    // "+500", "JACKPOT", "1ST"…, about the same size on screen however close the camera is
    g.pops.forEach((q, i) => {
      let s = popSprites[i];
      if (!s) { s = new THREE.Sprite(new THREE.SpriteMaterial({ transparent: true, depthTest: false })); s.renderOrder = 5; scene.add(s); popSprites[i] = s; }
      const tex = textTex(q.text, q.c);
      if (s.material.map !== tex) { s.material.map = tex; s.material.needsUpdate = true; }
      s.position.set(q.x, -q.y, q.z ?? 0);
      const k = 0.9 * clamp(camera.position.distanceTo(s.position) / 600, 0.12, 1.5);
      s.scale.set(tex.image.width * k, tex.image.height * k, 1);
      s.material.opacity = Math.min(1, q.l / 0.4); s.visible = true;
    });
    for (let i = g.pops.length; i < popSprites.length; i++) popSprites[i].visible = false;
  }
  const MAXP = 6000, PP = new Float32Array(MAXP * 3), PC = new Float32Array(MAXP * 3), pGeo = new THREE.BufferGeometry();
  pGeo.setAttribute('position', new THREE.BufferAttribute(PP, 3)); pGeo.setAttribute('color', new THREE.BufferAttribute(PC, 3));
  const points = new THREE.Points(pGeo, new THREE.PointsMaterial({ size: 2, vertexColors: true, transparent: true, depthWrite: false }));
  points.frustumCulled = false; scene.add(points);
  const colors = new Map(), colorOf = c => { let v = colors.get(c); if (!v) { v = new THREE.Color(c); colors.set(c, v); } return v; };
  const popSprites = [], texts = new Map();
  function textTex(text, c) {
    const key = text + c;
    let t = texts.get(key);
    if (!t) {
      t = texOf(g.textArt(text, c));
      if (texts.size > 200) { const [k, old] = texts.entries().next().value; old.dispose(); texts.delete(k); }
      texts.set(key, t);
    }
    return t;
  }

  // ---------------- the camera ----------------
  const camEl = document.createElement('div'); camEl.id = 'cam'; document.body.appendChild(camEl);
  const cam = { mode: CFG.camera === 'overview' ? 'overview' : 'auto', key: null, dist: 90, userT: -1e9, zoomT: -1e9, leader: null };
  // Moving the camera yourself (orbiting, zooming or panning) puts it in manual: it stays where you leave
  // it until you pick something else (a racer to follow, auto, the whole course). Following a racer, it just
  // changes the angle and how close it follows.
  controls.addEventListener('start', () => { cam.userT = performance.now(); if (cam.mode !== 'follow' && cam.mode !== 'free') setMode('free'); });
  renderer.domElement.addEventListener('wheel', () => { cam.zoomT = cam.userT = performance.now(); }, { passive: true });
  const fitR = r => r / Math.sin(camera.fov * Math.PI / 360) * (camera.aspect < 1 ? 1 / camera.aspect : 1);
  const center = () => new THREE.Vector3((K.lo[0] + K.hi[0]) / 2, (K.lo[1] + K.hi[1]) / 2, (K.lo[2] + K.hi[2]) / 2);
  const wholeDist = () => fitR(Math.hypot(K.hi[0] - K.lo[0], K.hi[1] - K.lo[1], K.hi[2] - K.lo[2]) / 2) * 0.85;
  function startView() { const f = frameAt(K.start, 70); return { t: new THREE.Vector3(...f.P), d: 190 }; }
  function setMode(mode, w) {
    cam.mode = mode; cam.key = w ? w.key : null;
    if (w) cam.dist = 130;
    cam.userT = cam.zoomT = -1e9;
  }
  // a mod's "!cam …" from chat
  function command(arg) {
    const a = arg.toLowerCase().replace(/^@/, '');
    if (!a || a === 'auto') return setMode('auto');
    if (/^(all|overview|course|machine|whole)$/.test(a)) return setMode('overview');
    const ws = [...g.racers.values()];
    const w = ws.find(r => r.name.toLowerCase() === a) || ws.find(r => r.name.toLowerCase().startsWith(a)) || ws.find(r => r.name.toLowerCase().includes(a));
    if (w) setMode('follow', w);
  }
  const ray = new THREE.Raycaster(); let rayN = 0, clearAt = Infinity;
  const off = new THREE.Vector3(), want = new THREE.Vector3(), tmp = new THREE.Vector3(), chase = new THREE.Vector3();
  function leader() {
    let best = null;
    for (const w of g.live) if (!best || (w.dist || 0) > (best.dist || 0)) best = w;
    // (only change who's followed when someone's clearly ahead)
    if (cam.leader && g.live.includes(cam.leader) && best && (best.dist || 0) < (cam.leader.dist || 0) + 25) return cam.leader;
    return cam.leader = best;
  }
  const escape = s => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  // a spot behind and above a ball, looking along the way it's going
  function chaseFrom(w, dist) {
    const T = w.m3 === 'track' && w.fr ? w.fr.T : [w.vx || 1, w.vy || 0, w.vz || 0];
    const len = Math.hypot(T[0], T[2]) || 1;
    return chase.set(-T[0] / len * 0.8, 0.55, -T[2] / len * 0.8).normalize().multiplyScalar(dist);
  }
  function updateCamera(t, dt) {
    const now = performance.now();
    let target = null, dist = null, auto = false, label = '', behind = null;
    const finishPos = () => { const f = frameAt(K.goalPiece, K.finishS); return want.set(f.P[0], f.P[1] + 8, f.P[2]); };
    if (cam.mode === 'follow') {
      const w = g.racers.get(cam.key);
      if (!w) setMode('auto');
      else {
        target = w.mode === 'done' ? finishPos() : wheelPos(w, want);
        if (now - cam.zoomT < 400) cam.dist = camera.position.distanceTo(controls.target);
        dist = cam.dist;
        label = `FOLLOWING <b style="--c:${w.pal.main}">${escape(w.name)}</b>`;
      }
    }
    if (cam.mode === 'overview') { target = want.copy(center()); dist = wholeDist(); auto = true; label = 'WHOLE COURSE'; }
    else if (cam.mode === 'auto') {
      auto = true; label = 'AUTO';
      const st = g.state, win = g.winner;
      if (st === 'lobby' || st === 'count') { const s = startView(); target = want.copy(s.t); dist = s.d; }
      else if (st === 'race' && win && g.simT - g.raceT0 - win.time < 4) { target = finishPos(); dist = 110; label = 'AUTO · WINNER'; }
      else if (st === 'race') {
        const w = leader();
        if (w) { target = wheelPos(w, want); dist = 160; behind = chaseFrom(w, 160); label = `AUTO · LEADER <b style="--c:${w.pal.main}">${escape(w.name)}</b>`; }
      }
      else { target = want.copy(center()); dist = wholeDist(); }
    }
    controls.update();
    const k = 1 - Math.exp(-dt * 3);
    if (target) { tmp.copy(target).sub(controls.target).multiplyScalar(k); controls.target.add(tmp); camera.position.add(tmp); }
    off.copy(camera.position).sub(controls.target);
    if (behind) off.lerp(behind, k * 0.6);   // (chasing: swing round behind it)
    else if (dist) off.setLength(off.length() + (dist - off.length()) * k);
    if (auto && !behind) { const a = t * 0.05; off.lerp(tmp.set(Math.cos(a), 0.45, Math.sin(a)).normalize().multiplyScalar(dist || off.length()), k * 0.15); }   // (circling slowly)
    // following or chasing, it never ends up inside the track: if any's in the way between the ball and
    // the camera, it comes in closer, in front of it (looked for every few frames)
    if (cam.mode !== 'free' && cam.mode !== 'overview' && target && (++rayN % 3 === 0)) {
      ray.set(controls.target, tmp.copy(off).normalize()); ray.far = off.length();
      const hit = ray.intersectObjects(D.solid, false)[0];
      clearAt = hit && hit.distance > 6 ? hit.distance - 4 : hit ? 6 : Infinity;
    }
    if (cam.mode !== 'free' && cam.mode !== 'overview' && off.length() > clearAt) off.setLength(clearAt);
    camera.position.copy(controls.target).add(off);
    camera.lookAt(controls.target);
    if (cam.mode === 'free') label = 'MANUAL · double-click for auto';
    if (camEl.dataset.l !== label) { camEl.dataset.l = label; camEl.innerHTML = '🎥 ' + label; }
    camEl.classList.toggle('show', cam.mode === 'follow');
  }

  // where a ball is on screen, for its name and bubble
  const vp = new THREE.Vector3();
  function project(w) {
    wheelPos(w, vp); const x0 = vp.x, y0 = vp.y, z0 = vp.z;
    vp.project(camera);
    const vis = vp.z < 1 && vp.x > -1.15 && vp.x < 1.15 && vp.y > -1.15 && vp.y < 1.15;
    const x = (vp.x + 1) / 2 * innerWidth, y = (1 - vp.y) / 2 * innerHeight;
    vp.set(x0, y0 + RW, z0).project(camera);
    return { x, y, top: Math.min(y - 2, (1 - vp.y) / 2 * innerHeight), vis };
  }
  // clicking a racer follows them; double-clicking empty space goes back to auto
  const nearest = (mx, my) => {
    let best = null, bd = 34;
    for (const w of g.live) { const p = project(w), d = Math.hypot(p.x - mx, p.y - my); if (p.vis && d < bd) { bd = d; best = w; } }
    return best;
  };
  let down = null;
  renderer.domElement.addEventListener('pointerdown', e => { down = { x: e.clientX, y: e.clientY, t: performance.now() }; });
  renderer.domElement.addEventListener('pointerup', e => {
    if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 6 || performance.now() - down.t > 500 || e.button !== 0) return;
    const w = nearest(e.clientX, e.clientY);
    if (w) setMode('follow', w);
  });
  renderer.domElement.addEventListener('dblclick', e => { if (!nearest(e.clientX, e.clientY)) setMode('auto'); });
  addEventListener('keydown', e => {
    if (/^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName)) return;
    const k = e.key.toLowerCase();
    if (k === 'a') setMode('auto');
    else if (k === 'o') setMode('overview');
    else if (k === 'f') setMode('free');
    else if (k === 'arrowleft' || k === 'arrowright') {
      const ws = [...g.live].sort((p, q) => (q.dist || 0) - (p.dist || 0));
      if (!ws.length) return;
      const i = ws.findIndex(w => w.key === cam.key), n = ws.length;
      setMode('follow', ws[((i < 0 ? 0 : i + (k === 'arrowright' ? 1 : -1)) + n) % n]);
    }
  });

  addEventListener('resize', () => {
    renderer.setSize(innerWidth, innerHeight);
    camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
  });

  function render(t, dt) {
    if (g.K !== K) rebuild();
    syncBalls();
    animate(t, dt);
    updateCamera(t, dt);
    renderer.render(scene, camera);
  }

  return { render, project, command };
}
