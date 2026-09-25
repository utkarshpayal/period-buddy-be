/** Base origin of this API, for building absolute links (e.g. the one-click
 * unsubscribe link below) inside emails — a relative link makes no sense
 * outside a browser tab. Same "opt-in localhost" shape as
 * doctorController.js's adminAppBaseUrl, for the same reason: a deployed
 * host with NODE_ENV unset/misconfigured must still get the real domain,
 * not silently leak localhost into an email footer. */
const apiBaseUrl = () => {
  const explicit = process.env.API_BASE_URL;
  if (explicit) return explicit.replace(/\/$/, '');
  const isLocalDev = process.env.NODE_ENV === 'development';
  return isLocalDev ? 'http://localhost:5000' : 'https://backend.thenura.care';
};

/** Nura brand palette, matching the mobile app's light theme (components/theme.tsx)
 * rather than the unrelated sage/terracotta palette these emails used to hardcode. */
const BRAND = {
  primary: '#E8618F', // rose — theme.colors.primary (light)
  primaryDark: '#C94A78', // theme.colors.primaryDark (light)
  background: '#F6EEF1', // theme.colors.background (light)
  surface: '#FFFFFF', // theme.colors.surface (light)
  surfaceSoft: '#FCF5F7', // theme.colors.surfaceSoft (light)
  border: '#F3DEE6', // theme.colors.border (light)
  foreground: '#3A2A32', // theme.colors.foreground (light)
  mutedText: '#8B7680', // theme.colors.mutedText (light)
  danger: '#B03A56', // theme.colors.danger (light)
  dangerLight: '#FADCE1', // theme.colors.dangerLight (light)
};

/**
 * Reusable HTML wrapper layout for Nura emails to ensure consistent branding and premium aesthetics.
 * `unsubscribeEmail`, when passed, renders a real one-click unsubscribe link
 * in the footer — omitted for transactional mail (OTP, invites, deletion
 * confirmation) where "unsubscribe" doesn't apply.
 */
const emailLayout = (title, contentHtml, { unsubscribeEmail } = {}) => {
  return `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>${title}</title>
      <style>
        body {
          margin: 0;
          padding: 0;
          width: 100% !important;
          background-color: ${BRAND.background};
          font-family: 'Manrope', -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
          color: ${BRAND.foreground};
          -webkit-font-smoothing: antialiased;
        }
        table {
          border-collapse: collapse;
        }
        img {
          border: 0;
          height: auto;
          line-height: 100%;
          outline: none;
          text-decoration: none;
        }
        .wrapper {
          width: 100%;
          table-layout: fixed;
          background-color: ${BRAND.background};
          padding: 40px 0;
        }
        .main-table {
          width: 100%;
          max-width: 600px;
          margin: 0 auto;
          background-color: ${BRAND.surface};
          border-radius: 16px;
          overflow: hidden;
          box-shadow: 0 4px 20px rgba(0, 0, 0, 0.05);
        }
        .header {
          background-color: ${BRAND.primary};
          padding: 32px 24px;
          text-align: center;
        }
        .logo-text {
          font-family: 'Manrope', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
          font-size: 32px;
          font-weight: 700;
          letter-spacing: 2px;
          color: #FFFFFF;
          margin: 0;
          text-transform: uppercase;
        }
        .logo-subtitle {
          font-size: 12px;
          color: #FBE4EC;
          letter-spacing: 4px;
          margin: 4px 0 0 0;
          text-transform: uppercase;
        }
        .content {
          padding: 44px 32px;
          background-color: ${BRAND.surface};
          line-height: 1.6;
          font-size: 16px;
        }
        .footer {
          background-color: ${BRAND.surfaceSoft};
          border-top: 1px solid ${BRAND.border};
          padding: 24px;
          text-align: center;
          font-size: 12px;
          color: ${BRAND.mutedText};
        }
        .footer p {
          margin: 4px 0;
        }
        .footer-logo {
          font-size: 14px;
          font-weight: 600;
          color: ${BRAND.primary};
          letter-spacing: 1px;
          margin-bottom: 8px !important;
        }
        .button {
          display: inline-block;
          background-color: ${BRAND.primary};
          color: #FFFFFF !important;
          text-decoration: none;
          padding: 12px 28px;
          border-radius: 30px;
          font-weight: 600;
          font-size: 15px;
          margin-top: 16px;
          transition: background-color 0.2s ease;
          letter-spacing: 0.5px;
        }
        .divider {
          height: 1px;
          background-color: ${BRAND.border};
          margin: 24px 0;
        }
        .badge {
          display: inline-block;
          padding: 4px 12px;
          background-color: ${BRAND.surfaceSoft};
          color: ${BRAND.primaryDark};
          border-radius: 20px;
          font-size: 12px;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.5px;
          margin-bottom: 12px;
        }
        .grid-table {
          width: 100%;
          margin: 20px 0;
          background-color: ${BRAND.surfaceSoft};
          border-radius: 8px;
          border: 1px solid ${BRAND.border};
        }
        .grid-td-label {
          padding: 12px 16px;
          font-weight: 600;
          color: ${BRAND.mutedText};
          width: 120px;
          font-size: 14px;
          border-bottom: 1px solid ${BRAND.border};
          vertical-align: top;
        }
        .grid-td-value {
          padding: 12px 16px;
          color: ${BRAND.foreground};
          font-size: 14px;
          border-bottom: 1px solid ${BRAND.border};
          vertical-align: top;
        }
        .grid-tr-last td {
          border-bottom: none;
        }
      </style>
    </head>
    <body>
      <center class="wrapper">
        <table class="main-table">
          <!-- Header -->
          <tr>
            <td class="header">
              <h1 class="logo-text">Nura</h1>
              <p class="logo-subtitle">Wellness & Connection</p>
            </td>
          </tr>

          <!-- Content -->
          <tr>
            <td class="content">
              ${contentHtml}
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td class="footer">
              <p class="footer-logo">NURA</p>
              <p>© 2026 Nura. All rights reserved.</p>
              <p>Designed for premium holistic support & cycle wisdom.</p>
              ${
                unsubscribeEmail
                  ? `<p style="margin-top: 12px;"><a href="${apiBaseUrl()}/api/newsletter/unsubscribe?email=${encodeURIComponent(unsubscribeEmail)}" style="color: ${BRAND.primary}; text-decoration: none;">Unsubscribe</a></p>`
                  : ''
              }
            </td>
          </tr>
        </table>
      </center>
    </body>
    </html>
  `;
};

/**
 * Template for Newsletter Subscription Welcome Email
 */
export const getNewsletterWelcomeTemplate = ({ email } = {}) => {
  const content = `
    <span class="badge">Newsletter</span>
    <h2 style="margin-top: 0; color: ${BRAND.foreground}; font-size: 24px; font-weight: 600;">You're on the list!</h2>
    <p>Hi there,</p>
    <p>Thank you for subscribing to the Nura newsletter. We're excited to have you join our wellness community.</p>
    <p>Every month, our <strong>Science Advisory Board</strong> compiles the latest health insights, research articles, and updates on menstrual wellbeing, ensuring you receive science-backed knowledge without the spam.</p>
    <p>You can manage your preferences or unsubscribe at any time using the link at the bottom of our emails.</p>
    <div class="divider"></div>
    <p style="margin-bottom: 0;">Warmly,</p>
    <p style="font-weight: 600; margin-top: 4px; color: ${BRAND.primary};">The Nura Team</p>
  `;
  return emailLayout('Welcome to Nura', content, { unsubscribeEmail: email });
};

/**
 * Template for Signup / Resend OTP verification email
 */
export const getOtpEmailTemplate = ({ firstName, otp, expiryMinutes }) => {
  const content = `
    <span class="badge">Verify your email</span>
    <h2 style="margin-top: 0; color: ${BRAND.foreground}; font-size: 24px; font-weight: 600;">Hi ${firstName || 'there'},</h2>
    <p>Use the code below to verify your email and finish creating your Nura account.</p>

    <div style="text-align: center; margin: 32px 0;">
      <span style="display: inline-block; font-family: 'Courier New', monospace; font-size: 36px; font-weight: 700; letter-spacing: 10px; color: ${BRAND.foreground}; background-color: ${BRAND.surfaceSoft}; padding: 16px 24px; border-radius: 12px;">
        ${otp}
      </span>
    </div>

    <p>This code expires in <strong>${expiryMinutes} minutes</strong>. If you didn't request this, you can safely ignore this email.</p>
    <div class="divider"></div>
    <p style="margin-bottom: 0;">Warmly,</p>
    <p style="font-weight: 600; margin-top: 4px; color: ${BRAND.primary};">The Nura Team</p>
  `;
  return emailLayout('Your Nura verification code', content);
};

/**
 * Template for the self-service "delete my account" confirmation code.
 * This code is what gates the actual deletion — it proves the requester
 * has access to the account's inbox, not just knowledge of its email.
 */
export const getAccountDeletionOtpEmailTemplate = ({ firstName, otp, expiryMinutes }) => {
  const content = `
    <span class="badge" style="background-color: ${BRAND.dangerLight}; color: ${BRAND.danger};">Confirm account deletion</span>
    <h2 style="margin-top: 0; color: ${BRAND.foreground}; font-size: 24px; font-weight: 600;">Hi ${firstName || 'there'},</h2>
    <p>We received a request to permanently delete your Nura account and all associated data. Use the code below to confirm.</p>

    <div style="text-align: center; margin: 32px 0;">
      <span style="display: inline-block; font-family: 'Courier New', monospace; font-size: 36px; font-weight: 700; letter-spacing: 10px; color: ${BRAND.foreground}; background-color: ${BRAND.surfaceSoft}; padding: 16px 24px; border-radius: 12px;">
        ${otp}
      </span>
    </div>

    <p>This code expires in <strong>${expiryMinutes} minutes</strong>. <strong>If you didn't request this, ignore this email and your account will be left untouched</strong> — nothing is deleted until this code is entered.</p>
    <div class="divider"></div>
    <p style="margin-bottom: 0;">Warmly,</p>
    <p style="font-weight: 600; margin-top: 4px; color: ${BRAND.primary};">The Nura Team</p>
  `;
  return emailLayout('Confirm your Nura account deletion', content);
};

/**
 * Template for Contact Form Submission Notification (Sent to Admin/Team)
 */
export const getContactNotificationTemplate = ({ name, email, topic, message }) => {
  const formattedMessage = String(message).replace(/\n/g, '<br/>');
  const content = `
    <span class="badge" style="background-color: ${BRAND.dangerLight}; color: ${BRAND.danger};">Contact Request</span>
    <h2 style="margin-top: 0; color: ${BRAND.foreground}; font-size: 22px; font-weight: 600;">New Message Received</h2>
    <p>A user has submitted a message via the contact form on the marketing website. Details below:</p>
    
    <table class="grid-table">
      <tr>
        <td class="grid-td-label">Sender Name</td>
        <td class="grid-td-value">${name}</td>
      </tr>
      <tr>
        <td class="grid-td-label">Email Address</td>
        <td class="grid-td-value"><a href="mailto:${email}" style="color: ${BRAND.primaryDark}; text-decoration: none; font-weight: 500;">${email}</a></td>
      </tr>
      <tr>
        <td class="grid-td-label">Topic</td>
        <td class="grid-td-value"><strong>${topic || 'General Inquiry'}</strong></td>
      </tr>
      <tr class="grid-tr-last">
        <td class="grid-td-label">Message</td>
        <td class="grid-td-value" style="line-height: 1.5; color: ${BRAND.mutedText};">${formattedMessage}</td>
      </tr>
    </table>
    
    <div style="text-align: center; margin-top: 24px;">
      <a href="mailto:${email}?subject=Re: [Nura Contact] ${topic || 'General Inquiry'}" class="button">Reply directly to Sender</a>
    </div>
  `;
  return emailLayout('New Contact Message', content);
};

/**
 * Template for a gynecologist invite. Sent when an admin adds a doctor to the
 * platform — carries a one-time link to set their password and access the
 * clinician dashboard.
 */
export const getDoctorInviteTemplate = ({ name, inviteUrl, expiryHours, specialty }) => {
  const content = `
    <span class="badge">You're invited to Nura</span>
    <h2 style="margin-top: 0; color: ${BRAND.foreground}; font-size: 24px; font-weight: 600;">Hi Dr. ${name || 'there'},</h2>
    <p>The Nura team has invited you to join as a ${specialty || 'gynecologist'} on our clinician platform. From your dashboard you can manage bookings, chat and video-consult with patients, share prescriptions, publish educational reels, and track your earnings.</p>

    <div style="text-align: center; margin: 32px 0;">
      <a href="${inviteUrl}" class="button">Set your password & sign in</a>
    </div>

    <p>This secure link expires in <strong>${expiryHours} hours</strong>. If the button doesn't work, copy and paste this URL into your browser:</p>
    <p style="word-break: break-all; color: ${BRAND.primary}; font-size: 13px;">${inviteUrl}</p>
    <div class="divider"></div>
    <p>If you weren't expecting this invitation, you can safely ignore this email.</p>
    <p style="margin-bottom: 0;">Warmly,</p>
    <p style="font-weight: 600; margin-top: 4px; color: ${BRAND.primary};">The Nura Team</p>
  `;
  return emailLayout('Your Nura clinician invitation', content);
};

const escapeHtml = (value) =>
  String(value ?? '').replace(
    /[&<>"']/g,
    (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch],
  );

/** Invite for an Admin Workspace staff member (content / app / clinical team). */
export const getStaffInviteTemplate = ({
  name,
  roleLabel,
  invitedByName,
  inviteUrl,
  expiryHours,
}) => {
  const content = `
    <span class="badge">You're invited to the Nura Workspace</span>
    <h2 style="margin-top: 0; color: ${BRAND.foreground}; font-size: 24px; font-weight: 600;">Hi ${escapeHtml(name) || 'there'},</h2>
    <p>${escapeHtml(invitedByName) || 'The Nura team'} has invited you to join the Nura Admin Workspace as <strong>${escapeHtml(roleLabel)}</strong>.</p>

    <div style="text-align: center; margin: 32px 0;">
      <a href="${inviteUrl}" class="button">Set your password & sign in</a>
    </div>

    <p>This secure link expires in <strong>${expiryHours} hours</strong>. If the button doesn't work, copy and paste this URL into your browser:</p>
    <p style="word-break: break-all; color: ${BRAND.primary}; font-size: 13px;">${inviteUrl}</p>
    <div class="divider"></div>
    <p>If you weren't expecting this invitation, you can safely ignore this email.</p>
    <p style="margin-bottom: 0;">Warmly,</p>
    <p style="font-weight: 600; margin-top: 4px; color: ${BRAND.primary};">The Nura Team</p>
  `;
  return emailLayout('Your Nura Workspace invitation', content);
};
