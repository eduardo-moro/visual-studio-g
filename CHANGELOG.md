# Changelog

## 0.1.1

- Fluxograma: bloco com a declaração das constantes, tipos e variáveis (e das variáveis locais em procedimentos e funções).
- Fluxograma: escolha da direção (de cima para baixo ou da esquerda para a direita) e do formato das linhas (curvas, retas ou em ângulo reto).
- Fluxograma: exportar como imagem PNG ou SVG.
- Novo exemplo `07-dado-aleatorio.alg`, que testa o `aleatorio` jogando um dado 6000 vezes.
- A depuração não abre mais o Console de Depuração por cima do terminal VisuAlg.
- Botão "Abrir no GitHub Codespaces" no README para experimentar no navegador.

## 0.1.0

Primeira versão.

- Interpretador da linguagem do VisuAlg 3.0 (tipos, vetores, matrizes, registros, constantes, procedimentos e funções com parâmetros por referência, recursão, funções do VisuAlg, `aleatorio`, `arquivo`, `timer`, `pausa`, `debug`, `eco`, `cronometro`).
- Executar e depurar no VS Code: breakpoints, passo a passo, variáveis, pilha de chamadas, alterar valores, parada em erros de execução.
- Painel Memória (VisuAlg) com os valores ao vivo.
- Erros enquanto digita, autocompletar, hover, estrutura do arquivo, formatação, trechos prontos e destaque de sintaxe.
- Arquivos `.alg` em Windows-1252 (salvos pelo VisuAlg) abrem com os acentos corretos.
- Interpretador de linha de comando (`dist/cli.js`).
- Fluxograma (Mermaid) de cada rotina, atualizado ao digitar, com o bloco em execução destacado durante a depuração e cópia do código Mermaid ou Markdown.
