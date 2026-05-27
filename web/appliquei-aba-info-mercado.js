/**
 * Appliquei — ABA 6: Info Mercado (RSS feed de notícias).
 *
 * Extraído de web/appliquei-app.js (Onda 3). Classic script. Sem deps
 * em app.js — só fetch + DOM. Pode carregar antes ou depois.
 */

// --- ABA 6: INFO MERCADO ---
async function carregarNoticias() {
    const container = document.getElementById('container-noticias'), loader = document.getElementById('loader-noticias');
    if (container.innerHTML.trim() !== "") return; 
    try {
        const response = await fetch(`https://api.rss2json.com/v1/api.json?rss_url=${encodeURIComponent('https://www.infomoney.com.br/feed/')}`);
        const data = await response.json();
        if(data.status === 'ok') {
            let html = '';
            data.items.slice(0, 6).forEach(noticia => {
                const dataPub = new Date(noticia.pubDate).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute:'2-digit' });
                html += `<div class="card-container" style="display: flex; flex-direction: column; padding: 20px; border-radius: var(--radius-sm);"><h3 style="font-size: 14px; margin-bottom: 12px; line-height: 1.5; flex: 1; font-weight:600;">${noticia.title}</h3><p style="font-size: 11px; color: var(--cor-texto-secundario); margin-bottom: 18px;"><i class="ph ph-calendar-blank"></i> ${dataPub}</p><a href="${noticia.link}" target="_blank" class="btn-secundario" style="text-align:center; display:block; text-decoration:none; width: 100%; font-size: 12px;">Ler Matéria ↗</a></div>`;
            });
            loader.style.display = 'none'; container.innerHTML = html; container.style.display = 'grid';
        }
    } catch (erro) {
        loader.style.display = 'none'; container.style.display = 'block'; container.innerHTML = '<div class="card-container"><p style="color: var(--cor-erro); text-align:center;">Falha na conexão com o Feed.</p></div>';
    }
}

