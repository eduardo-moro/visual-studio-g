import { compile } from '../src/lang/compile';
import { VisualgError } from '../src/lang/errors';
import { DebugHooks, FileAccess, Interpreter, IO } from '../src/runtime/interpreter';

export interface RunResult {
  out: string;
  error?: VisualgError;
  status?: 'fim' | 'parado';
}

/** Wraps statements in a minimal algorithm, declaring `vars` (VisuAlg syntax). */
export function prog(vars: string, body: string, subs = ''): string {
  return `algoritmo "teste"\nvar\n${vars}\n${subs}\ninicio\n${body}\nfimalgoritmo\n`;
}

export async function run(src: string, inputs: string[] = [], opts: { seed?: number; hooks?: DebugHooks; files?: FileAccess } = {}): Promise<RunResult> {
  const { analysis, errors } = compile(src);
  if (errors.length) return { out: '', error: errors[0] };
  let out = '';
  const queue = [...inputs];
  const io: IO = {
    write: (t) => (out += t),
    readLine: async () => (queue.length ? queue.shift()! : null),
    clear: () => (out += '<limpatela>'),
    setColor: () => {},
  };
  const interp = new Interpreter(analysis!, { io, seed: opts.seed ?? 42, hooks: opts.hooks, files: opts.files });
  try {
    const status = await interp.run();
    return { out, status };
  } catch (e) {
    if (e instanceof VisualgError) return { out, error: e };
    throw e;
  }
}
