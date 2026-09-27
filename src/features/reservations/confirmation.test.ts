import { describe, expect, it } from 'vitest';
import { findDates, locationForCampground, parseConfirmation, tripUpdateFromReservation } from './confirmation';
import type { Campground, Reservation, Trip } from '../../model/schemas';

describe('findDates', () => {
  it('reads the common date styles', () => {
    expect(findDates('06/12/2027, 2027-06-13, June 14, 2027, Sat, Jun. 15th, 2027, 16 June 2027, 6/17/27')).toEqual([
      '2027-06-12',
      '2027-06-13',
      '2027-06-14',
      '2027-06-15',
      '2027-06-16',
      '2027-06-17',
    ]);
    expect(findDates('02/30/2027')).toEqual([]);
  });
});

describe('parseConfirmation', () => {
  it('reads a labelled confirmation email', () => {
    const text = `Thank you for your reservation!
Reservation Number: 1-2345678
Park: Afton State Park
Site: 045
Arrival Date: Friday, June 11, 2027
Departure Date: Sunday, June 13, 2027
Number of Nights: 2
Site Fee: $70.00
Reservation Fee: $8.50
Transaction fee $1.00
Total Paid: $79.50
Cancel by: 06/08/2027`;
    const r = parseConfirmation(text);
    expect(r.fields).toEqual({
      status: 'booked',
      confirmation: '1-2345678',
      site: '045',
      arrivalDate: '2027-06-11',
      nights: 2,
      costUsd: 70,
      feesUsd: 9.5,
      cancelDeadline: '2027-06-08',
    });
    expect(r.found).toContain('confirmation #');
  });

  it('handles values on the next line, a date range and only a total', () => {
    const text = `Order Confirmation
Confirmation #
0123456789-1
Campsite
B12
Dates: 07/09/2027 - 07/12/2027
Reservation fee
$10.00
Total
$106.00`;
    const r = parseConfirmation(text);
    expect(r.fields).toMatchObject({
      confirmation: '0123456789-1',
      site: 'B12',
      arrivalDate: '2027-07-09',
      nights: 3,
      feesUsd: 10,
      costUsd: 96,
    });
  });

  it("doesn't mistake the website or fee words for a site or number", () => {
    const r = parseConfirmation('Visit our website 24/7. Reservation fee: $8.50');
    expect(r.fields.site).toBeUndefined();
    expect(r.fields.confirmation).toBeUndefined();
    expect(r.fields.status).toBeUndefined();
    expect(r.fields.feesUsd).toBe(8.5);
  });

  it('spots a cancellation', () => {
    expect(parseConfirmation('Your reservation 1-2345678 has been cancelled.').fields.status).toBe('cancelled');
  });

  it('finds nothing in unrelated text', () => {
    expect(parseConfirmation('see you at the lake').found).toEqual([]);
  });
});

const cg = (name: string, location: Campground['location']) => ({ name, location }) as Campground;

describe('locationForCampground', () => {
  const afton = cg('Afton State Park', { lat: 44.85, lng: -92.77 });
  const itasca = cg('Itasca State Park', { lat: 47.2, lng: -95.2 });
  const noPin = cg('Somewhere', null);

  it("uses the chosen campground's pin, replacing whatever was there", () => {
    expect(locationForCampground(null, undefined, afton)).toEqual({ lat: 44.85, lng: -92.77, label: 'Afton State Park' });
    expect(locationForCampground({ lat: 1, lng: 2, label: 'my spot' }, undefined, itasca)?.label).toBe('Itasca State Park');
  });

  it('clears the old campground pin when the new one has none, but keeps a hand-set spot', () => {
    expect(locationForCampground({ lat: 44.85, lng: -92.77, label: 'Afton State Park' }, afton, noPin)).toBeNull();
    expect(locationForCampground({ lat: 44.85, lng: -92.77, label: '' }, afton, undefined)).toBeNull();
    expect(locationForCampground({ lat: 1, lng: 2, label: 'dispersed' }, afton, noPin)).toEqual({ lat: 1, lng: 2, label: 'dispersed' });
  });
});

describe('tripUpdateFromReservation', () => {
  const trip = { status: 'planned', startDate: null, endDate: null, campgroundId: 'campground:afton' } as unknown as Trip;
  const res = (over: Partial<Reservation>) =>
    ({ status: 'booked', arrivalDate: '2027-06-11', nights: 2, campgroundId: 'campground:afton', ...over }) as Reservation;

  it('sets trip dates and marks it booked', () => {
    const u = tripUpdateFromReservation(trip, res({}));
    expect(u?.trip).toMatchObject({ status: 'booked', startDate: '2027-06-11', endDate: '2027-06-13' });
    expect(u?.changes).toEqual(['start date', 'end date', 'status → booked']);
  });

  it('does nothing for a planned reservation or when already in step', () => {
    expect(tripUpdateFromReservation(trip, res({ status: 'planned' }))).toBeNull();
    const booked = { ...trip, status: 'booked', startDate: '2027-06-11', endDate: '2027-06-13' } as Trip;
    expect(tripUpdateFromReservation(booked, res({}))).toBeNull();
  });

  it('moves a booked trip back to planned when cancelled', () => {
    const booked = { ...trip, status: 'booked' } as Trip;
    expect(tripUpdateFromReservation(booked, res({ status: 'cancelled' }))?.trip.status).toBe('planned');
  });
});
