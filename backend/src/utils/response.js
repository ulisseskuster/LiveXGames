// @ts-check

function ok(res, data, message = 'Operação realizada com sucesso') {
  return res.status(200).json({
    success: true,
    message,
    data
  });
}

function created(res, data, message = 'Recurso criado com sucesso') {
  return res.status(201).json({
    success: true,
    message,
    data
  });
}

function fail(res, status = 500, message = 'Erro interno do servidor', error = null) {
  // Detalhes internos de erro (mensagens de exceção, possivelmente contendo dados
  // de banco/stack) só são expostos fora de produção, para evitar vazamento de
  // informação sensível de implementação a um cliente não confiável.
  const exposeDetail = process.env.NODE_ENV !== 'production';
  return res.status(status).json({
    success: false,
    message,
    error: exposeDetail ? error || undefined : undefined
  });
}

module.exports = {
  ok,
  created,
  fail
};
