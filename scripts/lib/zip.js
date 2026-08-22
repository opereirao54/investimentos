'use strict';

// Leitor mínimo de ZIP, sobre o zlib do próprio Node.
//
// Existe em vez de uma dependência porque este código roda no job que
// ESCREVE na base de produção: cada pacote a mais aí é superfície de
// supply-chain num caminho privilegiado. Ler o diretório central de um ZIP e
// inflar deflate raw são duas coisas estáveis desde 1993 — não valem um
// `npm install` com permissão de escrita no Firestore.
//
// Suporta o que os arquivos da CVM usam: entradas `stored` (0) e `deflate`
// (8), com diretório central no fim. Não suporta ZIP64, cifra nem
// multi-volume — e recusa explicitamente em vez de devolver lixo.

const zlib = require('node:zlib');

const ASSINATURA_EOCD = 0x06054b50;
const ASSINATURA_CENTRAL = 0x02014b50;
const ASSINATURA_LOCAL = 0x04034b50;

/** Procura o End of Central Directory, varrendo do fim para o início. */
function acharEocd(buf) {
  // O EOCD tem 22 bytes fixos + comentário de até 64 KiB. Varrer de trás
  // cobre os dois casos sem ler o arquivo inteiro.
  const minimo = Math.max(0, buf.length - 22 - 0xffff);
  for (let i = buf.length - 22; i >= minimo; i--) {
    if (buf.readUInt32LE(i) === ASSINATURA_EOCD) return i;
  }
  return -1;
}

/**
 * Lê um ZIP em memória e devolve as entradas.
 * @param {Buffer} buf
 * @returns {Array<{nome: string, dados: Buffer}>}
 */
function lerZip(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 22) throw new Error('zip_vazio_ou_invalido');
  const eocd = acharEocd(buf);
  if (eocd < 0) throw new Error('zip_sem_diretorio_central');

  const totalEntradas = buf.readUInt16LE(eocd + 10);
  const offsetCentral = buf.readUInt32LE(eocd + 16);
  if (offsetCentral === 0xffffffff || totalEntradas === 0xffff) {
    throw new Error('zip64_nao_suportado');
  }

  const entradas = [];
  let p = offsetCentral;
  for (let i = 0; i < totalEntradas; i++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== ASSINATURA_CENTRAL) {
      throw new Error(`zip_central_corrompido_na_entrada_${i}`);
    }
    const flags = buf.readUInt16LE(p + 8);
    const metodo = buf.readUInt16LE(p + 10);
    const tamComprimido = buf.readUInt32LE(p + 20);
    const tamDescomprimido = buf.readUInt32LE(p + 24);
    const tamNome = buf.readUInt16LE(p + 28);
    const tamExtra = buf.readUInt16LE(p + 30);
    const tamComentario = buf.readUInt16LE(p + 32);
    const offsetLocal = buf.readUInt32LE(p + 42);
    const nome = buf.toString('utf8', p + 46, p + 46 + tamNome);
    p += 46 + tamNome + tamExtra + tamComentario;

    // Bit 0 = cifrado. Devolver bytes cifrados como se fossem CSV daria um
    // parse "bem-sucedido" com zero linhas, que é pior do que falhar.
    if (flags & 0x1) throw new Error(`zip_entrada_cifrada:${nome}`);
    if (nome.endsWith('/')) continue; // diretório

    if (offsetLocal + 30 > buf.length || buf.readUInt32LE(offsetLocal) !== ASSINATURA_LOCAL) {
      throw new Error(`zip_cabecalho_local_invalido:${nome}`);
    }
    const tamNomeLocal = buf.readUInt16LE(offsetLocal + 26);
    const tamExtraLocal = buf.readUInt16LE(offsetLocal + 28);
    const inicio = offsetLocal + 30 + tamNomeLocal + tamExtraLocal;
    const bruto = buf.subarray(inicio, inicio + tamComprimido);

    let dados;
    if (metodo === 0) {
      dados = Buffer.from(bruto);
    } else if (metodo === 8) {
      dados = zlib.inflateRawSync(bruto);
    } else {
      throw new Error(`zip_metodo_nao_suportado:${metodo}:${nome}`);
    }

    // Conferir o tamanho descomprimido é barato e apanha truncamento —
    // um CSV cortado ao meio parseia sem erro e perde empresas em silêncio.
    if (tamDescomprimido && dados.length !== tamDescomprimido) {
      throw new Error(
        `zip_tamanho_inesperado:${nome}:esperado_${tamDescomprimido}_veio_${dados.length}`
      );
    }
    entradas.push({ nome, dados });
  }
  return entradas;
}

module.exports = { lerZip };
