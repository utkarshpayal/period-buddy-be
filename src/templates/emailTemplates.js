/**
 * Reusable HTML wrapper layout for Nura emails to ensure consistent branding and premium aesthetics.
 */
const emailLayout = (title, contentHtml) => {
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
          background-color: #F5F2EF;
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
          color: #2E3A33;
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
          background-color: #F5F2EF;
          padding: 40px 0;
        }
        .main-table {
          width: 100%;
          max-width: 600px;
          margin: 0 auto;
          background-color: #FFFDFB;
          border-radius: 16px;
          overflow: hidden;
          box-shadow: 0 4px 20px rgba(0, 0, 0, 0.05);
        }
        .header {
          background-color: #8FA89B;
          padding: 32px 24px;
          text-align: center;
        }
        .logo-text {
          font-family: 'Outfit', 'Inter', 'Helvetica', sans-serif;
          font-size: 32px;
          font-weight: 700;
          letter-spacing: 2px;
          color: #FFFDFB;
          margin: 0;
          text-transform: uppercase;
        }
        .logo-subtitle {
          font-size: 12px;
          color: #E8EFEA;
          letter-spacing: 4px;
          margin: 4px 0 0 0;
          text-transform: uppercase;
        }
        .content {
          padding: 44px 32px;
          background-color: #FFFDFB;
          line-height: 1.6;
          font-size: 16px;
        }
        .footer {
          background-color: #FDFBFA;
          border-top: 1px solid #EAE5E0;
          padding: 24px;
          text-align: center;
          font-size: 12px;
          color: #7A857E;
        }
        .footer p {
          margin: 4px 0;
        }
        .footer-logo {
          font-size: 14px;
          font-weight: 600;
          color: #8FA89B;
          letter-spacing: 1px;
          margin-bottom: 8px !important;
        }
        .button {
          display: inline-block;
          background-color: #D48C70;
          color: #FFFDFB !important;
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
          background-color: #EAE5E0;
          margin: 24px 0;
        }
        .badge {
          display: inline-block;
          padding: 4px 12px;
          background-color: #F2EBE5;
          color: #D48C70;
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
          background-color: #FDFBFA;
          border-radius: 8px;
          border: 1px solid #EAE5E0;
        }
        .grid-td-label {
          padding: 12px 16px;
          font-weight: 600;
          color: #7A857E;
          width: 120px;
          font-size: 14px;
          border-bottom: 1px solid #EAE5E0;
          vertical-align: top;
        }
        .grid-td-value {
          padding: 12px 16px;
          color: #2E3A33;
          font-size: 14px;
          border-bottom: 1px solid #EAE5E0;
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
              <p style="margin-top: 12px;"><a href="#" style="color: #8FA89B; text-decoration: none;">Unsubscribe</a></p>
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
export const getNewsletterWelcomeTemplate = (email) => {
  const content = `
    <span class="badge">Newsletter</span>
    <h2 style="margin-top: 0; color: #2E3A33; font-size: 24px; font-weight: 600;">You're on the list!</h2>
    <p>Hi there,</p>
    <p>Thank you for subscribing to the Nura newsletter. We're excited to have you join our wellness community.</p>
    <p>Every month, our <strong>Science Advisory Board</strong> compiles the latest health insights, research articles, and updates on menstrual wellbeing, ensuring you receive science-backed knowledge without the spam.</p>
    <p>You can manage your preferences or unsubscribe at any time using the link at the bottom of our emails.</p>
    <div class="divider"></div>
    <p style="margin-bottom: 0;">Warmly,</p>
    <p style="font-weight: 600; margin-top: 4px; color: #8FA89B;">The Nura Team</p>
  `;
  return emailLayout("Welcome to Nura", content);
};

/**
 * Template for Contact Form Submission Notification (Sent to Admin/Team)
 */
export const getContactNotificationTemplate = ({ name, email, topic, message }) => {
  const formattedMessage = String(message).replace(/\n/g, '<br/>');
  const content = `
    <span class="badge" style="background-color: #F0E2DF; color: #C56D56;">Contact Request</span>
    <h2 style="margin-top: 0; color: #2E3A33; font-size: 22px; font-weight: 600;">New Message Received</h2>
    <p>A user has submitted a message via the contact form on the marketing website. Details below:</p>
    
    <table class="grid-table">
      <tr>
        <td class="grid-td-label">Sender Name</td>
        <td class="grid-td-value">${name}</td>
      </tr>
      <tr>
        <td class="grid-td-label">Email Address</td>
        <td class="grid-td-value"><a href="mailto:${email}" style="color: #D48C70; text-decoration: none; font-weight: 500;">${email}</a></td>
      </tr>
      <tr>
        <td class="grid-td-label">Topic</td>
        <td class="grid-td-value"><strong>${topic || 'General Inquiry'}</strong></td>
      </tr>
      <tr class="grid-tr-last">
        <td class="grid-td-label">Message</td>
        <td class="grid-td-value" style="line-height: 1.5; color: #4A564E;">${formattedMessage}</td>
      </tr>
    </table>
    
    <div style="text-align: center; margin-top: 24px;">
      <a href="mailto:${email}?subject=Re: [Nura Contact] ${topic || 'General Inquiry'}" class="button">Reply directly to Sender</a>
    </div>
  `;
  return emailLayout("New Contact Message", content);
};
