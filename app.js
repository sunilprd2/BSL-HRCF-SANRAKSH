const state={
  page:"home", staffNo:"", pendingLogs:[],
  shifts:[
    {name:"A SHIFT",time:"06:00 - 14:00",incharge:"Rajesh Kumar",phone:"9876543210",line:"Amit Nayak",bsl:8,contract:4,status:"Completed",cls:"shift-a"},
    {name:"B SHIFT",time:"14:00 - 22:00",incharge:"Manoj Das",phone:"9876543211",line:"Ramesh Behera",bsl:7,contract:5,status:"Running",cls:"shift-b"},
    {name:"C SHIFT",time:"22:00 - 06:00",incharge:"Suresh Pradhan",phone:"9876543212",line:"Pintu Sahu",bsl:6,contract:4,status:"Pending",cls:"shift-c"}
  ],
  employees:[
    {name:"Rajesh Kumar",designation:"Jr. Engineer",mobile:"9876543210",position:"Executive"},
    {name:"Manoj Das",designation:"Technician",mobile:"9876543211",position:"Non-Executive"},
    {name:"Ramesh Behera",designation:"Operator",mobile:"9876543211",position:"Non-Executive"},
    {name:"Suresh Pradhan",designation:"Fitter",mobile:"9876543212",position:"Contract Worker"},
    {name:"Amit Nayak",designation:"Line In-charge",mobile:"9876543212",position:"Executive"},
    {name:"Pintu Sahu",designation:"Helper",mobile:"9876543216",position:"Contract Worker"}
  ],
  logs:[
    {time:"14:35",area:"Coil Shear",sl:"S/L-1",problem:"Sensor fault",status:"Completed",remark:""},
    {time:"16:20",area:"Coil Shear",sl:"S/L-2",problem:"Hydraulic pressure low",status:"Completed",remark:""},
    {time:"19:45",area:"Coil Shear",sl:"S/L-1",problem:"Motor noise",status:"Pending",remark:"Under observation"}
  ]
};

const $=id=>document.getElementById(id);
document.addEventListener("DOMContentLoaded",()=>{
  $("loginForm").addEventListener("submit",e=>{e.preventDefault();login()});
  $("togglePassword").onclick=()=>{const x=$("loginPassword");x.type=x.type==="password"?"text":"password"};
  $("forgotBtn").onclick=()=>alert("Password reset will be connected to the Google Sheet in the next phase.");
  $("logoutBtn").onclick=logout;
  $("menuBtn").onclick=()=>$("sidebar").classList.toggle("open");
  document.querySelectorAll("#nav button").forEach(b=>b.onclick=()=>{openPage(b.dataset.page);$("sidebar").classList.remove("open")});
});

function login(){
  const staff=$("loginStaffNo").value.trim(),pass=$("loginPassword").value;
  if(!staff||!pass){$("loginMessage").textContent="Enter Staff No and Password.";return}
  state.staffNo=staff;
  $("loginScreen").classList.add("hidden");$("appScreen").classList.remove("hidden");openPage("home");
}
function logout(){state.page="home";$("appScreen").classList.add("hidden");$("loginScreen").classList.remove("hidden");$("loginForm").reset()}
function openPage(page){state.page=page;render()}

function render(){
  const c=$("content");
  document.querySelectorAll("#nav button").forEach(b=>b.classList.toggle("active",b.dataset.page===state.page));
  const pages={home:homePage,addLog:addLogPage,logs:logsPage,employees:employeesPage,shifts:shiftsPage,reports:reportsPage,about:aboutPage,sync:syncPage};
  c.innerHTML=(pages[state.page]||homePage)();
  if(state.page==="addLog") bindAddLog();
  if(state.page==="reports") bindReport();
}

function homePage(){
  return `<h1 class="page-title">Home</h1>
  <div class="shift-grid">${state.shifts.map(s=>`<div class="shift-card ${s.cls}">
    <h3>${s.name}</h3><p>${s.time}</p><b>${s.incharge}</b><div class="shift-phone">☎ ${s.phone}</div>
    <span class="status">${s.status}</span></div>`).join("")}</div>
  <div class="tile-grid">
    <button class="tile blue" onclick="openPage('addLog')">▣<br>Add Log</button>
    <button class="tile green" onclick="openPage('logs')">▤<br>View Logs</button>
    <button class="tile orange" onclick="openPage('reports')">▥<br>Reports</button>
    <button class="tile purple" onclick="openPage('employees')">♟<br>Employee Details</button>
    <button class="tile cyan" onclick="openPage('shifts')">▦<br>Shift Details</button>
    <button class="tile blue" onclick="openPage('about')">ⓘ<br>About</button>
  </div>`;
}

function shiftsPage(){
  return `<h1 class="page-title">Shift Details</h1>
  <div class="panel"><label>Date</label><input type="date" value="2026-09-30"></div>
  ${state.shifts.map((s,i)=>`<div class="panel">
    <div style="display:flex;justify-content:space-between;align-items:center"><b>${s.name} (${s.time})</b><button class="primary" onclick="editShift(${i})">Edit</button></div>
    <p>Shift In-charge : ${s.incharge} &nbsp; ☎ ${s.phone}</p>
    <p>Line In-charge : ${s.line}</p>
    <p>Crew Details : BSL - ${s.bsl} &nbsp; Contract - ${s.contract}</p>
  </div>`).join("")}`;
}
function editShift(i){
  const s=state.shifts[i];
  $("content").innerHTML=`<h1 class="page-title">Edit Shift Details</h1><div class="panel">
    <div class="form-grid">
      <div><label>Shift</label><select id="eShift"><option>${s.name} (${s.time})</option></select></div>
      <div><label>Shift In-Charge *</label><input id="eIn" value="${s.incharge}"></div>
      <div><label>Mobile No *</label><input id="ePhone" value="${s.phone}" maxlength="10"></div>
      <div><label>Line In-charge</label><input id="eLine" value="${s.line}"></div>
      <div><label>BSL Employees *</label><input id="eBsl" value="${s.bsl}" type="number"></div>
      <div><label>Contract Workers *</label><input id="eCon" value="${s.contract}" type="number"></div>
    </div>
    <div class="form-actions"><button class="secondary" onclick="openPage('shifts')">Cancel</button><button class="primary" onclick="saveShift(${i})">Update</button></div>
  </div>`;
}
function saveShift(i){
  Object.assign(state.shifts[i],{incharge:$("eIn").value,phone:$("ePhone").value,line:$("eLine").value,bsl:$("eBsl").value,contract:$("eCon").value});
  openPage("shifts");
}

function addLogPage(){
  return `<h1 class="page-title">Add Maintenance Log</h1><div class="panel">
    <div class="form-grid">
      <div><label>Date</label><input id="logDate" type="date" value="2026-09-30"></div>
      <div><label>Area *</label><select id="logArea"><option>Coil Shear</option><option>Other</option></select></div>
      <div><label>Sub Area *</label><select id="logSL"><option>S/L-1</option><option>S/L-2</option></select></div>
      <div class="time-grid"><div><label>Start Time *</label><input id="startTime" type="time" value="16:20"></div><div><label>End Time *</label><input id="endTime" type="time" value="17:05"></div></div>
      <div><label>Total Time</label><input id="totalTime" class="total-time" value="00:45" readonly></div>
      <div><label>Problem *</label><textarea id="problem">Hydraulic pressure low</textarea></div>
      <div><label>Solution *</label><textarea id="solution">Pressure adjusted and normalised</textarea></div>
      <div><label>Status *</label><select id="status"><option>Completed</option><option>Pending</option><option>Overlook</option></select></div>
      <div><label>Remark</label><textarea id="remark">Checked and running normal</textarea></div>
    </div>
    <div class="form-actions"><button class="secondary">Reset</button><button class="primary" id="saveLog">Save Log</button></div>
  </div>`;
}
function bindAddLog(){
  ["startTime","endTime"].forEach(id=>$(id).addEventListener("change",calcTotal));
  $("saveLog").onclick=()=>{
    state.logs.push({time:$("startTime").value,area:$("logArea").value,sl:$("logSL").value,problem:$("problem").value,status:$("status").value,remark:$("remark").value});
    state.pendingLogs.push({created:Date.now()});updateBadge();alert("Log saved locally.");openPage("logs");
  };
}
function calcTotal(){
  const a=$("startTime").value,b=$("endTime").value;if(!a||!b)return;
  let x=new Date(`1970-01-01T${a}`),y=new Date(`1970-01-01T${b}`);if(y<x)y.setDate(y.getDate()+1);
  const m=Math.round((y-x)/60000);$("totalTime").value=`${String(Math.floor(m/60)).padStart(2,"0")}:${String(m%60).padStart(2,"0")}`;
}
function logsPage(){
  return `<h1 class="page-title">Maintenance Logs</h1><div class="panel toolbar"><input type="date" value="2026-09-30"><input type="date" value="2026-09-30"><select><option>B Shift (14:00 - 22:00)</option></select><button class="primary">Search</button><button class="secondary">Reset</button></div>
  <div class="panel table-wrap"><table class="data-table"><thead><tr><th>#</th><th>Time</th><th>Area</th><th>S/L</th><th>Problem</th><th>Status</th><th>Edit</th></tr></thead><tbody>
  ${state.logs.map((l,i)=>`<tr><td>${i+1}</td><td>${l.time}</td><td>${l.area}</td><td>${l.sl}</td><td>${l.problem}</td><td>${l.status}</td><td><button class="edit-btn">✎</button></td></tr>`).join("")}</tbody></table></div>`;
}
function employeesPage(){
  return `<h1 class="page-title">Employee Details</h1><div class="panel"><div class="toolbar"><input placeholder="Search by Name or Staff No"><button class="primary">＋ Add Employee</button></div></div>
  <div class="panel table-wrap"><table class="data-table"><thead><tr><th>#</th><th>Name</th><th>Designation</th><th>Mobile No</th><th>Position</th><th>Edit</th></tr></thead><tbody>
  ${state.employees.map((e,i)=>`<tr><td>${i+1}</td><td>${e.name}</td><td>${e.designation}</td><td>${e.mobile}</td><td>${e.position}</td><td><button class="edit-btn">✎</button></td></tr>`).join("")}</tbody></table></div>`;
}
function reportsPage(){
  return `<h1 class="page-title">Reports</h1><div class="panel toolbar"><input type="date" value="2026-09-30"><select><option>B Shift (14:00 - 22:00)</option></select><button class="primary" onclick="alert('Report generation will be connected in the next phase.')">Generate Report</button></div>
  <div class="panel"><h3>Shift Summary</h3><p>Shift In-charge : Manoj Das</p><p>Line In-charge : Ramesh Behera</p><p>BSL Employees : 7</p><p>Contract Workers : 5</p><p>Total Crew : 12</p></div>
  <div class="report-actions"><button class="primary">Print / PDF</button><button class="secondary">Export to Excel</button></div>`;
}
function syncPage(){
  return `<h1 class="page-title">Sync Data</h1><div class="panel"><h2>☁ ${state.pendingLogs.length} logs pending sync</h2><p>Offline records will be uploaded automatically when internet is available.</p><button class="primary" onclick="syncNow()">Sync Now</button></div>`;
}
function syncNow(){state.pendingLogs=[];updateBadge();alert("All local records marked as synced.");}
function updateBadge(){document.querySelector(".badge").textContent=state.pendingLogs.length}
function aboutPage(){
  return `<h1 class="page-title">About</h1><div class="panel"><h2>BSL (HRCF) SANRAKSH</h2><p>Maintenance Log System</p><p>A digitalised, localized web platform designed exclusively for Bokaro Steel Plant (BSL) HRCF maintenance operations.</p><h3>Key Features</h3><ul><li>Real-time Shift Status & Tracking</li><li>Secure Login with Staff Number</li><li>Offline Maintenance Log Support</li><li>Google Sheets integration in the next phase</li></ul><hr><p><b>Developed & Architected by</b><br>Sunil Kumar Parida<br>Junior Engineer | HRCF Department<br>Steel Authority of India Limited (SAIL)<br>Bokaro Steel Plant (BSL)</p></div>`;
}
