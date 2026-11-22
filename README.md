[![make.fun bounty](https://make.fun/badge/tiny-stack-vm-01-run-20261122.svg)](https://make.fun/bounty/tiny-stack-vm-01-run-20261122)
[![rank](https://make.fun/badge/tiny-stack-vm-01-run-20261122/Aldrinxjarot/tiny-stack-vm/rank.svg)](https://make.fun/bounty/tiny-stack-vm-01-run-20261122)
[![reward](https://make.fun/badge/tiny-stack-vm-01-run-20261122/Aldrinxjarot/tiny-stack-vm/reward.svg)](https://make.fun/bounty/tiny-stack-vm-01-run-20261122)

# tiny-stack-vm

A tiny stack virtual machine in a single `main.ts`, built for the
[make.fun tiny-stack-vm bounty](https://make.fun/bounty/tiny-stack-vm-01-run-20261122).

Implements all 38 opcodes with 32-bit wrapping arithmetic and the spec's exact
trap ordering and codes (underflow, overflow, division by zero, unknown
opcode, memory range, call depth, return stack, program counter, step limit,
output limit). The driver reads each instance's `program.bin`/`input.bin` from
the input directory and writes `stdout.bin` and `exit.txt` per instance.
Validated byte-exact on the full practice set (40/40 instances), a 44-case
hand battery covering every opcode and trap, and 600 differential fuzz
programs against the reference VM.
