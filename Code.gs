/**
 * BSL (HRCF) - Maintenance Log System
 * Google Apps Script backend
 *
 * Sheets required:
 *   Users
 *   MaintenanceLogs
 *   Employees
 *   Shifts
 *   Equipment
 *   Areas
 *
 * Main sheet headers:
 * Users:
 *   UserID | Name | Email | Password | User Active | Reset Request
 * Optional extra user-detail columns are created automatically when needed:
 *   Department | Designation | Mobile No | Employee Type
 *
 * MaintenanceLogs:
 *   LogID | Date | Shift | Start Time | End Time | Area / Location |
 *   Equipment / Subsystem | Problem Description | Solution Taken |
 *   Status | Remarks
 *
 * Employees:
 *   EmployeeID | Name | Designation | Phone
 *
 * Shifts:
 *   ShiftID | Shift Name | Start Time | End Time | Shift Incharge
 *
 * Equipment:
 *   Equipment / Subsystem | Area / Location
 *
 * Areas:
 *   Area / Location
 */

function doGet(e) {
  if (e && e.parameter && e.parameter.api === '1') {
    try { return apiResponse_(apiDispatch_(e.parameter.action || '', e.parameter)); }
    catch (err) { return apiResponse_({success:false,message:String(err.message || err)}); }
  }
  var template = HtmlService.createTemplateFromFile('Index');
  template.loginBackground = getSteelPlantImage();
  return template.evaluate()
    .setTitle('BSL (HRCF) - Maintenance Log System')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function doPost(e) {
  try {
    var body = e && e.postData && e.postData.contents ? JSON.parse(e.postData.contents) : {};
    return apiResponse_(apiDispatch_(body.action || '', body));
  } catch (err) {
    return apiResponse_({success:false,message:String(err.message || err)});
  }
}

function apiResponse_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function apiDispatch_(action, p) {
  p = p || {};
  if (action === 'login') return loginUser(p.staffNo, p.password);
  if (action === 'newUser') return newUserCheck_(p.staffNo);
  if (action === 'setFirstPassword') return setFirstPassword(p.staffNo, p.password);
  if (action === 'requestPasswordReset') return requestPasswordReset(p.staffNo);
  if (action === 'dashboard') return getDashboard();
  if (action === 'areas') return getAreas();
  if (action === 'equipment') return getEquipment();
  if (action === 'logs') return getLogs();
  if (action === 'report') return getDailyShiftReport_(p.date, p.shift);
  if (action === 'employees') return getEmployees();
  if (action === 'profile') return getProfileForNewApp_(p.staffNo);
  if (action === 'saveProfile') return saveEmployeeDetails(p.details || {});
  if (action === 'shiftDetails') return getShiftDetails();
  if (action === 'shiftCrew') return getShiftCrewDetails(p.date, p.shift);
  if (action === 'allShiftCrew') return getAllShiftCrewForDate(p.date);
  if (action === 'saveShiftCrew') return saveShiftCrewDetails(p.details || {});
  if (action === 'saveLog') return saveMaintenanceLogPwa_(p.log || {});
  if (action === 'updateLog') return updateMaintenanceLogPwa_(p.log || {}, p.sessionToken || '', p.staffNo || '');
  throw new Error('Unknown API action: ' + action);
}

function getDailyShiftReport_(date, shift) {
  return getDailyShiftReport(date, shift);
}

function saveMaintenanceLogPwa_(log) {
  // Preserve the original sheet format while adding the extra PWA fields when possible.
  var result = saveMaintenanceLog(log);
  if (!result || !result.success) return result;
  var sheet = getSheet_(SHEETS.LOGS);
  var map = ensurePwaLogColumns_(sheet);
  var data = valuesWithHeaders_(sheet);
  var idCol = findHeader_(data.map, ['LogID']);
  var rowIndex = -1;
  for (var i = 0; i < data.rows.length; i++) {
    if (normalize_(data.rows[i][idCol]) === result.logId) { rowIndex = i + 2; break; }
  }
  if (rowIndex > 0) {
    var vals = {
      'Shift In-charge': log.shiftIncharge || '',
      'Employee': log.employee || '',
      'Breakdown Type': log.breakdownType || '',
      'Spare / Material Used': log.spareMaterial || '',
      'Downtime (min)': log.downtime || '',
      'Staff No': log.staffNo || ''
    };
    Object.keys(vals).forEach(function(h){ if(map[h] >= 0) sheet.getRange(rowIndex,map[h]+1).setValue(vals[h]); });
  }
  return result;
}

function ensurePwaLogColumns_(sheet) {
  var names=['Shift In-charge','Employee','Breakdown Type','Spare / Material Used','Downtime (min)','Staff No'];
  var map=headerMap_(sheet); var last=sheet.getLastColumn();
  names.forEach(function(n){ if(map[n]===undefined){ last++; sheet.getRange(1,last).setValue(n); map[n]=last-1; }});
  return map;
}


/* =========================================================
   CONFIG
========================================================= */

var SHEETS = {
  USERS: 'Users',
  LOGS: 'MaintenanceLogs',
  EMPLOYEES: 'Employees',
  SHIFTS: 'Shifts',
  EQUIPMENT: 'Equipment',
  AREAS: 'Areas'
};

var STATUS_VALUES = ['Completed', 'Pending', 'Overlook'];
var EMPLOYEE_TYPES = ['Executive', 'Non-Executive', 'Contract Worker'];

// Employee Details permissions:
// - Every logged-in employee may edit ONLY their own profile.
// - Staff No 806432 is the administrator and may add/edit/delete all employee records.
var ADMIN_STAFF_NO = '806432';
var SESSION_TTL_SECONDS = 21600; // 6 hours

function getSessionSecret_() {
  var props = PropertiesService.getScriptProperties();
  var secret = props.getProperty('BSL_HRCF_SESSION_SECRET');
  if (!secret) {
    secret = Utilities.getUuid() + '|' + Utilities.getUuid();
    props.setProperty('BSL_HRCF_SESSION_SECRET', secret);
  }
  return secret;
}

function createSessionToken_(staffNo) {
  var payload = normalize_(staffNo) + '|' + new Date().getTime() + '|' + Utilities.getUuid();
  var signature = Utilities.computeHmacSha256Signature(payload, getSessionSecret_());
  var sig = Utilities.base64EncodeWebSafe(signature);
  var token = Utilities.base64EncodeWebSafe(payload + '|' + sig);
  CacheService.getScriptCache().put('bsl_session_' + sha256_(token), normalize_(staffNo), SESSION_TTL_SECONDS);
  return token;
}

function sessionStaffNo_(token) {
  token = normalize_(token);
  if (!token) return '';
  return normalize_(CacheService.getScriptCache().get('bsl_session_' + sha256_(token)) || '');
}

function authorizeEmployeeAction_(sessionToken, targetStaffNo, adminOnly) {
  var actor = sessionStaffNo_(sessionToken);
  if (!actor) return { ok: false, message: 'Session expired. Please login again.' };
  targetStaffNo = normalize_(targetStaffNo);

  if (adminOnly) {
    if (actor !== ADMIN_STAFF_NO) {
      return { ok: false, message: 'Only the authorized administrator can manage other employee records.' };
    }
    return { ok: true, staffNo: actor, isAdmin: true };
  }

  if (actor === ADMIN_STAFF_NO || actor === targetStaffNo) {
    return { ok: true, staffNo: actor, isAdmin: actor === ADMIN_STAFF_NO };
  }

  return { ok: false, message: 'You can edit only your own Employee Details.' };
}

var DEPARTMENT_VALUES = ['Electrical', 'Mechanical', 'Operation', 'Others'];
var EXECUTIVE_DESIGNATIONS = ['Assistant Manager', 'Manager', 'Senior Manager', 'Assistant General Manager (AGM)', 'Deputy General Manager (DGM)'];
var NON_EXECUTIVE_DESIGNATIONS = ['Jr. Engineer', 'Engineering Associate', 'Jr. Engineering Associate', 'Technical Associate'];
var CONTRACT_DESIGNATIONS = ['Contract Worker'];

function designationValid_(employeeType, designation) {
  designation = normalize_(designation);
  if (employeeType === 'Executive') return EXECUTIVE_DESIGNATIONS.indexOf(designation) >= 0;
  if (employeeType === 'Non-Executive') return NON_EXECUTIVE_DESIGNATIONS.indexOf(designation) >= 0;
  if (employeeType === 'Contract Worker') return CONTRACT_DESIGNATIONS.indexOf(designation) >= 0;
  return false;
}


/* =========================================================
   GENERAL HELPERS
========================================================= */

var SPREADSHEET_ID = 'PASTE_YOUR_GOOGLE_SHEET_ID_HERE';
function getSS_(){ if(!SPREADSHEET_ID || SPREADSHEET_ID.indexOf('PASTE_')===0) throw new Error('Set SPREADSHEET_ID in Code.gs.'); return SpreadsheetApp.openById(SPREADSHEET_ID); }

function getSheet_(name) {
  var sheet = getSS_().getSheetByName(name);
  if (!sheet) {
    throw new Error('Sheet not found: ' + name);
  }
  return sheet;
}

function normalize_(value) {
  return String(value == null ? '' : value).trim();
}

function headerMap_(sheet) {
  var lastColumn = Math.max(sheet.getLastColumn(), 1);
  var headers = sheet.getRange(1, 1, 1, lastColumn).getValues()[0];
  var map = {};
  headers.forEach(function (h, i) {
    var key = normalize_(h);
    if (key) map[key] = i;
  });
  return map;
}

function valuesWithHeaders_(sheet) {
  var lastRow = sheet.getLastRow();
  var lastColumn = Math.max(sheet.getLastColumn(), 1);
  if (lastRow < 1) {
    return { headers: [], rows: [], map: {} };
  }
  var values = sheet.getRange(1, 1, lastRow, lastColumn).getValues();
  var headers = values[0].map(normalize_);
  var map = {};
  headers.forEach(function (h, i) {
    if (h) map[h] = i;
  });
  return {
    headers: headers,
    rows: values.slice(1),
    map: map
  };
}

function findHeader_(map, names) {
  for (var i = 0; i < names.length; i++) {
    if (map[names[i]] !== undefined) return map[names[i]];
  }
  return -1;
}

function rowValue_(row, map, names) {
  var index = findHeader_(map, names);
  return index >= 0 ? row[index] : '';
}

function formatDate_(value, pattern) {
  if (!value) return '';
  if (Object.prototype.toString.call(value) === '[object Date]' && !isNaN(value.getTime())) {
    return Utilities.formatDate(value, Session.getScriptTimeZone(), pattern || 'yyyy-MM-dd');
  }
  return normalize_(value);
}

function formatTime_(value) {
  if (!value) return '';
  if (Object.prototype.toString.call(value) === '[object Date]' && !isNaN(value.getTime())) {
    return Utilities.formatDate(value, Session.getScriptTimeZone(), 'HH:mm');
  }
  return normalize_(value);
}

function todayString_() {
  return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
}

function shiftFromTime_(timeValue) {
  var text = normalize_(timeValue);
  if (!text) return '';
  var m = text.match(/^(\d{1,2})(?::(\d{2}))?/);
  if (!m) return '';
  var hour = Number(m[1]);
  if (hour >= 6 && hour < 14) return 'A Shift';
  if (hour >= 14 && hour < 22) return 'B Shift';
  return 'C Shift';
}

function sha256_(text) {
  var bytes = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    String(text),
    Utilities.Charset.UTF_8
  );
  return bytes.map(function (b) {
    var v = b < 0 ? b + 256 : b;
    return ('0' + v.toString(16)).slice(-2);
  }).join('');
}

function passwordValid_(password) {
  password = String(password || '');
  return password.length >= 8 &&
    /[A-Z]/.test(password) &&
    /[a-z]/.test(password) &&
    /[0-9]/.test(password) &&
    /[^A-Za-z0-9]/.test(password);
}

function ensureUserDetailColumns_(sheet) {
  var required = ['Department', 'Designation', 'Mobile No', 'Employee Type'];
  var map = headerMap_(sheet);
  var lastColumn = sheet.getLastColumn();
  required.forEach(function (name) {
    if (map[name] === undefined) {
      lastColumn++;
      sheet.getRange(1, lastColumn).setValue(name);
      map[name] = lastColumn - 1;
    }
  });
  return map;
}

function generateLogId_() {
  return 'LOG-' + Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyyMMdd-HHmmss') + '-' +
    Math.floor(Math.random() * 900 + 100);
}

/* =========================================================
   STEEL PLANT LOGIN IMAGE
========================================================= */

function getSteelPlantImage() {
  var cache = CacheService.getScriptCache();
  var cached = cache.get('steel_plant_image_data');
  if (cached) return cached;

  var fileNames = ['steel_plant.png', 'steel_plant.jpg', 'steel_plant.jpeg'];
  for (var i = 0; i < fileNames.length; i++) {
    var files = DriveApp.getFilesByName(fileNames[i]);
    if (files.hasNext()) {
      var file = files.next();
      var blob = file.getBlob();
      var data = 'data:' + blob.getContentType() + ';base64,' + Utilities.base64Encode(blob.getBytes());
      // Apps Script CacheService has a value-size limit; cache only when it fits.
      if (data.length < 95000) cache.put('steel_plant_image_data', data, 21600);
      return data;
    }
  }
  return '';
}

/* =========================================================
   LOGIN
========================================================= */

function loginUser(staffNo, password) {
  staffNo = normalize_(staffNo);
  password = String(password || '');

  if (!/^\d{6}$/.test(staffNo)) {
    return { success: false, message: 'Staff No must be exactly 6 digits.' };
  }

  var sheet = getSheet_(SHEETS.USERS);
  var data = valuesWithHeaders_(sheet);
  var idCol = findHeader_(data.map, ['UserID', 'Staff No', 'StaffNo']);
  var nameCol = findHeader_(data.map, ['Name', 'Employee Name']);
  var emailCol = findHeader_(data.map, ['Email']);
  var passCol = findHeader_(data.map, ['Password']);
  var activeCol = findHeader_(data.map, ['User Active', 'Active']);

  if (idCol < 0 || passCol < 0) {
    throw new Error('Users sheet must contain UserID and Password headers.');
  }

  for (var i = 0; i < data.rows.length; i++) {
    var row = data.rows[i];
    var id = normalize_(row[idCol]);
    if (id !== staffNo) continue;

    if (activeCol >= 0) {
      var active = normalize_(row[activeCol]).toLowerCase();
      if (active && active !== 'yes' && active !== 'true' && active !== 'active' && active !== '1') {
        return { success: false, message: 'This user is inactive. Please contact administrator.' };
      }
    }

    var storedPassword = normalize_(row[passCol]);
    var result = {
      success: true,
      staffNo: staffNo,
      name: nameCol >= 0 ? normalize_(row[nameCol]) : '',
      email: emailCol >= 0 ? normalize_(row[emailCol]) : '',
      department: rowValue_(row, data.map, ['Department']),
      mobile: rowValue_(row, data.map, ['Mobile No', 'Mobile', 'Phone']),
      employeeType: rowValue_(row, data.map, ['Employee Type', 'Employee Type ']),
      designation: rowValue_(row, data.map, ['Designation']),
      isAdmin: staffNo === ADMIN_STAFF_NO
    };

    if (!storedPassword) {
      // The staff number has been found. A short-lived session lets this same
      // user complete first-time password/profile setup, but not another user's profile.
      result.sessionToken = createSessionToken_(staffNo);
      result.firstTime = true;
      result.message = 'First-time user. Please create your password.';
      return result;
    }

    if (sha256_(password) !== storedPassword) {
      return { success: false, message: 'Invalid Staff No or Password.' };
    }

    result.sessionToken = createSessionToken_(staffNo);
    result.firstTime = false;
    return result;
  }

  return { success: false, message: 'Invalid Staff No or Password.' };
}


function setFirstPassword(staffNo, password) {
  staffNo = normalize_(staffNo);
  if (!/^\d{6}$/.test(staffNo)) {
    return { success: false, message: 'Invalid Staff No.' };
  }
  if (!passwordValid_(password)) {
    return { success: false, message: 'Password does not meet all requirements.' };
  }

  var sheet = getSheet_(SHEETS.USERS);
  var data = valuesWithHeaders_(sheet);
  var idCol = findHeader_(data.map, ['UserID', 'Staff No', 'StaffNo']);
  var passCol = findHeader_(data.map, ['Password']);
  if (idCol < 0 || passCol < 0) throw new Error('Users sheet headers are incomplete.');

  for (var i = 0; i < data.rows.length; i++) {
    if (normalize_(data.rows[i][idCol]) === staffNo) {
      if (normalize_(data.rows[i][passCol])) {
        return { success: false, message: 'Password already exists. Use Forgot Password if you need a reset.' };
      }
      sheet.getRange(i + 2, passCol + 1).setValue(sha256_(password));
      var resetCol = findHeader_(data.map, ['Reset Request']);
      if (resetCol >= 0) sheet.getRange(i + 2, resetCol + 1).clearContent();
      return { success: true, message: 'Password created successfully.', sessionToken: createSessionToken_(staffNo) };
    }
  }
  return { success: false, message: 'Staff No not found.' };
}


/* =========================================================
   EMPLOYEE DETAILS
========================================================= */

function saveEmployeeDetails(details) {
  details = details || {};
  var staffNo = normalize_(details.staffNo);
  var sessionToken = normalize_(details.sessionToken);
  var department = normalize_(details.department);
  var designation = normalize_(details.designation);
  var mobile = normalize_(details.mobile);
  var employeeType = normalize_(details.employeeType);
  if (!/^\d{6}$/.test(staffNo)) return {success:false,message:'Invalid Staff No.'};
  var auth = authorizeEmployeeAction_(sessionToken, staffNo, false);
  if (!auth.ok) return {success:false,message:auth.message};
  if (DEPARTMENT_VALUES.indexOf(department)===-1) return {success:false,message:'Please select a valid Department.'};
  if (EMPLOYEE_TYPES.indexOf(employeeType)===-1) return {success:false,message:'Please select a valid Employee Type.'};
  if (!designationValid_(employeeType, designation)) return {success:false,message:'Please select a valid Designation.'};
  if (!/^\d{10}$/.test(mobile)) return {success:false,message:'Please enter a valid 10 digit mobile number.'};

  // Name is intentionally read only from Users master.
  var userSheet=getSheet_(SHEETS.USERS), ud=valuesWithHeaders_(userSheet);
  var idCol=findHeader_(ud.map,['UserID','Staff No','StaffNo']), nameCol=findHeader_(ud.map,['Name','Employee Name']), emailCol=findHeader_(ud.map,['Email']);
  var masterName='',email='';
  for(var i=0;i<ud.rows.length;i++){
    if(normalize_(ud.rows[i][idCol])===staffNo){ masterName=nameCol>=0?normalize_(ud.rows[i][nameCol]):''; email=emailCol>=0?normalize_(ud.rows[i][emailCol]):''; break; }
  }
  if(!masterName) return {success:false,message:'Employee Name is not available in Users master.'};
  upsertEmployeeRecord_(staffNo,masterName,department,designation,mobile,employeeType,email);
  return {success:true,staffNo:staffNo,name:masterName,department:department,designation:designation,mobile:mobile,employeeType:employeeType,email:email};
}


function newUserCheck_(staffNo){
  staffNo=normalize_(staffNo);
  if(!/^\d{6}$/.test(staffNo)) return {success:false,message:'Staff No must be exactly 6 digits.'};
  var s=getSheet_(SHEETS.USERS),d=valuesWithHeaders_(s),idCol=findHeader_(d.map,['UserID','Staff No','StaffNo']),passCol=findHeader_(d.map,['Password']),nameCol=findHeader_(d.map,['Name','Employee Name']);
  for(var i=0;i<d.rows.length;i++) if(normalize_(d.rows[i][idCol])===staffNo){
    if(normalize_(d.rows[i][passCol])) return {success:false,message:'This Staff No is already registered. Please use Login.'};
    return {success:true,staffNo:staffNo,name:nameCol>=0?normalize_(d.rows[i][nameCol]):''};
  }
  return {success:false,message:'Staff No not found in Users master. Please contact administrator.'};
}

function getProfileForNewApp_(staffNo){
  staffNo=normalize_(staffNo);
  var u=getSheet_(SHEETS.USERS),ud=valuesWithHeaders_(u),idCol=findHeader_(ud.map,['UserID','Staff No','StaffNo']),nameCol=findHeader_(ud.map,['Name','Employee Name']),emailCol=findHeader_(ud.map,['Email']);
  var out={staffNo:staffNo,name:'',email:'',department:'',designation:'',mobile:'',employeeType:'',departments:DEPARTMENT_VALUES};
  for(var i=0;i<ud.rows.length;i++) if(normalize_(ud.rows[i][idCol])===staffNo){out.name=nameCol>=0?normalize_(ud.rows[i][nameCol]):'';out.email=emailCol>=0?normalize_(ud.rows[i][emailCol]):'';break;}
  var e=getEmployeeByStaffNo_(staffNo);
  if(e){out.department=e.department||'';out.designation=e.designation||'';out.mobile=e.mobile||'';out.employeeType=e.employeeType||'';if(e.email)out.email=e.email;}
  return out;
}


/* =========================================================
   PASSWORD RESET REQUEST
========================================================= */

function requestPasswordReset(staffNo) {
  staffNo = normalize_(staffNo);
  if (!/^\d{6}$/.test(staffNo)) {
    return { success: false, message: 'Enter exactly 6 digit Staff No.' };
  }

  var sheet = getSheet_(SHEETS.USERS);
  var data = valuesWithHeaders_(sheet);
  var idCol = findHeader_(data.map, ['UserID', 'Staff No', 'StaffNo']);
  var resetCol = findHeader_(data.map, ['Reset Request']);
  if (idCol < 0 || resetCol < 0) throw new Error('Users sheet must contain UserID and Reset Request.');

  for (var i = 0; i < data.rows.length; i++) {
    if (normalize_(data.rows[i][idCol]) === staffNo) {
      sheet.getRange(i + 2, resetCol + 1).setValue(new Date());
      return { success: true, message: 'Password reset request submitted. Please contact the administrator.' };
    }
  }
  return { success: false, message: 'Staff No not found.' };
}

/* =========================================================
   DASHBOARD
========================================================= */

function getDashboard() {
  var sheet = getSheet_(SHEETS.LOGS);
  var data = valuesWithHeaders_(sheet);
  var now = new Date();
  var currentDate = Utilities.formatDate(now, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  var hour = Number(Utilities.formatDate(now, Session.getScriptTimeZone(), 'H'));
  var currentShift = hour >= 6 && hour < 14 ? 'A Shift' : (hour >= 14 && hour < 22 ? 'B Shift' : 'C Shift');
  var result = { total: 0, completed: 0, pending: 0, overlook: 0, currentShift: currentShift, date: currentDate, shiftIncharge: '', lineIncharge: '', bslEmployees: 0, contractWorkers: 0, totalCrew: 0, crewByShift: [] };
    data.rows.forEach(function (row) {
    if (row.every(function (v) { return v === '' || v === null; })) return;
    var rowDate = formatDate_(rowValue_(row, data.map, ['Date']), 'yyyy-MM-dd');
    var rowShift = normalize_(rowValue_(row, data.map, ['Shift']));
    // Home dashboard shows only today's logs for the currently active shift.
    if (rowDate !== currentDate || rowShift !== currentShift) return;
    result.total++;
    var status = normalize_(rowValue_(row, data.map, ['Status'])).toLowerCase();
    if (status === 'completed') result.completed++;
    else if (status === 'pending') result.pending++;
    else if (status === 'overlook') result.overlook++;
  });

  var shiftSheet = getSheet_(SHEETS.SHIFTS);
  var shiftMap = ensureShiftColumns_(shiftSheet);
  var shiftData = valuesWithHeaders_(shiftSheet);
  shiftData.rows.forEach(function(row){
    var d=formatDate_(rowValue_(row,shiftData.map,['Date']),'yyyy-MM-dd');
    var sn=normalize_(rowValue_(row,shiftData.map,['Shift Name']));
    if(d===currentDate && sn){
      var crew={shiftName:sn,shiftIncharge:normalize_(rowValue_(row,shiftData.map,['Shift Incharge'])),lineIncharge:normalize_(rowValue_(row,shiftData.map,['Line Incharge'])),bslEmployees:Number(rowValue_(row,shiftData.map,['BSL Employees'])||0),contractWorkers:Number(rowValue_(row,shiftData.map,['Contract Workers'])||0),totalCrew:Number(rowValue_(row,shiftData.map,['Total Crew'])||0)};
      result.crewByShift.push(crew);
      if(sn===currentShift){result.shiftIncharge=crew.shiftIncharge;result.lineIncharge=crew.lineIncharge;result.bslEmployees=crew.bslEmployees;result.contractWorkers=crew.contractWorkers;result.totalCrew=crew.totalCrew;}
    }
  });

  return result;
}

/* =========================================================
   AREAS
========================================================= */

function getAreas() {
  var sheet = getSheet_(SHEETS.AREAS);
  var data = valuesWithHeaders_(sheet);
  var col = findHeader_(data.map, ['Area / Location', 'Area', 'Location']);
  if (col < 0) return [];
  var seen = {};
  var result = [];
  data.rows.forEach(function (row) {
    var value = normalize_(row[col]);
    if (value && !seen[value]) {
      seen[value] = true;
      result.push(value);
    }
  });
  return result;
}

/* =========================================================
   EQUIPMENT
========================================================= */

function getEquipment() {
  var sheet = getSheet_(SHEETS.EQUIPMENT);
  var data = valuesWithHeaders_(sheet);
  var eqCol = findHeader_(data.map, ['Equipment / Subsystem', 'Equipment']);
  var areaCol = findHeader_(data.map, ['Area / Location', 'Area']);
  if (eqCol < 0) return [];
  return data.rows.map(function (row) {
    return {
      equipment: normalize_(row[eqCol]),
      area: areaCol >= 0 ? normalize_(row[areaCol]) : ''
    };
  }).filter(function (x) { return x.equipment; });
}

/* =========================================================
   SAVE MAINTENANCE LOG
========================================================= */

function saveMaintenanceLog(log) {
  log = log || {};

  var date = normalize_(log.date);
  var startTime = normalize_(log.startTime);
  var endTime = normalize_(log.endTime);
  var area = normalize_(log.area);
  var equipment = normalize_(log.equipment);
  var problem = normalize_(log.problem);
  var solution = normalize_(log.solution);
  var status = normalize_(log.status);
  var remarks = normalize_(log.remarks);
  var shift = normalize_(log.shift) || shiftFromTime_(startTime);

  if (!date || !startTime || !area || !equipment || !problem || !status) {
    return { success: false, message: 'Please fill all required fields.' };
  }
  if (STATUS_VALUES.indexOf(status) === -1) {
    return { success: false, message: 'Invalid maintenance status.' };
  }
  if (!shift) {
    return { success: false, message: 'Please enter a valid start time so the shift can be determined.' };
  }

  var sheet = getSheet_(SHEETS.LOGS);
  var data = valuesWithHeaders_(sheet);
  var headers = data.headers;
  var row = new Array(headers.length).fill('');

  var values = {
    'LogID': generateLogId_(),
    'Date': date,
    'Shift': shift,
    'Start Time': startTime,
    'End Time': endTime,
    'Area / Location': area,
    'Equipment / Subsystem': equipment,
    'Problem Description': problem,
    'Solution Taken': solution,
    'Status': status,
    'Remarks': remarks
  };

  headers.forEach(function (header, i) {
    if (values.hasOwnProperty(header)) row[i] = values[header];
  });

  sheet.appendRow(row);

  // Keep the actual MaintenanceLogs sheet itself in newest-to-oldest order.
  // Primary order: Date descending, then Start Time descending.
  var refreshed = valuesWithHeaders_(sheet);
  var dateCol = findHeader_(refreshed.map, ['Date']);
  var startCol = findHeader_(refreshed.map, ['Start Time']);
  var lastRow = sheet.getLastRow();
  var lastCol = sheet.getLastColumn();
  if (lastRow > 2 && dateCol >= 0 && startCol >= 0) {
    sheet.getRange(2, 1, lastRow - 1, lastCol).sort([
      {column: dateCol + 1, ascending: false},
      {column: startCol + 1, ascending: false}
    ]);
  }

  return { success: true, message: 'Maintenance log saved successfully.', logId: values.LogID, shift: shift };
}

/* =========================================================
   GET LOGS
========================================================= */

function getLogs() {
  var sheet = getSheet_(SHEETS.LOGS);
  var data = valuesWithHeaders_(sheet);
  var logs = data.rows.map(function (row) {
    return {
      logId: normalize_(rowValue_(row, data.map, ['LogID'])),
      date: formatDate_(rowValue_(row, data.map, ['Date']), 'yyyy-MM-dd'),
      shift: normalize_(rowValue_(row, data.map, ['Shift'])),
      startTime: formatTime_(rowValue_(row, data.map, ['Start Time'])),
      endTime: formatTime_(rowValue_(row, data.map, ['End Time'])),
      area: normalize_(rowValue_(row, data.map, ['Area / Location'])),
      equipment: normalize_(rowValue_(row, data.map, ['Equipment / Subsystem'])),
      problem: normalize_(rowValue_(row, data.map, ['Problem Description'])),
      solution: normalize_(rowValue_(row, data.map, ['Solution Taken'])),
      status: normalize_(rowValue_(row, data.map, ['Status'])),
      remarks: normalize_(rowValue_(row, data.map, ['Remarks']))
    };
  }).filter(function (x) { return x.logId || x.date || x.problem; });

  // View Logs: newest maintenance entry first.
  // Example: 21:00 -> 17:00 -> 13:00 -> 08:00.
  logs.sort(function (a, b) {
    var dateCompare = String(b.date || '').localeCompare(String(a.date || ''));
    if (dateCompare !== 0) return dateCompare;

    var timeCompare = String(b.startTime || '').localeCompare(String(a.startTime || ''));
    if (timeCompare !== 0) return timeCompare;

    var endCompare = String(b.endTime || '').localeCompare(String(a.endTime || ''));
    if (endCompare !== 0) return endCompare;

    return String(b.logId || '').localeCompare(String(a.logId || ''));
  });

  return logs;
}

/* =========================================================
   EMPLOYEES
========================================================= */

function ensureEmployeeColumns_(sheet) {
  var required = ['Staff No', 'Name', 'Department', 'Designation', 'Mobile No', 'Employee Type', 'Email'];
  var aliases = {
    'Staff No':['Staff No','StaffNo','EmployeeID','Employee ID'],
    'Name':['Name','Employee Name'],
    'Department':['Department'],
    'Designation':['Designation'],
    'Mobile No':['Mobile No','Phone','Phone Number'],
    'Employee Type':['Employee Type','Category'],
    'Email':['Email','Email ID']
  };
  var map = headerMap_(sheet);
  var last = Math.max(sheet.getLastColumn(),1);
  required.forEach(function(h){
    var found = findHeader_(map, aliases[h]);
    if(found < 0){
      last++;
      sheet.getRange(1,last).setValue(h);
      map[h]=last-1;
    }
  });
  return headerMap_(sheet);
}

function getEmployeeByStaffNo_(staffNo) {
  var sheet = getSheet_(SHEETS.EMPLOYEES);
  ensureEmployeeColumns_(sheet);
  var data = valuesWithHeaders_(sheet);
  var staffCol = findHeader_(data.map, ['Staff No','StaffNo','EmployeeID','Employee ID']);
  if (staffCol < 0) return null;
  for (var i = 0; i < data.rows.length; i++) {
    if (normalize_(data.rows[i][staffCol]) === normalize_(staffNo)) {
      return {
        staffNo: normalize_(rowValue_(data.rows[i], data.map, ['Staff No','StaffNo','EmployeeID','Employee ID'])),
        name: normalize_(rowValue_(data.rows[i], data.map, ['Name','Employee Name'])),
        department: normalize_(rowValue_(data.rows[i], data.map, ['Department'])),
        designation: normalize_(rowValue_(data.rows[i], data.map, ['Designation'])),
        mobile: normalize_(rowValue_(data.rows[i], data.map, ['Mobile No','Phone','Phone Number'])),
        employeeType: normalize_(rowValue_(data.rows[i], data.map, ['Employee Type','Category'])),
        email: normalize_(rowValue_(data.rows[i], data.map, ['Email','Email ID']))
      };
    }
  }
  return null;
}

function upsertEmployeeRecord_(staffNo, name, department, designation, mobile, employeeType, email) {
  var sheet = getSheet_(SHEETS.EMPLOYEES);
  ensureEmployeeColumns_(sheet);
  var data = valuesWithHeaders_(sheet);
  var map = data.map;
  var staffCol = findHeader_(map,['Staff No','StaffNo','EmployeeID','Employee ID']);
  var nameCol = findHeader_(map,['Name','Employee Name']);
  var deptCol = findHeader_(map,['Department']);
  var desigCol = findHeader_(map,['Designation']);
  var mobileCol = findHeader_(map,['Mobile No','Phone','Phone Number']);
  var typeCol = findHeader_(map,['Employee Type','Category']);
  var emailCol = findHeader_(map,['Email','Email ID']);
  var rowNo = -1;
  for (var i = 0; i < data.rows.length; i++) {
    if (normalize_(data.rows[i][staffCol]) === staffNo) { rowNo = i + 2; break; }
  }
  if (rowNo < 0) {
    var row = new Array(sheet.getLastColumn()).fill('');
    row[staffCol] = staffNo;
    row[nameCol] = name;
    row[deptCol] = department;
    row[desigCol] = designation;
    row[mobileCol] = mobile;
    row[typeCol] = employeeType;
    if (emailCol >= 0) row[emailCol] = email || '';
    sheet.appendRow(row);
  } else {
    sheet.getRange(rowNo, staffCol + 1).setValue(staffNo);
    sheet.getRange(rowNo, nameCol + 1).setValue(name);
    sheet.getRange(rowNo, deptCol + 1).setValue(department);
    sheet.getRange(rowNo, desigCol + 1).setValue(designation);
    sheet.getRange(rowNo, mobileCol + 1).setValue(mobile);
    sheet.getRange(rowNo, typeCol + 1).setValue(employeeType);
    if (emailCol >= 0) sheet.getRange(rowNo, emailCol + 1).setValue(email || '');
  }
}

function getEmployees() {
  var sheet = getSheet_(SHEETS.EMPLOYEES);
  ensureEmployeeColumns_(sheet);
  var data = valuesWithHeaders_(sheet);
  return data.rows.map(function (row) {
    return {
      staffNo: normalize_(rowValue_(row, data.map, ['Staff No','StaffNo','EmployeeID','Employee ID'])),
      name: normalize_(rowValue_(row, data.map, ['Name','Employee Name'])),
      department: normalize_(rowValue_(row, data.map, ['Department'])),
      designation: normalize_(rowValue_(row, data.map, ['Designation'])),
      mobile: normalize_(rowValue_(row, data.map, ['Mobile No','Phone','Phone Number'])),
      employeeType: normalize_(rowValue_(row, data.map, ['Employee Type','Category'])),
      email: normalize_(rowValue_(row, data.map, ['Email','Email ID']))
    };
  }).filter(function (x) { return x.staffNo || x.name; });
}

function saveEmployeeRecord(details) {
  details = details || {};
  var staffNo = normalize_(details.staffNo);
  var originalStaffNo = normalize_(details.originalStaffNo);
  var sessionToken = normalize_(details.sessionToken);
  var name = normalize_(details.name);
  var department = normalize_(details.department);
  var designation = normalize_(details.designation);
  var mobile = normalize_(details.mobile);
  var employeeType = normalize_(details.employeeType);
  var email = normalize_(details.email);

  if(!/^\d{6}$/.test(staffNo)) return {success:false,message:'Staff No must be exactly 6 digits.'};
  if(!name || !department || !designation || !/^\d{10}$/.test(mobile)) return {success:false,message:'Please complete all mandatory fields.'};
  if(EMPLOYEE_TYPES.indexOf(employeeType) === -1) return {success:false,message:'Please select a valid Employee Type.'};
  if(email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return {success:false,message:'Enter a valid email or leave it blank.'};

  var targetStaff = originalStaffNo || staffNo;
  var auth = authorizeEmployeeAction_(sessionToken, targetStaff, !originalStaffNo);
  if(!auth.ok) return {success:false,message:auth.message};

  // A normal employee may edit only their own existing record and may not change Staff No.
  if(!auth.isAdmin && originalStaffNo && staffNo !== originalStaffNo){
    return {success:false,message:'You can edit only your own Employee Details.'};
  }

  var sheet = getSheet_(SHEETS.EMPLOYEES);
  ensureEmployeeColumns_(sheet);
  var data = valuesWithHeaders_(sheet);
  var map = data.map;
  var staffCol = findHeader_(map,['Staff No','StaffNo','EmployeeID','Employee ID']);
  var nameCol = findHeader_(map,['Name','Employee Name']);
  var deptCol = findHeader_(map,['Department']);
  var desigCol = findHeader_(map,['Designation']);
  var mobileCol = findHeader_(map,['Mobile No','Phone','Phone Number']);
  var typeCol = findHeader_(map,['Employee Type','Category']);
  var emailCol = findHeader_(map,['Email','Email ID']);

  var foundRow = -1;
  for(var i=0;i<data.rows.length;i++){
    var existing = normalize_(data.rows[i][staffCol]);
    if(existing === targetStaff){ foundRow=i+2; break; }
  }

  if(!originalStaffNo){
    for(var j=0;j<data.rows.length;j++){
      if(normalize_(data.rows[j][staffCol]) === staffNo){ return {success:false,message:'This Staff No already exists.'}; }
    }
  }

  if(foundRow < 0){
    var row = new Array(sheet.getLastColumn()).fill('');
    row[staffCol]=staffNo; row[nameCol]=name; row[deptCol]=department; row[desigCol]=designation; row[mobileCol]=mobile; row[typeCol]=employeeType; if(emailCol>=0) row[emailCol]=email;
    sheet.appendRow(row);
  } else {
    sheet.getRange(foundRow,staffCol+1).setValue(staffNo);
    sheet.getRange(foundRow,nameCol+1).setValue(name);
    sheet.getRange(foundRow,deptCol+1).setValue(department);
    sheet.getRange(foundRow,desigCol+1).setValue(designation);
    sheet.getRange(foundRow,mobileCol+1).setValue(mobile);
    sheet.getRange(foundRow,typeCol+1).setValue(employeeType);
    if(emailCol>=0) sheet.getRange(foundRow,emailCol+1).setValue(email);
  }
  return {success:true,message:'Employee saved successfully.'};
}


function deleteEmployeeRecord(staffNo, sessionToken) {
  staffNo = normalize_(staffNo);
  var auth = authorizeEmployeeAction_(sessionToken, staffNo, true);
  if(!auth.ok) return {success:false,message:auth.message};

  var sheet = getSheet_(SHEETS.EMPLOYEES);
  ensureEmployeeColumns_(sheet);
  var data = valuesWithHeaders_(sheet);
  var staffCol = findHeader_(data.map,['Staff No','StaffNo','EmployeeID','Employee ID']);
  if(staffCol < 0) return {success:false,message:'Staff No column not found.'};
  for(var i=0;i<data.rows.length;i++){
    if(normalize_(data.rows[i][staffCol]) === staffNo){
      sheet.deleteRow(i+2);
      return {success:true,message:'Employee deleted successfully.'};
    }
  }
  return {success:false,message:'Employee not found.'};
}

function protectEmployeeSheet() {
  // Run this once from the Apps Script editor while signed in as the
  // Google account that owns the spreadsheet (your authorized 806432 account).
  // The Employees sheet will then be directly editable only by the owner;
  // website changes continue through the Apps Script functions above.
  var sheet = getSheet_(SHEETS.EMPLOYEES);
  var protections = sheet.getProtections(SpreadsheetApp.ProtectionType.SHEET);
  protections.forEach(function(p) {
    try { p.remove(); } catch (e) {}
  });

  var protection = sheet.protect().setDescription('Employees - direct editing restricted to spreadsheet owner / authorized administrator');
  protection.setWarningOnly(false);
  try {
    if (protection.canDomainEdit()) protection.setDomainEdit(false);
  } catch (e) {}

  try {
    var editors = protection.getEditors();
    if (editors && editors.length) protection.removeEditors(editors);
  } catch (e) {}

  return {success:true, message:'Employees sheet is protected. Website updates remain available to authorized users.'};
}

/* =========================================================
   SHIFT CREW DETAILS
========================================================= */
function ensureShiftColumns_(sheet){
  var required=['ShiftID','Shift Name','Start Time','End Time','Shift Incharge','Line Incharge','BSL Employees','Contract Workers','Total Crew','Date'];
  var aliases={'ShiftID':['ShiftID','Shift ID'],'Shift Name':['Shift Name'],'Start Time':['Start Time'],'End Time':['End Time'],'Shift Incharge':['Shift Incharge'],'Line Incharge':['Line Incharge'],'BSL Employees':['BSL Employees'],'Contract Workers':['Contract Workers'],'Total Crew':['Total Crew'],'Date':['Date']};
  var map=headerMap_(sheet), last=Math.max(sheet.getLastColumn(),1);
  required.forEach(function(h){if(findHeader_(map,aliases[h])<0){last++;sheet.getRange(1,last).setValue(h);map[h]=last-1;}});
  return headerMap_(sheet);
}
function saveShiftCrewDetails(details){
  details=details||{};
  var date=normalize_(details.date), shift=normalize_(details.shiftName), si=normalize_(details.shiftIncharge), li=normalize_(details.lineIncharge);
  var bsl=Math.max(0,Number(details.bslEmployees||0)), contract=Math.max(0,Number(details.contractWorkers||0)), total=bsl+contract;
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date)) return {success:false,message:'Please select a valid date.'};
  if(['A Shift','B Shift','C Shift'].indexOf(shift)<0) return {success:false,message:'Please select a valid shift.'};
  if(!si||!li) return {success:false,message:'Shift Incharge and Line Incharge are required.'};
  var sheet=getSheet_(SHEETS.SHIFTS), map=ensureShiftColumns_(sheet), data=valuesWithHeaders_(sheet);
  var shiftCol=findHeader_(map,['Shift Name']), dateCol=findHeader_(map,['Date']);
  var rowNo=-1;
  for(var i=0;i<data.rows.length;i++) if(normalize_(data.rows[i][shiftCol])===shift && formatDate_(data.rows[i][dateCol],'yyyy-MM-dd')===date){rowNo=i+2;break;}
  var values={'ShiftID':shift.substring(0,1)+'-'+date,'Shift Name':shift,'Start Time':shift==='A Shift'?'06:00':shift==='B Shift'?'14:00':'22:00','End Time':shift==='A Shift'?'14:00':shift==='B Shift'?'22:00':'06:00','Shift Incharge':si,'Line Incharge':li,'BSL Employees':bsl,'Contract Workers':contract,'Total Crew':total,'Date':date};
  if(rowNo<0){var row=new Array(sheet.getLastColumn()).fill('');Object.keys(values).forEach(function(k){var c=findHeader_(map,[k]);if(c>=0)row[c]=values[k];});sheet.appendRow(row);}else{Object.keys(values).forEach(function(k){var c=findHeader_(map,[k]);if(c>=0)sheet.getRange(rowNo,c+1).setValue(values[k]);});}
  return {success:true,message:shift+' crew details saved successfully.',totalCrew:total};
}
function getShiftCrewDetails(date,shift){
  date=normalize_(date);shift=normalize_(shift);var sheet=getSheet_(SHEETS.SHIFTS),map=ensureShiftColumns_(sheet),data=valuesWithHeaders_(sheet),result={date:date,shiftName:shift,shiftIncharge:'',lineIncharge:'',bslEmployees:0,contractWorkers:0,totalCrew:0,allShifts:[]};
  data.rows.forEach(function(row){var d=formatDate_(rowValue_(row,data.map,['Date']),'yyyy-MM-dd');var sn=normalize_(rowValue_(row,data.map,['Shift Name']));if(d!==date)return;var item={shiftName:sn,shiftIncharge:normalize_(rowValue_(row,data.map,['Shift Incharge'])),lineIncharge:normalize_(rowValue_(row,data.map,['Line Incharge'])),bslEmployees:Number(rowValue_(row,data.map,['BSL Employees'])||0),contractWorkers:Number(rowValue_(row,data.map,['Contract Workers'])||0),totalCrew:Number(rowValue_(row,data.map,['Total Crew'])||0)};result.allShifts.push(item);if(sn===shift){result.shiftIncharge=item.shiftIncharge;result.lineIncharge=item.lineIncharge;result.bslEmployees=item.bslEmployees;result.contractWorkers=item.contractWorkers;result.totalCrew=item.totalCrew;}});
  return result;
}
function getAllShiftCrewForDate(date){var r=getShiftCrewDetails(date,'');return r.allShifts;}

/* =========================================================
   DAILY SHIFT REPORT
========================================================= */

function getDailyShiftReport(reportDate, shiftName) {
  reportDate = normalize_(reportDate);
  shiftName = normalize_(shiftName);

  if (!/^\d{4}-\d{2}-\d{2}$/.test(reportDate)) {
    throw new Error('Invalid report date.');
  }
  if (['A Shift', 'B Shift', 'C Shift'].indexOf(shiftName) === -1) {
    throw new Error('Invalid shift.');
  }

  var result = {
    date: reportDate,
    shift: shiftName,
    startTime: '',
    endTime: '',
    shiftIncharge: '',
    bslEmployees: 0,
    contractWorkers: 0,
    totalCrew: 0,
    crewStrength: '',
    coilShearSL1: '',
    coilShearSL2: '',
    logs: []
  };

  /* Shift information */
  var shiftSheet = getSheet_(SHEETS.SHIFTS);
  var shiftData = valuesWithHeaders_(shiftSheet);
  shiftData.rows.forEach(function (row) {
    if (normalize_(rowValue_(row, shiftData.map, ['Shift Name'])) !== shiftName) return;
    var rowDate = formatDate_(rowValue_(row, shiftData.map, ['Date']), 'yyyy-MM-dd');
    if (rowDate && rowDate !== reportDate) return;
    result.startTime = formatTime_(rowValue_(row, shiftData.map, ['Start Time']));
    result.endTime = formatTime_(rowValue_(row, shiftData.map, ['End Time']));
    result.shiftIncharge = normalize_(rowValue_(row, shiftData.map, ['Shift Incharge']));
    var bsl=Number(rowValue_(row,shiftData.map,['BSL Employees'])||0);
    var contract=Number(rowValue_(row,shiftData.map,['Contract Workers'])||0);
    var storedTotal=Number(rowValue_(row,shiftData.map,['Total Crew'])||0);
    result.bslEmployees=bsl;
    result.contractWorkers=contract;
    result.totalCrew=storedTotal || (bsl + contract);
    result.crewStrength=result.totalCrew;
  });

  /* Maintenance logs */
  var logSheet = getSheet_(SHEETS.LOGS);
  var logData = valuesWithHeaders_(logSheet);
  logData.rows.forEach(function (row) {
    var rowDate = formatDate_(rowValue_(row, logData.map, ['Date']), 'yyyy-MM-dd');
    var rowShift = normalize_(rowValue_(row, logData.map, ['Shift']));

    if (rowDate !== reportDate || rowShift !== shiftName) return;

    result.logs.push({
      logId: rowValue_(row, logData.map, ['LogID']),
      date: reportDate,
      shift: rowShift,
      startTime: formatTime_(rowValue_(row, logData.map, ['Start Time'])),
      endTime: formatTime_(rowValue_(row, logData.map, ['End Time'])),
      area: normalize_(rowValue_(row, logData.map, ['Area / Location'])),
      equipment: normalize_(rowValue_(row, logData.map, ['Equipment / Subsystem'])),
      problem: normalize_(rowValue_(row, logData.map, ['Problem Description'])),
      solution: normalize_(rowValue_(row, logData.map, ['Solution Taken'])),
      status: normalize_(rowValue_(row, logData.map, ['Status'])),
      remarks: normalize_(rowValue_(row, logData.map, ['Remarks']))
    });
  });

  result.logs.sort(function (a, b) {
    var timeCompare = String(b.startTime || '').localeCompare(String(a.startTime || ''));
    if (timeCompare !== 0) return timeCompare;
    return String(b.endTime || '').localeCompare(String(a.endTime || ''));
  });

  return result;
}

/* =========================================================
   OPTIONAL SHIFT DATA
========================================================= */

function getShiftDetails() {
  var sheet = getSheet_(SHEETS.SHIFTS);
  var data = valuesWithHeaders_(sheet);
  return data.rows.map(function (row) {
    return {
      shiftId: normalize_(rowValue_(row, data.map, ['ShiftID', 'Shift ID'])),
      shiftName: normalize_(rowValue_(row, data.map, ['Shift Name'])),
      startTime: formatTime_(rowValue_(row, data.map, ['Start Time'])),
      endTime: formatTime_(rowValue_(row, data.map, ['End Time'])),
      shiftIncharge: normalize_(rowValue_(row, data.map, ['Shift Incharge']))
    };
  }).filter(function (x) { return x.shiftName; });
}



function updateMaintenanceLogPwa_(log, sessionToken, staffNo){
  if(!authorizeEmployeeAction_(normalize_(sessionToken),normalize_(staffNo),false).ok) return {success:false,message:'Unauthorized.'};
  log=log||{}; var id=normalize_(log.logId); if(!id)return {success:false,message:'LogID is required.'};
  var sheet=getSheet_(SHEETS.LOGS),d=valuesWithHeaders_(sheet),idCol=findHeader_(d.map,['LogID']); if(idCol<0)return {success:false,message:'LogID column not found.'};
  var rowNo=-1; for(var i=0;i<d.rows.length;i++) if(normalize_(d.rows[i][idCol])===id){rowNo=i+2;break;}
  if(rowNo<0)return {success:false,message:'Maintenance log not found.'};
  var vals={'Date':normalize_(log.date),'Shift':normalize_(log.shift),'Start Time':normalize_(log.startTime),'End Time':normalize_(log.endTime),'Area / Location':normalize_(log.area),'Equipment / Subsystem':normalize_(log.equipment),'Problem Description':normalize_(log.problem),'Solution Taken':normalize_(log.solution),'Status':normalize_(log.status),'Remarks':normalize_(log.remarks)};
  Object.keys(vals).forEach(function(h){var c=findHeader_(d.map,[h]);if(c>=0)sheet.getRange(rowNo,c+1).setValue(vals[h]);});
  return {success:true,message:'Maintenance log updated successfully.',logId:id};
}
