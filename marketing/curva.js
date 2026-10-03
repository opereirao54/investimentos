// A curva é o coração da peça: o saldo que mergulha abaixo do zero e volta
// quando a receita cai. Gerada por função, não desenhada à mão — é o que
// separa um traço de dado de um rabisco decorativo.
//
// Alvos, em fração da amplitude A acima/abaixo da linha de zero:
//   entra em  +0.55   mergulha a  -0.42   recupera a  +1.00
const INICIO = 0.55,
  FUNDO = -0.42,
  PICO = 1.0;

function curvaCaixa(L, A, zeroY) {
  const suave = (u) => u * u * (3 - 2 * u); // smoothstep
  const pts = [];
  for (let i = 0; i <= 200; i++) {
    const t = i / 200;
    // Vale contínuo: desce ao fundo e sobe quando a receita cai. Sem platô —
    // caixa real não tem chão reto, e um chão reto desenha uma caixa, não um
    // mergulho.
    const v =
      t < 0.46
        ? INICIO + (FUNDO - INICIO) * suave(t / 0.46)
        : FUNDO + (PICO - FUNDO) * suave((t - 0.46) / 0.54);
    pts.push([t * L, zeroY - v * A]);
  }
  return pts;
}

/** Onde a curva cruza o zero — os dois instantes que importam. */
function cruzamentos(p, zeroY) {
  const out = [];
  for (let i = 1; i < p.length; i++) {
    const a = p[i - 1][1] - zeroY,
      b = p[i][1] - zeroY;
    if (a === 0 || a * b < 0) out.push(p[i][0]);
  }
  return out;
}

function suavizar(p) {
  let d = `M ${p[0][0].toFixed(2)} ${p[0][1].toFixed(2)}`;
  for (let i = 0; i < p.length - 1; i++) {
    const p0 = p[i - 1] || p[i],
      p1 = p[i],
      p2 = p[i + 1],
      p3 = p[i + 2] || p2;
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += ` C ${c1[0].toFixed(2)} ${c1[1].toFixed(2)}, ${c2[0].toFixed(2)} ${c2[1].toFixed(2)}, ${p2[0].toFixed(2)} ${p2[1].toFixed(2)}`;
  }
  return d;
}

/** Só o trecho abaixo do zero, fechado contra a linha — a área do aperto. */
function areaAbaixo(p, zeroY) {
  const seg = p.filter((q) => q[1] >= zeroY);
  if (!seg.length) return '';
  return (
    suavizar(seg) +
    ` L ${seg[seg.length - 1][0].toFixed(2)} ${zeroY} L ${seg[0][0].toFixed(2)} ${zeroY} Z`
  );
}
module.exports = { curvaCaixa, suavizar, areaAbaixo, cruzamentos };
