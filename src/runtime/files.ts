import * as fs from 'fs';
import * as path from 'path';
import { decodeSource } from '../lang/compile';
import { FileAccess } from './interpreter';

/** Real filesystem access for the `arquivo` command. */
export const nodeFiles: FileAccess = {
  resolve: (base, p) => (path.isAbsolute(p) ? p : path.resolve(base ?? process.cwd(), p)),
  readLines(p) {
    if (!fs.existsSync(p)) return undefined;
    const text = decodeSource(fs.readFileSync(p));
    const lines = text.split(/\r?\n/);
    if (lines.length && lines[lines.length - 1] === '') lines.pop();
    return lines;
  },
  appendLine(p, line) {
    fs.appendFileSync(p, `${line}\n`);
  },
};
