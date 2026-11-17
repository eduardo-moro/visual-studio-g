Algoritmo "Olá"
// Descrição : primeiro programa: escreva e leia
// Como testar: Ctrl+F5 (ou o botão ▶ no canto de cima) e responda no terminal "VisuAlg"
Var
   nome: caractere
   idade: inteiro

Inicio
   escreva("Qual é o seu nome? ")
   leia(nome)
   escreva("Quantos anos você tem? ")
   leia(idade)

   escreval("Olá, ", nome, "!")
   escreval("Daqui a 10 anos você terá", idade + 10, " anos.")

   se idade >= 18 entao
      escreval("Você já é maior de idade.")
   senao
      escreval("Faltam", 18 - idade, " anos para a maioridade.")
   fimse
Fimalgoritmo
