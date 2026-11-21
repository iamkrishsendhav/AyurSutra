const express = require('express');
const router = express.Router();
const twilio = require('twilio');
const Notification = require('../models/Notification');
const User = require('../models/User');
const { normalizePhone } = require('../utils/phone');
const auth = require('../middleware/auth');

// Support both naming conventions: TWILIO_SID/TWILIO_TOKEN or TWILIO_ACCOUNT_SID/TWILIO_AUTH_TOKEN
const TWILIO_SID = process.env.TWILIO_SID || process.env.TWILIO_ACCOUNT_SID;
const TWILIO_TOKEN = process.env.TWILIO_TOKEN || process.env.TWILIO_AUTH_TOKEN;
const TWILIO_WHATSAPP_FROM_RAW = process.env.TWILIO_WHATSAPP_FROM || process.env.TWILIO_WHATSAPP_NUMBER || process.env.TWILIO_PHONE_NUMBER;

let twilioClient = null;
if (TWILIO_SID && TWILIO_TOKEN) twilioClient = twilio(TWILIO_SID, TWILIO_TOKEN);

function formatWhatsappFrom(raw){
  if (!raw) return null;
  return raw.startsWith('whatsapp:') ? raw : `whatsapp:${raw}`;
}

// POST /admin/send-test-whatsapp
// Body: { email: 'patient@example.com', message: 'text' }
router.post('/send-test-whatsapp', auth, (req, res, next) => req.user.userType === 'admin' ? next() : res.status(403).json({ msg: 'Admin access required' }), async (req, res) => {
  try {
    const { email, message } = req.body;
    if (!email || typeof email !== 'string' || email.length > 254 || (message !== undefined && (typeof message !== 'string' || message.length > 1000))) return res.status(400).json({ msg: 'Valid email and message are required' });
    const user = await User.findOne({ email });
    if (!user) return res.status(404).json({ msg: 'user not found' });

    const normalized = normalizePhone(user.phone) || user.phone;
    const to = String(normalized).startsWith('whatsapp:') ? normalized : `whatsapp:${normalized}`;

    // If Twilio isn't configured, return a diagnostic payload to help debug env and target normalization
    if (!twilioClient || !TWILIO_WHATSAPP_FROM_RAW) {
      console.warn('Admin send-test-whatsapp attempted without Twilio configured', { twilioConfigured: !!twilioClient, whatsappFromConfigured: !!TWILIO_WHATSAPP_FROM_RAW });
      return res.status(503).json({ msg: 'WhatsApp delivery is not configured' });
    }

    const from = formatWhatsappFrom(TWILIO_WHATSAPP_FROM_RAW);
    const opts = { from, to, body: message || 'Test WhatsApp message from Panchkarma' };
    if (process.env.TWILIO_STATUS_CALLBACK_URL) opts.statusCallback = process.env.TWILIO_STATUS_CALLBACK_URL;
    // single retry
    let msg = null;
    try {
      msg = await twilioClient.messages.create(opts);
    } catch (err) {
      console.warn('Admin test send failed, retrying once', err && err.message);
      try {
        msg = await twilioClient.messages.create(opts);
      } catch (err2) {
        console.error('Admin test send failed after retry', err2 && err2.message, err2 && err2.code);
        return res.status(500).json({ msg: 'Twilio send failed', error: err2 && err2.message, errorCode: err2 && err2.code });
      }
    }

    // Save a Notification record for audit (include twilio SID)
    try {
      const note = new Notification({ user: user._id, channel: 'whatsapp', payload: { body: message }, scheduledAt: new Date(), status: 'sent', sentAt: new Date(), twilioSid: msg.sid, sendResponse: msg });
      await note.save();
    } catch (saveErr) {
      console.error('Failed saving test notification', saveErr);
    }

    res.json({ success: true, sid: msg.sid, status: msg.status });
  } catch (err) {
    console.error('Admin send-test-whatsapp error', err);
    res.status(500).json({ msg: err.message });
  }
});

// GET /admin/recent-notifications?limit=20
router.get('/recent-notifications', auth, (req, res, next) => req.user.userType === 'admin' ? next() : res.status(403).json({ msg: 'Admin access required' }), async (req, res) => {
  try {
    const limit = parseInt(req.query.limit || '20', 10);
    const docs = await Notification.find().sort({ createdAt: -1 }).limit(limit).populate('user', 'email name phone');
    res.json(docs);
  } catch (err) {
    console.error('Failed fetching recent notifications', err);
    res.status(500).json({ msg: err.message });
  }
});

// POST /admin/twilio-status
// Twilio will POST status updates for messages. This endpoint accepts form-encoded or JSON body
// containing at least `MessageSid` and `MessageStatus` and updates matching Notification by twilioSid.
router.post('/twilio-status', express.urlencoded({ extended: true }), async (req, res) => {
  try {
    const signature = req.get('X-Twilio-Signature');
    const callbackUrl = process.env.TWILIO_STATUS_CALLBACK_URL || `${req.protocol}://${req.get('host')}${req.originalUrl}`;
    if (!TWILIO_TOKEN || !signature || !twilio.validateRequest(TWILIO_TOKEN, signature, callbackUrl, req.body || {})) return res.status(403).send('Forbidden');
    const body = req.body || {};
    const sid = body.MessageSid || body.SmsSid || body.Sid || body.MessageSid;
    const status = body.MessageStatus || body.SmsStatus || body.Status || '';
    const errorMessage = body.ErrorMessage || body.error_message || null;
    if (!sid) return res.status(400).send('Missing MessageSid');

    const note = await Notification.findOne({ twilioSid: sid });
    if (!note) {
      console.warn('Twilio status for unknown sid', sid);
      return res.status(200).send('OK');
    }

    const st = String(status || '').toLowerCase();
    if (st.includes('fail') || st.includes('failed') || st.includes('undelivered')) {
      note.status = 'failed';
    } else if (st.includes('sent') || st.includes('delivered') || st.includes('queued')) {
      note.status = 'sent';
    }
    if (errorMessage) note.error = errorMessage;
    note.sendResponse = note.sendResponse || {};
    note.sendResponse.twilioStatus = body;
    try { await note.save(); } catch(saveErr){ console.error('Failed saving notification status update', saveErr); }

    res.status(200).send('OK');
  } catch (err) {
    console.error('Error handling twilio-status webhook', err);
    res.status(500).send('Error');
  }
});

module.exports = router;

