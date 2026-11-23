const path = require('node:path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env'), quiet: true });
const connectDB = require('../config/db');
const User = require('../models/User');
const bcrypt = require('bcryptjs');
const { isValidUserPassword } = require('../utils/passwordPolicy');

async function createAdminUser() {
  const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.ADMIN_INITIAL_PASSWORD;
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Set a valid ADMIN_EMAIL in the server environment');
  if (!isValidUserPassword(password)) throw new Error('Set ADMIN_INITIAL_PASSWORD to a value between 6 and 128 characters');

  try {
    await connectDB();
    if (await User.exists({ email })) throw new Error('ADMIN_EMAIL already belongs to an account; no changes were made');
    if (await User.exists({ userType: 'admin' })) throw new Error('An admin account already exists; no changes were made');
    const passwordHash = await bcrypt.hash(password, 12);
    await User.create({ name: 'System Admin', email, password: passwordHash, userType: 'admin', accountStatus: 'active', mustChangePassword: true, verificationStatus: 'verified' });
    console.log('Admin account created. Initial password was not printed; change it at first login.');
  } catch (error) {
    console.error(`Admin account provisioning failed (${error.code || error.name || 'unknown error'}).`);
    process.exitCode = 1;
  } finally {
    const mongoose = require('mongoose');
    await mongoose.disconnect().catch(() => {});
  }
}

createAdminUser();
