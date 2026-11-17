import * as vscode from 'vscode';
import { Analysis, SubInfo, VarInfo } from '../lang/analyzer';
import { typeToString } from '../lang/ast';
import { compile } from '../lang/compile';
import { Span } from '../lang/errors';
import { normalize } from '../lang/lexer';
import { BUILTINS } from '../runtime/builtins';
import { formatNumber } from '../runtime/values';
import { formatSource } from './formatter';

const KEYWORD_DOCS: Record<string, string> = {
  algoritmo: 'Início do algoritmo: `algoritmo "nome"`.',
  var: 'Seção de declaração de variáveis: `nome: tipo`.',
  const: 'Seção de constantes: `NOME = valor`.',
  tipo: 'Declara tipos: `taluno = registro ... fimregistro`.',
  inicio: 'Início da seção de comandos.',
  fimalgoritmo: 'Fim do algoritmo. Tudo depois desta linha é ignorado.',
  inteiro: 'Tipo numérico sem casas decimais.',
  real: 'Tipo numérico com casas decimais (use ponto: `3.5`).',
  caractere: 'Tipo texto (cadeia de caracteres), entre aspas duplas.',
  caracter: 'Tipo texto (cadeia de caracteres), entre aspas duplas.',
  logico: 'Tipo lógico: `VERDADEIRO` ou `FALSO`.',
  vetor: 'Vetor: `vetor[1..10] de inteiro` ou matriz `vetor[1..3, 1..3] de real`.',
  registro: 'Registro (estrutura): `tipo t = registro campo: tipo ... fimregistro`.',
  escreva: 'Escreve na tela, sem pular linha. `escreva(x:5)` usa 5 espaços; `escreva(y:6:2)` mostra 2 casas decimais.',
  escreval: 'Escreve na tela e pula uma linha.',
  leia: 'Lê um valor digitado e guarda na variável: `leia(x)`.',
  se: '`se <condição> entao ... senao ... fimse`',
  entao: '`se <condição> entao ... fimse`',
  senao: 'Parte do `se` executada quando a condição é FALSO.',
  escolha: '`escolha x` / `caso 1, 2` / `caso 3 ate 5` / `outrocaso` / `fimescolha`',
  caso: 'Uma opção do `escolha`: valores separados por vírgula ou faixas `1 ate 5`.',
  outrocaso: 'Executado quando nenhum `caso` do `escolha` corresponde.',
  para: '`para i de 1 ate 10 [passo 2] faca ... fimpara`',
  enquanto: '`enquanto <condição> faca ... fimenquanto` (testa antes de cada repetição).',
  repita: '`repita ... ate <condição>` (testa depois) ou `repita ... fimrepita` (sai com interrompa).',
  interrompa: 'Sai do laço atual (para, enquanto, repita). Fora de um laço, sai do procedimento ou função.',
  retorne: 'Termina a função devolvendo um valor: `retorne x`.',
  procedimento: '`procedimento nome(a: inteiro; var b: real) ... inicio ... fimprocedimento`',
  funcao: '`funcao nome(a: inteiro): inteiro ... inicio ... retorne a ... fimfuncao`',
  limpatela: 'Limpa a tela.',
  pausa: 'Pausa a execução (no depurador, como um breakpoint).',
  debug: '`debug <condição>`: pausa a execução quando a condição for VERDADEIRO.',
  aleatorio: '`aleatorio [on]`, `aleatorio 1, 100` ou `aleatorio off`: o leia passa a receber valores aleatórios.',
  timer: '`timer 500` / `timer on` / `timer off`: executa devagar, destacando a linha atual.',
  eco: '`eco on` / `eco off`: mostra ou não os valores lidos automaticamente (aleatorio, arquivo).',
  cronometro: '`cronometro on` / `cronometro off`: mede o tempo de execução.',
  arquivo: '`arquivo "dados.txt"`: o leia passa a ler do arquivo (se não existir, grava o que for digitado).',
  e: 'E lógico: VERDADEIRO somente se os dois lados forem VERDADEIRO.',
  ou: 'OU lógico: VERDADEIRO se pelo menos um lado for VERDADEIRO.',
  nao: 'Negação lógica.',
  xou: 'OU exclusivo: VERDADEIRO se os lados forem diferentes.',
  mod: 'Resto da divisão inteira: `7 mod 3` = 1 (o mesmo que `%`).',
  div: 'Divisão inteira: `7 div 2` = 3 (o mesmo que `\\`).',
};

const KEYWORDS = Object.keys(KEYWORD_DOCS).concat(['fimse', 'fimpara', 'fimenquanto', 'fimrepita', 'fimescolha', 'fimprocedimento', 'fimfuncao', 'fimregistro', 'de', 'ate', 'passo', 'faca', 'verdadeiro', 'falso', 'on', 'off']);

/** Last good analysis per document, for hover/completion/outline. */
const analyses = new Map<string, Analysis>();

function toRange(s: Span): vscode.Range {
  return new vscode.Range(s.line - 1, s.col - 1, s.endLine - 1, Math.max(s.endCol - 1, s.col));
}

function subAt(a: Analysis, line: number): SubInfo | undefined {
  for (const s of a.subs.values()) if (line >= s.decl.span.line && line <= s.decl.endSpan.line) return s;
  return undefined;
}

function wordAt(doc: vscode.TextDocument, pos: vscode.Position): { word: string; range: vscode.Range } | undefined {
  const range = doc.getWordRangeAtPosition(pos, /[\p{L}_][\p{L}\p{M}\p{N}_]*/u);
  return range ? { word: doc.getText(range), range } : undefined;
}

function subSignature(s: SubInfo): string {
  const params = s.params.map((p) => `${p.byRef ? 'var ' : ''}${p.name}: ${typeToString(p.type)}`).join('; ');
  return `${s.decl.kind} ${s.decl.name}${params ? `(${params})` : ''}${s.returnType ? `: ${typeToString(s.returnType)}` : ''}`;
}

export function registerLanguageFeatures(context: vscode.ExtensionContext): void {
  const diagnostics = vscode.languages.createDiagnosticCollection('visualg');
  context.subscriptions.push(diagnostics);
  const timers = new Map<string, NodeJS.Timeout>();

  const check = (doc: vscode.TextDocument) => {
    if (doc.languageId !== 'visualg') return;
    const { analysis, errors } = compile(doc.getText());
    if (analysis) analyses.set(doc.uri.toString(), analysis);
    diagnostics.set(doc.uri, errors.map((e) => {
      const d = new vscode.Diagnostic(toRange(e.span), e.message, vscode.DiagnosticSeverity.Error);
      d.source = 'VisuAlg';
      return d;
    }));
  };
  const schedule = (doc: vscode.TextDocument) => {
    const key = doc.uri.toString();
    clearTimeout(timers.get(key));
    timers.set(key, setTimeout(() => check(doc), 300));
  };

  vscode.workspace.textDocuments.forEach(check);
  context.subscriptions.push(
    vscode.workspace.onDidOpenTextDocument(check),
    vscode.workspace.onDidChangeTextDocument((e) => schedule(e.document)),
    vscode.workspace.onDidCloseTextDocument((d) => {
      diagnostics.delete(d.uri);
      analyses.delete(d.uri.toString());
    }),
  );

  const selector: vscode.DocumentSelector = { language: 'visualg' };

  context.subscriptions.push(vscode.languages.registerHoverProvider(selector, {
    provideHover(doc, pos) {
      const w = wordAt(doc, pos);
      if (!w) return undefined;
      const norm = normalize(w.word);
      const a = analyses.get(doc.uri.toString());
      const md = new vscode.MarkdownString();
      const sub = a?.subs.get(norm);
      if (sub) {
        md.appendCodeblock(subSignature(sub), 'visualg');
        return new vscode.Hover(md, w.range);
      }
      const b = BUILTINS.get(norm);
      if (b) {
        md.appendCodeblock(b.sig, 'visualg');
        md.appendMarkdown(b.doc);
        return new vscode.Hover(md, w.range);
      }
      if (a) {
        const inSub = subAt(a, pos.line + 1);
        const locals: VarInfo[] = inSub ? [...inSub.params, ...inSub.locals] : [];
        const local = locals.find((x) => x.norm === norm);
        const v = local ?? a.globals.find((x) => x.norm === norm);
        if (v) {
          md.appendCodeblock(`${v.name}: ${typeToString(v.type)}`, 'visualg');
          md.appendMarkdown(local ? `Variável local de \`${inSub!.decl.name}\`` : 'Variável global');
          return new vscode.Hover(md, w.range);
        }
        const c = inSub?.consts.get(norm) ?? a.consts.get(norm);
        if (c) {
          md.appendCodeblock(`${c.name} = ${typeof c.value === 'number' ? formatNumber(c.value) : JSON.stringify(c.value)}`, 'visualg');
          md.appendMarkdown('Constante');
          return new vscode.Hover(md, w.range);
        }
      }
      if (KEYWORD_DOCS[norm]) {
        md.appendMarkdown(KEYWORD_DOCS[norm]);
        return new vscode.Hover(md, w.range);
      }
      return undefined;
    },
  }));

  context.subscriptions.push(vscode.languages.registerCompletionItemProvider(selector, {
    provideCompletionItems(doc, pos) {
      const items: vscode.CompletionItem[] = [];
      for (const k of KEYWORDS) {
        const it = new vscode.CompletionItem(k, vscode.CompletionItemKind.Keyword);
        if (KEYWORD_DOCS[k]) it.documentation = new vscode.MarkdownString(KEYWORD_DOCS[k]);
        items.push(it);
      }
      for (const b of BUILTINS.values()) {
        const it = new vscode.CompletionItem(b.name, b.proc ? vscode.CompletionItemKind.Method : vscode.CompletionItemKind.Function);
        it.detail = b.sig;
        it.documentation = b.doc;
        if (b.max > 0) it.insertText = new vscode.SnippetString(`${b.name}($1)`);
        items.push(it);
      }
      const a = analyses.get(doc.uri.toString());
      if (a) {
        const inSub = subAt(a, pos.line + 1);
        for (const v of [...(inSub ? [...inSub.params, ...inSub.locals] : []), ...a.globals]) {
          const it = new vscode.CompletionItem(v.name, vscode.CompletionItemKind.Variable);
          it.detail = typeToString(v.type);
          items.push(it);
        }
        for (const [, c] of [...(inSub?.consts ?? []), ...a.consts]) items.push(new vscode.CompletionItem(c.name, vscode.CompletionItemKind.Constant));
        for (const s of a.subs.values()) {
          const it = new vscode.CompletionItem(s.decl.name, s.decl.kind === 'funcao' ? vscode.CompletionItemKind.Function : vscode.CompletionItemKind.Method);
          it.detail = subSignature(s);
          if (s.params.length) it.insertText = new vscode.SnippetString(`${s.decl.name}($1)`);
          items.push(it);
        }
      }
      return items;
    },
  }));

  context.subscriptions.push(vscode.languages.registerDocumentSymbolProvider(selector, {
    provideDocumentSymbols(doc) {
      const a = analyses.get(doc.uri.toString());
      if (!a) return [];
      const symbols: vscode.DocumentSymbol[] = [];
      for (const g of a.globals) {
        const r = toRange(g.span);
        symbols.push(new vscode.DocumentSymbol(g.name, typeToString(g.type), vscode.SymbolKind.Variable, r, r));
      }
      for (const s of a.subs.values()) {
        const full = new vscode.Range(s.decl.span.line - 1, 0, s.decl.endSpan.line - 1, 1000);
        const sym = new vscode.DocumentSymbol(s.decl.name, subSignature(s), s.decl.kind === 'funcao' ? vscode.SymbolKind.Function : vscode.SymbolKind.Method, full, toRange(s.decl.span));
        for (const l of [...s.params, ...s.locals]) {
          const r = toRange(l.span);
          sym.children.push(new vscode.DocumentSymbol(l.name, typeToString(l.type), vscode.SymbolKind.Variable, r, r));
        }
        symbols.push(sym);
      }
      return symbols;
    },
  }));

  context.subscriptions.push(vscode.languages.registerDocumentFormattingEditProvider(selector, {
    provideDocumentFormattingEdits(doc, options) {
      const unit = options.insertSpaces ? ' '.repeat(options.tabSize) : '\t';
      const formatted = formatSource(doc.getText(), unit);
      if (formatted === doc.getText()) return [];
      return [vscode.TextEdit.replace(new vscode.Range(0, 0, doc.lineCount, 0), formatted)];
    },
  }));
}
