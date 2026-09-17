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

function markerIcon(color) {
  return L.divIcon({
    className: '',
    html: `<span class="pin-marker" style="background:${color || '#111'}"></span>`,
    iconSize: [10, 10],
    iconAnchor: [5, 5],
    popupAnchor: [0, -5],
  });
}

fetch('/api/pins')
  .then((res) => res.json())
  .then((pins) => {
    const markers = [];

    pins.forEach((pin) => {
      if (!Number.isFinite(pin.latitude) || !Number.isFinite(pin.longitude)) return;

      const marker = L.marker([pin.latitude, pin.longitude], {
        icon: markerIcon(pin.organization_color),
      }).addTo(map);
      markers.push(marker);

      const orgLine = pin.organization_name
        ? `${pin.organization_name}${pin.organization_abbreviation ? ' (' + pin.organization_abbreviation + ')' : ''}`
        : '';

      const approx = pin.precision && pin.precision !== 'exact';

      marker.bindPopup(
        `<h3>${escapeHtml(pin.title)}</h3>` +
          `<div>${escapeHtml(pin.address)}${approx ? ' <em>(approximate)</em>' : ''}</div>` +
          (orgLine ? `<div class="muted">${escapeHtml(orgLine)}</div>` : '')
      );
    });

    if (markers.length) {
      map.fitBounds(L.featureGroup(markers).getBounds().pad(0.1));
    }
  })
  .catch(() => {
    document.getElementById('map-error').hidden = false;
  });

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str || '';
  return div.innerHTML;
}
