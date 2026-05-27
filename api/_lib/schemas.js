'use strict';

// Schemas Zod compartilhados entre endpoints. Mantém validação consistente
// e reutilizável — evita repetir regex de CPF, e-mail, etc.
//
// Exporta tanto schemas individuais quanto helpers compostos para os
// payloads mais comuns. Cada endpoint compõe o seu via z.object({...}).

const { z } = require('zod');
const { isValidCpfCnpj } = require('./cpf-cnpj');

// CPF/CNPJ — aceita formatado ou só dígitos. Valida DV (módulo 11) via
// helper já existente. Trim + lowercase como normalização defensiva.
const cpfCnpj = z
  .string()
  .trim()
  .min(11, 'CPF/CNPJ inválido')
  .max(20, 'CPF/CNPJ inválido')
  .refine((v) => isValidCpfCnpj(v), { message: 'CPF/CNPJ inválido' });

// Código de referência: APP-XXXXXX (6 chars alfanuméricos uppercase).
const referralCode = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^APP-[A-Z0-9]{6}$/, 'cupom inválido');

// Pequeno helper: campo string opcional com trim/max.
const shortText = (max) =>
  z
    .string()
    .trim()
    .max(max, `máximo ${max} caracteres`)
    .optional();

// E-mail padrão (RFC-lite via Zod). Lowercase para normalizar.
const email = z.string().trim().toLowerCase().email('e-mail inválido');

// Telefone BR — 10 ou 11 dígitos, aceita com/sem máscara.
const phoneBR = z
  .string()
  .trim()
  .refine((v) => /^\d{10,11}$/.test(v.replace(/\D/g, '')), {
    message: 'telefone inválido (10 ou 11 dígitos)',
  });

// CEP: 8 dígitos.
const cep = z
  .string()
  .trim()
  .refine((v) => /^\d{8}$/.test(v.replace(/\D/g, '')), {
    message: 'CEP inválido (8 dígitos)',
  });

// Schemas por endpoint — exports nomeados para clareza nos handlers.

// POST /api/billing/init — opcionalmente recebe referralCode.
const billingInitBody = z
  .object({
    referralCode: referralCode.optional().nullable(),
  })
  .strict();

// POST /api/billing/subscribe — exige cpfCnpj + nome; campos opcionais para
// fluxo de cartão e endereço.
const billingSubscribeBody = z
  .object({
    cpfCnpj,
    name: z.string().trim().min(2).max(120),
    email: email.optional(),
    phone: phoneBR.optional(),
    postalCode: cep.optional(),
    addressNumber: shortText(20),
    creditCard: z
      .object({
        holderName: z.string().trim().min(2).max(120),
        number: z.string().trim().regex(/^\d{13,19}$/, 'número de cartão inválido'),
        expiryMonth: z.string().trim().regex(/^(0[1-9]|1[0-2])$/, 'mês inválido (01-12)'),
        expiryYear: z.string().trim().regex(/^\d{4}$/, 'ano inválido (YYYY)'),
        ccv: z.string().trim().regex(/^\d{3,4}$/, 'CCV inválido'),
      })
      .optional(),
  })
  .strip(); // descarta campos extras (não joga; mantém compat com versões antigas do front)

// POST /api/billing/customer — atualiza dados do cliente Asaas. Todos
// opcionais. Endpoint exige que pelo menos um campo seja fornecido.
const billingCustomerBody = z
  .object({
    name: z.string().trim().min(3).max(120).optional(),
    email: email.optional(),
    phone: phoneBR.optional(),
    mobilePhone: phoneBR.optional(),
    postalCode: cep.optional(),
    address: shortText(160),
    addressNumber: shortText(20),
    complement: shortText(120),
    province: shortText(120),
    city: shortText(120),
    state: z.string().trim().length(2).optional(),
    cpfCnpj: cpfCnpj.optional(),
  })
  .strip();

// POST /api/billing/card — atualiza só os dados do cartão. Asaas exige
// também creditCardHolderInfo com cpfCnpj (responsável pelo cartão pode
// diferir do customer principal).
const billingCardBody = z
  .object({
    creditCard: z.object({
      holderName: z.string().trim().min(2).max(120),
      number: z.string().trim().regex(/[\d\s]+/, 'número de cartão inválido'),
      expiryMonth: z.string().trim().regex(/^(0[1-9]|1[0-2])$/),
      expiryYear: z.string().trim().regex(/^\d{4}$/),
      ccv: z.string().trim().regex(/^\d{3,4}$/),
    }),
    creditCardHolderInfo: z
      .object({
        cpfCnpj,
        name: z.string().trim().min(2).max(120).optional(),
        email: email.optional(),
        phone: phoneBR.optional(),
        postalCode: cep.optional(),
        addressNumber: shortText(20),
      })
      .strip(),
  })
  .strip();

// GET /api/market?op=... — query schemas por op.
const marketQuoteQuery = z.object({
  op: z.literal('quote'),
  tickers: z.string().min(1).max(800), // 50 tickers * ~12 chars
});
const marketHistoryQuery = z.object({
  op: z.literal('history'),
  ticker: z.string().min(1).max(20),
  range: z.enum(['1m', '3m', '6m', '1y', '3y', '5y']),
});
const marketWarmupQuery = z.object({
  op: z.literal('warmup'),
});

// Sync push — payload do beacon de cloud-sync.
const syncPushBody = z
  .object({
    idToken: z.string().min(20),
    keys: z.record(z.string(), z.string().nullable()),
    keyRevs: z.record(z.string(), z.number().int().positive()),
  })
  .strict();

module.exports = {
  z,
  // building blocks
  cpfCnpj,
  referralCode,
  email,
  phoneBR,
  cep,
  shortText,
  // schemas por endpoint
  billingInitBody,
  billingSubscribeBody,
  billingCustomerBody,
  billingCardBody,
  marketQuoteQuery,
  marketHistoryQuery,
  marketWarmupQuery,
  syncPushBody,
};
