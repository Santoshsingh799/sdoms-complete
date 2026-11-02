import { prisma } from '../config/db.js';
import { env } from '../config/env.js';
import { sendPush } from './push.js';

async function send(mobile, message) {
  if (env.smsProvider === 'dev') {
    console.log(`\n[SIMULATED SMS -> ${mobile}]\n${message}\n`);
    return 'SIMULATED';
  }
  if (env.smsProvider === 'msg91') {
    const r = await fetch('https://control.msg91.com/api/v5/flow/', {
      method: 'POST',
      headers: { authkey: process.env.MSG91_AUTH_KEY, 'content-type': 'application/json' },
      body: JSON.stringify({ template_id: process.env.MSG91_TEMPLATE_ID, recipients: [{ mobiles: `91${mobile}`, var1: message }] }),
    });
    if (!r.ok) throw new Error(`MSG91 ${r.status}`);
    return 'SENT';
  }
  if (env.smsProvider === 'twilio') {
    const sid = process.env.TWILIO_ACCOUNT_SID;
    const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
      method: 'POST',
      headers: {
        Authorization: 'Basic ' + Buffer.from(`${sid}:${process.env.TWILIO_AUTH_TOKEN}`).toString('base64'),
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ To: `+91${mobile}`, From: process.env.TWILIO_FROM, Body: message }),
    });
    if (!r.ok) throw new Error(`Twilio ${r.status}`);
    return 'SENT';
  }
  throw new Error(`Unknown SMS provider ${env.smsProvider}`);
}

// Never throws: a failed SMS must not break the approval workflow. Every attempt is stored.
export async function notify({ requestId = null, mobile, event, message, link = null }) {
  if (!mobile && !link) return;
  let status = 'FAILED';
  if (env.smsProvider === 'dev') {
    console.log(`\n[WEB APPROVAL LINK${mobile ? ` FOR ${mobile}` : ''}]\n${message}\n${link || ''}\n`);
    status = 'SIMULATED';
  } else {
    try { status = await send(mobile, message); } catch (e) { console.error('SMS failed:', e.message); }
  }
  const recipient = mobile ? await prisma.user.findFirst({ where: { mobile }, select: { id: true } }) : null;
  if (recipient) await sendPush(recipient.id, { title: 'SDOMS approval update', body: message, url: link || '/login' });
  await prisma.notification.create({
    data: { requestId, toMobile: mobile, event, message: link ? `${message} ${link}` : message, provider: env.smsProvider, status },
  });
}
