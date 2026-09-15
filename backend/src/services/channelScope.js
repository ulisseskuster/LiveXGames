const UserModel = require('../models/userModel');

async function requireChannel(streamerId) {
  if (typeof streamerId !== 'string' || !/^[0-9a-f-]{36}$/i.test(streamerId)) {
    throw new Error('INVALID_STREAMER');
  }
  const streamer = await UserModel.findById(streamerId);
  if (!streamer || !['streamer', 'admin'].includes(streamer.role)) {
    throw new Error('INVALID_STREAMER');
  }
  return streamerId;
}

module.exports = { requireChannel };
