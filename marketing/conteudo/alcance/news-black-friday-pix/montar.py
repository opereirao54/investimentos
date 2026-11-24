"""Appliquei News "Black Friday: vai pagar no Pix?" em HyperFrames, no padrão real da Appliquei
(tokens de marketing/ferramentas/shorts: video.html dos Reels, capa.js "news", contagem.js, render.js).

    python3 montar.py <pasta-voz>      (ex.: python3 montar.py charon)
        → video/index.html  e  video/corte.json (onde entra a vinheta, para juntar.sh)

<pasta-voz>: partes.json (+ legenda.html, se houver; senão usa ./legenda.html).
Depois do hf render: ./juntar.sh (capa no 1º quadro, vinheta News de 1,6 s depois do gancho,
selo já no vídeo, compressão final única no perfil C do contagem.js).
"""
import json, os, sys
AQ = os.path.dirname(os.path.abspath(__file__))
S = sys.argv[1] if len(sys.argv) > 1 else 'saida'
if not os.path.isabs(S):
    S = os.path.join(AQ, S)
DIAS = int(os.environ.get('DIAS', 38))        # qua 25/11/2026 → lançamento 02/01/2027
P = json.load(open(os.path.join(S, 'partes.json')))
T = [(a, a + d) for a, _, d, _ in P]
DUR = round(T[-1][1] + 1.2, 2)
CAPA = 0.7
INI = [0.0] + [round(a - 0.25, 2) for a, _ in T[1:]]
FIM = INI[1:] + [DUR]
LEGARQ = os.path.join(S, 'legenda.html')
LEG = open(LEGARQ if os.path.exists(LEGARQ) else os.path.join(AQ, 'legenda.html')).read()
FONTES = open(os.path.join(AQ, 'video', 'assets', 'fonts', 'fontes.css')).read()
# a vinheta entra no corte entre o gancho (fala 0) e a fala 1, no meio da pausa
CORTE = round((T[0][1] + T[1][0]) / 2, 2)

def cena(n, corpo):
    a, b = INI[n], FIM[n]
    return f'<div id="s{n}" class="clip cena" data-start="{a:.2f}" data-duration="{b - a:.2f}" data-track-index="1">{corpo}</div>'

CEL = lambda extra='': f'''<div class="cel" {extra}><div class="tela">
  <div class="loja">FINALIZAR COMPRA</div>
  <div class="prod"><div class="tv"></div><b>Smart TV 55"</b><s>total</s><strong>R$ 899</strong></div>
  <div class="btn pix" id="bpix">PAGAR COM PIX</div><div class="btn cart">Cartão de crédito</div></div></div>'''
DIAS_TXT = 'É hoje' if DIAS == 0 else f'Faltam <b>{DIAS}</b> {"dia" if DIAS == 1 else "dias"}'

html = f'''<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=1080, height=1920">
<script src="assets/gsap.min.js"></script>
<style>
{FONTES}
:root {{ --campo1:#0b1410; --campo2:#0f1f18; --campo3:#112720; --tinta:#f0faf4; --deck:#c8d6cf; --mudo:#9fb3aa;
  --sinal:#34d399; --primaria:#059669; --ambar:#fbbf24; --vermelho:#f87171; --azul:#60a5fa; --news:#b91c1c; --pix:#32bcad; }}
*{{margin:0;padding:0;box-sizing:border-box}}
html,body{{width:1080px;height:1920px;overflow:hidden;background:var(--campo1)}}
#root{{position:relative;width:1080px;height:1920px;overflow:hidden;font-family:'Figtree',sans-serif;-webkit-font-smoothing:antialiased;color:var(--tinta);
  background:linear-gradient(150deg,var(--campo1) 0%,var(--campo2) 50%,var(--campo3) 100%)}}
.halo{{position:absolute;inset:-20%;background:radial-gradient(60% 40% at 80% 10%,rgba(16,185,129,.22),transparent 70%),radial-gradient(40% 35% at 10% 90%,rgba(5,150,105,.18),transparent 70%)}}
.grade{{position:absolute;inset:0;background-image:linear-gradient(rgba(240,250,244,.03) 1px,transparent 1px),linear-gradient(90deg,rgba(240,250,244,.03) 1px,transparent 1px);background-size:60px 60px;background-position:-1px -1px}}
/* topo fixo, igual aos Reels: wordmark à esquerda, tarja da série e selo da contagem (contagem.js) à direita */
.logo-fixo{{position:absolute;left:60px;top:60px;width:200px;z-index:20}}
.serie{{position:absolute;right:150px;top:60px;padding:10px 20px;border-radius:99px;background:var(--news);color:#fff;font-family:'DM Mono',monospace;font-weight:500;font-size:22px;letter-spacing:.14em;text-transform:uppercase;box-shadow:0 6px 18px rgba(0,0,0,.35);z-index:20}}
.dias{{position:absolute;right:60px;top:130px;display:inline-flex;align-items:center;gap:12px;padding:12px 24px;border-radius:99px;background:rgba(11,20,16,.82);border:2px solid var(--ambar);color:#fde68a;font-family:'DM Mono',monospace;font-size:28px;letter-spacing:.06em;white-space:nowrap;z-index:20}}
.dias b{{color:var(--ambar);font-weight:500;font-size:34px}} .dias i{{width:12px;height:12px;border-radius:50%;background:var(--ambar);box-shadow:0 0 12px var(--ambar)}}
.barra-t{{position:absolute;left:0;bottom:0;height:8px;background:linear-gradient(90deg,var(--primaria),var(--sinal));z-index:30}}
.cena{{position:absolute;inset:0}}
.tit{{position:absolute;left:90px;right:90px;font-weight:900;font-size:84px;line-height:1.05;letter-spacing:-.035em}}
.tit .am{{color:var(--ambar)}} .tit .v{{color:var(--sinal)}}
.cel{{position:absolute;left:290px;top:560px;width:500px;height:740px;border-radius:64px;background:#0a0f0c;padding:18px;box-shadow:0 30px 70px rgba(0,0,0,.45)}}
.tela{{width:100%;height:100%;border-radius:48px;background:#fff;color:#12241c;padding:34px 30px;position:relative;overflow:hidden}}
.loja{{font-family:'DM Mono',monospace;font-size:24px;color:#51655b}} .loja span{{font-family:'Figtree';background:var(--news);color:#fff;padding:2px 10px;border-radius:8px;font-size:20px;font-weight:900;margin-left:8px}}
.prod{{margin-top:24px;text-align:center}} .prod .tv{{width:300px;height:140px;margin:0 auto 12px;background:#1d2a23;border-radius:14px;border:8px solid #333}}
.prod b{{display:block;font-size:34px;font-weight:900}} .prod s{{display:block;text-decoration:none;text-transform:uppercase;letter-spacing:.12em;color:#51655b;font-family:'DM Mono',monospace;font-size:28px;margin-top:6px}} .prod strong{{display:block;font-family:'DM Mono',monospace;font-weight:500;font-size:64px;letter-spacing:-.04em}} .prod em{{color:var(--news);font-style:normal;font-weight:900;font-size:26px}}
.btn{{position:absolute;left:30px;right:30px;text-align:center;font-weight:900;border-radius:20px;padding:22px 0;font-size:34px}}
.pix{{bottom:140px;background:var(--pix);color:#fff}} .cart{{bottom:44px;background:#e7eeea;color:#1d2a23;font-size:28px}}
.mao{{position:absolute;left:620px;top:1110px;font-size:110px;z-index:8}}
/* manchete no visual da marca (card claro com barra vermelha, como nos News) */
.faixa{{position:absolute;left:70px;right:70px;top:250px;background:#f4f4f0;border-radius:22px;overflow:hidden;box-shadow:10px 12px 0 rgba(0,0,0,.55);z-index:5}}
.faixa b{{display:block;background:var(--news);color:#fff;font-weight:900;font-size:30px;letter-spacing:.04em;padding:14px 34px;text-transform:uppercase}}
.faixa span{{display:block;color:#111;font-size:46px;font-weight:900;line-height:1.12;letter-spacing:-.015em;padding:22px 34px 24px}}
.barras{{position:absolute;left:150px;right:150px;top:700px;height:500px;display:flex;gap:80px;align-items:flex-end}}
.barras div{{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:flex-end;height:100%}}
.barras i{{display:block;width:100%;border-radius:14px 14px 0 0}} .barras b{{margin-top:14px;font-family:'DM Mono',monospace;font-size:30px;font-weight:400;letter-spacing:.12em;text-transform:uppercase;color:var(--mudo)}}
.tag{{position:absolute;left:90px;right:90px;font-family:'DM Mono',monospace;font-size:24px;letter-spacing:.04em;color:var(--mudo);display:flex;gap:12px;align-items:center}}
.tag::before{{content:'';flex:none;width:10px;height:22px;background:var(--sinal)}}
.cartao{{position:absolute;left:240px;top:560px;width:600px;height:370px;border-radius:34px;background:linear-gradient(135deg,#059669,#064e3b);box-shadow:0 26px 50px rgba(0,0,0,.4);padding:40px;font-family:'DM Mono',monospace}}
.cartao .chip{{width:90px;height:66px;border-radius:12px;background:var(--ambar)}} .cartao .num{{margin-top:60px;font-size:40px;letter-spacing:.12em}} .cartao .nm{{margin-top:20px;font-size:26px;color:#d1fae5;letter-spacing:.08em}}
.selo{{position:absolute;font-weight:900;border-radius:22px;padding:18px 34px;font-size:46px;white-space:nowrap}}
.papel{{position:absolute;left:70px;right:70px;top:560px;background:#f4f4f0;color:#111;border-radius:22px;overflow:hidden;box-shadow:10px 12px 0 rgba(0,0,0,.55)}}
.papel .org{{background:var(--news);color:#fff;font-weight:900;font-size:30px;letter-spacing:.04em;padding:14px 34px;text-transform:uppercase}} .papel .q{{font-weight:900;font-size:52px;line-height:1.15;padding:26px 34px 30px;letter-spacing:-.015em}}
.grifo{{background:linear-gradient(90deg, rgba(251,191,36,.85) 0 var(--g,0%), transparent var(--g,0%));padding:0 .06em}}
.lado{{position:absolute;left:90px;right:90px;top:1040px;display:flex;gap:30px}}
.lado div{{flex:1;border-radius:30px;padding:24px;text-align:center;font-weight:900;font-size:50px}}
.lado .ok{{background:rgba(52,211,153,.12);border:3px solid rgba(52,211,153,.55);color:var(--sinal)}} .lado .no{{background:rgba(248,113,113,.1);border:3px solid rgba(248,113,113,.5);color:var(--vermelho)}}
.cta{{position:absolute;left:90px;right:90px;font-weight:900;font-size:84px;line-height:1.05;letter-spacing:-.035em}}
.assina{{position:absolute;left:0;right:0;text-align:center}} .assina img{{width:440px}} .assina p{{margin-top:26px;font-size:44px;font-weight:800;color:var(--deck)}} .assina p em{{font-style:normal;color:var(--sinal)}}
.aviso{{position:absolute;left:80px;right:80px;padding:22px 26px;border-radius:22px;background:rgba(11,20,16,.9);border:2px solid rgba(240,250,244,.35);text-align:center;font-size:25px;line-height:1.4;color:var(--tinta)}}
/* legenda: mesma do render.js (centro em y 1430, faixa livre 1340-1520) */
.lg{{position:absolute;left:70px;right:70px;top:1370px;height:120px;display:flex;justify-content:center;align-items:center;z-index:40}}
.lg .pill{{padding:14px 30px 18px;border-radius:24px;background:rgba(6,12,9,.78);box-shadow:0 10px 30px rgba(0,0,0,.35);font-weight:900;font-size:66px;letter-spacing:-.015em;white-space:nowrap;line-height:1.12;color:var(--tinta)}}
.lg .hl{{color:var(--sinal)}}
.flash{{position:absolute;inset:0;background:var(--campo1);opacity:0;z-index:30;pointer-events:none}}
/* capa (capa.js "news": true) */
.faixa-news{{position:absolute;left:-40px;right:-40px;top:300px;height:300px;background:var(--news);display:flex;flex-direction:column;align-items:center;justify-content:center;transform:skewY(-4deg);box-shadow:0 24px 60px rgba(0,0,0,.35)}}
.faixa-news b{{font-size:124px;font-weight:900;letter-spacing:-.045em;line-height:1;color:#fff;transform:skewY(4deg)}}
.faixa-news span{{margin-top:10px;padding:6px 34px;background:#fff;color:var(--news);font-family:'DM Mono',monospace;font-size:70px;letter-spacing:.32em;text-indent:.32em;transform:skewY(4deg)}}
.miolo{{position:absolute;left:80px;right:80px;top:660px;height:1020px;padding-top:70px;display:flex;flex-direction:column;align-items:center;text-align:center}}
.miolo .frase{{font-weight:900;font-size:104px;line-height:1.04;letter-spacing:-.04em}} .miolo .frase em{{font-style:normal;color:var(--ambar)}}
.miolo .apoio{{margin-top:48px;font-size:44px;font-weight:800;color:var(--deck)}} .miolo img{{margin-top:90px;width:300px;opacity:.95}}
</style>
<body>
<div id="root" data-composition-id="main" data-start="0" data-duration="{DUR + CAPA:.2f}" data-width="1080" data-height="1920">
<div class="halo"></div><div class="grade"></div>
<img class="logo-fixo" id="logo" src="assets/wordmark.svg" alt="Appliquei">
<div class="serie" id="serie">Appliquei News</div>
<div class="dias" id="dias"><i></i>{DIAS_TXT}</div>

{cena(0, f'''<div class="tit" style="top:250px">Black Friday:<br><span class="am">vai pagar no Pix?</span></div>{CEL('id="c0"')}<div class="mao" id="mao">👆</div>''')}

{cena(1, '''<div class="tit" id="fx" style="top:250px;font-size:72px">De cada R$ 100<br>perdidos no Pix,<br><span class="am">menos de R$ 10 voltam</span></div>
<div class="barras"><div><b style="order:-1;margin:0 0 14px;color:var(--tinta);font-size:46px;font-weight:500;letter-spacing:-.02em" id="n1">R$ 100</b><i id="b1" style="height:100%;background:var(--vermelho)"></i><b>perdidos</b></div>
<div><b style="order:-1;margin:0 0 14px;color:var(--ambar);font-size:46px;font-weight:500;letter-spacing:-.02em" id="n2">R$ 0</b><i id="b2" style="height:0%;background:var(--ambar)"></i><b>volta, em média</b></div></div>
<div class="tag" style="top:1240px">Banco Central · MED, dados de 2025</div>''')}

{cena(2, '''<div class="tit" style="top:250px;font-size:76px">No cartão:<br><span class="v">dá pra contestar</span></div>
<div class="cartao" id="cc"><div class="chip"></div><div class="num">•••• •••• •••• 4821</div><div class="nm">CARTÃO DE CRÉDITO</div></div>
<div class="selo" id="est" style="left:300px;top:1010px;background:var(--sinal);color:#052e1f">↩ estorno pedido</div>''')}

{cena(3, '''<div class="tit" style="top:250px;font-size:76px">O Procon<br><span class="am">orienta</span></div>
<div class="papel" id="pp"><div class="org">Procon-MG · dicas para compras online</div><div class="q">Em loja que você não conhece, use o <span class="grifo" id="gr">cartão de crédito, e não o Pix</span>.</div></div>
<div class="lado" id="ld" style="top:1110px"><div class="ok">✓ cartão</div><div class="no">✗ Pix</div></div>''')}

{cena(4, '''<div class="tit" style="top:250px;font-size:76px">Melhor ainda:<br><span class="v">cartão virtual</span></div>
<div class="cartao" id="cv" style="background:linear-gradient(135deg,#1d2a23,#0b1410);border:3px solid var(--sinal)"><div class="chip" style="background:var(--sinal)"></div><div class="num">•••• •••• •••• <b id="nv">0000</b></div><div class="nm">VIRTUAL · NO APP DO BANCO</div></div>
<div class="tag" style="top:1010px">os bancos orientam: cartão virtual nas compras online</div>''')}

{cena(5, '''<div class="cta" style="top:250px">Manda pra quem<br>vai comprar<br><span style="color:var(--ambar)">na sexta</span></div>
<div class="assina" style="top:640px"><img src="assets/wordmark.svg" alt="Appliquei"><p>Mais contas assim: <em>siga o Appliquei</em></p></div>
<div class="aviso" style="top:1000px">Banco Central, MED: em 2025 voltaram em média 9,3% do valor contestado em golpes no Pix; Procon-MG, orientação para compras online; orientação dos bancos sobre o cartão virtual. Conteúdo educacional, não é recomendação. Valores da TV de exemplo, loja fictícia.</div>''')}

<div id="sc" class="clip cena" data-start="{DUR:.2f}" data-duration="{CAPA}" data-track-index="2">
<div class="faixa-news"><b>APPLIQUEI</b><span>NEWS</span></div>
<div class="miolo"><div class="frase">Black Friday:<br>vai pagar<br>no <em>Pix?</em></div><div class="apoio">De R$ 100 perdidos no Pix,<br>voltam menos de R$&nbsp;10</div><img src="assets/wordmark.svg" alt="Appliquei"></div></div>

{LEG}
<div class="flash" id="fl"></div>
<div class="barra-t" id="bt"></div>
</div>
<script>
const INI={json.dumps(INI)}; const DUR={DUR};
const tl=gsap.timeline({{paused:true}});
const m={{t:0}};
const fmt=v=>'R$ '+v.toFixed(2).replace('.',',').replace(',00','');
tl.to(m,{{t:DUR+{CAPA},duration:DUR+{CAPA},ease:'none',onUpdate:()=>{{const t=m.t;
  // topo e barra de progresso somem na capa do fim (o selo fica, como no contagem.js)
  const cap=t>=DUR; ['logo','serie','bt'].forEach(i=>document.getElementById(i).style.opacity=cap?0:1);
  document.getElementById('bt').style.width=(Math.min(1,t/DUR)*1080).toFixed(1)+'px';
  const p=1+0.05*Math.abs(Math.sin(t*5)); document.getElementById('bpix').style.transform=`scale(${{p}})`;
  document.getElementById('mao').style.transform=`translate(${{-Math.max(0,Math.min(1,t/1.2))*120}}px, ${{-Math.max(0,Math.min(1,t/1.2))*20}}px)`;
  const l=t-INI[1], k=Math.max(0,Math.min(1,(l-3.6)/1.0));
  document.getElementById('n2').textContent=fmt(9.3*k); document.getElementById('b2').style.height=(9.3*k)+'%';
  const g=Math.max(0,Math.min(1,(t-INI[3]-1.8)/0.8)); document.getElementById('gr').style.setProperty('--g',(g*100).toFixed(1)+'%');
  const v=t-INI[4]; document.getElementById('nv').textContent=v<0.5?'0000':String(1000+Math.floor((v*37)%9000)).slice(0,4);
}}}},0);
INI.slice(1).forEach(a=>tl.fromTo('#fl',{{opacity:.6}},{{opacity:0,duration:.18,ease:'none',immediateRender:false}},a));
tl.fromTo('#fx',{{y:-40,opacity:0}},{{y:0,opacity:1,duration:.3,ease:'power3.out'}},INI[1]+0.05);
tl.fromTo('#cc',{{rotationY:70,opacity:0}},{{rotationY:0,opacity:1,duration:.4,ease:'back.out(1.6)'}},INI[2]+0.2);
tl.fromTo('#est',{{scale:0,opacity:0}},{{scale:1,opacity:1,duration:.3,ease:'back.out(2.5)'}},INI[2]+2.2);
tl.fromTo('#pp',{{y:60,opacity:0}},{{y:0,opacity:1,duration:.3}},INI[3]+0.4);
tl.fromTo('#ld',{{y:60,opacity:0}},{{y:0,opacity:1,duration:.3}},INI[3]+3.2);
tl.fromTo('#cv',{{scale:.6,opacity:0}},{{scale:1,opacity:1,duration:.35,ease:'back.out(1.8)'}},INI[4]+0.3);
document.querySelectorAll('.lg .pill').forEach(p=>tl.fromTo(p,{{scale:.92}},{{scale:1,duration:.12,ease:'power2.out'}},parseFloat(p.parentElement.dataset.start)));
window.__timelines=window.__timelines||{{}}; window.__timelines['main']=tl; tl.seek(0);
</script></body></html>'''
open(os.path.join(AQ, 'video', 'index.html'), 'w').write(html)
json.dump({'corte': CORTE, 'dur': DUR, 'capa': CAPA, 'dias': DIAS}, open(os.path.join(AQ, 'video', 'corte.json'), 'w'))
print('ok', DUR, INI, 'corte', CORTE, 'legenda', LEGARQ if os.path.exists(LEGARQ) else 'local')
