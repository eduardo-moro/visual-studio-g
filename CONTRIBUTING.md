# Contribuindo

Obrigado por querer ajudar! Qualquer contribuição vale: avisar de um bug, mandar um programa que não funciona, melhorar uma mensagem de erro ou escrever código.

## Avisando de um problema

Abra uma [issue](https://github.com/eduardo-moro/visual-studio-g/issues/new/choose) com:

- o código `.alg` (ou o menor pedaço que mostra o problema);
- o que você esperava que acontecesse (de preferência, o que o VisuAlg faz);
- o que aconteceu de fato.

## Rodando o projeto

Precisa do [Node.js](https://nodejs.org) 18 ou mais novo.

```sh
git clone https://github.com/eduardo-moro/visual-studio-g
cd visual-studio-g
npm install
npm test
```

Para testar a extensão no VS Code, abra a pasta do projeto e aperte `F5`: abre uma janela nova com a extensão carregada (configuração "Rodar a extensão" em `.vscode/launch.json`). Ou gere e instale o pacote:

```sh
npm run package
code --install-extension visual-studio-g-*.vsix
```

`npm run test:integration` abre uma janela do VS Code e testa a extensão de verdade (encoding, depurador, terminal).

## Como o código está organizado

| Pasta | O quê |
|---|---|
| `src/lang` | Leitura do código: `lexer.ts` (palavras), `parser.ts` (estrutura), `analyzer.ts` (verificação de nomes e tipos) |
| `src/runtime` | Execução: `interpreter.ts`, funções do VisuAlg em `builtins.ts`, valores e formatação em `values.ts` |
| `src/debug` | O depurador (Debug Adapter Protocol) |
| `src/editor` | Recursos do editor: erros, autocompletar, hover, formatação |
| `src/extension.ts` | Liga tudo no VS Code: terminal, comandos, painel Memória |
| `test` | Testes (`node --test`) |
| `exemplos` | Programas de exemplo |

## Enviando uma mudança

1. Faça um fork e crie um branch.
2. Se mudar o comportamento da linguagem, adicione um teste em `test/interpreter.test.ts`.
3. Rode `npm run typecheck` e `npm test`.
4. Abra o pull request explicando o que mudou e por quê.

Mensagens de erro e textos para o usuário ficam em português; código e comentários podem ficar em inglês.
