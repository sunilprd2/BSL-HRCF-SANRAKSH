const API=(window.BSL_CONFIG&&window.BSL_CONFIG.API_URL)||"";
const $=id=>document.getElementById(id);
const esc=v=>String(v??"").replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[m]));
const today=()=>new Date().toISOString().slice(0,10);
const shifts=[{name:"A Shift",start:"06:00",end:"14:00",cls:"a"},{name:"B Shift",start:"14:00",end:"22:00",cls:"b"},{name:"C Shift",start:"22:00",end:"06:00",cls:"c"}];
let session=null,employees=[],areas=[],equipment=[],pending=[];
let cachedProfile=null;

/* =========================================================
   OFFLINE-FIRST STORAGE / AUTOMATIC SYNC
========================================================= */
const OFFLINE_DB="sanraksh-offline-v1";
let offlineDbPromise=null;
function openOfflineDb(){
  if(offlineDbPromise)return offlineDbPromise;
  offlineDbPromise=new Promise((resolve,reject)=>{
    const r=indexedDB.open(OFFLINE_DB,1);
    r.onupgradeneeded=()=>{const db=r.result;if(!db.objectStoreNames.contains("queue"))db.createObjectStore("queue",{keyPath:"id"});if(!db.objectStoreNames.contains("cache"))db.createObjectStore("cache",{keyPath:"key"});};
    r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);
  });
  return offlineDbPromise;
}
async function idbPut(store,value){const db=await openOfflineDb();return new Promise((res,rej)=>{const tx=db.transaction(store,"readwrite");tx.objectStore(store).put(value);tx.oncomplete=()=>res(value);tx.onerror=()=>rej(tx.error);});}
async function idbGet(store,key){const db=await openOfflineDb();return new Promise((res,rej)=>{const tx=db.transaction(store,"readonly");const r=tx.objectStore(store).get(key);r.onsuccess=()=>res(r.result?.value);r.onerror=()=>rej(r.error);});}
async function idbAll(store){const db=await openOfflineDb();return new Promise((res,rej)=>{const tx=db.transaction(store,"readonly");const r=tx.objectStore(store).getAll();r.onsuccess=()=>res(r.result||[]);r.onerror=()=>rej(r.error);});}
async function idbDelete(store,key){const db=await openOfflineDb();return new Promise((res,rej)=>{const tx=db.transaction(store,"readwrite");tx.objectStore(store).delete(key);tx.oncomplete=()=>res(true);tx.onerror=()=>rej(tx.error);});}
async function cachePut(key,value){try{await idbPut("cache",{key,value});}catch(e){}}
async function cacheGet(key,fallback){try{const v=await idbGet("cache",key);return v===undefined?fallback:v;}catch(e){return fallback;}}
const OFFLINE_AUTH_KEY="remembered-login";

async function deriveOfflineVerifier(password,salt){
  const enc=new TextEncoder();
  const key=await crypto.subtle.importKey(
    "raw",enc.encode(password),"PBKDF2",false,["deriveBits"]
  );
  const bits=await crypto.subtle.deriveBits(
    {name:"PBKDF2",salt:salt,iterations:120000,hash:"SHA-256"},
    key,256
  );
  return Array.from(new Uint8Array(bits))
    .map(b=>b.toString(16).padStart(2,"0"))
    .join("");
}

function randomSalt(){
  const salt=new Uint8Array(16);
  crypto.getRandomValues(salt);
  return salt;
}

async function saveOfflineAuth(staff,password,serverSession){
  const salt=randomSalt();
  const verifier=await deriveOfflineVerifier(password,salt);
  await idbPut("cache",{
    key:OFFLINE_AUTH_KEY,
    value:{
      staffNo:staff,
      salt:Array.from(salt),
      verifier,
      session:serverSession,
      savedAt:Date.now()
    }
  });
}

async function getOfflineAuth(){
  return await cacheGet(OFFLINE_AUTH_KEY,null);
}

async function verifyOfflinePassword(password,saved){
  if(!saved?.salt||!saved?.verifier)return false;
  const salt=new Uint8Array(saved.salt);
  const verifier=await deriveOfflineVerifier(password,salt);
  return verifier===saved.verifier;
}

async function clearOfflineAuth(){
  try{await idbDelete("cache",OFFLINE_AUTH_KEY)}catch(e){}
}

function makeClientLogId(){return (crypto?.randomUUID?crypto.randomUUID():("CL-"+Date.now()+"-"+Math.random().toString(36).slice(2,10)));}
async function queuedCount(){try{return (await idbAll("queue")).length}catch(e){return 0}}
async function updateSyncBadge(){const n=await queuedCount();const b=$("syncBadge");if(b){b.textContent=String(n);b.classList.toggle("hidden",n===0)}return n;}
async function queueMaintenanceLog(log){const clientLogId=log.clientLogId||makeClientLogId();const record={id:clientLogId,clientLogId,log:{...log,clientLogId},createdAt:Date.now(),attempts:0};await idbPut("queue",record);await updateSyncBadge();return record;}
async function getQueuedLogs(){return (await idbAll("queue")).sort((a,b)=>a.createdAt-b.createdAt)}
async function syncPending(){
  if(!navigator.onLine)return {synced:0,remaining:await queuedCount()};
  const list=await getQueuedLogs();let synced=0;
  for(const item of list){
    try{const r=await api("saveLog",{log:item.log});if(r&&r.success){await idbDelete("queue",item.id);synced++;}else break;}catch(e){break}
  }
  const remaining=await queuedCount();await updateSyncBadge();return {synced,remaining};
}
window.addEventListener("online",()=>{setTimeout(syncPending,500)});
window.addEventListener("offline",updateSyncBadge);

function currentShift(){const h=new Date().getHours();return h>=6&&h<14?"A Shift":h>=14&&h<22?"B Shift":"C Shift"}
function shiftState(name){const h=new Date().getHours()+new Date().getMinutes()/60;const s=shifts.find(x=>x.name===name);let start=+s.start.slice(0,2)+ +s.start.slice(3)/60,end=+s.end.slice(0,2)+ +s.end.slice(3)/60;if(name==="C Shift"){return h>=22||h<6?"Running":h>=6?"Pending":"Completed"}return h>=end?"Completed":h>=start?"Running":"Pending"}
function api(action,data={},method="GET"){
  if(!navigator.onLine)return Promise.reject(new Error("OFFLINE"));
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
 const staff=$("loginStaffNo").value.trim();
 const pass=$("loginPassword").value;
 const remember=$("rememberOffline")?.checked===true;

 if(!/^\d{6}$/.test(staff)){
   setMessage("loginMsg","Staff No must be exactly 6 digits.");
   return;
 }

 if(!pass){
   setMessage("loginMsg","Please enter your password.");
   return;
 }

 /* OFFLINE LOGIN */
 if(!navigator.onLine){
   try{
     const saved=await getOfflineAuth();

     if(!saved||saved.staffNo!==staff){
       setMessage("loginMsg","Offline login is not enabled for this Staff No.");
       return;
     }

     const valid=await verifyOfflinePassword(pass,saved);

     if(!valid){
       setMessage("loginMsg","Invalid Staff No or Password.");
       return;
     }

     session=saved.session;
     localStorage.setItem("sanrakshSession",JSON.stringify(session));

     setMessage("loginMsg","Offline login successful.",true);
     await openProfile(true);
     return;

   }catch(e){
     setMessage("loginMsg","Offline login is not available on this device.");
     return;
   }
 }

 /* NORMAL ONLINE LOGIN */
 setMessage("loginMsg","Checking...",true);

 try{
   const r=await api("login",{staffNo:staff,password:pass});

   if(!r.success){
     setMessage("loginMsg",r.message||"Login failed.");
     return;
   }

   session=r;
   localStorage.setItem("sanrakshSession",JSON.stringify(r));

   /*
      Do not remember the temporary first-time login.
      Save the offline login only after the normal password
      has already been established.
   */
   if(r.firstTime){
     await clearOfflineAuth();
     openPasswordSetup(staff);
     return;
   }

   if(remember){
     await saveOfflineAuth(staff,pass,r);
   }else{
     await clearOfflineAuth();
   }

   await openProfile(true);
   setTimeout(preloadOfflineData,300);

 }catch(e){
   setMessage("loginMsg","Connection error. Please check API URL.");
 }
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
 }catch(e){
  if(session?.department&&session?.mobile&&session?.employeeType&&session?.designation){
    const p={name:session.name||"",email:session.email||"",department:session.department,mobile:session.mobile,employeeType:session.employeeType,designation:session.designation,departments:["Electrical","Mechanical","Operation","Others"]};
    cachedProfile=p;$("profileName").value=p.name;$("profileEmail").value=p.email;$("profileDepartment").innerHTML='<option value="">Select Department</option>'+p.departments.map(x=>`<option>${esc(x)}</option>`).join("");$("profileDepartment").value=p.department;$("profileType").value=p.employeeType;loadDesignations();$("profileDesignation").value=p.designation;$("profileMobile").value=p.mobile;$("profileHomeBtn").disabled=false;setMessage("profileMsg","Offline mode: using saved Employee Details.",true);
  }else setMessage("profileMsg","Employee Details are not cached. Connect to internet once to initialize offline mode.");
 }}
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
  employees=Array.isArray(emps)?emps:[];
  if(Array.isArray(emps))cachePut("employees",employees);
  const now=currentShift();const c=(Array.isArray(crew)?crew:[]).find(x=>x.shiftName===now)||{};
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
 const emps=await getEmployeesOfflineFirst();
 const typeKey=e=>String(e?.employeeType||"").trim().toLowerCase();
 const executiveEmployees=emps.filter(e=>typeKey(e)==="executive");
 const nonExecutiveEmployees=emps.filter(e=>typeKey(e)==="non-executive");
 const execOpts=executiveEmployees.map(e=>`<option value="${esc(e.name)}" data-mobile="${esc(e.mobile||"")}">${esc(e.name)}</option>`).join("");
 const nonExecOpts=nonExecutiveEmployees.map(e=>`<option value="${esc(e.name)}">${esc(e.name)}</option>`).join("");
 $("content").innerHTML=`<h1 class="page-title">Edit ${name}</h1><div class="panel"><div class="form-grid">
 <div><label>Shift</label><input readonly value="${name}"></div>
 <div><label>Shift In-Charge *</label><select id="esIn" onchange="syncShiftMobile()"><option value="">Select Shift In-Charge</option>${execOpts}</select></div>
 <div><label>Mobile No</label><input id="esPhone" readonly placeholder="From Employees master"></div>
 <div><label>Line In-Charge</label><select id="esLine"><option value="">Select Line In-Charge</option>${nonExecOpts}</select></div>
 <div><label>BSL Employees *</label><input id="esBsl" type="number" value="${data.bslEmployees||0}"></div>
 <div><label>Contract Workers *</label><input id="esCon" type="number" value="${data.contractWorkers||0}"></div>
 </div><div class="form-actions"><button class="secondary" onclick="shiftDetailsPage()">Cancel</button><button class="primary" onclick="saveShift('${name}')">Update</button></div></div>`;
 $("esIn").value=data.shiftIncharge||"";
 $("esLine").value=data.lineIncharge||"";
 syncShiftMobile();
}
function syncShiftMobile(){const s=$("esIn"),p=$("esPhone");if(!s||!p)return;const o=s.options[s.selectedIndex];p.value=o?.dataset.mobile||""}
async function saveShift(name){
 const shiftIncharge=$("esIn").value.trim();
 const lineIncharge=$("esLine").value.trim();
 if(!shiftIncharge){alert("Please select Shift In-Charge from Executive employees.");return}
 if(!lineIncharge){alert("Please select Line In-Charge from Non-Executive employees.");return}
 const d={date:today(),shiftName:name,shiftIncharge,lineIncharge,bslEmployees:Number($("esBsl").value||0),contractWorkers:Number($("esCon").value||0),totalCrew:Number($("esBsl").value||0)+Number($("esCon").value||0),sessionToken:session?.sessionToken||"",staffNo:session?.staffNo||""};
 const r=await api("saveShiftCrew",{details:d});
 alert(r.message||"Updated");
 if(r.success)shiftDetailsPage();
}

async function loadMasters(){
 if(!areas.length){areas=await api("areas",{},"GET").then(r=>{cachePut("areas",r);return r}).catch(()=>cacheGet("areas",[]))}
 if(!equipment.length){equipment=await api("equipment",{},"GET").then(r=>{cachePut("equipment",r);return r}).catch(()=>cacheGet("equipment",[]))}
}
function totalMinutes(a,b){if(!a||!b)return 0;let [h1,m1]=a.split(":").map(Number),[h2,m2]=b.split(":").map(Number),x=h1*60+m1,y=h2*60+m2;if(y<x)y+=1440;return y-x}
function fmtMin(m){m=Number(m||0);return `${String(Math.floor(m/60)).padStart(2,"0")}:${String(m%60).padStart(2,"0")}`}
async function addLogPage(editLog=null){
 renderShell("addLog",editLog?"Edit Maintenance Log":"Add Maintenance Log",editLog?"Edit existing record":"Offline / Online");
 await loadMasters();
 const l=editLog||{date:today(),shift:currentShift(),startTime:"",endTime:"",area:"",equipment:"",problem:"",solution:"",status:"Pending",remarks:""};
 $("content").innerHTML=`<h1 class="page-title">${editLog?"Edit":"Add"} Maintenance Log</h1><div class="panel"><div class="form-grid-3">
 <div><label>Date *</label><input id="logDate" type="date" value="${esc(l.date)}"></div>
 <div><label>Start Time *</label><input id="logStart" type="time" value="${esc(l.startTime)}"></div>
 <div><label>End Time *</label><input id="logEnd" type="time" value="${esc(l.endTime)}"></div>
 <div><label>Total Time</label><input id="logTotal" class="total-time" readonly value="${fmtMin(totalMinutes(l.startTime,l.endTime))}"></div>
 <div><label>Shift *</label><select id="logShift">${["A Shift","B Shift","C Shift"].map(s=>`<option>${s}</option>`).join("")}</select></div>
 <div><label>Area *</label><select id="logArea"><option value="">Select Area</option>${areas.map(x=>`<option>${esc(typeof x==="string"?x:x.area||"")}</option>`).join("")}</select></div>
 <div><label>Equipment *</label><select id="logEquipment"><option value="">Select Equipment</option>${[...new Set(equipment.map(x=>String(x.equipment||"").trim()).filter(Boolean))].map(x=>`<option value="${esc(x)}">${esc(x)}</option>`).join("")}</select></div>
 <div class="full-span"><label>Problem *</label><textarea id="logProblem">${esc(l.problem)}</textarea></div>
 <div class="full-span"><label>Solution</label><textarea id="logSolution">${esc(l.solution)}</textarea></div>
 <div><label>Status *</label><select id="logStatus"><option>Completed</option><option>Pending</option><option>Overlook</option></select></div>
 <div><label>Remark</label><textarea id="logRemarks">${esc(l.remarks)}</textarea></div>
 </div><div class="offline-note">📴 Offline mode is supported. If the connection is unavailable, the log will be queued and synchronized automatically when online.</div><div class="form-actions"><button class="secondary" onclick="openPage('logs')">Cancel</button><button class="primary" onclick="${editLog?"updateLog()":"saveLog()"}">${editLog?"Update Log":"Save Log"}</button></div></div>`;
 $("logShift").value=l.shift||currentShift();$("logArea").value=l.area||"";$("logEquipment").value=l.equipment||"";$("logStatus").value=l.status||"Pending";
 ["logStart","logEnd"].forEach(id=>$(id).addEventListener("change",()=>{$("logTotal").value=fmtMin(totalMinutes($("logStart").value,$("logEnd").value))}));
 window.__editingLog=editLog||null;
}
async function saveLog(){
 const log=readLogForm();if(!validateLog(log))return;
 const payload={...log,staffNo:session?.staffNo||"",sessionToken:session?.sessionToken||"",clientLogId:makeClientLogId()};
 try{
  const r=await api("saveLog",{log:payload});
  if(r.success){alert("Maintenance log saved successfully.");logsPage()}else alert(r.message||"Unable to save log.");
 }catch(e){
  await queueMaintenanceLog(payload);
  alert("Saved on this device. It will automatically sync to the Master Google Sheet when internet returns.");
  logsPage();
 }
}
function readLogForm(){return {logId:window.__editingLog?.logId||"",date:$("logDate").value,shift:$("logShift").value,startTime:$("logStart").value,endTime:$("logEnd").value,area:$("logArea").value,equipment:$("logEquipment").value,problem:$("logProblem").value.trim(),solution:$("logSolution").value.trim(),status:$("logStatus").value,remarks:$("logRemarks").value.trim()}}
function validateLog(l){if(!l.date||!l.startTime||!l.area||!l.equipment||!l.problem||!l.status){alert("Please fill all required fields.");return false}return true}
async function updateLog(){const l=readLogForm();if(!validateLog(l))return;const r=await api("updateLog",{log:l,sessionToken:session.sessionToken,staffNo:session.staffNo});alert(r.message||"Updated");if(r.success)logsPage()}

async function logsPage(){
 renderShell("logs","Maintenance Logs","Filter, view and edit records");
 $("content").innerHTML='<div class="panel">Loading logs...</div>';
 let xs=await api("logs",{},"GET").then(r=>{cachePut("logs",r);return r}).catch(()=>cacheGet("logs",[]));
 const q=await getQueuedLogs();
 const queuedView=q.map(x=>({...x.log,logId:"OFFLINE-"+x.clientLogId.slice(0,8),_offline:true}));
 xs=[...queuedView,...(Array.isArray(xs)?xs:[])];
 $("content").innerHTML=`<h1 class="page-title">Maintenance Logs</h1><div class="panel toolbar">
 <div class="field"><label>From Date</label><input id="lf" type="date" value="${today()}"></div><div class="field"><label>To Date</label><input id="lt" type="date" value="${today()}"></div>
 <div class="field"><label>Shift</label><select id="ls"><option>All Shifts</option><option>A Shift (06:00 - 14:00)</option><option>B Shift (14:00 - 22:00)</option><option>C Shift (22:00 - 06:00)</option></select></div>
 <button class="primary" onclick="filterLogs()">Search</button><button class="secondary" onclick="logsPage()">Reset</button></div><div id="logsTable" class="panel table-wrap"></div>`;
 window.__allLogs=xs;filterLogs();
}
function normShift(v){return String(v).replace(/\s*\(.*/,"")}
function filterLogs(){const f=$("lf").value,t=$("lt").value,s=normShift($("ls").value);const xs=(window.__allLogs||[]).filter(x=>(!f||x.date>=f)&&(!t||x.date<=t)&&(!s||s==="All Shifts"||x.shift===s));$("logsTable").innerHTML=`<table class="data-table"><thead><tr><th>#</th><th>Shift</th><th>Time</th><th>Total Time</th><th>Area</th><th>Equipment</th><th>Problem</th><th>Status</th><th>Edit</th></tr></thead><tbody>${xs.map((x,i)=>`<tr><td>${i+1}</td><td>${esc(x.shift)}</td><td>${esc(x.startTime)} - ${esc(x.endTime)}</td><td>${fmtMin(totalMinutes(x.startTime,x.endTime))}</td><td>${esc(x.area)}</td><td>${esc(x.equipment)}</td><td>${esc(x.problem)}</td><td>${statusPill(x.status)}</td><td><button class="edit-btn" onclick='addLogPage(${JSON.stringify(x).replace(/'/g,"&#39;")})'>✎</button></td></tr>`).join("")||'<tr><td colspan="9">No logs found.</td></tr>'}</tbody></table>`}

async function getEmployeesOfflineFirst(){
 try{
  const xs=await api("employees",{},"GET");
  employees=Array.isArray(xs)?xs:[];
  await cachePut("employees",employees);
  return employees;
 }catch(e){
  const xs=await cacheGet("employees",[]);
  employees=Array.isArray(xs)?xs:[];
  return employees;
 }
}

async function preloadOfflineData(){
 if(!navigator.onLine)return;
 try{await getEmployeesOfflineFirst();await loadMasters()}catch(e){}
}

async function employeesPage(){
 renderShell("employees","Employee Details","Employees master");
 const xs=await getEmployeesOfflineFirst();
 const typeKey=x=>String(x.employeeType||"").trim().toLowerCase();
 const groups=[
  {key:"executive",title:"BSL EXECUTIVES (SHIFT INCHARGES)",cls:"exec",items:employees.filter(x=>typeKey(x)==="executive")},
  {key:"non-executive",title:"BSL EMPLOYEES (TECHNICIANS & OPERATORS)",cls:"nonexec",items:employees.filter(x=>typeKey(x)==="non-executive")},
  {key:"contract",title:"CONTRACT LABOUR",cls:"contract",items:employees.filter(x=>typeKey(x)==="contract worker"||typeKey(x)==="contract")}
 ];
 const cards=g=>g.items.map(x=>{
   const initials=String(x.name||"?").trim().split(/\s+/).slice(0,2).map(v=>v[0]||"").join("").toUpperCase();
   return `<div class="emp-card ${g.cls}">
     <div class="emp-card-top"><div class="emp-avatar">${esc(initials)}</div><div class="emp-main"><b>${esc(x.name)}</b><small>${esc(x.designation||"")}</small><small>${esc(x.department||"")}</small></div><span class="emp-type">${esc(x.employeeType||"")}</span></div>
     <div class="emp-card-bottom"><span>☎ ${esc(x.mobile||"")}</span><span>Staff No: ${esc(x.staffNo||"")}</span></div>
   </div>`;
 }).join("")||'<div class="emp-empty">No employees in this section.</div>';
 $("content").innerHTML=`<h1 class="page-title">Employee Details</h1>
 <style>
 .emp-section{margin-bottom:18px;border-radius:10px;overflow:hidden;border:1px solid #d7e1ec;background:#fff;box-shadow:0 2px 8px rgba(0,0,0,.05)}
 .emp-section-head{padding:11px 16px;font-size:14px;font-weight:800;display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid #dbe5ef}
 .emp-section-head.exec{background:#f3f7ff;color:#123f78;border-left:5px solid #1769c2}.emp-section-head.nonexec{background:#f0fbf6;color:#126b4d;border-left:5px solid #198754}.emp-section-head.contract{background:#fff8ed;color:#9a5a00;border-left:5px solid #e58b16}
 .emp-section-count{font-size:11px;font-weight:700;padding:3px 8px;border-radius:10px;background:#e7eef8;color:#174b82}.nonexec .emp-section-count{background:#daf4e7;color:#14734f}.contract .emp-section-count{background:#ffe8c2;color:#995900}
 .emp-card-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;padding:10px}
 .emp-card{border:1px solid #d7e1ec;border-radius:8px;background:#f9fbfd;overflow:hidden;min-width:0}
 .emp-card.exec{border-top:3px solid #1769c2}.emp-card.nonexec{border-top:3px solid #198754}.emp-card.contract{border-top:3px solid #e58b16}
 .emp-card-top{display:flex;align-items:center;gap:9px;padding:9px 10px;min-height:58px}.emp-avatar{width:28px;height:28px;border-radius:50%;display:flex;align-items:center;justify-content:center;background:#2867d7;color:#fff;font-size:11px;font-weight:800;flex:0 0 28px}.emp-card.nonexec .emp-avatar{background:#0a9b68}.emp-card.contract .emp-avatar{background:#e58b16}.emp-main{min-width:0;flex:1}.emp-main b{display:block;font-size:13px;color:#173f70;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.emp-main small{display:block;color:#536b84;font-size:11px;line-height:1.25;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.emp-type{align-self:flex-start;font-size:9px;font-weight:700;padding:3px 6px;border-radius:3px;background:#e5eefc;color:#1760bf;white-space:nowrap}.emp-card.nonexec .emp-type{background:#ddf5ea;color:#0a7c54}.emp-card.contract .emp-type{background:#fff0d5;color:#9b5a00}
 .emp-card-bottom{border-top:1px solid #dfe7ef;padding:7px 10px;display:flex;justify-content:space-between;gap:8px;font-size:10px;color:#536b84}.emp-empty{padding:16px;color:#718096}
 @media(max-width:1000px){.emp-card-grid{grid-template-columns:repeat(2,minmax(0,1fr))}} @media(max-width:650px){.emp-card-grid{grid-template-columns:1fr}.emp-card-bottom{font-size:10px}}
 </style>
 ${groups.map(g=>`<section class="emp-section"><div class="emp-section-head ${g.cls}"><span>● &nbsp;${g.title}</span><span class="emp-section-count">${g.items.length} Persons</span></div><div class="emp-card-grid">${cards(g)}</div></section>`).join("")}`;
}
async function reportsPage(){
 renderShell("reports","Reports","Daily shift maintenance report");
 $("content").innerHTML=`<h1 class="page-title">Reports</h1>
 <div class="panel report-filter">
  <div class="field"><label>Select Date</label><input id="rd" type="date" value="${today()}"></div>
  <div class="field"><label>Select Shift</label><select id="rs"><option>A Shift</option><option>B Shift</option><option>C Shift</option></select></div>
  <div class="report-filter-actions"><button class="primary" onclick="loadReport()">Search</button><button class="secondary" onclick="resetReport()">Reset</button></div>
 </div>
 <div id="reportBox"></div>`;
 $("rs").value=currentShift();
 loadReport();
}
function resetReport(){ $("rd").value=today(); $("rs").value=currentShift(); loadReport(); }
function reportStatusCount(list,status){return list.filter(x=>String(x.status||"").toLowerCase()===String(status).toLowerCase()).length}
async function loadReport(){
 const d=$("rd").value,s=$("rs").value;
 $("reportBox").innerHTML='<div class="panel">Loading report...</div>';
 const r=await api("report",{date:d,shift:s},"GET").catch(()=>({}));
 const list=Array.isArray(r.logs)?r.logs:[];
 const total=list.length, completed=reportStatusCount(list,"Completed"), pending=reportStatusCount(list,"Pending"), overlook=reportStatusCount(list,"Overlook");
 const crewTotal=Number(r.totalCrew||0), bsl=Number(r.bslEmployees||0), contract=Number(r.contractWorkers||0);
 const start=r.startTime||({ "A Shift":"06:00","B Shift":"14:00","C Shift":"22:00" }[s]||"");
 const end=r.endTime||({ "A Shift":"14:00","B Shift":"22:00","C Shift":"06:00" }[s]||"");
 const si=r.shiftIncharge||"Not entered";
 const key=`sanraksh_coils_${d}_${s}`;
 let coils={}; try{coils=JSON.parse(localStorage.getItem(key)||"{}")}catch(e){}
 const safeDate=d?d.split("-").reverse().join("/"):today().split("-").reverse().join("/");
 document.getElementById("reportPrintStyle")?.remove();
 const ps=document.createElement("style");ps.id="reportPrintStyle";
 ps.textContent=`@media print{
  @page{size:A4 portrait;margin:8mm}
  body{font-size:11px!important;background:#fff!important}
  .sidebar,.topbar,#nav,.report-filter,.report-actions,.page-title,.menu-btn{display:none!important}
  .main{margin:0!important;width:100%!important}
  .content{padding:0!important}
  .report-page{border:1px solid #bbb!important;box-shadow:none!important;margin:0!important;padding:5mm!important}
  .report-title{font-size:18px!important;margin:2px 0 10px!important}
  .report-meta td{font-size:11px!important;padding:7px!important}
  .report-stats{display:grid!important;grid-template-columns:repeat(4,1fr)!important;gap:7px!important;margin:9px 0!important}.report-stat{font-size:11px!important;padding:7px!important;min-width:0!important}
  .report-stat strong{font-size:16px!important}
  .report-table{width:100%!important;table-layout:fixed!important;border-collapse:collapse!important;font-size:13px!important}
  .report-table th,.report-table td{font-size:13px!important;padding:8px 7px!important;line-height:1.4!important;word-break:break-word!important;white-space:normal!important;border:1px solid #aaa!important}
  .report-table th:nth-child(1){width:12%}.report-table th:nth-child(2){width:10%}.report-table th:nth-child(3){width:13%}.report-table th:nth-child(4){width:14%}.report-table th:nth-child(5){width:18%}.report-table th:nth-child(6){width:20%}.report-table th:nth-child(7){width:13%}
  .coil-input{border:0!important;background:transparent!important;padding:0!important;font-size:11px!important}
 }`;
 document.head.appendChild(ps);
 $("reportBox").innerHTML=`<div class="panel report-page">
  <div class="report-actions"><button class="primary" onclick="saveReportPdf()">💾 Save PDF</button></div>
  <h2 class="report-title">DAILY SHIFT MAINTENANCE REPORT</h2>
  <table class="report-meta">
   <tr><td><b>Date:</b> ${esc(safeDate)}</td><td><b>Shift:</b> ${esc(s)}</td><td><b>Shift Incharge:</b> ${esc(si)}</td></tr>
   <tr><td><b>Start Time:</b> ${esc(start)}</td><td><b>End Time:</b> ${esc(end)}</td><td><b>Crew Strength:</b> ${crewTotal} (BSL: ${bsl}, Contract: ${contract})</td></tr>
   <tr><td><b>Coil Shear SL-1:</b> <input class="coil-input" id="coilSL1" placeholder="Enter Coil No" value="${esc(coils.sl1||"")}"></td><td><b>Coil Shear SL-2:</b> <input class="coil-input" id="coilSL2" placeholder="Enter Coil No" value="${esc(coils.sl2||"")}"></td><td><b>Total Logs:</b> ${total}</td></tr>
  </table>
  <div class="report-stats" style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px;">
   <div class="report-stat">Total Logs<strong>${total}</strong></div>
   <div class="report-stat">Completed<strong>${completed}</strong></div>
   <div class="report-stat">Pending<strong>${pending}</strong></div>
   <div class="report-stat">Overlook<strong>${overlook}</strong></div>
  </div>
  <div class="table-wrap"><table class="data-table report-table" style="font-size:13px"><thead><tr><th>Time</th><th>Total Time</th><th>Area / Location</th><th>Equipment</th><th>Problem Description</th><th>Action Taken / Remarks</th><th>Status</th></tr></thead>
  <tbody>${list.map(x=>`<tr><td>${esc(x.startTime||"")} - ${esc(x.endTime||"")}</td><td>${esc(fmtMin(totalMinutes(x.startTime,x.endTime)))}</td><td>${esc(x.area||"")}</td><td>${esc(x.equipment||"")}</td><td>${esc(x.problem||"")}</td><td>${esc([x.solution||"",x.remarks||""].filter(Boolean).join(" / "))}</td><td>${statusPill(x.status)}</td></tr>`).join("")||'<tr><td colspan="7">No maintenance logs found for this date and shift.</td></tr>'}</tbody></table></div>
 </div>`;
}
function saveReportPdf(){
 const d=$("rd")?.value||today(), s=$("rs")?.value||currentShift();
 const coils={sl1:$("coilSL1")?.value||"",sl2:$("coilSL2")?.value||""};
 try{localStorage.setItem(`sanraksh_coils_${d}_${s}`,JSON.stringify(coils))}catch(e){}
 const old=document.title;
 const fileTitle=`${d.split("-").reverse().join("-")}_${s}_Maintenance Report`;
 document.title=fileTitle;
 const restoreTitle=()=>{document.title=old;window.removeEventListener("afterprint",restoreTitle)};
 window.addEventListener("afterprint",restoreTitle,{once:true});
 window.print();
}
function aboutPage(){renderShell("about","About","BSL (HRCF) - SANRAKSH");$("content").innerHTML='<div class="about-card"><img src="sanraksh-icon.png"><h2>BSL (HRCF) - SANRAKSH Maintenance Log System</h2><p>Digital maintenance log, shift crew, employee and daily report platform for HRCF.</p><p><b>Developed & Architected by</b><br>Sunil Kumar Parida<br>Junior Engineer | HRCF<br>SAIL / Bokaro Steel Plant (BSL)</p><p><b>Phone:</b> <a href="tel:7979835047">7979835047</a></p><p><b>Email:</b> <a href="mailto:sunilkumarparida.sail@gmail.com">sunilkumarparida.sail@gmail.com</a></p><p>Fill free to give your valuble feedback and suggection to imptove this website</p></div>'}
async function syncPage(){
 renderShell("sync","Sync Data","Offline records");
 const n=await updateSyncBadge();
 $("content").innerHTML=`<div class="panel sync-card"><h2>☁ Sync Data</h2><p>Pending records: <b id="pendingCount">${n}</b></p><p>${navigator.onLine?"Internet connection available.":"Offline: records are stored safely on this device."}</p><button class="primary" onclick="manualSync()">Sync Now</button></div>`;
}
async function manualSync(){
 const r=await syncPending();await syncPage();
 if(r.synced)alert(`${r.synced} offline record(s) synchronized successfully.`);
 else if(r.remaining)alert("Some records are still pending. They will be retried automatically when internet is available.");
 else alert("No pending records.");
}

document.addEventListener("DOMContentLoaded",()=>{
 $("loginForm").onsubmit=e=>{e.preventDefault();login()};$("togglePassword").onclick=toggleEye;

 const rememberOffline=$("rememberOffline");
 if(rememberOffline){
   getOfflineAuth().then(saved=>{
     rememberOffline.checked=!!saved;
   }).catch(()=>{});

   rememberOffline.addEventListener("change",async()=>{
     if(!rememberOffline.checked){
       await clearOfflineAuth();
     }
   });
 }$("newUserBtn").onclick=newUser;$("forgotBtn").onclick=forgot;$("resetBtn").onclick=resetPassword;$("forgotBack").onclick=()=>showScreen("loginScreen");$("setupBack").onclick=()=>showScreen("loginScreen");$("setupPass").oninput=passwordRules;$("createPasswordBtn").onclick=createPassword;$("profileType").onchange=loadDesignations;$("saveProfileBtn").onclick=saveProfile;$("profileHomeBtn").onclick=continueHome;$("logoutBtn").onclick=logout;$("menuBtn").onclick=()=>$("sidebar").classList.toggle("open");document.querySelectorAll("#nav button").forEach(b=>b.onclick=()=>openPage(b.dataset.page));
 openOfflineDb().then(()=>{updateSyncBadge();if(navigator.onLine)setTimeout(syncPending,700)}).catch(()=>{});
 showScreen("loginScreen");
 if(session&&navigator.onLine)setTimeout(preloadOfflineData,500);
});
if("serviceWorker"in navigator)navigator.serviceWorker.register("./sw.js").catch(()=>{});