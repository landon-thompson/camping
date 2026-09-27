import type { SeedRecord } from '../../seed/types';
import { seed } from '../../seed/types';

/**
 * Starting records for the reservations feature: agency booking rules, a
 * curated campground directory for the five 2027 trips, and the state park
 * annual vehicle permit.
 *
 * SOURCING: this sandbox's network policy blocks every reservation/agency
 * domain named in the brief (dnr.state.mn.us, mndnr.gov, reservemn.usedirect.com,
 * fs.usda.gov, recreation.gov, ridb.recreation.gov) — confirmed by testing
 * plain HTTPS access to each with WebFetch/curl, which the egress proxy
 * rejects with a policy 403, and by testing an unrelated control domain
 * (example.com), which is rejected the same way. So nothing here could be
 * fetched and read directly from the official page. Every fact below was
 * instead gathered with WebSearch (which runs outside this sandbox) against
 * those same official domains and news coverage of DNR/USFS announcements,
 * and is cited by URL. Per the brief's instructions for a blocked site,
 * every `status` stays `verify` (never `verified`), every campground's
 * `location` is left `null` with a verify note instead of a guessed
 * coordinate, and `docs/phase-3.md` asks the coordinator/owner to
 * independently confirm this batch once they can reach the official pages.
 */

const MN_DNR_RESERVATIONS = 'https://www.mndnr.gov/reservations';
const RECREATION_GOV = 'https://www.recreation.gov/';

const bookingRules: SeedRecord[] = [
  seed('booking_rule', 'booking_rule:mn-state-park', {
    agency: 'mn-state-park',
    label: 'Minnesota state park',
    bookingSystem: 'reservemn',
    reservationRequired: true,
    windowDays: {
      value: 120,
      status: 'verify',
      source: 'From research on dnr.state.mn.us / mndnr.gov — not yet checked against the official page (see notes)',
      note: 'DNR FAQ: reservations open the same day as arrival and up to 120 days before.',
    },
    windowMonths: null,
    openTime: '08:00',
    timeZone: 'America/Chicago',
    rolling: true,
    maxNights: {
      value: 14,
      status: 'verify',
      source: 'From research on dnr.state.mn.us — not yet checked against the official page',
    },
    officialUrl: MN_DNR_RESERVATIONS,
    phone: '866-857-2757',
    notes: [
      'On the first day a date becomes bookable, online reservations cannot be made before 8:00 AM Central; every other day the system is open 24/7.',
      'Every campsite in a Minnesota state park requires a reservation (same-day is fine, but walk-up-without-reserving is not allowed).',
      'A Minnesota state park vehicle permit is required in addition to the campsite reservation.',
      'The $8 online / $10 phone reservation fee is non-refundable; same-day reservations have no reservation fee.',
      'The DNR publishes an official "notify me" cancellation alert for sold-out dates — set it on the reservation page rather than refreshing manually.',
    ],
    source: `${MN_DNR_RESERVATIONS} and dnr.state.mn.us/reserve-faq — from research, not read directly; verify the exact window/fee figures there.`,
    status: 'verify',
  }),

  seed('booking_rule', 'booking_rule:mn-state-forest', {
    agency: 'mn-state-forest',
    label: 'Minnesota state forest campground',
    bookingSystem: 'first-come',
    reservationRequired: false,
    windowDays: {
      value: null,
      status: 'verify',
      note: 'Individual/equestrian sites: no advance reservation. Group sites are the exception — see notes.',
    },
    windowMonths: null,
    openTime: null,
    timeZone: 'America/Chicago',
    rolling: false,
    maxNights: { value: null, status: 'verify', note: 'Not found in search results; verify on the official page.' },
    officialUrl: 'https://www.dnr.state.mn.us/state_forests/camping.html',
    phone: '866-857-2757',
    notes: [
      'Individual and equestrian state forest campsites are first-come, first-served — no reservation, no paying ahead of arrival day.',
      'As of the DNR’s April 2026 "same-day pay then stay" change, campers pay through Yodel (phone/QR) before occupying a site; this does not reserve a specific site — arrival-day site choice is still first-come.',
      'Group campsites ARE reservable, up to 120 days in advance at mndnr.gov/reservations (unlike individual sites).',
    ],
    source:
      'From research on dnr.state.mn.us/state_forests/fees_reservations.html and the DNR’s Apr 13, 2026 news release on the "same-day pay then stay" model — not yet checked against the official page; verify there.',
    status: 'verify',
  }),

  seed('booking_rule', 'booking_rule:usfs', {
    agency: 'usfs',
    label: 'US Forest Service developed campground (Recreation.gov)',
    bookingSystem: 'recreation-gov',
    reservationRequired: true,
    windowDays: { value: null, status: 'verify', note: 'Federal sites use a months-based rolling window; see windowMonths.' },
    windowMonths: {
      value: 6,
      status: 'verify',
      source: 'From research on recreation.gov / fs.usda.gov — not yet checked against the official page (see notes)',
      note: 'Typical Recreation.gov rolling window is 6 months out. Individual Superior/Chippewa NF campgrounds can differ — override per campground.',
    },
    openTime: '10:00',
    timeZone: 'America/New_York',
    rolling: true,
    maxNights: { value: 14, status: 'verify', note: 'Common USFS limit; confirm per campground/ranger district.' },
    officialUrl: RECREATION_GOV,
    phone: '877-444-6777',
    notes: [
      'New dates release daily on a rolling 6-month window, at 10:00 AM Eastern (7:00 AM Pacific) — not a fixed calendar release date.',
      'Window length varies by facility; some Chippewa NF campgrounds require booking at least 4 days ahead of arrival. Always check the specific campground page.',
      'Rustic/no-fee USFS campgrounds (fewer than ~10 sites) are typically first-come, first-served with no Recreation.gov listing at all — see each campground record’s own bookingSystem.',
    ],
    source:
      'From research on recreation.gov and the fs.usda.gov Superior/Chippewa National Forest pages — not yet checked against the official pages; verify the exact window there.',
    status: 'verify',
  }),

  seed('booking_rule', 'booking_rule:dispersed', {
    agency: 'other',
    label: 'Dispersed camping (national forest, outside BWCAW)',
    bookingSystem: 'dispersed',
    reservationRequired: false,
    windowDays: { value: null, status: 'verify' },
    windowMonths: null,
    openTime: null,
    timeZone: 'America/Chicago',
    rolling: false,
    maxNights: {
      value: 14,
      status: 'verify',
      source: 'From research on fs.usda.gov — not yet checked against the official page',
      note: 'Standard national-forest dispersed-camping stay limit (14 days in a 30-day period, then must move 5+ miles).',
    },
    officialUrl: 'https://www.fs.usda.gov/superior',
    phone: '218-626-4300',
    notes: [
      'No booking, no fee, no permit for dispersed camping outside the Boundary Waters Canoe Area Wilderness.',
      'Must be on a road designated open to motor vehicles on the current Motor Vehicle Use Map (MVUM) — never invent a road as open; check the current MVUM.',
      'Dispersed camping is not allowed inside the BWCAW (permit-only entry point system there, out of scope for this trip).',
      '14-day stay limit per site/area in a 30-day period is the general Superior National Forest rule; confirm for the specific ranger district.',
    ],
    source: 'From research on fs.usda.gov/superior and general USFS dispersed-camping guidance — not yet checked against the official page; verify there.',
    status: 'verify',
  }),
];

// -- Campgrounds --------------------------------------------------------
// location is left null everywhere: the brief requires coordinates to come
// from an official source, and every official source here is blocked from
// this sandbox (see file header). Add real lat/lng from the linked page once
// it's reachable.

const campgrounds: SeedRecord[] = [
  // (1) State park near Roseville with electric sites + boat launch.
  seed('campground', 'campground:william-obrien-riverway', {
    name: "William O'Brien State Park — Riverway Campground",
    agency: 'mn-state-park',
    bookingSystem: 'reservemn',
    unit: "William O'Brien State Park",
    location: null,
    bookingUrl: 'https://www.mndnr.gov/reservations',
    ridbFacilityId: null,
    windowDaysOverride: null,
    windowMonthsOverride: null,
    electric: true,
    boatLaunch: true,
    rules: [],
    verify:
      'Confirm current electric-site count/amperage, exact boat launch location and fees on the official DNR park page. Coordinates not set — read from the official page.',
    source:
      'From research summaries (thedyrt.com, outdoorithm.com, stcroix360.com) describing the Riverway campground (50-amp electric sites, RVs to 60 ft) and a boat ramp onto the St. Croix River; not yet confirmed on dnr.state.mn.us — verify there.',
    notes: '~30 min from Roseville, MN. Marine on St. Croix. Good fit for the shakedown/electric-site trip.',
  }),

  seed('campground', 'campground:wild-river-state-park', {
    name: 'Wild River State Park Campground',
    agency: 'mn-state-park',
    bookingSystem: 'reservemn',
    unit: 'Wild River State Park',
    location: null,
    bookingUrl: 'https://www.mndnr.gov/reservations',
    ridbFacilityId: null,
    windowDaysOverride: null,
    windowMonthsOverride: null,
    electric: true,
    boatLaunch: true,
    rules: [],
    verify: 'Confirm current electric-site count (research found 34 of 94 sites), boat launch details and fees on the official page. No coordinates set.',
    source:
      'From research summaries describing 94 drive-up sites (34 electric, 50-amp) and a boat launch at Sunrise Landing plus a southern St. Croix River ramp; not yet confirmed on dnr.state.mn.us — verify there.',
    notes: 'Alternative to William O’Brien for trip 1 — Sunrise/Center City, MN, on the St. Croix.',
  }),

  // (2) Non-electric lake campground (June trip).
  seed('campground', 'campground:bear-head-lake', {
    name: 'Bear Head Lake State Park Campground',
    agency: 'mn-state-park',
    bookingSystem: 'reservemn',
    unit: 'Bear Head Lake State Park',
    location: null,
    bookingUrl: 'https://www.mndnr.gov/reservations',
    ridbFacilityId: null,
    windowDaysOverride: null,
    windowMonthsOverride: null,
    electric: false,
    boatLaunch: true,
    rules: [],
    verify:
      'Research found both electric and non-electric loops (24 non-electric sites, sites 1–24); confirm which loop/site numbers are non-electric and the boat launch (canoe/kayak only or trailer) on the official page. No coordinates set.',
    source: 'From research summaries (thedyrt.com, campendium.com, the DNR virtual tour page); not yet confirmed on dnr.state.mn.us — verify there.',
    notes: 'Near Ely/Tower, MN. Good June, non-electric, on-a-lake candidate — swimming beach and a public boat launch on Bear Head Lake.',
  }),

  seed('campground', 'campground:mccarthy-beach-beatrice-lake', {
    name: 'McCarthy Beach State Park — Beatrice Lake Campground',
    agency: 'mn-state-park',
    bookingSystem: 'reservemn',
    unit: 'McCarthy Beach State Park',
    location: null,
    bookingUrl: 'https://www.mndnr.gov/reservations',
    ridbFacilityId: null,
    windowDaysOverride: null,
    windowMonthsOverride: null,
    electric: false,
    boatLaunch: true,
    rules: [],
    verify: 'Beatrice Lake loop is rustic/non-electric per research results; confirm on the official page. No coordinates set.',
    source: 'From research summaries (thedyrt.com, outdoorithm.com) describing the rustic Beatrice Lake loop and its adjacent boat landing; not yet confirmed on dnr.state.mn.us — verify there.',
    notes: 'Alternative to Bear Head Lake for trip 2 — Side Lake/Chisholm, MN, on the Sturgeon chain of lakes.',
  }),

  // (3) Superior/Chippewa NF rustic campground with a lake + boat launch on gravel roads.
  seed('campground', 'campground:wilson-lake-rustic', {
    name: 'Wilson Lake Rustic Campground',
    agency: 'usfs',
    bookingSystem: 'first-come',
    unit: 'Superior National Forest',
    location: null,
    bookingUrl: 'https://www.fs.usda.gov/r09/superior/recreation/wilson-lake-rustic-campground-backcountry-sites',
    ridbFacilityId: null,
    windowDaysOverride: null,
    windowMonthsOverride: null,
    electric: false,
    boatLaunch: true,
    rules: [],
    verify: 'Confirm the exact gravel forest-road route, season dates and site count on the official page. No coordinates set.',
    source:
      'From a research summary of the fs.usda.gov Wilson Lake Rustic Campground page: 4 sites, free, first-come first-served, drive-down boat ramp with a dock, ~30–45 min on graded gravel forest roads off Hwy 61, no reservations; open May 8–Oct 1 in the 2026 season — not yet checked against the official page.',
    notes: 'Primary candidate for the rustic/lake/gravel-road trip. No fee, no reservation — arrive early on busy weekends.',
  }),

  seed('campground', 'campground:baker-lake-rustic', {
    name: 'Baker Lake Rustic Campground',
    agency: 'usfs',
    bookingSystem: 'first-come',
    unit: 'Superior National Forest',
    location: null,
    bookingUrl: 'https://www.fs.usda.gov/r09/superior/recreation',
    ridbFacilityId: null,
    windowDaysOverride: null,
    windowMonthsOverride: null,
    electric: false,
    boatLaunch: true,
    rules: [],
    verify: 'Confirm boat launch type (canoe vs. trailer) and gravel-road access, season dates and site count on the official page. No coordinates set.',
    source: 'From a research summary noting Baker Lake Rustic Campground sits on Baker Lake with a solar-powered drinking-water faucet, an uncommon amenity for a rustic site (fs.usda.gov) — not yet checked against the official page.',
    notes: 'Alternate rustic/lake candidate for trip 3, off the Sawbill Trail area.',
  }),

  seed('campground', 'campground:winnie-chippewa', {
    name: 'Winnie Campground',
    agency: 'usfs',
    bookingSystem: 'recreation-gov',
    unit: 'Chippewa National Forest',
    location: null,
    bookingUrl: 'https://www.recreation.gov/camping/campgrounds/233144',
    ridbFacilityId: '233144',
    windowDaysOverride: null,
    windowMonthsOverride: null,
    electric: false,
    boatLaunch: true,
    rules: [],
    verify:
      'Facility id found through research, not yet confirmed against the live RIDB API — re-check with the in-app RIDB search once a key is set up.',
    source: 'From a research summary: 33 reservable sites on the west shore of Lake Winnibigoshish, boat ramp and harbor next to the campground (recreation.gov) — not yet checked against the official page.',
    notes: 'Reservable federal alternative to the rustic Superior NF sites for trip 3 — books via Recreation.gov, 6-month rolling window.',
  }),

  seed('campground', 'campground:norway-beach-chippewa-loop', {
    name: 'Chippewa Loop — Norway Beach Recreation Area',
    agency: 'usfs',
    bookingSystem: 'recreation-gov',
    unit: 'Chippewa National Forest',
    location: null,
    bookingUrl: 'https://www.recreation.gov/camping/campgrounds/232150',
    ridbFacilityId: '232150',
    windowDaysOverride: null,
    windowMonthsOverride: null,
    electric: true,
    boatLaunch: true,
    rules: [],
    verify:
      'Facility id found through research, not yet confirmed against the live RIDB API — re-check with the in-app RIDB search once a key is set up.',
    source:
      'From a research summary: Chippewa Loop is the only electric loop (30 of 46 sites, 50 amp) of Norway Beach’s four loops on Cass Lake; boat ramps, sandy beach, flush toilets/showers; loop is open ~May 13–Oct 25 (recreation.gov) — not yet checked against the official page.',
    notes: 'A federal, electric, boat-launch alternative near Cass Lake, MN.',
  }),

  // (4) Lake Vermilion Hinsdale Island boat-in sites (free, first-come).
  seed('campground', 'campground:hinsdale-island', {
    name: 'Hinsdale Island Boat-in Campsites',
    agency: 'mn-state-forest',
    bookingSystem: 'first-come',
    unit: 'Kabetogama State Forest (Lake Vermilion)',
    location: null,
    bookingUrl: 'https://www.dnr.state.mn.us/state_parks/soudan_underground_mine/index.html',
    ridbFacilityId: null,
    windowDaysOverride: null,
    windowMonthsOverride: null,
    electric: false,
    boatLaunch: true,
    rules: [],
    verify:
      'The plan said this was a USFS site, but research consistently places Hinsdale Island in the state-managed Kabetogama State Forest, administered from Soudan Underground Mine State Park (not Superior National Forest) — recorded here as mn-state-forest; confirm the managing agency on an official page. Also confirm exact site count/location.',
    source:
      'From research summaries (hipcamp.com, exploreminnesota.com and a DNR-hosted Hinsdale Island PDF map): 11 primitive boat-in sites (cleared area, fire ring, bear box, primitive toilet, table), free, first-come first-served, 14-day stay limit; contact Soudan Underground Mine SP at 218-753-2245 — not yet checked against the official dnr.state.mn.us pages.',
    notes: 'Boat-in only — no vehicle access. Free, no reservation. Good fit for the off-grid-adjacent Lake Vermilion trip.',
  }),

  // (5) Superior NF dispersed — Norway Point on the St. Louis River.
  seed('campground', 'campground:norway-point-dispersed', {
    name: 'Norway Point (dispersed, St. Louis River)',
    agency: 'usfs',
    bookingSystem: 'dispersed',
    unit: 'Superior National Forest',
    location: null,
    bookingUrl: 'https://www.fs.usda.gov/r09/superior/recreation/norway-point',
    ridbFacilityId: null,
    windowDaysOverride: null,
    windowMonthsOverride: null,
    electric: false,
    boatLaunch: true,
    rules: [],
    verify:
      'This is a dispersed/boat-in site next to a developed boat launch and picnic area, not a reservable campground — confirm current road access (must be on an MVUM-designated route) and that it is outside the BWCAW on the official fs.usda.gov page. No coordinates set.',
    source:
      'From a research summary of the fs.usda.gov Norway Point recreation-site page: picnic area and boat launch on the St. Louis River, a dispersed campsite reachable on foot from the boat launch or by boat, plus a separate boat-in-only site east of the launch; no potable water; ranger station (218) 453-8650 — not yet checked against the official page.',
    notes: 'No booking needed — dispersed, first-come. Pack out water and trash; verify the current MVUM before driving in.',
  }),
];

const permit: SeedRecord = seed('permit', 'permit:mn-state-park-annual-2027', {
  name: 'Minnesota state park annual vehicle permit',
  year: 2027,
  have: false,
  expires: null,
  notes:
    'Required for every vehicle entering a Minnesota state park or recreation area, in addition to any campsite reservation — buy at mndnr.gov/reservations, by phone (866-857-2757), or at a park office. Price/expiration not yet checked against the official page — verify before the season.',
});

export const reservationSeeds: SeedRecord[] = [...bookingRules, ...campgrounds, permit];
