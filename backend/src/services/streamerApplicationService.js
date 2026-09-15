const StreamerApplicationModel = require('../models/streamerApplicationModel');
const StreamerPaymentConfigModel = require('../models/streamerPaymentConfigModel');
const UserModel = require('../models/userModel');

const VALID_PLATFORMS = ['twitch', 'kick', 'youtube', 'other'];

class StreamerApplicationService {
  static async submitApplication({ applicantId, channelPlatform, channelUrl, pitch }) {
    const applicant = await UserModel.findById(applicantId);
    if (!applicant) {
      throw new Error('USER_NOT_FOUND');
    }

    if (applicant.role === 'streamer' || applicant.role === 'admin') {
      throw new Error('ALREADY_STREAMER: Este usuário já possui perfil de streamer');
    }

    const existingPending = await StreamerApplicationModel.findPendingByApplicant(applicantId);
    if (existingPending) {
      throw new Error(
        'PENDING_APPLICATION_EXISTS: Já existe uma candidatura em análise para este usuário'
      );
    }

    if (!VALID_PLATFORMS.includes(channelPlatform)) {
      throw new Error('INVALID_CHANNEL_PLATFORM: Plataforma informada é inválida');
    }

    if (
      !channelUrl ||
      typeof channelUrl !== 'string' ||
      !/^https?:\/\/.+/i.test(channelUrl.trim())
    ) {
      throw new Error(
        'INVALID_CHANNEL_URL: Informe uma URL válida (começando com http:// ou https://) do seu canal'
      );
    }

    if (!pitch || typeof pitch !== 'string' || pitch.trim().length < 20) {
      throw new Error('INVALID_PITCH: Conte um pouco mais sobre sua live (mínimo 20 caracteres)');
    }

    const application = await StreamerApplicationModel.create({
      applicantId,
      channelPlatform,
      channelUrl: channelUrl.trim(),
      pitch: pitch.trim()
    });

    return {
      success: true,
      message: 'Candidatura enviada para análise da equipe LiveX Games!',
      application
    };
  }

  static async getMyApplications(applicantId) {
    const latest = await StreamerApplicationModel.findLatestByApplicant(applicantId);
    return latest ? [latest] : [];
  }

  static async getModerationQueue(statusFilter = null) {
    return StreamerApplicationModel.findForModeration(statusFilter);
  }

  static async reviewApplication(
    applicationId,
    { action, notes, adminId, adminUsername, io = null }
  ) {
    if (!['approve', 'reject'].includes(action)) {
      throw new Error('INVALID_ACTION: Ação de moderação deve ser "approve" ou "reject"');
    }

    const application = await StreamerApplicationModel.findById(applicationId);
    if (!application) {
      throw new Error('APPLICATION_NOT_FOUND: Candidatura não encontrada');
    }

    if (application.status !== 'pending') {
      throw new Error('APPLICATION_ALREADY_REVIEWED: Esta candidatura já foi analisada');
    }

    if (action === 'reject' && (!notes || typeof notes !== 'string' || notes.trim().length < 5)) {
      throw new Error(
        'REJECTION_NOTES_REQUIRED: Motivo da rejeição é obrigatório (mínimo 5 caracteres)'
      );
    }

    const newStatus = action === 'approve' ? 'approved' : 'rejected';
    const reviewNotes = notes ? notes.trim() : 'Aprovado pelo time de desenvolvimento LiveX Games';

    const updatedApplication = await StreamerApplicationModel.updateStatus(applicationId, {
      status: newStatus,
      review_notes: reviewNotes,
      reviewed_by: adminId
    });

    let promotedUser = null;
    if (newStatus === 'approved') {
      promotedUser = await UserModel.promoteToStreamer(application.applicant_id);
      await StreamerPaymentConfigModel.ensureSecrets(application.applicant_id);
    }

    if (io) {
      io.emit('streamer-application:reviewed', {
        applicationId,
        applicantId: application.applicant_id,
        status: newStatus,
        notes: reviewNotes,
        reviewedBy: adminUsername || 'Moderador Dev'
      });

      if (newStatus === 'approved' && promotedUser) {
        io.emit('chat:new-message', {
          author: 'Sistema LiveX',
          role: 'admin',
          message: `🎬 ${promotedUser.username} agora é um Streamer LiveX verificado! Confira a página do canal.`,
          timestamp: new Date().toISOString()
        });
      }
    }

    return {
      success: true,
      message: `Candidatura ${newStatus === 'approved' ? 'aprovada' : 'rejeitada'} com sucesso!`,
      application: updatedApplication
    };
  }
}

module.exports = StreamerApplicationService;
