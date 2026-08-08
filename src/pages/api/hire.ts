import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { getEntry } from 'astro:content';

export const prerender = false;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

const str = (v: FormDataEntryValue | null) => (typeof v === 'string' ? v.trim() : '');

export const POST: APIRoute = async (context) => {
  let form: FormData;
  try {
    form = await context.request.formData();
  } catch {
    return json({ error: 'Invalid submission' }, 400);
  }

  // Honeypot: bots fill it, humans never see it. Pretend success.
  if (str(form.get('website')) !== '') return json({ ok: true });

  const name = str(form.get('name'));
  const email = str(form.get('email'));
  const phone = str(form.get('phone'));
  const organisation = str(form.get('organisation'));
  const date = str(form.get('date'));
  const startTime = str(form.get('startTime'));
  const endTime = str(form.get('endTime'));
  const purpose = str(form.get('purpose'));
  const attendance = str(form.get('attendance'));
  const insurance = str(form.get('insurance')) === 'on';
  const alcoholDrugFree = str(form.get('alcoholDrugFree')) === 'on';

  const errors: string[] = [];
  if (!name || name.length > 200) errors.push('name');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.push('email');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) errors.push('date');
  if (!/^\d{2}:\d{2}$/.test(startTime)) errors.push('start time');
  if (!/^\d{2}:\d{2}$/.test(endTime)) errors.push('end time');
  if (!purpose || purpose.length > 4000) errors.push('purpose');
  if (!/^\d{1,3}$/.test(attendance)) errors.push('attendance');
  if (!insurance) errors.push('public liability insurance confirmation');
  if (!alcoholDrugFree) errors.push('alcohol and drug free confirmation');
  if (errors.length) {
    return json({ error: `Please check these fields: ${errors.join(', ')}.` }, 400);
  }

  // Cloudflare secrets (production) / .dev.vars (local dev)
  const secrets = env as Record<string, string | undefined>;

  // Verify Turnstile when configured (invisible spam check)
  const turnstileSecret = secrets.TURNSTILE_SECRET;
  if (turnstileSecret) {
    const token = str(form.get('cf-turnstile-response'));
    const verify = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ secret: turnstileSecret, response: token }),
    });
    const outcome = (await verify.json()) as { success: boolean };
    if (!outcome.success) {
      return json({ error: 'Spam check failed — please reload the page and try again.' }, 400);
    }
  }

  const resendKey = secrets.RESEND_API_KEY;
  const fromAddress = secrets.RESEND_FROM;
  if (!resendKey || !fromAddress) {
    return json({ error: 'The booking form is not set up yet — please email us directly.' }, 503);
  }

  // Booking officer address is CMS-editable (settings/site.yml)
  const settings = await getEntry('settings', 'site');
  const to = settings?.data.bookingEmail;
  if (!to) return json({ error: 'The booking form is not set up yet — please email us directly.' }, 503);

  // One-click pre-filled event for the "Centre Bookings" Google Calendar
  const compact = (t: string) => t.replace(/[-:]/g, '');
  const gcalUrl =
    `https://calendar.google.com/calendar/render?action=TEMPLATE` +
    `&text=${encodeURIComponent(`Centre hire: ${name}`)}` +
    `&dates=${compact(date)}T${compact(startTime)}00/${compact(date)}T${compact(endTime)}00` +
    `&ctz=Australia/Brisbane` +
    `&details=${encodeURIComponent(
      `${purpose}\n\nContact: ${email}${phone ? ` / ${phone}` : ''}` +
        `${organisation ? `\nOrganisation: ${organisation}` : ''}\nAttendance: ${attendance}`,
    )}`;

  const lines = [
    `New Community Centre hire application`,
    ``,
    `Name:         ${name}`,
    `Email:        ${email}`,
    `Phone:        ${phone || '—'}`,
    `Organisation: ${organisation || '—'}`,
    ``,
    `Date:         ${date}`,
    `Time:         ${startTime} – ${endTime}`,
    `Attendance:   ${attendance}`,
    `Public liability insurance: confirmed`,
    `Alcohol and drug free:      confirmed`,
    ``,
    `Purpose:`,
    purpose,
    ``,
    `To APPROVE: reply to this email, then add the booking to the calendar in one click`,
    `(pick the "Centre Bookings" calendar in the event window before saving):`,
    gcalUrl,
    ``,
    `— Sent from the website hire form. Reply to this email to contact the applicant.`,
  ];

  const send = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${resendKey}` },
    body: JSON.stringify({
      from: fromAddress,
      to: [to],
      reply_to: email,
      subject: `Hire application: ${date} ${startTime}–${endTime} (${name})`,
      text: lines.join('\n'),
    }),
  });

  if (!send.ok) {
    console.error('Resend error:', send.status, await send.text());
    return json({ error: 'We could not send your application just now. Please try again shortly.' }, 502);
  }

  // Best-effort acknowledgement to the applicant — never fails the request
  try {
    const ack = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${resendKey}` },
      body: JSON.stringify({
        from: fromAddress,
        to: [email],
        reply_to: to,
        subject: 'We received your Community Centre hire application',
        text: [
          `Dear ${name},`,
          ``,
          `Thank you for your application to hire the Bahá'í Community Centre:`,
          ``,
          `Date:       ${date}`,
          `Time:       ${startTime} – ${endTime}`,
          `Purpose:    ${purpose}`,
          ``,
          `This is an automatic confirmation that your request has been received.`,
          `We will review it and be in touch to confirm availability and hire details.`,
          ``,
          `Warm regards,`,
          `Bahá'í Community of Townsville`,
        ].join('\n'),
      }),
    });
    if (!ack.ok) console.error('Ack email failed:', ack.status, await ack.text());
  } catch (err) {
    console.error('Ack email error:', err);
  }

  return json({ ok: true });
};
