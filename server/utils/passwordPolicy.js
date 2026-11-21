const MIN_USER_PASSWORD_LENGTH = 6;
const MAX_USER_PASSWORD_LENGTH = 128;

function isValidUserPassword(password) {
  return typeof password === 'string'
    && password.length >= MIN_USER_PASSWORD_LENGTH
    && password.length <= MAX_USER_PASSWORD_LENGTH;
}

module.exports = { MIN_USER_PASSWORD_LENGTH, MAX_USER_PASSWORD_LENGTH, isValidUserPassword };
