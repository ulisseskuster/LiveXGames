const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');

/**
 * A tabela users tem UNIQUE em id, username E email, mas os seeds usam
 * "ON CONFLICT (id)", que só cobre a chave primária. Quando uma conta real
 * criada pelo site ocupa o username/e-mail de uma persona (com UUID diferente
 * do fixo do seed), o INSERT viola users_username_key e derruba a migração.
 *
 * Retorna o id da conta conflitante, ou null se o caminho estiver livre. Quem
 * chama deve pular a persona: a conta real do usuário sempre ganha do seed.
 */
async function findIdentityConflict(client, id, username, email) {
  const { rows } = await client.query(
    `SELECT id, username, email FROM users
     WHERE (LOWER(username) = LOWER($2) OR LOWER(email) = LOWER($3))
       AND id <> $1
     LIMIT 1`,
    [id, username, email]
  );
  return rows[0] || null;
}

async function seedPersona(client, { id, username, email, label, run }) {
  const conflict = await findIdentityConflict(client, id, username, email);
  if (conflict) {
    console.warn(
      `[AutoMigrate] Persona '${label}' ignorada: o username/e-mail já pertence a uma conta real (id ${conflict.id}). Nenhum dado do usuário foi alterado.`
    );
    return false;
  }
  try {
    await run();
    return true;
  } catch (err) {
    console.warn(`[AutoMigrate] Falha ao sincronizar a persona '${label}':`, err.message);
    return false;
  }
}

/**
 * Cria/sincroniza a conta administrativa oficial a partir de ADMIN_PASSWORD.
 *
 * Não existe mais senha padrão embutida: o valor que ficava aqui estava no
 * repositório público e era reescrito na conta a cada reinício, então trocá-la
 * pelo painel não adiantava — o boot seguinte a devolvia. Sem ADMIN_PASSWORD no
 * ambiente, a persona simplesmente não é criada. O acesso administrativo
 * continua disponível por ADMIN_USERNAMES (ver authService.isAllowlistedAdmin),
 * que promove uma conta real no login sem plantar senha conhecida no banco.
 *
 * A variável de ambiente é a fonte da verdade da senha: mudá-la e reiniciar é
 * como se rotaciona a credencial.
 */
async function syncAdminUser(client) {
  const adminUsername = (process.env.ADMIN_USERNAME || 'admin_livex').trim();
  const adminPassword = (process.env.ADMIN_PASSWORD || '').trim();

  if (!adminPassword) {
    console.warn(
      '[AutoMigrate] ADMIN_PASSWORD não definido: conta administrativa não sincronizada. ' +
        'Defina ADMIN_PASSWORD no ambiente, ou conceda acesso via ADMIN_USERNAMES.'
    );
    return;
  }

  const passwordHash = await bcrypt.hash(adminPassword, 10);
  const email = `${adminUsername}@livexgames.dev`;

  const query = `
    INSERT INTO users (id, name, phone, username, email, password_hash, role, lives, max_lives)
    VALUES (
      '44444444-4444-4444-4444-444444444444',
      'Administrador Oficial LiveX',
      '(11) 99999-0001',
      $1,
      $2,
      $3,
      'admin',
      999,
      999
    )
    ON CONFLICT (id) DO UPDATE SET
      username = EXCLUDED.username,
      email = EXCLUDED.email,
      password_hash = EXCLUDED.password_hash,
      role = 'admin',
      lives = 999,
      max_lives = 999;
  `;

  const adminSynced = await seedPersona(client, {
    id: '44444444-4444-4444-4444-444444444444',
    username: adminUsername,
    email,
    label: adminUsername,
    run: async () => {
      await client.query(query, [adminUsername, email, passwordHash]);
      await client.query(`
        INSERT INTO wallets (user_id, balance, currency_code)
        VALUES ('44444444-4444-4444-4444-444444444444', 99999, 'credits')
        ON CONFLICT (user_id) DO NOTHING;
      `);
    }
  });

  if (adminSynced) {
    console.log(`[AutoMigrate] Usuário administrador '${adminUsername}' sincronizado com sucesso.`);
  }
}

/**
 * Personas fixas das suítes de teste (E2E, TestSprite) e da demonstração local.
 *
 * NUNCA em produção. Todas têm senha conhecida e versionada neste repositório
 * público, e eram recriadas a cada reinício do servidor — inclusive no ar. Uma
 * delas ('testsprite_user') tinha a carteira reposta em 50.000 moedas a cada
 * boot, o que dava para resgatar brinde físico, com endereço de entrega, usando
 * uma credencial que qualquer um lê no GitHub. A guarda de ambiente que existia
 * cobria só o DELETE de reset; a criação acontecia em qualquer ambiente.
 */
async function seedDemoPersonas(client) {
  if (process.env.NODE_ENV === 'production') {
    console.log('[AutoMigrate] Produção: personas de demonstração não são criadas.');
    return;
  }

  const viewerHash = await bcrypt.hash('demo123', 10);
  const streamerHash = await bcrypt.hash('streamer123', 10);

  // Estado limpo a cada execução da suíte (a função inteira já é não-produção).
  await client.query(`
    DELETE FROM wallets WHERE user_id IN (SELECT id FROM users WHERE LOWER(username) = 'viewer_alpha');
    DELETE FROM user_inventory WHERE user_id IN (SELECT id FROM users WHERE LOWER(username) = 'viewer_alpha');
    DELETE FROM flight_runs WHERE user_id IN (SELECT id FROM users WHERE LOWER(username) = 'viewer_alpha');
    DELETE FROM reward_redemptions WHERE user_id IN (SELECT id FROM users WHERE LOWER(username) = 'viewer_alpha');
    DELETE FROM users WHERE LOWER(username) = 'viewer_alpha' OR LOWER(email) = 'viewer_alpha@example.com';
  `);

  // Reinsere a persona inicial viewer_alpha com estado limpo para a suíte de testes
  await seedPersona(client, {
    id: '11111111-1111-1111-1111-111111111111',
    username: 'viewer_alpha',
    email: 'viewer_alpha@example.com',
    label: 'viewer_alpha',
    // Uma instrução por query: o protocolo estendido do pg (o que é usado assim
    // que a query leva parâmetros) recusa várias instruções de uma vez com
    // "cannot insert multiple commands into a prepared statement". O seed de
    // viewer_alpha falhava exatamente assim — e como a persona é apagada logo
    // acima para nascer limpa, ela simplesmente deixava de existir.
    run: async () => {
      await client.query(
        `INSERT INTO users (id, name, phone, username, email, password_hash, role, lives, max_lives)
         VALUES ('11111111-1111-1111-1111-111111111111', 'Piloto Alpha Silva', '(11) 98765-4321', 'viewer_alpha', 'viewer_alpha@example.com', $1, 'viewer', 3, 3)
         ON CONFLICT (id) DO NOTHING`,
        [viewerHash]
      );
      await client.query(
        `INSERT INTO wallets (user_id, balance, currency_code)
         VALUES ('11111111-1111-1111-1111-111111111111', 1500, 'credits')
         ON CONFLICT (user_id) DO NOTHING`
      );
    }
  });

  await seedPersona(client, {
    id: '22222222-2222-2222-2222-222222222222',
    username: 'sub_beta',
    email: 'sub_beta@example.com',
    label: 'sub_beta',
    run: () =>
      client.query(
        `
    INSERT INTO users (id, name, phone, username, email, password_hash, role, lives, max_lives, twitch_id, twitch_username, is_sub_twitch)
    VALUES ('22222222-2222-2222-2222-222222222222', 'Beta Subscritor Santos', '(21) 99887-6655', 'sub_beta', 'sub_beta@example.com', $1, 'subscriber', 3, 3, 'ttv-98721', 'sub_beta_ttv', true)
    ON CONFLICT (id) DO UPDATE SET password_hash = $1, username = 'sub_beta', role = 'subscriber', is_sub_twitch = true;
  `,
        [viewerHash]
      )
  });

  await seedPersona(client, {
    id: '33333333-3333-3333-3333-333333333333',
    username: 'nightpilot',
    email: 'nightpilot@example.com',
    label: 'nightpilot',
    run: () =>
      client.query(
        `
    INSERT INTO users (id, name, phone, username, email, password_hash, role, lives, max_lives, twitch_id, twitch_username, kick_id, kick_username)
    VALUES ('33333333-3333-3333-3333-333333333333', 'Comandante NightPilot', '(31) 97766-5544', 'nightpilot', 'nightpilot@example.com', $1, 'streamer', 999, 999, 'ttv-33333', 'nightpilot', 'kick-33333', 'nightpilot_kick')
    ON CONFLICT (id) DO UPDATE SET password_hash = $1, username = 'nightpilot', role = 'streamer';
  `,
        [streamerHash]
      )
  });

  // Persona de Teste Dedicada para TestSprite (QA Agent)
  const testSpriteHash = await bcrypt.hash('TestSprite#2026!', 10);
  await seedPersona(client, {
    id: '55555555-5555-5555-5555-555555555555',
    username: 'testsprite_user',
    email: 'testsprite@livexgames.dev',
    label: 'testsprite_user',
    // Idem: uma instrução por query (ver comentário em viewer_alpha).
    run: async () => {
      await client.query(
        `INSERT INTO users (id, name, phone, username, email, password_hash, role, lives, max_lives)
         VALUES ('55555555-5555-5555-5555-555555555555', 'TestSprite QA Agent', '(11) 98888-7777', 'testsprite_user', 'testsprite@livexgames.dev', $1, 'viewer', 3, 3)
         ON CONFLICT (id) DO UPDATE SET password_hash = $1, username = 'testsprite_user', role = 'viewer'`,
        [testSpriteHash]
      );
      await client.query(
        `INSERT INTO wallets (user_id, balance, currency_code)
         VALUES ('55555555-5555-5555-5555-555555555555', 50000, 'credits')
         ON CONFLICT (user_id) DO UPDATE SET balance = 50000`
      );
      await client.query(
        `INSERT INTO streamer_wallets (user_id, streamer_id, balance, currency_code)
         VALUES ('55555555-5555-5555-5555-555555555555', '33333333-3333-3333-3333-333333333333', 50000, 'fichas_apoio')
         ON CONFLICT (user_id, streamer_id) DO UPDATE SET balance = 50000`
      );
    }
  });

  console.log('[AutoMigrate] Sincronização de personas fixas concluída.');
}

/**
 * Auto-Migrador Resiliente para PostgreSQL (Supabase, Neon, Railway, Render, Local)
 * Executa schema.sql e seed.sql automaticamente na inicialização com idempotência.
 */

// Chave do advisory lock de migração ('LXG' em hex). Evita que duas instâncias
// subindo juntas apliquem a MESMA migração simultaneamente (P1 do ESCALA.md).
const MIGRATION_LOCK_KEY = 0x4c5847;

/**
 * Tenta adquirir o lock de migração entre instâncias (não-bloqueante).
 * @param {{query: Function}} client
 * @returns {Promise<boolean>} true se esta instância pode migrar.
 */
async function adquirirLockMigracao(client) {
  const { rows } = await client.query('SELECT pg_try_advisory_lock($1) AS lock_obtido', [
    MIGRATION_LOCK_KEY
  ]);
  return rows[0]?.lock_obtido === true;
}

/** Libera o advisory lock de migração (idempotente). */
async function liberarLockMigracao(client) {
  await client.query('SELECT pg_advisory_unlock($1)', [MIGRATION_LOCK_KEY]).catch(() => {});
}

async function runAutoMigration(pool) {
  if (!pool) {
    console.warn('[AutoMigrate] Pool PostgreSQL não fornecido. Ignorando migração.');
    return { success: false, error: 'NO_POOL' };
  }

  const client = await pool.connect();
  let lockObtido = false;
  try {
    console.log(
      '[AutoMigrate] Iniciando verificação e sincronização automática do banco de dados...'
    );

    // Lock entre instâncias (P1 do ESCALA.md): se outra instância já está
    // migrando, esta ESPERA a vez dela (polling curto) em vez de pular — pular
    // deixaria um processo novo com schema/seed incompletos (no CI, os testes
    // sobem o servidor em paralelo e cada um precisa do schema completo).
    // Sempre espera até obter o lock: desistir após timeout permitia DOIS
    // processos migrando juntos, e o schema/seed/migrações em paralelo
    // travavam linhas em ordens diferentes → deadlock 40P01 observado no CI.
    // O lock é liberado no finally abaixo, então a espera é finita.
    const LOCK_POLL_MS = 250;
    let lockEsperaInicio = Date.now();
    while (!lockObtido) {
      lockObtido = await adquirirLockMigracao(client);
      if (lockObtido) break;
      if (Date.now() - lockEsperaInicio > 10_000) {
        console.warn(
          '[AutoMigrate] Advisory lock ainda ocupado (10s). Continuando a espera (a migração é idempotente e o lock é liberado no finally).'
        );
        lockEsperaInicio = Date.now();
      }
      await new Promise((r) => setTimeout(r, LOCK_POLL_MS));
    }

    // 1. Localiza os scripts SQL
    const possibleSchemaPaths = [
      path.join(__dirname, '../../../database/schema.sql'),
      path.join(__dirname, '../../database/schema.sql'),
      path.join(process.cwd(), 'database/schema.sql'),
      path.join(process.cwd(), '../database/schema.sql')
    ];

    const seedCandidates = (nome) => [
      path.join(__dirname, `../../../database/${nome}`),
      path.join(__dirname, `../../database/${nome}`),
      path.join(process.cwd(), `database/${nome}`),
      path.join(process.cwd(), `../database/${nome}`)
    ];

    const possibleSeedPaths = seedCandidates('seed.sql');

    const schemaPath = possibleSchemaPaths.find((p) => fs.existsSync(p));
    const seedPath = possibleSeedPaths.find((p) => fs.existsSync(p));

    if (!schemaPath) {
      console.warn('[AutoMigrate] Arquivo schema.sql não localizado nos caminhos padrão.');
      return { success: false, error: 'SCHEMA_NOT_FOUND' };
    }

    const schemaSql = fs.readFileSync(schemaPath, 'utf-8');
    await client.query(schemaSql);
    console.log('[AutoMigrate] Estrutura de tabelas e índices sincronizada (schema.sql).');

    // seed.sql traz só o catálogo da loja, que é conteúdo real do produto e vale
    // em qualquer ambiente. As contas de demonstração vivem em seed.demo.sql e
    // são aplicadas apenas fora de produção (ver seedDemoPersonas).
    if (process.env.NODE_ENV !== 'production') {
      const demoPath = seedCandidates('seed.demo.sql').find((p) => fs.existsSync(p));
      if (demoPath) {
        try {
          await client.query(fs.readFileSync(demoPath, 'utf-8'));
          console.log('[AutoMigrate] Seed de demonstração aplicado (ambiente não-produção).');
        } catch (demoError) {
          console.warn('[AutoMigrate] Aviso ao aplicar seed.demo.sql:', demoError.message);
        }
      }
    }

    if (seedPath) {
      const seedSql = fs.readFileSync(seedPath, 'utf-8');
      try {
        await client.query(seedSql);
        console.log('[AutoMigrate] Catálogo da loja sincronizado (seed.sql).');
      } catch (seedError) {
        if (process.env.NODE_ENV === 'production') throw seedError;
        // Os INSERTs do seed usam ON CONFLICT (id) e podem colidir com contas
        // reais que ocupem o mesmo username/e-mail. Isso não pode impedir o
        // servidor de subir: o schema já está aplicado e as personas são
        // resincronizadas logo abaixo, uma a uma, de forma tolerante.
        console.warn('[AutoMigrate] Aviso ao aplicar seed.sql:', seedError.message);
      }
    }

    // 2. Executa migrações pendentes da pasta database/migrations
    const possibleMigrationsDirs = [
      path.join(__dirname, '../../../database/migrations'),
      path.join(__dirname, '../../database/migrations'),
      path.join(process.cwd(), 'database/migrations'),
      path.join(process.cwd(), '../database/migrations')
    ];
    const migrationsDir = possibleMigrationsDirs.find((d) => fs.existsSync(d));
    if (migrationsDir) {
      // Registro do que já rodou. Sem ele, os arquivos eram reexecutados
      // inteiros a cada inicialização e toda falha virava "pode já ter sido
      // aplicada" — uma migração quebrada ficava indistinguível de uma migração
      // repetida, e as que fazem UPDATE de preço (002, 008) desfaziam ajustes
      // manuais de catálogo a cada restart.
      await client.query(`
        CREATE TABLE IF NOT EXISTS schema_migrations (
          filename TEXT PRIMARY KEY,
          applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
      `);

      const { rows: aplicadas } = await client.query('SELECT filename FROM schema_migrations');
      const jaAplicadas = new Set(aplicadas.map((r) => r.filename));

      const migrationFiles = fs
        .readdirSync(migrationsDir)
        .filter((f) => f.endsWith('.sql'))
        .sort();
      const isSupabaseDatabase =
        /supabase/i.test(process.env.DATABASE_URL || '') || Boolean(process.env.SUPABASE_URL);
      let migrationFailed = null;

      for (const file of migrationFiles) {
        if (jaAplicadas.has(file)) continue;

        // Estas migrações usam o schema auth e as roles anon/authenticated do
        // Supabase. Um PostgreSQL comum (como o serviço do CI) não possui esses
        // objetos; tentar executá-las aborta a automigração antes do seed das
        // personas e deixa o ambiente de teste sem o streamer NightPilot.
        if (
          !isSupabaseDatabase &&
          (file === '001_enable_rls_security.sql' ||
            file === '007_fix_supabase_security_linter.sql')
        ) {
          console.log(`[AutoMigrate] Migração ${file} ignorada: banco não é Supabase.`);
          continue;
        }

        const filePath = path.join(migrationsDir, file);
        const migrationSql = fs.readFileSync(filePath, 'utf-8');
        try {
          await client.query(migrationSql);
          await client.query(
            'INSERT INTO schema_migrations (filename) VALUES ($1) ON CONFLICT DO NOTHING',
            [file]
          );
          console.log(`[AutoMigrate] Migração executada: ${file}`);
        } catch (migError) {
          // ROLLBACK antes de seguir. Sem isto, UMA migração que falha derruba
          // todas as outras e ainda o sync de contas: 001 e 007 abrem BEGIN;
          // próprio, então quando uma delas falha no meio a conexão fica em
          // transação abortada e o PostgreSQL recusa todo comando seguinte com
          // 25P02 ("current transaction is aborted"). Como o mesmo client é
          // reutilizado pelo arranque inteiro, o efeito era: falhou a 001,
          // nada mais rodou. O log antigo dizia "pode já ter sido aplicada" em
          // cada uma delas, o que fazia a cascata parecer normal.
          //
          // Se não houver transação aberta, o ROLLBACK é um aviso inofensivo.
          try {
            await client.query('ROLLBACK');
          } catch (rollbackErr) {
            console.warn(`[AutoMigrate] ROLLBACK após ${file} falhou:`, rollbackErr.message);
          }

          // Um banco que já existia antes desta tabela tem as migrações antigas
          // aplicadas sem registro algum. Marcar como aplicada aqui assumiria
          // que o erro é só reaplicação — e é exatamente essa suposição que
          // escondia migração quebrada. O erro fica visível e a migração é
          // tentada de novo no próximo boot, até alguém resolver.
          const dica = /schema "auth" does not exist/.test(migError.message)
            ? ' (esta migração é específica do Supabase: usa auth.uid(); em PostgreSQL comum ela não se aplica)'
            : '';
          console.error(`[AutoMigrate] FALHA na migração ${file}:`, migError.message + dica);
          migrationFailed = new Error(`Migração ${file} falhou: ${migError.message}`);
        }
      }
      if (migrationFailed) throw migrationFailed;
    }

    // Sincroniza o usuário administrador oficial com a senha segura
    try {
      await syncAdminUser(client);
      await seedDemoPersonas(client);
    } catch (adminError) {
      if (process.env.NODE_ENV === 'production') throw adminError;
      console.warn('[AutoMigrate] Aviso ao sincronizar personas:', adminError.message);
    }

    console.log('[AutoMigrate] Banco de dados pronto para produção.');
    return { success: true };
  } catch (error) {
    console.error('[AutoMigrate] Erro durante a automigração do PostgreSQL:', error.message);
    return { success: false, error: error.message };
  } finally {
    if (lockObtido) await liberarLockMigracao(client);
    client.release();
  }
}

module.exports = { runAutoMigration, seedPersona, seedDemoPersonas };
