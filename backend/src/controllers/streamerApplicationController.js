const StreamerApplicationService = require('../services/streamerApplicationService');
const { ok, fail } = require('../utils/response');

function mapError(res, error) {
  const code = error.message.split(':')[0];
  const map = {
    ALREADY_STREAMER: 400,
    PENDING_APPLICATION_EXISTS: 409,
    INVALID_CHANNEL_PLATFORM: 400,
    INVALID_CHANNEL_URL: 400,
    INVALID_PITCH: 400,
    USER_NOT_FOUND: 404
  };
  if (map[code]) {
    return fail(
      res,
      map[code],
      error.message.split(':').slice(1).join(':').trim() || error.message,
      code
    );
  }
  return fail(res, 500, 'Erro ao processar candidatura de streamer', error.message);
}

class StreamerApplicationController {
  static async submit(req, res) {
    try {
      const { channelPlatform, channelUrl, pitch } = req.body;
      const result = await StreamerApplicationService.submitApplication({
        applicantId: req.user.id,
        channelPlatform,
        channelUrl,
        pitch
      });
      return ok(res, result, result.message);
    } catch (error) {
      return mapError(res, error);
    }
  }

  static async getMine(req, res) {
    try {
      const applications = await StreamerApplicationService.getMyApplications(req.user.id);
      return ok(res, applications, 'Candidaturas carregadas com sucesso');
    } catch (error) {
      return fail(res, 500, 'Erro ao carregar candidaturas', error.message);
    }
  }
}

module.exports = StreamerApplicationController;
