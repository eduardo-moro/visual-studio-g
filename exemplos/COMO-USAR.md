# Como usar a extensão VisuAlg

Abra qualquer arquivo `.alg` e use:

| O quê | Como |
|---|---|
| **Executar** | `Ctrl+F5` ou o botão **▶** no canto superior direito do editor |
| **Depurar** (para nos breakpoints) | `F5` |
| **Passo a passo desde o início** (o F8 do VisuAlg) | botão do inseto, ao lado do ▶ |
| **Breakpoint** | clique à esquerda do número da linha (aparece um ponto vermelho) |
| Próxima linha / entrar na função / sair da função | `F10` / `F11` / `Shift+F11` |
| Continuar / parar | `F5` / `Shift+F5` |
| **Formatar** (arrumar a indentação) | `Shift+Alt+F` |
| **Fluxograma** do algoritmo (com o bloco em execução aceso durante a depuração) | botão de fluxograma no canto superior direito do editor |

- O programa roda no terminal **VisuAlg** (embaixo). É ali que você digita as respostas do `leia`. `Ctrl+C` no terminal interrompe o programa.
- Enquanto depura, a aba **Executar e Depurar** (ícone de ▶ com inseto, na barra da esquerda) mostra **Variáveis** (com vetores e registros abertos), **Inspeção** e **Pilha de Chamadas**. Passe o mouse sobre uma variável no código para ver o valor. Duplo clique num valor no painel Variáveis permite alterá-lo.
- O painel **Memória (VisuAlg)**, na mesma aba, mostra as variáveis ao vivo mesmo numa execução normal, e guarda os valores finais quando o programa termina.
- Erros aparecem sublinhados em vermelho enquanto você digita (e na aba **Problemas**, `Ctrl+Shift+M`).
- Digite `algoritmo`, `se`, `para`, `enquanto`, `procedimento`, `funcao`... e aperte `Tab` para inserir a estrutura pronta.

## Os exemplos desta pasta

1. `01-ola.alg`: escreva, leia e se/senao. Execute com `Ctrl+F5`.
2. `02-media-notas.alg`: vetor, para, escolha e `x:6:2`. Ponha um breakpoint e use `F5`.
3. `03-funcoes.alg`: função recursiva e parâmetro `var`. Use o passo a passo e `F11`.
4. `04-registros.alg`: `const`, `tipo registro`, ordenação e `aleatorio`. Veja o painel Memória.
5. `05-matriz-timer.alg`: matriz e `timer` (a linha atual fica destacada).
6. `06-erro.alg`: o depurador parando num erro de execução.
7. `07-dado-aleatorio.alg`: joga um dado 6000 vezes com `aleatorio` e confere se o resultado é uniforme. Abra o fluxograma e depure com `F5`, `F10` e `F11`.
