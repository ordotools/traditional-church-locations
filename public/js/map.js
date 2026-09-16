const map = L.map('map', { zoomControl: true }).setView([39.8, -98.6], 4);

L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 19,
  attribution: '&copy; OpenStreetMap contributors',
}).addTo(map);

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
    pins.forEach((pin) => {
      const marker = L.marker([pin.latitude, pin.longitude], {
        icon: markerIcon(pin.organization_color),
      }).addTo(map);

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
  });

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str || '';
  return div.innerHTML;
}
