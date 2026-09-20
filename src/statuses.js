// Vetting statuses — shown as a shape on the map pin (see public/js/map.js).
// An organization always has one of these. A mass center's own status is
// either one of these (an override) or '' to inherit the organization's.
module.exports = ['vetted', 'questionable', 'unknown', 'blacklisted'];
