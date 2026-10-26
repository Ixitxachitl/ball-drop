// Ball Drop's 3D course (?view=3d): instead of the 2D view's stack of floors, one long, wide, continuous
// track snaking down through space, and the physics for the balls on it. view3d.js draws it; index.html
// runs the race (joining, starting, finishing) the same way for both views.
//
// The track is built like a turtle drawing: a start, then one piece after another, each carrying on from
// where the last left off: straights, banked turns, helixes spiralling down, corkscrew loops, jumps (a
// conveyor feeds the lip, so everyone flies the same way), glass funnels the balls spiral down through onto
// the track below, a pachinko slope of pins, a pinball table with bumpers, slingshots and flippers, posts
// of dice, chips and bumpers to weave between, and lane splits with something different down each side,
// then a finish arch. It turns back toward the middle before it wanders too far, and a piece that would run
// into track already there is built some other way.
//
// On the track a ball's position is how far along its piece it is (s) and how far across (u); gravity, the
// banking and the turns move it along and across, and the posts, bumpers, flippers and walls are all in that
// plane. Off a jump or out of a funnel it flies freely until it lands on the next piece. Balls bump into
// each other in the world. As in 2D, they always roll on at a little speed of their own, and one that's
// stuck gets a nudge, or a lift along the track.
const TAU = Math.PI * 2;

export function createCourse(g) {
  const { RW, G, emit, popup, onFinish, SYMS } = g;
  const rnd = (a, b) => a + Math.random() * (b - a), ri = (a, b) => Math.floor(rnd(a, b + 1)), pick = a => a[(Math.random() * a.length) | 0];
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v)), smooth = t => t * t * (3 - 2 * t);
  const ease = (a, b, t) => a + (b - a) * smooth(clamp(t, 0, 1));
  const wrap = a => Math.atan2(Math.sin(a), Math.cos(a));
  const W = 36, HW = W / 2, UB = HW - RW - 1.2;      // track width, half of it, how far across a ball's middle can go
  const MINV = 55, VMAX = 230, ROLL = 0.75;           // speed of its own, top speed, how much of gravity a rolling ball feels
  const BOUND = { x: 430, z: 300 }, TARGET = 2900;    // how far it wanders, and how long it is
  let K = null, tur = null, pieces = [], total = 0, grid = new Map(), t = 0;
  let style = 'track', styleRun = 0;

  // ---------------- building ----------------
  // every few pieces the track changes what it's made of
  function nextStyle() { if (--styleRun <= 0) { style = pick(['track', 'track', 'girder', 'rail', 'neon']); styleRun = ri(2, 4); } return style; }
  // A piece from a function of how far along it is (0..1) giving the heading, the pitch and the bank, in
  // steps of about 1.5. Stores each step's position (P), and its frame: along (T), up off the surface (N)
  // and across (B, = T × N).
  function sweep(kind, len, fn, o = {}) {
    const n = Math.max(3, Math.ceil(len / 1.5) + 1), ds = len / (n - 1);
    const P = new Float64Array(3 * n), T = new Float64Array(3 * n), N = new Float64Array(3 * n), B = new Float64Array(3 * n);
    let x = tur.x, y = tur.y, z = tur.z, lt = null, yaw = tur.yaw, pitch = tur.pitch;
    for (let i = 0; i < n; i++) {
      let bank;
      [yaw, pitch, bank] = fn(i / (n - 1));
      const tx = Math.cos(pitch) * Math.cos(yaw), ty = Math.sin(pitch), tz = Math.cos(pitch) * Math.sin(yaw);
      if (lt) { x += (lt[0] + tx) / 2 * ds; y += (lt[1] + ty) / 2 * ds; z += (lt[2] + tz) / 2 * ds; }
      lt = [tx, ty, tz];
      // up, square to the track, then tipped toward the inside of a turn by the bank
      let nx = -ty * tx, ny = 1 - ty * ty, nz = -ty * tz; const nl = Math.hypot(nx, ny, nz); nx /= nl; ny /= nl; nz /= nl;
      let bx = ty * nz - tz * ny, by = tz * nx - tx * nz, bz = tx * ny - ty * nx;
      if (bank) {
        const c = Math.cos(bank), s = Math.sin(bank);
        [nx, ny, nz] = [nx * c + bx * s, ny * c + by * s, nz * c + bz * s];
        [bx, by, bz] = [ty * nz - tz * ny, tz * nx - tx * nz, tx * ny - ty * nx];
      }
      P.set([x, y, z], i * 3); T.set([tx, ty, tz], i * 3); N.set([nx, ny, nz], i * 3); B.set([bx, by, bz], i * 3);
    }
    const p = finish({ kind, len, n, ds, P, T, N, B }, o);
    p.after = { x, y, z, yaw, pitch };
    return p;
  }
  function finish(p, o) {
    Object.assign(p, { obs: [], segs: [], regions: [], doms: [], cones: [], lamps: [], style: o.style || nextStyle() }, o);
    // how fast the track turns sideways at each step (for the pull outward in turns)
    p.kB = new Float64Array(p.n);
    for (let i = 0; i < p.n - 1; i++) {
      let k = 0;
      for (let j = 0; j < 3; j++) k += (p.T[(i + 1) * 3 + j] - p.T[i * 3 + j]) / p.ds * p.B[i * 3 + j];
      p.kB[i] = k;
    }
    p.kB[p.n - 1] = p.kB[p.n - 2];
    let lo = Infinity; for (let i = 0; i < p.n; i++) lo = Math.min(lo, p.P[i * 3 + 1]); p.minY = lo;
    return p;
  }

  const straight = (len, pitch1, o = {}) => { const y0 = tur.yaw, p0 = tur.pitch; return sweep(o.kind || 'straight', len, f => [y0, ease(p0, pitch1, f * 2.5), 0], o); };
  // a banked turn (or, turning far enough and dropping steeply, a helix)
  function turn(angle, R, pitch1, o = {}) {
    const y0 = tur.yaw, p0 = tur.pitch, v = 90, bank = clamp(v * v / (G * R), 0, 0.6) * Math.sign(angle);
    return sweep(o.kind || 'turn', Math.abs(angle) * R, f => [y0 + angle * f, ease(p0, pitch1, f * 2), bank * Math.sin(Math.PI * f)], o);
  }
  // A corkscrew loop of radius R: round a vertical circle, shifting sideways a track's width as it goes so
  // it comes out beside where it went in. On the inside of it, "up" off the track points at its middle.
  function loop(R, side) {
    const yaw = tur.yaw, F = [Math.cos(yaw), 0, Math.sin(yaw)], L = [-F[2], 0, F[0]], shift = (W + 10) * side, M = 2400;
    const pt = th => { const a = R * Math.sin(th), b = R * (1 - Math.cos(th)), c = shift * (th - Math.sin(th)) / TAU; return [tur.x + F[0] * a + L[0] * c, tur.y + b, tur.z + F[2] * a + L[2] * c]; };
    // (spaced evenly along it)
    const cum = [0]; let prev = pt(0);
    for (let k = 1; k <= M; k++) { const q = pt(k / M * TAU); cum.push(cum[k - 1] + Math.hypot(q[0] - prev[0], q[1] - prev[1], q[2] - prev[2])); prev = q; }
    const len = cum[M], n = Math.ceil(len / 1.5) + 1, ds = len / (n - 1);
    const P = new Float64Array(3 * n), T = new Float64Array(3 * n), N = new Float64Array(3 * n), B = new Float64Array(3 * n);
    for (let i = 0, k = 0; i < n; i++) {
      const s = i * ds; while (k < M - 1 && cum[k + 1] < s) k++;
      const th = (k + clamp((s - cum[k]) / Math.max(1e-9, cum[k + 1] - cum[k]), 0, 1)) / M * TAU;
      const q = pt(th);
      let tx = F[0] * R * Math.cos(th) + L[0] * shift * (1 - Math.cos(th)) / TAU, ty = R * Math.sin(th), tz = F[2] * R * Math.cos(th) + L[2] * shift * (1 - Math.cos(th)) / TAU;
      const tl = Math.hypot(tx, ty, tz); tx /= tl; ty /= tl; tz /= tl;
      const nx = -F[0] * Math.sin(th), ny = Math.cos(th), nz = -F[2] * Math.sin(th);
      P.set(q, i * 3); T.set([tx, ty, tz], i * 3); N.set([nx, ny, nz], i * 3);
      B.set([ty * nz - tz * ny, tz * nx - tx * nz, tx * ny - ty * nx], i * 3);
    }
    const p = finish({ kind: 'loop', len, n, ds, P, T, N, B }, { loopR: R, vmin: Math.sqrt(1.35 * G * R) });
    const e = pt(TAU);
    p.after = { x: e[0], y: e[1], z: e[2], yaw, pitch: 0 };
    return p;
  }

  // ---- what goes on the track ----
  const post = (p, s, u, r, kind, o = {}) => p.obs.push({ s, u, r, kind, e: 0.5, lit: 0, ...o });
  const bumper = (p, s, u) => post(p, s, u, 4.5, 'bumper', { kick: 95, e: 0.6 });
  // Nothing stands where a ball could be wedged between it and a rail: a ball always fits past every post on
  // both sides, or the post is set into the rail itself.
  const fits = r => UB - r - RW - 0.4;   // (the farthest across a post of radius r can stand)
  // A pachinko field: rows of chrome pins, two across then one in the middle, with now and then a bumper,
  // a die or a stack of chips in the middle instead.
  function pins(p, a, b) {
    for (let r = 0, s = a; s < b; r++, s += 13) {
      if (r & 1) {
        const roll = Math.random();
        if (roll < 0.15) bumper(p, s, 0);
        else post(p, s, rnd(-0.4, 0.4), roll < 0.3 ? 3.4 : 1.5, roll < 0.24 ? 'die' : roll < 0.3 ? 'chip' : 'pin', { face: ri(1, 6), e: 0.45 });
      } else for (const u of [-6.5, 6.5]) post(p, s, u + rnd(-0.3, 0.3), 1.5, 'pin', { e: 0.45 });
    }
  }
  // a bumper set into a rail, kicking balls back toward the middle
  const wallBumper = (p, s, side) => bumper(p, s, side * (HW - 1.5));
  function dominoes(p, a, side) {
    const nn = ri(7, 12), ds = Array.from({ length: nn }, (_, i) => a + i * 4);
    if (ds[nn - 1] > p.len - 4) return;
    p.doms.push({ ds, f: 1, start: -1, side, p });
  }
  function dress(p) {
    // dominoes and cones along the edges, lamps beside it
    if (p.kind === 'loop' || p.len < 40) return;
    if (Math.random() < 0.35) dominoes(p, rnd(6, Math.max(7, p.len - 60)), pick([-1, 1]));
    if (Math.random() < 0.3) { const s0 = rnd(6, p.len - 20), side = pick([-1, 1]); for (let k = 0; k < ri(2, 4); k++) p.cones.push({ s: s0 + k * 6, u: side * (HW - 3), hit: 0 }); }
    for (let s = rnd(10, 40); s < p.len - 5; s += rnd(60, 110)) p.lamps.push({ s, side: pick([-1, 1]) });
  }

  // ---- features: one or more pieces that carry on from the turtle ----
  const FEAT = { straight: 2, turn: 3, helix: 1.2, loop: 1.4, jump: 1.4, funnel: 1, plinko: 1.1, pinball: 1, posts: 1.6, lanes: 1.2 };
  function feature(kind) {
    const out = [];
    const add = p => { out.push(p); tur = p.after; return p; };
    if (kind === 'straight') { const p = add(straight(rnd(70, 140), -rnd(0.06, 0.12))); if (Math.random() < 0.4) p.regions.push({ a: p.len * 0.4, b: p.len * 0.4 + 14, boost: 165 }); dress(p); }
    else if (kind === 'turn') dress(add(turn(pick([-1, 1]) * rnd(0.9, 2.4), rnd(55, 95), -rnd(0.05, 0.1))));
    else if (kind === 'helix') add(turn(pick([-1, 1]) * rnd(TAU * 0.9, TAU * 1.6), rnd(45, 60), -rnd(0.16, 0.22), { kind: 'helix' }));
    else if (kind === 'loop') {
      const R = rnd(16, 22), lead = add(straight(60, 0, { kind: 'straight' }));
      lead.regions.push({ a: 20, b: 40, boost: 190 });
      add(loop(R, pick([-1, 1])));
      add(straight(40, -0.06));
    } else if (kind === 'jump') {
      // a conveyor up the lip throws everyone off at the same speed, so the landing's where it's expected
      const vd = 95, lip = add(straight(28, 0.3, { kind: 'lip' }));
      lip.regions.push({ a: 0, b: lip.len, belt: vd });
      lip.end = 'air';
      let x = tur.x, y = tur.y, z = tur.z, vx = vd * Math.cos(tur.pitch) * Math.cos(tur.yaw), vy = vd * Math.sin(tur.pitch), vz = vd * Math.cos(tur.pitch) * Math.sin(tur.yaw);
      const y0 = y, drop = rnd(16, 28), dt = 1 / 240, hist = [];
      for (let k = 0; k < 2400; k++) { vy -= G * dt; x += vx * dt; y += vy * dt; z += vz * dt; hist.push([x, y, z, vy]); if (vy < 0 && y < y0 - drop) break; }
      const q = hist[Math.max(0, hist.length - 1 - 14)], hs = Math.hypot(vx, vz);
      tur = { x: q[0], y: q[1] - 2.5, z: q[2], yaw: tur.yaw, pitch: Math.atan2(q[3], hs) };
      lip.gapTo = out.length;   // (the next piece)
      dress(add(straight(150, -0.07, { kind: 'land' })));
    } else if (kind === 'funnel') {
      // The track runs level up to the rim of a glass funnel wider than itself, standing just ahead of its
      // end and a little lower, so the balls roll off the end over the rim and drop in. Each goes round the
      // way it came in (to the left of the middle one way, to the right the other), spirals down, and drops
      // out of the spout onto the next piece below.
      const lead = add(straight(50, -0.02));
      const R = HW + rnd(6, 10), Hf = rnd(34, 46), yaw = tur.yaw;
      const cx = tur.x + Math.cos(yaw) * (R - 1), cz = tur.z + Math.sin(yaw) * (R - 1), cy = tur.y - 2;
      lead.end = 'funnel'; lead.fun = { cx, cy, cz, R, H: Hf };
      tur = { x: cx, y: cy - Hf - 34, z: cz, yaw: Math.atan2(-cz, -cx) + rnd(-0.8, 0.8), pitch: -0.1 };
      lead.gapTo = out.length;
      dress(add(straight(130, -0.07, { kind: 'land' })));
    } else if (kind === 'plinko') {
      const p = add(straight(rnd(150, 190), -0.36, { kind: 'plinko' }));
      pins(p, 55, p.len - 12);
      add(straight(40, -0.06));
    } else if (kind === 'pinball') {
      const p = add(straight(160, -0.22, { kind: 'pinball' }));
      for (let s = rnd(45, 55); s < 112; s += rnd(18, 26)) Math.random() < 0.5 ? bumper(p, s, rnd(-fits(4.5), fits(4.5))) : wallBumper(p, s, pick([-1, 1]));
      // slingshots angled in from each side above the flippers, and the flippers themselves
      for (const sd of [-1, 1]) p.segs.push({ as: 118, au: sd * (HW - 1), bs: 132, bu: sd * (HW - 6), e: 0.9, kick: 70, sling: true });
      for (const sd of [-1, 1]) p.flips = (p.flips || []).concat({ p, ps: p.len - 16, pu: sd * (HW - 1), side: sd, len: 12, rest: 0.5, up: -0.55, a: 0.5, st: 0, next: rnd(0.4, 1.8) });
      add(straight(40, -0.06));
    } else if (kind === 'posts') {
      const p = add(straight(rnd(120, 170), -0.12, { kind: 'posts' }));
      for (let s = 30; s < p.len - 20; s += rnd(16, 26)) {
        const k = pick(['die', 'chip', 'bumper', 'die', 'wall']), r = k === 'die' ? 3.6 : k === 'chip' ? 3.8 : 4.5, u = rnd(-fits(r), fits(r));
        if (k === 'wall') wallBumper(p, s, pick([-1, 1]));
        else if (k === 'bumper') bumper(p, s, u); else post(p, s, u, r, k, { face: ri(1, 6), e: 0.4, h: ri(2, 4) });
      }
      dress(p);
    } else if (kind === 'lanes') {
      // a wall down the middle: one side has a boost pad, the other a slow conveyor
      const p = add(straight(rnd(150, 180), -0.1, { kind: 'lanes' })), a = 25, b = p.len - 20, side = pick([-1, 1]);
      p.segs.push({ as: a, au: 0, bs: b, bu: 0, e: 0.4, wall: true });
      const lane = sd => sd < 0 ? { u0: -HW, u1: 0 } : { u0: 0, u1: HW };
      p.regions.push({ a: a + 10, b: a + 26, boost: 180, ...lane(side) });
      p.regions.push({ a: a + 20, b: b - 10, belt: 38, ...lane(-side) });
      add(straight(30, -0.06));
    }
    return out;
  }

  // ---- not running into track that's already there ----
  const CELL = 24, key = (x, z) => Math.floor(x / CELL) * 100003 + Math.floor(z / CELL);
  function clashes(ps) {
    for (const p of ps) for (let i = 0; i < p.n; i += 2) {
      const x = p.P[i * 3], y = p.P[i * 3 + 1], z = p.P[i * 3 + 2];
      for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) {
        for (const e of grid.get(key(x + a * CELL, z + b * CELL)) || []) if (Math.abs(e[1] - y) < 42 && Math.hypot(e[0] - x, e[2] - z) < W + 8) return true;
      }
    }
    return false;
  }
  // (the last little bit of track is left out, so a piece doesn't clash with the one it carries on from)
  let pending = [];
  function remember(ps) {
    for (const p of ps) for (let i = 0; i < p.n; i += 2) pending.push([p.P[i * 3], p.P[i * 3 + 1], p.P[i * 3 + 2]]);
    while (pending.length > 50) { const e = pending.shift(), k = key(e[0], e[2]); let l = grid.get(k); if (!l) grid.set(k, l = []); l.push(e); }
  }
  function place(ps) {
    for (const p of ps) { p.i = pieces.length; p.s0 = total; total += p.len; pieces.push(p); }
    for (const p of ps) if (p.gapTo != null) { p.landOn = ps[p.gapTo].i; }
    remember(ps);
  }

  function build() {
    pieces = []; total = 0; grid = new Map(); pending = []; styleRun = 0;
    tur = { x: -BOUND.x * 0.55, y: 0, z: -BOUND.z * 0.45, yaw: 0.25, pitch: -0.03 };
    // the start: a wide pen the balls wait in behind a gate
    const start = straight(130, -0.035, { kind: 'start', style: 'track', noAssist: true });
    start.gate = { as: 124, au: -HW, bs: 124, bu: HW, e: 0.2, on: true };
    start.segs.push(start.gate);
    tur = start.after; place([start]);
    const first = straight(40, -0.1); tur = first.after; place([first]);
    let last = '';
    while (total < TARGET) {
      // heading out too far: turn back toward the middle
      const toC = wrap(Math.atan2(-tur.z, -tur.x) - tur.yaw), far = Math.hypot(tur.x / BOUND.x, tur.z / BOUND.z);
      let kind = far > 0.6 && Math.abs(toC) > 0.7 ? 'steer' : pickW(FEAT);
      if (kind === last && kind !== 'turn') kind = 'turn';
      let ok = false;
      for (let tries = 0; tries < 7 && !ok; tries++) {
        const keep = tur, ps = kind === 'steer' ? [turn(Math.sign(toC) * clamp(Math.abs(toC) * rnd(1, 1.3), 1.2, Math.PI), rnd(55, 80), -rnd(0.07, 0.12))].map(p => (tur = p.after, p)) : feature(tries > 3 ? 'turn' : kind);
        if (!clashes(ps)) { place(ps); ok = true; last = kind; }
        else { tur = keep; tur = { ...keep, pitch: keep.pitch - 0.05 }; }
      }
      if (!ok) { const ps = [straight(60, -0.25)]; tur = ps[0].after; place(ps); }   // (dive steeply out of the way)
    }
    const goal = straight(110, -0.04, { kind: 'goal', style: 'track' }); tur = goal.after; place([goal]);
    for (const p of pieces) if (!p.landOn && p.end && p.gapTo == null) p.landOn = p.i + 1;

    // everything the views and the race need
    let lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    for (const p of pieces) for (let i = 0; i < p.n; i++) for (let j = 0; j < 3; j++) { lo[j] = Math.min(lo[j], p.P[i * 3 + j]); hi[j] = Math.max(hi[j], p.P[i * 3 + j]); }
    K = {
      three: true, stuck: {}, pieces, total, W, HW, start: pieces[0], goalPiece: goal, finishS: 70, lo, hi,
      flippers: pieces.flatMap(p => p.flips || []), doms: pieces.flatMap(p => p.doms), slots: [], bumpers: pieces.flatMap(p => p.obs.filter(o => o.kick)),
      // (what index.html's 2D bits look for, empty here)
      segs: [], hops: [], traps: [], bands: [], slats: [], cogs: [], doorsOpen: false, doorAng: 0, openT: -9, startY: 0, goal: { xa: 0, xb: 0, y: 0 },
    };
    // slot machines beside a few of the straights, spinning as balls go by
    for (const p of pieces) if (p.kind === 'straight' && p.len > 80 && Math.random() < 0.3)
      K.slots.push({ p, s: rnd(20, p.len - 20), side: pick([-1, 1]), payAt: 0, won: -9, reels: [0, 1, 2].map(() => ({ s: ri(0, SYMS.length - 1), until: 0 })) });
    return K;
  }
  function pickW(o) {
    let tt = 0; for (const k in o) tt += o[k];
    let r = Math.random() * tt;
    for (const k in o) if ((r -= o[k]) < 0) return k;
    return Object.keys(o)[0];
  }

  // (what needed help, for ?selftest)
  const note = k => { K.stuck[k] = (K.stuck[k] || 0) + 1; };

  // ---------------- physics ----------------
  // where s is on piece p, and its frame there
  function at(p, s, out) {
    const f = clamp(s / p.ds, 0, p.n - 1.0001), i = Math.floor(f), k = f - i;
    for (let j = 0; j < 3; j++) {
      out.P[j] = p.P[i * 3 + j] + (p.P[(i + 1) * 3 + j] - p.P[i * 3 + j]) * k;
      out.T[j] = p.T[i * 3 + j]; out.N[j] = p.N[i * 3 + j]; out.B[j] = p.B[i * 3 + j];
    }
    out.kB = p.kB[i];
    return out;
  }
  const fr = () => ({ P: [0, 0, 0], T: [0, 0, 0], N: [0, 0, 0], B: [0, 0, 0], kB: 0 });
  const F1 = fr();
  // the ball's place in the world, from where it is on its piece (index.html's y points down, so -Y)
  function place3(w) {
    const p = pieces[w.pi], f = at(p, w.s, w.fr ??= fr());
    w.X = f.P[0] + f.B[0] * w.u + f.N[0] * RW; w.Y = f.P[1] + f.B[1] * w.u + f.N[1] * RW; w.Z = f.P[2] + f.B[2] * w.u + f.N[2] * RW;
    w.x = w.X; w.y = -w.Y; w.z = w.Z;
  }
  const flat = w => { w.x = w.X; w.y = -w.Y; w.z = w.Z; };

  // a round post, pin or bumper on the track, in its (s, u) plane
  function hitPost(w, o) {
    const ds = w.s - o.s, du = w.u - o.u, R = o.r + RW, d2 = ds * ds + du * du;
    if (d2 >= R * R || d2 < 1e-9) return;
    const d = Math.sqrt(d2), ns = ds / d, nu = du / d;
    w.s = o.s + ns * R; w.u = o.u + nu * R;
    const vn = w.vs * ns + w.vu * nu;
    if (vn < 0) { w.vs -= (1 + o.e) * vn * ns; w.vu -= (1 + o.e) * vn * nu + rnd(-6, 6); }   // (never balanced on top of one)
    if (o.kick && t - (o.hitT || -9) > 0.05) {
      w.vs += ns * o.kick; w.vu += nu * o.kick; o.hitT = t;
      if (w.vs < 30) w.vs = rnd(30, 80);   // (and always on down the track)
      o.lit = 1;
      emit(w.X, -w.Y, 8, ['#ffe600', '#fff', '#ff3bd0'], 50, 50, 120, undefined, w.Z);
      popup(w.X, -w.Y - 8, '+' + pick([100, 250, 500]), '#ffe600', w.Z);
    }
  }
  // a wall, slingshot, flipper or gate: a line in the (s, u) plane, pushing the ball back to the side it came from
  function hitSeg(w, sg) {
    const ex = sg.bs - sg.as, ey = sg.bu - sg.au, L2 = ex * ex + ey * ey;
    if (L2 < 1e-9) return;
    const tt = clamp(((w.s - sg.as) * ex + (w.u - sg.au) * ey) / L2, 0, 1), qs = sg.as + ex * tt, qu = sg.au + ey * tt;
    let ns, nu;
    if (tt > 0 && tt < 1) {
      const len = Math.sqrt(L2), sideP = ex * (w.pu - sg.au) - ey * (w.ps - sg.as), sideN = ex * (w.u - sg.au) - ey * (w.s - sg.as);
      const sd = Math.sign(sideP) || Math.sign(sideN) || 1;
      ns = -ey / len * sd; nu = ex / len * sd;
      const dist = (w.s - qs) * ns + (w.u - qu) * nu;
      if (dist >= RW || dist < -2 * RW) return;
      w.s += ns * (RW - dist); w.u += nu * (RW - dist);
    } else {
      const ds = w.s - qs, du = w.u - qu, d2 = ds * ds + du * du;
      if (d2 >= RW * RW || d2 < 1e-9) return;
      const d = Math.sqrt(d2); ns = ds / d; nu = du / d;
      w.s = qs + ns * RW; w.u = qu + nu * RW;
      if (Math.abs(nu) < 0.15) w.vu += rnd(-10, 10);   // (never balanced on the end of one)
    }
    // (a flipper's surface is moving)
    let sv = 0, uv = 0;
    if (sg.spin) { sv = -sg.spin * (qu - sg.au); uv = sg.spin * (qs - sg.as); }
    const rs = w.vs - sv, ru = w.vu - uv, vn = rs * ns + ru * nu;
    if (vn < 0) { w.vs = rs - (1 + sg.e) * vn * ns + sv; w.vu = ru - (1 + sg.e) * vn * nu + uv; }
    if (sg.kick && t - (sg.hitT || -9) > 0.08) { w.vs += ns * sg.kick; w.vu += nu * sg.kick; sg.hitT = t; sg.lit = 1; emit(w.X, -w.Y, 6, ['#ffe600', '#fff', '#3ff8ff'], 40, 40, 140, undefined, w.Z); }
  }

  function stepTrack(w, dt, racing) {
    const p = pieces[w.pi], f = at(p, w.s, F1);
    w.ps = w.s; w.pu = w.u;
    // along: gravity (as a rolling ball feels it), and its own speed; across: the banking and the turns
    const as = -G * f.T[1] * ROLL;
    let au = -G * f.B[1] * ROLL - f.kB * w.vs * Math.abs(w.vs);
    w.vs += as * dt;
    if (p.loop || p.kind === 'loop') w.vs = Math.max(w.vs, p.vmin);
    else if (!(p.noAssist && !racing)) {
      if (w.vs < MINV) w.vs += Math.min(MINV - w.vs, 240 * dt);
      else if (w.vs > MINV + 30) w.vs -= (w.vs - MINV) * 0.22 * dt;
    }
    w.vu += au * dt; w.vu *= 1 - 0.7 * dt;
    for (const r of p.regions) if (w.s >= r.a && w.s < r.b && (r.u0 == null || (w.u >= r.u0 && w.u <= r.u1))) {
      if (r.belt) { w.vs = r.belt; w.vu *= 1 - 4 * dt; }
      else if (r.boost && w.vs < r.boost) { w.vs = r.boost; if (!w.boostT) emit(w.X, -w.Y, 8, ['#3ff8ff', '#1a5cff', '#fff'], 40, 30, 100, undefined, w.Z); w.boostT = 0.8; }
    }
    const sp = Math.hypot(w.vs, w.vu); if (sp > VMAX) { w.vs *= VMAX / sp; w.vu *= VMAX / sp; }
    w.s += w.vs * dt; w.u += w.vu * dt;
    if (Math.abs(w.u) > UB) { w.u = Math.sign(w.u) * UB; if (w.vu * w.u > 0) w.vu *= -0.45; }
    for (const o of p.obs) if (Math.abs(o.s - w.s) < o.r + RW + 1) hitPost(w, o);
    for (const sg of p.segs) if (sg.on !== false) hitSeg(w, sg);
    for (const F of p.flips || []) hitSeg(w, F.seg);
    if (racing) for (const D of p.doms) if (D.start < 0 && Math.abs(w.u - D.side * (HW - 2.5)) < RW + 2) {
      const i = D.ds.findIndex(s => Math.abs(w.s - s) < RW); if (i >= 0) g.knockDominoes(D, i, { vx: w.vs });
    }
    for (const c of p.cones) if (!c.hit && Math.abs(w.s - c.s) < RW + 2 && Math.abs(w.u - c.u) < RW + 2) { c.hit = t; c.dir = Math.sign(w.vs) || 1; }
    for (const S of K.slots) if (S.p === p && Math.abs(w.s - S.s) < 3) spin(S);
    // off the end
    if (w.s >= p.len) {
      if (p.kind === 'goal' || w.pi === pieces.length - 1) { w.s = p.len - 0.01; w.vs = 0; }
      else if (p.end === 'air') { at(p, p.len, F1); toAir(w, F1); return; }
      else if (p.end === 'funnel') { place3(w); toFunnel(w, p.fun); return; }
      else { w.s -= p.len; w.pi++; }
    } else if (w.s < 0) {
      const q = pieces[w.pi - 1];
      if (q && !q.end && q.kind !== 'start') { w.pi--; w.s += q.len; }
      else { w.s = 0; w.vs = Math.abs(w.vs) * 0.3; }
    }
    place3(w);
    w.dist = pieces[w.pi].s0 + w.s;
    if (racing && w.pi === K.goalPiece.i && w.s >= K.finishS) onFinish(w);
  }
  function toAir(w, f) {
    w.m3 = 'air';
    w.vx = w.vs * f.T[0] + w.vu * f.B[0]; w.vy = w.vs * f.T[1] + w.vu * f.B[1]; w.vz = w.vs * f.T[2] + w.vu * f.B[2];
    w.land = pieces[w.pi].landOn;
  }
  // a ball in the air: falling until it comes down on the piece it's flying to
  function stepAir(w, dt) {
    w.vy -= G * dt; w.X += w.vx * dt; w.Y += w.vy * dt; w.Z += w.vz * dt;
    const p = pieces[w.land];
    let best = 1e9, bi = 0;
    for (let i = 0; i < p.n; i += 2) { const d = (p.P[i * 3] - w.X) ** 2 + (p.P[i * 3 + 2] - w.Z) ** 2; if (d < best) { best = d; bi = i; } }
    const dx = w.X - p.P[bi * 3], dy = w.Y - p.P[bi * 3 + 1], dz = w.Z - p.P[bi * 3 + 2];
    const h = dx * p.N[bi * 3] + dy * p.N[bi * 3 + 1] + dz * p.N[bi * 3 + 2] - RW;
    const u = dx * p.B[bi * 3] + dy * p.B[bi * 3 + 1] + dz * p.B[bi * 3 + 2];
    const s = bi * p.ds + dx * p.T[bi * 3] + dy * p.T[bi * 3 + 1] + dz * p.T[bi * 3 + 2];
    if (h <= 0 && Math.abs(u) < HW + 8 && s > -14 && s < p.len) {
      w.m3 = 'track'; w.pi = p.i; w.s = clamp(s, 0, p.len - 0.1); w.u = clamp(u, -UB, UB);
      w.vs = w.vx * p.T[bi * 3] + w.vy * p.T[bi * 3 + 1] + w.vz * p.T[bi * 3 + 2];
      w.vu = w.vx * p.B[bi * 3] + w.vy * p.B[bi * 3 + 1] + w.vz * p.B[bi * 3 + 2];
      const vn = -(w.vx * p.N[bi * 3] + w.vy * p.N[bi * 3 + 1] + w.vz * p.N[bi * 3 + 2]);
      if (vn > 60) emit(w.X, -w.Y + RW, Math.min(14, 2 + vn / 18 | 0), ['#e8d9b0', '#b8a888', '#fff3a8'], 40, vn / 6, 220, undefined, w.Z);
      place3(w); return;
    }
    if (w.Y < p.minY - 80) { note('missed ' + pieces[w.pi].kind + '>' + p.kind); w.m3 = 'track'; w.pi = p.i; w.s = 8; w.u = clamp(w.u || 0, -UB, UB); w.vs = MINV; w.vu = 0; w.warps++; place3(w); return; }
    flat(w);
  }
  // round and round a funnel, tighter and faster, then out of the spout
  function toFunnel(w, F) {
    w.m3 = 'funnel'; w.F = F; w.fk = 0; w.fth = Math.atan2(w.Z - F.cz, w.X - F.cx); w.fr0 = clamp(Math.hypot(w.X - F.cx, w.Z - F.cz), 3, F.R - RW); w.fv = Math.max(60, w.vs);
    w.fy0 = w.Y;
    // round the way it was heading across: which side of the middle it came in on
    const f = w.fr, rx = w.X - F.cx, rz = w.Z - F.cz, vx = f.T[0] * w.vs + f.B[0] * w.vu, vz = f.T[2] * w.vs + f.B[2] * w.vu;
    w.fdir = Math.sign(rx * vz - rz * vx) || (w.u >= 0 ? 1 : -1);
    w.land = pieces[w.pi].landOn;
  }
  const FUNNEL_TIME = 2.2;
  function stepFunnel(w, dt) {
    const F = w.F, k = Math.min(1, (w.fk += dt / FUNNEL_TIME)), r = w.fr0 * (1 - k) + 1.6 * k, v = Math.min(200, w.fv + 70 * k);
    w.fth += w.fdir * v / Math.max(r, 3) * dt;
    // riding the inside of the bowl at that radius (dropping onto it from the end of the track at first)
    const surf = F.cy - F.H * clamp((F.R - r) / (F.R - 1.6), 0, 1) + RW;
    w.X = F.cx + Math.cos(w.fth) * r; w.Z = F.cz + Math.sin(w.fth) * r; w.Y = surf + (w.fy0 - surf) * Math.max(0, 1 - k * 6);
    if (k >= 1) { w.m3 = 'air'; w.vx = rnd(-8, 8); w.vy = -50; w.vz = rnd(-8, 8); w.Y = F.cy - F.H - 2; }
    flat(w);
  }

  // the flippers, swinging up now and then; and the start gate
  function movers(dt) {
    for (const F of K.flippers) {
      if (F.st === 0 && t >= F.next) F.st = 1;
      const was = F.a;
      if (F.st === 1) { F.a = Math.max(F.up, F.a - 15 * dt); if (F.a === F.up) { F.st = 2; F.hold = t + 0.12; } }
      else if (F.st === 2) { if (t > F.hold) F.st = 3; }
      else if (F.st === 3) { F.a = Math.min(F.rest, F.a + 6 * dt); if (F.a === F.rest) { F.st = 0; F.next = t + rnd(0.5, 2.2); } }
      // pointing in from its side and down the table at rest; up the table when it flicks
      const ds = Math.sin(F.a), du = -F.side * Math.cos(F.a);
      F.seg ??= { e: 0.3 };
      Object.assign(F.seg, { as: F.ps, au: F.pu, bs: F.ps + ds * F.len, bu: F.pu + du * F.len, spin: -F.side * (F.a - was) / dt });
    }
  }
  function spin(S) {
    if (S.reels.some(r => r.until > t)) return;
    const jackpot = Math.random() < 0.18;
    S.reels.forEach((r, i) => { r.until = t + 0.5 + i * 0.35; r.s = jackpot ? 0 : ri(0, SYMS.length - 1); });
    if (!jackpot && S.reels.every(r => r.s === 0)) S.reels[2].s = 1;
    if (jackpot) S.payAt = S.reels[2].until;
  }

  // Balls bump into each other in the world; on the track, what that does to them is along and across it.
  function pairs(ws) {
    const vel = (w, o) => w.m3 === 'track' ? (o[0] = w.vs * w.fr.T[0] + w.vu * w.fr.B[0], o[1] = w.vs * w.fr.T[1] + w.vu * w.fr.B[1], o[2] = w.vs * w.fr.T[2] + w.vu * w.fr.B[2], o) : (o[0] = w.vx, o[1] = w.vy, o[2] = w.vz, o);
    const nudge = (w, x, y, z, isVel) => {
      if (w.m3 === 'track') {
        const ds = x * w.fr.T[0] + y * w.fr.T[1] + z * w.fr.T[2], du = x * w.fr.B[0] + y * w.fr.B[1] + z * w.fr.B[2];
        if (isVel) { w.vs += ds; w.vu += du; } else { w.s += ds; w.u = clamp(w.u + du, -UB, UB); }
      } else if (isVel) { w.vx += x; w.vy += y; w.vz += z; } else { w.X += x; w.Y += y; w.Z += z; }
    };
    const va = [0, 0, 0], vb = [0, 0, 0];
    for (let i = 0; i < ws.length; i++) {
      const a = ws[i]; if (a.m3 !== 'track' && a.m3 !== 'air') continue;
      for (let j = i + 1; j < ws.length; j++) {
        const b = ws[j]; if (b.m3 !== 'track' && b.m3 !== 'air') continue;
        const dx = b.X - a.X, dy = b.Y - a.Y, dz = b.Z - a.Z;
        if (dx > 8 || dx < -8 || dy > 8 || dy < -8 || dz > 8 || dz < -8) continue;
        const d2 = dx * dx + dy * dy + dz * dz; if (d2 >= 4 * RW * RW || d2 < 1e-6) continue;
        const d = Math.sqrt(d2), nx = dx / d, ny = dy / d, nz = dz / d, push = Math.min(1.2, (2 * RW - d) / 2);
        nudge(a, -nx * push, -ny * push, -nz * push); nudge(b, nx * push, ny * push, nz * push);
        vel(a, va); vel(b, vb);
        const vn = (vb[0] - va[0]) * nx + (vb[1] - va[1]) * ny + (vb[2] - va[2]) * nz;
        if (vn < 0) { const im = -1.4 * vn / 2; nudge(a, -im * nx, -im * ny, -im * nz, true); nudge(b, im * nx, im * ny, im * nz, true); }
      }
    }
  }

  // A ball that's barely moving gets a nudge; one that hasn't got further along for a while is lifted on.
  function watch(w, dt) {
    if (w.m3 !== 'track') return;
    if (Math.abs(w.vs) < 8) w.idle += dt; else w.idle = Math.max(0, w.idle - 2 * dt);
    if (w.idle > 1.2) { w.idle = 0; w.kicks++; note('kick ' + pieces[w.pi].kind); w.vs = 90; w.vu = rnd(-30, 30); }
    if (w.dist > (w.best ?? -1) + 3) { w.best = w.dist; w.prog = t; }
    else if (t - w.prog > 8) { note('lift ' + pieces[w.pi].kind); w.s += 30; w.prog = t; w.warps++; if (w.s >= pieces[w.pi].len && pieces[w.pi].end) { w.s = 2; w.pi = pieces[w.pi].landOn; } }
  }

  function step(ws, dt, racing) {
    t += dt;
    movers(dt);
    for (const w of ws) {
      if (w.m3 === 'track') stepTrack(w, dt, racing);
      else if (w.m3 === 'air') stepAir(w, dt);
      else if (w.m3 === 'funnel') stepFunnel(w, dt);
    }
    pairs(ws);
    for (const w of ws) if (w.m3 === 'track') { place3(w); w.dist = pieces[w.pi].s0 + w.s; }
    if (racing) for (const w of ws) watch(w, dt);
  }
  // effects that aren't physics: slot payouts, the dominoes standing back up
  function update(simT) {
    for (const S of K.slots) if (S.payAt && t >= S.payAt) {
      S.payAt = 0; S.won = t;
      const f = at(S.p, S.s, fr()), x = f.P[0] + f.B[0] * S.side * (HW + 16), y = f.P[1] + 30, z = f.P[2] + f.B[2] * S.side * (HW + 16);
      emit(x, -y, 28, ['#ffd84a', '#fff3a8', '#e8a020'], 60, 120, 260, [0.6, 1.3], z);
      popup(x, -y - 10, 'JACKPOT', '#ffd84a', z);
    }
    for (const D of K.doms) if (D.start >= 0 && simT > D.start + D.ds.length * 0.06 + 4.6) D.start = -1;
    for (const p of pieces) for (const c of p.cones) if (c.hit && t - c.hit > 5) c.hit = 0;
  }

  // New racers drop into the starting pen from above, anywhere in it.
  function spawn(w) {
    const p = pieces[0], s = rnd(10, 115), u = rnd(-UB, UB), f = at(p, s, fr());
    Object.assign(w, { m3: 'air', land: 0, X: f.P[0] + f.B[0] * u, Y: f.P[1] + rnd(20, 60), Z: f.P[2] + f.B[2] * u, vx: 0, vy: 0, vz: 0,
      pi: 0, s, u, vs: 0, vu: 0, ps: s, pu: u, idle: 0, best: -1, prog: t, dist: 0, mode: 'free' });
    flat(w);
  }
  function open() { pieces[0].gate.on = false; K.doorsOpen = true; K.openT = t; }
  const time = () => t;

  return { build, spawn, open, step, update, time, at, fr, W, HW };
}
