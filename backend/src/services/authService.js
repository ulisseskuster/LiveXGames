const jwt = require('jsonwebtoken');
const UserModel = require('../models/userModel');
const WalletModel = require('../models/walletModel');
const AuthTokenModel = require('../models/authTokenModel');
const EmailService = require('./emailService');
const { JWT_SECRET } = require('../config/secrets');

const bcrypt = require('bcryptjs');

// Hash de valor irrelevante, gerado uma vez no arranque com o mesmo custo dos
// hashes reais. Serve só para dar trabalho ao login de um usuário inexistente.
const DUMMY_PASSWORD_HASH = bcrypt.hashSync('conta-inexistente', 10);

const USERNAME_PATTERN = /^[a-zA-Z0-9_]{3,32}$/;
// Formato mínimo de e-mail + limites que espelham o schema (email VARCHAR(160),
// name VARCHAR(120), phone VARCHAR(30)). Sem isso, "isso nao e email" era aceito
// e valores acima do tamanho da coluna só estouravam no PostgreSQL, virando 500.
const EMAIL_PATTERN = /^[^\s@]+@[^\s@.]+\.[^\s@]{2,}$/;
const MAX_EMAIL_LENGTH = 160;
const MAX_NAME_LENGTH = 120;
const MAX_PHONE_LENGTH = 30;
const MAX_PASSWORD_LENGTH = 200;

// Versão dos Termos aceita no cadastro. Ao publicar termos novos, mude aqui: o
// valor fica gravado junto do aceite, e é o que permite responder "qual texto
// esta pessoa aceitou" meses depois. Mudar sem versionar apaga essa resposta.
const TERMS_VERSION = '2026-09';

// Idade mínima. A plataforma converte doação em moeda e entrega brinde físico,
// e tem sorteio diário com prêmio — é o tipo de mecânica que exige porta de
// idade no Brasil.
const IDADE_MINIMA = 18;

const VALIDADE_RESET_MS = 60 * 60 * 1000; // 1 hora
const VALIDADE_VERIFICACAO_MS = 48 * 60 * 60 * 1000; // 48 horas

/**
 * Idade completa em anos na data de hoje.
 * @param {string} isoDate 'AAAA-MM-DD'
 */
function idadeEmAnos(isoDate) {
  const nascimento = new Date(`${isoDate}T00:00:00Z`);
  const hoje = new Date();
  let anos = hoje.getUTCFullYear() - nascimento.getUTCFullYear();
  const mes = hoje.getUTCMonth() - nascimento.getUTCMonth();
  if (mes < 0 || (mes === 0 && hoje.getUTCDate() < nascimento.getUTCDate())) anos -= 1;
  return anos;
}

// Usernames em ADMIN_USERNAMES (separados por vírgula) são promovidos a admin
// automaticamente no próximo login/cadastro — forma segura de conceder acesso
// administrativo (ex.: ao painel de testes E2E) sem editar o banco manualmente.
function isAllowlistedAdmin(username) {
  const allowlist = (process.env.ADMIN_USERNAMES || '')
    .split(',')
    .map((u) => u.trim().toLowerCase())
    .filter(Boolean);
  return allowlist.includes(String(username).trim().toLowerCase());
}

class AuthService {
  static generateToken(user) {
    return jwt.sign(
      {
        sub: user.id,
        username: user.username,
        role: user.role,
        // Versão da sessão: incrementada no logout/troca de senha para revogar
        // tokens antigos imediatamente (P1 do ESCALA.md — requireAuth confere).
        tv: Number(user.tokenVersion || 0)
      },
      JWT_SECRET,
      { expiresIn: '24h' }
    );
  }

  static formatUser(user) {
    return {
      id: user.id,
      name: user.name || null,
      phone: user.phone || null,
      username: user.username,
      email: user.email,
      role: user.role,
      lives: user.lives,
      max_lives: user.max_lives,
      twitch_id: user.twitch_id || null,
      twitch_username: user.twitch_username || null,
      kick_id: user.kick_id || null,
      kick_username: user.kick_username || null,
      is_sub_twitch: Boolean(user.is_sub_twitch),
      is_sub_kick: Boolean(user.is_sub_kick),
      // Douradas vêm separadas das normais: a interface as desenha à parte e o
      // débito gasta primeiro elas (ver UserModel.consumeLife).
      sub_lives: UserModel.getSubLives(user),
      max_sub_lives: UserModel.isSubscriber(user) ? UserModel.VIDAS_DOURADAS_POR_DIA : 0,
      email_verified: Boolean(user.email_verified_at),
      // A interface usa isto para pedir o aceite a quem criou conta antes de
      // ele passar a ser obrigatório. Nunca envia a data de nascimento de volta.
      terms_accepted: Boolean(user.terms_accepted_at)
    };
  }

  static async login(username, password) {
    if (!username || !password) {
      throw new Error('INVALID_CREDENTIALS');
    }

    let user = await UserModel.findByUsername(username);
    if (!user) {
      // A mensagem devolvida ao cliente já é a mesma nos dois casos, mas o tempo
      // não era: sem usuário, a resposta saía sem passar por bcrypt e voltava na
      // ordem de milissegundos, contra dezenas quando o hash era comparado. Essa
      // diferença basta para enumerar contas. O compare contra um hash descartado
      // custa o mesmo que o do caminho real.
      await UserModel.comparePassword(String(password), DUMMY_PASSWORD_HASH);
      throw new Error('USER_NOT_FOUND');
    }

    const passwordMatches = await UserModel.comparePassword(password, user.passwordHash);
    if (!passwordMatches) {
      throw new Error('INVALID_PASSWORD');
    }

    if (user.role !== 'admin' && isAllowlistedAdmin(user.username)) {
      user = await UserModel.promoteToAdmin(user.id);
    }

    const wallet = await WalletModel.findByUserId(user.id);
    const token = this.generateToken(user);

    return {
      token,
      user: this.formatUser(user),
      wallet: {
        balance: Number(wallet.balance),
        currency_code: wallet.currency_code
      }
    };
  }

  static async register({
    name = null,
    phone = null,
    username,
    email,
    password,
    birthDate = null,
    acceptedTerms = false
  }) {
    if (!username || !email || !password) {
      throw new Error('INVALID_INPUT');
    }

    if (typeof password !== 'string' || password.length < 6) {
      throw new Error('WEAK_PASSWORD');
    }
    // bcrypt só considera os primeiros 72 bytes; o limite evita gastar CPU
    // aplicando hash em entradas arbitrariamente grandes.
    if (password.length > MAX_PASSWORD_LENGTH) {
      throw new Error('INVALID_PASSWORD_LENGTH');
    }

    const cleanUsername = String(username).trim().toLowerCase();
    const cleanEmail = String(email).trim().toLowerCase();
    const cleanName = name ? String(name).trim() : null;
    const cleanPhone = phone ? String(phone).trim() : null;

    if (!USERNAME_PATTERN.test(cleanUsername)) {
      throw new Error('INVALID_USERNAME');
    }

    if (cleanEmail.length > MAX_EMAIL_LENGTH || !EMAIL_PATTERN.test(cleanEmail)) {
      throw new Error('INVALID_EMAIL');
    }

    if (cleanName && cleanName.length > MAX_NAME_LENGTH) {
      throw new Error('INVALID_NAME_LENGTH');
    }

    if (cleanPhone && cleanPhone.length > MAX_PHONE_LENGTH) {
      throw new Error('INVALID_PHONE_LENGTH');
    }

    // Aceite dos Termos. O checkbox no formulário é conveniência de interface;
    // a exigência tem de estar aqui, senão uma chamada direta à API cria conta
    // sem aceite nenhum e o registro de consentimento fica furado.
    if (acceptedTerms !== true) {
      throw new Error('TERMS_NOT_ACCEPTED');
    }

    // Data de nascimento em vez de um "declaro ter 18 anos": um checkbox não
    // deixa rastro auditável nem permite recalcular a idade depois.
    if (!birthDate || !/^\d{4}-\d{2}-\d{2}$/.test(String(birthDate))) {
      throw new Error('INVALID_BIRTH_DATE');
    }
    const nascimento = new Date(`${birthDate}T00:00:00Z`);
    if (Number.isNaN(nascimento.getTime()) || nascimento > new Date()) {
      throw new Error('INVALID_BIRTH_DATE');
    }
    if (idadeEmAnos(String(birthDate)) < IDADE_MINIMA) {
      throw new Error('UNDERAGE');
    }

    // Segurança: Todo cadastro público é estritamente 'viewer'.
    // Permissões elevadas (admin/streamer) só podem ser concedidas pelo painel ou configuração de servidor.
    const chosenRole = 'viewer';

    let created = await UserModel.create({
      name: cleanName,
      phone: cleanPhone,
      username: cleanUsername,
      email: cleanEmail,
      password,
      role: chosenRole,
      birthDate: String(birthDate),
      termsVersion: TERMS_VERSION
    });

    // Promoção via configuração de servidor (ADMIN_USERNAMES) — não é o cliente escolhendo o próprio papel.
    if (isAllowlistedAdmin(created.username)) {
      created = await UserModel.promoteToAdmin(created.id);
    }

    const wallet = await WalletModel.findByUserId(created.id);
    const token = this.generateToken(created);

    // A verificação é disparada mas não bloqueia: a conta já está utilizável.
    // Exigir confirmação para entrar quebraria todas as contas anteriores e
    // travaria quem se cadastra enquanto o provedor de e-mail está fora do ar.
    // O valor dela é permitir recuperar a conta depois — e isso o usuário
    // colhe quando confirmar.
    await this.enviarVerificacaoDeEmail(created).catch((err) =>
      console.warn('[AuthService] Verificação de e-mail não enviada:', err.message)
    );

    return {
      token,
      user: this.formatUser(created),
      wallet: {
        balance: Number(wallet.balance),
        currency_code: wallet.currency_code
      }
    };
  }

  /**
   * Base pública usada nos links enviados por e-mail.
   *
   * Sai de PUBLIC_BASE_URL, nunca de um cabeçalho da requisição: um Host
   * forjado viraria um link de redefinição apontando para o servidor de outra
   * pessoa, e o usuário entregaria o token ao clicar.
   */
  static baseUrlPublica() {
    const configurada = (process.env.PUBLIC_BASE_URL || '').trim().replace(/\/+$/, '');
    if (configurada) return configurada;
    return process.env.NODE_ENV === 'production'
      ? 'https://livexgames.onrender.com'
      : `http://localhost:${process.env.PORT || 3000}`;
  }

  /**
   * Inicia a redefinição de senha.
   *
   * Responde sempre da mesma forma, exista a conta ou não. Dizer "e-mail não
   * encontrado" transformaria esta rota num verificador de cadastro: qualquer
   * um descobriria quais endereços têm conta na plataforma.
   *
   * @param {string} identificador username ou e-mail
   */
  static async requestPasswordReset(identificador) {
    const limpo = String(identificador || '').trim();
    if (!limpo) return { enviado: true };

    const user = limpo.includes('@')
      ? await UserModel.findByEmail(limpo)
      : await UserModel.findByUsername(limpo);

    if (!user || !user.email) return { enviado: true };

    const token = await AuthTokenModel.criar('password_reset', {
      userId: user.id,
      ttlMs: VALIDADE_RESET_MS
    });

    const url = `${this.baseUrlPublica()}/redefinir-senha?token=${encodeURIComponent(token)}`;
    await EmailService.enviarRedefinicaoDeSenha(
      user.email,
      user.username,
      url,
      Math.round(VALIDADE_RESET_MS / 60000)
    );

    return { enviado: true };
  }

  /**
   * Conclui a redefinição. O token é de uso único e o consumo é atômico (ver
   * AuthTokenModel.consumir), então o mesmo link não redefine duas vezes.
   */
  static async resetPassword(token, novaSenha) {
    if (typeof novaSenha !== 'string' || novaSenha.length < 6) {
      throw new Error('WEAK_PASSWORD');
    }
    if (novaSenha.length > MAX_PASSWORD_LENGTH) {
      throw new Error('INVALID_PASSWORD_LENGTH');
    }

    const consumido = await AuthTokenModel.consumir('password_reset', token);
    if (!consumido) {
      // Inexistente, já usado e expirado devolvem o mesmo erro de propósito:
      // distinguir os casos diria a um atacante que o token existiu.
      throw new Error('INVALID_OR_EXPIRED_TOKEN');
    }

    const trocada = await UserModel.updatePassword(consumido.userId, novaSenha);
    if (!trocada) throw new Error('USER_NOT_FOUND');

    // Troca de senha revoga todas as sessões anteriores: quem estava logado com
    // um token emitido antes da troca perde o acesso (P1 do ESCALA.md).
    await UserModel.incrementarTokenVersion(consumido.userId).catch(() => {});

    return { success: true };
  }

  /** Gera e envia o link de confirmação do endereço de e-mail. */
  static async enviarVerificacaoDeEmail(user) {
    if (!user || !user.email) return { enviado: false };

    const token = await AuthTokenModel.criar('email_verification', {
      userId: user.id,
      ttlMs: VALIDADE_VERIFICACAO_MS,
      email: user.email
    });

    const url = `${this.baseUrlPublica()}/confirmar-email?token=${encodeURIComponent(token)}`;
    return EmailService.enviarVerificacaoDeEmail(
      user.email,
      user.username,
      url,
      Math.round(VALIDADE_VERIFICACAO_MS / 3600000)
    );
  }

  /**
   * Confirma o endereço. Compara com o e-mail gravado no token, não com o atual
   * da conta: se a pessoa trocou de e-mail depois de pedir a confirmação, o
   * link antigo não deve validar o endereço novo.
   */
  static async verifyEmail(token) {
    const consumido = await AuthTokenModel.consumir('email_verification', token);
    if (!consumido) throw new Error('INVALID_OR_EXPIRED_TOKEN');

    const confirmado = await UserModel.markEmailVerified(consumido.userId, consumido.email);
    if (!confirmado) throw new Error('EMAIL_CHANGED');

    return { success: true };
  }

  /** Reenvia a confirmação para o usuário autenticado. */
  static async reenviarVerificacao(userId) {
    const user = await UserModel.findById(userId);
    if (!user) throw new Error('USER_NOT_FOUND');
    if (user.email_verified_at) return { jaVerificado: true };
    await this.enviarVerificacaoDeEmail(user);
    return { jaVerificado: false };
  }

  /**
   * Aceite dos termos por quem criou conta antes de ele ser obrigatório.
   * Exige a data de nascimento pelo mesmo motivo do cadastro.
   */
  static async aceitarTermos(userId, birthDate) {
    if (!birthDate || !/^\d{4}-\d{2}-\d{2}$/.test(String(birthDate))) {
      throw new Error('INVALID_BIRTH_DATE');
    }
    if (idadeEmAnos(String(birthDate)) < IDADE_MINIMA) {
      throw new Error('UNDERAGE');
    }

    const ok = await UserModel.registrarAceiteDeTermos(userId, {
      versao: TERMS_VERSION,
      birthDate: String(birthDate)
    });
    if (!ok) throw new Error('USER_NOT_FOUND');

    return this.getProfile(userId);
  }

  static async updateProfile(userId, { name, phone }) {
    if (name !== undefined && String(name).trim().length > 0 && String(name).trim().length < 3) {
      throw new Error('INVALID_NAME');
    }

    const updated = await UserModel.updateProfile(userId, { name, phone });
    const wallet = await WalletModel.findByUserId(userId);

    return {
      user: this.formatUser(updated),
      wallet: {
        balance: Number(wallet.balance),
        currency_code: wallet.currency_code
      }
    };
  }

  static async getProfile(userId) {
    const user = await UserModel.findById(userId);
    if (!user) {
      throw new Error('USER_NOT_FOUND');
    }

    const wallet = await WalletModel.findByUserId(userId);

    let streak = null;
    try {
      const StreakModel = require('../models/streakModel');
      streak = await StreakModel.getStreak(userId);
    } catch (e) {
      // Streak é informação derivada; a falha dele não pode derrubar o perfil.
      console.warn(`[Streak] Falha ao carregar streak de ${userId}:`, e.message);
    }

    return {
      user: this.formatUser(user),
      wallet: {
        balance: Number(wallet.balance),
        currency_code: wallet.currency_code
      },
      streak
    };
  }

  static async linkStreamAccount(
    userId,
    { provider, accountId = null, accountUsername, isSubscriber = false }
  ) {
    const updated = await UserModel.linkStreamAccount(userId, {
      provider,
      accountId,
      accountUsername,
      isSubscriber
    });

    const wallet = await WalletModel.findByUserId(userId);
    const token = this.generateToken(updated);

    return {
      token,
      user: this.formatUser(updated),
      wallet: {
        balance: Number(wallet.balance),
        currency_code: wallet.currency_code
      }
    };
  }

  static async unlinkStreamAccount(userId, provider) {
    const updated = await UserModel.unlinkStreamAccount(userId, provider);
    const wallet = await WalletModel.findByUserId(userId);
    const token = this.generateToken(updated);

    return {
      token,
      user: this.formatUser(updated),
      wallet: {
        balance: Number(wallet.balance),
        currency_code: wallet.currency_code
      }
    };
  }
}

module.exports = AuthService;
