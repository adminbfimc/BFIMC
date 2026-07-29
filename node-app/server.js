const express = require('express');
const nodemailer = require('nodemailer');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

loadEnv(path.join(__dirname, '.env'));

const app = express();
const siteRoot = path.resolve(__dirname, '..');
const pagesDirectory = path.join(__dirname, 'views');
const port = Number(process.env.PORT || 3000);
const sessionSecret = process.env.SESSION_SECRET || 'change-this-bfimc-local-session-secret';
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  console.warn('Supabase is not configured. Add SUPABASE_URL and SUPABASE_ANON_KEY to node-app/.env.');
}

app.disable('x-powered-by');
app.use(express.urlencoded({ extended: false, limit: '100kb' }));
// Only assets are public. The legacy PHP source files are deliberately not served.
app.use('/assets', express.static(path.join(siteRoot, 'assets')));

const routes = {
  '/': { page: 'home', title: 'BFIMC | Home' },
  '/portfolio': { page: 'portfolio', title: 'BFIMC | Portfolio' },
  '/membership': { page: 'membership', title: 'BFIMC | Membership' },
  '/services': { page: 'services', title: 'BFIMC | Services' },
  '/contact': { page: 'contacts', title: 'BFIMC | Contacts' },
  '/membership-form': { page: 'membership_form', title: 'BFIMC | Membership Form' },
  '/loan-form': { page: 'loan_form', title: 'BFIMC | Loan Form' }
};

for (const [url, page] of Object.entries(routes)) {
  app.get(url, async (req, res) => renderPage(res, page, req.query.status, req));
}

app.get('/auth', async (req, res) => {
  if (await sessionUser(req, res)) return res.redirect('/profile');
  renderAuth(res, req.query.mode, req.query.status);
});
app.get('/forgot-password', (req, res) => renderForgotPassword(res, req.query.status));
app.get('/reset-password', (req, res) => renderResetPassword(res, req.query.token, req.query.status));
app.get('/verify-email', (req, res) => renderVerifyEmail(res, req.query.email, req.query.status));
app.get('/auth/callback', (req, res) => renderAuthCallback(res));
app.get('/profile', requireUser, (req, res) => renderProfile(res, req.user, req.query.status));
app.get('/admin', requireAdmin, async (req, res) => renderAdmin(res, req.user, req.query.status));

app.post('/contact', handleSubmission('contact', ['name', 'email', 'subject', 'message']));
app.post('/membership-application', handleSubmission('membership application', [
  'last_name', 'first_name', 'middle_name', 'email', 'mobile_number', 'address'
]));
app.post('/loan-application', handleSubmission('loan application', [
  'last_name', 'first_name', 'middle_name', 'email', 'mobile_number', 'address', 'need'
]));
app.post('/signup', handleSignup);
app.post('/login', handleLogin);
app.post('/logout', (req, res) => {
  res.setHeader('Set-Cookie', clearSessionCookie());
  res.redirect('/');
});
app.post('/forgot-password', handleForgotPassword);
app.post('/reset-password', handleResetPassword);
app.post('/verify-email', handleVerifyEmail);
app.post('/verify-email/resend', handleResendVerification);
app.post('/admin/portfolio', requireAdmin, handlePortfolioSave);
app.post('/admin/portfolio/:id/delete', requireAdmin, handlePortfolioDelete);
app.post('/admin/admins', requireAdmin, handleAdminAdd);
app.post('/admin/admins/:id/delete', requireAdmin, handleAdminDelete);
app.post('/profile/details', requireUser, handleProfileDetails);
app.post('/profile/password', requireUser, handleProfilePassword);

app.use((req, res) => res.status(404).send('Page not found.'));

if (require.main === module) {
  app.listen(port, () => {
    console.log(`BFIMC Node site is running at http://localhost:${port}`);
  });
}

async function renderPage(res, { page, title }, status, req) {
  const message = status === 'sent'
    ? '<div class="container pt-5 mt-5"><div class="alert alert-success">Your submission has been sent successfully.</div></div>'
    : status === 'error'
      ? '<div class="container pt-5 mt-5"><div class="alert alert-danger">We could not send your submission. Please try again later.</div></div>'
      : '';

  const content = page === 'portfolio' ? await portfolioFragment() : fragment(page);
  res.type('html').send(`${header(title, await sessionUser(req, res))}${message}${content}${footer()}`);
}

function handleSubmission(type, fields) {
  return async (req, res) => {
    const missing = fields.some((field) => !String(req.body[field] || '').trim());
    const email = String(req.body.email || '').trim();
    if (missing || !isEmail(email)) return res.redirect('back');

    try {
      if (type === 'contact') await saveContactMessage(req.body);
      if (type !== 'contact' || smtpConfigured()) await sendEmail(type, fields, req.body, email);
      res.redirect(destinationFor(type, 'sent'));
    } catch (error) {
      console.error(`Unable to send ${type}:`, error.message);
      res.redirect(destinationFor(type, 'error'));
    }
  };
}

async function saveContactMessage({ name, email, subject, message }) {
  const { error } = await supabase().from('contact_messages').insert({ name: String(name).trim(), email: normalizeEmail(email), subject: String(subject).trim(), message: String(message).trim() });
  if (error) throw error;
}

async function sendEmail(type, fields, values, replyTo) {
  const required = ['SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASS', 'MAIL_FROM', 'MAIL_TO'];
  if (required.some((key) => !process.env[key])) {
    throw new Error('SMTP is not configured. Add the required values to node-app/.env.');
  }

  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT),
    secure: process.env.SMTP_SECURE === 'true',
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
  });
  const details = fields.map((field) => `${label(field)}: ${String(values[field]).trim()}`).join('\n');

  await transporter.sendMail({
    from: process.env.MAIL_FROM,
    to: process.env.MAIL_TO,
    replyTo,
    subject: `BFIMC ${type}`,
    text: details
  });
}

function destinationFor(type, status) {
  if (type === 'contact') return `/contact?status=${status}`;
  if (type === 'membership application') return `/membership-form?status=${status}`;
  return `/loan-form?status=${status}`;
}

function header(title, user) {
  return fragment('header')
    .replace(/<title>.*?<\/title>/s, `<title>${escapeHtml(title)}</title>`)
    .replaceAll('index.php#about', '/#about')
    .replaceAll('href="index.php"', 'href="/"')
    .replaceAll('href="?portfolio"', 'href="/portfolio"')
    .replaceAll('href="?membership"', 'href="/membership"')
    .replaceAll('href="?services"', 'href="/services"')
    .replaceAll('href="?contacts"', 'href="/contact"')
    .replaceAll('href="?membership_form"', 'href="/membership-form"')
    .replace('{{ACCOUNT_NAV}}', accountNavigation(user));
}

function footer() {
  return fragment('footer')
    .replaceAll('index.php#about', '/#about')
    .replaceAll('href="index.php"', 'href="/"')
    .replaceAll('href="?membership"', 'href="/membership"')
    .replaceAll('href="?services"', 'href="/services"')
    .replaceAll('href="?contacts"', 'href="/contact"');
}

function accountNavigation(user) {
  if (!user) return '<a href="/auth" class="be-a-member-btn account-login-link">Login / Sign up</a>';
  const name = escapeHtml(user.firstName);
  const adminLink = user.isAdmin ? '<a href="/admin"><i class="bi bi-shield-lock"></i> Admin panel</a>' : '';
  return `<details class="account-menu"><summary aria-label="Open account menu"><i class="bi bi-person-circle"></i><span>${name}</span><i class="bi bi-chevron-down menu-chevron"></i></summary><div class="account-menu-panel"><p>Signed in as <strong>${escapeHtml(user.email)}</strong></p>${adminLink}<a href="/profile"><i class="bi bi-person"></i> Profile & settings</a><form action="/logout" method="post"><button type="submit"><i class="bi bi-box-arrow-right"></i> Log out</button></form></div></details>`;
}

function renderAuth(res, mode = 'login', status, values = {}) {
  const activeMode = mode === 'signup' ? 'signup' : 'login';
  const messages = {
    registered: 'Your account is ready. Welcome to BFIMC!',
    invalid: 'Email or password is incorrect.',
    exists: 'An account already exists for this email. Please log in instead.',
    password: 'Use at least 8 characters and make sure both passwords match.',
    required: 'Please complete all required fields.',
    created: 'Your account is ready. You are now signed in.',
    reset: 'Your password has been updated. Please log in.',
    confirm: 'Check your email to confirm your account, then log in.',
    unverified: 'Your email has not been verified yet. Enter the code we sent to continue.',
    config: 'Account service is not configured yet. Please try again later.',
    'signup-error': values.signupError || 'We could not create your account. Please try again.'
  };
  const message = messages[status] ? `<div class="auth-alert ${status === 'created' ? 'success' : ''}">${messages[status]}</div>` : '';
  const content = fragment('auth')
    .replace('{{AUTH_MESSAGE}}', message)
    .replace('{{AUTH_MODE}}', activeMode)
    .replace('{{LOGIN_ACTIVE}}', activeMode === 'login' ? 'is-active' : '')
    .replace('{{SIGNUP_ACTIVE}}', activeMode === 'signup' ? 'is-active' : '')
    .replaceAll('{{FIRST_NAME_VALUE}}', escapeHtml(values.first_name || ''))
    .replaceAll('{{LAST_NAME_VALUE}}', escapeHtml(values.last_name || ''))
    .replaceAll('{{BIRTHDATE_VALUE}}', escapeHtml(values.birthdate || ''))
    .replaceAll('{{EMAIL_VALUE}}', escapeHtml(values.email || ''))
    .replace('{{GENDER_EMPTY}}', !values.gender ? 'selected' : '')
    .replace('{{GENDER_FEMALE}}', values.gender === 'Female' ? 'selected' : '')
    .replace('{{GENDER_MALE}}', values.gender === 'Male' ? 'selected' : '')
    .replace('{{GENDER_PREFER_NOT_TO_SAY}}', values.gender === 'Prefer not to say' ? 'selected' : '');
  res.type('html').send(`${header('BFIMC | Account', null)}${content}${footer()}`);
}

function renderForgotPassword(res, status) {
  const message = status === 'sent'
    ? '<div class="auth-alert success">If that email is registered, we have sent password-reset instructions.</div>'
    : status === 'error'
      ? '<div class="auth-alert">We could not start the password reset. Please try again later.</div>'
      : '';
  res.type('html').send(`${header('BFIMC | Reset Password', null)}${fragment('forgot_password').replace('{{AUTH_MESSAGE}}', message)}${footer()}`);
}

function renderResetPassword(res, token, status) {
  const message = status === 'password'
    ? '<div class="auth-alert">Use at least 8 characters and make sure both passwords match.</div>'
    : status === 'updated'
      ? '<div class="auth-alert success">Your password has been updated. You can now log in.</div>'
      : status === 'invalid'
        ? '<div class="auth-alert">This password-reset link is invalid or has expired. Please request a new one.</div>'
        : '';
  const content = fragment('reset_password')
    .replace('{{AUTH_MESSAGE}}', message)
    .replace('{{RESET_TOKEN}}', escapeHtml(token || ''))
    .replace('{{RESET_DISABLED}}', '');
  res.type('html').send(`${header('BFIMC | Choose a New Password', null)}${content}${footer()}`);
}

function renderVerifyEmail(res, email, status) {
  const messages = {
    invalid: 'That verification code is invalid or has expired. Please try again.',
    required: 'Enter the email address and verification code from your email.',
    unverified: 'Your email has not been verified yet. Enter the code we sent to continue.',
    sent: 'A new verification code has been sent.',
    error: 'We could not send a new code. Please try again later.'
  };
  const message = messages[status] ? `<div class="auth-alert">${messages[status]}</div>` : '';
  const content = fragment('verify_email')
    .replace('{{AUTH_MESSAGE}}', message)
    .replaceAll('{{EMAIL}}', escapeHtml(email || ''));
  res.type('html').send(`${header('BFIMC | Verify Email', null)}${content}${footer()}`);
}

function renderAuthCallback(res) {
  const content = '<main class="account-page"><section class="account-shell single-account"><div class="account-card"><p class="section-kicker">Email verified</p><h1>Your account is confirmed.</h1><p class="account-lead">Your email has been successfully verified. You can now log in to your BFIMC account.</p><a class="auth-submit" href="/auth?mode=login">Go to log in <i class="bi bi-arrow-right"></i></a></div></section></main>';
  res.type('html').send(`${header('BFIMC | Account Confirmed', null)}${content}${footer()}`);
}

function renderProfile(res, user, status) {
  const messages = {
    registered: 'Your account is ready. Welcome to BFIMC!',
    details: 'Your profile details have been saved.',
    password: 'Your password has been updated.',
    current: 'Your current password is incorrect.',
    mismatch: 'Your new passwords do not match or are too short.',
    required: 'Please complete all profile fields.'
  };
  const message = messages[status] ? `<div class="auth-alert ${['registered', 'details', 'password'].includes(status) ? 'success' : ''}">${messages[status]}</div>` : '';
  const content = fragment('profile')
    .replace('{{AUTH_MESSAGE}}', message)
    .replaceAll('{{FIRST_NAME}}', escapeHtml(user.firstName))
    .replaceAll('{{LAST_NAME}}', escapeHtml(user.lastName))
    .replaceAll('{{EMAIL}}', escapeHtml(user.email))
    .replaceAll('{{BIRTHDATE}}', escapeHtml(user.birthdate))
    .replaceAll('{{GENDER}}', escapeHtml(user.gender))
    .replace('{{GENDER_FEMALE}}', user.gender === 'Female' ? 'selected' : '')
    .replace('{{GENDER_MALE}}', user.gender === 'Male' ? 'selected' : '')
    .replace('{{GENDER_PREFER_NOT_TO_SAY}}', user.gender === 'Prefer not to say' ? 'selected' : '');
  res.type('html').send(`${header('BFIMC | Profile', user)}${content}${footer()}`);
}

async function handleSignup(req, res) {
  const { first_name, last_name, birthdate, gender, email, password, confirm_password } = req.body;
  if (![first_name, last_name, birthdate, gender, email, password, confirm_password].every((value) => String(value || '').trim())) return renderAuth(res, 'signup', 'required', req.body);
  if (!isEmail(email) || String(password).length < 8 || password !== confirm_password) return renderAuth(res, 'signup', 'password', req.body);
  if (!supabaseConfigured()) return renderAuth(res, 'signup', 'config', req.body);
  const { data, error } = await supabase().auth.signUp({
    email: normalizeEmail(email), password: String(password),
    options: {
      data: { first_name: String(first_name).trim(), last_name: String(last_name).trim(), birthdate: String(birthdate), gender: String(gender) },
      emailRedirectTo: `${req.protocol}://${req.get('host')}/auth/callback`
    }
  });
  if (error) {
    const signupStatus = error.message.toLowerCase().includes('already') ? 'exists' : 'signup-error';
    return renderAuth(res, 'signup', signupStatus, { ...req.body, signupError: error.message });
  }
  if (!data.session) return res.redirect(`/verify-email?email=${encodeURIComponent(normalizeEmail(email))}`);
  res.setHeader('Set-Cookie', sessionCookie(data.session));
  res.redirect('/profile?status=registered');
}

async function handleLogin(req, res) {
  if (!supabaseConfigured()) return res.redirect('/auth?mode=login&status=config');
  const email = normalizeEmail(req.body.email);
  const { data, error } = await supabase().auth.signInWithPassword({ email, password: String(req.body.password || '') });
  if (error && /email.*(not confirmed|not verified)|not confirmed/i.test(error.message)) {
    return res.redirect(`/verify-email?email=${encodeURIComponent(email)}&status=unverified`);
  }
  if (error || !data.session) return res.redirect('/auth?mode=login&status=invalid');
  res.setHeader('Set-Cookie', sessionCookie(data.session));
  const { data: admin } = await supabase(data.session.access_token).from('admins').select('user_id').eq('user_id', data.user.id).maybeSingle();
  res.redirect(admin ? '/admin' : '/');
}

async function handleForgotPassword(req, res) {
  if (!supabaseConfigured()) return res.redirect('/forgot-password?status=error');
  const { error } = await supabase().auth.resetPasswordForEmail(normalizeEmail(req.body.email));
  res.redirect(`/forgot-password?status=${error ? 'error' : 'sent'}`);
}

async function handleResetPassword(req, res) {
  const { token, password, confirm_password } = req.body;
  if (!token || !supabaseConfigured()) return res.redirect('/reset-password?status=invalid');
  if (String(password || '').length < 8 || password !== confirm_password) return res.redirect('/reset-password?status=password');
  const { data, error: verifyError } = await supabase().auth.verifyOtp({ email: normalizeEmail(req.body.email), token: String(token), type: 'recovery' });
  if (verifyError || !data.session) return res.redirect(`/reset-password?status=invalid&email=${encodeURIComponent(normalizeEmail(req.body.email))}`);
  const { error } = await supabase(data.session.access_token).auth.updateUser({ password: String(password) });
  if (error) return res.redirect('/reset-password?status=invalid');
  res.redirect('/auth?mode=login&status=reset');
}

async function handleVerifyEmail(req, res) {
  const email = normalizeEmail(req.body.email);
  const token = String(req.body.token || '').trim();
  if (!isEmail(email) || !token) return res.redirect(`/verify-email?email=${encodeURIComponent(email)}&status=required`);
  const { data, error } = await supabase().auth.verifyOtp({ email, token, type: 'signup' });
  if (error || !data.session) return res.redirect(`/verify-email?email=${encodeURIComponent(email)}&status=invalid`);
  res.setHeader('Set-Cookie', sessionCookie(data.session));
  res.redirect('/profile?status=registered');
}

async function handleResendVerification(req, res) {
  const email = normalizeEmail(req.body.email);
  if (!isEmail(email)) return res.redirect('/verify-email?status=required');
  const { error } = await supabase().auth.resend({ type: 'signup', email });
  res.redirect(`/verify-email?email=${encodeURIComponent(email)}&status=${error ? 'error' : 'sent'}`);
}

async function handleProfileDetails(req, res) {
  const { first_name, last_name, birthdate, gender } = req.body;
  if (![first_name, last_name, birthdate, gender].every((value) => String(value || '').trim())) return res.redirect('/profile?status=required');
  const profile = { first_name: String(first_name).trim(), last_name: String(last_name).trim(), birthdate: String(birthdate), gender: String(gender) };
  const { error } = await supabase(req.user.accessToken).from('profiles').update(profile).eq('id', req.user.id);
  if (error) return res.redirect('/profile?status=required');
  await supabase(req.user.accessToken).auth.updateUser({ data: profile });
  res.redirect('/profile?status=details');
}

async function handleProfilePassword(req, res) {
  const { current_password, password, confirm_password } = req.body;
  const verify = await supabase().auth.signInWithPassword({ email: req.user.email, password: String(current_password || '') });
  if (verify.error) return res.redirect('/profile?status=current');
  if (String(password || '').length < 8 || password !== confirm_password) return res.redirect('/profile?status=mismatch');
  const { error } = await supabase(req.user.accessToken).auth.updateUser({ password: String(password) });
  res.redirect(`/profile?status=${error ? 'mismatch' : 'password'}`);
}

async function handlePortfolioSave(req, res) {
  const { id, title, caption, image_url, alt_text, sort_order } = req.body;
  if (![title, caption, image_url].every((value) => String(value || '').trim())) return res.redirect('/admin?status=portfolio-error');
  const values = { title: String(title).trim(), caption: String(caption).trim(), image_url: String(image_url).trim(), alt_text: String(alt_text || 'BFIMC portfolio image').trim(), sort_order: Number(sort_order) || 0 };
  const result = id
    ? await supabase(req.user.accessToken).from('portfolio_items').update(values).eq('id', id)
    : await supabase(req.user.accessToken).from('portfolio_items').insert(values);
  res.redirect(`/admin?status=${result.error ? 'portfolio-error' : 'portfolio-saved'}`);
}

async function handlePortfolioDelete(req, res) {
  const { error } = await supabase(req.user.accessToken).from('portfolio_items').delete().eq('id', req.params.id);
  res.redirect(`/admin?status=${error ? 'portfolio-error' : 'portfolio-deleted'}`);
}

async function handleAdminAdd(req, res) {
  const email = normalizeEmail(req.body.email);
  if (!isEmail(email)) return res.redirect('/admin?status=admin-error');
  const { error } = await supabase(req.user.accessToken).rpc('add_admin_by_email', { target_email: email });
  res.redirect(`/admin?status=${error ? 'admin-error' : 'admin-added'}`);
}

async function handleAdminDelete(req, res) {
  const { error } = await supabase(req.user.accessToken).rpc('remove_admin', { target_user_id: req.params.id });
  res.redirect(`/admin?status=${error ? 'admin-error' : 'admin-deleted'}`);
}

async function renderAdmin(res, user, status) {
  const [portfolioResult, messagesResult, adminsResult] = await Promise.all([
    supabaseRequest('/rest/v1/portfolio_items?select=*&order=sort_order.asc,id.asc', { token: user.accessToken }),
    supabaseRequest('/rest/v1/contact_messages?select=*&order=created_at.desc', { token: user.accessToken }),
    supabaseRequest('/rest/v1/admins?select=*&order=created_at.asc', { token: user.accessToken })
  ]);
  const messages = { 'portfolio-saved': 'Portfolio item saved.', 'portfolio-deleted': 'Portfolio item deleted.', 'portfolio-error': 'Unable to update the portfolio item.', 'admin-added': 'Administrator added.', 'admin-deleted': 'Administrator removed.', 'admin-error': 'Unable to update administrators.' };
  const notice = messages[status] ? `<div class="auth-alert ${status.endsWith('saved') || status.endsWith('added') || status.endsWith('deleted') ? 'success' : ''}">${messages[status]}</div>` : '';
  const portfolio = Array.isArray(portfolioResult.data) ? portfolioResult.data : [];
  const inbox = Array.isArray(messagesResult.data) ? messagesResult.data : [];
  const admins = Array.isArray(adminsResult.data) ? adminsResult.data : [];
  const portfolioRows = portfolio.map((item) => `<form class="admin-item" action="/admin/portfolio" method="post"><input type="hidden" name="id" value="${item.id}"><input name="title" value="${escapeHtml(item.title)}" required><input name="image_url" value="${escapeHtml(item.image_url)}" required><input name="alt_text" value="${escapeHtml(item.alt_text)}"><input name="sort_order" type="number" value="${item.sort_order}"><textarea name="caption" required>${escapeHtml(item.caption)}</textarea><button class="auth-submit" type="submit">Save</button><button class="admin-delete" formaction="/admin/portfolio/${item.id}/delete" formmethod="post" type="submit">Delete</button></form>`).join('') || '<p>No portfolio items found.</p>';
  const inboxRows = inbox.map((item) => `<article class="admin-message"><h3>${escapeHtml(item.subject)}</h3><p><strong>${escapeHtml(item.name)}</strong> · <a href="mailto:${escapeHtml(item.email)}">${escapeHtml(item.email)}</a></p><p>${escapeHtml(item.message)}</p><small>${new Date(item.created_at).toLocaleString()}</small></article>`).join('') || '<p>No contact messages yet.</p>';
  const adminRows = admins.map((admin) => `<li>${escapeHtml(admin.email)}${admin.user_id === user.id ? ' <em>(you)</em>' : `<form action="/admin/admins/${admin.user_id}/delete" method="post"><button class="admin-delete" type="submit">Remove</button></form>`}</li>`).join('');
  const content = `<main class="admin-page"><section class="admin-shell"><div class="admin-heading"><p class="section-kicker">Administration</p><h1>BFIMC Admin</h1><p>Manage portfolio stories, contact messages, and administrator access.</p><a href="/" class="forgot-link">View website</a></div>${notice}<section class="admin-section"><h2>Portfolio posts</h2><form class="admin-item admin-new" action="/admin/portfolio" method="post"><input name="title" placeholder="Title" required><input name="image_url" placeholder="Image path, e.g. /assets/img/portfolio/image-1.jpg" required><input name="alt_text" placeholder="Image description"><input name="sort_order" type="number" value="0"><textarea name="caption" placeholder="Caption" required></textarea><button class="auth-submit" type="submit">Add portfolio item</button></form><div class="admin-list">${portfolioRows}</div></section><section class="admin-section"><h2>Contact inbox</h2><div class="admin-inbox">${inboxRows}</div></section><section class="admin-section"><h2>Manage administrators</h2><form class="admin-add" action="/admin/admins" method="post"><input name="email" type="email" placeholder="Existing user email" required><button class="auth-submit" type="submit">Add administrator</button></form><ul class="admin-admins">${adminRows}</ul></section></section></main>`;
  res.type('html').send(`${header('BFIMC | Admin', user)}${content}${footer()}`);
}

async function portfolioFragment() {
  const { data } = await supabaseRequest('/rest/v1/portfolio_items?select=*&order=sort_order.asc,id.asc');
  if (!Array.isArray(data) || !data.length) return fragment('portfolio');
  const cards = data.map((item) => `<article class="col-lg-4 col-md-6 portfolio-item"><div class="portfolio-wrap"><a href="${escapeHtml(item.image_url)}" data-gallery="portfolioGallery" class="portfolio-image portfolio-lightbox" title="${escapeHtml(item.caption)}"><img src="${escapeHtml(item.image_url)}" class="img-fluid" alt="${escapeHtml(item.alt_text)}"><span class="portfolio-zoom"><i class="bi bi-arrows-angle-expand"></i></span></a><div class="portfolio-info"><h3>${escapeHtml(item.title)}</h3><p>${escapeHtml(item.caption)}</p></div></div></article>`).join('');
  return `<section id="portfolio" class="portfolio"><div class="navigation-background"></div><div class="container" data-aos="fade-up"><div class="section-title portfolio-heading"><h2>Our story</h2><p>Moments that bring BFIMC together</p><span>Celebrating the people, milestones, and shared purpose behind our cooperative.</span></div><div class="row g-4 portfolio-container" data-aos="fade-up" data-aos-delay="150">${cards}</div></div></section>`;
}

async function requireUser(req, res, next) {
  const user = await sessionUser(req, res); if (!user) return res.redirect('/auth?mode=login'); req.user = user; next();
}

async function requireAdmin(req, res, next) {
  const user = await sessionUser(req, res);
  if (!user) return res.redirect('/auth?mode=login');
  if (!user.isAdmin) return res.status(403).send('Admin access is required.');
  req.user = user; next();
}

function normalizeEmail(email) { return String(email).trim().toLowerCase(); }
function supabaseConfigured() { return Boolean(supabaseUrl && supabaseAnonKey); }
function supabase(accessToken) {
  return {
    auth: {
      signUp: async ({ email, password, options = {} }) => {
        const result = await supabaseRequest('/auth/v1/signup', { method: 'POST', body: { email, password, data: options.data, email_redirect_to: options.emailRedirectTo } });
        return { data: result.data ? { user: result.data, session: result.data.access_token ? result.data : null } : null, error: result.error };
      },
      signInWithPassword: async ({ email, password }) => {
        const result = await supabaseRequest('/auth/v1/token?grant_type=password', { method: 'POST', body: { email, password } });
        return { data: result.data ? { session: result.data, user: result.data.user } : null, error: result.error };
      },
      resetPasswordForEmail: async (email) => supabaseRequest('/auth/v1/recover', { method: 'POST', body: { email } }),
      verifyOtp: async ({ email, token, type }) => {
        const result = await supabaseRequest('/auth/v1/verify', { method: 'POST', body: { email, token, type } });
        return { data: result.data ? { session: result.data, user: result.data.user } : null, error: result.error };
      },
      resend: async ({ type, email }) => supabaseRequest('/auth/v1/resend', { method: 'POST', body: { type, email } }),
      getUser: async (token = accessToken) => {
        const result = await supabaseRequest('/auth/v1/user', { token });
        return { data: { user: result.data || null }, error: result.error };
      },
      updateUser: async (attributes) => supabaseRequest('/auth/v1/user', { method: 'PUT', token: accessToken, body: attributes }),
      refreshSession: async ({ refresh_token }) => {
        const result = await supabaseRequest('/auth/v1/token?grant_type=refresh_token', { method: 'POST', body: { refresh_token } });
        return { data: { session: result.data || null }, error: result.error };
      }
    },
    from: (table) => ({
      select: (columns) => ({
        eq: (column, value) => ({ maybeSingle: async () => {
          const result = await supabaseRequest(`/rest/v1/${table}?select=${encodeURIComponent(columns)}&${encodeURIComponent(column)}=eq.${encodeURIComponent(value)}`, { token: accessToken });
          return { ...result, data: Array.isArray(result.data) ? result.data[0] || null : result.data };
        } })
      }),
      update: (values) => ({
        eq: (column, value) => supabaseRequest(`/rest/v1/${table}?${encodeURIComponent(column)}=eq.${encodeURIComponent(value)}`, { method: 'PATCH', token: accessToken, body: values })
      }),
      insert: (values) => supabaseRequest(`/rest/v1/${table}`, { method: 'POST', token: accessToken, body: values }),
      delete: () => ({
        eq: (column, value) => supabaseRequest(`/rest/v1/${table}?${encodeURIComponent(column)}=eq.${encodeURIComponent(value)}`, { method: 'DELETE', token: accessToken })
      })
    }),
    rpc: (name, args) => supabaseRequest(`/rest/v1/rpc/${name}`, { method: 'POST', token: accessToken, body: args })
  };
}
async function supabaseRequest(endpoint, { method = 'GET', token, body } = {}) {
  if (!supabaseConfigured()) return { data: null, error: new Error('Supabase is not configured.') };
  try {
    const response = await fetch(`${supabaseUrl}${endpoint}`, {
      method,
      headers: { apikey: supabaseAnonKey, ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {})
    });
    const content = await response.text();
    const data = content ? JSON.parse(content) : null;
    return response.ok ? { data, error: null } : { data: null, error: new Error(data?.msg || data?.message || 'Supabase request failed.') };
  } catch (error) { return { data: null, error }; }
}
async function sessionUser(req, res) {
  if (!supabaseConfigured()) return null;
  const session = readSession(req); if (!session) return null;
  let activeSession = session;
  let client = supabase(activeSession.access_token);
  let { data: { user } } = await client.auth.getUser();
  if (!user && activeSession.refresh_token) {
    const { data } = await supabase().auth.refreshSession({ refresh_token: activeSession.refresh_token });
    if (!data.session) return null;
    activeSession = data.session; client = supabase(activeSession.access_token);
    ({ data: { user } } = await client.auth.getUser());
    if (user) res.setHeader('Set-Cookie', sessionCookie(activeSession));
  }
  if (!user) return null;
  const { data: profile } = await client.from('profiles').select('first_name,last_name,birthdate,gender').eq('id', user.id).maybeSingle();
  const { data: admin } = await client.from('admins').select('user_id').eq('user_id', user.id).maybeSingle();
  const metadata = user.user_metadata || {};
  return { id: user.id, email: user.email, firstName: profile?.first_name || metadata.first_name || '', lastName: profile?.last_name || metadata.last_name || '', birthdate: profile?.birthdate || metadata.birthdate || '', gender: profile?.gender || metadata.gender || '', isAdmin: Boolean(admin), accessToken: activeSession.access_token };
}
function parseCookies(req) { return Object.fromEntries(String(req.headers.cookie || '').split(';').map((item) => item.trim().split('=').map(decodeURIComponent)).filter((item) => item.length === 2)); }
function readSession(req) { const value = parseCookies(req).bfimc_session; if (!value) return null; const [payload, signature] = value.split('.'); const expected = crypto.createHmac('sha256', sessionSecret).update(payload).digest('base64url'); if (!signature || signature.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null; try { return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')); } catch { return null; } }
function cookieSecurityFlag() { return process.env.NODE_ENV === 'production' ? '; Secure' : ''; }
function sessionCookie(session) { const payload = Buffer.from(JSON.stringify({ access_token: session.access_token, refresh_token: session.refresh_token })).toString('base64url'); const signature = crypto.createHmac('sha256', sessionSecret).update(payload).digest('base64url'); return `bfimc_session=${payload}.${signature}; Path=/; HttpOnly; SameSite=Lax; Max-Age=604800${cookieSecurityFlag()}`; }
function clearSessionCookie() { return `bfimc_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${cookieSecurityFlag()}`; }
function smtpConfigured() { return ['SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASS', 'MAIL_FROM'].every((key) => process.env[key]); }
async function sendResetEmail(to, resetLink) { const transporter = nodemailer.createTransport({ host: process.env.SMTP_HOST, port: Number(process.env.SMTP_PORT), secure: process.env.SMTP_SECURE === 'true', auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } }); await transporter.sendMail({ from: process.env.MAIL_FROM, to, subject: 'BFIMC password reset', text: `Reset your BFIMC password within one hour: ${resetLink}` }); }

function fragment(name) {
  const source = fs.readFileSync(path.join(pagesDirectory, `${name}.html`), 'utf8');
  return source
    .replace('action="#"', 'action="/contact"')
    .replaceAll('action="forms/membership.php"', 'action="/membership-application"')
    .replaceAll('action="forms/loan.php"', 'action="/loan-application"')
    .replaceAll('href="?loan_form"', 'href="/loan-form"')
    .replaceAll('href="?membership_form"', 'href="/membership-form"')
    .replaceAll('href="?services"', 'href="/services"');
}

function isEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function label(value) {
  return value.replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
}

function loadEnv(file) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, '');
  }
}

module.exports = app;
