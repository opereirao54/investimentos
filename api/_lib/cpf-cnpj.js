// Validação de CPF/CNPJ por dígito verificador (módulo 11). Rejeita os
// casos triviais (todos os dígitos iguais) que passam no checksum mas são
// claramente sintéticos.

function onlyDigits(v) {
  return String(v == null ? '' : v).replace(/\D+/g, '');
}

function isValidCpf(c) {
  c = onlyDigits(c);
  if (c.length !== 11) return false;
  if (/^(\d)\1{10}$/.test(c)) return false;
  let sum = 0;
  for (let i = 0; i < 9; i++) sum += parseInt(c[i], 10) * (10 - i);
  let d1 = (sum * 10) % 11;
  if (d1 === 10) d1 = 0;
  if (d1 !== parseInt(c[9], 10)) return false;
  sum = 0;
  for (let i = 0; i < 10; i++) sum += parseInt(c[i], 10) * (11 - i);
  let d2 = (sum * 10) % 11;
  if (d2 === 10) d2 = 0;
  return d2 === parseInt(c[10], 10);
}

function isValidCnpj(c) {
  c = onlyDigits(c);
  if (c.length !== 14) return false;
  if (/^(\d)\1{13}$/.test(c)) return false;
  const w1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  const w2 = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += parseInt(c[i], 10) * w1[i];
  let d1 = sum % 11;
  d1 = d1 < 2 ? 0 : 11 - d1;
  if (d1 !== parseInt(c[12], 10)) return false;
  sum = 0;
  for (let i = 0; i < 13; i++) sum += parseInt(c[i], 10) * w2[i];
  let d2 = sum % 11;
  d2 = d2 < 2 ? 0 : 11 - d2;
  return d2 === parseInt(c[13], 10);
}

function isValidCpfCnpj(v) {
  const c = onlyDigits(v);
  if (c.length === 11) return isValidCpf(c);
  if (c.length === 14) return isValidCnpj(c);
  return false;
}

module.exports = { isValidCpf, isValidCnpj, isValidCpfCnpj, onlyDigits };
