const path = require('node:path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env'), quiet: true });

function getJwtSecret() {
  const secret = process.env.JWT_SECRET;
  if (typeof secret !== 'string' || secret.length < 32) {
    const error = new Error('JWT_SECRET must be configured with at least 32 characters');
    error.code = 'JWT_SECRET_NOT_CONFIGURED';
    throw error;
  }
  return secret;
}

module.exports = { getJwtSecret };
