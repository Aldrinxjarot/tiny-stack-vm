// Tiny stack VM (make.fun tiny stack ISA v1): wrapping 32-bit ints, exact ISA.md trap order/codes.
import { mkdirSync as mk, readdirSync as rd, readFileSync as rf, writeFileSync as wf } from 'node:fs';
import { join as J } from 'node:path';
// Opcode tables by byte: immediate bytes, pops, pushes. A = -1 marks a non-opcode.
const A = new Int8Array(256).fill(-1), P = new Int8Array(256), Q = new Int8Array(256);
for (let o = 16; o < 35; o++) if (o != 31) { A[o] = 0; P[o] = 2; Q[o] = 1; } // binops
for (const t of [[0, 0, 0, 0], [1, 1, 0, 1], [2, 4, 0, 1], [3, 0, 1, 0], [4, 0, 1, 2], [5, 0, 2, 2], [6, 0, 2, 3], [7, 0, 3, 3], [23, 0, 1, 1], [27, 0, 1, 1], [48, 2, 0, 0], [49, 2, 1, 0], [50, 2, 1, 0], [51, 2, 0, 0], [52, 0, 0, 0], [64, 0, 1, 1], [65, 0, 2, 0], [80, 0, 1, 0], [81, 0, 1, 0], [82, 0, 0, 1], [83, 0, 1, 0]]) { A[t[0]] = t[1]; P[t[0]] = t[2]; Q[t[0]] = t[3]; }
const E = new TextEncoder();
function run(g: Uint8Array, inp: Uint8Array) {
  const n = g.length, D = new Int32Array(256), C = new Int32Array(64), M = new Int32Array(256), out = new Uint8Array(65536);
  let sp = 0, cs = 0, ol = 0, ip = 0, pc = 0, st = 0;
  const end = (c: number) => ({ out: out.slice(0, ol), code: c });
  for (;;) {
    if (st == 1e6) return end(10);
    if (pc < 0 || pc >= n) return end(9);
    const op = g[pc], im = A[op];
    if (im < 0) return end(5);
    if (pc + im >= n) return end(9);
    st++;
    if (sp < P[op]) return end(2);
    if (sp - P[op] + Q[op] > 256) return end(3);
    const nx = pc + 1 + im;
    pc = nx;
    switch (op) {
      case 0: return end(0); // HALT
      case 1: D[sp++] = (g[nx - 1] << 24) >> 24; break; // PUSH8: sign-extended byte
      case 2: D[sp++] = g[nx - 4] | g[nx - 3] << 8 | g[nx - 2] << 16 | g[nx - 1] << 24; break; // PUSH32
      case 3: sp--; break; // POP
      case 4: D[sp] = D[sp - 1]; sp++; break; // DUP
      case 5: { const t = D[sp - 1]; D[sp - 1] = D[sp - 2]; D[sp - 2] = t; break; } // SWAP
      case 6: D[sp] = D[sp - 2]; sp++; break; // OVER
      case 7: { const t = D[sp - 3]; D[sp - 3] = D[sp - 2]; D[sp - 2] = D[sp - 1]; D[sp - 1] = t; break; } // ROT
      case 23: D[sp - 1] = -D[sp - 1] | 0; break; // NEG
      case 27: D[sp - 1] = ~D[sp - 1]; break; // NOT
      case 16: case 17: case 18: case 19: case 20: case 21: case 22: case 24: case 25: case 26: case 28: case 29: case 30: case 32: case 33: case 34: {
        const b = D[sp - 1], a = D[sp - 2];
        let r: number;
        if (op == 16) r = a + b | 0;
        else if (op == 17) r = a - b | 0;
        else if (op == 18) r = Math.imul(a, b); // exact low 32 bits
        else if (op == 19) { if (!b) return end(4); r = a == -2147483648 && b == -1 ? a : a / b | 0; } // DIV truncates
        else if (op == 20) { if (!b) return end(4); r = b == -1 ? 0 : a % b | 0; } // MOD: sign of a
        else if (op == 21) { if (!b) return end(4); r = Math.floor((a >>> 0) / (b >>> 0)) | 0; } // DIVU
        else if (op == 22) { if (!b) return end(4); r = (a >>> 0) % (b >>> 0) | 0; } // MODU
        else if (op == 24) r = a & b;
        else if (op == 25) r = a | b;
        else if (op == 26) r = a ^ b;
        else if (op == 28) r = a << (b & 31); // shift counts: low 5 bits
        else if (op == 29) r = a >> (b & 31);
        else if (op == 30) r = a >>> (b & 31);
        else if (op == 32) r = a == b ? 1 : 0;
        else if (op == 33) r = a < b ? 1 : 0;
        else r = (a >>> 0) < (b >>> 0) ? 1 : 0; // LTU
        D[sp - 2] = r; sp--;
        break;
      }
      case 48: case 49: case 50: { // JMP / JZ / JNZ: target unchecked until the next fetch
        const rel = (g[nx - 2] | g[nx - 1] << 8) << 16 >> 16;
        let tk = op == 48;
        if (!tk) { const v = D[--sp]; tk = op == 49 ? v == 0 : v != 0; }
        if (tk) pc = nx + rel;
        break;
      }
      case 51: // CALL: absolute address
        if (cs == 64) return end(7);
        C[cs++] = nx;
        pc = g[nx - 2] | g[nx - 1] << 8;
        break;
      case 52: // RET
        if (!cs) return end(8);
        pc = C[--cs];
        break;
      case 64: { const a = D[sp - 1]; if (a < 0 || a > 255) return end(6); D[sp - 1] = M[a]; break; } // LOAD
      case 65: { const a = D[sp - 1]; if (a < 0 || a > 255) return end(6); M[a] = D[sp - 2]; sp -= 2; break; } // STORE
      case 80: { // PRINT: over the output limit, writes nothing
        const y = E.encode(String(D[sp - 1]));
        if (ol + y.length > 65536) return end(11);
        sp--; out.set(y, ol); ol += y.length;
        break;
      }
      case 81: // PUTC
        if (ol == 65536) return end(11);
        out[ol++] = D[--sp] & 255;
        break;
      case 82: D[sp++] = ip < inp.length ? inp[ip++] : -1; break; // IN: -1 past the end
      case 83: return end(D[--sp] & 255); // EXIT: the low byte
    }
  }
}
const I = process.env.MAKEFUN_INPUT_DIR ?? '/input', O = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';
for (const id of rd(I).sort()) {
  let g = new Uint8Array(0), inp = new Uint8Array(0);
  try { g = new Uint8Array(rf(J(I, id, 'program.bin'))); } catch {} // missing = empty
  try { inp = new Uint8Array(rf(J(I, id, 'input.bin'))); } catch {}
  const r = run(g, inp);
  mk(J(O, id), { recursive: true });
  wf(J(O, id, 'stdout.bin'), r.out);
  wf(J(O, id, 'exit.txt'), r.code + '\n');
}
