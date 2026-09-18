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
// and grow as you zoom in, via a CSS variable every .pin-marker reads.
function sizeForZoom(zoom) {
  const z = Math.max(4, Math.min(zoom, 16));
  return Math.round(6 + ((z - 4) * (14 - 6)) / (16 - 4));
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
}
map.on('zoomend', updatePinSize);
updatePinSize();

// The visible dot scales with zoom (see updatePinSize), but the tappable
// icon stays a fixed, larger size and centers the dot inside it, so touch
// users always get a real hit target regardless of zoom level.
function markerIcon(color) {
  return L.divIcon({
    className: 'pin-marker-hitbox',
    html: `<span class="pin-marker" style="background:${color || '#111'};color:${color || '#111'}"></span>`,
    iconSize: [30, 30],
    iconAnchor: [15, 15],
    popupAnchor: [0, -10],
  });
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
    html += `<div><span class="swatch" style="background:${color}"></span>${escapeHtml(name)}</div>`;
  });
  body.innerHTML = html;
  document.getElementById('legend').hidden = false;
}

const banner = document.getElementById('map-banner');
function showBanner(text) {
  banner.textContent = text;
  banner.hidden = false;
}

showBanner('Loading pins…');

fetch('/api/pins')
  .then((res) => res.json())
  .then((pins) => {
    const markers = [];

    pins.forEach((pin) => {
      if (!Number.isFinite(pin.latitude) || !Number.isFinite(pin.longitude)) return;

      const approx = pin.precision && pin.precision !== 'exact';

      const marker = L.marker([pin.latitude, pin.longitude], {
        icon: markerIcon(pin.organization_color),
      }).addTo(map);
      markers.push(marker);

      const orgLine = pin.organization_name
        ? `${pin.organization_name}${pin.organization_abbreviation ? ' (' + pin.organization_abbreviation + ')' : ''}`
        : '';

      marker.bindPopup(
        `<h3>${escapeHtml(pin.title)}</h3>` +
          `<div>${escapeHtml(pin.address)}${approx ? ' <em>(approximate)</em>' : ''}</div>` +
          (orgLine ? `<div class="muted">${escapeHtml(orgLine)}</div>` : '')
      );
    });

    if (markers.length) {
      map.fitBounds(L.featureGroup(markers).getBounds().pad(0.1));
      banner.hidden = true;
    } else {
      showBanner('No mass centers found yet.');
    }
    renderLegend(pins);
  })
  .catch(() => {
    showBanner('Could not load pins. Please try again later.');
  });

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str || '';
  return div.innerHTML;
}
