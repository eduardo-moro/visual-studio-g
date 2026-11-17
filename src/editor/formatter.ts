import { normalize } from '../lang/lexer';

/** Code words of a line, normalized, ignoring strings and the // comment. */
function words(line: string): string[] {
  const code = line.replace(/"[^"]*"?/g, '""').replace(/\/\/.*$/, '');
  return (code.match(/[\p{L}_][\p{L}\p{M}\p{N}_]*/gu) ?? []).map(normalize);
}

const CLOSERS = new Set(['fimse', 'fimpara', 'fimenquanto', 'fimrepita', 'fimescolha', 'fimregistro']);
/** Written at column 0. */
const SECTIONS = new Set(['algoritmo', 'var', 'variavel', 'const', 'tipo', 'procedimento', 'funcao', 'inicio', 'fimalgoritmo', 'fimprocedimento', 'fimfuncao', 'fimfun']);
/** Their contents are indented one level. */
const INDENTED_SECTIONS = new Set(['var', 'variavel', 'const', 'tipo', 'inicio']);

/**
 * Re-indents a VisuAlg program in the style of VisuAlg's own templates:
 * sections (algoritmo, var, inicio, procedimento, ...) at column 0, everything inside them one level in,
 * plus one level per se/para/enquanto/repita/escolha/caso.
 */
export function formatSource(src: string, indentUnit = '   '): string {
  const lines = src.split(/\r?\n/);
  const out: string[] = [];
  // Each open block: the keyword that opened it.
  const stack: string[] = [];
  let base = 0; // 1 inside var/const/tipo/inicio sections, 0 elsewhere

  for (const raw of lines) {
    const text = raw.trim();
    if (!text) {
      out.push('');
      continue;
    }
    const w = words(text);
    const first = w[0] ?? '';
    let level: number;

    if (SECTIONS.has(first) && stack.length === 0) {
      out.push(text);
      base = INDENTED_SECTIONS.has(first) ? 1 : 0;
      continue;
    }
    if (SECTIONS.has(first) && first !== 'var' && first !== 'tipo') {
      // A section keyword with blocks still open: unbalanced code, start over.
      stack.length = 0;
      out.push(text);
      base = INDENTED_SECTIONS.has(first) ? 1 : 0;
      continue;
    }

    // Lines that close (or continue) a block are written at the opener's level.
    let closes = 0;
    if (CLOSERS.has(first) || (first === 'ate' && stack[stack.length - 1] === 'repita')) {
      if (stack[stack.length - 1] === 'caso') stack.pop();
      level = base + Math.max(stack.length - 1, 0);
      closes = 1;
    } else if (first === 'senao' && stack[stack.length - 1] === 'se') {
      level = base + stack.length - 1;
    } else if ((first === 'caso' || first === 'outrocaso') && stack.includes('escolha')) {
      if (stack[stack.length - 1] === 'caso') stack.pop();
      level = base + stack.length;
      stack.push('caso');
      out.push(indentUnit.repeat(level) + text);
      continue;
    } else {
      level = base + stack.length;
    }
    if (closes) stack.pop();
    out.push(indentUnit.repeat(level) + text);

    // Blocks opened on this line (unless also closed on it, e.g. "se x entao y fimse").
    if (!closes) {
      const opener =
        first === 'se' && w.includes('entao') ? 'se'
          : first === 'para' && w.includes('faca') ? 'para'
            : first === 'enquanto' ? 'enquanto'
              : first === 'repita' ? 'repita'
                : first === 'escolha' ? 'escolha'
                  : w.includes('registro') && !w.includes('fimregistro') ? 'registro'
                    : undefined;
      const closedSameLine = w.slice(1).some((x) => CLOSERS.has(x));
      if (opener && !closedSameLine) stack.push(opener);
    }
  }
  return out.join('\n');
}
