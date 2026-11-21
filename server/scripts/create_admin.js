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
    let admin = await User.findOne({ email });
    const promoteExistingPatient = process.argv.includes('--promote-existing-patient');
    if (admin && admin.userType !== 'admin' && !(admin.userType === 'patient' && promoteExistingPatient)) {
      throw new Error('ADMIN_EMAIL belongs to a non-admin account; no changes were made');
    }
    if (!admin) {
      const existingAdmins = await User.find({ userType: 'admin' }).select('_id').limit(2).lean();
      if (existingAdmins.length > 1) throw new Error('Multiple admin accounts exist; specify the intended account before changing admin credentials');
      if (existingAdmins.length === 1) admin = await User.findById(existingAdmins[0]._id);
    }

    const passwordHash = await bcrypt.hash(password, 12);
    if (admin) {
      if (admin.userType === 'patient') admin.userType = 'admin';
      admin.email = email;
      admin.password = passwordHash;
      admin.mustChangePassword = true;
      await admin.save();
      console.log('Admin credentials updated. Initial password was not printed; change it at first login.');
    } else {
      await User.create({ name: 'System Admin', email, password: passwordHash, userType: 'admin', accountStatus: 'active', mustChangePassword: true, verificationStatus: 'verified' });
      console.log('Admin account created. Initial password was not printed; change it at first login.');
    }
  } catch (error) {
    console.error(`Admin account provisioning failed (${error.code || error.name || 'unknown error'}).`);
    process.exitCode = 1;
  } finally {
    const mongoose = require('mongoose');
    await mongoose.disconnect().catch(() => {});
  }
}

createAdminUser();
