// Middleware centralizado de tratamento de erros.
// Captura erros lançados ou passados por next(err) em qualquer rota.
// Gera request-id para rastreio e loga em formato estruturado.
// Substitui os console.* espalhados por uma saída consistente.

const crypto = require('crypto');

/**
 * Gera um request-id curto para correlação de logs.
 * Se o cliente já enviou um X-Request-Id, mantém; senão, cria um novo.
 */
function ensureRequestId(req, _res, next) {
  if (!req.requestId) {
    req.requestId = req.headers['x-request-id'] || crypto.randomUUID().slice(0, 8);
  }
  next();
}

/**
 * Middleware 404 — deve ser registrado DEPOIS de todas as rotas.
 */
function notFoundHandler(req, res, _next) {
  res.status(404).json({
    success: false,
    error: 'not_found',
    message: `Rota não encontrada: ${req.method} ${req.originalUrl}`,
    requestId: req.requestId
  });
}

/**
 * Tratador global de erros.
 * Express reconhece middleware de 4 parâmetros como error handler.
 */
function errorHandler(err, req, res, _next) {
  const status = err.status || err.statusCode || 500;
  const isServerError = status >= 500;

  // Log estruturado — em produção, integrar com pino/winston.
  // Mantém console.* por enquanto, mas em formato JSON uniforme.
  const logEntry = {
    level: isServerError ? 'error' : 'warn',
    requestId: req.requestId,
    method: req.method,
    path: req.originalUrl,
    status,
    message: err.message,
    ...(isServerError && err.stack ? { stack: err.stack } : {})
  };

  if (isServerError) {
    console.error(JSON.stringify(logEntry));
  } else {
    console.warn(JSON.stringify(logEntry));
  }

  // Nunca expor stack trace em produção
  const response = {
    success: false,
    error: err.code || (isServerError ? 'internal_error' : 'client_error'),
    message: isServerError ? 'Erro interno do servidor' : err.message,
    requestId: req.requestId
  };

  // Em desenvolvimento, inclui o stack para facilitar debug
  if (process.env.NODE_ENV !== 'production' && err.stack) {
    response.stack = err.stack;
  }

  res.status(status).json(response);
}

module.exports = {
  ensureRequestId,
  notFoundHandler,
  errorHandler
};
