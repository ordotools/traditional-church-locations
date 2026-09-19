const express = require('express');
const db = require('../db');

const router = express.Router();

// Bumped once per map load (map.js fetches this on page load) as a simple
// daily page-view count — no cookies/IPs, so it can't tell unique visitors
// apart, only total hits.
router.get('/pins', (req, res) => {
  db.prepare(
    `INSERT INTO page_views (date, count) VALUES (date('now'), 1)
     ON CONFLICT(date) DO UPDATE SET count = count + 1`
  ).run();

  const pins = db
    .prepare(
      `SELECT mc.id, mc.title, mc.address, mc.latitude, mc.longitude, mc.precision,
              o.name AS organization_name, o.abbreviation AS organization_abbreviation, o.color AS organization_color
       FROM mass_centers mc
       LEFT JOIN organizations o ON o.id = mc.organization_id`
    )
    .all();
  res.json(pins);
});

module.exports = router;
