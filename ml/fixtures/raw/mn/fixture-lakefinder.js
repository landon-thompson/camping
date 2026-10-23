// Synthetic fixture script (not LakeFinder's real code).
function loadSurvey(id){ return get('/cgi-bin/lakefinder/detail.cgi?type=lake_survey&callback=&id=' + id); }
function loadStocking(id){ return get('/cgi-bin/lakefinder/detail.cgi?type=fixture_fish_stocking&callback=&id=' + id); }
function loadRegs(id){ return get('/cgi-bin/lakefinder/detail.cgi?type=fixture_special_regs&callback=&id=' + id); }
