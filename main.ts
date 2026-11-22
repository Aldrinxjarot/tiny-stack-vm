// A tiny stack virtual machine for make.fun's tiny stack ISA v1 (ISA.md): wrapping 32-bit integers,
// a 256-value stack, 64-deep calls, 256 words of memory, ten traps, step and output limits.
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// Per-opcode facts by byte: immediate bytes, pops, pushes. IMM -1 marks a non-opcode (traps 5).
const IMM = new Int8Array(256).fill(-1);
const POPS = new Int8Array(256);
const PUSHES = new Int8Array(256);
// Binary ops 0x10..0x22 (not 0x1f) pop 2, push 1; the table fixes NEG/NOT and names the rest.
for (let op = 0x10; op <= 0x22; op++) if (op !== 0x1f) { IMM[op] = 0; POPS[op] = 2; PUSHES[op] = 1; }
const T = [
  [0x00, 0, 0, 0], [0x01, 1, 0, 1], [0x02, 4, 0, 1], [0x03, 0, 1, 0], [0x04, 0, 1, 2], [0x05, 0, 2, 2],
  [0x06, 0, 2, 3], [0x07, 0, 3, 3], [0x17, 0, 1, 1], [0x1b, 0, 1, 1], [0x30, 2, 0, 0], [0x31, 2, 1, 0],
  [0x32, 2, 1, 0], [0x33, 2, 0, 0], [0x34, 0, 0, 0], [0x40, 0, 1, 1], [0x41, 0, 2, 0], [0x50, 0, 1, 0],
  [0x51, 0, 1, 0], [0x52, 0, 0, 1], [0x53, 0, 1, 0],
];
for (const [op, i, p, q] of T) { IMM[op] = i; POPS[op] = p; PUSHES[op] = q; }

const STACK_MAX = 256, CALLS_MAX = 64, OUT_MAX = 65_536;
const enc = new TextEncoder();

// Runs a program to its end; returns its bytes and exit code (a trap's code when it traps). Step
// checks run in ISA.md's order: step limit, pc range, known opcode, immediate fits, stack needs.
function run(prog: Uint8Array, input: Uint8Array) {
  const n = prog.length;
  const D = new Int32Array(STACK_MAX); let sp = 0;
  const C = new Int32Array(CALLS_MAX); let csp = 0;
  const M = new Int32Array(256);
  const out = new Uint8Array(OUT_MAX); let olen = 0;
  let inPos = 0, pc = 0, steps = 0;
  const end = (code: number) => ({ out: out.slice(0, olen), code });
  for (;;) {
    if (steps === 1_000_000) return end(10);
    if (pc < 0 || pc >= n) return end(9);
    const op = prog[pc];
    const imm = IMM[op];
    if (imm < 0) return end(5);
    if (pc + imm >= n) return end(9);
    steps++;
    if (sp < POPS[op]) return end(2);
    if (sp - POPS[op] + PUSHES[op] > STACK_MAX) return end(3);
    const next = pc + 1 + imm;
    pc = next;
    switch (op) {
      case 0x00: return end(0); // HALT
      case 0x01: D[sp++] = (prog[next - 1] << 24) >> 24; break; // PUSH8
      case 0x02: // PUSH32
        D[sp++] = prog[next - 4] | (prog[next - 3] << 8) | (prog[next - 2] << 16) | (prog[next - 1] << 24);
        break;
      case 0x03: sp--; break; // POP
      case 0x04: D[sp] = D[sp - 1]; sp++; break; // DUP
      case 0x05: { const t = D[sp - 1]; D[sp - 1] = D[sp - 2]; D[sp - 2] = t; break; } // SWAP
      case 0x06: D[sp] = D[sp - 2]; sp++; break; // OVER
      case 0x07: { // ROT: ( a b c -- b c a )
        const a = D[sp - 3]; D[sp - 3] = D[sp - 2]; D[sp - 2] = D[sp - 1]; D[sp - 1] = a; break;
      }
      case 0x17: D[sp - 1] = -D[sp - 1] | 0; break; // NEG
      case 0x1b: D[sp - 1] = ~D[sp - 1]; break; // NOT
      case 0x10: case 0x11: case 0x12: case 0x13: case 0x14: case 0x15: case 0x16:
      case 0x18: case 0x19: case 0x1a: case 0x1c: case 0x1d: case 0x1e:
      case 0x20: case 0x21: case 0x22: {
        const b = D[sp - 1], a = D[sp - 2];
        let r: number;
        if (op === 0x10) r = (a + b) | 0;
        else if (op === 0x11) r = (a - b) | 0;
        else if (op === 0x12) r = Math.imul(a, b); // MUL: exact low 32 bits
        else if (op === 0x13) { // DIV: truncates; -2^31 / -1 is -2^31
          if (b === 0) return end(4);
          r = a === -2147483648 && b === -1 ? a : (a / b) | 0;
        } else if (op === 0x14) { // MOD: sign of a; x % -1 is 0
          if (b === 0) return end(4);
          r = b === -1 ? 0 : (a % b) | 0;
        } else if (op === 0x15) { // DIVU: unsigned operands
          if (b === 0) return end(4);
          r = Math.floor((a >>> 0) / (b >>> 0)) | 0;
        } else if (op === 0x16) {
          if (b === 0) return end(4);
          r = ((a >>> 0) % (b >>> 0)) | 0;
        } else if (op === 0x18) r = a & b;
        else if (op === 0x19) r = a | b;
        else if (op === 0x1a) r = a ^ b;
        else if (op === 0x1c) r = a << (b & 31); // counts: low 5 bits
        else if (op === 0x1d) r = a >> (b & 31);
        else if (op === 0x1e) r = (a >>> (b & 31)) | 0;
        else if (op === 0x20) r = a === b ? 1 : 0;
        else if (op === 0x21) r = a < b ? 1 : 0;
        else r = (a >>> 0) < (b >>> 0) ? 1 : 0;
        D[sp - 2] = r; sp--;
        break;
      }
      case 0x30: case 0x31: case 0x32: { // jumps: target unchecked
        const rel = ((prog[next - 2] | (prog[next - 1] << 8)) << 16) >> 16;
        let take = op === 0x30;
        if (!take) { const v = D[--sp]; take = op === 0x31 ? v === 0 : v !== 0; }
        if (take) pc = next + rel;
        break;
      }
      case 0x33: // CALL: absolute address
        if (csp === CALLS_MAX) return end(7);
        C[csp++] = next;
        pc = prog[next - 2] | (prog[next - 1] << 8);
        break;
      case 0x34: // RET
        if (csp === 0) return end(8);
        pc = C[--csp];
        break;
      case 0x40: { // LOAD
        const addr = D[sp - 1];
        if (addr < 0 || addr > 255) return end(6);
        D[sp - 1] = M[addr];
        break;
      }
      case 0x41: { // STORE: ( v addr -- )
        const addr = D[sp - 1];
        if (addr < 0 || addr > 255) return end(6);
        M[addr] = D[sp - 2]; sp -= 2;
        break;
      }
      case 0x50: { // PRINT: over limit, writes nothing
        const bytes = enc.encode(String(D[sp - 1]));
        if (olen + bytes.length > OUT_MAX) return end(11);
        sp--; out.set(bytes, olen); olen += bytes.length;
        break;
      }
      case 0x51: // PUTC
        if (olen + 1 > OUT_MAX) return end(11);
        out[olen++] = D[--sp] & 255;
        break;
      case 0x52: D[sp++] = inPos < input.length ? input[inPos++] : -1; break; // IN: -1 past the end
      case 0x53: return end(D[--sp] & 255); // EXIT: the low byte
    }
  }
}

const I = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const O = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';
for (const id of readdirSync(I).sort()) {
  let prog = new Uint8Array(0), input = new Uint8Array(0);
  try { prog = new Uint8Array(readFileSync(join(I, id, 'program.bin'))); } catch { /* missing = empty */ }
  try { input = new Uint8Array(readFileSync(join(I, id, 'input.bin'))); } catch { /* missing = empty */ }
  const r = run(prog, input);
  mkdirSync(join(O, id), { recursive: true });
  writeFileSync(join(O, id, 'stdout.bin'), r.out);
  writeFileSync(join(O, id, 'exit.txt'), `${r.code}\n`);
}
