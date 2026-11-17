/** Position in the source: 1-based line, 1-based column. */
export interface Pos {
  line: number;
  col: number;
}

export interface Span {
  line: number;
  col: number;
  endLine: number;
  endCol: number;
}

/** A compile-time (sintaxe) or run-time (execução) error, always tied to a source position. */
export class VisualgError extends Error {
  constructor(
    message: string,
    public readonly span: Span,
    public readonly kind: 'sintaxe' | 'execucao' = 'sintaxe',
  ) {
    super(message);
  }
}

export function spanAt(line: number, col: number, len = 1): Span {
  return { line, col, endLine: line, endCol: col + Math.max(len, 1) };
}
