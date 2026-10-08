'use strict';

// O harness dos testes de integração mora em scripts/lib/app-sandbox.js desde
// que o gerador do Relatório Mensal pelo Telegram passou a usá-lo também.
// Este arquivo fica para os ~45 testes que o importam por este caminho.
module.exports = require('../scripts/lib/app-sandbox.js');
