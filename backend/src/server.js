const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const dotenv = require('dotenv');
const http = require('http');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { Server } = require('socket.io');

dotenv.config();

const routes = require('./routes');
const webhooksRoutes = require('./routes/webhooks');
const authRoutes = require('./routes/auth');
const db = require('./config/database');
const TwitchService = require('./services/twitchService');
const ImageUploadService = require('./services/imageUploadService');
const KickService = require('./services/kickService');
const emailService = require('./services/emailService');
const { createRateLimiter, limparContadoresVencidos } = require('./middlewares/rateLimiter');
const { limparStatesVencidos } = require('./services/oauthStateStore');
const jwt = require('jsonwebtoken');
const { JWT_SECRET } = require('./config/secrets');
const { SESSION_COOKIE } = require('./config/session');

// Normaliza (trim, tamanho máximo, remove caracteres de controle) textos vindos de
// clientes não confiáveis (ex.: chat via WebSocket) antes de retransmiti-los. O
// escaping de HTML é responsabilidade de quem renderiza (frontend), aplicado de
// forma consistente em todos os pontos de exibição — ver escapeHtml em app.js.
function sanitizeText(value, fallback = '', maxLength = 255) {
  const str = typeof value === 'string' ? value : fallback;
  return (
    str
      // eslint-disable-next-line no-control-regex
      .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '')
      .trim()
      .slice(0, maxLength)
  );
}

const app = express();
app.set('trust proxy', 1);
const server = http.createServer(app);

// Política de CORS: combinar origin "*" com credentials:true é inválido e é ignorado
// pelos navegadores. Se CORS_ORIGIN estiver definido (uma ou mais origens separadas
// por vírgula), reflete essa(s) origem(ns) com credenciais habilitadas. Sem isso
// configurado, em produção não libera nenhuma origem cross-site (o frontend é servido
// pelo mesmo serviço Express, então chamadas do navegador já são same-origin e não
// precisam de CORS; webhooks de terceiros são server-to-server e não passam por CORS).
// Fora de produção, mantém liberado para facilitar desenvolvimento local.
const configuredOrigins = (process.env.CORS_ORIGIN || '')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);
const isProduction = process.env.NODE_ENV === 'production';
let corsOptions;
if (configuredOrigins.length > 0) {
  corsOptions = { origin: configuredOrigins, credentials: true };
} else if (isProduction) {
  corsOptions = { origin: false, credentials: false };
} else {
  corsOptions = { origin: '*', credentials: false };
}

function enforceSameOriginForMutations(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method) || req.path.startsWith('/webhooks/')) {
    return next();
  }

  const origin = req.headers.origin;
  if (!origin) return next();

  const allowedOrigins = new Set([`${req.protocol}://${req.get('host')}`, ...configuredOrigins]);
  if (!allowedOrigins.has(origin)) {
    return res.status(403).json({
      success: false,
      message: 'Origem da requisição não autorizada'
    });
  }
  return next();
}

const io = new Server(server, {
  cors: {
    ...corsOptions,
    methods: ['GET', 'POST']
  }
});

// Adapter multi-instância (P1-C): quando o Render subir uma 2ª instância, os
// eventos (chat, notificações, conquistas) precisam atravessar processos.
// Opt-in via SOCKET_ADAPTER=postgres (usa o pool existente, LISTEN/NOTIFY,
// sem Redis). Sem a env, mantém o adapter em memória — comportamento atual.
if (process.env.SOCKET_ADAPTER === 'postgres') {
  const { createAdapter } = require('@socket.io/postgres-adapter');
  const { pool } = require('./config/database');
  io.adapter(createAdapter(pool));
  console.log('[Socket.IO] Adapter PostgreSQL ativo (multi-instância).');
}

// Compartilha a instância do Socket.IO com os controllers Express
app.set('io', io);

app.disable('x-powered-by');
app.use(compression());

// Nonce por requisição: as páginas geradas pelo próprio backend (callbacks de
// OAuth, /status, /docs) carregam <script> inline e recebem este valor no
// atributo nonce. É o que permite tirar 'unsafe-inline' de script-src sem
// quebrá-las. Arquivos estáticos não precisam: index.html só usa <script src>.
app.use((req, res, next) => {
  res.locals.cspNonce = crypto.randomBytes(16).toString('base64');
  next();
});

app.use(
  helmet({
    // O frontend não tem mais nenhum <script> inline nem handler inline
    // (onclick/onerror viraram delegação de eventos em app.js), então script-src
    // dispensa 'unsafe-inline' e script-src-attr pode ficar em 'none'.
    //
    // style-src ainda precisa de 'unsafe-inline': o layout depende de centenas de
    // atributos style= espalhados pelo HTML e pelos cards renderizados em JS.
    // Migrar isso para classes é um trabalho de UI à parte, sem impacto no vetor
    // de XSS por execução de script, que é o que as diretivas acima fecham.
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        defaultSrc: ["'self'"],
        // 'wasm-unsafe-eval' libera só a compilação de WebAssembly (a simulação
        // dos jogos, ver games/sim). Não é 'unsafe-eval': eval() e new Function()
        // continuam bloqueados.
        scriptSrc: ["'self'", "'wasm-unsafe-eval'", (req, res) => `'nonce-${res.locals.cspNonce}'`],
        scriptSrcAttr: ["'none'"],
        // A simulação roda num Web Worker servido pela própria origem.
        workerSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        fontSrc: ["'self'"],
        imgSrc: ["'self'", 'data:', 'https:'],
        connectSrc: ["'self'", 'ws:', 'wss:'],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
        frameAncestors: ["'self'"]
      }
    }
  })
);
app.use(cors(corsOptions));

// Limite de corpo por rota.
//
// Os 15MB existem por causa de uma única funcionalidade: a imagem do brinde
// enviada em Base64 na criação de recompensa. Aplicado globalmente, esse limite
// valia também para /webhooks/*, que não exige autenticação prévia — a
// assinatura HMAC só é conferida depois do corpo inteiro ser lido, e o `verify`
// ainda guarda uma segunda cópia em req.rawBody. Eram 30MB de heap por
// requisição concorrente, de qualquer origem, no plano free.
const LIMITE_CORPO_PADRAO = '100kb';
const LIMITE_CORPO_UPLOAD = '15mb';

// rawBody é o que permite validar a assinatura HMAC sobre os bytes exatos que o
// gateway assinou, em vez de sobre um JSON re-serializado.
const capturaRawBody = (req, res, buf) => {
  req.rawBody = buf;
};

const ROTAS_DE_UPLOAD = ['/api/streamer-shop/rewards'];
const jsonPadrao = express.json({ limit: LIMITE_CORPO_PADRAO, verify: capturaRawBody });
const jsonUpload = express.json({ limit: LIMITE_CORPO_UPLOAD, verify: capturaRawBody });

app.use((req, res, next) =>
  (ROTAS_DE_UPLOAD.includes(req.path) ? jsonUpload : jsonPadrao)(req, res, next)
);
app.use(express.urlencoded({ limit: LIMITE_CORPO_PADRAO, extended: true }));
app.use('/api', enforceSameOriginForMutations);

// request-id para correlação de logs (antes de tudo, depois do body parser)
app.use(require('./middlewares/errorHandler').ensureRequestId);

/**
 * Lê o JWT do cookie de sessão, emitido no login (ver AuthController.login).
 *
 * Substitui o `?token=` que estas rotas aceitavam. Uma URL completa aparece no
 * log de acesso do provedor, no histórico do navegador e no cabeçalho Referer
 * enviado a qualquer host externo que a página carregue — o token tem validade
 * de 24h, então cada um desses lugares guardava uma credencial viva. O cookie é
 * HttpOnly (fora do alcance de script), Secure e SameSite=Strict.
 *
 * Sem cookie-parser: a leitura é uma linha e não justifica mais uma dependência.
 */
function tokenDoCookie(req) {
  const cabecalho = req.headers.cookie || '';
  const par = cabecalho.split(';').find((c) => c.trim().startsWith(`${SESSION_COOKIE}=`));
  return par ? decodeURIComponent(par.split('=').slice(1).join('=').trim()) : '';
}

// Usada por /health e /status para decidir se o diagnóstico detalhado (host de
// banco, engines, rotas internas) pode ser retornado em produção.
function isAdminRequest(req) {
  const token = tokenDoCookie(req);
  if (!token) return false;
  try {
    return jwt.verify(token, JWT_SECRET).role === 'admin';
  } catch (e) {
    return false;
  }
}

// Painel de testes E2E (/tests.html) é restrito a administradores autenticados.
// Como é uma navegação de página (não uma chamada de API com header Authorization),
// a identidade vem do cookie de sessão, validado aqui antes de a rota cair no
// express.static abaixo, que serve o arquivo normalmente em caso de sucesso.
app.get('/tests.html', (req, res, next) => {
  if (isProduction) {
    return res.status(404).send('Not found');
  }
  const token = tokenDoCookie(req);
  if (!token) {
    return res
      .status(403)
      .send(
        '<h1>403 - Acesso restrito a administradores</h1><p>Faça login com uma conta de administrador e acesse pelo menu de perfil.</p>'
      );
  }
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    if (decoded.role !== 'admin') {
      return res.status(403).send('<h1>403 - Acesso restrito a administradores</h1>');
    }
  } catch (err) {
    return res.status(403).send('<h1>403 - Token inválido ou expirado</h1>');
  }

  // O painel é um arquivo estático com <script> inline, então não há como
  // injetar o nonce da CSP global nele. Como a rota já é restrita a admins
  // autenticados, afrouxa a política apenas aqui.
  res.setHeader(
    'Content-Security-Policy',
    [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline'",
      "style-src 'self' 'unsafe-inline'",
      "font-src 'self'",
      "img-src 'self' data: https:",
      "connect-src 'self'",
      "object-src 'none'",
      "base-uri 'self'",
      "frame-ancestors 'self'"
    ].join('; ')
  );
  next();
});

// Navegadores pedem /favicon.ico por conta própria mesmo quando a página declara
// <link rel="icon"> apontando para outro arquivo. Redireciona para o SVG em vez
// de deixar o 404 aparecer no log e no console do usuário.
app.get('/favicon.ico', (req, res) => res.redirect(301, '/favicon.svg'));

// Página interna que prova a fundação dos jogos (games/client/sandbox.html).
// Em produção não existe: o jogo sandbox paga moedas fora de produção para o
// caminho de crédito poder ser testado, e a API também o recusa lá.
app.get('/games/sandbox.html', (req, res, next) => {
  if (isProduction) return res.status(404).send('Not found');
  return next();
});

// A Arena (hub de jogos) tem URL própria. Como a aplicação é uma SPA de um
// único documento, /game devolve o mesmo index.html e quem decide abrir direto
// no hub em vez da homepage é o app.js (ver showScreen/init). O no-store segue
// a mesma regra do HTML servido pelo express.static logo abaixo.
// /redefinir-senha e /confirmar-email sao os destinos dos links enviados por
// e-mail. Como a aplicacao e uma SPA de documento unico, devolvem o mesmo
// index.html e quem le o ?token= da URL e o app.js.
app.get(['/game', '/redefinir-senha', '/confirmar-email'], (req, res) => {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.sendFile(path.join(frontendPublicPath, 'index.html'));
});

// Servir arquivos estáticos do Frontend com controle de cache inteligente.
//
// O HTML nunca é cacheado: é ele que aponta para a versão atual dos assets.
// Scripts e estilos são referenciados com ?v=<versão> (ver index.html), então
// quando vêm versionados podem ser guardados por bastante tempo — sem isso, cada
// visita revalidava os cinco arquivos, gastando uma ida ao servidor por arquivo
// só para receber 304. Sem a query de versão, mantém a revalidação a cada uso,
// que é o comportamento seguro para quem acessa o arquivo direto.
const VERSIONED_ASSET_MAX_AGE = 60 * 60 * 24 * 30; // 30 dias
const frontendPublicPath = path.join(__dirname, '../../frontend/public');
app.use(
  express.static(frontendPublicPath, {
    etag: true,
    lastModified: true,
    setHeaders: (res, filePath) => {
      if (filePath.endsWith('.html')) {
        res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
        return;
      }
      // Os woff2 têm nome próprio por peso/subset e são substituídos por arquivo
      // novo quando mudam, então podem ser guardados sem revalidar — não passam
      // pela regra de ?v= abaixo porque o @font-face não carrega query.
      if (filePath.endsWith('.woff2')) {
        res.setHeader('Cache-Control', `public, max-age=${VERSIONED_ASSET_MAX_AGE}, immutable`);
        return;
      }
      // Saída do Vite em /games/assets/ já traz o hash do conteúdo no nome do
      // arquivo: mudou o conteúdo, mudou a URL.
      if (filePath.includes(`${path.sep}games${path.sep}assets${path.sep}`)) {
        res.setHeader('Cache-Control', `public, max-age=${VERSIONED_ASSET_MAX_AGE}, immutable`);
        return;
      }
      if (filePath.endsWith('.wasm')) {
        const versionado = Boolean(res.req && res.req.query && res.req.query.v);
        res.setHeader(
          'Cache-Control',
          versionado
            ? `public, max-age=${VERSIONED_ASSET_MAX_AGE}, immutable`
            : 'public, max-age=0, must-revalidate'
        );
        return;
      }
      if (filePath.endsWith('.js') || filePath.endsWith('.css')) {
        const versionado = Boolean(res.req && res.req.query && res.req.query.v);
        res.setHeader(
          'Cache-Control',
          versionado
            ? `public, max-age=${VERSIONED_ASSET_MAX_AGE}, immutable`
            : 'public, max-age=0, must-revalidate'
        );
      }
    }
  })
);

// Healthcheck com diagnóstico completo de todas as funcionalidades. Em produção,
// só devolve o diagnóstico detalhado (host de banco, engines, rotas de webhook,
// estado das integrações) para quem apresentar um token de admin válido via
// ?token=; sem isso, a resposta pública fica mínima — suficiente para checagens
// de uptime, sem servir de guia de reconhecimento de infraestrutura para terceiros.
app.get('/health', (req, res) => {
  const dbConnected = db.isConnected();
  const schemaPronto = db.isSchemaReady();
  // Só devolve 200 quando o schema está aplicado. Conexão viva com schema
  // incompleto (autoMigrate falhou ou outra instância ainda migra) = 503 —
  // o Render mantém a instância fora do rotation (P1 do ESCALA.md).
  const pronto = !db.isConfigured() || (dbConnected && schemaPronto);
  const twitchConfigured = TwitchService.isConfigured();
  const cloudinaryConfig = ImageUploadService.getCloudinaryConfig();
  const jwtConfigured = Boolean(
    process.env.JWT_SECRET && process.env.JWT_SECRET !== 'default_dev_secret'
  );

  const basePayload = {
    status: 'ok',
    environment: process.env.NODE_ENV || 'development',
    uptime_seconds: Math.floor(process.uptime()),
    timestamp: new Date().toISOString()
  };

  if (isProduction && !isAdminRequest(req)) {
    // Resposta pública reduzida ao essencial para um monitor externo: está de pé
    // e atendendo. O ambiente e o uptime saem daqui porque servem a quem faz
    // fingerprinting (uptime denuncia reinícios e janelas de instabilidade) e
    // não a quem só precisa saber se o serviço responde.
    // 503 com o banco fora: Render e HEALTHCHECK do Docker tratam a instância
    // como doente, em vez de "viva" servindo login e loja quebrados (incidente de
    // 2026-09-13).
    return res.status(pronto ? 200 : 503).json({
      status: pronto ? 'ok' : 'degraded',
      timestamp: new Date().toISOString()
    });
  }

  // Fora de produção o InMemoryStore é um modo válido; em produção, não.
  res.status(isProduction && !pronto ? 503 : 200).json({
    ...basePayload,
    services: {
      database: {
        status: dbConnected ? 'connected' : 'in_memory_fallback',
        engine: dbConnected ? 'PostgreSQL' : 'InMemoryStore',
        permanent_persistence: dbConnected,
        configured_in_env: db.isConfigured(),
        description: dbConnected
          ? 'Banco PostgreSQL conectado e sincronizado com autoMigrate.'
          : 'Modo de segurança em memória ativo (dados temporários da sessão).'
      },
      websockets: {
        status: 'online',
        engine: 'Socket.IO',
        description: 'Comunicação em tempo real para chat, ranking e eventos do jogo ativa.'
      },
      game_physics: {
        status: 'online',
        engine: 'Rust/WASM (livex_sim) em worker_threads',
        games_supported: ['jet_launcher', 'neon_drifter', 'void_walker'],
        description: 'Rodadas sorteadas por HMAC e liquidadas no servidor no clique.'
      },
      streamer_rewards_shop: {
        status: 'online',
        compliance: 'zero_cashout_approved',
        moderation_flow: 'streamer_request_admin_approval',
        description: 'Loja de brindes físicos e digitais com painel de moderação ativo.'
      },
      payments_gateways: {
        livepix: {
          status: 'per_streamer_webhook',
          webhook_path: '/webhooks/livepix/:streamerId',
          signature_validation: 'HMAC_SHA256',
          description:
            'Cada streamer conecta sua própria conta e recebe uma URL/segredo exclusivos, gerados na Central do Criador.'
        },
        pixgg: {
          status: 'per_streamer_webhook',
          webhook_path: '/webhooks/pixgg/:streamerId',
          signature_validation: 'HMAC_SHA256',
          description:
            'Cada streamer conecta sua própria conta e recebe uma URL/segredo exclusivos, gerados na Central do Criador.'
        }
      },
      integrations: {
        twitch_oauth: {
          status: twitchConfigured ? 'configured' : 'simulation_mode',
          description: twitchConfigured
            ? 'OAuth 2.0 oficial da Twitch ativo'
            : 'Modo de simulação ativo para testes'
        },
        cloudinary_cdn: {
          status: cloudinaryConfig ? 'connected' : 'direct_url_mode',
          description: cloudinaryConfig
            ? 'Armazenamento de imagens em CDN Cloudinary ativo'
            : 'Armazenamento via URLs diretas/Base64'
        }
      },
      security: {
        jwt_auth: jwtConfigured ? 'production_secured' : 'standard',
        cors_origin:
          configuredOrigins.length > 0
            ? configuredOrigins.join(',')
            : isProduction
              ? 'same_origin_only'
              : '*'
      },
      system_status: 'operational'
    }
  });
});

// Ping real no banco, revalidado em segundo plano a cada 15s. A pagina le o
// ultimo resultado e responde na hora: esperar a consulta deixaria /status
// pendurado por ate 10s (connectionTimeout do pool) justamente quando o banco
// esta fora. Antes do primeiro ping vale a flag que o pool ja mantem, atualizada
// na conexao inicial e a cada erro. Sem DATABASE_URL nem tenta consultar: o pool
// cairia no localhost padrao.
let cacheBanco = { em: 0, ok: false, checando: false };
function bancoRespondendo() {
  if (!db.isConfigured()) return false;
  if (!cacheBanco.checando && Date.now() - cacheBanco.em > 15000) {
    cacheBanco.checando = true;
    db.query('SELECT 1')
      .then(() => {
        cacheBanco = { em: Date.now(), ok: true, checando: false };
      })
      .catch(() => {
        cacheBanco = { em: Date.now(), ok: false, checando: false };
      });
  }
  return cacheBanco.em ? cacheBanco.ok : db.isConnected();
}

// Página pública de status. Cada cartão reflete uma checagem real feita na
// hora, mas só em linguagem de usuário: nada de host de banco, nome de
// variável, rota de webhook ou uptime — isso servia de guia de reconhecimento
// para terceiros e continuava visível em prints.
app.get('/status', (req, res) => {
  const imagens = ImageUploadService.getCloudinaryConfig();
  const servicos = [
    {
      nome: 'Site e Jogos',
      ok: true,
      desc: 'Servidor respondendo. Se esta página abriu, a Arena está no ar.'
    },
    {
      nome: 'Contas e Progresso',
      ok: bancoRespondendo(),
      desc: 'Banco de dados guardando cadastro, fichas, inventário e ranking.',
      descFalha:
        'Banco indisponível: o jogo segue rodando, mas o progresso desta sessão pode não ser salvo.'
    },
    {
      nome: 'Chat e Alertas ao Vivo',
      ok: Boolean(io && io.engine),
      desc: 'Conexão em tempo real para chat, alertas de doação e corrida.',
      descFalha: 'Tempo real indisponível: chat e alertas podem não atualizar sozinhos.'
    },
    {
      nome: 'E-mails da Conta',
      ok: Boolean(emailService.estaConfigurado() || process.env.BREVO_API_KEY),
      desc: 'Confirmação de e-mail e recuperação de senha sendo entregues.',
      descFalha:
        'Envio de e-mail indisponível: confirmação e recuperação de senha podem não chegar.'
    },
    {
      nome: 'Doações via PIX',
      ok: Boolean(
        (process.env.LIVEPIX_WEBHOOK_SECRET || '').trim() &&
        (process.env.PIXGG_WEBHOOK_SECRET || '').trim()
      ),
      desc: 'Recebimento de doações validado por assinatura, creditando fichas.',
      descFalha: 'Recebimento de doações em modo de verificação: fichas podem demorar a cair.'
    },
    {
      nome: 'Imagens dos Brindes',
      ok: Boolean(imagens && imagens.cloudName && imagens.apiKey),
      desc: 'Upload de imagem na lojinha dos streamers funcionando.',
      descFalha: 'Upload de imagem indisponível: use link direto na imagem do brinde.'
    },
    {
      nome: 'Twitch',
      ok: TwitchService.isConfigured(),
      desc: 'Vínculo de conta e verificação de inscrito ativos.',
      descFalha: 'Vínculo com a Twitch indisponível no momento.'
    },
    {
      nome: 'Kick',
      ok: KickService.isConfigured(),
      desc: 'Vínculo de conta e verificação de inscrito ativos.',
      descFalha: 'Vínculo com a Kick indisponível no momento.'
    }
  ];

  const fora = servicos.filter((s) => !s.ok).length;
  const tudoOk = fora === 0;
  const corGeral = tudoOk ? '#00ff9d' : '#ffb800';
  const resumo = tudoOk
    ? 'Tudo funcionando'
    : `${fora} ${fora === 1 ? 'serviço com limitação' : 'serviços com limitação'}`;

  const cartoes = servicos
    .map((s) => {
      const cor = s.ok ? '#00ff9d' : '#ffb800';
      const rotulo = s.ok ? 'Funcionando' : 'Com limitação';
      const texto = s.ok ? s.desc : s.descFalha || s.desc;
      return `      <div class="card" style="border-color: ${cor}33">
        <div class="card-top">
          <span class="card-name">${s.nome}</span>
          <span class="tag" style="color: ${cor}; border-color: ${cor}66"><i style="background:${cor}"></i>${rotulo}</span>
        </div>
        <p class="card-desc">${texto}</p>
      </div>`;
    })
    .join('\n');

  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(`<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>LiveX Games - Status dos Serviços</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background: #060b14;
      color: #e2e8f0;
      font-family: system-ui, -apple-system, 'Segoe UI', sans-serif;
      padding: 40px 20px;
      display: flex;
      justify-content: center;
    }
    .wrap { max-width: 840px; width: 100%; }
    h1 { font-size: 22px; color: #fff; }
    .resumo {
      display: inline-flex;
      align-items: center;
      gap: 10px;
      margin: 14px 0 26px;
      border: 1px solid ${corGeral};
      color: ${corGeral};
      border-radius: 999px;
      padding: 10px 20px;
      font-size: 16px;
      font-weight: 700;
    }
    .resumo i { width: 10px; height: 10px; border-radius: 50%; background: ${corGeral}; }
    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
      gap: 14px;
    }
    .card {
      background: rgba(255, 255, 255, 0.03);
      border: 1px solid rgba(255, 255, 255, 0.1);
      border-radius: 12px;
      padding: 16px;
    }
    .card-top {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      margin-bottom: 8px;
    }
    .card-name { font-weight: 700; color: #fff; font-size: 15px; }
    .tag {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      border: 1px solid;
      border-radius: 999px;
      padding: 3px 10px;
      font-size: 11px;
      font-weight: 700;
      white-space: nowrap;
    }
    .tag i { width: 7px; height: 7px; border-radius: 50%; }
    .card-desc { font-size: 13px; color: #94a3b8; line-height: 1.45; }
    a { display: inline-block; margin-top: 26px; color: #00f0ff; text-decoration: none; font-weight: 600; font-size: 14px; }
    a:hover { text-decoration: underline; }
  </style>
</head>
<body>
  <div class="wrap">
    <h1>Status dos Serviços</h1>
    <div class="resumo" role="status"><i></i>${resumo}</div>
    <div class="grid">
${cartoes}
    </div>
    <a href="/">← Voltar para o LiveX Games</a>
  </div>
</body>
</html>`);
});

// Especificação OpenAPI 3.0 para testes autônomos (TestSprite / QA) e integração
app.get('/openapi.json', (req, res) => {
  const openapiPath = path.join(__dirname, 'docs/openapi.json');
  if (fs.existsSync(openapiPath)) {
    return res.sendFile(openapiPath);
  }
  return res.status(404).json({ error: 'OPENAPI_SPEC_NOT_FOUND' });
});

// Documentação visual interativa da API (/docs)
// Assets do Swagger UI servidos pelo próprio serviço, a partir do pacote
// swagger-ui-dist instalado. Vinham do unpkg, o que exigia abrir script-src e
// style-src para um CDN de terceiros — sem SRI e numa faixa de versão flutuante
// (@5), ou seja, o conteúdo executado podia mudar sem nenhuma alteração aqui.
app.use(
  '/vendor/swagger-ui',
  express.static(path.dirname(require.resolve('swagger-ui-dist/swagger-ui.css')), {
    immutable: true,
    maxAge: VERSIONED_ASSET_MAX_AGE * 1000
  })
);

app.get(['/docs', '/api-docs'], (req, res) => {
  // Sem exceção de CSP: a política global já cobre esta página, porque agora
  // tudo que ela carrega é same-origin. O único script inline é o de
  // inicialização abaixo, autorizado pelo nonce da requisição.
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(`<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>LiveX Games — API Documentation (OpenAPI 3.0)</title>
  <link rel="stylesheet" href="/vendor/swagger-ui/swagger-ui.css">
  <style>
    body { margin: 0; padding: 0; background: #0b1120; font-family: sans-serif; }
    .top-banner {
      background: #020617;
      color: #00f0ff;
      padding: 14px 24px;
      font-weight: bold;
      display: flex;
      justify-content: space-between;
      align-items: center;
      border-bottom: 1px solid rgba(0, 240, 255, 0.2);
    }
    .top-banner a { color: #00ff9d; text-decoration: none; font-size: 14px; }
    .top-banner a:hover { text-decoration: underline; }
    .swagger-ui { filter: invert(88%) hue-rotate(180deg); }
    .swagger-ui .topbar { display: none; }
  </style>
</head>
<body>
  <div class="top-banner">
    <span>🎮 LiveX Games — API Documentation (OpenAPI 3.0)</span>
    <div>
      <a href="/openapi.json" target="_blank" style="margin-right: 15px;">📥 Baixar openapi.json</a>
      <a href="/status">📊 Status dos Serviços</a>
    </div>
  </div>
  <div id="swagger-ui"></div>
  <script src="/vendor/swagger-ui/swagger-ui-bundle.js"></script>
  <script nonce="${res.locals.cspNonce}">
    window.onload = function() {
      SwaggerUIBundle({
        url: '/openapi.json',
        dom_id: '#swagger-ui',
        deepLinking: true,
        presets: [
          SwaggerUIBundle.presets.apis,
          SwaggerUIBundle.SwaggerUIStandalonePreset
        ],
        layout: "BaseLayout"
      });
    };
  </script>
</body>
</html>`);
});

// Rate limiting de autenticação contra ataques de força bruta
const authRateLimiter = createRateLimiter({
  windowMs: 10 * 60 * 1000,
  max: 20,
  message: 'Muitas tentativas de autenticação detectadas. Aguarde 10 minutos.'
});

// Rate limiting para endpoints sensíveis de economia virtual (evita abuso/automação em massa)
const economyRateLimiter = createRateLimiter({
  windowMs: 10 * 60 * 1000,
  max: 30,
  message: 'Muitas requisições detectadas nesta operação. Aguarde alguns minutos.'
});

// Rotas da API REST
app.use('/api/auth/login', authRateLimiter);
app.use('/api/auth/register', authRateLimiter);
// Sem teto aqui, /forgot-password vira uma forma de mandar e-mail em massa em
// nome da plataforma (e de queimar a cota do provedor); /reset-password vira
// forca bruta sobre o token.
app.use('/api/auth/forgot-password', authRateLimiter);
app.use('/api/auth/reset-password', authRateLimiter);
app.use('/api/auth/resend-verification', authRateLimiter);
app.use('/api/payments/simulate', economyRateLimiter);
app.use('/api/streamer-shop/redeem', economyRateLimiter);
// Só a abertura gasta vida. Com app.use, reveal e finish da mesma rodada caíam no
// mesmo contador: 3 chamadas por rodada, e a 11ª rodada em 10 min tomava 429 no
// reveal com a vida já gasta e as moedas já creditadas.
app.post('/api/game/runs', economyRateLimiter);
app.use('/api', routes);
app.use('/api/auth', authRoutes); // Compatibilidade direta
app.use('/webhooks', webhooksRoutes);

// Tratamento de erros global — request-id + resposta padronizada
// (ver middlewares/errorHandler.js). Registrado APÓS as rotas.
app.use(require('./middlewares/errorHandler').notFoundHandler);
app.use(require('./middlewares/errorHandler').errorHandler);

// Middleware de autenticação Socket.IO para vincular a identidade criptográfica do JWT
io.use((socket, next) => {
  const authorization = socket.handshake.headers.authorization || '';
  const bearer = authorization.startsWith('Bearer ') ? authorization.slice(7).trim() : '';
  const cookieHeader = socket.handshake.headers.cookie || '';
  const cookiePair = cookieHeader
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${SESSION_COOKIE}=`));
  const cookieToken = cookiePair
    ? decodeURIComponent(cookiePair.slice(SESSION_COOKIE.length + 1))
    : '';
  const token =
    bearer && bearer !== 'session' && bearer !== 'null'
      ? bearer
      : cookieToken || socket.handshake.auth?.token || socket.handshake.query?.token;
  if (token) {
    try {
      const decoded = jwt.verify(token, JWT_SECRET);
      socket.user = {
        id: decoded.sub,
        username: decoded.username,
        role: decoded.role
      };
    } catch (err) {
      console.warn(`[Socket.IO] Token inválido no handshake do socket ${socket.id}`);
      socket.user = null;
    }
  } else {
    socket.user = null;
  }
  next();
});

/**
 * 'stream_room' é o canal público da live. As salas 'user_<id>' recebem eventos
 * privados (saldo da carteira, confirmação de assinatura), então só o próprio
 * dono autenticado entra nelas — aceitar o nome cru deixava qualquer cliente
 * entrar em user_<id_alheio> e ouvir esses eventos.
 * @param {{id: string}|null} user Identidade derivada do JWT do handshake.
 * @param {unknown} room Nome da sala pedido pelo cliente.
 */
function podeEntrarNaSala(user, room) {
  if (typeof room !== 'string' || !room) return false;
  if (room === 'stream_room') return true;
  return Boolean(user && user.id && room === `user_${user.id}`);
}

// Comunicação em tempo real via WebSockets
io.on('connection', (socket) => {
  console.log(`[Socket.IO] Cliente conectado: ${socket.id}`);

  // Salas: 'stream_room' é o canal público da live. As salas 'user_<id>' recebem
  // eventos privados (saldo da carteira, confirmação de assinatura), então cada
  // socket só entra na sala do próprio usuário autenticado — aceitar o nome cru
  // deixava qualquer cliente entrar em user_<id_alheio> e ouvir esses eventos.
  socket.on('join-room', (room) => {
    if (!podeEntrarNaSala(socket.user, room)) {
      console.warn(`[Socket.IO] Socket ${socket.id} teve acesso negado à sala: ${room}`);
      return;
    }

    socket.join(room);
    console.log(`[Socket.IO] Socket ${socket.id} entrou na sala: ${room}`);
  });

  // Chat ao vivo da stream — a identidade vem exclusivamente do JWT do handshake.
  // O campo username do payload é ignorado: aceitá-lo como alternativa permitia
  // que um socket anônimo publicasse com o nome de qualquer outra pessoa.
  //
  // Rate limit por socket (P1-C): sem teto, um cliente conectado podia inundar
  // o chat com milhares de mensagens por segundo — cada uma retransmitida a
  // TODOS os sockets. Limite: 5 mensagens / 10s por socket.
  const CHAT_LIMIT = 5;
  const CHAT_WINDOW_MS = 10_000;
  let chatTimestamps = [];
  socket.on('chat:send', (data) => {
    if (!data || typeof data.message !== 'string' || !data.message.trim()) return;

    const agora = Date.now();
    chatTimestamps = chatTimestamps.filter((t) => agora - t < CHAT_WINDOW_MS);
    if (chatTimestamps.length >= CHAT_LIMIT) {
      socket.emit('chat:rate-limited', { retryAfterMs: CHAT_WINDOW_MS });
      return;
    }
    chatTimestamps.push(agora);

    const author = socket.user?.username || 'Espectador';
    const role = socket.user?.role || 'viewer';
    const message = sanitizeText(data.message, '', 240);

    if (!message) return;

    // Broadcast escopado ao canal público (P1-C): 'stream_room' é quem de fato
    // assiste a live. O io.emit global anterior alcançava sockets fora da sala
    // (ex.: salas privadas user_<id>) desnecessariamente.
    io.to('stream_room').emit('chat:new-message', {
      author,
      role,
      message,
      timestamp: new Date().toISOString()
    });
  });

  // 'game:consume-item' retransmitia o payload cru do cliente para todos os
  // sockets conectados, sem autenticação nem validação, e nenhum cliente deste
  // repositório escutava 'game:item-consumed'. Removido por ser apenas um canal
  // de difusão anônimo sem consumidor.

  socket.on('disconnect', () => {
    console.log(`[Socket.IO] Cliente desconectado: ${socket.id}`);
  });
});

// Poda periódica das tabelas de estado efêmero. Elas crescem um registro por
// IP/rota e por login social iniciado; sem limpeza, crescem para sempre. A
// mesma rotina em várias instâncias é inofensiva: são DELETEs por data.
setInterval(
  async () => {
    try {
      await limparContadoresVencidos();
      await limparStatesVencidos();
    } catch (err) {
      console.warn('[Limpeza] Falha ao podar estado efêmero:', err.message);
    }
  },
  60 * 60 * 1000
).unref();

const PORT = process.env.PORT || 3000;

if (require.main === module) {
  server.listen(PORT, () => {
    console.log(`=========================================`);
    console.log(`🚀 Jet Launcher Server ativo na porta ${PORT}`);
    console.log(`🌐 Frontend: http://localhost:${PORT}`);
    console.log(`🏥 Healthcheck: http://localhost:${PORT}/health`);
    console.log(`=========================================`);
  });
}

// ─── Encerramento controlado (P1 do ESCALA.md) ───
// O Render envia SIGTERM antes de matar/reciclar a instância. Sem handler, o
// processo morria na hora: requisições em voo eram cortadas, e a fila de
// verificação/generação WASM ficava órfã. Agora:
//   1. Para de aceitar conexões novas (server.close);
//   2. Drena as requisições em andamento com um teto de DRENAGEM_MAX_MS;
//   3. Fecha o Socket.IO (desconecta clientes, sem eventos pendurados);
//   4. Encerra os workers do verificador (workers ociosos são unref, mas os
//      ocupados terminam o job atual antes de sair).
// As intenções 'reserving' e rodadas 'verifying' que sobrarem são recuperadas
// no próximo boot (abandonarReservingStale / recuperarGeradas).
//
// O teste de shutdown não depende de sinal do SO (no Windows child.kill não
// entrega SIGTERM/SIGINT de forma confiável): com SHUTDOWN_PORT definido, uma
// conexão TCP dispara o mesmo caminho de graceful — igualzinho ao SIGTERM.
let encerrando = false;
async function gracefulShutdown(sinal) {
  if (encerrando) return;
  encerrando = true;
  console.log(`[Shutdown] ${sinal} recebido. Iniciando encerramento controlado...`);

  // Para de aceitar conexões novas e drena as em voo com timeout.
  // Teto de segurança: se algo ficou pendurado, força a saída.
  const DRENAGEM_MAX_MS = 10_000;
  const drenagem = new Promise((resolve) => {
    server.close(() => resolve());
    setTimeout(() => resolve(), DRENAGEM_MAX_MS);
  });
  await drenagem;

  try {
    await io.close();
  } catch (err) {
    console.warn('[Shutdown] Falha ao fechar Socket.IO:', err.message);
  }

  try {
    const { encerrar } = require('./services/sim/runVerifier');
    await encerrar();
  } catch (err) {
    console.warn('[Shutdown] Falha ao encerrar workers do verificador:', err.message);
  }

  console.log('[Shutdown] Encerramento concluído. Até logo!');
  process.exit(0);
}
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

const shutdownPort = Number(process.env.SHUTDOWN_PORT || 0);
if (shutdownPort > 0) {
  const net = require('net');
  net
    .createServer((socket) => {
      socket.end();
      gracefulShutdown('SHUTDOWN_PORT');
    })
    .listen(shutdownPort, () => {
      console.log(`[Shutdown] Porta de shutdown escutando em ${shutdownPort}`);
    });
}

module.exports = { app, server, io, podeEntrarNaSala };
