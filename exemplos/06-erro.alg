Algoritmo "Erro de execução"
// Descrição : este programa tem um erro de propósito: o laço vai até 6,
//             mas o vetor só tem 5 posições.
// Como testar: F5. O depurador PARA na linha do erro e mostra a mensagem;
//              no painel Variáveis dá para ver que i vale 6 naquele momento.
//              Depois experimente apagar a linha "i: inteiro" e veja o erro
//              sublinhado em vermelho antes mesmo de executar.
Var
   v: vetor[1..5] de inteiro
   i: inteiro

Inicio
   para i de 1 ate 6 faca
      v[i] <- i * i
      escreval("v[", i, "] =", v[i])
   fimpara
Fimalgoritmo
