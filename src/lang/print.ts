import { Expr } from './ast';
import { formatNumber } from '../runtime/values';

const PREC: Record<string, number> = {
  ou: 1, xou: 1, e: 2, '=': 4, '<>': 4, '<': 4, '>': 4, '<=': 4, '>=': 4,
  '+': 5, '-': 5, '*': 6, '/': 6, '\\': 6, mod: 6, '^': 7,
};

const SHOW: Record<string, string> = { '<>': '≠', '<=': '≤', '>=': '≥' };

/** Expression as readable text (for the flowchart). `pretty` uses ≤ ≥ ≠. */
export function exprToString(e: Expr, pretty = true, parent = 0): string {
  let s: string;
  let p: number;
  switch (e.kind) {
    case 'num':
      return formatNumber(e.value);
    case 'str':
      return `"${e.value}"`;
    case 'bool':
      return e.value ? 'VERDADEIRO' : 'FALSO';
    case 'var':
      return e.name;
    case 'index':
      return `${exprToString(e.target, pretty, 9)}[${e.indices.map((i) => exprToString(i, pretty)).join(', ')}]`;
    case 'field':
      return `${exprToString(e.target, pretty, 9)}.${e.name}`;
    case 'call':
      return e.hasParens || e.args.length ? `${e.name}(${e.args.map((a) => exprToString(a, pretty)).join(', ')})` : e.name;
    case 'unary':
      p = e.op === 'nao' ? 3 : 8;
      s = e.op === 'nao' ? `nao ${exprToString(e.operand, pretty, p)}` : `${e.op}${exprToString(e.operand, pretty, p)}`;
      break;
    case 'binary': {
      p = PREC[e.op];
      const op = pretty ? SHOW[e.op] ?? e.op : e.op;
      // ^ is right-associative; the others are left-associative.
      const lp = e.op === '^' ? p + 1 : p;
      const rp = e.op === '^' ? p : p + 1;
      s = `${exprToString(e.left, pretty, lp)} ${op} ${exprToString(e.right, pretty, rp)}`;
      break;
    }
  }
  return p < parent ? `(${s})` : s;
}
