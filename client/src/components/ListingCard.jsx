import { memo, useState, useCallback } from 'react';
import { formatAvailableFrom, formatListingDate, isValidImageUrl } from '../utils/formatting.js';
import { LISTING_TYPE_LABELS, LISTING_TYPE_COLORS, PROVIDER_LABELS, PROVIDER_COLORS } from '../constants.js';

const HeartIcon = ({ filled }) => (
  <svg viewBox="0 0 24 24" className="heart-svg" fill={filled ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2">
    <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
  </svg>
);

const BlacklistIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16">
    <circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/>
  </svg>
);

const EyeIcon = ({ seen }) => (
  seen
    ? <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
    : <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
);

const ChevronLeft = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="chev-icon"><polyline points="15 18 9 12 15 6"/></svg>
);
const ChevronRight = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="chev-icon"><polyline points="9 18 15 12 9 6"/></svg>
);

const ListingCard = memo(function ListingCard({ listing: l, onSeen, onFavorite, onBlacklist, onUnblacklist, prefetchedImages, isBlacklistView }) {
  const isNew = !l.is_seen;
  const upgradeUrl = (u) => u ? u.replace('/thumbs/images/', '/images/').replace(/s-l\d+\./, 's-l1600.') : u;

  const resolveImages = () => {
    if (prefetchedImages?.length) return prefetchedImages;
    try { const cached = l.images ? JSON.parse(l.images) : null; if (cached?.length) return cached; } catch {}
    const img = isValidImageUrl(l.image) ? upgradeUrl(l.image) : null;
    return img ? [img] : [];
  };

  const resolvedImages = resolveImages();
  const [imgIdx, setImgIdx] = useState(0);

  const goNext = useCallback((e) => { e.stopPropagation(); e.preventDefault(); setImgIdx(i => (i + 1) % Math.max(resolvedImages.length, 1)); }, [resolvedImages.length]);
  const goPrev = useCallback((e) => { e.stopPropagation(); e.preventDefault(); setImgIdx(i => (i - 1 + Math.max(resolvedImages.length, 1)) % Math.max(resolvedImages.length, 1)); }, [resolvedImages.length]);

  const handleFav = (e) => { e.stopPropagation(); e.preventDefault(); onFavorite(l.id); };
  const handleBlacklist = (e) => { e.stopPropagation(); e.preventDefault(); isBlacklistView ? onUnblacklist?.(l.id) : onBlacklist?.(l.id); };
  const handleSeenToggle = (e) => { e.stopPropagation(); e.preventDefault(); onSeen(l.id); };
  const handleOpen = () => { if (!l.is_seen) onSeen(l.id); };

  const currentImg = resolvedImages[imgIdx] ?? null;
  const typeColors = LISTING_TYPE_COLORS[l.listing_type] || { bg: '#f3f4f6', text: '#374151' };
  const providerColors = PROVIDER_COLORS[l.provider] || { bg: 'rgba(255,255,255,.92)', text: '#1f2937', border: 'rgba(255,255,255,.75)' };
  const providerLabel = PROVIDER_LABELS[l.provider] || l.provider;
  const publishedLabel = formatListingDate(l.listed_at);
  const availableFromLabel = formatAvailableFrom(l.available_from);
  const firstSeenLabel = formatListingDate(l.first_seen);
  const lastSeenLabel = formatListingDate(l.last_seen);
  const seenMultipleTimes = l.first_seen && l.last_seen && l.first_seen !== l.last_seen;

  return (
    <article className={`card ${isNew ? 'card--new' : ''} ${l.is_seen ? 'card--seen' : ''} ${l.is_blacklisted ? 'card--blacklisted' : ''}`}>
      <div className="card-img">
        {currentImg ? (
          <img key={currentImg} src={currentImg} alt="" decoding="async" loading="lazy" onError={(e) => { e.currentTarget.style.display = 'none'; }} />
        ) : (
          <div className="card-img-placeholder">🏠</div>
        )}
        {resolvedImages.length > 1 && currentImg && (
          <>
            <button className="carousel-btn carousel-btn--prev" onClick={goPrev}><ChevronLeft /></button>
            <button className="carousel-btn carousel-btn--next" onClick={goNext}><ChevronRight /></button>
          </>
        )}
        {resolvedImages.length > 1 && (
          <span className="carousel-counter">{imgIdx + 1}/{resolvedImages.length}</span>
        )}

        <div className="card-actions-overlay">
          {!isBlacklistView && (
            <button
              className={`card-seen-btn ${l.is_seen ? 'card-seen-btn--active' : ''}`}
              onClick={handleSeenToggle}
              title={l.is_seen ? 'Als ungesehen markieren' : 'Als gesehen markieren'}
            >
              <EyeIcon seen={l.is_seen} />
            </button>
          )}
          <button className={`card-fav-btn ${l.is_favorite ? 'card-fav-btn--active' : ''}`} onClick={handleFav} title={l.is_favorite ? 'Favorit entfernen' : isBlacklistView ? 'Als Favorit (von Blacklist entfernen)' : 'Als Favorit'}>
            <HeartIcon filled={l.is_favorite} />
          </button>
          <button className={`card-blacklist-btn ${l.is_blacklisted ? 'card-blacklist-btn--active' : ''}`} onClick={handleBlacklist} title={isBlacklistView ? 'Von Blacklist entfernen' : 'Blacklisten'}>
            <BlacklistIcon />
          </button>
        </div>

        {isNew && !isBlacklistView && <span className="card-badge card-badge--new">Neu</span>}
        <div className="card-badge-stack">
          {providerLabel && (
            <span className="card-badge card-badge--provider" style={{ background: providerColors.bg, color: providerColors.text, borderColor: providerColors.border }}>
              {providerLabel}
            </span>
          )}
          <span className="card-badge card-badge--type" style={{ background: typeColors.bg, color: typeColors.text }}>
            {LISTING_TYPE_LABELS[l.listing_type] || l.listing_type}
          </span>
        </div>
      </div>

      <div className="card-body">
        <div className="card-meta">
          <span className="card-price">{l.price || '— €'}</span>
          <div className="card-pills">
            {l.size && <span className="pill pill--size">{l.size}</span>}
            {l.rooms && <span className="pill pill--rooms">{l.rooms}</span>}
          </div>
        </div>
        <h2 className="card-title">{l.title}</h2>
        {l.link?.includes('/expose/') && (
          <p className="card-expose-id">ID: {l.link.split('/expose/')[1]}</p>
        )}
        {l.address && (
          <p className="card-address">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="addr-icon"><path d="M21 10c0 7-9 13-9 13S3 17 3 10a9 9 0 1 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
            {l.address}
          </p>
        )}
        {l.description && <p className="card-desc">{l.description}</p>}
      </div>

      <div className="card-footer">
        <div className="card-dates">
          <span className="card-date">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="date-icon"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
            <span className="card-date-label">Veröffentlicht am:</span>
            <span>{publishedLabel || 'unbekannt'}</span>
          </span>
          {l.available_from && (
            <span className="card-date">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="date-icon"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>
              <span className="card-date-label">Einzug ab:</span>
              <span>{availableFromLabel}</span>
            </span>
          )}
          {l.publisher && (
            <span className="card-date card-date--publisher" title={l.publisher}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="date-icon"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
              <span className="card-date-label">Inserent:</span>
              <span>{l.publisher}</span>
            </span>
          )}
          {l.first_seen && (
            <span className="card-date card-date--scraped" title={new Date(l.first_seen).toLocaleString('de-DE')}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="date-icon"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
              <span className="card-date-label">Entdeckt:</span>
              <span>{firstSeenLabel}</span>
            </span>
          )}
          {seenMultipleTimes && (
            <span className="card-date card-date--scraped" title={new Date(l.last_seen).toLocaleString('de-DE')}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="date-icon"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>
              <span className="card-date-label">Zuletzt gesehen:</span>
              <span>{lastSeenLabel}</span>
            </span>
          )}
        </div>
        <a href={l.link} target="_blank" rel="noopener noreferrer" className="card-open-btn" onClick={handleOpen}>
          Öffnen
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="open-icon"><path d="M7 17L17 7M17 7H7M17 7v10"/></svg>
        </a>
      </div>
    </article>
  );
});

export default ListingCard;
