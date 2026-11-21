const test = require('node:test');
const assert = require('node:assert/strict');
const { isValidUserPassword } = require('../utils/passwordPolicy');

test('user password policy accepts exactly six characters and longer values', () => {
  assert.equal(isValidUserPassword('abcde'), false);
  assert.equal(isValidUserPassword('abcdef'), true);
  assert.equal(isValidUserPassword('abcdefg'), true);
});

test('user password policy rejects invalid types and values over the maximum', () => {
  assert.equal(isValidUserPassword(undefined), false);
  assert.equal(isValidUserPassword('a'.repeat(129)), false);
});
