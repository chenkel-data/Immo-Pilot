export const ITEMS_PER_PAGE = 24;
export const SCRAPE_STATUS_POLLING_INTERVAL = 3_000;
export const TOAST_DURATION = 3_400;

export const TABS = {
  ALL: 'all',
  UNSEEN: 'unseen',
  FAVORITES: 'favorites',
  BLACKLISTED: 'blacklisted',
};

export const LISTING_TYPE_LABELS = {
  // Kleinanzeigen
  'miete':                   'Mietwohnungen',
  'wohnen-auf-zeit':         'Wohnen auf Zeit',
  // ImmobilienScout24
  'apartmentrent':           'Wohnung mieten',
  'apartmentbuy':            'Wohnung kaufen',
  'houserent':               'Haus mieten',
  'housebuy':                'Haus kaufen',
  'shorttermaccommodation':  'Wohnen auf Zeit',
};

export const LISTING_TYPE_COLORS = {
  // Apartment rent → Sky
  'miete':                  { bg: '#f0f9ff', text: '#0c4a6e', dot: '#38bdf8' },
  'apartmentrent':          { bg: '#f0f9ff', text: '#0c4a6e', dot: '#38bdf8' },
  // Short-term accommodation → Fuchsia
  'wohnen-auf-zeit':        { bg: '#fdf4ff', text: '#701a75', dot: '#d946ef' },
  'shorttermaccommodation': { bg: '#fdf4ff', text: '#701a75', dot: '#d946ef' },
  // Apartment buy → Indigo
  'apartmentbuy':           { bg: '#eef2ff', text: '#312e81', dot: '#6366f1' },
  // House rent → Cyan
  'houserent':              { bg: '#ecfeff', text: '#164e63', dot: '#22d3ee' },
  // House buy → Red
  'housebuy':               { bg: '#fef2f2', text: '#991b1b', dot: '#f87171' },
};

export const PROVIDER_LABELS = {
  'kleinanzeigen': 'Kleinanzeigen',
  'immoscout24':   'ImmobilienScout24',
};

export const PROVIDER_COLORS = {
  'kleinanzeigen': { bg: '#f0fdf4', text: '#166534', border: '#86efac' },
  'immoscout24':   { bg: '#eff6ff', text: '#1d4ed8', border: '#93c5fd' },
};


