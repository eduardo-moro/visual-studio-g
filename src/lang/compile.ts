import { analyze, Analysis } from './analyzer';
import { VisualgError } from './errors';
import { parse } from './parser';

export interface CompileResult {
  analysis?: Analysis;
  errors: VisualgError[];
}

/** Parse and check a program. On a syntax error only that error is reported (parsing stops there). */
export function compile(src: string): CompileResult {
  let program;
  try {
    program = parse(src);
  } catch (e) {
    if (e instanceof VisualgError) return { errors: [e] };
    throw e;
  }
  const { analysis, errors } = analyze(program);
  errors.sort((a, b) => a.span.line - b.span.line || a.span.col - b.span.col);
  return errors.length ? { analysis, errors } : { analysis, errors: [] };
}

/**
 * .alg files written by VisuAlg on Windows are Windows-1252 (Latin-1); newer ones may be UTF-8.
 * Use UTF-8 when the bytes are valid UTF-8, otherwise Windows-1252.
 */
export function decodeSource(bytes: Uint8Array): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/^﻿/, '');
  } catch {
    return new TextDecoder('windows-1252').decode(bytes);
  }
}
