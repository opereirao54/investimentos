# Cadastro por convite (fase de testes)

Temporário: enquanto o app é testado com usuários reais, conta nova só entra
com um código de convite. Cada código vale **uma vez** e dá o **benefício de
testador**:

- **grátis até 1 ano depois da data de lançamento** (inclusive o dia do
  aniversário), sem avaliação e sem cobrança;
- depois, **50% de desconto na mensalidade, para sempre** (R$ 7,50 em vez de
  R$ 15, na assinatura e no avulso).

A **data de lançamento** fica na aba Convites. Enquanto não houver data, o
acesso grátis fica sem prazo. Definir ou mudar a data recalcula o prazo de
todos os testadores (menos quem o admin mexeu à mão depois: Tornar PRO,
Oferecer dias, Revogar).

## Usar (só no navegador)

1. `admin.html` → aba **Convites**.
2. Marque **Cadastro só com convite** (LIGADO).
3. Em **Data de lançamento**, escolha a data e clique **Salvar data** (pode
   mudar depois).
4. Escreva para quem é o convite e clique **Gerar**.
5. Clique **WhatsApp** (mensagem pronta) ou **Copiar link** e mande para a pessoa.

A pessoa abre o link (`/app?convite=BETA-XXXX-XXXX`), que já abre em
**Criar conta** com o código preenchido, e cria a conta pelo Google ou por
e-mail. Sem o link, ela digita o código no campo **Código de convite**; quem
entrar pelo Google sem código vê uma tela pedindo o código antes de acessar.

Na lista, cada convite aparece como **Livre**, **Usado** (por qual e-mail e
quando) ou **Cancelado**. Convite livre pode ser cancelado.

## Fim da fase de testes

Desmarque **Cadastro só com convite**. O cadastro volta a ser aberto como
antes (7 dias grátis e assinatura). Quem entrou por convite mantém o
benefício; para tirar o acesso de alguém, use **Superpoderes → Revogar PRO**.

## Como funciona por dentro

- O login (Google/e-mail) é criado no navegador, direto no Firebase Auth, e
  não dá para barrar ali sem o plano pago. A trava fica em
  `POST /api/billing/init`, que cria o registro de billing: sem ele o
  servidor bloqueia tudo (`computeAccess` → `no_billing`). Um login sem
  convite é um login vazio.
- `api/_lib/convites.js`: códigos, interruptor (`config/convites`), resgate.
  O resgate é transacional junto com a trava do `/init`: dois cadastros com o
  mesmo código no mesmo instante → só um passa.
- O prazo grátis é a cortesia com prazo do admin (`courtesyUntil`); sem
  data, `courtesyPermanent`. O desconto é `recurringDiscountPercent = 50`
  (mesmo campo do cupom Applicash) e `conviteDescontoPercent = 50` guarda a
  origem: cupom junto não baixa para 10%, e cupom derrubado no /subscribe não
  leva o desconto de testador junto.
- Quem já tinha conta nunca é barrado: um convite ruim só gera um aviso.
  Conta com assinatura no Asaas não troca sozinha por convite (a cortesia não
  para as cobranças) — o admin decide.
- Coleção `convites/` fechada para o cliente em `firestore.rules`.
- Testes: `test/convites.test.js`.
