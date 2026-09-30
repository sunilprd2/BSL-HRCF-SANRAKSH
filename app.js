const API=(window.BSL_CONFIG&&window.BSL_CONFIG.API_URL)||"";
const $=id=>document.getElementById(id);
const esc=v=>String(v??"").replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[m]));
const today=()=>new Date().toISOString().slice(0,10);
const shifts=[{name:"A Shift",start:"06:00",end:"14:00",cls:"a"},{name:"B Shift",start:"14:00",end:"22:00",cls:"b"},{name:"C Shift",start:"22:00",end:"06:00",cls:"c"}];
let session=JSON.parse(localStorage.getItem("sanrakshSession")||"null"),employees=[],areas=[],equipment=[],pending=[];
let cachedProfile=null;

function currentShift(){const h=new Date().getHours();return h>=6&&h<14?"A Shift":h>=14&&h<22?"B Shift":"C Shift"}
function shiftState(name){const h=new Date().getHours()+new Date().getMinutes()/60;const s=shifts.find(x=>x.name===name);let start=+s.start.slice(0,2)+ +s.start.slice(3)/60,end=+s.end.slice(0,2)+ +s.end.slice(3)/60;if(name==="C Shift"){return h>=22||h<6?"Running":h>=6?"Pending":"Completed"}return h>=end?"Completed":h>=start?"Running":"Pending"}
function api(action,data={},method="GET"){
  if(!API||API.includes("PASTE_NEW"))return Promise.reject(new Error("API URL missing"));
  return new Promise((resolve,reject)=>{
    const cb="__sanraksh_cb_"+Date.now()+"_"+Math.floor(Math.random()*100000);
    const u=new URL(API);
    u.searchParams.set("api","1");
    u.searchParams.set("action",action);
    u.searchParams.set("prefix",cb);
    Object.entries(data||{}).forEach(([k,v])=>{
      if(v!==undefined&&v!==null)u.searchParams.set(k,typeof v==="string"?v:JSON.stringify(v));
    });
    const s=document.createElement("script");
    const timer=setTimeout(()=>{cleanup();reject(new Error("API timeout"));},20000);
    function cleanup(){clearTimeout(timer);delete window[cb];s.remove();}
    window[cb]=(result)=>{cleanup();resolve(result)};
    s.onerror=()=>{cleanup();reject(new Error("API request failed"))};
    s.src=u.toString();
    document.body.appendChild(s);
  });
}
function setMessage(id,msg,good=false){$(id).textContent=msg;$(id).style.color=good?"#16813b":"#c62828"}
function showScreen(id){["loginScreen","setupScreen","profileScreen","forgotScreen","appScreen"].forEach(x=>$(x).classList.add("hidden"));$(id).classList.remove("hidden")}
function toggleEye(){const x=$("loginPassword");x.type=x.type==="password"?"text":"password"}
async function login(){
 const staff=$("loginStaffNo").value.trim(),pass=$("loginPassword").value;
 if(!/^\d{6}$/.test(staff)){setMessage("loginMsg","Staff No must be exactly 6 digits.");return}
 setMessage("loginMsg","Checking...",true);
 try{const r=await api("login",{staffNo:staff,password:pass});if(!r.success){setMessage("loginMsg",r.message||"Login failed.");return}
 session=r;localStorage.setItem("sanrakshSession",JSON.stringify(r));
 if(r.firstTime){openPasswordSetup(staff);return}
 await openProfile(true);
 }catch(e){setMessage("loginMsg","Connection error. Please check API URL.");}
}
function openPasswordSetup(staff){$("setupStaff").value=staff;showScreen("setupScreen");$("setupPass").value="";$("setupConfirm").value="";passwordRules()}
function passwordRules(){const p=$("setupPass").value;const tests=[["r1",p.length>=8,"Minimum 8 characters"],["r2",/[A-Z]/.test(p),"One capital letter"],["r3",/[a-z]/.test(p),"One small letter"],["r4",/[0-9]/.test(p),"One number"],["r5",/[^A-Za-z0-9]/.test(p),"One special character"]];tests.forEach(t=>{$(t[0]).textContent=(t[1]?"✓ ":"✗ ")+t[2];$(t[0]).className=t[1]?"good":""})}
async function createPassword(){const s=$("setupStaff").value.trim(),p=$("setupPass").value,c=$("setupConfirm").value;if(p!==c){setMessage("setupMsg","Passwords do not match.");return}try{const r=await api("setFirstPassword",{staffNo:s,password:p});if(!r.success){setMessage("setupMsg",r.message);return}const l=await api("login",{staffNo:s,password:p});session=l;localStorage.setItem("sanrakshSession",JSON.stringify(l));await openProfile(false)}catch(e){setMessage("setupMsg","Connection error.")}}
async function newUser(){const s=prompt("Enter your 6 digit Staff No:");if(!s)return;if(!/^\d{6}$/.test(s)){alert("Staff No must be exactly 6 digits.");return}try{const r=await api("newUser",{staffNo:s});if(!r.success){alert(r.message||"Staff No not available.");return}$("loginStaffNo").value=s;$("loginPassword").value="";openPasswordSetup(s)}catch(e){alert("Connection error.")}}
async function forgot(){showScreen("forgotScreen");$("forgotStaff").value=$("loginStaffNo").value}
async function resetPassword(){const s=$("forgotStaff").value.trim();try{const r=await api("requestPasswordReset",{staffNo:s});setMessage("forgotMsg",r.message||"Request submitted.",!!r.success)}catch(e){setMessage("forgotMsg","Connection error.")}}

async function openProfile(afterLogin){
 showScreen("profileScreen");$("profileStaffNo").value=session.staffNo||"";setMessage("profileMsg","Loading saved details...",true);
 try{
  const p=await api("profile",{staffNo:session.staffNo},"GET");cachedProfile=p||{};
  $("profileName").value=p.name||session.name||"";$("profileEmail").value=p.email||session.email||"";
  const ds=p.department||"",ty=p.employeeType||"",dg=p.designation||"",mob=p.mobile||"";
  const deps=p.departments||["Electrical","Mechanical","Operation","Others"];
  $("profileDepartment").innerHTML='<option value="">Select Department</option>'+deps.map(x=>`<option>${esc(x)}</option>`).join("");$("profileDepartment").value=ds;
  $("profileType").value=ty;loadDesignations();$("profileDesignation").value=dg;$("profileMobile").value=mob;
  const has=!!(p.department&&p.mobile&&p.employeeType&&p.designation);
  setMessage("profileMsg",has?"Saved employee details loaded. You may edit permitted fields or continue to Home.":"Please complete your employee details before entering the system.",true);
  $("profileHomeBtn").disabled=!has;
 }catch(e){setMessage("profileMsg","Unable to load Employee Details.")}
}
function loadDesignations(){const t=$("profileType").value;const d={Executive:["Assistant Manager","Manager","Senior Manager","Assistant General Manager (AGM)","Deputy General Manager (DGM)"],"Non-Executive":["Jr. Engineer","Engineering Associate","Jr. Engineering Associate","Technical Associate"],"Contract Worker":["Contract Worker"]}[t]||[];$("profileDesignation").innerHTML='<option value="">Select Designation</option>'+d.map(x=>`<option>${esc(x)}</option>`).join("")}
async function saveProfile(){const details={staffNo:session.staffNo,sessionToken:session.sessionToken,name:$("profileName").value,department:$("profileDepartment").value,mobile:$("profileMobile").value.trim(),employeeType:$("profileType").value,designation:$("profileDesignation").value,email:$("profileEmail").value};if(!details.department||!/^\d{10}$/.test(details.mobile)||!details.employeeType||!details.designation){setMessage("profileMsg","Please complete all employee details correctly.");return}try{const r=await api("saveProfile",{details});if(!r.success){setMessage("profileMsg",r.message);return}cachedProfile=r;session={...session,name:r.name,department:r.department,mobile:r.mobile,employeeType:r.employeeType,designation:r.designation};localStorage.setItem("sanrakshSession",JSON.stringify(session));setMessage("profileMsg","Employee details saved successfully.",true);$("profileHomeBtn").disabled=false;setTimeout(home,500)}catch(e){setMessage("profileMsg","Connection error.")}}
function continueHome(){home()}
function logout(){localStorage.removeItem("sanrakshSession");session=null;location.reload()}

function statusPill(s){const c=String(s||"").toLowerCase();return `<span class="status-pill ${c}">${esc(s||"")}</span>`}
function renderShell(page,title,sub=""){showScreen("appScreen");document.querySelectorAll("#nav button").forEach(b=>b.classList.toggle("active",b.dataset.page===page));$("topTitle").innerHTML=`${esc(title)}<br><small>${esc(sub)}</small>`;$("topUser").textContent=session?.name||session?.staffNo||"●"}
function home(){
 renderShell("home","BSL (HRCF) - SANRAKSH","Maintenance Log System");
 $("content").innerHTML='<div class="loading panel">Loading dashboard...</div>';
 Promise.all([api("dashboard",{}, "GET").catch(()=>({})),api("allShiftCrew",{date:today()},"GET").catch(()=>[]),api("employees",{},"GET").catch(()=>[])])
 .then(([dash,crew,emps])=>{
  employees=Array.isArray(emps)?emps:[];const now=currentShift();const c=(Array.isArray(crew)?crew:[]).find(x=>x.shiftName===now)||{};
  $("content").innerHTML=`<h1 class="page-title">Home</h1>
  <div class="home-hero"><h2>Welcome, ${esc(session?.name||session?.staffNo||"Employee")}</h2><p>${esc(session?.employeeType||"Employee")}</p><p><b>${now}</b> • ${shifts.find(x=>x.name===now)?.start} - ${shifts.find(x=>x.name===now)?.end} • ${today()}</p></div>
  <div class="shift-grid">${shifts.map(s=>{const x=(Array.isArray(crew)?crew:[]).find(y=>y.shiftName===s.name)||{};const emp=employees.find(e=>String(e.name).toLowerCase()===String(x.shiftIncharge||"").toLowerCase());const st=shiftState(s.name);return `<div class="shift-card ${s.cls} ${st==="Running"?"active":""}" onclick="shiftDetailsPage('${s.name}')"><h3>${s.name.toUpperCase()}</h3><div class="time">${s.start} - ${s.end}</div><div class="incharge">${esc(x.shiftIncharge||"Not entered")}</div><div class="phone">☎ ${esc(emp?.mobile||"")}</div><span class="shift-status ${st.toLowerCase()}">${st}</span></div>`}).join("")}</div>
  <div class="current-card"><h3>Current Shift Details (${now})</h3><div class="current-grid"><div><b>Shift In-charge</b><span>${esc(c.shiftIncharge||"Not entered")}</span></div><div><b>Line In-charge</b><span>${esc(c.lineIncharge||"Not entered")}</span></div><div><b>Crew</b><span>Total ${c.totalCrew||0} • BSL ${c.bslEmployees||0} • Contract ${c.contractWorkers||0}</span></div></div></div>
  <div class="quick-grid"><button class="q-blue" onclick="openPage('addLog')">▣<br>Add Log</button><button class="q-green" onclick="openPage('logs')">▤<br>View Logs</button><button class="q-orange" onclick="openPage('reports')">▥<br>Reports</button><button class="q-purple" onclick="openPage('employees')">♟<br>Employee Details</button><button class="q-cyan" onclick="openPage('shifts')">▦<br>Shift Details</button><button class="q-info" onclick="openPage('about')">ⓘ<br>About</button></div>`;
 }).catch(()=>{$("content").innerHTML='<div class="panel">Unable to load dashboard.</div>'})
}
function openPage(p){if(p==="home")home();else if(p==="addLog")addLogPage();else if(p==="logs")logsPage();else if(p==="employees")employeesPage();else if(p==="shifts")shiftDetailsPage();else if(p==="reports")reportsPage();else if(p==="about")aboutPage();else if(p==="sync")syncPage();$("sidebar").classList.remove("open")}

async function shiftDetailsPage(forceShift=""){
 renderShell("shifts","Shift Details","A / B / C shifts");
 $("content").innerHTML='<div class="panel">Loading shift details...</div>';
 const data=await api("allShiftCrew",{date:today()},"GET").catch(()=>[]);
 $("content").innerHTML=`<h1 class="page-title">Shift Details</h1><div class="panel"><label>Date</label><input type="date" value="${today()}" id="shiftDate"></div>${shifts.map(s=>{const x=(Array.isArray(data)?data:[]).find(y=>y.shiftName===s.name)||{};return `<div class="shift-detail ${s.cls}"><div style="display:flex;justify-content:space-between;align-items:center"><h3>${s.name} (${s.start} - ${s.end})</h3><button class="primary" onclick="editShift('${s.name}')">Edit</button></div><div class="row"><div><b>Shift In-charge</b><div>${esc(x.shiftIncharge||"Not entered")}</div></div><div><b>Line In-charge</b><div>${esc(x.lineIncharge||"Not entered")}</div></div></div><div class="row"><div><b>BSL Employees</b><div>${x.bslEmployees||0}</div></div><div><b>Contract Workers</b><div>${x.contractWorkers||0} • Total ${x.totalCrew||0}</div></div></div></div>`}).join("")}`;
}
async function editShift(name){
 const data=await api("shiftCrew",{date:today(),shift:name},"GET").catch(()=>({}));
 if(!employees.length) employees=await api("employees",{},"GET").catch(()=>[]);
 const opts=employees.map(e=>`<option value="${esc(e.name)}" data-mobile="${esc(e.mobile||"")}">${esc(e.name)}${e.employeeType?" — "+esc(e.employeeType):""}</option>`).join("");
 const sl1=data.shearingLine1Coils||0,sl2=data.shearingLine2Coils||0;
 $("content").innerHTML=`<h1 class="page-title">Edit ${name}</h1><div class="panel"><div class="form-grid">
 <div><label>Shift</label><input readonly value="${name}"></div>
 <div><label>Shift In-Charge *</label><select id="esIn" onchange="syncShiftMobile('esIn','esPhone')"><option value="">Select Shift In-Charge</option>${opts}</select></div>
 <div><label>Mobile No</label><input id="esPhone" readonly placeholder="From Employees master"></div>
 <div><label>Line In-Charge *</label><select id="esLine" onchange="syncShiftMobile('esLine','esLinePhone')"><option value="">Select Line In-Charge</option>${opts}</select></div>
 <div><label>Line In-Charge Mobile</label><input id="esLinePhone" readonly placeholder="From Employees master"></div>
 <div><label>BSL Employees *</label><input id="esBsl" type="number" min="0" value="${data.bslEmployees||0}"></div>
 <div><label>Contract Workers *</label><input id="esCon" type="number" min="0" value="${data.contractWorkers||0}"></div>
 <div><label>Shearing Line-1 Coil Count</label><input id="esSL1" type="number" min="0" value="${Number(sl1)}"></div>
 <div><label>Shearing Line-2 Coil Count</label><input id="esSL2" type="number" min="0" value="${Number(sl2)}"></div>
 </div><div class="form-actions"><button class="secondary" onclick="shiftDetailsPage()">Cancel</button><button class="primary" onclick="saveShift('${name}')">Update</button></div></div>`;
 $("esIn").value=data.shiftIncharge||"";$("esLine").value=data.lineIncharge||"";syncShiftMobile("esIn","esPhone");syncShiftMobile("esLine","esLinePhone");
}
function syncShiftMobile(selectId,phoneId){const s=$(selectId),p=$(phoneId);if(!s||!p)return;const o=s.options[s.selectedIndex];p.value=o?.dataset?.mobile||""}
async function saveShift(name){const d={date:today(),shiftName:name,shiftIncharge:$('esIn').value,lineIncharge:$('esLine').value,bslEmployees:Number($('esBsl').value||0),contractWorkers:Number($('esCon').value||0),totalCrew:Number($('esBsl').value||0)+Number($('esCon').value||0),shearingLine1Coils:Number($('esSL1').value||0),shearingLine2Coils:Number($('esSL2').value||0),sessionToken:session?.sessionToken||"",staffNo:session?.staffNo||""};if(!d.shiftIncharge||!d.lineIncharge){alert("Please select both in-charges.");return}const r=await api("saveShiftCrew",{details:d});alert(r.message||"Updated");if(r.success)shiftDetailsPage()}

async function loadMasters(){if(!areas.length)areas=await api("areas",{},"GET").catch(()=>[]);if(!equipment.length)equipment=await api("equipment",{},"GET").catch(()=>[])}
function totalMinutes(a,b){if(!a||!b)return 0;let [h1,m1]=a.split(":").map(Number),[h2,m2]=b.split(":").map(Number),x=h1*60+m1,y=h2*60+m2;if(y<x)y+=1440;return y-x}
function fmtMin(m){m=Number(m||0);return `${String(Math.floor(m/60)).padStart(2,"0")}:${String(m%60).padStart(2,"0")}`}
async function addLogPage(editLog=null){
 renderShell("addLog",editLog?"Edit Maintenance Log":"Add Maintenance Log",editLog?"Edit existing record":"Offline / Online");await loadMasters();
 const l=editLog||{date:today(),shift:currentShift(),startTime:"",endTime:"",area:"",system:"",subsystem:"",equipment:"",problem:"",solution:"",status:"Pending",remarks:""};
 const systems=[...new Set((equipment||[]).map(x=>x.system||x.equipment).filter(Boolean))];
 $("content").innerHTML=`<h1 class="page-title">${editLog?"Edit":"Add"} Maintenance Log</h1><div class="panel"><div class="form-grid-3">
 <div><label>Date *</label><input id="logDate" type="date" value="${esc(l.date)}"></div><div><label>Start Time *</label><input id="logStart" type="time" value="${esc(l.startTime)}"></div><div><label>End Time *</label><input id="logEnd" type="time" value="${esc(l.endTime)}"></div>
 <div><label>Total Time</label><input id="logTotal" class="total-time" readonly value="${fmtMin(totalMinutes(l.startTime,l.endTime))}"></div><div><label>Shift *</label><select id="logShift">${["A Shift","B Shift","C Shift"].map(x=>`<option>${x}</option>`).join("")}</select></div>
 <div><label>Area *</label><select id="logArea"><option value="">Select Area</option>${areas.map(x=>`<option>${esc(typeof x==="string"?x:x.area||"")}</option>`).join("")}</select></div>
 <div><label>System *</label><select id="logSystem" onchange="loadSubsystems()"><option value="">Select System</option>${systems.map(x=>`<option value="${esc(x)}">${esc(x)}</option>`).join("")}</select></div>
 <div><label>Subsystem *</label><select id="logSubsystem"><option value="">Select Subsystem</option></select></div>
 <div class="full-span"><label>Problem *</label><textarea id="logProblem">${esc(l.problem)}</textarea></div><div class="full-span"><label>Solution</label><textarea id="logSolution">${esc(l.solution)}</textarea></div>
 <div><label>Status *</label><select id="logStatus"><option>Completed</option><option>Pending</option><option>Overlook</option></select></div><div><label>Remark</label><textarea id="logRemarks">${esc(l.remarks)}</textarea></div>
 </div><div class="offline-note">📴 Offline mode is supported. If the connection is unavailable, the log will be queued and synchronized automatically when online.</div><div class="form-actions"><button class="secondary" onclick="openPage('logs')">Cancel</button><button class="primary" onclick="${editLog?"updateLog()":"saveLog()"}">${editLog?"Update Log":"Save Log"}</button></div></div>`;
 $("logShift").value=l.shift||currentShift();$("logArea").value=l.area||"";$("logSystem").value=l.system||l.equipment||"";$("logStatus").value=l.status||"Pending";loadSubsystems(l.subsystem||"");
 ["logStart","logEnd"].forEach(id=>$(id).addEventListener("change",()=>$("logTotal").value=fmtMin(totalMinutes($("logStart").value,$("logEnd").value))));window.__editingLog=editLog||null;
}
function loadSubsystems(selected=""){const sys=$("logSystem")?.value,sub=$("logSubsystem");if(!sub)return;const list=(equipment||[]).filter(x=>(x.system||x.equipment)===sys);sub.innerHTML='<option value="">Select Subsystem</option>'+list.map(x=>`<option value="${esc(x.subsystem||x.equipment||"")}">${esc(x.subsystem||x.equipment||"")}</option>`).join("");if(selected)sub.value=selected}

async function saveLog(){const log=readLogForm();if(!validateLog(log))return;try{const r=await api("saveLog",{log:{...log,staffNo:session.staffNo,sessionToken:session.sessionToken}});if(r.success){alert("Maintenance log saved successfully.");logsPage()}else alert(r.message)}catch(e){alert("Connection error. If offline, this version will queue the record in the next sync build.")}}
function readLogForm(){return {logId:window.__editingLog?.logId||"",date:$("logDate").value,shift:$("logShift").value,startTime:$("logStart").value,endTime:$("logEnd").value,area:$("logArea").value,system:$("logSystem").value,subsystem:$("logSubsystem").value,equipment:$("logSystem").value,problem:$("logProblem").value.trim(),solution:$("logSolution").value.trim(),status:$("logStatus").value,remarks:$("logRemarks").value.trim()}}
function validateLog(l){if(!l.date||!l.startTime||!l.area||!l.system||!l.subsystem||!l.problem||!l.status){alert("Please fill all required fields.");return false}return true}
async function updateLog(){const l=readLogForm();if(!validateLog(l))return;const r=await api("updateLog",{log:l,sessionToken:session.sessionToken,staffNo:session.staffNo});alert(r.message||"Updated");if(r.success)logsPage()}

async function logsPage(){
 renderShell("logs","Maintenance Logs","Filter, view and edit records");
 $("content").innerHTML='<div class="panel">Loading logs...</div>';const xs=await api("logs",{},"GET").catch(()=>[]);
 $("content").innerHTML=`<h1 class="page-title">Maintenance Logs</h1><div class="panel toolbar">
 <div class="field"><label>From Date</label><input id="lf" type="date" value="${today()}"></div><div class="field"><label>To Date</label><input id="lt" type="date" value="${today()}"></div>
 <div class="field"><label>Shift</label><select id="ls"><option>All Shifts</option><option>A Shift (06:00 - 14:00)</option><option>B Shift (14:00 - 22:00)</option><option>C Shift (22:00 - 06:00)</option></select></div>
 <button class="primary" onclick="filterLogs()">Search</button><button class="secondary" onclick="logsPage()">Reset</button></div><div id="logsTable" class="panel table-wrap"></div>`;
 window.__allLogs=xs;filterLogs();
}
function normShift(v){return String(v).replace(/\s*\(.*/,"")}
function filterLogs(){const f=$("lf").value,t=$("lt").value,s=normShift($("ls").value);const xs=(window.__allLogs||[]).filter(x=>(!f||x.date>=f)&&(!t||x.date<=t)&&(!s||s==="All Shifts"||x.shift===s));$("logsTable").innerHTML=`<table class="data-table"><thead><tr><th>#</th><th>Time</th><th>Area</th><th>System</th><th>Subsystem</th><th>Problem</th><th>Status</th><th>Edit</th></tr></thead><tbody>${xs.map((x,i)=>`<tr><td>${i+1}</td><td>${esc(x.startTime)} - ${esc(x.endTime)}</td><td>${esc(x.area)}</td><td>${esc(x.system||x.equipment)}</td><td>${esc(x.subsystem||"")}</td><td>${esc(x.problem)}</td><td>${statusPill(x.status)}</td><td><button class="edit-btn" onclick='addLogPage(${JSON.stringify(x).replace(/'/g,"&#39;")})'>✎</button></td></tr>`).join("")||'<tr><td colspan="8">No logs found.</td></tr>'}</tbody></table>`}

async function employeesPage(){renderShell("employees","Employee Details","Employees master");const xs=await api("employees",{},"GET").catch(()=>[]);employees=xs;const meta=t=>{const v=String(t||"").toLowerCase();return v==="executive"?["#eaf2ff","#2563eb","#1d4ed8"]:v==="non-executive"?["#ecfdf5","#16a34a","#15803d"]:["#fff7ed","#f97316","#c2410c"]};const rows=xs.map((x,i)=>{const m=meta(x.employeeType),mine=String(x.staffNo)===String(session?.staffNo);return `<tr style="background:${m[0]};border-left:5px solid ${m[1]}"><td>${i+1}</td><td>${esc(x.staffNo)}</td><td><b>${esc(x.name)}</b></td><td>${esc(x.department)}</td><td>${esc(x.designation)}</td><td>${esc(x.mobile)}</td><td><span style="background:${m[0]};border:1px solid ${m[1]};color:${m[2]};padding:4px 9px;border-radius:12px;font-weight:700">${esc(x.employeeType)}</span></td><td>${mine?'<button class="edit-btn" onclick="editMyEmployee_()">✎ Edit</button>':'<span style="color:#94a3b8">View only</span>'}</td></tr>`}).join("");$("content").innerHTML=`<h1 class="page-title">Employee Details</h1><div class="panel" style="margin-bottom:12px"><div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center;font-size:13px;font-weight:700"><span>Colour Code:</span><span style="background:#eaf2ff;color:#1d4ed8;padding:5px 10px;border-radius:12px">Executive</span><span style="background:#ecfdf5;color:#15803d;padding:5px 10px;border-radius:12px">Non-Executive</span><span style="background:#fff7ed;color:#c2410c;padding:5px 10px;border-radius:12px">Contract Worker</span><span style="margin-left:auto;color:#64748b">You can edit only your own details.</span></div></div><div class="panel table-wrap"><table class="data-table"><thead><tr><th>#</th><th>Staff No</th><th>Name</th><th>Department</th><th>Designation</th><th>Mobile No</th><th>Employee Type</th><th>Edit</th></tr></thead><tbody>${rows||'<tr><td colspan="8">No employees found.</td></tr>'}</tbody></table></div>`}
function editMyEmployee_(){openProfile(false)}

async function reportsPage(){renderShell("reports","Reports","Current shift maintenance report");$("content").innerHTML=`<h1 class="page-title">Reports</h1><div id="reportBox"></div>`;loadReport()}
function reportDuration_(m){m=Number(m||0);return String(Math.floor(m/60)).padStart(2,"0")+" hr "+String(m%60).padStart(2,"0")+" min"}
function printMaintenanceReport_(){const oldTitle=document.title,d=new Date(),ds=String(d.getDate()).padStart(2,"0")+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+d.getFullYear(),s=currentShift();document.title=`${ds}_${s}_Maintenance Report`;window.print();setTimeout(()=>document.title=oldTitle,1200)}
async function loadReport(){const d=today(),s=currentShift();$("reportBox").innerHTML='<div class="panel">Loading current shift report...</div>';const [r,crew,emps]=await Promise.all([api("report",{date:d,shift:s},"GET").catch(()=>({logs:[]})),api("shiftCrew",{date:d,shift:s},"GET").catch(()=>({})),api("employees",{},"GET").catch(()=>[])]);const list=r.logs||[],siName=crew.shiftIncharge||r.shiftIncharge||"",liName=crew.lineIncharge||r.lineIncharge||"",si=emps.find(e=>String(e.name).toLowerCase()===String(siName).toLowerCase())||{},li=emps.find(e=>String(e.name).toLowerCase()===String(liName).toLowerCase())||{};const bsl=Number(crew.bslEmployees??r.bslEmployees??0),contract=Number(crew.contractWorkers??r.contractWorkers??0),total=bsl+contract,sl1=Number(crew.shearingLine1Coils??r.coilShearSL1??0),sl2=Number(crew.shearingLine2Coils??r.coilShearSL2??0);const completed=list.filter(x=>String(x.status).toLowerCase()==="completed").length,pending=list.filter(x=>String(x.status).toLowerCase()==="pending").length,overlook=list.filter(x=>String(x.status).toLowerCase()==="overlook").length,reportDate=d.split("-").reverse().join("/");const actionRows=list.map((x,i)=>`<tr><td>${i+1}</td><td>${esc(x.startTime)} - ${esc(x.endTime)}<div class="report-total-time">${reportDuration_(totalMinutes(x.startTime,x.endTime))}</div></td><td>${esc(x.area)}</td><td>${esc(x.system||x.equipment)}</td><td>${esc(x.subsystem||"")}</td><td>${esc(x.problem)}</td><td>${esc([x.solution,x.remarks].filter(Boolean).join(" / "))}</td><td>${statusPill(x.status)}</td></tr>`).join("")||'<tr><td colspan="8">No records for current shift.</td></tr>';$('reportBox').innerHTML=`<div class="panel maintenance-report" id="maintenanceReport"><div class="report-actions no-print"><button class="primary" onclick="printMaintenanceReport_()">▣ Save PDF</button></div><div class="report-head"><h2>DAILY SHIFT MAINTENANCE REPORT</h2><div class="report-meta"><div><b>Date:</b> ${esc(reportDate)}</div><div><b>Shift:</b> ${esc(s)}</div><div><b>Shift In-Charge:</b> ${esc(siName||"Not entered")} ${si.mobile?`• ${esc(si.mobile)}`:""}</div><div><b>Start Time:</b> ${esc(r.startTime||shifts.find(x=>x.name===s)?.start||"")}</div><div><b>End Time:</b> ${esc(r.endTime||shifts.find(x=>x.name===s)?.end||"")}</div><div><b>Line In-Charge:</b> ${esc(liName||"Not entered")} ${li.mobile?`• ${esc(li.mobile)}`:""}</div><div><b>Crew Strength:</b> ${total} (BSL: ${bsl}, Contract: ${contract})</div><div><b>Shearing Line-1:</b> ${sl1} Coils</div><div><b>Shearing Line-2:</b> ${sl2} Coils</div></div></div><div class="report-summary"><div><span>Total Logs</span><b>${list.length}</b></div><div><span>Completed</span><b>${completed}</b></div><div><span>Pending</span><b>${pending}</b></div><div><span>Overlook</span><b>${overlook}</b></div></div><div class="table-wrap"><table class="data-table report-table maintenance-report-table"><thead><tr><th>#</th><th>Time / Total Time</th><th>Area / Location</th><th>System</th><th>Subsystem</th><th>Problem Description</th><th>Action Taken / Remarks</th><th>Status</th></tr></thead><tbody>${actionRows}</tbody></table></div></div>`;const styleId="sanraksh-report-print-style";document.getElementById(styleId)?.remove();const st=document.createElement("style");st.id=styleId;st.textContent=`.maintenance-report{background:#fff;border:1px solid #cbd5e1;padding:20px;color:#073b78}.report-actions{display:flex;justify-content:flex-end;margin-bottom:10px}.report-head h2{text-align:center;margin:0 0 18px;font-size:22px;color:#063d78}.report-meta{display:grid;grid-template-columns:repeat(3,1fr);border:1px solid #cbd5e1}.report-meta>div{padding:10px 12px;border-right:1px solid #cbd5e1;border-bottom:1px solid #cbd5e1}.report-meta>div:nth-child(3n){border-right:0}.report-summary{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin:14px 0}.report-summary>div{border:1px solid #cbd5e1;background:#f8fafc;text-align:center;padding:10px}.report-summary span{display:block;font-size:13px}.report-summary b{display:block;font-size:20px;margin-top:4px}.maintenance-report-table th{background:#0b4d8f;color:#fff;text-align:center}.maintenance-report-table td{vertical-align:top}.report-total-time{font-size:12px;margin-top:4px}@media print{body *{visibility:hidden!important}#maintenanceReport,#maintenanceReport *{visibility:visible!important}#maintenanceReport{position:absolute;left:0;top:0;width:100%;border:0;padding:0}.no-print{display:none!important}@page{size:A4 landscape;margin:8mm}}`;document.head.appendChild(st)}

function aboutPage(){renderShell("about","About","BSL (HRCF) - SANRAKSH");$("content").innerHTML=`<div class="about-card sanraksh-about"><div class="about-hero"><img src="sanraksh-icon.png"><div><span>SAIL • BOKARO STEEL PLANT</span><h2>BSL (HRCF) - SANRAKSH</h2><p>Maintenance Log System</p></div></div><div class="about-section"><h3>About SANRAKSH</h3><p>A digital maintenance platform for HRCF to record maintenance activities, manage shift details, employee information and daily shift reports.</p></div><div class="about-section developer"><h3>Developed & Architected by</h3><b>Sunil Kumar Parida</b><p>Junior Engineer | HRCF<br>SAIL / Bokaro Steel Plant (BSL)</p></div><div class="about-section feedback"><h3>💬 Feedback</h3><p>Fill free to give your valuble feedback and suggection to imptove this website</p></div></div><style>.sanraksh-about{padding:0;overflow:hidden;background:#fff;border:1px solid #d7e2ef;box-shadow:0 10px 30px rgba(7,61,120,.12)}.about-hero{background:linear-gradient(135deg,#06457f,#0d6dcc);color:#fff;padding:24px;display:flex;align-items:center;gap:18px}.about-hero img{width:86px;height:86px;border-radius:18px;background:#fff;padding:4px}.about-hero span{font-size:12px;letter-spacing:.8px;opacity:.9}.about-hero h2{margin:5px 0 2px;font-size:25px}.about-hero p{margin:0}.about-section{margin:16px;padding:16px;border-radius:12px;background:#f6f9fd;border-left:4px solid #0b63c7}.about-section h3{margin:0 0 7px;color:#06457f}.developer{background:#eef7ff}.feedback{background:#fff8e8;border-left-color:#f59e0b}</style>`}

async function syncPage(){renderShell("sync","Sync Data","Offline records");$("content").innerHTML='<div class="panel sync-card"><h2>☁ Sync Data</h2><p>Pending records: <b>0</b></p><p>Automatic synchronization will be enabled with the offline queue in the next build step.</p></div>'}

document.addEventListener("DOMContentLoaded",()=>{
 $("loginForm").onsubmit=e=>{e.preventDefault();login()};$("togglePassword").onclick=toggleEye;$("newUserBtn").onclick=newUser;$("forgotBtn").onclick=forgot;$("resetBtn").onclick=resetPassword;$("forgotBack").onclick=()=>showScreen("loginScreen");$("setupBack").onclick=()=>showScreen("loginScreen");$("setupPass").oninput=passwordRules;$("createPasswordBtn").onclick=createPassword;$("profileType").onchange=loadDesignations;$("saveProfileBtn").onclick=saveProfile;$("profileHomeBtn").onclick=continueHome;$("logoutBtn").onclick=logout;$("menuBtn").onclick=()=>$("sidebar").classList.toggle("open");document.querySelectorAll("#nav button").forEach(b=>b.onclick=()=>openPage(b.dataset.page));
 if(session){openProfile(true)}else showScreen("loginScreen");
});
if("serviceWorker"in navigator)navigator.serviceWorker.register("./sw.js").catch(()=>{});
