const { Pool } = require('pg');
require('dotenv').config();

// Sem string de conexão padrão: as credenciais fixas que ficavam aqui faziam o
// pool tentar um Postgres local a cada boot, poluindo o log com erro de senha e
// abrindo um caminho de conexão não intencional em qualquer máquina que tivesse
// um banco local de pé. Sem DATABASE_URL, o modo InMemoryStore assume, que é
// justamente o comportamento documentado para rodar sem banco.
const connectionString = process.env.DATABASE_URL || '';
const isProduction = process.env.NODE_ENV === 'production';

// Detecta se a conexão requer SSL (Supabase, Neon, Railway, Render, ou produção)
const needsSsl =
  process.env.NODE_ENV === 'production' ||
  process.env.DATABASE_SSL === 'true' ||
  connectionString.includes('supabase') ||
  connectionString.includes('neon.tech') ||
  connectionString.includes('railway') ||
  connectionString.includes('render.com') ||
  connectionString.includes('sslmode=require');

let isDbConnected = false;
let lastConnectionError = null;
// O banco pode estar conectado mas com schema incompleto (autoMigrate falhou
// ou outra instância ainda está migrando). /health não pode dizer "ok" nesse
// estado: o Render tiraria a instância nova do rotation cedo demais.
let isSchemaReady = false;
// Já houve conexão e o autoMigrate foi tentado? Ver ping().
let tentouMigrar = false;

function isConfigured() {
  return Boolean(process.env.DATABASE_URL);
}

// Por padrão, a validação do certificado TLS é relaxada (rejectUnauthorized:false),
// necessário para alguns poolers gerenciados (ex.: Supabase) cuja cadeia de
// certificados não é validável pelas CAs padrão do Node.
//
// Há duas formas de exigir validação estrita:
//  - DATABASE_SSL_CA: cole o certificado CA raiz do provedor (PEM). É o caminho
//    recomendado — valida de verdade contra a CA correta, sem depender de a
//    cadeia do provedor estar nas CAs públicas do Node.
//  - DATABASE_SSL_REJECT_UNAUTHORIZED=true: exige validação usando apenas as CAs
//    padrão do Node. Só funciona se o provedor emitir por uma CA pública.
const sslCa = (process.env.DATABASE_SSL_CA || '').trim();
const strictSsl = sslCa.length > 0 || process.env.DATABASE_SSL_REJECT_UNAUTHORIZED === 'true';

if (needsSsl && !strictSsl) {
  console.warn(
    '[Database] TLS sem validação de certificado (rejectUnauthorized:false). Para validação estrita, defina DATABASE_SSL_CA com o certificado CA do provedor (recomendado) ou DATABASE_SSL_REJECT_UNAUTHORIZED=true se a CA dele for pública.'
  );
}

const sslConfig = needsSsl
  ? { rejectUnauthorized: strictSsl, ...(sslCa ? { ca: sslCa } : {}) }
  : false;

const pool = new Pool({
  ...(connectionString ? { connectionString } : {}),
  ssl: sslConfig,
  connectionTimeoutMillis: 10000,
  idleTimeoutMillis: 10000,
  max: 10
});

// Conexão OCIOSA derrubada pelo servidor (restart, failover, pooler): o pool a
// descarta e abre outra na próxima consulta. Isso não quer dizer que o banco
// caiu — quem decide é o ping abaixo. Antes este evento zerava isDbConnected
// para sempre e o /health respondia 503 com o banco saudável.
pool.on('error', (err) => {
  console.warn('[Database] Aviso de conexão do pool PostgreSQL:', err.message);
  lastConnectionError = err.message;
});

async function checkConnection() {
  if (!connectionString) {
    isDbConnected = false;
    lastConnectionError =
      process.env.NODE_ENV === 'production'
        ? 'Variável DATABASE_URL ausente nas Environment Variables do serviço.'
        : 'DATABASE_URL não configurada: rodando com InMemoryStore.';
    console.log(`[Database] ${lastConnectionError}`);
    return false;
  }

  try {
    const client = await pool.connect();
    await client.query('SELECT 1');
    client.release();
    isDbConnected = true;
    lastConnectionError = null;
    tentouMigrar = true;
    console.log('[Database] PostgreSQL conectado com sucesso.');

    // Executa auto-migração assíncrona para garantir tabelas e seeds prontos
    try {
      const { runAutoMigration } = require('../db/autoMigrate');
      const migration = await runAutoMigration(pool);
      if (migration.success) {
        isSchemaReady = true;
      } else {
        isSchemaReady = false;
        throw new Error(`AutoMigrate falhou: ${migration.error || 'erro desconhecido'}`);
      }
    } catch (migErr) {
      isSchemaReady = false;
      console.warn(
        '[Database] AutoMigrate falhou, mas a conexão com o banco permanece ativa:',
        migErr.message
      );
    }

    return true;
  } catch (error) {
    isDbConnected = false;
    lastConnectionError = error.message;
    console.error(
      `[Database] PostgreSQL indisponível${isProduction ? ' em produção' : ''}:`,
      error.message
    );
    return false;
  }
}

// Verifica a conexão na inicialização. A promessa fica guardada porque
// isAvailable() muda de false para true de forma assíncrona: um teste cuja
// primeira operação é gravar no banco pode rodar antes desse ping terminar e
// cair silenciosamente no InMemoryStore, gerando um ID que não existe na tabela
// real (e uma violação de chave estrangeira mais tarde, quando outra chamada já
// vê isAvailable()=true e tenta usar esse mesmo ID no Postgres). Quem cria dados
// como primeira ação de um teste deve `await require('./database').whenReady()`
// antes.
const initialConnectionCheck = checkConnection();

// Estado de conexão vivo. Se o banco estava fora no boot, tenta de novo até
// conseguir aplicar o schema (sem isso a instância ficaria em 503 até ser
// reiniciada); depois disso, só confere se ele responde.
async function ping() {
  if (!tentouMigrar) return checkConnection();
  try {
    await pool.query('SELECT 1');
    isDbConnected = true;
    lastConnectionError = null;
  } catch (err) {
    isDbConnected = false;
    lastConnectionError = err.message;
  }
}
if (connectionString) setInterval(ping, 15000).unref();

/**
 * Decide o que fazer quando uma query falha, no lugar do catch que engolia o erro.
 *
 * O InMemoryStore existe para rodar a plataforma sem banco nenhum (dev, testes
 * unitários, demonstração local). Quando DATABASE_URL está configurada, o banco é
 * a única verdade e um erro de query tem de propagar: engoli-lo e escrever na
 * memória fazia uma instabilidade momentânea do Postgres virar saldo aplicado só
 * em RAM — a API respondia 200, a UI mostrava o valor novo, e tudo sumia no
 * próximo restart. Era também o que anulava o índice único de idempotência das
 * doações: a violação 23505 virava um warn e um "sucesso".
 *
 * @param {Error} err Erro vindo do driver do PostgreSQL.
 * @param {string} contexto Rótulo para o log (ex.: 'WalletModel.addCredits').
 */
function fallbackOrThrow(err, contexto) {
  if (isConfigured() || isProduction) {
    console.error(`[${contexto}] Erro no PostgreSQL:`, err.message);
    throw err;
  }
  console.warn(`[${contexto}] Sem banco configurado, usando InMemoryStore:`, err.message);
}

module.exports = {
  pool,
  // SQL em texto usa linhas como objetos. Sem o tipo, o driver pode ser inferido
  // pela sobrecarga rowMode: 'array', incompatível com os models.
  /** @param {string} text @param {any[]} [params] */
  query: async (text, params) => {
    const resultado = await pool.query(text, params);
    isDbConnected = true;
    return resultado;
  },
  connect: () => pool.connect(),
  // Com banco configurado (ou em produção), os models usam SEMPRE o banco e
  // falham com erro controlado se ele estiver fora — nunca caem em dados
  // voláteis do processo. O InMemoryStore é só para rodar sem DATABASE_URL.
  // Antes dependia de isDbConnected: um teste que gravasse antes do ping
  // inicial, ou qualquer queda momentânea, desviava escritas para a memória.
  isAvailable: () => isConfigured() || isProduction,
  isConnected: () => isDbConnected,
  /** Readiness real: banco conectado E schema aplicado (autoMigrate com sucesso). */
  isSchemaReady: () => isSchemaReady || !isConfigured(),
  isConfigured,
  checkConnection,
  fallbackOrThrow,
  whenReady: () => initialConnectionCheck
};
