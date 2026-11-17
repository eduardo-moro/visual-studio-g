import * as vscode from 'vscode';
import { RunIO } from './debug/session';

const FG: Record<string, number> = { black: 30, red: 31, green: 32, yellow: 33, blue: 34, magenta: 35, cyan: 36, white: 37, gray: 90 };

/**
 * The program's console: a VS Code terminal where escreva writes and leia reads.
 * One terminal is reused across runs; it is recreated if the user closes it.
 */
export class ConsoleTerminal implements vscode.Pseudoterminal, RunIO {
  private readonly writeEmitter = new vscode.EventEmitter<string>();
  readonly onDidWrite = this.writeEmitter.event;
  onInterrupt?: () => void;

  private terminal?: vscode.Terminal;
  private isOpen = false;
  private pendingOutput: string[] = [];
  private line = '';
  private lines: string[] = [];
  private waiter?: (l: string | null) => void;
  private inEscape = false;

  constructor() {
    vscode.window.onDidCloseTerminal((t) => {
      if (t === this.terminal) {
        this.terminal = undefined;
        this.isOpen = false;
        this.onInterrupt?.();
        this.cancelRead();
      }
    });
  }

  // ----- Pseudoterminal -----

  open(): void {
    this.isOpen = true;
    for (const s of this.pendingOutput) this.writeEmitter.fire(s);
    this.pendingOutput = [];
  }

  close(): void {}

  handleInput(data: string): void {
    for (const ch of data) {
      if (this.inEscape) {
        // Skip arrow keys and other escape sequences: ESC [ ... letter
        if (/[A-Za-z~]/.test(ch)) this.inEscape = false;
        continue;
      }
      if (ch === '\x1b') {
        this.inEscape = true;
      } else if (ch === '\x03') {
        this.raw('^C\r\n');
        this.onInterrupt?.();
      } else if (ch === '\r' || ch === '\n') {
        this.raw('\r\n');
        const l = this.line;
        this.line = '';
        if (this.waiter) {
          const w = this.waiter;
          this.waiter = undefined;
          w(l);
        } else this.lines.push(l);
      } else if (ch === '\x7f' || ch === '\b') {
        if (this.line.length) {
          this.line = this.line.slice(0, -1);
          this.raw('\b \b');
        }
      } else if (ch >= ' ') {
        this.line += ch;
        this.raw(ch);
      }
    }
  }

  // ----- RunIO -----

  private raw(s: string): void {
    if (this.isOpen) this.writeEmitter.fire(s);
    else this.pendingOutput.push(s);
  }

  write(text: string): void {
    this.raw(text.replace(/\r?\n/g, '\r\n'));
  }

  readLine(): Promise<string | null> {
    if (this.lines.length) return Promise.resolve(this.lines.shift()!);
    // Waiting for input: put the cursor in the terminal so the user can type.
    this.terminal?.show(false);
    return new Promise((r) => (this.waiter = r));
  }

  cancelRead(): void {
    const w = this.waiter;
    this.waiter = undefined;
    w?.(null);
  }

  clear(): void {
    this.raw('\x1b[2J\x1b[3J\x1b[H');
  }

  setColor(fg?: string, bg?: string): void {
    if (fg) this.raw(`\x1b[${FG[fg] ?? 39}m`);
    if (bg) this.raw(`\x1b[${(FG[bg] ?? 49) + 10}m`);
  }

  begin(title: string): void {
    if (!this.terminal) {
      this.isOpen = false;
      this.terminal = vscode.window.createTerminal({ name: 'VisuAlg', pty: this, iconPath: new vscode.ThemeIcon('play') });
    }
    this.lines = [];
    this.line = '';
    this.cancelRead();
    this.terminal.show(true);
    this.raw('\x1b[0m\x1b[2J\x1b[3J\x1b[H');
    this.raw(`\x1b[2m── Executando ${title} ──\x1b[0m\r\n`);
  }

  end(message: string, isError: boolean): void {
    this.cancelRead();
    const color = isError ? '\x1b[31m' : '\x1b[2m';
    this.raw(`\x1b[0m\r\n${color}*** ${message.replace(/\r?\n/g, '\r\n')} ***\x1b[0m\r\n`);
  }

  dispose(): void {
    this.terminal?.dispose();
  }
}
