const { randomUUID } = require('crypto');
const db = require('../config/database');
const InMemoryStore = require('../data/store');

class StreamerApplicationModel {
  static async create({ applicantId, channelPlatform, channelUrl, pitch }) {
    if (db.isAvailable()) {
      try {
        const { rows } = await db.query(
          `INSERT INTO streamer_applications (applicant_id, channel_platform, channel_url, pitch, status)
           VALUES ($1, $2, $3, $4, 'pending')
           RETURNING *`,
          [applicantId, channelPlatform, channelUrl, pitch]
        );
        if (rows[0]) return rows[0];
      } catch (err) {
        db.fallbackOrThrow(err, 'StreamerApplicationModel.create');
      }
    }

    const application = {
      id: randomUUID(),
      applicant_id: applicantId,
      channel_platform: channelPlatform,
      channel_url: channelUrl,
      pitch,
      status: 'pending',
      review_notes: null,
      reviewed_by: null,
      reviewed_at: null,
      created_at: new Date().toISOString()
    };
    InMemoryStore.streamerApplications.unshift(application);
    return application;
  }

  static async findPendingByApplicant(applicantId) {
    if (db.isAvailable()) {
      try {
        const { rows } = await db.query(
          `SELECT * FROM streamer_applications WHERE applicant_id = $1 AND status = 'pending'`,
          [applicantId]
        );
        if (rows) return rows[0] || null;
      } catch (err) {
        db.fallbackOrThrow(err, 'StreamerApplicationModel.findPendingByApplicant');
      }
    }

    return (
      InMemoryStore.streamerApplications.find(
        (a) => a.applicant_id === applicantId && a.status === 'pending'
      ) || null
    );
  }

  static async findLatestByApplicant(applicantId) {
    if (db.isAvailable()) {
      try {
        const { rows } = await db.query(
          `SELECT * FROM streamer_applications WHERE applicant_id = $1 ORDER BY created_at DESC LIMIT 1`,
          [applicantId]
        );
        if (rows) return rows[0] || null;
      } catch (err) {
        db.fallbackOrThrow(err, 'StreamerApplicationModel.findLatestByApplicant');
      }
    }

    return (
      InMemoryStore.streamerApplications
        .filter((a) => a.applicant_id === applicantId)
        .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))[0] || null
    );
  }

  static async findById(id) {
    if (db.isAvailable()) {
      try {
        const { rows } = await db.query(`SELECT * FROM streamer_applications WHERE id = $1`, [id]);
        if (rows[0]) return rows[0];
      } catch (err) {
        db.fallbackOrThrow(err, 'StreamerApplicationModel.findById');
      }
    }

    return InMemoryStore.streamerApplications.find((a) => a.id === id) || null;
  }

  static async findForModeration(statusFilter = null) {
    if (db.isAvailable()) {
      try {
        let query = `
          SELECT a.*, u.username AS applicant_username, rev.username AS reviewer_username
          FROM streamer_applications a
          LEFT JOIN users u ON a.applicant_id = u.id
          LEFT JOIN users rev ON a.reviewed_by = rev.id
        `;
        const params = [];
        if (statusFilter && statusFilter !== 'all') {
          params.push(statusFilter);
          query += ` WHERE a.status = $1`;
        }
        query += ` ORDER BY a.created_at DESC`;

        const { rows } = await db.query(query, params);
        if (rows) return rows;
      } catch (err) {
        db.fallbackOrThrow(err, 'StreamerApplicationModel.findForModeration');
      }
    }

    return InMemoryStore.streamerApplications
      .filter((a) => !statusFilter || statusFilter === 'all' || a.status === statusFilter)
      .map((a) => {
        const applicant = InMemoryStore.users.find((u) => u.id === a.applicant_id);
        const reviewer = InMemoryStore.users.find((u) => u.id === a.reviewed_by);
        return {
          ...a,
          applicant_username: applicant ? applicant.username : null,
          reviewer_username: reviewer ? reviewer.username : null
        };
      })
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  }

  static async updateStatus(id, { status, review_notes, reviewed_by }) {
    if (db.isAvailable()) {
      try {
        const { rows } = await db.query(
          `UPDATE streamer_applications
           SET status = $1, review_notes = $2, reviewed_by = $3, reviewed_at = NOW()
           WHERE id = $4
           RETURNING *`,
          [status, review_notes, reviewed_by, id]
        );
        if (rows[0]) return rows[0];
      } catch (err) {
        db.fallbackOrThrow(err, 'StreamerApplicationModel.updateStatus');
      }
    }

    const application = InMemoryStore.streamerApplications.find((a) => a.id === id);
    if (!application) return null;

    application.status = status;
    application.review_notes = review_notes;
    application.reviewed_by = reviewed_by;
    application.reviewed_at = new Date().toISOString();
    return application;
  }
}

module.exports = StreamerApplicationModel;
