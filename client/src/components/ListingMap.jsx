import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

function boundsFromBbox(bbox) {
  if (!bbox) return null;
  const { south, north, west, east } = bbox;
  if (![south, north, west, east].every(Number.isFinite)) return null;
  return [
    [south, west],
    [north, east],
  ];
}

function radiusForPrecision(precision) {
  return {
    exact: 40,
    street: 250,
    postcode: 700,
    district: 1000,
    city: 2500,
  }[precision] ?? 600;
}

export default function ListingMap({ location }) {
  const containerRef = useRef(null);

  useEffect(() => {
    if (!containerRef.current || !location) return undefined;

    const map = L.map(containerRef.current, {
      attributionControl: true,
      scrollWheelZoom: false,
      zoomControl: true,
    });

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; OpenStreetMap',
    }).addTo(map);

    const shapeStyle = {
      color: '#2563eb',
      weight: 2,
      opacity: 0.9,
      fillColor: '#3b82f6',
      fillOpacity: 0.16,
    };

    const lat = Number(location.lat);
    const lon = Number(location.lon);
    const hasPoint = Number.isFinite(lat) && Number.isFinite(lon);
    const canRenderArea = ['postcode', 'district', 'city'].includes(location.precision);
    let fitted = false;

    if (canRenderArea && location.geometry_geojson) {
      const layer = L.geoJSON(location.geometry_geojson, { style: shapeStyle }).addTo(map);
      const bounds = layer.getBounds();
      if (bounds.isValid()) {
        map.fitBounds(bounds, { padding: [14, 14], maxZoom: 15 });
        fitted = true;
      }
    } else {
      const bboxBounds = canRenderArea ? boundsFromBbox(location.bbox) : null;
      if (bboxBounds) {
        const rectangle = L.rectangle(bboxBounds, shapeStyle).addTo(map);
        map.fitBounds(rectangle.getBounds(), { padding: [14, 14], maxZoom: 15 });
        fitted = true;
      }
    }

    if (hasPoint) {
      if (location.precision === 'exact') {
        L.marker([lat, lon], {
          icon: L.divIcon({
            className: 'detail-map-pin',
            iconSize: [18, 18],
          }),
        }).addTo(map);
      } else if (!fitted) {
        const circle = L.circle([lat, lon], {
          ...shapeStyle,
          radius: radiusForPrecision(location.precision),
        }).addTo(map);
        map.fitBounds(circle.getBounds(), { padding: [14, 14], maxZoom: 15 });
        fitted = true;
      }
    }

    if (!fitted && hasPoint) map.setView([lat, lon], location.precision === 'exact' ? 17 : 14);
    setTimeout(() => map.invalidateSize(), 0);

    return () => map.remove();
  }, [location]);

  return <div ref={containerRef} className="detail-map-leaflet" />;
}
