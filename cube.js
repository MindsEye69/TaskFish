#!/usr/bin/env node
// Spinning ASCII cube — same machinery as a1k0n's donut
// (https://www.a1k0n.net/2011/07/20/donut-math.html), but the surface
// being sampled is the six faces of a cube instead of a torus.
//
// Donut:  point on surface = two angles (theta, phi) swept around a circle.
// Cube:   point on surface = (u, v) swept over each face; the face's unit
//         normal is constant, which makes the lighting step trivial.
//
// Run:    node cube.js          (Ctrl+C to quit)
//         node cube.js --frame  (print a single frame and exit)

const W = 80, H = 24;
const K2 = 5;        // distance from viewer to cube centre
const K1 = 22;       // projection scale, tuned so the rotated cube fills the frame
const STEP = 0.03;   // sampling step across each face, over [-1, 1]
const CHARS = ".,-~:;=!*#$@";

// Light direction (pointing toward the light), normalized — same as the donut:
// above and behind the viewer.
const LY = 1 / Math.SQRT2, LZ = -1 / Math.SQRT2;

function renderFrame(A, B) {
  const cA = Math.cos(A), sA = Math.sin(A);
  const cB = Math.cos(B), sB = Math.sin(B);
  const out = new Array(W * H).fill(' ');
  const zbuf = new Float64Array(W * H); // stores 1/z; larger means closer

  // One sampled surface point: position (x,y,z), unit normal (nx,ny,nz).
  function plot(x, y, z, nx, ny, nz) {
    // Rotate about X by A, then about Y by B — positions and normals alike.
    const y1 = y * cA - z * sA;
    const z1 = y * sA + z * cA;
    const x2 = x * cB + z1 * sB;
    const z2 = -x * sB + z1 * cB;

    const ny1 = ny * cA - nz * sA;
    const nz1 = ny * sA + nz * cA;
    const nz2 = -nx * sB + nz1 * cB;

    const ooz = 1 / (z2 + K2);
    // x is scaled 2x because terminal cells are ~twice as tall as wide.
    const xp = Math.floor(W / 2 + 2 * K1 * ooz * x2);
    const yp = Math.floor(H / 2 - K1 * ooz * y1);
    if (xp < 0 || xp >= W || yp < 0 || yp >= H) return;

    const idx = xp + yp * W;
    if (ooz <= zbuf[idx]) return; // something nearer already drawn here
    zbuf[idx] = ooz;

    // Luminance = normal . light. Unlike the donut we keep L <= 0 points
    // (drawn as the dimmest char) so camera-facing but unlit faces don't
    // appear as holes.
    const L = ny1 * LY + nz2 * LZ;
    out[idx] = CHARS[Math.max(0, Math.round(L * (CHARS.length - 1)))];
  }

  // Sweep (u, v) over [-1,1]^2 and stamp all six faces at once:
  // for each axis, the two faces are at +1 and -1 along that axis.
  for (let u = -1; u <= 1; u += STEP) {
    for (let v = -1; v <= 1; v += STEP) {
      for (const s of [-1, 1]) {
        plot(s, u, v, s, 0, 0); // x = +/-1 faces
        plot(u, s, v, 0, s, 0); // y = +/-1 faces
        plot(u, v, s, 0, 0, s); // z = +/-1 faces
      }
    }
  }

  const rows = [];
  for (let r = 0; r < H; r++) rows.push(out.slice(r * W, (r + 1) * W).join(''));
  return rows.join('\n');
}

if (process.argv.includes('--frame')) {
  console.log(renderFrame(0.9, 0.5));
} else {
  let A = 0, B = 0;
  process.stdout.write('\x1b[2J\x1b[?25l'); // clear screen, hide cursor
  const timer = setInterval(() => {
    process.stdout.write('\x1b[H' + renderFrame(A, B));
    A += 0.04;
    B += 0.02;
  }, 50);
  process.on('SIGINT', () => {
    clearInterval(timer);
    process.stdout.write('\x1b[?25h\n'); // restore cursor
    process.exit(0);
  });
}
