// Ball Drop's 3D course (?view=3d): instead of the 2D view's stack of floors, one long, wide, continuous
// track snaking down through space, and the physics for the balls on it. view3d.js draws it; index.html
// runs the race (joining, starting, finishing) the same way for both views.
//
// The track is built like a turtle drawing: a start, then one piece after another, each carrying on from
// where the last left off: straights, banked turns, helixes spiralling down, corkscrew loops, jumps (a
// conveyor feeds the lip, so everyone flies the same way), glass funnels the balls spiral down through onto
// the track below, roulette wheels they spin round and settle into a pocket of, halfpipes they swing from
// wall to wall down, whack-a-mole fields of moles popping up, spinning turnstiles, paddle wheels, hammers
// swinging across, see-saws (giant playing cards), escalators, beds of spinning rollers, pistons punching out of the rails, flipper
// gauntlets, marble runs where the track splits into narrow lanes (walled, or wire) that corkscrew round
// and cross over and under each other or twist round each other like a rope, tornado spirals, spinning
// turntables set into the track, swaying rope bridges, lottery drums the balls tumble through, turns with
// berms, patches of cobbles, gravel and rumble strips, tilting mahjong tables with rows of tiles to find a way
// through, craps tables with two giant dice tumbling about on them, a pachinko slope of pins, a pinball table with bumpers, slingshots and flippers, posts
// of dice, chips and bumpers to weave between, and lane splits with something different down each side,
// then a finish arch. It turns back toward the middle before it wanders too far, and a piece that would run
// into track already there is built some other way.
//
// On the track a ball's position is how far along its piece it is (s) and how far across (u); gravity, the
// banking and the turns move it along and across, and the posts, bumpers, flippers and walls are all in that
// plane. Off a jump or out of a funnel it flies freely until it lands on the next piece. Balls bump into
// each other in the world. As in 2D, they always roll on at a little speed of their own, and one that's
// stuck gets a nudge, or a lift along the track. The cones and dominoes along the edges are knocked about
// by the balls (which go on through them) and bump into everything else on the track, and each other.
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
    if (p.berm && Math.sign(u) !== p.berm) return [0, 0, 0];   // (a berm: the wall's only on the outside)
    const m = pipeM(p, s), d = Math.abs(u) - PIPE.fb, R = PIPE.R;
    if (d <= 0 || m === 0) return [0, 0, 0];
    const q = Math.sqrt(Math.max(1e-4, R * R - Math.min(d, R) ** 2));
    return [m * (R - q), m * Math.sign(u) * d / q, m * R * R / (q * q * q)];
  }
  // (how far across a ball can go, on side sd)
  const ubAt = (p, s, sd = 1) => p.pipe || p.berm === sd ? UB + (PIPE.fb + PIPE.R * 0.92 - UB) * pipeM(p, s) : p.ub ?? UB;

  // A piece along a path given as a function of how far along it is (0..1), its points spaced evenly; up
  // off it is as near straight up as it can be. (The marble run's lanes.)
  const LANE = { hw: 4.25, A: 12.5, H: 10 };
  function pathPiece(kind, pos, o = {}) {
    const M = 800, pts = [], cum = [0];
    for (let k = 0; k <= M; k++) pts.push(pos(k / M));
    for (let k = 1; k <= M; k++) cum.push(cum[k - 1] + Math.hypot(pts[k][0] - pts[k - 1][0], pts[k][1] - pts[k - 1][1], pts[k][2] - pts[k - 1][2]));
    const len = cum[M], n = Math.ceil(len / 1.5) + 1, ds = len / (n - 1);
    const P = new Float64Array(3 * n), T = new Float64Array(3 * n), N = new Float64Array(3 * n), B = new Float64Array(3 * n);
    for (let i = 0, k = 0; i < n; i++) {
      const s = i * ds; while (k < M - 1 && cum[k + 1] < s) k++;
      const f = clamp((s - cum[k]) / Math.max(1e-9, cum[k + 1] - cum[k]), 0, 1), a = pts[k], b = pts[k + 1];
      let tx = b[0] - a[0], ty = b[1] - a[1], tz = b[2] - a[2]; const tl = Math.hypot(tx, ty, tz); tx /= tl; ty /= tl; tz /= tl;
      let nx = -ty * tx, ny = 1 - ty * ty, nz = -ty * tz; const nl = Math.hypot(nx, ny, nz); nx /= nl; ny /= nl; nz /= nl;
      P.set([a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f], i * 3); T.set([tx, ty, tz], i * 3); N.set([nx, ny, nz], i * 3);
      B.set([ty * nz - tz * ny, tz * nx - tx * nz, tx * ny - ty * nx], i * 3);
    }
    return finish({ kind, len, n, ds, P, T, N, B }, o);
  }

  // ---- moving things ----
  // A flipper hinged at (ps, pu): its arm points at angle psi0 at rest (0 is down the track, toward +u is
  // positive) and flicks round by `sweep`. Sensor ones flick when a ball comes near.
  function flipper(p, ps, pu, psi0, sweep, len, sensor = false) {
    const F = { p, ps, pu, psi0, sweep, len, psi: psi0, k: 0, st: 0, next: rnd(0.4, 2.5), sensor, cool: 0, seg: { e: 0.3 } };
    (p.flips ||= []).push(F);
    return F;
  }
  // a turnstile: n arms of length L round a hub at (s, u), turning flat over the track
  function spinner(p, s, u, n, L) {
    const M = { type: 'spin', p, cs: s, cu: u, L, n, th: rnd(0, TAU), w: pick([-1, 1]) * rnd(0.8, 1.2), segs: [] };   // (turning slowly: nothing flickers)
    for (let k = 0; k < n; k++) { const sg = { as: s, au: u, bs: s, bu: u, e: 0.5 }; M.segs.push(sg); p.segs.push(sg); }
    post(p, s, u, 1.6, 'hub', { e: 0.4 });
    (p.movs ||= []).push(M);
  }
  // A paddle wheel: n paddles round an axle across the track, h above it; the ones down low enough to meet a
  // ball are walls across the track, moving on down it.
  function paddleWheel(p, s) {
    const R = 9, n = 6, h = R - 0.6, M = { type: 'paddle', p, cs: s, R, h, n, th: rnd(0, TAU), w: 70 / (h - RW), segs: [] };
    for (let k = 0; k < n; k++) { const sg = { as: s, au: -RAIL + 0.2, bs: s, bu: RAIL - 0.2, e: 0.2, on: false }; M.segs.push(sg); p.segs.push(sg); }
    (p.movs ||= []).push(M);
  }
  // a hammer swinging across the track from a gantry over it: its head is a post moving from side to side
  function hammer(p, s) {
    const A = fits(3.2), o = post(p, s, 0, 3.2, 'hammer', { e: 0.6, vs: 0, vu: 0 });
    (p.movs ||= []).push({ type: 'slide', p, o, u0: 0, A, w: rnd(1.8, 2.6), ph: rnd(0, TAU) });
  }
  // a piston in the rail on one side, punching out to just past the middle of the track and back
  function piston(p, s, side) {
    const wd = 7, R0 = RAIL - 0.2, front = { as: s - wd / 2, au: side * R0, bs: s + wd / 2, bu: side * R0, e: 0.3, vs: 0, vu: 0 };
    // (its upstream side slants back to the rail, so balls coming down along it slide off round it)
    const sa = { as: s - wd / 2 - 6, au: side * R0, bs: s - wd / 2, bu: side * R0, e: 0.3, piston: true }, sb = { as: s + wd / 2, au: side * R0, bs: s + wd / 2, bu: side * R0, e: 0.3, piston: true };
    p.segs.push(front, sa, sb);
    (p.movs ||= []).push({ type: 'piston', p, s, side, wd, E: RAIL + 2, w: rnd(1.6, 2.2), ph: rnd(0, TAU), front, sa, sb, e: 0 });
  }

  // ---- what goes on the track ----
  const post = (p, s, u, r, kind, o = {}) => { const q = { s, u, r, kind, e: 0.5, lit: 0, ...o }; p.obs.push(q); return q; };
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
  // A row of dominoes standing along the edge on one side (each how far over it is, th, toward +s, and how
  // fast it's going over, w), with room past each end for the end ones to fall flat. Returns where it went.
  function dominoes(p, a, side) {
    const nn = ri(7, 12), ds = Array.from({ length: nn }, (_, i) => a + i * 4), span = [a - 10, ds[nn - 1] + 11];
    if (span[0] < 2 || span[1] > p.len - 2 || !edgeFree(p, ...span, side)) return null;
    p.doms.push({ ds, side, p, u: side * EDGE, th: new Float64Array(nn), w: new Float64Array(nn), still: 0, raise: false });
    return span;
  }
  // a traffic cone at (s, u): where it's knocked to, how far over it is (tilt) toward dir, and its home
  const cone = (p, s, u) => p.cones.push({ p, s, u, hp: p, hs: s, hu: u, vs: 0, vu: 0, tilt: 0, tv: 0, dir: 0, spin: 0, rest: 0, pop: -9 });
  // Is the strip along the edge on one side, from a to b, clear of everything else on the piece, so dominoes
  // can fall and cones stand there without being stood in anything?
  function edgeFree(p, a, b, side) {
    if (p.berm === side) return false;
    const u0 = side * EDGE, near = (s, u, r) => s > a - r && s < b + r && Math.abs(u - u0) < r + 3.5;
    const nearSeg = sg => { for (let k = 0; k <= 12; k++) if (near(sg.as + (sg.bs - sg.as) * k / 12, sg.au + (sg.bu - sg.au) * k / 12, 1)) return true; return false; };
    if (p.obs.some(o => near(o.s, o.u, o.r)) || p.segs.some(nearSeg) || (p.flips || []).some(F => near(F.ps, F.pu, F.len)) || (p.pads || []).some(P => near(P.s, P.u, P.r))) return false;
    if ((p.movs || []).some(M => M.type === 'spin' ? near(M.cs, M.cu, M.L) : M.type === 'slide' ? M.o.s > a - 6 && M.o.s < b + 6 : (M.s ?? M.cs) > a - 12 && (M.s ?? M.cs) < b + 12)) return false;
    return !p.doms.some(D => D.side === side && D.ds[0] - 10 < b && D.ds.at(-1) + 11 > a) && !p.cones.some(c => Math.sign(c.hu) === side && c.hs > a - 4 && c.hs < b + 4);
  }
  // Rubber deflectors standing out from a rail at an angle: a ball rolling along the edge hits one and is
  // kicked back across the track, often into a bumper, die or chip stack standing just past it. On a turn
  // they're mostly on the outside, where balls get flung. Returns where they went, so nothing's put on top.
  function deflectors(p, every = [32, 55]) {
    const used = [];
    if (p.kind === 'loop' || p.len < 40) return used;
    for (let s = rnd(14, 26); s < p.len - 30; s += rnd(...every)) {
      if (p.regions.some(r => s + 30 > r.a && s - 4 < r.b) || p.obs.some(o => Math.abs(o.s - s - 15) < 20) || (p.blocks || []).some(([a, b]) => s + 30 > a && s - 4 < b)) continue;
      const side = p.berm ? -p.berm : p.turnSign && Math.random() < 0.8 ? -p.turnSign : pick([-1, 1]);   // (not on a berm)
      p.segs.push({ as: s, au: side * (RAIL - 1.4), bs: s + 11, bu: side * (RAIL - 8), e: 0.55, kick: 50, deflector: true });
      if (Math.random() < 0.65) {
        const k = pick(['bumper', 'die', 'chip', 'bumper']), r = k === 'bumper' ? 4.5 : k === 'die' ? 3.6 : 3.8, u = -side * rnd(0, fits(r));
        if (k === 'bumper') bumper(p, s + 24, u); else post(p, s + 24, u, r, k, { face: ri(1, 6), e: 0.4, h: ri(2, 4) });
      }
      used.push([s - 2, s + 30]);
    }
    return used;
  }
  // A deflector on the rail on one side at s: from the rail, angling in and on down the track.
  const deflector = (p, s, side) => p.segs.push({ as: s, au: side * (RAIL - 1.4), bs: s + 11, bu: side * (RAIL - 8), e: 0.55, kick: 50, deflector: true });
  // The end of a curve, which has flung the balls out against its outside rail: a bumper in the middle, then
  // one on each rail, right up against it, so wherever a ball comes round it's knocked somewhere new (and
  // there's plenty of room between them).
  function curveEnd(p) {
    if (p.len < 60) return;
    const e = p.len;
    bumper(p, e - 30, 0);
    for (const sd of [-1, 1]) bumper(p, e - 8, sd * (RAIL - 0.08 - 4.5)).inward = -sd;   // (knocking balls in off the rail, never back into it)
    (p.blocks ||= []).push([e - 38, e]);
  }
  // Deflectors along both rails of an obstacle's stretch, from a to b, one side then the other, so no ball
  // gets past along a rail: only where a ball always fits between one and anything else, moving or not.
  function railKickers(p, a, b) {
    const dist = (ps, pu, s0, u0, s1, u1) => {   // (from a point to a segment)
      const ex = s1 - s0, ey = u1 - u0, k = clamp(((ps - s0) * ex + (pu - u0) * ey) / (ex * ex + ey * ey || 1), 0, 1);
      return Math.hypot(ps - s0 - ex * k, pu - u0 - ey * k);
    };
    const gap = 2 * RW + 0.6;
    let side = pick([-1, 1]);
    for (let s = a; s < b - 11; s += rnd(22, 30), side = -side) {
      const s0 = s, u0 = side * (RAIL - 1.4), s1 = s + 11, u1 = side * (RAIL - 8), near = (ps, pu, r) => dist(ps, pu, s0, u0, s1, u1) < r + gap;
      if (p.obs.some(o => near(o.s, o.u, o.r))) continue;
      if ((p.movs || []).some(M => M.type === 'spin' ? near(M.cs, M.cu, M.L) : M.type === 'slide' ? near(M.o.s, M.u0 - M.A, M.o.r) || near(M.o.s, M.u0 + M.A, M.o.r) : M.type === 'piston' ? Math.abs(M.s - s - 5) < 22 : M.type === 'paddle' ? Math.abs(M.cs - s - 5) < 16 : false)) continue;
      if ((p.flips || []).some(F => near(F.ps, F.pu, F.len))) continue;
      if (p.segs.some(sg => !sg.deflector && sg.on !== false && Math.min(dist(sg.as, sg.au, s0, u0, s1, u1), dist(sg.bs, sg.bu, s0, u0, s1, u1), dist(s0, u0, sg.as, sg.au, sg.bs, sg.bu), dist(s1, u1, sg.as, sg.au, sg.bs, sg.bu)) < gap)) continue;
      if ((p.pads || []).some(P => near(P.s, P.u, P.r)) || p.doms.some(D => D.side === side && D.ds.some(x => x > s - 4 && x < s + 15)) || p.cones.some(c => Math.sign(c.hu) === side && c.hs > s - 4 && c.hs < s + 15)) continue;
      deflector(p, s, side);
    }
  }
  // The rows of tiles on a mahjong table: five slots across, a tile standing in each but where there's a gap
  // two slots wide (wide enough that a ball rolling along the row drops into it, and several go through at
  // once), at a rail, in the middle, or one at each rail, never where the last row's was. Each run of tiles
  // side by side is walled round.
  const MJ = { w: 6.2, d: 4.2, h: 8.2, n: 5 };
  function mahjongRows(p) {
    const slot = 2 * RAIL / MJ.n, gaps = [[0, 1], [MJ.n - 2, MJ.n - 1], [1, 2], [2, 3], [0, MJ.n - 1]];
    let prev = [];
    p.rows = [];
    for (let s = 28; s < p.len - 22; s += rnd(28, 34)) {
      const gap = pick(gaps.filter(gp => !gp.some(k => prev.includes(k))));
      prev = gap;
      const tiles = [];
      for (let k = 0; k < MJ.n; k++) if (!gap.includes(k)) tiles.push({ u: -RAIL + (k + 0.5) * slot, face: ri(0, 33) });
      p.rows.push({ s, tiles });
      const a = s - MJ.d / 2, b = s + MJ.d / 2;
      for (let k = 0; k < MJ.n;) {
        if (gap.includes(k)) { k++; continue; }
        let e = k; while (e + 1 < MJ.n && !gap.includes(e + 1)) e++;
        const u0 = k === 0 ? -RAIL : -RAIL + k * slot + (slot - MJ.w) / 2, u1 = e === MJ.n - 1 ? RAIL : -RAIL + (e + 1) * slot - (slot - MJ.w) / 2;
        p.segs.push({ as: a, au: u0, bs: a, bu: u1, e: 0.3, tile: true }, { as: b, au: u0, bs: b, bu: u1, e: 0.3, tile: true });
        if (k > 0) p.segs.push({ as: a, au: u0, bs: b, bu: u0, e: 0.3, tile: true });
        if (e < MJ.n - 1) p.segs.push({ as: a, au: u1, bs: b, bu: u1, e: 0.3, tile: true });
        k = e + 1;
      }
    }
  }
  // A craps table's two giant dice. Each sits in a square as big as it is, on a grid two across (so there's
  // always room to get by along either rail) and as many along as fit. A die is walled round its footprint
  // (see dieBox) and kept turned as a matrix from its own axes to (along, up, across), so the face on top is
  // known.
  function crapsTable(p) {
    const C = { p, a: 9, s0: 26, next: -1, thrown: false, dice: [] };
    C.n = Math.floor((p.len - 20 - C.s0) / C.a);
    for (const [ci, cj] of [[1, 0], [3, 1]]) {
      const Dc = { ci, cj, R: [1, 0, 0, 0, 1, 0, 0, 0, 1], roll: null, left: 0, segs: [0, 1, 2, 3].map(() => ({ as: 0, au: 0, bs: 0, bu: 0, e: 0.4, die: true })) };
      for (let k = ri(3, 7); k--;) Dc.R = mul3(turn90(pick([[1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1]])), Dc.R);   // (any way up to start with)
      p.segs.push(...Dc.segs); C.dice.push(Dc); dieBox(C, Dc);
    }
    p.craps = C;
  }
  function dress(p) {
    // deflectors kicking balls off the rails, dominoes and cones along the edges (where there aren't
    // deflectors on that side), lamps beside it
    if (p.kind === 'loop' || p.len < 40) return;
    // (and nothing on top of boost pads or conveyors)
    const used = deflectors(p).concat(p.regions.map(r => [r.a, r.b]), p.blocks || []), clear = (a, b) => !used.some(([u0, u1]) => b > u0 && a < u1);
    const free = (a, b) => !p.regions.concat(p.blocks || []).some(r => b > (r.a ?? r[0]) && a < (r.b ?? r[1]));
    // a patch of cobbles, gravel or rumble strips
    const rs = rnd(10, Math.max(11, p.len - 50)), rl = rnd(16, 34);
    if (Math.random() < 0.4 && clear(rs, rs + rl)) { p.regions.push({ a: rs, b: rs + rl, rough: pick(['cobble', 'gravel', 'rumble']) }); used.push([rs, rs + rl]); }
    const edge = () => p.berm ? -p.berm : pick([-1, 1]);
    if (Math.random() < 0.35) for (let k = 0; k < 4; k++) { const ds = rnd(12, Math.max(13, p.len - 60)); if (free(ds - 10, ds + 56) && dominoes(p, ds, edge())) break; }
    if (Math.random() < 0.3) for (let k = 0; k < 4; k++) {
      const s0 = rnd(8, p.len - 30), nc = ri(2, 4), side = edge();
      if (free(s0 - 4, s0 + nc * 6) && edgeFree(p, s0 - 4, s0 + (nc - 1) * 6 + 4, side)) { for (let j = 0; j < nc; j++) cone(p, s0 + j * 6, side * EDGE); break; }
    }
    for (let s = rnd(10, 40); s < p.len - 5; s += rnd(60, 110)) p.lamps.push({ s, side: pick([-1, 1]) });
  }

  // ---- features: one or more pieces that carry on from the turtle ----
  const FEAT = { straight: 2, turn: 3, helix: 1.2, loop: 1.4, jump: 1.4, funnel: 1, roulette: 0.9, halfpipe: 1.1, moles: 1, plinko: 1.1, pinball: 1, posts: 1.6, lanes: 1.2,
    spinners: 1, paddles: 0.8, hammers: 0.8, seesaw: 0.8, escalator: 0.8, rollers: 0.9, pistons: 0.9, flippers: 1, braid: 1, wiremaze: 1, knot: 1, tornado: 0.8, spinpads: 0.9, bridge: 1, tumbler: 0.9,
    mahjong: 1, craps: 1 };
  function feature(kind) {
    const out = [];
    const add = p => { out.push(p); tur = p.after; return p; };
    if (kind === 'straight') { const p = add(straight(rnd(70, 140), -rnd(0.06, 0.12))); if (Math.random() < 0.4) p.regions.push({ a: p.len * 0.4, b: p.len * 0.4 + 14, boost: 165 }); dress(p); }
    else if (kind === 'turn') {
      const p = add(turn(pick([-1, 1]) * rnd(0.9, 2.4), rnd(55, 95), -rnd(0.05, 0.1)));
      if (Math.random() < 0.4) p.berm = -p.turnSign;   // (a berm round the outside: the balls ride up it)
      curveEnd(p); dress(p);
    }
    else if (kind === 'tornado') { const p = add(turn(pick([-1, 1]) * rnd(TAU * 2.5, TAU * 3.5), rnd(34, 40), -0.26, { kind: 'helix' })); curveEnd(p); deflectors(p, [45, 70]); }   // (a tight spiral, round and round)
    else if (kind === 'helix') { const p = add(turn(pick([-1, 1]) * rnd(TAU * 0.9, TAU * 1.6), rnd(45, 60), -rnd(0.16, 0.22), { kind: 'helix' })); curveEnd(p); deflectors(p, [45, 70]); }
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
      railKickers(p, 14, p.len - 10);
      add(straight(30, -0.06));
    } else if (kind === 'spinners') {
      // turnstiles: crosses (or bars) turning flat over the track, batting the balls along; each leaves a way past on one side
      const p = add(straight(rnd(130, 160), -0.1, { kind: 'spinners' }));
      for (let s = 32; s < p.len - 26; s += rnd(30, 38)) spinner(p, s, pick([-1, 0, 0, 1]) * rnd(2, 5), ri(2, 4), rnd(8, 9.5));
      railKickers(p, 14, p.len - 10);
    } else if (kind === 'paddles') {
      // paddle wheels turning over the track, their paddles sweeping down behind the balls and shoving them on
      const p = add(straight(rnd(120, 150), -0.1, { kind: 'paddles' }));
      paddleWheel(p, rnd(36, 46));
      if (p.len > 130) paddleWheel(p, p.len - 34);
    } else if (kind === 'hammers') {
      // hammers swinging across the track from gantries over it
      const p = add(straight(rnd(140, 170), -0.12, { kind: 'hammers' }));
      for (let s = 34; s < p.len - 24; s += rnd(26, 34)) hammer(p, s);
      railKickers(p, 14, p.len - 10);
    } else if (kind === 'seesaw') {
      // a see-saw across the whole track, a giant playing card: down at this end, so the balls roll on and up
      // it, and as they go over the middle it tips and drops them off the far end
      const p = add(straight(rnd(120, 140), -0.06, { kind: 'seesaw' }));
      const L = 44, hp = 2.6;
      p.saw = { s0: p.len / 2, L, hp, thm: Math.asin(hp / (L / 2)), th: -Math.asin(hp / (L / 2)), thd: 0, load: 0 };
    } else if (kind === 'escalator') {
      // an escalator: a conveyor of steps carrying the balls up a rise, and over the top
      const e = add(straight(60, 0.26, { kind: 'escalator', style: 'track' }));
      e.regions.push({ a: 0, b: e.len, belt: 45, esc: true });
      add(straight(50, -0.12));
    } else if (kind === 'rollers') {
      // beds of spinning rollers set into the track: some roll the balls across to one side, some speed them on
      const p = add(straight(rnd(140, 170), -0.1, { kind: 'rollers' }));
      let s = 28;
      while (s < p.len - 34) {
        const len = rnd(18, 26), side = pick([-1, 1, 0]);
        if (side) p.regions.push({ a: s, b: s + len, roll: { vu: side * 75 }, u0: -RAIL, u1: RAIL });
        else p.regions.push({ a: s, b: s + len, roll: { vs: 140 }, u0: -RAIL, u1: RAIL });
        s += len + rnd(16, 26);
      }
    } else if (kind === 'pistons') {
      // pistons punching out of the rails and back, one side then the other (never two at once, so a ball's
      // never squeezed)
      const p = add(straight(rnd(140, 170), -0.1, { kind: 'pistons' }));
      let side = pick([-1, 1]);
      for (let s = 34; s < p.len - 24; s += rnd(24, 30), side = -side) piston(p, s, side);
    } else if (kind === 'flippers') {
      // a flipper gauntlet: flippers on the rails and back to back in the middle, at all sorts of angles,
      // flicking when a ball comes by and batting it back across the track
      const p = add(straight(rnd(170, 200), -0.16, { kind: 'flippers' }));
      for (let s = 30, i = 0; s < p.len - 26; s += rnd(26, 34), i++) {
        if (i % 2 === 0) { const sd = pick([-1, 1]); flipper(p, s, sd * (RAIL - 2.4), -sd * rnd(0.4, 0.9), -sd * rnd(0.9, 1.3), 11, true); }
        else { for (const sd of [-1, 1]) flipper(p, s, sd * 2.2, sd * rnd(0.5, 0.9), sd * rnd(0.8, 1.1), 10, true); bumper(p, s - 2.5, 0); }   // (a bumper where they meet, so nothing balances there)
      }
      railKickers(p, 14, p.len - 10);
    } else if (kind === 'bridge') {
      // a rope bridge: planks hung between two towers, sagging in the middle and swaying from side to side
      // (most in the middle), which rolls the balls on it toward whichever side's down
      add(straight(30, -0.06));
      const L = rnd(110, 150), D = rnd(6, 10), yaw = tur.yaw;
      add(sweep('bridge', L, f => [yaw, Math.atan(-D * Math.PI / L * Math.cos(Math.PI * f) - 0.06), 0], { style: 'bridge', bridge: { A: rnd(0.16, 0.26), w: rnd(1.4, 2.2), ph: rnd(0, TAU), roll: 0 } }));
      add(straight(30, -0.06));
    } else if (kind === 'tumbler') {
      // A lottery drum: a turning wire cage the track runs through. Fins inside carry the balls up its side and
      // drop them across it, so they tumble about as they make their way down it and out the far end.
      add(straight(30, -0.08));
      const p = add(straight(50, -0.1, { kind: 'tumbler', style: 'tumbler' }));
      p.drum = { R: HW - 0.5, w: pick([-1, 1]) * rnd(1.6, 2.1), th: rnd(0, TAU), n: 5 };
      // (the cage stands up off the track: nothing else is built through the top of it)
      p.extra = [];
      for (let i = 0; i < p.n; i += 4) for (const h of [p.drum.R, 2 * p.drum.R]) p.extra.push([p.P[i * 3] + p.N[i * 3] * h, p.P[i * 3 + 1] + p.N[i * 3 + 1] * h, p.P[i * 3 + 2] + p.N[i * 3 + 2] * h]);
      add(straight(30, -0.08));
    } else if (kind === 'mahjong') {
      // A mahjong table tipping slowly from side to side, with rows of big tiles standing across it, each row
      // with a gap somewhere else: the balls roll along a row to whichever side's down and through the gap.
      add(straight(30, -0.07));
      const p = add(straight(rnd(140, 165), -0.07, { kind: 'mahjong', style: 'mahjong', tilt: { A: rnd(0.2, 0.26), w: rnd(1.7, 2.1), ph: rnd(0, TAU), roll: 0 } }));
      mahjongRows(p);
      add(straight(30, -0.07));
    } else if (kind === 'craps') {
      // a craps table, with two giant dice tumbling about on it (see stepCraps)
      const p = add(straight(rnd(150, 170), -0.08, { kind: 'craps', style: 'craps' }));
      p.regions.push({ a: 0, b: p.len, felt: true });
      crapsTable(p);
    } else if (kind === 'spinpads') {
      // turntables set into the track, spinning: a ball rolling onto one is swept round with it, and off
      const p = add(straight(rnd(130, 160), -0.1, { kind: 'spinpads' }));
      p.pads = [];
      for (let s = 26; s < p.len - 24;) {
        const r = rnd(6, 10.5), u = rnd(-1, 1) * (RAIL - 0.6 - r);
        p.pads.push({ s: s + r, u, r, w: pick([-1, 1]) * rnd(1.2, 1.8), th: rnd(0, TAU) });
        s += 2 * r + rnd(8, 16);
      }
      railKickers(p, 14, p.len - 10);
    } else if (kind === 'braid' || kind === 'wiremaze' || kind === 'knot') {
      // A marble run: the track splits into three narrow lanes, which come back together onto a wide track
      // further on, down a run whose axis turns and slopes down as it goes. Each ball goes down whichever
      // lane it's nearest as it gets there.
      // - braid: lanes with walls. The middle one runs down the axis; the other two corkscrew round it, and
      //   round each other, a turn or a turn and a half, never nearer it than they can pass.
      // - wiremaze: wire tracks. The outer two swing wide and cross right over to the other side, one over
      //   the middle lane and the other under it; the middle one weaves between them.
      // - knot: all three twist round the axis like the strands of a rope, two or three times round (walled
      //   or wire)
      const knot = kind === 'knot', wire = kind === 'wiremaze' || (knot && Math.random() < 0.5), lead = add(straight(50, -0.08));
      const y0 = tur.yaw, turnBy = pick([-1, 1]) * (kind === 'braid' ? rnd(0.4, 1.0) : rnd(0.8, 1.5)), len = knot ? rnd(320, 380) : rnd(260, 320);
      const m = knot ? pick([2, 3]) : pick([1, 1.5]), pitch = knot ? -0.18 : -0.13, AX = 400, axis = [];
      let x = tur.x, y = tur.y, z = tur.z;
      for (let k = 0; k <= AX; k++) {
        const yaw = y0 + turnBy * smooth(k / AX);
        axis.push({ x, y, z, yaw });
        x += Math.cos(pitch) * Math.cos(yaw) * len / AX; y += Math.sin(pitch) * len / AX; z += Math.cos(pitch) * Math.sin(yaw) * len / AX;
      }
      const at = t => {   // (between the samples, smoothly)
        const f = clamp(t, 0, 1) * AX, i = Math.min(AX - 1, Math.floor(f)), k = f - i, a = axis[i], b = axis[i + 1];
        return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k, z: a.z + (b.z - a.z) * k, yaw: a.yaw + (b.yaw - a.yaw) * k };
      }, env = t => smooth(clamp(Math.min(t, 1 - t) / 0.18, 0, 1));
      // each lane: where it starts and ends across the track, and how far across and up from the axis it is
      let defs;
      if (knot) {
        // (they twist only once they've eased in from side by side, and stop before easing back out, so
        // they never cross on the way)
        const rho = 9, g = t => smooth(clamp((t - 0.16) / 0.68, 0, 1)), env2 = t => smooth(clamp(Math.min(t, 1 - t) / 0.16, 0, 1));
        defs = [[-LANE.A, -Math.PI / 2], [0, Math.PI / 6], [LANE.A, 5 * Math.PI / 6]].map(([u0, ph]) => ({ u0, uEnd: u0, off: t => {
          const th = ph + TAU * m * g(t), e = env2(t);
          return [u0 + (rho * Math.sin(th) - u0) * e, rho * Math.cos(th) * e];
        } }));
      } else if (wire) {
        const ease = (a, b, f) => a + (b - a) * smooth(clamp(f, 0, 1));
        const cross = sd => t => t < 0.25 ? ease(sd * LANE.A, sd * 30, t / 0.25) : t < 0.75 ? ease(sd * 30, -sd * 30, (t - 0.25) / 0.5) : ease(-sd * 30, -sd * LANE.A, (t - 0.75) / 0.25);
        const bump = t => t < 0.2 || t > 0.8 ? 0 : Math.sin(Math.PI * (t - 0.2) / 0.6) ** 2;
        defs = [
          { u0: -LANE.A, uEnd: LANE.A, off: t => [cross(-1)(t), 12 * bump(t)] },
          { u0: 0, uEnd: 0, off: t => [5 * Math.sin(TAU * 2 * t) * env(t), 0] },
          { u0: LANE.A, uEnd: -LANE.A, off: t => [cross(1)(t), -12 * bump(t)] },
        ];
      } else defs = [[-LANE.A, -Math.PI / 2], [0, null], [LANE.A, Math.PI / 2]].map(([u0, ph]) => {
        // (easing from side by side at the ends into the corkscrew; a turn and a half brings it out on the
        // other side, so it eases out toward that)
        const uEnd = ph == null ? 0 : LANE.A * Math.round(Math.sin(ph + TAU * m));
        return { u0, uEnd, off: t => {
          if (ph == null) return [0, 0];
          const th = ph + TAU * m * t, e = env(t), base = t < 0.5 ? u0 : uEnd;
          return [base + (LANE.A * Math.sin(th) - base) * e, LANE.H * Math.cos(th) * e];
        } };
      });
      const lanes = defs.map(({ u0, uEnd, off }, k) => {
        const q = pathPiece('lane', t => { const a = at(t), [u, h] = off(t); return [a.x - Math.sin(a.yaw) * u, a.y + h, a.z + Math.cos(a.yaw) * u]; }, { lane: true, wire, ub: LANE.hw - 0.4 - RW, style: 'lane', laneCol: k, u0 });
        q.nextU = uEnd;
        q.back = lead;
        return q;
      });
      lead.lanes = lanes;
      const e = axis[AX];
      tur = { x: e.x, y: e.y, z: e.z, yaw: e.yaw, pitch };
      out.push(...lanes);
      const merge = add(straight(60, -0.08, { noBack: true }));
      for (const q of lanes) q.next = merge;
    } else if (kind === 'plinko') {
      const p = add(straight(rnd(150, 190), -0.36, { kind: 'plinko' }));
      pins(p, 55, p.len - 12);
      railKickers(p, 20, p.len - 10);
      add(straight(40, -0.06));
    } else if (kind === 'pinball') {
      const p = add(straight(160, -0.22, { kind: 'pinball' }));
      for (let s = rnd(45, 55); s < 112; s += rnd(18, 26)) bumper(p, s, rnd(-fits(4.5), fits(4.5)));
      railKickers(p, 20, 106);
      // slingshots angled in from each side above the flippers, and the flippers themselves
      for (const sd of [-1, 1]) p.segs.push({ as: 118, au: sd * (RAIL - 1.4), bs: 132, bu: sd * (RAIL - 6.4), e: 0.9, kick: 70, sling: true });
      for (const sd of [-1, 1]) flipper(p, p.len - 16, sd * (RAIL - 2.4), sd * (0.5 - Math.PI / 2), -sd * 1.05, 11);
      add(straight(40, -0.06));
    } else if (kind === 'posts') {
      const p = add(straight(rnd(120, 170), -0.12, { kind: 'posts' }));
      for (let s = 30; s < p.len - 20; s += rnd(16, 26)) {
        const k = pick(['die', 'chip', 'bumper', 'die']), r = k === 'die' ? 3.6 : k === 'chip' ? 3.8 : 4.5, u = rnd(-fits(r), fits(r));
        if (k === 'bumper') bumper(p, s, u);
        else if (k === 'die' && Math.random() < 0.3) post(p, s, clamp(u, -fits(4), fits(4)), 4, 'drum', { spin: pick([-1, 1]) * rnd(50, 80), e: 0.4 });   // (a spinning drum)
        else post(p, s, u, r, k, { face: ri(1, 6), e: 0.4, h: ri(2, 4) });
      }
      railKickers(p, 14, p.len - 10);
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
  let laneRun = 0;
  function place(ps) {
    for (const p of ps) {
      p.i = pieces.length; pieces.push(p);
      // (the lanes of a marble run all start where it splits; what comes after starts past the longest)
      if (p.lane) { p.s0 = total; laneRun = Math.max(laneRun, p.len); }
      else { total += laneRun; laneRun = 0; p.s0 = total; total += p.len; }
    }
    for (const p of ps) if (p.gapTo != null) { p.landOn = ps[p.gapTo].i; }
    remember(ps);
  }

  function build() {
    pieces = []; total = 0; grid = new Map(); pending = []; styleRun = 0; laneRun = 0;
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
        const keep = tur, ps = kind === 'steer' ? [turn(Math.sign(toC) * clamp(Math.abs(toC) * rnd(1, 1.3), 1.2, Math.PI), rnd(55, 80), -rnd(0.07, 0.12))].map(p => (tur = p.after, curveEnd(p), p)) : feature(tries > 3 ? 'turn' : kind);
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
      drums: pieces.filter(p => p.drum).map(p => p.drum), pads: pieces.flatMap(p => p.pads || []), bridges: pieces.filter(p => p.bridge || p.tilt).map(p => p.bridge || p.tilt),
      cones: pieces.flatMap(p => p.cones), craps: pieces.filter(p => p.craps).map(p => p.craps), flippers: pieces.flatMap(p => p.flips || []), movs: pieces.flatMap(p => p.movs || []), saws: pieces.filter(p => p.saw).map(p => p.saw), doms: pieces.flatMap(p => p.doms), slots: [], bumpers: pieces.flatMap(p => p.obs.filter(o => o.kick)),
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
  // (how far a rope bridge, or a mahjong table, is rolled over at s: a table's rigid but for a hinge at each end)
  const rollAt = (p, s) => p.bridge ? p.bridge.roll * Math.sin(Math.PI * clamp(s / p.len, 0, 1)) : p.tilt ? p.tilt.roll * smooth(clamp(Math.min(s, p.len - s) / 12, 0, 1)) : 0;
  function place3(w) {
    const p = pieces[w.pi], f = at(p, w.s, w.fr ??= fr());
    let b = w.u, n = RW + (w.lift || 0);
    if (p.drum && w.dr) return placeDrum(w, p);
    if (p.pipe || p.berm) { const [h, h1] = pipeH(p, w.s, w.u), l = Math.hypot(1, h1); b -= h1 / l * RW; n = h + RW / l; }   // (up a halfpipe's wall, or a berm, out from it square to it)
    if (p.bridge || p.tilt) { const r = rollAt(p, w.s), c = Math.cos(r), sn = Math.sin(r); [b, n] = [b * c + n * sn, -b * sn + n * c]; }   // (on a rope bridge or a mahjong table, rolled over with it)
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
    const vn = (w.vs - (o.vs || 0)) * ns + (w.vu - (o.vu || 0)) * nu;   // (relative to it, if it's moving)
    if (vn < 0) { w.vs -= (1 + o.e) * vn * ns; w.vu -= (1 + o.e) * vn * nu + rnd(-6, 6); }   // (never balanced on top of one)
    if (o.spin) { const vt = -w.vs * nu + w.vu * ns, dv = (o.spin - vt) * 0.6; w.vs -= nu * dv; w.vu += ns * dv; }   // (a spinning drum carries it round)
    if (o.kick && t - (o.hitT || -9) > 0.05) {
      w.vs += ns * o.kick; w.vu += nu * o.kick; o.hitT = t;
      if (o.inward) { w.vu = o.inward * rnd(50, 110); w.vs = Math.max(w.vs, rnd(40, 90)); }   // (one on a rail: in and on, somewhere new)
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
    let sv = sg.vs || 0, uv = sg.vu || 0;
    if (sg.spin) { sv -= sg.spin * (qu - sg.au); uv += sg.spin * (qs - sg.as); }
    const rs = w.vs - sv, ru = w.vu - uv, vn = rs * ns + ru * nu;
    if (vn < 0) { w.vs = rs - (1 + sg.e) * vn * ns + sv; w.vu = ru - (1 + sg.e) * vn * nu + uv; }
    if (sg.kick && t - (sg.hitT || -9) > 0.08) { w.vs += ns * sg.kick; w.vu += nu * sg.kick; sg.hitT = t; sg.lit = 1; emit(w.X, -w.Y, 6, ['#ffe600', '#fff', '#3ff8ff'], 40, 40, 140, undefined, w.Z); }
  }

  // In a lottery drum: how far along it (s), and round it: its angle from the bottom (phi, toward +u), or,
  // dropped by a fin, flying across it (x across, y up from its middle).
  const drumR = D => D.R - RW - 0.4;
  function placeDrum(w, p) {
    const d = w.dr, R = drumR(p.drum), f = at(p, w.s, w.fr ??= fr());
    const x = d.air ? d.x : R * Math.sin(d.phi), y = d.air ? d.y : -R * Math.cos(d.phi), h = R + RW + y;
    w.X = f.P[0] + f.B[0] * x + f.N[0] * h; w.Y = f.P[1] + f.B[1] * x + f.N[1] * h; w.Z = f.P[2] + f.B[2] * x + f.N[2] * h;
    flat(w);
  }
  function stepDrum(w, p, dt, racing) {
    const D = p.drum, R = drumR(D), f = at(p, w.s, F1);
    let d = w.dr;
    if (!d || d.pi !== p.i) d = w.dr = { pi: p.i, phi: Math.asin(clamp(w.u / R, -1, 1)), phd: 0, air: false, x: 0, y: 0, vx: 0, vy: 0 };
    // along it: down its slope, never stopping
    w.vs += (12 - w.vs) * Math.min(1, 3 * dt);   // (crawling along it, so it tumbles a few times on the way)
    w.s += w.vs * dt;
    if (!d.air) {
      // on the cage: pulled back down to the bottom, and dragged round by it
      d.phd += (-(G * 0.9 / R) * Math.sin(d.phi) + 2.5 * (D.w - d.phd)) * dt;
      d.phi = wrap(d.phi + d.phd * dt);
      // a fin coming round behind it picks it up and carries it
      for (let k = 0; k < D.n; k++) { const rel = wrap(d.phi - D.th - k * TAU / D.n); if (D.w > 0 ? rel < 0 && rel > -0.06 : rel > 0 && rel < 0.06) { d.phi = wrap(d.phi - rel + Math.sign(D.w) * 0.001); d.phd = D.w; } }
      // carried up past its side, it drops away across the drum
      if (Math.abs(d.phi) > 2) Object.assign(d, { air: true, x: R * Math.sin(d.phi), y: -R * Math.cos(d.phi), vx: R * d.phd * Math.cos(d.phi), vy: R * d.phd * Math.sin(d.phi) });
    } else {
      d.vy -= G * dt; d.x += d.vx * dt; d.y += d.vy * dt;
      if (Math.hypot(d.x, d.y) >= R) { d.phi = Math.atan2(d.x, -d.y); d.phd = (d.vx * Math.cos(d.phi) + d.vy * Math.sin(d.phi)) / R; d.air = false; }
    }
    // out the far end (once it's down at the bottom)
    if (w.s >= p.len) {
      if (!d.air && Math.abs(d.phi) < 1.2) { w.u = clamp(R * Math.sin(d.phi), -UB, UB); w.vu = 0; w.dr = null; w.s -= p.len; w.pi++; place3(w); w.dist = pieces[w.pi].s0 + w.s; return; }
      w.s = p.len - 0.05;
    }
    if (w.s < 0) w.s = 0;
    placeDrum(w, p);
    w.dist = p.s0 + w.s;
  }
  function stepTrack(w, dt, racing) {
    const p = pieces[w.pi], f = at(p, w.s, F1);
    if (p.drum) return stepDrum(w, p, dt, racing);
    w.ps = w.s; w.pu = w.u;
    // along: gravity (as a rolling ball feels it), and its own speed; across: the banking and the turns
    const as = -G * f.T[1] * ROLL;
    let au = -G * f.B[1] * ROLL - f.kB * w.vs * Math.abs(w.vs);
    w.vs += as * dt;
    if (p.loop || p.kind === 'loop') w.vs = Math.max(w.vs, p.vmin);
    else if (w.rank) { w.vs *= 1 - 1.2 * dt; w.vu *= 1 - 1.2 * dt; }   // (home: rolling to a stop in the tray at the end)
    else if (p.noAssist && !racing) { w.vs *= 1 - 3 * dt; w.vu *= 1 - 3 * dt; }   // (waiting in the starting pen: settling down)
    else if (!(p.noAssist && !racing)) {
      if (w.vs < MINV) w.vs += Math.min(MINV - w.vs, 240 * dt);
      else if (w.vs > MINV + 30) w.vs -= (w.vs - MINV) * 0.22 * dt;
    }
    if (p.pipe || p.berm) { const [, h1, h2] = pipeH(p, w.s, w.u); au = (au - G * ROLL * f.N[1] * h1 - h1 * h2 * w.vu * w.vu) / (1 + h1 * h1); }
    if (p.bridge || p.tilt) au += G * ROLL * Math.sin(rollAt(p, w.s));   // (a rope bridge's sway, or a table's tilt, rolls it toward the low side)
    w.vu += au * dt; w.vu *= 1 - (p.pipe || p.berm ? 0.25 : 0.7) * dt;
    for (const r of p.regions) if (w.s >= r.a && w.s < r.b && (r.u0 == null || (w.u >= r.u0 && w.u <= r.u1))) {
      if (r.belt) { w.vs = r.belt; w.vu *= 1 - 4 * dt; }
      else if (r.rough) { w.vs -= w.vs * (r.rough === 'gravel' ? 1.2 : 0.5) * dt; w.vu += rnd(-1, 1) * (r.rough === 'rumble' ? 50 : 90) * dt; }   // (bumpy: slowed and jostled)
      else if (r.roll) { const k = Math.min(1, 7 * dt); if (r.roll.vu) w.vu += (r.roll.vu - w.vu) * k; if (r.roll.vs && w.vs < r.roll.vs) w.vs += (r.roll.vs - w.vs) * k; }
      else if (r.boost && w.vs < r.boost) { w.vs = r.boost; if (!w.boostT) emit(w.X, -w.Y, 8, ['#3ff8ff', '#1a5cff', '#fff'], 40, 30, 100, undefined, w.Z); w.boostT = 0.8; }
    }
    for (const P of p.pads || []) {   // (on a turntable: carried round with it)
      const ds = w.s - P.s, du = w.u - P.u;
      if (ds * ds + du * du < P.r * P.r) { const k = Math.min(1, 3 * dt); w.vs += (-P.w * du - w.vs) * k; w.vu += (P.w * ds - w.vu) * k; }
    }
    const sp = Math.hypot(w.vs, w.vu); if (sp > VMAX) { w.vs *= VMAX / sp; w.vu *= VMAX / sp; }
    w.s += w.vs * dt; w.u += w.vu * dt;
    const sd = Math.sign(w.u) || 1, ub = ubAt(p, w.s, sd);
    if (Math.abs(w.u) > ub) { w.u = sd * ub; if (w.vu * w.u > 0) w.vu *= p.pipe || p.berm === sd ? 0 : -0.45; }
    for (const o of p.obs) if (Math.abs(o.s - w.s) < o.r + RW + 1) {
      if (o.kind === 'mole') {
        if (o.up < 0.4) continue;   // (down its hole)
        // just popped up under it: BONK, up in the air
        if (t - o.rose < 0.3 && racing && Math.hypot(w.s - o.s, w.u - o.u) < o.r + RW * 0.6 && t - (w.bonk ?? -9) > 1) { bonk(w, p, o); return; }
      }
      hitPost(w, o);
    }
    for (const sg of p.segs) if (sg.on !== false) hitSeg(w, sg);
    for (const F of p.flips || []) {
      hitSeg(w, F.seg);
      if (F.sensor && F.st === 0 && t > F.cool && Math.hypot(w.s - F.ps, w.u - F.pu) < F.len + RW) F.st = 1;
    }
    if (p.saw && seesaw(w, p.saw, dt)) return;
    if (!p.saw || Math.abs(w.s - p.saw.s0) > p.saw.L / 2) fall(w, dt);
    for (const D of p.doms) if (Math.abs(w.u - D.u) < RW + 2 && pushDominoes(D, w.s, w.vs, RW)) w.vs *= 0.985;
    for (const c of p.cones) knockCone(c, w);
    for (const S of K.slots) if (S.p === p && Math.abs(w.s - S.s) < 3) spin(S, w);
    // off the end
    if (w.s >= p.len) {
      if (p.kind === 'goal' || w.pi === pieces.length - 1) { w.s = p.len - 0.01; w.vs = 0; }
      else if (p.end === 'air') { at(p, p.len, F1); toAir(w, F1); return; }
      else if (p.end === 'funnel') { place3(w); p.fun.wheel ? toWheel(w, p.fun) : toFunnel(w, p.fun); return; }
      else if (p.lanes) {   // (a marble run: into the lane nearest across)
        const q = p.lanes.reduce((a, c) => Math.abs(c.u0 - w.u) < Math.abs(a.u0 - w.u) ? c : a);
        w.s -= p.len; w.pi = q.i; w.u = clamp(w.u - q.u0, -q.ub, q.ub);
      }
      else if (p.next) { w.s -= p.len; w.pi = p.next.i; w.u = clamp(w.u + p.nextU, -UB, UB); }   // (out of a lane)
      else { w.s -= p.len; w.pi++; }
    } else if (w.s < 0) {
      const q = p.noBack ? null : p.back || pieces[w.pi - 1];
      if (q && !q.end && q.kind !== 'start' && !q.lane) { w.pi = q.i; w.s += q.len; if (p.lane) w.u = clamp(w.u + p.u0, -UB, UB); }
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
  // On a see-saw: the plank's height at s is hp - (s - s0)·tan(th). A ball on it rolls down its slope and
  // weighs on it; one coming up to an end that's up off the track meets it as a wall; and one going off an
  // end that's up falls off it. (Returns true if it stopped the ball.)
  function seesaw(w, S, dt) {
    const a = S.s0 - S.L / 2, b = S.s0 + S.L / 2;
    if (w.s < a || w.s > b) return false;
    const tn = Math.tan(S.th), hh = S.hp - (w.s - S.s0) * tn;
    if ((w.lift || 0) > hh + 0.3) { fall(w, dt); if (w.lift < hh) w.lift = hh; return false; }   // (coming down onto it)
    if (hh > 1 && (w.ps < a || w.ps > b)) {   // (an end that's up: a wall)
      const back = w.ps < a ? -1 : 1;
      w.s = back < 0 ? a - 0.01 : b + 0.01; w.vs = back * Math.abs(w.vs) * 0.3;
      place3(w); return true;
    }
    w.lift = hh; w.liftV = 0;
    w.vs += G * ROLL * tn * dt;
    S.load += w.s - S.s0;
    return false;
  }
  // off the track (off the end of a see-saw that's up): falling back down onto it
  function fall(w, dt) {
    if (!w.lift) return;
    w.liftV = (w.liftV || 0) - G * dt; w.lift += w.liftV * dt;
    if (w.lift <= 0) { w.lift = 0; w.liftV = 0; }
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

  // ---- dominoes and cones: knocked about by the balls, never in their way ----
  // A domino tips on its bottom edge: back up while its middle's behind that edge, on over once it's past,
  // until it falls against the next one along (and leans on it, and on over with it) or lies flat.
  const DOM = { d: 1.4, h: 8, gap: 4 - 1.4 }, DOM_TC = Math.atan(DOM.d / DOM.h);
  const DOM_K = G * 0.6 * Math.hypot(DOM.d / 2, DOM.h / 2) / ((DOM.d * DOM.d + DOM.h * DOM.h) / 3);   // (gravity's turn on it, over its own weight to turn)
  // Something at s moving along at vs that reaches a standing domino of row D pushes it over, its middle as
  // fast as it's going (true if it did). The thing goes on through.
  function pushDominoes(D, s, vs, r) {
    if (D.raise || Math.abs(vs) < 4) return false;
    const sd = Math.sign(vs);
    let hit = false;
    for (let i = 0; i < D.ds.length; i++) {
      const th = D.th[i], c = D.ds[i] + DOM.d / 2 + Math.sin(th) * r;   // (its face, as high up as the thing)
      if (Math.abs(th) > 1.2 || Math.abs(s - c) > r + DOM.d / 2 || (c - s) * sd < -DOM.d) continue;
      const want = Math.abs(vs) / (DOM.h * 0.5);
      if (D.w[i] * sd < want) { D.w[i] = sd * want; hit = true; }
    }
    if (hit) D.still = 0;
    return hit;
  }
  function stepDominoes(D, dt) {
    const n = D.ds.length;
    if (D.raise) {   // (standing back up, all together)
      let up = true;
      for (let i = 0; i < n; i++) { D.w[i] = 0; D.th[i] -= Math.sign(D.th[i]) * Math.min(Math.abs(D.th[i]), 1.4 * dt); if (D.th[i]) up = false; }
      if (up) D.raise = false;
      return;
    }
    let down = false, moving = false;
    for (let i = 0; i < n; i++) {
      let th = D.th[i], w = D.w[i];
      if (!th && !w) continue;
      const sd = Math.sign(th || w), a = Math.abs(th), j = i + sd;
      w += sd * DOM_K * Math.sin(a - DOM_TC) * dt;
      th += w * dt;
      if (th * sd < 0) { th = 0; w = Math.abs(w) < 0.6 ? 0 : w * 0.3; }   // (rocked back up past standing: a wobble the other way, or still)
      if (Math.abs(th) >= Math.PI / 2) { th = sd * Math.PI / 2; w = 0; }   // (flat)
      // falling against the next one: no further over than lets its top rest on it, going on over with it,
      // and leaning on it
      if (j >= 0 && j < n && th * sd > 0) {
        const pj = Math.max(0, D.th[j] * sd), lim = pj + Math.asin(clamp(DOM.gap * Math.cos(pj) / DOM.h, 0, 1));
        if (th * sd > lim) {
          if (w * sd > D.w[j] * sd) D.w[j] = sd * Math.max(D.w[j] * sd, w * sd * 0.8);
          th = sd * lim; w = D.w[j] * sd > 0 ? D.w[j] : 0;
          if (lim > DOM_TC) D.w[j] += sd * 0.3 * DOM_K * Math.sin(lim - DOM_TC) * dt;
        }
      }
      D.th[i] = th; D.w[i] = w;
      if (th) down = true;
      if (Math.abs(w) > 0.05) moving = true;
    }
    // a while after they've all come to rest, they stand back up
    D.still = down && !moving ? D.still + dt : 0;
    if (D.still > 4) { D.raise = true; D.still = 0; }
  }
  // A cone slides about with friction (more standing on its base than lying on its side), down the slope
  // it's on, and bumps into the posts, walls, rails and other cones; hit hard enough it goes over, and lying
  // down it spins. Its middle: the base's, or out along it toward its tip as it goes over.
  const CONE = { r: 2.5, tc: 0.45, lie: 1.2 };
  const coneOff = c => { const k = 2.5 * Math.sin(c.tilt) / Math.sin(CONE.lie); return [Math.cos(c.dir) * k, Math.sin(c.dir) * k]; };
  function knockCone(c, w) {
    const [os, ou] = coneOff(c), ds = c.s + os - w.s, du = c.u + ou - w.u, d = Math.hypot(ds, du), R = RW + CONE.r;
    if (d >= R || d < 1e-6) return;
    const ns = ds / d, nu = du / d, rel = (w.vs - c.vs) * ns + (w.vu - c.vu) * nu;
    c.s += ns * (R - d); c.u += nu * (R - d);   // (it's shoved aside, not into anything: the ball goes on through)
    settleCone(c, false);
    if (rel <= 0) return;
    c.vs += ns * rel * 1.5; c.vu += nu * rel * 1.5; c.rest = 0;
    w.vs -= ns * rel * 0.12; w.vu -= nu * rel * 0.12;
    if (c.tilt < CONE.lie) { if (!c.tilt) c.dir = Math.atan2(nu, ns); c.tv += rel * 0.06; }
    else c.spin += rnd(-1, 1) * rel * 0.05;
  }
  // (pushed out of a circle at (s, u), r further than its own, which might be moving)
  function coneOut(c, cs, cu, s, u, r, vs = 0, vu = 0) {
    const ds = cs - s, du = cu - u, d = Math.hypot(ds, du), R = r + CONE.r;
    if (d >= R || d < 1e-6) return false;
    const ns = ds / d, nu = du / d, vn = (c.vs - vs) * ns + (c.vu - vu) * nu;
    c.s += ns * (R - d); c.u += nu * (R - d);
    if (vn < 0) { c.vs -= 1.4 * vn * ns; c.vu -= 1.4 * vn * nu; }
    return true;
  }
  function coneSeg(c, cs, cu, sg) {
    const ex = sg.bs - sg.as, ey = sg.bu - sg.au, L2 = ex * ex + ey * ey;
    if (L2 < 1e-9) return;
    const k = clamp(((cs - sg.as) * ex + (cu - sg.au) * ey) / L2, 0, 1), qs = sg.as + ex * k, qu = sg.au + ey * k;
    let sv = sg.vs || 0, uv = sg.vu || 0;
    if (sg.spin) { sv -= sg.spin * (qu - sg.au); uv += sg.spin * (qs - sg.as); }
    coneOut(c, cs, cu, qs, qu, 0, sv, uv);
  }
  // Bumping into things: posts, walls, flippers, dominoes (which it knocks over), the rails and the ends of
  // the piece, a few times over, so one wedged into a corner (say between a rail and a bumper against it)
  // settles where it touches both.
  function settleCone(c, knock) {
    const p = c.p, [os, ou] = coneOff(c), at2 = () => [c.s + os, c.u + ou];
    for (let pass = 0; pass < 3; pass++) {
      for (const o of p.obs) if (!(o.kind === 'mole' && o.up < 0.4) && Math.abs(o.s - c.s - os) < o.r + CONE.r) coneOut(c, ...at2(), o.s, o.u, o.r, o.vs, o.vu);
      for (const sg of p.segs) if (sg.on !== false) coneSeg(c, ...at2(), sg);
      for (const F of p.flips || []) coneSeg(c, ...at2(), F.seg);
      for (const D of p.doms) if (Math.abs(D.u - c.u - ou) < 2 + CONE.r) for (let i = 0; i < D.ds.length; i++) if (Math.abs(D.th[i]) < 1.2 && coneOut(c, ...at2(), D.ds[i] + DOM.d / 2, D.u, 2) && knock && !pass) pushDominoes(D, c.s + os, c.vs, CONE.r);
      const lim = (p.berm && Math.sign(c.u + ou) === p.berm ? PIPE.fb + 1 : RAIL) - CONE.r;   // (a berm's wall, or the rail)
      if (Math.abs(c.u + ou) > lim) { c.u = Math.sign(c.u + ou) * lim - ou; if (c.vu * c.u > 0) c.vu *= -0.4; }
      if (c.s + os < CONE.r && !coneOn(p, -1)) { c.s = CONE.r - os; c.vs = Math.abs(c.vs) * 0.4; } else if (c.s + os > p.len - CONE.r && !coneOn(p, 1)) { c.s = p.len - CONE.r - os; c.vs = -Math.abs(c.vs) * 0.4; }
    }
  }
  function stepCone(c, dt) {
    const p = c.p, home = p === c.hp && c.s === c.hs && c.u === c.hu;
    if (home && !c.vs && !c.vu && !c.tilt && !c.tv) return;   // (standing where it was put)
    const f = at(p, c.s, F1), lying = c.tilt >= CONE.lie;
    if (!lying && (c.tilt > 0 || c.tv)) {   // (going over, or wobbling back up)
      c.tv += 30 * Math.sin(c.tilt - CONE.tc) * dt; c.tilt += c.tv * dt;
      if (c.tilt <= 0) { c.tilt = 0; c.tv = 0; }
      if (c.tilt >= CONE.lie) { c.tilt = CONE.lie; c.tv = 0; }
    }
    if (lying && c.spin) {   // (spinning round its middle)
      const [a0, b0] = coneOff(c); c.dir += c.spin * dt; const [a1, b1] = coneOff(c);
      c.s += a0 - a1; c.u += b0 - b1; c.spin *= 1 - 1.5 * dt; if (Math.abs(c.spin) < 0.05) c.spin = 0;
    }
    c.vs -= G * 0.6 * f.T[1] * dt; c.vu -= G * 0.6 * f.B[1] * dt;
    const v = Math.hypot(c.vs, c.vu), dv = (lying ? 0.45 : 0.6) * G * dt;
    if (v <= dv) c.vs = c.vu = 0; else { c.vs -= c.vs / v * dv; c.vu -= c.vu / v * dv; }
    c.s += c.vs * dt; c.u += c.vu * dt;
    for (const o of p.cones) if (o !== c) {   // (other cones)
      const [s1, u1] = coneOff(c), [s2, u2] = coneOff(o), ds = c.s + s1 - o.s - s2, du = c.u + u1 - o.u - u2, d = Math.hypot(ds, du);
      if (d >= 2 * CONE.r || d < 1e-6) continue;
      const ns = ds / d, nu = du / d, push = (2 * CONE.r - d) / 2, vn = (c.vs - o.vs) * ns + (c.vu - o.vu) * nu;
      c.s += ns * push; c.u += nu * push; o.s -= ns * push; o.u -= nu * push;
      if (vn < 0) { const im = -0.75 * vn; c.vs += ns * im; c.vu += nu * im; o.vs -= ns * im; o.vu -= nu * im; o.rest = 0; }
      settleCone(o, false);
    }
    settleCone(c, true);
    // on off the end onto the next piece (or back onto the one before)
    if (c.s < 0 || c.s > p.len) { const fwd = c.s > 0, q = coneOn(p, fwd ? 1 : -1); if (q) moveCone(c, q, fwd ? c.s - p.len : c.s + q.len); }
    // a while after it's come to rest somewhere else, it's put back
    c.rest = !c.vs && !c.vu && !c.tv && !c.spin ? c.rest + dt : 0;
    if (c.rest > 5 && !c.hp.cones.some(o => o !== c && Math.hypot(o.s - c.hs, o.u - c.hu) < 2 * CONE.r + 0.5)) { moveCone(c, c.hp, c.hs); Object.assign(c, { u: c.hu, vs: 0, vu: 0, tilt: 0, tv: 0, spin: 0, rest: 0, pop: t }); }
  }
  // The piece after p (dir 1) or before it (-1), if the track carries straight on onto it and a cone can
  // slide about on it.
  function coneOn(p, dir) {
    const q = pieces[p.i + dir], [a, b] = dir > 0 ? [p, q] : [q, p];
    return q && !a.end && !a.lanes && !a.lane && !b.lane && !q.drum && !q.pipe && !q.tilt && !q.bridge && !q.saw && !q.craps && q.kind !== 'loop' && q.kind !== 'start' ? q : null;
  }
  function moveCone(c, q, s) {
    if (c.p !== q) { c.p.cones.splice(c.p.cones.indexOf(c), 1); q.cones.push(c); c.p = q; }
    c.s = s;
  }

  // ---- craps tables ----
  // A die tips over one of its bottom edges into the next square, turning by a quarter about the line along
  // that edge. Its footprint stretches toward the new square as it goes and shrinks back from the old one.
  // A quarter turn about an axis (x along, y up, z across), and turns put together, as row-major 3×3s:
  const turn90 = ([x, y, z]) => [x * x, x * y - z, x * z + y, y * x + z, y * y, y * z - x, z * x - y, z * y + x, z * z];
  const mul3 = (A, B) => A.map((_, i) => { const r = (i / 3) | 0, c = i % 3; return A[r * 3] * B[c] + A[r * 3 + 1] * B[3 + c] + A[r * 3 + 2] * B[6 + c]; });
  // the face on top: whichever of its own axes points up (and the faces as view3d.js puts them on: +x 3,
  // -x 4, +y 2, -y 5, +z 1, -z 6)
  const DIE_FACE = [[3, 4], [2, 5], [1, 6]], topFace = R => { for (let c = 0; c < 3; c++) if (Math.abs(R[3 + c]) > 0.5) return DIE_FACE[c][R[3 + c] > 0 ? 0 : 1]; };
  // (a die's middle on the track)
  const dieAt = (C, Dc) => [C.s0 + (Dc.ci + 0.5) * C.a, (Dc.cj - 0.5) * C.a];
  // the walls round a die's footprint, moving with it as it tips
  function dieBox(C, Dc) {
    const a = C.a, [cs, cu] = dieAt(C, Dc), r = Dc.roll;
    let ds = 1, du = 0, lo = -a / 2, hi = a / 2, vlo = 0, vhi = 0;
    if (r) { [ds, du] = r.d; lo = a / 2 - a * Math.cos(r.ph); hi = a / 2 + a * Math.sin(r.ph); vlo = a * Math.sin(r.ph) * r.w; vhi = a * Math.cos(r.ph) * r.w; }
    const P = (x, y) => [cs + ds * x - du * y, cu + du * x + ds * y], c = [P(lo, -a / 2), P(hi, -a / 2), P(hi, a / 2), P(lo, a / 2)], vm = (vlo + vhi) / 2, vel = [vm, vhi, vm, vlo];
    Dc.segs.forEach((sg, k) => { const A = c[k], B = c[(k + 1) % 4]; Object.assign(sg, { as: A[0], au: A[1], bs: B[0], bu: B[1], vs: ds * vel[k], vu: du * vel[k] }); });
  }
  // Every so often the dice are thrown: each tumbles a few squares, mostly on down the table, across it, or
  // back off the far end, never into the other's square; once they've both stopped the table calls the roll,
  // and on a 7 or 11 everyone on the table gets a boost.
  function stepCraps(C, dt, ws) {
    if (C.next < 0) C.next = t + rnd(1, 3);
    if (!C.thrown && t >= C.next) { C.thrown = true; for (const Dc of C.dice) Dc.left = ri(3, 6); }
    for (const Dc of C.dice) {
      const r = Dc.roll;
      if (r) {
        r.k = Math.min(1, r.k + dt / r.T); r.ph = Math.PI / 2 * r.k * r.k; r.w = Math.PI * r.k / r.T;   // (falling over faster and faster)
        if (r.k === 1) { Dc.ci += r.d[0]; Dc.cj += r.d[1]; Dc.R = mul3(turn90([r.d[1], 0, -r.d[0]]), Dc.R); Dc.roll = null; Dc.left--; }
      } else if (Dc.left > 0) {
        const o = C.dice.find(x => x !== Dc), taken = (ci, cj) => (o.ci === ci && o.cj === cj) || (o.roll && o.ci + o.roll.d[0] === ci && o.cj + o.roll.d[1] === cj);
        const opts = [[1, 0, 3], [-1, 0, 1], [0, 1 - 2 * Dc.cj, 2]].filter(([ds, du]) => Dc.ci + ds >= 0 && Dc.ci + ds < C.n && !taken(Dc.ci + ds, Dc.cj + du));
        if (!opts.length) Dc.left = 0;
        else { let x = Math.random() * opts.reduce((q, d) => q + d[2], 0), d = opts[0]; for (const q of opts) if ((x -= q[2]) < 0) { d = q; break; } Dc.roll = { d: [d[0], d[1]], k: 0, ph: 0, w: 0, T: rnd(0.26, 0.34) }; }
      }
      dieBox(C, Dc);
    }
    if (C.thrown && C.dice.every(Dc => !Dc.roll && !Dc.left)) {
      C.thrown = false; C.next = t + rnd(2.5, 4.5);
      const [x, y] = C.dice.map(Dc => topFace(Dc.R)), n = x + y;
      const call = n === 7 ? 'SEVEN!' : n === 11 ? 'YO-LEVEN!' : n === 2 ? 'SNAKE EYES' : n === 12 ? 'BOXCARS' : n === 3 ? 'ACE-DEUCY' : x === y ? 'HARD ' + n : n + '';
      const f = at(C.p, (dieAt(C, C.dice[0])[0] + dieAt(C, C.dice[1])[0]) / 2, fr()), win = n === 7 || n === 11;
      popup(f.P[0] + f.N[0] * 22, -(f.P[1] + f.N[1] * 22), call, win ? '#3fdc7a' : '#fffaf0', f.P[2] + f.N[2] * 22);
      if (win) for (const w of ws) if (w.m3 === 'track' && w.pi === C.p.i && !w.rank) { w.vs = Math.max(w.vs, 170); w.boostT = 1; emit(w.X, -w.Y, 10, ['#3fdc7a', '#ffd84a', '#fff'], 40, 40, 120, undefined, w.Z); }
    }
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
      const was = F.psi, rate = 1 / Math.abs(F.sweep);
      if (F.st === 1) { F.k = Math.min(1, F.k + 15 * rate * dt); if (F.k === 1) { F.st = 2; F.hold = t + 0.12; } }
      else if (F.st === 2) { if (t > F.hold) F.st = 3; }
      else if (F.st === 3) { F.k = Math.max(0, F.k - 6 * rate * dt); if (F.k === 0) { F.st = 0; F.next = t + (F.sensor ? rnd(2, 5) : rnd(0.5, 2.2)); F.cool = t + 0.4; } }
      F.psi = F.psi0 + F.sweep * F.k;
      Object.assign(F.seg, { as: F.ps, au: F.pu, bs: F.ps + Math.cos(F.psi) * F.len, bu: F.pu + Math.sin(F.psi) * F.len, spin: (F.psi - was) / dt });
    }
    for (const P of K.pads) P.th += P.w * dt;
    for (const D of K.drums) D.th += D.w * dt;
    for (const B of K.bridges) B.roll = B.A * Math.sin(B.w * t + B.ph);
    for (const M of K.movs) {
      if (M.type === 'spin') {
        M.th += M.w * dt;
        M.segs.forEach((sg, k) => { const a = M.th + k * TAU / M.n; sg.bs = M.cs + M.L * Math.cos(a); sg.bu = M.cu + M.L * Math.sin(a); sg.spin = M.w; });
      } else if (M.type === 'slide') {
        const a = M.w * t + M.ph; M.o.u = M.u0 + M.A * Math.sin(a); M.o.vu = M.A * M.w * Math.cos(a);
      } else if (M.type === 'piston') {
        const a = M.w * t + M.ph, e = M.E * (0.5 - 0.5 * Math.cos(a)), de = M.E * 0.5 * M.w * Math.sin(a), uf = M.side * (RAIL - 0.2 - e);
        M.e = e; M.front.au = M.front.bu = uf; M.front.vu = -M.side * de; M.sa.bu = M.sb.bu = uf;
      } else if (M.type === 'paddle') {
        // (a paddle at angle phi from straight down meets the balls at s + (h - RW)·tan(phi) while it's low enough)
        M.th += M.w * dt;
        const lim = Math.acos(clamp((M.h - RW) / M.R, -1, 1));
        M.segs.forEach((sg, k) => {
          const phi = wrap(M.th + k * TAU / M.n);
          sg.on = Math.abs(phi) < lim;
          if (sg.on) { const c = Math.cos(phi); sg.as = sg.bs = M.cs + (M.h - RW) * Math.tan(phi); sg.vs = M.w * (M.h - RW) / (c * c); }
        });
      }
    }
    // the see-saws: tipped by the balls on them, and back down at this end when there are none
    for (const S of K.saws) {
      S.thd += (0.03 * S.load - 0.12 - 1.0 * S.thd) * dt; S.th += S.thd * dt; S.load = 0;
      if (S.th > S.thm) { S.th = S.thm; S.thd = Math.min(0, S.thd); } else if (S.th < -S.thm) { S.th = -S.thm; S.thd = Math.max(0, S.thd); }
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
    const drum = w => w.m3 === 'track' && w.dr && pieces[w.pi].drum ? w.dr : null;
    const vel = (w, o) => {
      const d = drum(w);
      if (d) {
        const R = drumR(pieces[w.pi].drum), cx = d.air ? d.vx : R * d.phd * Math.cos(d.phi), cy = d.air ? d.vy : R * d.phd * Math.sin(d.phi), F = w.fr;
        for (let j = 0; j < 3; j++) o[j] = w.vs * F.T[j] + cx * F.B[j] + cy * F.N[j];
      } else if (w.m3 === 'track') { o[0] = w.vs * w.fr.T[0] + w.vu * w.fr.B[0]; o[1] = w.vs * w.fr.T[1] + w.vu * w.fr.B[1]; o[2] = w.vs * w.fr.T[2] + w.vu * w.fr.B[2]; }
      else if (round(w)) { const [cr, sr, ct, st] = radial(w), vt = w.fL / w.frad; o[0] = w.fvr * cr + vt * ct; o[1] = 0; o[2] = w.fvr * sr + vt * st; }
      else { o[0] = w.vx; o[1] = w.vy; o[2] = w.vz; }
      return o;
    };
    const nudge = (w, x, y, z, isVel) => {
      const d = drum(w);
      if (d) {
        const F = w.fr, R = drumR(pieces[w.pi].drum), ds = x * F.T[0] + y * F.T[1] + z * F.T[2], db = x * F.B[0] + y * F.B[1] + z * F.B[2], dn = x * F.N[0] + y * F.N[1] + z * F.N[2];
        if (isVel) { w.vs += ds; if (d.air) { d.vx += db; d.vy += dn; } else d.phd += (db * Math.cos(d.phi) + dn * Math.sin(d.phi)) / R; }
        else { w.s += ds; if (d.air) { d.x += db; d.y += dn; } else d.phi += (db * Math.cos(d.phi) + dn * Math.sin(d.phi)) / R; }
      } else if (round(w)) {
        const [cr, sr, ct, st] = radial(w), dr = x * cr + z * sr, dt2 = x * ct + z * st;
        if (isVel) { w.fvr += dr; w.fL += w.frad * dt2; } else { w.frad = clamp(w.frad + dr, w.F.rs + 0.5, w.F.R - RW - 0.6); w.fth += dt2 / w.frad; }
      } else if (w.m3 === 'track') {
        const ds = x * w.fr.T[0] + y * w.fr.T[1] + z * w.fr.T[2], du = x * w.fr.B[0] + y * w.fr.B[1] + z * w.fr.B[2];
        if (isVel) { w.vs += ds; w.vu += du; } else { const q = pieces[w.pi]; w.s += ds; w.u = clamp(w.u + du, -ubAt(q, w.s, -1), ubAt(q, w.s, 1)); }
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
    if (w.dr) { w.prog = t; return; }   // (tumbling in a lottery drum: it'll be out in a moment)
    if (Math.abs(w.vs) < 8 && !pieces[w.pi].tilt) w.idle += dt; else w.idle = Math.max(0, w.idle - 2 * dt);   // (against a row of mahjong tiles it's rolling along to the gap)
    if (w.idle > 1.2) { w.idle = 0; w.kicks++; note('kick ' + pieces[w.pi].kind); w.vs = 90; w.vu = rnd(-30, 30); }
    if (w.dist > (w.best ?? -1) + 3) { w.best = w.dist; w.prog = t; }
    else if (t - w.prog > 8) { note('lift ' + pieces[w.pi].kind); w.s += 30; w.prog = t; w.warps++; if (w.s >= pieces[w.pi].len && pieces[w.pi].end) { w.s = 2; w.pi = pieces[w.pi].landOn; } }
  }

  function step(ws, dt, racing) {
    t += dt;
    movers(dt);
    for (const C of K.craps) stepCraps(C, dt, ws);
    for (const D of K.doms) stepDominoes(D, dt);
    for (const c of K.cones) stepCone(c, dt);
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
  // effects that aren't physics: slot payouts
  function update() {
    for (const S of K.slots) if (S.payAt && t >= S.payAt) {
      S.payAt = 0; S.won = t;
      const w = S.who;
      if (w && w.m3 === 'track') { w.vs = Math.max(w.vs, 200); w.boostT = 1.5; popup(w.X, -w.Y - 10, 'JACKPOT', '#ffd84a', w.Z); emit(w.X, -w.Y, 24, ['#ffd84a', '#fff3a8', '#e8a020'], 60, 80, 200, [0.5, 1.1], w.Z); }
      const f = at(S.p, S.s, fr()), x = f.P[0] + f.B[0] * S.side * (HW + 16), y = f.P[1] + 30, z = f.P[2] + f.B[2] * S.side * (HW + 16);
      emit(x, -y, 28, ['#ffd84a', '#fff3a8', '#e8a020'], 60, 120, 260, [0.6, 1.3], z);
      popup(x, -y - 10, 'JACKPOT', '#ffd84a', z);
    }
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

  return { build, spawn, open, step, update, time, at, fr, boost, rollAt, W, HW };
}
