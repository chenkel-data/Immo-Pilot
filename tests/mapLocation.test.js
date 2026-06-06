import { describe, expect, it } from 'vitest';
import {
  addressLooksRegional,
  cleanMapAddress,
  mapAddressCandidates,
  mapLocationFromCoordinates,
  selectBestNominatimLocation,
} from '../src/utils/mapLocation.js';

describe('map location helpers', () => {
  it('removes provider placeholder text from incomplete addresses', () => {
    expect(
      cleanMapAddress(
        'Die vollständige Adresse der Immobilie erhältst du vom Anbieter., 68165 Schwetzingerstadt/Oststadt, Mannheim',
      ),
    ).toBe('68165 Schwetzingerstadt/Oststadt, Mannheim');
  });

  it('generates useful candidates for postcode and slash districts', () => {
    expect(mapAddressCandidates('68165 Schwetzingerstadt/Oststadt, Mannheim')).toEqual([
      '68165 Schwetzingerstadt/Oststadt, Mannheim',
      'Schwetzingerstadt/Oststadt, Mannheim',
      'Schwetzingerstadt, Mannheim',
      'Oststadt, Mannheim',
      '68165 Mannheim',
      'Mannheim',
    ]);
  });

  it('recognizes postcode/district strings as regional addresses', () => {
    expect(addressLooksRegional('68165 Schwetzingerstadt/Oststadt, Mannheim')).toBe(true);
    expect(addressLooksRegional('Käfertaler Straße 12, Mannheim')).toBe(false);
    expect(addressLooksRegional('Mönchwörthstraße 19, 68199 Neckarau, Mannheim')).toBe(false);
    expect(addressLooksRegional('Am Hungerberg 10, 69434 Hirschhorn, Hirschhorn (Neckar)')).toBe(
      false,
    );
  });

  it('does not fall back from exact-looking addresses to city polygons', () => {
    expect(mapAddressCandidates('Am Hungerberg 10, 69434 Hirschhorn, Hirschhorn (Neckar)')).toEqual(
      [
        'Am Hungerberg 10, 69434 Hirschhorn, Hirschhorn (Neckar)',
        'Am Hungerberg 10, Hirschhorn (Neckar)',
      ],
    );
  });

  it('selects a regional polygon instead of a random building for regional queries', () => {
    const location = selectBestNominatimLocation(
      [
        {
          display_name: 'Nationaltheater Mannheim, 9, Mozartstraße, Oststadt, Mannheim',
          type: 'construction',
          addresstype: 'building',
          lat: '49.4883241',
          lon: '8.4777193',
          boundingbox: ['49.4881370', '49.4886271', '8.4767593', '8.4786758'],
          address: { house_number: '9', road: 'Mozartstraße' },
          geojson: { type: 'Polygon', coordinates: [] },
        },
        {
          display_name:
            'Schwetzingerstadt/Oststadt, Mannheim, Baden-Württemberg, 68165, Deutschland',
          type: 'administrative',
          addresstype: 'city_district',
          lat: '49.4815281',
          lon: '8.4894105',
          boundingbox: ['49.4690924', '49.4940040', '8.4678293', '8.5084720'],
          geojson: { type: 'Polygon', coordinates: [] },
        },
      ],
      '68165 Schwetzingerstadt/Oststadt, Mannheim',
    );

    expect(location).toEqual(
      expect.objectContaining({
        precision: 'district',
        label: 'Schwetzingerstadt/Oststadt, Mannheim, Baden-Württemberg, 68165, Deutschland',
      }),
    );
  });

  it('does not expose building polygons for exact address queries', () => {
    const location = selectBestNominatimLocation(
      [
        {
          display_name:
            'Mönchwörthstraße 19, Neckarau, Mannheim, Baden-Württemberg, 68199, Deutschland',
          type: 'apartments',
          addresstype: 'building',
          lat: '49.4494600',
          lon: '8.4865000',
          boundingbox: ['49.4493000', '49.4496200', '8.4863000', '8.4867000'],
          address: { house_number: '19', road: 'Mönchwörthstraße' },
          geojson: { type: 'Polygon', coordinates: [] },
        },
      ],
      'Mönchwörthstraße 19, 68199 Neckarau, Mannheim',
    );

    expect(location).toEqual(
      expect.objectContaining({
        precision: 'exact',
        bbox: null,
        geometry_geojson: null,
      }),
    );
  });

  it('maps exact addresses without a street suffix to exact points', () => {
    const location = selectBestNominatimLocation(
      [
        {
          display_name: '10, Am Hungerberg, Ersheim, Hirschhorn, Hessen, 69434, Deutschland',
          type: 'yes',
          addresstype: 'building',
          lat: '49.4505322',
          lon: '8.9070176',
          boundingbox: ['49.4503939', '49.4505792', '8.9068359', '8.9071497'],
          address: { house_number: '10', road: 'Am Hungerberg' },
          geojson: { type: 'Polygon', coordinates: [] },
        },
      ],
      'Am Hungerberg 10, 69434 Hirschhorn, Hirschhorn (Neckar)',
    );

    expect(location).toEqual(
      expect.objectContaining({
        precision: 'exact',
        bbox: null,
        geometry_geojson: null,
      }),
    );
  });

  it('uses Nominatim road fields for street-level results', () => {
    const location = selectBestNominatimLocation(
      [
        {
          display_name: 'Am Hungerberg, Hirschhorn, Hessen, 69434, Deutschland',
          type: 'residential',
          addresstype: 'road',
          lat: '49.4502000',
          lon: '8.9069000',
          boundingbox: ['49.4499000', '49.4506000', '8.9065000', '8.9073000'],
          address: { road: 'Am Hungerberg' },
        },
      ],
      'Am Hungerberg, Hirschhorn',
    );

    expect(location).toEqual(
      expect.objectContaining({
        precision: 'street',
        bbox: null,
        geometry_geojson: null,
      }),
    );
  });

  it('does not convert missing coordinates into a 0/0 map point', () => {
    expect(mapLocationFromCoordinates({ lat: null, lon: null })).toBeNull();
  });
});
