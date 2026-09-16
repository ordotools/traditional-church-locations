const express = require('express');
const db = require('../db');

const router = express.Router();

router.get('/pins', (req, res) => {
  const pins = db
    .prepare(
      `SELECT mc.id, mc.title, mc.address, mc.latitude, mc.longitude,
              o.name AS organization_name, o.abbreviation AS organization_abbreviation, o.color AS organization_color
       FROM mass_centers mc
       LEFT JOIN organizations o ON o.id = mc.organization_id`
    )
    .all();
  res.json(pins);
});

module.exports = router;
