const path = require('path');
const express = require('express');

const apiRoutes = require('./src/routes/api');
const adminRoutes = require('./src/routes/admin');

const app = express();
const PORT = process.env.PORT || 3000;

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(express.urlencoded({ extended: false }));
app.use(express.static(path.join(__dirname, 'public')));

app.use('/api', apiRoutes);
app.use('/admin', adminRoutes);

app.listen(PORT, () => {
  console.log(`traditional-church-locations running at http://localhost:${PORT}`);
});
