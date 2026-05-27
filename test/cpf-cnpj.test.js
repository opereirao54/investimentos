'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { isValidCpf, isValidCnpj, isValidCpfCnpj, onlyDigits } = require('../api/_lib/cpf-cnpj');

test('onlyDigits remove tudo que não é dígito', () => {
  assert.equal(onlyDigits('123.456.789-09'), '12345678909');
  assert.equal(onlyDigits(null), '');
  assert.equal(onlyDigits(undefined), '');
  assert.equal(onlyDigits(12345), '12345');
});

test('isValidCpf aceita CPFs válidos', () => {
  // CPFs com DV correto.
  assert.equal(isValidCpf('529.982.247-25'), true);
  assert.equal(isValidCpf('52998224725'), true);
});

test('isValidCpf rejeita inválidos', () => {
  assert.equal(isValidCpf('111.111.111-11'), false);
  assert.equal(isValidCpf('123.456.789-00'), false);
  assert.equal(isValidCpf(''), false);
  assert.equal(isValidCpf(null), false);
  assert.equal(isValidCpf('123'), false);
});

test('isValidCnpj aceita CNPJ válido', () => {
  assert.equal(isValidCnpj('11.222.333/0001-81'), true);
  assert.equal(isValidCnpj('11222333000181'), true);
});

test('isValidCnpj rejeita inválidos', () => {
  assert.equal(isValidCnpj('00.000.000/0000-00'), false);
  assert.equal(isValidCnpj('11.222.333/0001-80'), false);
  assert.equal(isValidCnpj(''), false);
});

test('isValidCpfCnpj despacha por comprimento', () => {
  assert.equal(isValidCpfCnpj('52998224725'), true);
  assert.equal(isValidCpfCnpj('11222333000181'), true);
  assert.equal(isValidCpfCnpj('123'), false);
});
