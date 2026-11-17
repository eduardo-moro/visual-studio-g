import { Span, VisualgError } from './errors';

export type TokKind = 'id' | 'num' | 'str' | 'op' | 'nl' | 'eof';

export interface Token {
  kind: TokKind;
  /** Raw text as written (for strings: the content without quotes). */
  text: string;
  /** For ids: lowercased, accents removed — keywords and names compare on this. */
  norm: string;
  /** For numbers. */
  value?: number;
  /** Number literal written with a decimal point or exponent. */
  isReal?: boolean;
  span: Span;
}

/** Lowercase and strip diacritics: "ENTÃO" -> "entao", "Faça" -> "faca". */
export function normalize(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

const OPS = ['<-', ':=', '<=', '>=', '<>', '!=', '..', '←', '=', '<', '>', '+', '-', '*', '/', '\\', '^', '%', '(', ')', '[', ']', ',', ':', ';', '.'];

const isIdStart = (c: string) => /[\p{L}_]/u.test(c);
const isIdPart = (c: string) => /[\p{L}\p{M}\p{N}_]/u.test(c);
const isDigit = (c: string) => c >= '0' && c <= '9';

export function tokenize(src: string): Token[] {
  const toks: Token[] = [];
  let i = 0;
  let line = 1;
  let lineStart = 0;
  const col = () => i - lineStart + 1;
  const push = (kind: TokKind, text: string, startCol: number, extra: Partial<Token> = {}) => {
    const len = extra.span ? 0 : text.length;
    toks.push({
      kind,
      text,
      norm: kind === 'id' ? normalize(text) : text,
      span: { line, col: startCol, endLine: line, endCol: startCol + Math.max(len, 1) },
      ...extra,
    });
  };

  while (i < src.length) {
    const c = src[i];
    if (c === '\n') {
      push('nl', '\n', col());
      i++;
      line++;
      lineStart = i;
      continue;
    }
    if (c === ' ' || c === '\t' || c === '\r' || c === '\f' || c === '\v' || c === ' ' || c === '﻿') {
      i++;
      continue;
    }
    if (c === '/' && src[i + 1] === '/') {
      while (i < src.length && src[i] !== '\n') i++;
      continue;
    }
    const startCol = col();
    if (c === '"' || c === '“' || c === '”') {
      i++;
      let s = '';
      while (i < src.length && src[i] !== '"' && src[i] !== '“' && src[i] !== '”' && src[i] !== '\n') s += src[i++];
      if (src[i] !== '"' && src[i] !== '“' && src[i] !== '”') {
        throw new VisualgError('Texto entre aspas não foi fechado (falta o " no final da linha)', {
          line, col: startCol, endLine: line, endCol: col(),
        });
      }
      i++;
      toks.push({ kind: 'str', text: s, norm: s, span: { line, col: startCol, endLine: line, endCol: col() } });
      continue;
    }
    if (isDigit(c)) {
      let j = i;
      while (j < src.length && isDigit(src[j])) j++;
      let isReal = false;
      // "1..10" is a range, not the real "1."
      if (src[j] === '.' && src[j + 1] !== '.' && isDigit(src[j + 1] ?? '')) {
        isReal = true;
        j++;
        while (j < src.length && isDigit(src[j])) j++;
      }
      if ((src[j] === 'e' || src[j] === 'E') && (isDigit(src[j + 1] ?? '') || ((src[j + 1] === '+' || src[j + 1] === '-') && isDigit(src[j + 2] ?? '')))) {
        isReal = true;
        j += 2;
        while (j < src.length && isDigit(src[j])) j++;
      }
      if (j < src.length && isIdStart(src[j])) {
        let k = j;
        while (k < src.length && isIdPart(src[k])) k++;
        throw new VisualgError(`Número inválido: "${src.slice(i, k)}"`, { line, col: startCol, endLine: line, endCol: startCol + (k - i) });
      }
      const text = src.slice(i, j);
      i = j;
      push('num', text, startCol, { value: Number(text), isReal });
      continue;
    }
    if (isIdStart(c)) {
      let j = i;
      while (j < src.length && isIdPart(src[j])) j++;
      const text = src.slice(i, j);
      i = j;
      push('id', text, startCol);
      // Everything after fimalgoritmo is ignored by VisuAlg.
      if (normalize(text) === 'fimalgoritmo') break;
      continue;
    }
    const op = OPS.find((o) => src.startsWith(o, i));
    if (op) {
      i += op.length;
      // Normalize synonyms so the parser only sees one spelling.
      const canon = op === ':=' || op === '←' ? '<-' : op === '!=' ? '<>' : op;
      toks.push({ kind: 'op', text: canon, norm: canon, span: { line, col: startCol, endLine: line, endCol: startCol + op.length } });
      continue;
    }
    throw new VisualgError(`Caractere inválido: "${c}"`, { line, col: startCol, endLine: line, endCol: startCol + 1 });
  }
  toks.push({ kind: 'nl', text: '\n', norm: '\n', span: { line, col: col(), endLine: line, endCol: col() + 1 } });
  toks.push({ kind: 'eof', text: '', norm: '', span: { line, col: col(), endLine: line, endCol: col() + 1 } });
  return toks;
}
