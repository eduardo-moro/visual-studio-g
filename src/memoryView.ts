import * as vscode from 'vscode';
import { typeToString } from './lang/ast';
import { AliasCell, Cell, Interpreter } from './runtime/interpreter';
import { ArrayVal, displayValue, RecordVal, Value } from './runtime/values';

type Node =
  | { kind: 'group'; label: string; cells: Cell[] }
  | { kind: 'value'; label: string; value: Value; type: string; id: string };

/**
 * Like VisuAlg's memory panel: every variable's current value, refreshed live while the program runs
 * (also in a normal run, not only when paused), and kept after it ends.
 */
export class MemoryView implements vscode.TreeDataProvider<Node> {
  private readonly changed = new vscode.EventEmitter<Node | undefined>();
  readonly onDidChangeTreeData = this.changed.event;
  private interp?: Interpreter;
  private timer?: NodeJS.Timeout;

  setRun(interp: Interpreter | undefined): void {
    if (interp) {
      this.interp = interp;
      void vscode.commands.executeCommand('setContext', 'visualg.memoryAvailable', true);
      clearInterval(this.timer);
      this.timer = setInterval(() => this.changed.fire(undefined), 300);
    } else {
      // Run ended: one last refresh, then keep showing the final values.
      clearInterval(this.timer);
      this.timer = undefined;
    }
    this.changed.fire(undefined);
  }

  getTreeItem(n: Node): vscode.TreeItem {
    if (n.kind === 'group') {
      const it = new vscode.TreeItem(n.label, vscode.TreeItemCollapsibleState.Expanded);
      it.id = `group:${n.label}`;
      return it;
    }
    const composite = n.value instanceof ArrayVal || n.value instanceof RecordVal;
    // Small vectors and records start open, like VisuAlg's memory panel.
    const small = n.value instanceof RecordVal || (n.value instanceof ArrayVal && n.value.data.length <= 12);
    const state = !composite ? vscode.TreeItemCollapsibleState.None : small ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.Collapsed;
    const it = new vscode.TreeItem(n.label, state);
    it.id = n.id;
    it.description = composite ? n.type : displayValue(n.value);
    it.tooltip = `${n.label}: ${n.type}`;
    it.iconPath = new vscode.ThemeIcon(composite ? 'symbol-array' : 'symbol-variable');
    return it;
  }

  getChildren(n?: Node): Node[] {
    const interp = this.interp;
    if (!interp) return [];
    if (!n) {
      const groups: Node[] = [];
      const top = interp.callStack[interp.callStack.length - 1];
      if (top?.sub) groups.push({ kind: 'group', label: `Locais (${top.name})`, cells: [...top.vars.values()] });
      groups.push({ kind: 'group', label: 'Globais', cells: [...interp.globals.vars.values()] });
      return groups;
    }
    if (n.kind === 'group') {
      return n.cells.map((c) => ({
        kind: 'value', label: c.name, value: c.get(), id: `${n.label}/${c.name}`,
        type: `${c instanceof AliasCell ? 'var ' : ''}${typeToString(c.type)}`,
      }));
    }
    const v = n.value;
    if (v instanceof ArrayVal) {
      const t = v.type;
      // Element labels like [1] or [2,3]; matrices are listed flat.
      const out: Node[] = [];
      const idx = t.dims.map((d) => d.lo);
      for (let off = 0; off < v.data.length; off++) {
        const label = `[${idx.join(',')}]`;
        out.push({ kind: 'value', label, value: v.data[off], type: typeToString(t.elem), id: `${n.id}${label}` });
        for (let k = idx.length - 1; k >= 0; k--) {
          if (++idx[k] <= t.dims[k].hi) break;
          idx[k] = t.dims[k].lo;
        }
      }
      return out;
    }
    if (v instanceof RecordVal) {
      return v.type.fields.map((f) => ({ kind: 'value', label: f.name, value: v.fields.get(f.norm)!, type: typeToString(f.type), id: `${n.id}.${f.name}` }));
    }
    return [];
  }

  dispose(): void {
    clearInterval(this.timer);
  }
}
