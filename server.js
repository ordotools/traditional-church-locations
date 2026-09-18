const path = require('path');
const express = require('express');
const compression = require('compression');
const session = require('express-session');

const apiRoutes = require('./src/routes/api');
const adminRoutes = require('./src/routes/admin');
const scrapeScheduler = require('./src/scrapeScheduler');

const app = express();
const PORT = process.env.PORT || 3000;

// Coolify terminates TLS at its proxy and forwards plain HTTP, so Express
// needs to trust the X-Forwarded-* headers for secure cookies to work.
app.set('trust proxy', 1);

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(compression());
app.use(express.urlencoded({ extended: false }));
app.use(express.static(path.join(__dirname, 'public'), { maxAge: '1d' }));

// ponytail: MemoryStore — sessions reset on restart/redeploy (everyone gets
// logged out) and don't share across multiple instances. Fine for a single
// container with one admin; move to a shared session store if that changes.
app.use(
  session({
    secret: process.env.SESSION_SECRET || 'dev-only-insecure-secret',
    resave: false,
    saveUninitialized: false,
    cookie: { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production' },
  })
);

app.use('/api', apiRoutes);
app.use('/admin', adminRoutes);

app.listen(PORT, () => {
  console.log(`traditional-church-locations running at http://localhost:${PORT}`);
});

scrapeScheduler.start();
