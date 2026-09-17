const map = L.map('map', {
  zoomControl: true,
  maxBounds: [[-90, -180], [90, 180]],
  maxBoundsViscosity: 1.0,
}).setView([39.8, -98.6], 4);

L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 19,
  noWrap: true,
  attribution: '&copy; OpenStreetMap contributors',
}).addTo(map);

L.control.scale().addTo(map);

// The visible dot stays 10px (pin-marker), but the tappable icon is larger
// and centers the dot inside it, so touch users get a real hit target.
function markerIcon(color) {
  return L.divIcon({
    className: 'pin-marker-hitbox',
    html: `<span class="pin-marker" style="background:${color || '#111'}"></span>`,
    iconSize: [30, 30],
    iconAnchor: [15, 15],
    popupAnchor: [0, -10],
  });
}

// Approximate-precision pins get a bigger, translucent circle instead of a
// solid dot, so "we're not sure exactly where this is" reads at a glance
// instead of requiring a click to find out.
function approxCircle(pin) {
  return L.circleMarker([pin.latitude, pin.longitude], {
    radius: 12,
    weight: 1,
    color: pin.organization_color || '#111',
    fillColor: pin.organization_color || '#111',
    fillOpacity: 0.3,
  });
}

function renderLegend(pins, anyApprox) {
  const orgs = new Map();
  pins.forEach((pin) => {
    if (pin.organization_name && !orgs.has(pin.organization_name)) {
      orgs.set(pin.organization_name, pin.organization_color || '#111');
    }
  });
  if (!orgs.size && !anyApprox) return;

  const body = document.getElementById('legend-body');
  let html = '';
  orgs.forEach((color, name) => {
    html += `<div><span class="swatch" style="background:${color}"></span>${escapeHtml(name)}</div>`;
  });
  if (anyApprox) {
    html += '<div><span class="swatch swatch--approx"></span>approximate location</div>';
  }
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
    let anyApprox = false;

    pins.forEach((pin) => {
      if (!Number.isFinite(pin.latitude) || !Number.isFinite(pin.longitude)) return;

      const approx = pin.precision && pin.precision !== 'exact';
      if (approx) anyApprox = true;

      const marker = approx
        ? approxCircle(pin)
        : L.marker([pin.latitude, pin.longitude], { icon: markerIcon(pin.organization_color) });
      marker.addTo(map);
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
    renderLegend(pins, anyApprox);
  })
  .catch(() => {
    showBanner('Could not load pins. Please try again later.');
  });

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str || '';
  return div.innerHTML;
}
