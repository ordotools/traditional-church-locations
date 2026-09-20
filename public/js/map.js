const map = L.map('map', {
  zoomControl: true,
  maxBounds: [[-90, -180], [90, 180]],
  maxBoundsViscosity: 1.0,
}).setView([39.8, -98.6], 4);

L.tileLayer('https://basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png?key=cb1_3pqi_1_0820b5f5c90fefaa38ad004b', {
  maxZoom: 19,
  noWrap: true,
  attribution: '&copy; OpenStreetMap contributors &copy; CARTO',
}).addTo(map);

L.control.scale().addTo(map);

// Pins shrink when zoomed out (so dense areas don't smear into one blob)
// and grow as you zoom in, via a CSS variable every .pin-marker reads. The
// floor is high enough that the status shape (circle/square/triangle/X)
// still reads at the most zoomed-out view — otherwise the whole feature is
// useless except when already zoomed in close.
function sizeForZoom(zoom) {
  const z = Math.max(4, Math.min(zoom, 16));
  return Math.round(10 + ((z - 4) * (20 - 10)) / (16 - 4));
}
// No glow while zoomed out (a whole cluster of pins would just fuzz
// together); it eases in slowly, then grows large near max zoom so
// individual pin positions stay easy to pick out.
const GLOW_START_ZOOM = 8;
const GLOW_MAX_ZOOM = 18;
const GLOW_MAX_BLUR = 20;
function glowForZoom(zoom) {
  if (zoom <= GLOW_START_ZOOM) return 0;
  const t = Math.min(1, (zoom - GLOW_START_ZOOM) / (GLOW_MAX_ZOOM - GLOW_START_ZOOM));
  return Math.round(t * t * GLOW_MAX_BLUR);
}
function updatePinSize() {
  const zoom = map.getZoom();
  document.documentElement.style.setProperty('--pin-size', `${sizeForZoom(zoom)}px`);
  const blur = glowForZoom(zoom);
  document.documentElement.style.setProperty('--glow-blur', `${blur}px`);
  document.documentElement.style.setProperty('--glow-opacity', (blur / GLOW_MAX_BLUR).toFixed(2));
  // Only run the pulse animation once it's actually visible — otherwise
  // every pin animates invisibly while zoomed out for no reason.
  document.documentElement.classList.toggle('glow-active', blur > 0);
}
map.on('zoomend', updatePinSize);
updatePinSize();

// At small pin sizes a badge or glyph overlay isn't legible (and, with
// thousands of pins on screen, most pins ARE small) — so vetting status is
// encoded as the pin's own silhouette instead, which stays readable even at
// a few pixels. Org color still fills the shape. Real SVG paths (not a CSS
// clip-path div) are used specifically so the glow/pulse below — a second,
// scaled-up copy of this same markup — expands in the actual icon shape;
// clip-path clips away any box-shadow/filter glow on the same element, so a
// clipped div's glow always came out as its original square regardless of
// the shape drawn on top of it.
const STATUS_SHAPES = {
  vetted: '<circle cx="50" cy="50" r="42" fill="currentColor"/>',
  unknown: '<rect x="8" y="8" width="84" height="84" fill="currentColor"/>',
  questionable: '<polygon points="50,6 94,90 6,90" fill="currentColor"/>',
  blacklisted:
    '<path d="M20,20 L80,80 M80,20 L20,80" stroke="currentColor" stroke-width="22" stroke-linecap="round"/>',
};
// The visible shape scales with zoom (see updatePinSize), but the tappable
// icon stays a fixed, larger size and centers the shape inside it, so touch
// users always get a real hit target regardless of zoom level.
function markerIcon(color, status) {
  const shape = STATUS_SHAPES[status] || STATUS_SHAPES.unknown;
  return L.divIcon({
    className: 'pin-marker-hitbox',
    html:
      `<span class="pin-marker-wrap" style="color:${color || '#111'}">` +
      `<svg class="pin-marker" viewBox="0 0 100 100">${shape}</svg>` +
      `<svg class="pin-marker-ping" viewBox="0 0 100 100">${shape}</svg>` +
      `</span>`,
    iconSize: [30, 30],
    iconAnchor: [15, 15],
    popupAnchor: [0, -10],
  });
}

// Each org's markers live in their own layer group so the legend checkbox
// can show/hide them with map.addLayer/removeLayer instead of tracking
// individual markers.
const orgLayers = new Map();
function layerForOrg(name) {
  if (!orgLayers.has(name)) {
    orgLayers.set(name, L.layerGroup().addTo(map));
  }
  return orgLayers.get(name);
}

function renderLegend(pins) {
  const orgs = new Map();
  pins.forEach((pin) => {
    if (pin.organization_name && !orgs.has(pin.organization_name)) {
      orgs.set(pin.organization_name, pin.organization_color || '#111');
    }
  });
  if (!orgs.size) return;

  const body = document.getElementById('legend-body');
  let html = '';
  orgs.forEach((color, name) => {
    html +=
      `<label class="legend-item">` +
      `<input type="checkbox" checked data-org="${escapeHtml(name)}">` +
      `<span class="swatch" style="background:${color}"></span>${escapeHtml(name)}` +
      `</label>`;
  });
  body.innerHTML = html;
  body.addEventListener('change', (e) => {
    const org = e.target.dataset.org;
    if (!org) return;
    const layer = layerForOrg(org);
    if (e.target.checked) map.addLayer(layer);
    else map.removeLayer(layer);
  });
  document.getElementById('legend').hidden = false;
}

// Configurable per-status label + map/legend visibility, edited on
// /admin/statuses (e.g. 'blacklisted' shown on the map as "Do not attend"
// but left out of the legend). Keyed by status for renderPins' lookups.
function renderStatusLegend(statusSettings) {
  const container = document.getElementById('legend-status');
  const html = Object.values(statusSettings)
    .filter((s) => s.show_in_legend)
    .map((s) => {
      const shape = STATUS_SHAPES[s.status] || STATUS_SHAPES.unknown;
      return `<span class="legend-status-item"><svg class="legend-shape" viewBox="0 0 100 100">${shape}</svg>${escapeHtml(s.label)}</span>`;
    })
    .join('');
  container.innerHTML = html;
  container.hidden = !html;
}

const banner = document.getElementById('map-banner');
function showBanner(text) {
  banner.textContent = text;
  banner.hidden = false;
}

showBanner('Loading pins…');

Promise.all([fetch('/api/pins').then((res) => res.json()), fetch('/api/status-settings').then((res) => res.json())])
  .then(([pins, statusRows]) => {
    const statusSettings = {};
    statusRows.forEach((row) => {
      statusSettings[row.status] = row;
    });

    const markers = [];

    pins.forEach((pin) => {
      if (!Number.isFinite(pin.latitude) || !Number.isFinite(pin.longitude)) return;

      const approx = pin.precision && pin.precision !== 'exact';

      const marker = L.marker([pin.latitude, pin.longitude], {
        icon: markerIcon(pin.organization_color, pin.status),
      }).addTo(pin.organization_name ? layerForOrg(pin.organization_name) : map);
      markers.push(marker);

      const orgLine = pin.organization_name
        ? `${pin.organization_name}${pin.organization_abbreviation ? ' (' + pin.organization_abbreviation + ')' : ''}`
        : '';
      const statusSetting = statusSettings[pin.status];

      marker.bindPopup(
        `<h3>${escapeHtml(pin.title)}</h3>` +
          `<div>${escapeHtml(pin.address)}${approx ? ' <em>(approximate)</em>' : ''}</div>` +
          (orgLine ? `<div class="muted">${escapeHtml(orgLine)}</div>` : '') +
          (statusSetting && statusSetting.show_on_map
            ? `<div class="status-badge status-${pin.status}">${escapeHtml(statusSetting.label)}</div>`
            : '')
      );
    });

    if (markers.length) {
      map.fitBounds(L.featureGroup(markers).getBounds().pad(0.1));
      banner.hidden = true;
    } else {
      showBanner('No mass centers found yet.');
    }
    renderLegend(pins);
    renderStatusLegend(statusSettings);
  })
  .catch(() => {
    showBanner('Could not load pins. Please try again later.');
  });

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str || '';
  return div.innerHTML;
}
