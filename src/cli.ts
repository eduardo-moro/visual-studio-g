#!/usr/bin/env node
import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline';
import { compile, decodeSource } from './lang/compile';
import { VisualgError } from './lang/errors';
import { nodeFiles } from './runtime/files';
import { Interpreter, IO } from './runtime/interpreter';

const ANSI_FG: Record<string, number> = { black: 30, red: 31, green: 32, yellow: 33, blue: 34, magenta: 35, cyan: 36, white: 37, gray: 90 };

function usage(): never {
  process.stderr.write('Uso: visualg [--seed N] [--check] arquivo.alg\n');
  process.exit(2);
}

async function main(): Promise<number> {
  const args = process.argv.slice(2);
  let seed: number | undefined;
  let checkOnly = false;
  let file: string | undefined;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--seed') seed = Number(args[++i]);
    else if (args[i] === '--check') checkOnly = true;
    else if (args[i] === '-h' || args[i] === '--help') usage();
    else file = args[i];
  }
  if (!file) usage();

  const src = decodeSource(fs.readFileSync(file));
  const { analysis, errors } = compile(src);
  const tty = process.stdout.isTTY;
  const red = (s: string) => (process.stderr.isTTY ? `\x1b[31m${s}\x1b[0m` : s);
  if (errors.length) {
    for (const e of errors) process.stderr.write(red(`${file}:${e.span.line}:${e.span.col}: erro: ${e.message}\n`));
    return 1;
  }
  if (checkOnly) return 0;

  // Input: one line per leia. Lines typed (or piped) ahead of time are queued.
  const rl = readline.createInterface({ input: process.stdin, terminal: false });
  const queue: string[] = [];
  const waiting: ((l: string | null) => void)[] = [];
  let closed = false;
  rl.on('line', (l) => (waiting.length ? waiting.shift()!(l) : queue.push(l)));
  rl.on('close', () => {
    closed = true;
    while (waiting.length) waiting.shift()!(null);
  });

  const io: IO = {
    write: (t) => process.stdout.write(t),
    readLine: () => (queue.length ? Promise.resolve(queue.shift()!) : closed ? Promise.resolve(null) : new Promise((r) => waiting.push(r))),
    clear: () => tty && process.stdout.write('\x1b[2J\x1b[3J\x1b[H'),
    setColor: (fg, bg) => {
      if (!tty) return;
      if (fg) process.stdout.write(`\x1b[${ANSI_FG[fg] ?? 39}m`);
      if (bg) process.stdout.write(`\x1b[${(ANSI_FG[bg] ?? 39) + 10}m`);
    },
  };

  const interp = new Interpreter(analysis!, { io, seed, baseDir: path.dirname(path.resolve(file)), files: nodeFiles });
  process.on('SIGINT', () => interp.stop());
  try {
    const result = await interp.run();
    if (result === 'parado' && closed) process.stderr.write(red('\n*** Execução interrompida: a entrada terminou e o programa ainda esperava um leia ***\n'));
    return result === 'fim' ? 0 : 130;
  } catch (e) {
    if (e instanceof VisualgError) {
      process.stderr.write(red(`\n${file}:${e.span.line}:${e.span.col}: erro de execução: ${e.message}\n`));
      return 1;
    }
    throw e;
  } finally {
    if (tty) process.stdout.write('\x1b[0m');
    rl.close();
  }
}

main().then((code) => process.exit(code));
