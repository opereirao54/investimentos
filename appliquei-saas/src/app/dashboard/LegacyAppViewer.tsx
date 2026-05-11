import { readFileSync } from 'fs';
import { join } from 'path';

interface LegacyAppViewerProps {
  userId: string;
  userEmail: string;
}

/**
 * Componente que carrega e injeta o HTML legado do Appliquei v13.0
 * O HTML é carregado intacto do sistema de arquivos e injetado diretamente
 * SEM ALTERAR NENHUMA LINHA DO CÓDIGO ORIGINAL
 */
export default function LegacyAppViewer({ userId, userEmail }: LegacyAppViewerProps) {
  // Caminho para o arquivo HTML legado
  // Em produção (Vercel), o arquivo deve ser copiado para a pasta public ou bundle
  const htmlPath = join(process.cwd(), 'Appliquei_v13.0.html');
  
  let legacyHtml = '';
  
  try {
    // Lê o arquivo HTML original INTACTO
    legacyHtml = readFileSync(htmlPath, 'utf-8');
  } catch (error) {
    console.error('Erro ao carregar HTML legado:', error);
    return (
      <div className="min-h-screen bg-sb-dark text-white flex items-center justify-center">
        <div className="text-center p-8">
          <h2 className="text-2xl font-bold mb-4">Erro ao carregar aplicação</h2>
          <p className="text-sb-text">Não foi possível carregar o Appliquei v13.0</p>
          <p className="text-sb-text-muted text-sm mt-2">Caminho procurado: {htmlPath}</p>
        </div>
      </div>
    );
  }

  // Injeta informações do usuário autenticado via JavaScript
  // Isso permite que o HTML legado acesse os dados do usuário se necessário
  const userInjectionScript = `
    <script>
      // Dados do usuário autenticado (injetados pelo Next.js)
      window.AppliqueiAuth = {
        uid: '${userId}',
        email: '${userEmail}',
        authenticated: true,
        plano: 'pago'
      };
      
      // Console log discreto para debug
      console.log('[Appliquei] Usuário autenticado:', window.AppliqueiAuth.email);
    </script>
  `;

  // Insere o script de autenticação antes do fechamento do </head>
  // ou no final do <body> se não encontrar </head>
  let finalHtml = legacyHtml;
  
  if (finalHtml.includes('</head>')) {
    finalHtml = finalHtml.replace('</head>', `${userInjectionScript}</head>`);
  } else if (finalHtml.includes('</body>')) {
    finalHtml = finalHtml.replace('</body>', `${userInjectionScript}</body>`);
  } else {
    // Fallback: adiciona no final
    finalHtml = finalHtml + userInjectionScript;
  }

  // Renderiza o HTML completo como um documento standalone
  // Usamos dangerouslySetInnerHTML porque confiamos neste HTML (é nosso próprio arquivo)
  return (
    <div 
      className="fixed inset-0 w-full h-full"
      dangerouslySetInnerHTML={{ __html: finalHtml }}
    />
  );
}
