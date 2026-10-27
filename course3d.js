// Ball Drop's 3D course (?view=3d): instead of the 2D view's stack of floors, one long, wide, continuous
// track snaking down through space, and the physics for the balls on it. view3d.js draws it; index.html
// runs the race (joining, starting, finishing) the same way for both views.
//
// The track is built like a turtle drawing: a start, then one piece after another, each carrying on from
// where the last left off: straights, banked turns, helixes spiralling down, corkscrew loops, jumps (a
// conveyor feeds the lip, so everyone flies the same way), glass funnels the balls spiral down through onto
// the track below, roulette wheels they spin round and settle into a pocket of, halfpipes they swing from
// wall to wall down, whack-a-mole fields of moles popping up, a pachinko slope of pins, a pinball table with bumpers, slingshots and flippers, posts
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
  // track width, half of it, the inside faces of its side rails, and how far across a ball's middle can go
  const W = 36, HW = W / 2, RAIL = HW - 1.2, UB = RAIL - RW;
  const EDGE = RAIL - 2.8;   // (where dominoes and cones stand along the edge: their middles, just inside the rail)
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

  // A piece that starts with a curve sweeping up behind it, like a quarter-pipe, so balls dropped onto
  // it (out of a funnel's spout) land in the dip and anything bouncing back rolls up the curve and returns.
  // It's placed so the bottom of the curve is right where the turtle is.
  const CURVE = 26;
  function catcher(len) {
    const pitch = s => s < CURVE ? -1.25 + (1.25 - 0.07) * smooth(s / CURVE) : -0.07;
    let dh = 0, dv = 0;
    for (let s = 0; s < CURVE; s += 0.25) { dh += Math.cos(pitch(s)) * 0.25; dv += Math.sin(pitch(s)) * 0.25; }
    const yaw = tur.yaw;
    tur = { x: tur.x - Math.cos(yaw) * dh, y: tur.y - dv, z: tur.z - Math.sin(yaw) * dh, yaw, pitch: -1.25 };
    return sweep('land', len + CURVE, f => [yaw, pitch(f * (len + CURVE)), 0], { catcher: true });
  }
  const straight = (len, pitch1, o = {}) => { const y0 = tur.yaw, p0 = tur.pitch; return sweep(o.kind || 'straight', len, f => [y0, ease(p0, pitch1, f * 2.5), 0], o); };
  // a banked turn (or, turning far enough and dropping steeply, a helix)
  function turn(angle, R, pitch1, o = {}) {
    const y0 = tur.yaw, p0 = tur.pitch, v = 90, bank = clamp(v * v / (G * R), 0, 0.6) * Math.sign(angle);
    return sweep(o.kind || 'turn', Math.abs(angle) * R, f => [y0 + angle * f, ease(p0, pitch1, f * 2), bank * Math.sin(Math.PI * f)], { turnSign: Math.sign(angle), ...o });
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

  // A halfpipe's cross-section: flat along the bottom, its walls curving up to nearly vertical at the sides;
  // at each end it eases out of (and back into) ordinary flat track. The height off the track at u, how
  // steep it is there and how fast that changes; and how far across a ball can go.
  const PIPE = { fb: 6, R: HW - 6, ramp: 30 };
  const pipeM = (p, s) => smooth(clamp(Math.min(s, p.len - s) / PIPE.ramp, 0, 1));
  function pipeH(p, s, u) {
    const m = pipeM(p, s), d = Math.abs(u) - PIPE.fb, R = PIPE.R;
    if (d <= 0 || m === 0) return [0, 0, 0];
    const q = Math.sqrt(Math.max(1e-4, R * R - Math.min(d, R) ** 2));
    return [m * (R - q), m * Math.sign(u) * d / q, m * R * R / (q * q * q)];
  }
  const ubAt = (p, s) => p.pipe ? UB + (PIPE.fb + PIPE.R * 0.92 - UB) * pipeM(p, s) : UB;

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
  function dominoes(p, a, side) {
    const nn = ri(7, 12), ds = Array.from({ length: nn }, (_, i) => a + i * 4);
    if (ds[nn - 1] > p.len - 4) return;
    p.doms.push({ ds, f: 1, start: -1, side, p });
  }
  // Rubber deflectors standing out from a rail at an angle: a ball rolling along the edge hits one and is
  // kicked back across the track, often into a bumper, die or chip stack standing just past it. On a turn
  // they're mostly on the outside, where balls get flung. Returns where they went, so nothing's put on top.
  function deflectors(p, every = [32, 55]) {
    const used = [];
    if (p.kind === 'loop' || p.len < 40) return used;
    for (let s = rnd(14, 26); s < p.len - 30; s += rnd(...every)) {
      if (p.regions.some(r => s + 30 > r.a && s - 4 < r.b) || p.obs.some(o => Math.abs(o.s - s - 15) < 20)) continue;
      const side = p.turnSign && Math.random() < 0.8 ? -p.turnSign : pick([-1, 1]);
      p.segs.push({ as: s, au: side * (RAIL - 1.4), bs: s + 11, bu: side * (RAIL - 8), e: 0.55, kick: 50, deflector: true });
      if (Math.random() < 0.65) {
        const k = pick(['bumper', 'die', 'chip', 'bumper']), r = k === 'bumper' ? 4.5 : k === 'die' ? 3.6 : 3.8, u = -side * rnd(0, fits(r));
        if (k === 'bumper') bumper(p, s + 24, u); else post(p, s + 24, u, r, k, { face: ri(1, 6), e: 0.4, h: ri(2, 4) });
      }
      used.push([s - 2, s + 30]);
    }
    return used;
  }
  function dress(p) {
    // deflectors kicking balls off the rails, dominoes and cones along the edges (where there aren't
    // deflectors), lamps beside it
    if (p.kind === 'loop' || p.len < 40) return;
    // (and nothing on top of boost pads or conveyors)
    const used = deflectors(p).concat(p.regions.map(r => [r.a, r.b])), clear = (a, b) => !used.some(([u0, u1]) => b > u0 && a < u1);
    const ds = rnd(6, Math.max(7, p.len - 60));
    if (Math.random() < 0.35 && clear(ds, ds + 50)) dominoes(p, ds, pick([-1, 1]));
    const s0 = rnd(6, p.len - 20);
    if (Math.random() < 0.3 && clear(s0, s0 + 26)) { const side = pick([-1, 1]); for (let k = 0; k < ri(2, 4); k++) p.cones.push({ s: s0 + k * 6, u: side * EDGE, hit: 0 }); }
    for (let s = rnd(10, 40); s < p.len - 5; s += rnd(60, 110)) p.lamps.push({ s, side: pick([-1, 1]) });
  }

  // ---- features: one or more pieces that carry on from the turtle ----
  const FEAT = { straight: 2, turn: 3, helix: 1.2, loop: 1.4, jump: 1.4, funnel: 1, roulette: 0.9, halfpipe: 1.1, moles: 1, plinko: 1.1, pinball: 1, posts: 1.6, lanes: 1.2 };
  function feature(kind) {
    const out = [];
    const add = p => { out.push(p); tur = p.after; return p; };
    if (kind === 'straight') { const p = add(straight(rnd(70, 140), -rnd(0.06, 0.12))); if (Math.random() < 0.4) p.regions.push({ a: p.len * 0.4, b: p.len * 0.4 + 14, boost: 165 }); dress(p); }
    else if (kind === 'turn') dress(add(turn(pick([-1, 1]) * rnd(0.9, 2.4), rnd(55, 95), -rnd(0.05, 0.1))));
    else if (kind === 'helix') deflectors(add(turn(pick([-1, 1]) * rnd(TAU * 0.9, TAU * 1.6), rnd(45, 60), -rnd(0.16, 0.22), { kind: 'helix' })), [45, 70]);
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
      // A big glass coin funnel, the track feeding in along its rim: it runs out over the bowl, round the
      // edge, and the balls roll off its end onto the glass already going round. From there it's all
      // physics (see stepFunnel): they circle the bowl, slowly losing speed, spiral down to the spout and
      // drop out of it onto the next piece below, which catches them in a curve.
      const lead = add(straight(60, -0.02));
      const R = 2 * HW + rnd(8, 14), rs = 2 * RW + 1, Hf = rnd(40, 52), yaw = tur.yaw, side = pick([-1, 1]);
      const re = R - HW - 4;   // (the track's middle, that far out from the funnel's)
      const cx = tur.x - Math.sin(yaw) * side * re, cz = tur.z + Math.cos(yaw) * side * re, cy = tur.y - 4;
      const F = { cx, cy, cz, R, rs, H: Hf, Kf: Hf / (R / rs - 1) };
      lead.end = 'funnel'; lead.fun = F;
      // (and nothing else is built through the bowl)
      lead.extra = [];
      for (let k = 0; k < 16; k++) for (const [rr, yy] of [[R, cy], [R * 0.55, cy - F.Kf * (R / (R * 0.55) - 1)], [rs, cy - Hf]]) lead.extra.push([cx + Math.cos(k / 16 * TAU) * rr, yy, cz + Math.sin(k / 16 * TAU) * rr]);
      tur = { x: cx, y: cy - Hf - 30, z: cz, yaw: Math.atan2(-cz, -cx) + rnd(-0.8, 0.8), pitch: 0 };
      lead.gapTo = out.length;
      dress(add(catcher(130)));
    } else if (kind === 'roulette') {
      // A roulette wheel, the track running out over it: the balls drop onto it, roll round the sloping ball
      // track till they've slowed enough to come down the number ring onto the spinning wheel, skip over
      // the frets between its pockets and settle in one. The bottom of each pocket is a trap door, which
      // opens under a ball that's settled on it; it falls through into a glass funnel under the wheel, which
      // spirals it down and out onto a catcher below. Red's a boost, green (0) a bigger one, black nothing.
      // It's all physics (see stepWheel).
      const lead = add(straight(60, -0.02));
      const R = 2 * HW + rnd(34, 38), yaw = tur.yaw, side = pick([-1, 1]), re = R - HW - 4, k = 0.32;
      const cx = tur.x - Math.sin(yaw) * side * re, cz = tur.z + Math.cos(yaw) * side * re, cy = tur.y - 4;
      // the ball track from the rim in to Rr; the number ring sloping down from there to the pockets, which
      // run from Rpo in to Rh; and inside them the cone in the middle
      const Rr = R - 12, Rpo = Rr - 6, Rh = Rpo - 9, yT = cy - k * (R - Rr), y0 = yT - 2.2;
      const F = { wheel: true, cx, cy, cz, R, Rr, Rpo, Rh, k, yT, y0, sN: (yT - y0) / (Rr - Rpo), rs: RW, H: 44, rot: rnd(0, TAU), om: 0.9 * pick([-1, 1]),
        dopen: new Float64Array(37), rest: new Float64Array(37), until: new Float64Array(37) };
      // the funnel under the wheel: its rim under the pockets (below the trap doors hanging open), its spout
      // far enough under for the catcher
      const ur = Rpo + 4, uy = y0 - 9, uh = uy - (cy - F.H), urs = 2 * RW + 1;
      F.under = { cx, cy: uy, cz, R: ur, rs: urs, H: uh, Kf: uh / (ur / urs - 1) };
      lead.end = 'funnel'; lead.fun = F;
      lead.extra = [];
      for (let k2 = 0; k2 < 24; k2++) for (const [rr, yy] of [[R + 4, cy], [Rr, y0], [ur * 0.5, uy - uh * 0.6], [urs, cy - F.H]]) lead.extra.push([cx + Math.cos(k2 / 24 * TAU) * rr, yy, cz + Math.sin(k2 / 24 * TAU) * rr]);
      tur = { x: cx, y: cy - F.H - 30, z: cz, yaw: Math.atan2(-cz, -cx) + rnd(-0.8, 0.8), pitch: 0 };
      lead.gapTo = out.length;
      dress(add(catcher(130)));
    } else if (kind === 'halfpipe') {
      // a U-shaped run that snakes gently, so the balls swing up one wall and across to the other
      const len = rnd(200, 260), waves = pick([1.5, 2, 2.5]), A = rnd(0.3, 0.42), y0 = tur.yaw, p0 = tur.pitch, pitch1 = -rnd(0.08, 0.12);
      add(sweep('halfpipe', len, f => [y0 + A * Math.sin(TAU * waves * f), ease(p0, pitch1, f * 2.5), 0], { pipe: true, style: 'pipe' }));
      add(straight(40, -0.06));
    } else if (kind === 'moles') {
      // whack-a-mole: rows of holes, two across then one in the middle, with moles popping up out of them
      const p = add(straight(rnd(130, 160), -0.12, { kind: 'moles' }));
      for (let s = 30, row = 0; s < p.len - 20; s += 13, row++) for (const u of row % 2 ? [0] : [-7.2, 7.2]) post(p, s, u, 3.2, 'mole', { e: 0.5, up: 0, next: rnd(0.3, 3), until: 0, rose: -9 });
      add(straight(30, -0.06));
    } else if (kind === 'plinko') {
      const p = add(straight(rnd(150, 190), -0.36, { kind: 'plinko' }));
      pins(p, 55, p.len - 12);
      add(straight(40, -0.06));
    } else if (kind === 'pinball') {
      const p = add(straight(160, -0.22, { kind: 'pinball' }));
      for (let s = rnd(45, 55); s < 112; s += rnd(18, 26)) bumper(p, s, rnd(-fits(4.5), fits(4.5)));
      // slingshots angled in from each side above the flippers, and the flippers themselves
      for (const sd of [-1, 1]) p.segs.push({ as: 118, au: sd * (RAIL - 1.4), bs: 132, bu: sd * (RAIL - 6.4), e: 0.9, kick: 70, sling: true });
      for (const sd of [-1, 1]) p.flips = (p.flips || []).concat({ p, ps: p.len - 16, pu: sd * (RAIL - 2.4), side: sd, len: 11, rest: 0.5, up: -0.55, a: 0.5, st: 0, next: rnd(0.4, 1.8) });
      add(straight(40, -0.06));
    } else if (kind === 'posts') {
      const p = add(straight(rnd(120, 170), -0.12, { kind: 'posts' }));
      for (let s = 30; s < p.len - 20; s += rnd(16, 26)) {
        const k = pick(['die', 'chip', 'bumper', 'die']), r = k === 'die' ? 3.6 : k === 'chip' ? 3.8 : 4.5, u = rnd(-fits(r), fits(r));
        if (k === 'bumper') bumper(p, s, u); else post(p, s, u, r, k, { face: ri(1, 6), e: 0.4, h: ri(2, 4) });
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
  const pointsOf = p => { const out = []; for (let i = 0; i < p.n; i += 2) out.push([p.P[i * 3], p.P[i * 3 + 1], p.P[i * 3 + 2]]); return out.concat(p.extra || []); };
  function clashes(ps) {
    for (const p of ps) for (const [x, y, z] of pointsOf(p)) {
      for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) {
        for (const e of grid.get(key(x + a * CELL, z + b * CELL)) || []) if (Math.abs(e[1] - y) < 42 && Math.hypot(e[0] - x, e[2] - z) < W + 8) return true;
      }
    }
    return false;
  }
  // (the last little bit of track is left out, so a piece doesn't clash with the one it carries on from)
  let pending = [];
  function remember(ps) {
    for (const p of ps) pending.push(...pointsOf(p));
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
    const goal = straight(150, -0.04, { kind: 'goal', style: 'track' }); tur = goal.after; place([goal]);
    for (const p of pieces) if (!p.landOn && p.end && p.gapTo == null) p.landOn = p.i + 1;

    // everything the views and the race need
    let lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    for (const p of pieces) for (let i = 0; i < p.n; i++) for (let j = 0; j < 3; j++) { lo[j] = Math.min(lo[j], p.P[i * 3 + j]); hi[j] = Math.max(hi[j], p.P[i * 3 + j]); }
    K = {
      three: true, stuck: {}, pieces, total, PIPE, moles: pieces.flatMap(p => p.obs.filter(o => o.kind === 'mole')), wheels: pieces.filter(p => p.fun?.wheel).map(p => p.fun), W, HW, RAIL, EDGE, RW, start: pieces[0], goalPiece: goal, finishS: 70, lo, hi,
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
    let b = w.u, n = RW;
    if (p.pipe) { const [h, h1] = pipeH(p, w.s, w.u), l = Math.hypot(1, h1); b -= h1 / l * RW; n = h + RW / l; }   // (up a halfpipe's wall, out from it square to it)
    w.X = f.P[0] + f.B[0] * b + f.N[0] * n; w.Y = f.P[1] + f.B[1] * b + f.N[1] * n; w.Z = f.P[2] + f.B[2] * b + f.N[2] * n;
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
    else if (w.rank) { w.vs *= 1 - 1.2 * dt; w.vu *= 1 - 1.2 * dt; }   // (home: rolling to a stop in the tray at the end)
    else if (!(p.noAssist && !racing)) {
      if (w.vs < MINV) w.vs += Math.min(MINV - w.vs, 240 * dt);
      else if (w.vs > MINV + 30) w.vs -= (w.vs - MINV) * 0.22 * dt;
    }
    if (p.pipe) { const [, h1, h2] = pipeH(p, w.s, w.u); au = (au - G * ROLL * f.N[1] * h1 - h1 * h2 * w.vu * w.vu) / (1 + h1 * h1); }
    w.vu += au * dt; w.vu *= 1 - (p.pipe ? 0.25 : 0.7) * dt;
    for (const r of p.regions) if (w.s >= r.a && w.s < r.b && (r.u0 == null || (w.u >= r.u0 && w.u <= r.u1))) {
      if (r.belt) { w.vs = r.belt; w.vu *= 1 - 4 * dt; }
      else if (r.boost && w.vs < r.boost) { w.vs = r.boost; if (!w.boostT) emit(w.X, -w.Y, 8, ['#3ff8ff', '#1a5cff', '#fff'], 40, 30, 100, undefined, w.Z); w.boostT = 0.8; }
    }
    const sp = Math.hypot(w.vs, w.vu); if (sp > VMAX) { w.vs *= VMAX / sp; w.vu *= VMAX / sp; }
    w.s += w.vs * dt; w.u += w.vu * dt;
    const ub = ubAt(p, w.s);
    if (Math.abs(w.u) > ub) { w.u = Math.sign(w.u) * ub; if (w.vu * w.u > 0) w.vu *= p.pipe ? 0 : -0.45; }
    for (const o of p.obs) if (Math.abs(o.s - w.s) < o.r + RW + 1) {
      if (o.kind === 'mole') {
        if (o.up < 0.4) continue;   // (down its hole)
        // just popped up under it: BONK, up in the air
        if (t - o.rose < 0.3 && racing && Math.hypot(w.s - o.s, w.u - o.u) < o.r + RW * 0.6 && t - (w.bonk ?? -9) > 1) { bonk(w, p, o); return; }
      }
      hitPost(w, o);
    }
    for (const sg of p.segs) if (sg.on !== false) hitSeg(w, sg);
    for (const F of p.flips || []) hitSeg(w, F.seg);
    if (racing) for (const D of p.doms) if (D.start < 0 && Math.abs(w.u - D.side * EDGE) < RW + 2) {
      const i = D.ds.findIndex(s => Math.abs(w.s - s) < RW); if (i >= 0) g.knockDominoes(D, i, { vx: w.vs });
    }
    for (const c of p.cones) if (!c.hit && Math.abs(w.s - c.s) < RW + 2 && Math.abs(w.u - c.u) < RW + 2) { c.hit = t; c.dir = Math.sign(w.vs) || 1; }
    for (const S of K.slots) if (S.p === p && Math.abs(w.s - S.s) < 3) spin(S, w);
    // off the end
    if (w.s >= p.len) {
      if (p.kind === 'goal' || w.pi === pieces.length - 1) { w.s = p.len - 0.01; w.vs = 0; }
      else if (p.end === 'air') { at(p, p.len, F1); toAir(w, F1); return; }
      else if (p.end === 'funnel') { place3(w); p.fun.wheel ? toWheel(w, p.fun) : toFunnel(w, p.fun); return; }
      else { w.s -= p.len; w.pi++; }
    } else if (w.s < 0) {
      const q = pieces[w.pi - 1];
      if (q && !q.end && q.kind !== 'start') { w.pi--; w.s += q.len; }
      else { w.s = 0; w.vs = Math.abs(w.vs) * 0.3; }
    }
    place3(w);
    w.dist = pieces[w.pi].s0 + w.s;
    if (racing && !w.rank && w.pi === K.goalPiece.i && w.s >= K.finishS) onFinish(w);
  }
  function bonk(w, p, o) {
    w.bonk = t; o.lit = 1;
    const f = at(p, w.s, F1);
    w.vs = Math.max(w.vs, 60) + 20; w.vu = w.vu * 0.5 + (w.u - o.u >= 0 ? 1 : -1) * rnd(4, 12);
    toAir(w, f); w.land = p.i;
    w.vx += f.N[0] * 75; w.vy += f.N[1] * 75; w.vz += f.N[2] * 75;
    emit(w.X, -w.Y, 10, ['#8a5a3a', '#e8d9b0', '#fff'], 40, 50, 160, undefined, w.Z);
    popup(w.X, -w.Y - 8, 'BONK', '#ffe600', w.Z);
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
    if (s >= p.len && !p.end && p.i + 1 < pieces.length) { w.land = p.i + 1; flat(w); return; }   // (flying on past it: down onto the next)
    if (h <= 0 && Math.abs(u) < HW + 8 && s > -14 && s < p.len) {
      w.m3 = 'track'; w.pi = p.i; w.s = clamp(s, 0, p.len - 0.1); w.u = clamp(u, -UB, UB);
      w.vs = w.vx * p.T[bi * 3] + w.vy * p.T[bi * 3 + 1] + w.vz * p.T[bi * 3 + 2];
      w.vu = w.vx * p.B[bi * 3] + w.vy * p.B[bi * 3 + 1] + w.vz * p.B[bi * 3 + 2];
      const vn = -(w.vx * p.N[bi * 3] + w.vy * p.N[bi * 3 + 1] + w.vz * p.N[bi * 3 + 2]);
      if (vn > 60) emit(w.X, -w.Y + RW, Math.min(14, 2 + vn / 18 | 0), ['#e8d9b0', '#b8a888', '#fff3a8'], 40, vn / 6, 220, undefined, w.Z);
      if (w.rBoost) { w.vs = Math.max(w.vs, w.rBoost); w.boostT = 1; w.rBoost = 0; }   // (red or green on a roulette wheel)
      place3(w); return;
    }
    if (w.Y < p.minY - 80) { note('missed ' + pieces[w.pi].kind + '>' + p.kind); w.m3 = 'track'; w.pi = p.i; w.s = 8; w.u = clamp(w.u || 0, -UB, UB); w.vs = MINV; w.vu = 0; w.warps++; place3(w); return; }
    flat(w);
  }
  // round and round a funnel, tighter and faster, then out of the spout
  // Into a funnel: from the end of the track the ball's moving round the bowl and a little in or out; its
  // place and speed become how far out it is (r) and round (th), how fast it's going in or out, and its
  // spin round the middle (L, angular momentum). It drops onto the glass from the end of the track first.
  const FUNNEL_DRAG = 0.55;   // (how fast rolling drag takes its speed round, so it spirals in)
  const bowlY = (F, r) => F.cy - F.Kf * (F.R / r - 1);
  const slope = (F, r) => F.Kf * F.R / (r * r), bend = (F, r) => -2 * F.Kf * F.R / (r * r * r);   // (how steep, and how fast that changes)
  function toFunnel(w, F) {
    const f = w.fr, rx = w.X - F.cx, rz = w.Z - F.cz, r = clamp(Math.hypot(rx, rz), F.rs + 1, F.R - RW - 0.6);
    const vx = f.T[0] * w.vs + f.B[0] * w.vu, vy = f.T[1] * w.vs + f.B[1] * w.vu, vz = f.T[2] * w.vs + f.B[2] * w.vu;
    Object.assign(w, { m3: 'funnel', F, frad: r, fth: Math.atan2(rz, rx), fvr: (vx * rx + vz * rz) / r, fL: (-rz * vx + rx * vz), fvh: vy });
    w.fh = Math.max(0, w.Y - bowlY(F, r) - RW);
    w.land = pieces[w.pi].landOn;
  }
  // Rolling on the inside of the bowl, a surface of revolution whose height at r is bowlY: nearly flat at the
  // rim, steeper and steeper toward the spout, like a coin funnel. Its spin round the middle is kept apart
  // from drag, which takes a little off it, so it circles lower and lower; in or out it's pulled down the
  // slope and flung out by going round.
  function stepFunnel(w, dt) {
    const F = w.F, r = w.frad, g = G * ROLL, hp = slope(F, r), hpp = bend(F, r), thd = w.fL / (r * r);
    let rdd;
    if (w.fh > 0) {   // still dropping onto the glass from the end of the track
      w.fvh -= G * dt; w.fh += w.fvh * dt;
      if (w.fh <= 0) { w.fh = 0; w.fvh = 0; }
      rdd = r * thd * thd;
    } else rdd = (r * thd * thd - g * hp - hp * hpp * w.fvr * w.fvr) / (1 + hp * hp);
    w.fvr += rdd * dt; w.fvr *= 1 - 0.3 * dt; w.fL *= 1 - FUNNEL_DRAG * dt;
    w.frad += w.fvr * dt; w.fth += thd * dt;
    if (w.frad > F.R - RW - 0.6) { w.frad = F.R - RW - 0.6; if (w.fvr > 0) w.fvr *= -0.35; }   // (the rim's lip)
    if (w.frad <= F.rs + 0.4) return spout(w);
    // the ball's middle: out from the glass, square to it
    const h1 = slope(F, w.frad), nl = Math.hypot(1, h1), out = w.frad - h1 / nl * RW;
    w.X = F.cx + Math.cos(w.fth) * out; w.Z = F.cz + Math.sin(w.fth) * out; w.Y = bowlY(F, w.frad) + RW / nl + w.fh;
    flat(w);
  }

  // out of the bottom of a funnel's spout
  function spout(w) {
    const F = w.F;
    Object.assign(w, { m3: 'air', X: F.cx + rnd(-0.5, 0.5), Y: F.cy - F.H - 2, Z: F.cz + rnd(-0.5, 0.5), vx: rnd(-6, 6), vy: -60, vz: rnd(-6, 6) });
    flat(w);
  }
  // ---- roulette wheels ----
  // A ball on one is how far out it is from the middle (r) and round (th), how fast in or out, its spin
  // round the middle (L), and the height of its bottom (wy). The surface is all one piece, round the middle:
  // the ball track sloping down from the rim, the number ring sloping more steeply down to the pockets, the
  // pockets' floors (their trap doors) flat, and the cone in the middle rising. The wheel itself (the number
  // ring in) turns, and a ball rolling on it is dragged along by it. The frets between the pockets are walls,
  // which a ball going fast enough across them skips over and a slow one bounces back off; once one's
  // settled in a pocket, its trap door opens and it falls through.
  const WHEEL = [0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23, 10, 5, 24, 16, 33, 1, 20, 14, 31, 9, 22, 18, 29, 7, 28, 12, 35, 3, 26];
  const REDS = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]), SLOT = TAU / 37;
  const pocketColor = n => n === 0 ? 'green' : REDS.has(n) ? 'red' : 'black';
  const HUB = 0.18, FRET = 0.2, FRET_H = 1.8;   // (the cone's slope; half a fret's thickness, and its height)
  const wheelH = (F, r) => r >= F.Rr ? F.yT + F.k * (r - F.Rr) : r >= F.Rpo ? F.y0 + F.sN * (r - F.Rpo) : r >= F.Rh ? F.y0 : F.y0 + HUB * (F.Rh - r);
  const wheelS = (F, r) => r >= F.Rr ? F.k : r >= F.Rpo ? F.sN : r >= F.Rh ? 0 : -HUB;
  const pocketAt = (F, th) => Math.round((((th - F.rot) % TAU) + TAU) % TAU / SLOT) % 37;
  function toWheel(w, F) {
    const f = w.fr, rx = w.X - F.cx, rz = w.Z - F.cz, r = clamp(Math.hypot(rx, rz), 1, F.R - RW - 0.6);
    const vx = f.T[0] * w.vs + f.B[0] * w.vu, vy = f.T[1] * w.vs + f.B[1] * w.vu, vz = f.T[2] * w.vs + f.B[2] * w.vu;
    Object.assign(w, { m3: 'wheel', F, frad: r, fth: Math.atan2(rz, rx), fvr: (vx * rx + vz * rz) / r, fL: (-rz * vx + rx * vz), wy: w.Y - RW, fvh: vy, air: true, hole: -1, onT: t });
    w.land = pieces[w.pi].landOn;
  }
  // The edges of a pocket's hole with its door open: the number ring sloping up outside it and the cone
  // inside it, and the corners where they meet the floor. A ball over the hole rests on them, and rolls off
  // them into it. (`overHole`: near enough that it's touching them, not the floor or the slopes further out.)
  const SO = RW * HUB / Math.hypot(HUB, 1);
  const overHole = (F, r, th) => r > F.Rh - SO && r < F.Rpo + RW * F.sN / Math.hypot(F.sN, 1) && F.dopen[pocketAt(F, th)] > 0.3;
  function holeEdges(w, F) {
    for (const [er, sd, sl] of [[F.Rpo, -1, F.sN], [F.Rh, 1, HUB]]) {
      const cyB = w.wy + RW, dr = w.frad - er, dy = cyB - F.y0;
      // the slope beyond the edge (a plane through the corner, rising away from the hole), or the corner itself
      const nl = Math.hypot(sl, 1), pr = sd * sl / nl, py = 1 / nl, dist = dr * pr + dy * py, rc = w.frad - pr * dist;
      let nr, ny, d;
      if ((rc - er) * -sd >= 0) { if (dist >= RW) continue; nr = pr; ny = py; d = dist; }
      else { d = Math.hypot(dr, dy); if (d >= RW || d < 1e-6) continue; nr = dr / d; ny = dy / d; }
      w.frad += nr * (RW - d); w.wy += ny * (RW - d);
      const vn = w.fvr * nr + w.fvh * ny; if (vn < 0) { w.fvr -= vn * nr; w.fvh -= vn * ny; }
    }
  }
  // The frets, solid: across one and up, a ball's kept out of it. Hitting one fast enough it rides up over
  // the top and skips across to the next pocket; slower, it bounces back off.
  function frets(w, F) {
    const r = w.frad;
    if (!(r > F.Rh - 1.4 && r < F.Rpo + 1.4 && w.wy < F.y0 + FRET_H && w.wy > F.y0 - 0.05)) return;
    const phi = wrap(w.fth - F.rot), fa = (Math.round(phi / SLOT - 0.5) + 0.5) * SLOT;
    const tx = r * Math.sin(wrap(phi - fa)), cyB = w.wy + RW, top = F.y0 + FRET_H;
    const qx = clamp(tx, -FRET, FRET), qy = Math.min(cyB, top);
    let dx = tx - qx, dy = cyB - qy, d = Math.hypot(dx, dy);
    if (d < 1e-6) { dx = Math.sign(tx) || 1; dy = 0; d = 1; w.fth = F.rot + fa + dx * (FRET + 0.01) / r; }   // (right in it: out the side it's on)
    if (d >= RW) return;
    const nx = dx / d, ny = dy / d, pen = RW - Math.min(d, RW);
    w.fth += nx * pen / r; w.wy += ny * pen;
    let v = w.fL / r - F.om * r;
    const vn = v * nx + w.fvh * ny;
    if (vn < 0) { v -= 1.3 * vn * nx; w.fvh -= 1.3 * vn * ny; w.fL = r * (F.om * r + v); }
    if (w.wy > wheelH(F, w.frad) + 0.01) w.air = true;
  }
  function stepWheel(w, dt) {
    const F = w.F, g = G * ROLL;
    let r = w.frad;
    const thd = w.fL / (r * r), through = w.wy < F.y0 - 0.05;
    const ground = (through || overHole(F, r, w.fth)) ? -Infinity : wheelH(F, r);
    if (w.air || w.wy > ground + 0.01) {
      // in the air (dropped onto it, skipping over a fret, or falling through a pocket): flying free, so
      // going round only carries it outward, and falling
      w.air = true;
      w.fvh -= G * dt; w.wy += w.fvh * dt;
      w.fvr += r * thd * thd * dt; w.frad += w.fvr * dt; w.fth += thd * dt;
      r = w.frad;
      const g2 = (through || overHole(F, r, w.fth)) ? -Infinity : wheelH(F, r);
      if (g2 === -Infinity) holeEdges(w, F);   // (over an open trap door, or through it: only its edges hold it up)
      if (w.wy <= g2) {   // down on it
        w.wy = g2; w.air = false;
        if (w.fvh < -40) { w.fvh *= -0.25; w.air = true; } else w.fvh = 0;
      }
    } else {
      // rolling on it: pulled down its slope and flung out by going round; on the wheel, dragged along by it
      const hp = wheelS(F, r);
      w.fvr += (r * thd * thd - g * hp) / (1 + hp * hp) * dt;
      if (r < F.Rr) {
        const k = 1 - Math.exp(-1.2 * dt), vt = w.fL / r, vs = F.om * r;
        w.fL = r * (vt + (vs - vt) * k); w.fvr *= 1 - k;
      } else { w.fL *= 1 - FUNNEL_DRAG * dt; w.fvr *= 1 - 0.3 * dt; }
      w.frad += w.fvr * dt; w.fth += w.fL / (r * r) * dt;
      r = w.frad;
      const g2 = overHole(F, r, w.fth) ? -Infinity : wheelH(F, r);
      if (g2 === -Infinity) w.air = true; else w.wy = g2;
    }
    if (w.frad > F.R - RW - 0.6) { w.frad = F.R - RW - 0.6; if (w.fvr > 0) w.fvr *= -0.35; }   // (the rim)
    if (w.frad < 1) { w.frad = 1; w.fvr = Math.abs(w.fvr); }
    r = w.frad;
    const vrelOf = () => w.fL / r - F.om * r, setVrel = v => { w.fL = r * (F.om * r + v); };
    if (w.wy < F.y0 - 0.05) {
      // going through a pocket's open trap door: kept inside the hole by its edges (the ring outside it, the
      // cone inside, and the frets either side, with the doors hanging down beside them)
      if (w.hole < 0) {
        w.hole = pocketAt(F, w.fth);
        const n = WHEEL[w.hole], c = pocketColor(n);
        w.rBoost = c === 'green' ? 230 : c === 'red' ? 160 : 0;
        popup(w.X, -w.Y - 8, n + ' ' + c.toUpperCase(), { green: '#3fdc7a', red: '#ff3b5c', black: '#e8e6f4' }[c], w.Z);
        if (c === 'green') emit(w.X, -w.Y, 24, ['#3fdc7a', '#ffd84a', '#fff'], 60, 80, 200, [0.5, 1.1], w.Z);
      }
      F.until[w.hole] = Math.max(F.until[w.hole], t + 0.5);   // (it stays open till it's gone)
      for (const [er, sd] of [[F.Rpo, -1], [F.Rh, 1]]) if ((w.frad - er) * sd <= 0) { w.frad = er + sd * 0.01; if (w.fvr * sd < 0) w.fvr = 0; }
      r = w.frad;
      const gap = SLOT / 2 - Math.asin(Math.min(1, (RW + FRET + 0.3) / r)), d = wrap(w.fth - F.rot - w.hole * SLOT);
      if (Math.abs(d) > gap) { w.fth = F.rot + w.hole * SLOT + Math.sign(d) * gap; setVrel(0); }
      // below the wheel: on into the funnel underneath
      if (w.wy < F.y0 - 7.5) {
        const U = F.under, r2 = clamp(w.frad, U.rs + 1, U.R - RW - 0.6);
        Object.assign(w, { m3: 'funnel', F: U, frad: r2, hole: -1 });
        w.fh = Math.max(0, w.wy - bowlY(U, r2));
        stepFunnel(w, 0); return;
      }
    } else if (r > F.Rh - 1.4 && r < F.Rpo + 1.4 && w.wy < F.y0 + FRET_H) {
      frets(w, F);
      // settled on a trap door: it opens
      if (!w.air && r < F.Rpo + 1 && r > F.Rh && Math.abs(vrelOf()) < 10) {
        const p = pocketAt(F, w.fth);
        F.rest[p] += 1.5 * dt;
        if (F.rest[p] > 0.8) { F.until[p] = t + 1.2; F.rest[p] = 0; }
      }
    }
    // (in case one never settles)
    if (t - w.onT > 40) { note('wheel'); Object.assign(w, { m3: 'funnel', F: F.under, frad: F.under.R * 0.6, fh: 0, fvh: 0, hole: -1 }); return; }
    w.X = F.cx + Math.cos(w.fth) * w.frad; w.Z = F.cz + Math.sin(w.fth) * w.frad; w.Y = w.wy + RW;
    flat(w);
  }

  // the flippers, swinging up now and then; the roulette wheels turning; and the start gate
  function movers(dt) {
    for (const F of K.wheels) {
      F.rot += F.om * dt;
      for (let i = 0; i < 37; i++) {
        F.rest[i] = Math.max(0, F.rest[i] - 0.5 * dt);
        F.dopen[i] = t < F.until[i] ? Math.min(1, F.dopen[i] + 5 * dt) : Math.max(0, F.dopen[i] - 2.5 * dt);
      }
    }
    for (const o of K.moles) {
      if (!o.until && t >= o.next) { o.until = t + rnd(0.7, 1.5); o.rose = t; }
      if (o.until && t < o.until) o.up = Math.min(1, o.up + 9 * dt);
      else { o.up = Math.max(0, o.up - 4 * dt); if (o.until && o.up === 0) { o.until = 0; o.next = t + rnd(0.8, 3.2); } }
      o.lit = Math.max(0, o.lit - 3 * dt);
    }
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
  // A ball rolling past a slot machine pulls its lever; on 7-7-7 it pays out, and that ball gets a boost.
  function spin(S, w) {
    if (S.reels.some(r => r.until > t)) return;
    S.who = w; S.pulled = t;
    const jackpot = Math.random() < 0.18;
    S.reels.forEach((r, i) => { r.until = t + 0.5 + i * 0.35; r.s = jackpot ? 0 : ri(0, SYMS.length - 1); });
    if (!jackpot && S.reels.every(r => r.s === 0)) S.reels[2].s = 1;
    if (jackpot) S.payAt = S.reels[2].until;
  }

  // Balls bump into each other in the world; on the track, what that does to them is along and across it.
  function pairs(ws) {
    // (balls right at a funnel's spout don't block each other: they just go through)
    const bumps = w => w.m3 === 'track' || w.m3 === 'air' || (w.m3 === 'funnel' && w.frad > w.F.rs + 3) || (w.m3 === 'wheel' && w.wy > w.F.y0 - 0.05);
    const round = w => w.m3 === 'funnel' || w.m3 === 'wheel';
    // (in a funnel, in or out is along the radius and round is across it)
    const radial = w => { const c = Math.cos(w.fth), sn = Math.sin(w.fth); return [c, sn, -sn, c]; };
    const vel = (w, o) => {
      if (w.m3 === 'track') { o[0] = w.vs * w.fr.T[0] + w.vu * w.fr.B[0]; o[1] = w.vs * w.fr.T[1] + w.vu * w.fr.B[1]; o[2] = w.vs * w.fr.T[2] + w.vu * w.fr.B[2]; }
      else if (round(w)) { const [cr, sr, ct, st] = radial(w), vt = w.fL / w.frad; o[0] = w.fvr * cr + vt * ct; o[1] = 0; o[2] = w.fvr * sr + vt * st; }
      else { o[0] = w.vx; o[1] = w.vy; o[2] = w.vz; }
      return o;
    };
    const nudge = (w, x, y, z, isVel) => {
      if (round(w)) {
        const [cr, sr, ct, st] = radial(w), dr = x * cr + z * sr, dt2 = x * ct + z * st;
        if (isVel) { w.fvr += dr; w.fL += w.frad * dt2; } else { w.frad = clamp(w.frad + dr, w.F.rs + 0.5, w.F.R - RW - 0.6); w.fth += dt2 / w.frad; }
      } else if (w.m3 === 'track') {
        const ds = x * w.fr.T[0] + y * w.fr.T[1] + z * w.fr.T[2], du = x * w.fr.B[0] + y * w.fr.B[1] + z * w.fr.B[2];
        if (isVel) { w.vs += ds; w.vu += du; } else { const ub = ubAt(pieces[w.pi], w.s); w.s += ds; w.u = clamp(w.u + du, -ub, ub); }
      } else if (isVel) { w.vx += x; w.vy += y; w.vz += z; } else { w.X += x; w.Y += y; w.Z += z; }
    };
    const va = [0, 0, 0], vb = [0, 0, 0];
    for (let i = 0; i < ws.length; i++) {
      const a = ws[i]; if (!bumps(a)) continue;
      for (let j = i + 1; j < ws.length; j++) {
        const b = ws[j]; if (!bumps(b)) continue;
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
    if (w.m3 !== 'track' || w.rank) return;
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
      else if (w.m3 === 'wheel') stepWheel(w, dt);
    }
    pairs(ws);
    for (const w of ws) if (w.m3 === 'wheel') { frets(w, w.F); w.X = w.F.cx + Math.cos(w.fth) * w.frad; w.Z = w.F.cz + Math.sin(w.fth) * w.frad; w.Y = w.wy + RW; flat(w); }   // (not pushed into one by another ball)
    for (const w of ws) if (w.m3 === 'track') { place3(w); w.dist = pieces[w.pi].s0 + w.s; }
    if (racing) for (const w of ws) watch(w, dt);
  }
  // effects that aren't physics: slot payouts, the dominoes standing back up
  function update(simT) {
    for (const S of K.slots) if (S.payAt && t >= S.payAt) {
      S.payAt = 0; S.won = t;
      const w = S.who;
      if (w && w.m3 === 'track') { w.vs = Math.max(w.vs, 200); w.boostT = 1.5; popup(w.X, -w.Y - 10, 'JACKPOT', '#ffd84a', w.Z); emit(w.X, -w.Y, 24, ['#ffd84a', '#fff3a8', '#e8a020'], 60, 80, 200, [0.5, 1.1], w.Z); }
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
  function boost(w) {
    if (w.m3 === 'track') w.vs = Math.min(VMAX, Math.max(w.vs, 0) + 80);
    else if (w.m3 === 'air') { w.vx *= 1.25; w.vz *= 1.25; }
    else if (w.m3 === 'funnel' || w.m3 === 'wheel') w.fL *= 1.3;
    emit(w.X, -w.Y, 12, ['#3ff8ff', '#1a5cff', '#fff'], 40, 40, 100, undefined, w.Z);
  }
  function open() { pieces[0].gate.on = false; K.doorsOpen = true; K.openT = t; }
  const time = () => t;

  return { build, spawn, open, step, update, time, at, fr, boost, W, HW };
}
