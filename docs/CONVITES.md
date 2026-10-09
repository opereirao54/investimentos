# Cadastro por convite (fase de testes)

Temporário: enquanto o app é testado com usuários reais, conta nova só entra
com um código de convite. Cada código vale **uma vez** e dá **Pro vitalício**
(a mesma cortesia de "Tornar PRO" no admin — sem avaliação e sem cobrança).

## Usar (só no navegador)

1. `admin.html` → aba **Convites**.
2. Marque **Cadastro só com convite** (LIGADO).
3. Escreva para quem é o convite e clique **Gerar**.
4. Clique **WhatsApp** (mensagem pronta) ou **Copiar link** e mande para a pessoa.

A pessoa abre o link (`/app?convite=BETA-XXXX-XXXX`), que já abre em
**Criar conta** com o código preenchido, e cria a conta pelo Google ou por
e-mail. Sem o link, ela digita o código no campo **Código de convite**; quem
entrar pelo Google sem código vê uma tela pedindo o código antes de acessar.

Na lista, cada convite aparece como **Livre**, **Usado** (por qual e-mail e
quando) ou **Cancelado**. Convite livre pode ser cancelado.

## Fim da fase de testes

Desmarque **Cadastro só com convite**. O cadastro volta a ser aberto como
antes (7 dias grátis e assinatura). Quem entrou por convite continua vitalício;
para tirar o acesso de alguém, use **Superpoderes → Revogar PRO**.

## Como funciona por dentro

- O login (Google/e-mail) é criado no navegador, direto no Firebase Auth, e
  não dá para barrar ali sem o plano pago. A trava fica em
  `POST /api/billing/init`, que cria o registro de billing: sem ele o
  servidor bloqueia tudo (`computeAccess` → `no_billing`). Um login sem
  convite é um login vazio.
- `api/_lib/convites.js`: códigos, interruptor (`config/convites`), resgate.
  O resgate é transacional junto com a trava do `/init`: dois cadastros com o
  mesmo código no mesmo instante → só um passa.
- Quem já tinha conta nunca é barrado: um convite ruim só gera um aviso.
  Conta com assinatura no Asaas não troca sozinha por convite (a cortesia não
  para as cobranças) — o admin decide.
- Coleção `convites/` fechada para o cliente em `firestore.rules`.
- Testes: `test/convites.test.js`.
