// ============================================================
// --- Termos de Uso: texto ---
// ============================================================
// O texto dos Termos mora aqui, num lugar só, no mesmo padrão da Política de
// Privacidade (appliquei-privacidade.js): a janela de aceite, o cadastro, a
// aba "Regulamento" de Dúvidas & sugestões e o rodapé da landing leem daqui.
//
// O ACEITE não mora aqui: Termos e Política são aceitos juntos, na mesma
// janela e no mesmo registro do servidor (/api/user?op=privacidade). Ver
// appliquei-privacidade.js.
//
// Mudou o texto de forma relevante: mude TERMOS_VERSAO (aqui e em
// api/user.js — um teste confere que são iguais). Quem aceitou a versão
// anterior vê os Termos de novo e aceita a nova.
//
// Os valores comerciais (preço, desconto do Applicash, benefício do testador)
// estão escritos por extenso de propósito: são o que o usuário aceitou. Mudou
// a regra no código, mude aqui e suba a versão.

var TERMOS_VERSAO = '2026-10-11';

function _termosEsc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function termosDataVersao() {
  const [a, m, d] = TERMOS_VERSAO.split('-');
  return d + '/' + m + '/' + a;
}

// Quem presta o serviço: os mesmos dados do controlador da Política de
// Privacidade (PRIVACIDADE_CONTROLADOR), para os dois documentos não
// divergirem. O que estiver vazio sai do texto em vez de aparecer como lacuna.
function _termosPrestador() {
  const c =
    typeof PRIVACIDADE_CONTROLADOR === 'object' && PRIVACIDADE_CONTROLADOR
      ? PRIVACIDADE_CONTROLADOR
      : { nome: 'Appliquei' };
  const ident = [
    c.razaoSocial ? _termosEsc(c.razaoSocial) : _termosEsc(c.nome || 'Appliquei'),
    c.cnpj ? 'CNPJ ' + _termosEsc(c.cnpj) : '',
  ]
    .filter(Boolean)
    .join(', ');
  const contato = c.email
    ? 'pelo e-mail <strong>' +
      _termosEsc(c.email) +
      '</strong> ou pela aba <strong>Enviar sugestão</strong>, em Dúvidas &amp; sugestões'
    : 'pela aba <strong>Enviar sugestão</strong>, em Dúvidas &amp; sugestões';
  return { ident: ident, contato: contato };
}

/** O texto integral dos Termos de Uso, em HTML. */
function termosTextoHtml() {
  const p = _termosPrestador();
  return (
    '<p class="pol-versao">Versão de ' +
    termosDataVersao() +
    '</p>' +
    '<p>Estes Termos de Uso regulam o uso do aplicativo Appliquei, oferecido pela ' +
    p.ident +
    ' (“Appliquei”, “nós”). Ao criar a conta ou continuar usando o app, você declara que leu, entendeu e aceita estes Termos e a Política de Privacidade.</p>' +
    '<h4>1. O que é a Appliquei</h4>' +
    '<p>A Appliquei é uma ferramenta de organização e educação financeira pessoal. Nela você registra receitas, despesas, contas, cartões, investimentos, bens e metas, acompanha cotações e indicadores de mercado, faz simulações e vê sugestões de alocação calculadas a partir de critérios públicos.</p>' +
    '<p><strong>A Appliquei não é instituição financeira, corretora, distribuidora, consultoria nem analista de valores mobiliários.</strong> Não faz recomendação individualizada de investimento, não intermedeia operações, não guarda nem movimenta o seu dinheiro. As sugestões, simulações, projeções e classificações de perfil têm caráter informativo e educacional; a decisão de investir é sempre sua. Os detalhes estão no Disclaimer de investimentos, que faz parte destes Termos.</p>' +
    '<h4>2. Sua conta</h4>' +
    '<ul>' +
    '<li>O app é destinado a maiores de 18 anos.</li>' +
    '<li>A conta é pessoal e intransferível. Você é responsável por manter a senha em sigilo e pelo que for feito com a sua conta.</li>' +
    '<li>Os dados de cadastro e de cobrança precisam ser verdadeiros. Os valores que você lança no app são informados por você, e os cálculos dependem deles.</li>' +
    '</ul>' +
    '<h4>3. Avaliação gratuita, assinatura e pagamento</h4>' +
    '<ul>' +
    '<li><strong>Avaliação gratuita:</strong> contas novas têm 7 dias grátis, sem cartão e sem cobrança automática ao final.</li>' +
    '<li><strong>Preço:</strong> R$ 15,00 por mês, ou o valor exibido na tela de assinatura no momento da contratação, já com os descontos a que você tiver direito.</li>' +
    '<li><strong>Formas de pagamento:</strong> PIX, boleto ou cartão de crédito, processados pelo Asaas. Você pode escolher a assinatura recorrente (renovação automática a cada mês) ou o pagamento avulso de um período, sem renovação automática.</li>' +
    '<li><strong>Atraso ou falta de pagamento:</strong> ao fim do período pago, o acesso é bloqueado até a regularização. Seus dados continuam guardados na sua conta.</li>' +
    '<li><strong>Mudança de preço:</strong> avisaremos no app com pelo menos 30 dias de antecedência. O novo valor só vale a partir da cobrança seguinte ao aviso, e você pode cancelar antes dela.</li>' +
    '</ul>' +
    '<h4>4. Cancelamento e direito de arrependimento</h4>' +
    '<ul>' +
    '<li>Você pode cancelar a assinatura a qualquer momento, sem multa e sem fidelidade, na tela de assinatura do app. O acesso continua até o fim do período já pago, e não há cobrança seguinte.</li>' +
    '<li><strong>Arrependimento (Código de Defesa do Consumidor, art. 49):</strong> você pode desistir da contratação em até 7 dias a partir do primeiro pagamento e receber de volta o valor integral. Basta pedir ' +
    p.contato +
    '. O estorno é feito pelo mesmo meio de pagamento.</li>' +
    '<li>Fora do prazo de arrependimento, o cancelamento não gera devolução proporcional do período em curso, que continua disponível até o fim.</li>' +
    '</ul>' +
    '<h4>5. Applicash (indicações)</h4>' +
    '<ul>' +
    '<li><strong>Quem é indicado</strong> e usa um cupom válido no cadastro ganha 10% de desconto na mensalidade enquanto mantiver a assinatura.</li>' +
    '<li><strong>Quem indica</strong> recebe, como crédito, 10% de cada pagamento confirmado da pessoa indicada. O crédito é abatido nas suas próprias faturas da Appliquei; não é dinheiro, não pode ser sacado, transferido nem trocado.</li>' +
    '<li>Se o pagamento que gerou o crédito for estornado, contestado ou devolvido, o crédito correspondente é cancelado.</li>' +
    '<li>Autoindicação, contas falsas, cadastros em série ou qualquer forma de burlar o programa levam ao cancelamento dos créditos e descontos envolvidos e podem levar à suspensão das contas.</li>' +
    '<li>O programa pode ser alterado ou encerrado com aviso prévio no app; créditos já gerados continuam valendo para abatimento.</li>' +
    '</ul>' +
    '<h4>6. Programa de testadores (versão beta)</h4>' +
    '<p>Esta seção vale para quem entrou na Appliquei com um código de convite, durante a fase de testes.</p>' +
    '<ul>' +
    '<li><strong>Versão em teste:</strong> nessa fase o app ainda está sendo ajustado. Podem acontecer erros, instabilidades, mudanças de telas e de funcionalidades e, em casos extremos, perda de dados. Recomendamos guardar cópias pelo botão Backup.</li>' +
    '<li><strong>Convite:</strong> cada código é pessoal e vale para uma única conta.</li>' +
    '<li><strong>Benefício do testador:</strong> uso gratuito até 1 (um) ano depois da data de lançamento oficial do app, definida pela Appliquei e informada no app; depois disso, 50% de desconto na mensalidade, sem prazo final, enquanto a conta existir. O benefício não é cumulativo com o desconto do Applicash e não pode ser transferido.</li>' +
    '<li><strong>Sugestões e relatos:</strong> o que você nos enviar (ideias, relatos de erro, opiniões) pode ser usado livremente para melhorar o app, sem qualquer remuneração ou obrigação de confidencialidade da nossa parte. Não envie, nessas mensagens, informações que você não queira compartilhar.</li>' +
    '<li>O benefício pode ser cancelado em caso de fraude ou de violação destes Termos.</li>' +
    '</ul>' +
    '<h4>7. Dados de mercado e integrações</h4>' +
    '<p>Cotações, indicadores, demonstrações financeiras e índices vêm de fontes públicas e de terceiros (como B3, CVM, Banco Central, Tesouro Direto e provedores de cotações). Eles podem ter atraso, falhas ou erros que não controlamos; confira as informações na fonte oficial antes de decidir. O bot do Telegram e a leitura automática de mensagens são opcionais e podem interpretar errado um lançamento: confira o que foi registrado.</p>' +
    '<h4>8. Uso permitido</h4>' +
    '<p>Você concorda em não: usar o app para fins ilegais; tentar acessar dados de outras contas; contornar a cobrança ou as travas de acesso; copiar, revender ou explorar comercialmente o app ou seus conteúdos; extrair dados de forma automatizada; ou sobrecarregar, atacar ou fazer engenharia reversa do serviço.</p>' +
    '<h4>9. Disponibilidade e responsabilidade</h4>' +
    '<ul>' +
    '<li>Trabalhamos para manter o app no ar e os seus dados seguros, mas não garantimos funcionamento ininterrupto ou livre de erros. Manutenções, falhas de terceiros (hospedagem, provedores de dados, processador de pagamentos) e casos fortuitos podem interromper o serviço.</li>' +
    '<li>As decisões financeiras e de investimento são exclusivamente suas. Nos limites da lei, a Appliquei não responde por perdas decorrentes dessas decisões, de dados de mercado de terceiros ou de informações lançadas incorretamente.</li>' +
    '<li>Nada nestes Termos afasta os direitos que o Código de Defesa do Consumidor garante a você.</li>' +
    '</ul>' +
    '<h4>10. Propriedade intelectual</h4>' +
    '<p>A marca, o código, o design, os textos e os conteúdos educacionais da Appliquei são protegidos por lei. O uso do app não transfere a você nenhum direito sobre eles. Os dados que você registra continuam sendo seus.</p>' +
    '<h4>11. Encerramento da conta</h4>' +
    '<p>Você pode deixar de usar o app e pedir a exclusão da conta a qualquer momento, conforme a Política de Privacidade. Podemos suspender ou encerrar contas que violem estes Termos, avisando o motivo sempre que possível.</p>' +
    '<h4>12. Mudanças nestes Termos</h4>' +
    '<p>Se mudarmos estes Termos de forma relevante, avisaremos no app e pediremos que você leia e aceite a nova versão antes de continuar. Se não concordar, você pode cancelar a assinatura sem multa.</p>' +
    '<h4>13. Lei aplicável, foro e contato</h4>' +
    '<p>Estes Termos seguem as leis brasileiras. Fica eleito o foro do seu domicílio para resolver qualquer questão. Dúvidas, pedidos e reclamações: fale conosco ' +
    p.contato +
    '.</p>'
  );
}

// Node (testes): expõe a versão e o texto sem DOM.
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { TERMOS_VERSAO: TERMOS_VERSAO, termosTextoHtml: termosTextoHtml };
}
