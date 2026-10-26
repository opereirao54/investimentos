// Story de contagem regressiva em vídeo, o "relógio" (7,5 s, sem narração).
// O número de ontem treme e vira o de hoje com um impacto; depois vem a frase
// (todo dia "Algo novo em 2027."; aos sábados, a pista da semana).
//
//   node marketing/ferramentas/shorts/relogio.js <dias> saida.mp4 ["frase"]
//
// A frase aceita <em> (verde-sinal) e <br>. Usa render.js para os quadros e
// trilha-relogio.py para o som (tique-taque, impacto e um pad grave).

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const [, , diasArg, saida, fraseArg] = process.argv;
const dias = Number(diasArg);
if (!saida || !Number.isInteger(dias) || dias < 1) {
  console.error('uso: node marketing/ferramentas/shorts/relogio.js <dias> saida.mp4 ["frase"]');
  process.exit(1);
}
const frase = fraseArg || 'Algo novo em <em>2027.</em>';
const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'relogio-'));
const html = fs
  .readFileSync(path.join(__dirname, 'relogio.html'), 'utf8')
  .replace('__ANTES__', String(dias + 1))
  .replace('__DIAS__', String(dias))
  .replace('__ROTULO__', dias === 1 ? 'dia' : 'dias')
  .replace('__FRASE__', frase);
const arq = path.join(pasta, 'relogio.html');
fs.writeFileSync(arq, html);

execFileSync('node', [path.join(__dirname, 'render.js'), pasta, arq], { stdio: 'inherit' });
const som = path.join(pasta, 'som.wav');
execFileSync('python3', [path.join(__dirname, 'trilha-relogio.py'), som], { stdio: 'inherit' });
execFileSync('ffmpeg', [
  '-y',
  '-loglevel',
  'error',
  '-i',
  path.join(pasta, 'video-sem-audio.mp4'),
  '-i',
  som,
  '-map',
  '0:v',
  '-map',
  '1:a',
  '-c:v',
  'copy',
  '-af',
  'loudnorm=I=-15:TP=-2:LRA=11',
  '-ar',
  '48000',
  '-c:a',
  'aac',
  '-b:a',
  '192k',
  '-shortest',
  '-movflags',
  '+faststart',
  saida,
]);
fs.rmSync(pasta, { recursive: true, force: true });
console.log('gerado: ' + saida);
