import { describe, expect, it } from 'vitest';
import { allowedGisUrl } from './gisProxy';

describe('GIS proxy allowlist', () => {
  it('allows only layers/query JSON requests to the state map services', () => {
    const dnr = 'https://arcgis.dnr.state.mn.us/host/rest/services/Hosted/DNR_Division_of_Parks_and_Trails_Area_Boundaries/FeatureServer';
    expect(allowedGisUrl(`${dnr}/layers?f=json`)).not.toBeNull();
    expect(allowedGisUrl(`${dnr}/0/query?where=1%3D1&outFields=*&f=json`)).not.toBeNull();
    expect(allowedGisUrl('http://arcgis.dnr.state.mn.us/mndnr/rest/services/slam/SLAM_App_Layers/MapServer/layers?f=json')).not.toBeNull();
    expect(allowedGisUrl('https://gis.metc.state.mn.us/arcgis/rest/services/LPH/Parks/MapServer/3/query?f=json')).not.toBeNull();
    expect(allowedGisUrl('https://www.arcgis.com/sharing/rest/content/items/a42128766db2447cb77a247d4a074173?f=json')).not.toBeNull();
    expect(allowedGisUrl('https://services1.arcgis.com/AbC123/arcgis/rest/services/State_Parks/FeatureServer/0/query?where=1%3D1&f=json')).not.toBeNull();
    expect(allowedGisUrl('https://enterprise.gisdata.mn.gov/aghost/rest/services/us_mn_state_dnr/bdry_dnr_lrs_prk/FeatureServer/layers?f=json')).not.toBeNull();
    expect(allowedGisUrl('https://www.arcgis.com/sharing/rest/content/users/x?f=json')).toBeNull();
  });

  it('refuses anything else', () => {
    const dnr = 'https://arcgis.dnr.state.mn.us/host/rest/services/Hosted/X/FeatureServer';
    expect(allowedGisUrl(null)).toBeNull();
    expect(allowedGisUrl('https://evil.example.com/rest/services/X/FeatureServer/layers?f=json')).toBeNull();
    expect(allowedGisUrl(`${dnr}/0/applyEdits?f=json`)).toBeNull();
    expect(allowedGisUrl(`${dnr}/0/query?f=html`)).toBeNull();
    expect(allowedGisUrl(`${dnr}/../../admin/layers?f=json`)).toBeNull();
    expect(allowedGisUrl('https://user:pw@arcgis.dnr.state.mn.us/host/rest/services/X/FeatureServer/layers?f=json')).toBeNull();
    expect(allowedGisUrl('file:///etc/passwd')).toBeNull();
  });

  it('allows DNR LakeFinder lookups and USFS recreation sites, nothing else on those hosts', () => {
    expect(allowedGisUrl('https://maps.dnr.state.mn.us/cgi-bin/lakefinder/detail.cgi?type=lake_survey&id=69025400')).not.toBeNull();
    expect(allowedGisUrl('https://maps.dnr.state.mn.us/cgi-bin/lakefinder/detail.cgi?type=other&id=69025400')).toBeNull();
    expect(allowedGisUrl('https://maps.dnr.state.mn.us/cgi-bin/lakefinder/detail.cgi?type=lake_survey&id=../x')).toBeNull();
    expect(allowedGisUrl('https://services.dnr.state.mn.us/api/lakefinder/by_point/v1?lat=47.8&lon=-92.1&radius=3000')).not.toBeNull();
    expect(allowedGisUrl('https://services.dnr.state.mn.us/api/lakefinder/by_point/v1?lat=abc&lon=-92.1')).toBeNull();
    expect(allowedGisUrl('https://services.dnr.state.mn.us/api/lakefinder/by_name/v1?name=Bear%20Head')).not.toBeNull();
    expect(allowedGisUrl('https://services.dnr.state.mn.us/api/other/v1?name=x')).toBeNull();
    expect(allowedGisUrl('https://apps.fs.usda.gov/arcx/rest/services/EDW/EDW_RecreationOpportunities_01/MapServer/0/query?where=1%3D1&f=json')).not.toBeNull();
    expect(allowedGisUrl('https://apps.fs.usda.gov/arcx/rest/services/EDW/EDW_RecreationOpportunities_01/MapServer/0/query?f=html')).toBeNull();
  });
});
