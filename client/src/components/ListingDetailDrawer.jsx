import { useEffect, useMemo, useState } from 'react';
import { api } from '../api.js';
import { formatAvailableFrom } from '../utils/formatting.js';

function Field({ label, value }) {
  if (value === null || value === undefined || value === '') return null;
  return (
    <div className="detail-field">
      <span className="detail-field-label">{label}</span>
      <span className="detail-field-value">{value}</span>
    </div>
  );
}

function Feature({ label, value }) {
  if (value === null || value === undefined) return null;
  return <span className={`detail-feature ${value ? 'detail-feature--yes' : ''}`}>{label}</span>;
}

function formatBool(value) {
  if (value === 1 || value === true) return 'Ja';
  if (value === 0 || value === false) return 'Nein';
  return value;
}

function findAttribute(detail, pattern) {
  for (const group of detail?.attribute_groups ?? []) {
    for (const attr of group.attributes ?? []) {
      if (attr.label && pattern.test(attr.label)) {
        return attr.value === true ? 'Ja' : attr.value;
      }
    }
  }
  return null;
}

function visibleAttributeGroups(detail) {
  const covered = [
    /warmmiete|kaltmiete|nebenkosten|kaution|preis\/m/i,
    /wohnfläche|zimmer|verfügbar ab/i,
    /etage|schlafzimmer|badezimmer|haustiere/i,
    /art der unterkunft|mietart|rauchen|anzahl mitbewohner|online-besichtigung/i,
    /einbauküche|küche|kühlschrank|backofen|herd|spülmaschine|keller|balkon|garten|aufzug|stufenlos/i,
  ];

  return (detail?.attribute_groups ?? [])
    .map((group) => ({
      ...group,
      attributes: (group.attributes ?? []).filter((attr) => {
        if (!attr?.label || attr.value === null || attr.value === undefined || attr.value === '') {
          return false;
        }
        return !covered.some((pattern) => pattern.test(attr.label));
      }),
    }))
    .filter((group) => group.attributes.length > 0);
}

export default function ListingDetailDrawer({ listing, open, onClose, showToast }) {
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [payload, setPayload] = useState(null);
  const [error, setError] = useState('');

  const detail = payload?.detail ?? null;
  const currentListing = payload?.listing ?? listing;
  const detailError = payload?.detail_error ?? null;
  const detailSize = findAttribute(detail, /wohnfläche|wohnflaeche|gesamtfläche/i);
  const detailRooms = findAttribute(detail, /^zimmer$/i);
  const extraGroups = visibleAttributeGroups(detail);

  useEffect(() => {
    if (!open || !listing?.id) return;
    let cancelled = false;
    setLoading(true);
    setError('');
    setPayload(null);

    api.listings
      .getDetails(listing.id)
      .then((data) => {
        if (!cancelled) setPayload(data);
      })
      .catch((err) => {
        if (!cancelled) setError(err.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [open, listing?.id]);

  const images = useMemo(() => {
    if (Array.isArray(detail?.images) && detail.images.length > 0) return detail.images;
    try {
      const parsed = currentListing?.images ? JSON.parse(currentListing.images) : [];
      if (Array.isArray(parsed)) return parsed;
    } catch {}
    return currentListing?.image ? [currentListing.image] : [];
  }, [detail, currentListing]);

  if (!open || !listing) return null;

  const handleRefresh = async () => {
    setRefreshing(true);
    setError('');
    try {
      const data = await api.listings.refreshDetails(listing.id);
      setPayload(data);
      showToast?.('Detaildaten aktualisiert', 'success');
    } catch (err) {
      setError(err.message);
      showToast?.(`Detailabruf fehlgeschlagen: ${err.message}`, 'error');
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <>
      <div className="detail-backdrop" onClick={onClose} />
      <aside className="detail-drawer" aria-label="Listing Details">
        <header className="detail-header">
          <div className="detail-header-main">
            <span className="detail-provider">{currentListing?.provider || 'Listing'}</span>
            <h2 className="detail-title">{currentListing?.title}</h2>
          </div>
          <button className="detail-close" onClick={onClose} title="Schließen">
            ×
          </button>
        </header>

        {loading && (
          <div className="detail-state">
            <div className="spinner" />
            <p>Lade Detaildaten…</p>
          </div>
        )}

        {!loading && error && (
          <div className="detail-error">
            <p>{error}</p>
            <button
              className="btn btn--ghost btn--sm"
              onClick={handleRefresh}
              disabled={refreshing}
            >
              Erneut laden
            </button>
          </div>
        )}

        {!loading && !error && (
          <div className="detail-body">
            {detailError && (
              <div className="detail-error detail-error--inline">
                <p>{detailError}</p>
                <button className="btn btn--ghost btn--sm" onClick={handleRefresh} disabled={refreshing}>
                  Erneut laden
                </button>
              </div>
            )}

            <section className="detail-summary">
              <Field label="Preis" value={detail?.warm_rent || currentListing?.price} />
              <Field label="Kaltmiete" value={detail?.cold_rent} />
              <Field label="Fläche" value={detailSize || currentListing?.size} />
              <Field label="Zimmer" value={detailRooms || currentListing?.rooms} />
              <Field
                label="Einzug"
                value={formatAvailableFrom(
                  detail?.available_from || currentListing?.available_from,
                )}
              />
            </section>

            <section className="detail-section">
              <h3>Kosten</h3>
              <div className="detail-fields-grid">
                <Field label="Warmmiete" value={detail?.warm_rent} />
                <Field label="Kaltmiete" value={detail?.cold_rent} />
                <Field label="Nebenkosten" value={detail?.service_charge} />
                <Field label="Kaution" value={detail?.deposit} />
                <Field label="Preis/m²" value={detail?.price_per_sqm} />
              </div>
            </section>

            <section className="detail-section">
              <h3>Hauptkriterien</h3>
              <div className="detail-fields-grid">
                <Field label="Etage" value={detail?.floor} />
                <Field label="Schlafzimmer" value={detail?.bedrooms} />
                <Field label="Badezimmer" value={detail?.bathrooms} />
                <Field label="Haustiere" value={detail?.pets} />
                <Field
                  label="Unterkunft"
                  value={findAttribute(detail, /art der unterkunft|wohnform/i)}
                />
                <Field label="Mietart" value={findAttribute(detail, /mietart/i)} />
                <Field label="Rauchen" value={findAttribute(detail, /rauchen/i)} />
                <Field
                  label="Mitbewohner"
                  value={findAttribute(detail, /anzahl mitbewohner/i)}
                />
                <Field
                  label="Online-Besichtigung"
                  value={findAttribute(detail, /online-besichtigung/i)}
                />
              </div>
              <div className="detail-features">
                <Feature label="Einbauküche" value={detail?.has_kitchen} />
                <Feature label="Keller" value={detail?.has_cellar} />
                <Feature label="Balkon" value={detail?.has_balcony} />
                <Feature label="Garten" value={detail?.has_garden} />
                <Feature label="Aufzug" value={detail?.has_lift} />
                <Feature label="Stufenlos" value={detail?.barrier_free} />
              </div>
            </section>

            <section className="detail-section">
              <h3>Adresse</h3>
              <p className="detail-text">
                {detail?.address_line1 || currentListing?.address || 'Keine Adresse hinterlegt'}
                {detail?.address_line2 ? (
                  <>
                    <br />
                    {detail.address_line2}
                  </>
                ) : null}
              </p>
            </section>

            <section className="detail-section">
              <h3>Kontakt</h3>
              <div className="detail-fields-grid">
                <Field label="Anbieter" value={detail?.agent_name || currentListing?.publisher} />
                <Field label="Kontakt aktiv" value={formatBool(detail?.contact_available)} />
              </div>
              {detail?.contact_phone_numbers?.length > 0 && (
                <div className="detail-phone-list">
                  {detail.contact_phone_numbers.map((phone, idx) => (
                    <a key={idx} className="detail-phone" href={`tel:${phone.text}`}>
                      {phone.type || 'Telefon'}: {phone.text}
                    </a>
                  ))}
                </div>
              )}
            </section>

            {(detail?.description || detail?.location_description) && (
              <section className="detail-section">
                <h3>Beschreibung</h3>
                {detail.description && <p className="detail-text">{detail.description}</p>}
                {detail.location_description && (
                  <p className="detail-text">{detail.location_description}</p>
                )}
              </section>
            )}

            <section className="detail-section">
              <h3>Bausubstanz & Energie</h3>
              <div className="detail-fields-grid">
                <Field label="Baujahr" value={detail?.construction_year} />
                <Field label="Zustand" value={detail?.condition} />
                <Field label="Heizung" value={detail?.heating_type} />
                <Field label="Energieträger" value={detail?.energy_carrier} />
                <Field label="Energieklasse" value={detail?.energy_class} />
                <Field label="Energiewert" value={detail?.energy_value} />
              </div>
            </section>

            {images.length > 0 && (
              <section className="detail-section">
                <h3>Bilder</h3>
                <div className="detail-image-grid">
                  {images.slice(0, 12).map((src, idx) => (
                    <img key={`${src}-${idx}`} src={src} alt="" loading="lazy" />
                  ))}
                </div>
              </section>
            )}

            {extraGroups.length > 0 && (
              <section className="detail-section">
                <h3>Weitere Angaben</h3>
                <div className="detail-attribute-groups">
                  {extraGroups.map((group, groupIdx) => (
                    <div key={`${group.title || group.type}-${groupIdx}`} className="detail-attribute-group">
                      {group.title && <h4>{group.title}</h4>}
                      <div className="detail-fields-grid">
                        {group.attributes.map((attr, attrIdx) => (
                          <Field
                            key={`${attr.label}-${attrIdx}`}
                            label={attr.label}
                            value={attr.value === true ? 'Ja' : attr.value}
                          />
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            )}

            <footer className="detail-footer">
              <button
                className="btn btn--ghost btn--sm"
                onClick={handleRefresh}
                disabled={refreshing}
              >
                {refreshing ? 'Aktualisiert…' : 'Details aktualisieren'}
              </button>
              <a
                className="btn btn--primary btn--sm"
                href={currentListing?.link}
                target="_blank"
                rel="noopener noreferrer"
              >
                Original öffnen
              </a>
            </footer>
          </div>
        )}
      </aside>
    </>
  );
}
