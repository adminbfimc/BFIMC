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
  app.get(url, async (req, res) => {
    const user = await sessionUser(req, res);
    if (user?.isAdmin) return res.redirect('/admin');
    if (user?.isStaff) return res.redirect('/staff/content');
    renderPage(res, page, req.query.status, user);
  });
}

app.get('/auth', async (req, res) => {
  const user = await sessionUser(req, res);
  if (user) return res.redirect(user.isAdmin ? '/admin' : user.isStaff ? '/staff/content' : '/');
  renderAuth(res, req.query.mode, req.query.status);
});
app.get('/forgot-password', (req, res) => renderForgotPassword(res, req.query.status));
app.get('/reset-password', (req, res) => renderResetPassword(res, req.query.token, req.query.status));
app.get('/verify-email', (req, res) => renderVerifyEmail(res, req.query.email, req.query.status));
app.get('/auth/callback', (req, res) => renderAuthCallback(res));
app.get('/profile', requireUser, (req, res) => {
  if (req.user.isAdmin || req.user.isStaff) return res.redirect('/account');
  renderProfile(res, req.user, req.query.status);
});
app.get('/account', requireUser, (req, res) => renderRoleProfile(res, req.user, req.query.status));
app.get('/admin', requireAdmin, async (req, res) => renderAdmin(res, req.user, req.query.status));
app.get('/admin/content', requireAdmin, async (req, res) => renderAdmin(res, req.user, req.query.status, 'content'));
app.get('/admin/inbox', requireAdmin, async (req, res) => renderAdmin(res, req.user, req.query.status, 'inbox'));
app.get('/admin/accounts', requireAdmin, async (req, res) => renderAdmin(res, req.user, req.query.status, 'accounts'));
app.get('/admin/users', requireAdmin, async (req, res) => renderAdmin(res, req.user, req.query.status, 'users'));
app.get('/admin/affiliates', requireAdmin, async (req, res) => renderAdmin(res, req.user, req.query.status, 'affiliates'));
app.get('/admin/staff', requireAdmin, (req, res) => res.redirect('/admin/accounts'));
app.get('/staff', requireStaff, (req, res) => res.redirect('/staff/content'));
app.get('/staff/content', requireStaff, async (req, res) => renderAdmin(res, req.user, req.query.status, 'content', true));
app.get('/staff/inbox', requireStaff, async (req, res) => renderAdmin(res, req.user, req.query.status, 'inbox', true));

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
app.post('/admin/portfolio', requireStaff, express.raw({ type: 'multipart/form-data', limit: '5mb' }), parsePortfolioUpload, handlePortfolioSave);
app.post('/admin/portfolio/:id/delete', requireStaff, handlePortfolioDelete);
app.post('/admin/affiliates', requireAdmin, express.raw({ type: 'multipart/form-data', limit: '5mb' }), parsePortfolioUpload, handleAffiliateSave);
app.post('/admin/affiliates/:id/delete', requireAdmin, handleAffiliateDelete);
app.get('/api/affiliates', async (req, res) => {
  const { data, error } = await supabaseRequest('/rest/v1/affiliates?select=id,company_name,logo_url&order=created_at.asc');
  if (error) return res.status(503).json({ error: 'Affiliates are temporarily unavailable.' });
  res.json({ affiliates: Array.isArray(data) ? data : [], count: Array.isArray(data) ? data.length : 0 });
});
app.post('/admin/admins', requireAdmin, handleAdminAdd);
app.post('/admin/admins/:id/delete', requireAdmin, handleAdminDelete);
app.post('/admin/users/:id/delete', requireAdmin, handleUserAccountDelete);
app.post('/admin/staff', requireAdmin, handleStaffCreate);
app.post('/admin/staff/:id/delete', requireAdmin, handleStaffDelete);
app.post('/profile/details', requireUser, handleProfileDetails);
app.post('/profile/password', requireUser, handleProfilePassword);
app.post('/account/name', requireUser, handleRoleNameUpdate);
app.post('/account/password', requireUser, handleRolePasswordUpdate);

app.use((req, res) => res.status(404).send('Page not found.'));

if (require.main === module) {
  app.listen(port, () => {
    console.log(`BFIMC Node site is running at http://localhost:${port}`);
  });
}

async function renderPage(res, { page, title }, status, user) {
  const message = status === 'sent'
    ? '<div class="container pt-5 mt-5"><div class="alert alert-success">Your submission has been sent successfully.</div></div>'
    : status === 'error'
      ? '<div class="container pt-5 mt-5"><div class="alert alert-danger">We could not send your submission. Please try again later.</div></div>'
      : '';

  const content = page === 'portfolio' ? await portfolioFragment() : fragment(page);
  res.type('html').send(`${header(title, user)}${message}${content}${footer()}`);
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

function renderRoleProfile(res, user, status) {
  const messages = { details: 'Your name has been updated.', password: 'Your password has been updated.', current: 'Your current password is incorrect.', mismatch: 'Use a matching password with at least 8 characters.', required: 'Enter both your first and last name.' };
  const notice = messages[status] ? `<div class="auth-alert ${['details', 'password'].includes(status) ? 'success' : ''}">${messages[status]}</div>` : '';
  const role = user.isAdmin ? 'Administrator' : 'Staff';
  const content = `<main class="role-profile-page"><section class="role-profile-shell"><div class="role-profile-heading"><p class="section-kicker">${role} profile</p><h1>My account</h1><p>Manage your name and password.</p></div>${notice}<section class="role-profile-card"><div class="role-profile-email"><span class="admin-avatar">${escapeHtml((user.firstName || user.email).charAt(0).toUpperCase())}</span><div><strong>${escapeHtml(user.email)}</strong><small>${role}</small></div></div><form class="profile-form" action="/account/name" method="post"><h2>Personal details</h2><div class="auth-grid"><label>First name<input name="first_name" value="${escapeHtml(user.firstName)}" required></label><label>Last name<input name="last_name" value="${escapeHtml(user.lastName)}" required></label></div><button class="auth-submit" type="submit">Save name</button></form><form class="profile-form role-password-form" action="/account/password" method="post"><h2>Change password</h2><label>Current password<input name="current_password" type="password" autocomplete="current-password" required></label><div class="auth-grid"><label>New password<input name="password" type="password" minlength="8" autocomplete="new-password" required></label><label>Confirm new password<input name="confirm_password" type="password" minlength="8" autocomplete="new-password" required></label></div><button class="auth-submit" type="submit">Update password</button><a class="forgot-link" href="/forgot-password">Forgot password?</a></form></section></section></main>`;
  res.type('html').send(adminDocument(content));
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
  res.redirect('/');
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
  if (admin) return res.redirect('/admin');
  const { data: staff } = await supabase(data.session.access_token).from('staff').select('user_id').eq('user_id', data.user.id).maybeSingle();
  res.redirect(staff ? '/staff/content' : '/');
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
  res.redirect('/');
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

async function handleRoleNameUpdate(req, res) {
  const first_name = String(req.body.first_name || '').trim();
  const last_name = String(req.body.last_name || '').trim();
  if (!first_name || !last_name) return res.redirect('/account?status=required');
  const profile = { first_name, last_name };
  const { error } = await supabase(req.user.accessToken).from('profiles').update(profile).eq('id', req.user.id);
  if (!error) await supabase(req.user.accessToken).auth.updateUser({ data: profile });
  res.redirect(`/account?status=${error ? 'required' : 'details'}`);
}

async function handleRolePasswordUpdate(req, res) {
  const { current_password, password, confirm_password } = req.body;
  const verify = await supabase().auth.signInWithPassword({ email: req.user.email, password: String(current_password || '') });
  if (verify.error) return res.redirect('/account?status=current');
  if (String(password || '').length < 8 || password !== confirm_password) return res.redirect('/account?status=mismatch');
  const { error } = await supabase(req.user.accessToken).auth.updateUser({ password: String(password) });
  res.redirect(`/account?status=${error ? 'mismatch' : 'password'}`);
}

async function handlePortfolioSave(req, res) {
  if (req.uploadError) return res.redirect('/admin/content?status=portfolio-error');
  const { id, title, caption, image_url, alt_text, sort_order } = req.body;
  let finalImageUrl = String(image_url || '').trim();
  if (req.file) {
    const uploadResult = await uploadPortfolioImage(req.file, req.user.accessToken);
    if (uploadResult.error) return res.redirect('/admin/content?status=portfolio-error');
    finalImageUrl = uploadResult.url;
  }
  if (![title, caption, finalImageUrl].every((value) => String(value || '').trim())) return res.redirect('/admin/content?status=portfolio-error');
  const values = { title: String(title).trim(), caption: String(caption).trim(), image_url: finalImageUrl, alt_text: String(alt_text || 'BFIMC portfolio image').trim(), sort_order: Number(sort_order) || 0 };
  const result = id
    ? await supabase(req.user.accessToken).from('portfolio_items').update(values).eq('id', id)
    : await supabase(req.user.accessToken).from('portfolio_items').insert(values);
  res.redirect(`/admin/content?status=${result.error ? 'portfolio-error' : 'portfolio-saved'}`);
}

function parsePortfolioUpload(req, res, next) {
  if (!Buffer.isBuffer(req.body)) return next();
  const boundary = /boundary=(?:"([^"]+)"|([^;\s]+))/i.exec(req.headers['content-type'] || '')?.[1] || /boundary=(?:"([^"]+)"|([^;\s]+))/i.exec(req.headers['content-type'] || '')?.[2];
  if (!boundary) { req.uploadError = 'Invalid upload form.'; return next(); }
  const fields = {};
  let image;
  for (const rawPart of req.body.toString('latin1').split(`--${boundary}`)) {
    const divider = rawPart.indexOf('\r\n\r\n');
    if (divider < 0) continue;
    const headers = rawPart.slice(0, divider);
    let value = rawPart.slice(divider + 4);
    if (value.endsWith('\r\n')) value = value.slice(0, -2);
    const name = /name="([^"]+)"/i.exec(headers)?.[1];
    if (!name) continue;
    const filename = /filename="([^"]*)"/i.exec(headers)?.[1];
    if (filename !== undefined && filename) {
      const mimetype = /content-type:\s*([^\r\n]+)/i.exec(headers)?.[1]?.trim().toLowerCase();
      if (!['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(mimetype)) { req.uploadError = 'Only JPEG, PNG, WebP, and GIF images are allowed.'; return next(); }
      image = { mimetype, buffer: Buffer.from(value, 'latin1') };
    } else fields[name] = Buffer.from(value, 'latin1').toString('utf8');
  }
  req.body = fields;
  req.file = image;
  next();
}

async function uploadPortfolioImage(file, accessToken) {
  const extension = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' }[file.mimetype];
  if (!extension) return { error: new Error('Only JPEG, PNG, WebP, and GIF images are allowed.') };
  const objectPath = `${crypto.randomUUID()}.${extension}`;
  try {
    const response = await fetch(`${supabaseUrl}/storage/v1/object/bfimc-content/${objectPath}`, {
      method: 'POST',
      headers: { apikey: supabaseAnonKey, Authorization: `Bearer ${accessToken}`, 'Content-Type': file.mimetype, 'x-upsert': 'false' },
      body: file.buffer
    });
    if (!response.ok) return { error: new Error('Image upload failed.') };
    return { url: `${supabaseUrl}/storage/v1/object/public/bfimc-content/${objectPath}`, error: null };
  } catch (error) { return { error }; }
}

async function handlePortfolioDelete(req, res) {
  const { error } = await supabase(req.user.accessToken).from('portfolio_items').delete().eq('id', req.params.id);
  res.redirect(`/admin/content?status=${error ? 'portfolio-error' : 'portfolio-deleted'}`);
}

async function handleAffiliateSave(req, res) {
  const companyName = String(req.body.company_name || '').trim().replace(/\s+/g, ' ');
  if (req.uploadError || !companyName || companyName.length > 160 || !req.file) return affiliateResponse(req, res, null, req.uploadError || 'Please provide a company name and an image.');
  const uploadResult = await uploadPortfolioImage(req.file, req.user.accessToken);
  if (uploadResult.error) return affiliateResponse(req, res, null, 'Unable to upload the affiliate image.');
  const { data, error } = await supabaseRequest('/rest/v1/affiliates', {
    method: 'POST', token: req.user.accessToken,
    body: { company_name: companyName, logo_url: uploadResult.url }
  });
  if (error) return affiliateResponse(req, res, null, 'Unable to save the affiliate.');
  affiliateResponse(req, res, Array.isArray(data) ? data[0] : data || { company_name: companyName }, null, 201);
}

async function handleAffiliateDelete(req, res) {
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id) || id < 1) return affiliateResponse(req, res, null, 'Invalid affiliate.');
  const { error } = await supabase(req.user.accessToken).from('affiliates').delete().eq('id', id);
  if (error) return affiliateResponse(req, res, null, 'Unable to remove the affiliate.');
  affiliateResponse(req, res, { id }, null);
}

async function affiliateResponse(req, res, affiliate, error, successStatus = 200) {
  if (req.accepts('json')) {
    if (error) return res.status(400).json({ error });
    const result = await supabaseRequest('/rest/v1/affiliates?select=id,company_name,logo_url,created_at&order=created_at.asc', { token: req.user.accessToken });
    return res.status(successStatus).json({ affiliate, affiliates: Array.isArray(result.data) ? result.data : [], count: Array.isArray(result.data) ? result.data.length : 0 });
  }
  res.redirect(`/admin/affiliates?status=${error ? 'affiliate-error' : successStatus === 201 ? 'affiliate-added' : 'affiliate-deleted'}`);
}

async function handleAdminAdd(req, res) {
  const email = normalizeEmail(req.body.email);
  if (!isEmail(email)) return res.redirect('/admin/accounts?status=admin-error');
  const { error } = await supabase(req.user.accessToken).rpc('add_admin_by_email', { target_email: email });
  res.redirect(`/admin/accounts?status=${error ? 'admin-error' : 'admin-added'}`);
}

async function handleAdminDelete(req, res) {
  const { error } = await supabase(req.user.accessToken).rpc('remove_admin', { target_user_id: req.params.id });
  res.redirect(`/admin/accounts?status=${error ? 'admin-error' : 'admin-deleted'}`);
}

async function handleUserAccountDelete(req, res) {
  const { error } = await supabase(req.user.accessToken).rpc('delete_user_account', { target_user_id: req.params.id });
  res.redirect(`/admin/users?status=${error ? 'user-error' : 'user-deleted'}`);
}

async function handleStaffCreate(req, res) {
  const fullName = String(req.body.full_name || '').trim();
  const email = normalizeEmail(req.body.email);
  const password = String(req.body.password || '');
  if (!fullName || !isEmail(email) || password.length < 8 || password !== String(req.body.confirm_password || '')) return res.redirect('/admin/accounts?status=staff-error');
  const [firstName, ...lastName] = fullName.split(/\s+/);
  const { data, error: signupError } = await supabase().auth.signUp({ email, password, options: { data: { first_name: firstName, last_name: lastName.join(' ') } } });
  if (signupError || !data?.user) return res.redirect('/admin/accounts?status=staff-error');
  const { error } = await supabase(req.user.accessToken).rpc('add_staff_by_email', { target_email: email });
  res.redirect(`/admin/accounts?status=${error ? 'staff-error' : 'staff-added'}`);
}

async function handleStaffDelete(req, res) {
  const { error } = await supabase(req.user.accessToken).rpc('remove_staff', { target_user_id: req.params.id });
  res.redirect(`/admin/accounts?status=${error ? 'staff-error' : 'staff-deleted'}`);
}

async function renderAdmin(res, user, status, section = 'home', staffMode = false) {
  const [portfolioResult, inboxResult, adminsResult, usersResult, staffResult, affiliatesResult] = await Promise.all([
    supabaseRequest('/rest/v1/portfolio_items?select=*&order=sort_order.asc,id.asc', { token: user.accessToken }),
    supabaseRequest('/rest/v1/contact_messages?select=*&order=created_at.desc', { token: user.accessToken }),
    supabaseRequest('/rest/v1/admins?select=*&order=created_at.asc', { token: user.accessToken }),
    supabase(user.accessToken).rpc('list_user_accounts', {}),
    supabaseRequest('/rest/v1/staff?select=*&order=created_at.asc', { token: user.accessToken }),
    supabaseRequest('/rest/v1/affiliates?select=*&order=created_at.asc', { token: user.accessToken })
  ]);
  const portfolio = Array.isArray(portfolioResult.data) ? portfolioResult.data : [];
  const inbox = Array.isArray(inboxResult.data) ? inboxResult.data : [];
  const admins = Array.isArray(adminsResult.data) ? adminsResult.data : [];
  const users = Array.isArray(usersResult.data) ? usersResult.data : [];
  const staff = Array.isArray(staffResult.data) ? staffResult.data : [];
  const affiliates = Array.isArray(affiliatesResult.data) ? affiliatesResult.data : [];
  const messages = { 'portfolio-saved': 'Content saved.', 'portfolio-deleted': 'Content deleted.', 'portfolio-error': 'Unable to update content.', 'affiliate-added': 'Affiliate added.', 'affiliate-deleted': 'Affiliate removed.', 'affiliate-error': 'Unable to update affiliates.', 'admin-added': 'Administrator added.', 'admin-deleted': 'Administrator removed.', 'admin-error': 'Unable to update administrators.', 'staff-added': 'Staff account added.', 'staff-deleted': 'Staff account removed.', 'staff-error': 'Unable to update staff accounts.', 'user-deleted': 'User account deleted.', 'user-error': 'Unable to delete this user account.' };
  const notice = messages[status] ? `<div class="auth-alert ${status.endsWith('saved') || status.endsWith('added') || status.endsWith('deleted') ? 'success' : ''}">${messages[status]}</div>` : '';
  const counts = { content: portfolio.length, inbox: inbox.length, accounts: admins.length, users: users.length, staff: staff.length, affiliates: affiliates.length };
  const cards = portfolio.map((item) => `<article class="admin-content-card"><img src="${escapeHtml(item.image_url)}" alt="${escapeHtml(item.alt_text)}"><div class="admin-content-card-body"><div class="admin-content-card-meta"><span><i class="bi bi-images"></i> Portfolio post</span><span class="admin-status"><i class="bi bi-check-circle-fill"></i> Published</span></div><h3>${escapeHtml(item.title)}</h3><p>${escapeHtml(item.caption)}</p><small>Added ${new Date(item.created_at).toLocaleDateString()}</small><details class="admin-editor"><summary><i class="bi bi-pencil"></i> Edit content</summary><form class="admin-item" action="/admin/portfolio" method="post"><input type="hidden" name="id" value="${item.id}"><label>Title<input name="title" value="${escapeHtml(item.title)}" required></label><label>Image URL<input name="image_url" value="${escapeHtml(item.image_url)}" required></label><label>Image description<input name="alt_text" value="${escapeHtml(item.alt_text)}"></label><label>Display order<input name="sort_order" type="number" value="${item.sort_order}"><small>Lower numbers appear first.</small></label><label class="admin-field-wide">Description<textarea name="caption" required>${escapeHtml(item.caption)}</textarea></label><div class="admin-edit-actions"><button class="auth-submit" type="submit">Save changes</button><button class="admin-delete" formaction="/admin/portfolio/${item.id}/delete" formmethod="post" type="submit">Delete</button></div></form></details></div></article>`).join('') || '<p class="admin-empty">No content posts found.</p>';
  const inboxRows = inbox.map((item) => `<article class="admin-message"><h3>${escapeHtml(item.subject)}</h3><p><strong>${escapeHtml(item.name)}</strong> · <a href="mailto:${escapeHtml(item.email)}">${escapeHtml(item.email)}</a></p><p>${escapeHtml(item.message)}</p><small>${new Date(item.created_at).toLocaleString()}</small></article>`).join('') || '<p class="admin-empty">No contact messages yet.</p>';
  const adminRows = admins.map((admin) => `<li>${escapeHtml(admin.email)}${admin.user_id === user.id ? ' <em>(you)</em>' : `<form action="/admin/admins/${admin.user_id}/delete" method="post"><button class="admin-delete" type="submit">Remove</button></form>`}</li>`).join('');
  const staffRows = staff.map((member) => `<li>${escapeHtml(member.email)}<form action="/admin/staff/${member.user_id}/delete" method="post"><button class="admin-delete" type="submit">Remove</button></form></li>`).join('') || '<li class="admin-empty">No staff accounts yet.</li>';
  const userRows = users.map((account) => `<article class="admin-user-row"><span class="admin-avatar">${escapeHtml((account.first_name || account.email || '?').charAt(0).toUpperCase())}</span><div><h3>${escapeHtml(`${account.first_name || ''} ${account.last_name || ''}`.trim() || 'No name provided')}</h3><p>${escapeHtml(account.email)}${account.is_admin ? ' <span class="admin-role">Administrator</span>' : ''}</p><small>Joined ${new Date(account.created_at).toLocaleDateString()}</small></div>${account.user_id === user.id ? '<em class="admin-current-user">Current account</em>' : `<form action="/admin/users/${account.user_id}/delete" method="post"><button class="admin-delete" type="submit"><i class="bi bi-trash"></i> Delete account</button></form>`}</article>`).join('') || '<p class="admin-empty">No user accounts found.</p>';
  const affiliateRows = affiliates.map((affiliate) => `<article class="admin-affiliate-row" data-affiliate-id="${affiliate.id}"><img src="${escapeHtml(affiliate.logo_url)}" alt="${escapeHtml(affiliate.company_name)} logo"><strong>${escapeHtml(affiliate.company_name)}</strong><button class="admin-delete" data-affiliate-delete="${affiliate.id}" type="button"><i class="bi bi-trash"></i> Remove</button></article>`).join('') || '<p class="admin-empty" data-affiliate-empty>No affiliates yet.</p>';
  const pages = {
    home: `<section class="admin-heading"><h1>Dashboard overview</h1><p>A brief view of BFIMC administration.</p></section><section class="admin-stats admin-summary" aria-label="Dashboard totals"><a href="/admin/content"><span class="stat-icon blue"><i class="bi bi-images"></i></span><div><strong>${counts.content}</strong><small>Total content posts</small><em>Manage content <i class="bi bi-arrow-right"></i></em></div></a><a href="/admin/inbox"><span class="stat-icon orange"><i class="bi bi-envelope"></i></span><div><strong>${counts.inbox}</strong><small>Contact messages</small><em>Open inbox <i class="bi bi-arrow-right"></i></em></div></a><a href="/admin/users"><span class="stat-icon green"><i class="bi bi-people"></i></span><div><strong>${counts.users}</strong><small>User accounts</small><em>Manage accounts <i class="bi bi-arrow-right"></i></em></div></a><a href="/admin/accounts"><span class="stat-icon blue"><i class="bi bi-shield-check"></i></span><div><strong>${counts.accounts}</strong><small>Administrator accounts</small><em>Manage access <i class="bi bi-arrow-right"></i></em></div></a></section>`,
    content: `<section class="admin-heading"><p class="section-kicker">Website content</p><h1>Content manager</h1><p>Create and edit portfolio posts with an image and description.</p></section>${notice}<details class="admin-create"><summary><i class="bi bi-plus-lg"></i> Create content</summary><form class="admin-item admin-new" action="/admin/portfolio" method="post"><label>Title<input name="title" placeholder="e.g. Community outreach" required></label><label>Image URL<input name="image_url" placeholder="/assets/img/portfolio/image.jpg" required></label><label>Image description<input name="alt_text" placeholder="Describe the image"></label><label>Display order<input name="sort_order" type="number" value="0"><small>Lower numbers appear first.</small></label><label class="admin-field-wide">Description<textarea name="caption" placeholder="Write a short description" required></textarea></label><button class="auth-submit" type="submit"><i class="bi bi-check-lg"></i> Save content</button></form></details><div class="admin-content-grid">${cards}</div>`,
    affiliates: `<section class="admin-heading"><p class="section-kicker">Partner network</p><h1>Affiliate management</h1><p>Add or remove affiliates shown in the public BFI MPC partner gallery.</p></section><div class="admin-affiliate-notice" aria-live="polite"></div><section class="admin-section admin-page-section"><div class="admin-section-heading"><h2>Current affiliates</h2><span data-affiliate-count>${counts.affiliates} total</span></div><form class="admin-affiliate-form" data-affiliate-form action="/admin/affiliates" method="post" enctype="multipart/form-data"><label>Company name<input name="company_name" maxlength="160" required></label><label>Company logo or image<input name="image" type="file" accept="image/jpeg,image/png,image/webp,image/gif" required></label><button class="auth-submit" type="submit"><i class="bi bi-plus-lg"></i> Add affiliate</button></form><div class="admin-affiliate-list" data-affiliate-list>${affiliateRows}</div></section>`,
    inbox: `<section class="admin-heading"><p class="section-kicker">Messages</p><h1>Contact inbox</h1><p>Messages submitted through the BFIMC contact form.</p></section><section class="admin-section admin-page-section"><div class="admin-section-heading"><h2>All messages</h2><span>${counts.inbox} total</span></div><div class="admin-inbox">${inboxRows}</div></section>`,
    accounts: `<section class="admin-heading"><p class="section-kicker">Access control</p><h1>Admin accounts</h1><p>Manage administrator and staff access.</p></section>${notice}<section class="admin-section admin-page-section"><div class="admin-section-heading"><h2>Administrators</h2></div><form class="admin-add" action="/admin/admins" method="post"><input name="email" type="email" placeholder="Existing user email" required><button class="auth-submit" type="submit"><i class="bi bi-person-plus"></i> Add administrator</button></form><ul class="admin-admins">${adminRows}</ul></section><section class="admin-section"><div class="admin-section-heading"><div><p class="section-kicker">Restricted access</p><h2>Staff account management</h2></div><button class="auth-submit" type="button" data-open-staff-modal><i class="bi bi-person-plus"></i> Add staff account</button></div><p class="admin-section-description">Staff can access only Content Manager and Contact Inbox.</p><ul class="admin-admins">${staffRows}</ul></section><div class="admin-modal" data-staff-modal hidden><div class="admin-modal-backdrop" data-close-staff-modal></div><section class="admin-modal-card" role="dialog" aria-modal="true"><button class="admin-modal-close" type="button" data-close-staff-modal><i class="bi bi-x-lg"></i></button><h2>Add Staff Account</h2><p>Create a BFIMC staff login with restricted dashboard access.</p><form class="admin-modal-form" action="/admin/staff" method="post"><label>Full name<input name="full_name" placeholder="e.g. Maria Santos" required></label><label>Position<select disabled><option>Staff</option></select><small>Staff can manage content and view contact messages only.</small></label><label>Email<input name="email" type="email" placeholder="staff@bfimc.com" required></label><div class="auth-grid"><label>Password<input name="password" type="password" minlength="8" placeholder="At least 8 characters" required></label><label>Confirm password<input name="confirm_password" type="password" minlength="8" placeholder="Repeat password" required></label></div><div class="admin-modal-actions"><button class="admin-modal-cancel" type="button" data-close-staff-modal>Cancel</button><button class="auth-submit" type="submit">Create</button></div></form></section></div>`,
    staff: `<section class="admin-heading"><p class="section-kicker">Staff access</p><h1>Staff accounts</h1><p>Staff can access only Content Manager and Contact Inbox.</p></section>${notice}<section class="admin-section admin-page-section"><form class="admin-add" action="/admin/staff" method="post"><input name="email" type="email" placeholder="Existing user email" required><button class="auth-submit" type="submit"><i class="bi bi-person-plus"></i> Add staff member</button></form><ul class="admin-admins">${staffRows}</ul></section>`,
    users: `<section class="admin-heading"><p class="section-kicker">Account management</p><h1>User accounts</h1><p>View registered BFIMC accounts and remove accounts when necessary.</p></section>${notice}<section class="admin-section admin-page-section"><div class="admin-section-heading"><h2>All registered users</h2><span>${counts.users} total</span></div><div class="admin-user-list">${userRows}</div></section>`
  };
  pages.home = `<section class="admin-heading"><h1>Dashboard overview</h1><p>A brief view of BFIMC administration.</p></section><section class="admin-stats admin-summary" aria-label="Dashboard totals"><a href="/admin/content"><span class="stat-icon blue"><i class="bi bi-images"></i></span><div><strong>${counts.content}</strong><small>Total content posts</small><em>Manage content <i class="bi bi-arrow-right"></i></em></div></a><a href="/admin/affiliates"><span class="stat-icon orange"><i class="bi bi-people"></i></span><div><strong>${counts.affiliates}</strong><small>Affiliate partners</small><em>Manage partners <i class="bi bi-arrow-right"></i></em></div></a><a href="/admin/users"><span class="stat-icon green"><i class="bi bi-people"></i></span><div><strong>${counts.users}</strong><small>User accounts</small><em>Manage accounts <i class="bi bi-arrow-right"></i></em></div></a><a href="/admin/staff"><span class="stat-icon blue"><i class="bi bi-person-workspace"></i></span><div><strong>${counts.staff}</strong><small>Staff accounts</small><em>Manage staff <i class="bi bi-arrow-right"></i></em></div></a></section>`;
  const active = ['home', 'content', 'inbox', 'accounts', 'users', 'staff', 'affiliates'].includes(section) ? section : 'home';
  const allowedActive = staffMode && !['content', 'inbox'].includes(active) ? 'content' : active;
  res.type('html').send(adminDocument(adminFrame(user, allowedActive, `${allowedActive !== 'home' ? '' : notice}${pages[allowedActive]}`, staffMode)));
}

function adminFrame(user, active, page, staffMode = false) {
  const initials = escapeHtml((user.firstName || user.email).trim().charAt(0).toUpperCase());
  const nav = (key, href, icon, label) => `<a class="${active === key ? 'active' : ''}" href="${href}"><i class="bi bi-${icon}"></i> ${label}</a>`;
  const navigation = staffMode ? `${nav('content', '/staff/content', 'upload', 'Content manager')}${nav('inbox', '/staff/inbox', 'inbox', 'Contact inbox')}${nav('profile', '/account', 'person-circle', 'My profile')}` : `${nav('home', '/admin', 'house', 'Home')}${nav('content', '/admin/content', 'upload', 'Content manager')}${nav('affiliates', '/admin/affiliates', 'people', 'Affiliate partners')}${nav('inbox', '/admin/inbox', 'inbox', 'Contact inbox')}${nav('users', '/admin/users', 'people', 'Account manager')}${nav('accounts', '/admin/accounts', 'shield-check', 'Admin accounts')}${nav('profile', '/account', 'person-circle', 'My profile')}`;
  return `<main class="admin-page"><aside class="admin-sidebar"><a class="admin-brand" href="${staffMode ? '/staff/content' : '/admin'}"><span class="admin-brand-mark"><i class="bi bi-shield-check"></i></span><span><strong>BFIMC</strong><small>${staffMode ? 'Staff portal' : 'Administration'}</small></span></a><nav class="admin-nav" aria-label="Admin navigation">${navigation}</nav><form class="admin-logout" action="/logout" method="post"><button type="submit"><i class="bi bi-box-arrow-right"></i> Log out</button></form></aside><section class="admin-workspace"><header class="admin-topbar"><button class="admin-menu-toggle" type="button" aria-label="Open navigation"><i class="bi bi-list"></i></button><div class="admin-user"><span class="admin-avatar">${initials}</span><span><strong>${escapeHtml(user.firstName || 'Staff')}</strong><small>${staffMode ? 'Staff' : 'Administrator'}</small></span></div></header><div class="admin-content">${page}</div></section></main>`;
}

async function renderAdminLegacy(res, user, status, section = 'home') {
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
  const portfolioRows = portfolio.map((item) => `<article class="admin-content-card"><img src="${escapeHtml(item.image_url)}" alt="${escapeHtml(item.alt_text)}"><div class="admin-content-card-body"><div class="admin-content-card-meta"><span><i class="bi bi-images"></i> Portfolio post</span><span class="admin-status"><i class="bi bi-check-circle-fill"></i> Published</span></div><h3>${escapeHtml(item.title)}</h3><p>${escapeHtml(item.caption)}</p><small>Added ${new Date(item.created_at).toLocaleDateString()}</small><details class="admin-editor"><summary><i class="bi bi-pencil"></i> Edit content</summary><form class="admin-item" action="/admin/portfolio" method="post"><input type="hidden" name="id" value="${item.id}"><label>Title<input name="title" value="${escapeHtml(item.title)}" required></label><label>Image URL<input name="image_url" value="${escapeHtml(item.image_url)}" required></label><label>Image description<input name="alt_text" value="${escapeHtml(item.alt_text)}"></label><label>Display order<input name="sort_order" type="number" value="${item.sort_order}"><small>Lower numbers appear first.</small></label><label class="admin-field-wide">Description<textarea name="caption" required>${escapeHtml(item.caption)}</textarea></label><div class="admin-edit-actions"><button class="auth-submit" type="submit">Save changes</button><button class="admin-delete" formaction="/admin/portfolio/${item.id}/delete" formmethod="post" type="submit">Delete</button></div></form></details></div></article>`).join('') || '<p class="admin-empty">No portfolio items found.</p>';
  const inboxRows = inbox.map((item) => `<article class="admin-message"><h3>${escapeHtml(item.subject)}</h3><p><strong>${escapeHtml(item.name)}</strong> · <a href="mailto:${escapeHtml(item.email)}">${escapeHtml(item.email)}</a></p><p>${escapeHtml(item.message)}</p><small>${new Date(item.created_at).toLocaleString()}</small></article>`).join('') || '<p class="admin-empty">No contact messages yet.</p>';
  const adminRows = admins.map((admin) => `<li>${escapeHtml(admin.email)}${admin.user_id === user.id ? ' <em>(you)</em>' : `<form action="/admin/admins/${admin.user_id}/delete" method="post"><button class="admin-delete" type="submit">Remove</button></form>`}</li>`).join('');
  const initials = escapeHtml((user.firstName || user.email).trim().charAt(0).toUpperCase());
  const content = `<main class="admin-page"><aside class="admin-sidebar"><a class="admin-brand" href="/admin"><span class="admin-brand-mark"><i class="bi bi-shield-check"></i></span><span><strong>BFIMC</strong><small>Administration</small></span></a><nav class="admin-nav" aria-label="Admin navigation"><a class="active" href="#overview"><i class="bi bi-house"></i> Home</a><a href="#portfolio"><i class="bi bi-upload"></i> Content manager</a><a href="#inbox"><i class="bi bi-inbox"></i> Contact inbox</a><a href="#accounts"><i class="bi bi-shield-check"></i> Admin accounts</a></nav><form class="admin-logout" action="/logout" method="post"><button type="submit"><i class="bi bi-box-arrow-right"></i> Log out</button></form></aside><section class="admin-workspace"><header class="admin-topbar"><button class="admin-menu-toggle" type="button" aria-label="Open navigation"><i class="bi bi-list"></i></button><div class="admin-user"><span class="admin-avatar">${initials}</span><span><strong>${escapeHtml(user.firstName || 'Administrator')}</strong><small>Administrator</small></span></div></header><div class="admin-content"><section class="admin-heading" id="overview"><h1>Dashboard overview</h1><p>Manage BFIMC content, messages, and administrator access from one place.</p></section>${notice}<section class="admin-stats" aria-label="Dashboard totals"><article><span class="stat-icon blue"><i class="bi bi-images"></i></span><div><strong>${portfolio.length}</strong><small>Total content posts</small></div></article><article><span class="stat-icon orange"><i class="bi bi-envelope"></i></span><div><strong>${inbox.length}</strong><small>Contact messages</small></div></article><article><span class="stat-icon green"><i class="bi bi-people"></i></span><div><strong>${admins.length}</strong><small>Administrator accounts</small></div></article></section><section class="admin-section" id="portfolio"><div class="admin-section-heading"><div><p class="section-kicker">Website content</p><h2>Content manager</h2><span class="admin-section-description">Create and edit portfolio posts with an image and description.</span></div><span>${portfolio.length} posts</span></div><details class="admin-create"><summary><i class="bi bi-plus-lg"></i> Create content</summary><form class="admin-item admin-new" action="/admin/portfolio" method="post"><label>Title<input name="title" placeholder="e.g. Community outreach" required></label><label>Image URL<input name="image_url" placeholder="/assets/img/portfolio/image.jpg" required></label><label>Image description<input name="alt_text" placeholder="Describe the image"></label><label>Display order<input name="sort_order" type="number" value="0"><small>Lower numbers appear first.</small></label><label class="admin-field-wide">Description<textarea name="caption" placeholder="Write a short description" required></textarea></label><button class="auth-submit" type="submit"><i class="bi bi-check-lg"></i> Save content</button></form></details><div class="admin-content-grid">${portfolioRows}</div></section><section class="admin-section" id="inbox"><div class="admin-section-heading"><div><p class="section-kicker">Messages</p><h2>Contact inbox</h2></div><span>${inbox.length} total</span></div><div class="admin-inbox">${inboxRows}</div></section><section class="admin-section" id="accounts"><div class="admin-section-heading"><div><p class="section-kicker">Access control</p><h2>Admin accounts</h2></div><span>${admins.length} active</span></div><form class="admin-add" action="/admin/admins" method="post"><input name="email" type="email" placeholder="Existing user email" required><button class="auth-submit" type="submit"><i class="bi bi-person-plus"></i> Add administrator</button></form><ul class="admin-admins">${adminRows}</ul></section></div></section></main>`;
  res.type('html').send(adminDocument(content));
}

function adminDocument(content) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>BFIMC | Admin</title><link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet"><link href="/assets/vendor/bootstrap-icons/bootstrap-icons.css" rel="stylesheet"><link href="/assets/css/style.css" rel="stylesheet"></head><body class="admin-body">${content}<script>document.querySelector('.admin-menu-toggle')?.addEventListener('click',()=>document.querySelector('.admin-page').classList.toggle('admin-menu-open'));document.querySelectorAll('input[name="image_url"]').forEach(input=>{const previous=input.value;const label=input.closest('label');if(previous){const saved=document.createElement('input');saved.type='hidden';saved.name='image_url';saved.value=previous;input.after(saved)}input.type='file';input.name='image';input.accept='image/jpeg,image/png,image/webp,image/gif';input.required=!previous;input.closest('form').enctype='multipart/form-data';if(label)label.firstChild.nodeValue='Image from device';});document.querySelectorAll('input[name="alt_text"]').forEach(input=>input.closest('label')?.remove());document.querySelectorAll('form').forEach(form=>form.addEventListener('submit',event=>{if(event.submitter?.classList.contains('admin-delete')&&!window.confirm('Are you sure you want to delete this item? This cannot be undone.'))event.preventDefault();}));const staffModal=document.querySelector('[data-staff-modal]');document.querySelector('[data-open-staff-modal]')?.addEventListener('click',()=>{staffModal.hidden=false;staffModal.querySelector('input')?.focus()});document.querySelectorAll('[data-close-staff-modal]').forEach(button=>button.addEventListener('click',()=>{staffModal.hidden=true}));const affiliateForm=document.querySelector('[data-affiliate-form]'),affiliateList=document.querySelector('[data-affiliate-list]'),affiliateNotice=document.querySelector('.admin-affiliate-notice');const affiliateMessage=(text,error=false)=>{if(!affiliateNotice)return;affiliateNotice.className='auth-alert '+(error?'':'success');affiliateNotice.textContent=text};const renderAffiliates=data=>{if(!affiliateList)return;affiliateList.innerHTML=data.affiliates.length?data.affiliates.map(a=>'<article class="admin-affiliate-row" data-affiliate-id="'+a.id+'"><img src="'+a.logo_url.replace(/"/g,'&quot;')+'" alt="'+a.company_name.replace(/"/g,'&quot;')+' logo"><strong></strong><button class="admin-delete" data-affiliate-delete="'+a.id+'" type="button"><i class="bi bi-trash"></i> Remove</button></article>').join(''): '<p class="admin-empty" data-affiliate-empty>No affiliates yet.</p>';data.affiliates.forEach((a,i)=>{const strong=affiliateList.children[i]?.querySelector('strong');if(strong)strong.textContent=a.company_name});document.querySelectorAll('[data-affiliate-count]').forEach(el=>el.textContent=data.count+' total')};affiliateForm?.addEventListener('submit',async event=>{event.preventDefault();const button=affiliateForm.querySelector('button');button.disabled=true;button.textContent='Uploading…';try{const response=await fetch(affiliateForm.action,{method:'POST',headers:{Accept:'application/json'},body:new FormData(affiliateForm)}),data=await response.json();if(!response.ok)throw new Error(data.error);renderAffiliates(data);affiliateForm.reset();affiliateMessage('Affiliate added.')}catch(error){affiliateMessage(error.message||'Unable to add affiliate.',true)}finally{button.disabled=false;button.innerHTML='<i class="bi bi-plus-lg"></i> Add affiliate'}});affiliateList?.addEventListener('click',async event=>{const button=event.target.closest('[data-affiliate-delete]');if(!button||!window.confirm('Remove this affiliate?'))return;button.disabled=true;try{const response=await fetch('/admin/affiliates/'+button.dataset.affiliateDelete+'/delete',{method:'POST',headers:{Accept:'application/json'}}),data=await response.json();if(!response.ok)throw new Error(data.error);renderAffiliates(data);affiliateMessage('Affiliate removed.')}catch(error){affiliateMessage(error.message||'Unable to remove affiliate.',true);button.disabled=false}});</script></body></html>`;
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

async function requireStaff(req, res, next) {
  const user = await sessionUser(req, res);
  if (!user) return res.redirect('/auth?mode=login');
  if (!user.isAdmin && !user.isStaff) return res.status(403).send('Staff access is required.');
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
  const { data: staff } = await client.from('staff').select('user_id').eq('user_id', user.id).maybeSingle();
  const metadata = user.user_metadata || {};
  return { id: user.id, email: user.email, firstName: profile?.first_name || metadata.first_name || '', lastName: profile?.last_name || metadata.last_name || '', birthdate: profile?.birthdate || metadata.birthdate || '', gender: profile?.gender || metadata.gender || '', isAdmin: Boolean(admin), isStaff: Boolean(staff), accessToken: activeSession.access_token };
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
