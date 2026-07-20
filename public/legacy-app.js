/* Next.js port shim: this script loads after the DOM is already ready,
   so DOMContentLoaded listeners registered below would never fire.
   Defer them to the next tick instead (preserves original execution order). */
(function () {
  if (document.readyState === "loading") return;
  var orig = document.addEventListener.bind(document);
  document.addEventListener = function (type, fn, opts) {
    if (type === "DOMContentLoaded") {
      setTimeout(function () { try { fn.call(document); } catch (e) { console.error("[legacy init]", e); } }, 0);
      return;
    }
    return orig(type, fn, opts);
  };
})();

// ===== LOCAL DATA (hydrated from the API by legacy-bridge.js) =====
const students = {};
const demoAtt = [];
const attState = {};

// ===== MODAL =====
function openM(id) { document.getElementById(id).classList.add('open'); }
function closeM(id) { document.getElementById(id).classList.remove('open'); }
document.querySelectorAll('.overlay').forEach(o => {
  o.addEventListener('click', e => { if (e.target === o) o.classList.remove('open'); });
});

// ===== LOGIN =====
function login(role) {
  document.querySelectorAll('.overlay').forEach(o => o.classList.remove('open'));
  document.getElementById('landingPage').style.display = 'none';
  const map = { admin:'dbAdmin', student:'dbStudent', faculty:'dbFaculty', principal:'dbPrincipal' };
  document.getElementById(map[role]).classList.add('show');
}

function logout() {
  ['dbAdmin','dbStudent','dbFaculty','dbPrincipal'].forEach(id => document.getElementById(id).classList.remove('show'));
  document.getElementById('landingPage').style.display = 'block';
  if (npOpen) toggleNP();
  window.scrollTo(0,0);
}

// ===== SHOW SECTIONS =====
function showSec(secId, linkEl) {
  const el = document.getElementById(secId);
  if (!el) return;
  // Check if inside db-content first
  const dbContent = el.closest('.db-content');
  if (dbContent) {
    // Normal case: section is inside db-content
    dbContent.querySelectorAll(':scope > div').forEach(d => { d.style.display = 'none'; });
    // Also restore db-content visibility in case it was hidden
    dbContent.style.display = '';
  } else {
    // Officer section case: section is a sibling of db-content inside db-main
    const dbMain = el.closest('.db-main');
    if (!dbMain) return;
    // Hide db-content div and all sibling officer section divs
    dbMain.querySelectorAll(':scope > div').forEach(d => { d.style.display = 'none'; });
  }
  el.style.removeProperty('display');
  el.style.display = 'block';
  if (linkEl) {
    const sb = linkEl.closest('.sb');
    sb && sb.querySelectorAll('.sl').forEach(l => l.classList.remove('act'));
    linkEl.classList.add('act');
  }
  const titles = {
    adHome:'Dashboard', adApprovals:'Pending Approvals', adStudents:'Student Database',
    adStudentData:'Student Data (Branch / Year)',
    adForms:'Form Manager', adACM:'ACM — Certificate Module', adExams:'Exams Module',
    adActivities:'Institute Activities', adStaff:'Staff Management', adUsers:'User Management',
    adLibrary:'Library — E-Book Repository', adRolesPerms:'Roles & Permissions',
    adUserApprovals:'Account Approval Queue', adSettings:'Settings',
    priUserApprovals:'Account Approvals', facUserApprovals:'Account Approvals',
    adStudentProfile:'Student Profile Manager', adStaffProfile:'Staff Profile Manager',
    facHome:'Faculty Dashboard', facApprovals:'Department Approvals', facStuProfile:'Student Profile',
    facAttendance:'Attendance Management', facStuInfo:'Student Info Collection',
    facACM:'ACM Module', facStudentData:'Student Data (Branch / Year)',
    facExamModule:'Exam Module', facOffice:'Office Modules', facEST:'EST Module', facCash:'Cash / Fees Search',
    facSearch:'Student Search', facStaff:'Staff & Invigilation', facActivities:'Institute Activities',
    facTimetable:'Timetable Upload', facResModule:'Result Management',
    facPlacement:'Placement Cell', facNSS:'NSS — National Service Scheme', facYRC:'Youth Red Cross',
    facAlumni:'Alumni Cell', facSports:'Sports Section', facWelfare:'Student Welfare Office',
    facStudentAssoc:'Student Association', facStores:'Stores Section', facLibraryUpload:'E-Book Upload (Library)',
    stuHome:'My Dashboard', stuProfile:'My Profile', stuResults:'Academic Results',
    stuAtt:'Attendance', stuForms:'Submit Forms', stuCerts:'Certificates', stuSecurity:'Change Password', stuActivities:'Activities',
    stuLibrary:'Library & E-Books', stuTimetable:'Time Table', stuExamFees:'Exam Fees',
    priHome:'Principal Dashboard', priMyProfile:'My Profile', priPending:'EST Edit Requests', priWorkload:'Workload Review',
    priFacStatus:'Faculty Status', priHODStatus:'HOD Activity', priAttStatus:'Attendance Overview',
    priOffice:'All Office Modules', priEST:'EST Overview', priStudents:'All Students',
    priCommittee:'Committee Approvals', priOfficers:'Officers Approvals', priLibrary:'Library Approvals',
    priGrievances:'Student Grievances (Confidential)', priGallery:'Photo Gallery',
    adGallery:'Photo Gallery Manager', stuGallery:'Photo Gallery', stuGrievance:'Grievance Portal',
    facGallery:'Photo Gallery', stuNotice:'Notice Board', stuAchievements:'Achievements',
    stuInstActivities:'Institute Activities', stuLibrary:'Library & E-Books'
  };
  const tEl = el.closest('.db')?.querySelector('.db-title');
  if (tEl && titles[secId]) tEl.textContent = titles[secId];
}

// ===== EST TABS (old function kept for backward compat — new showESTTab added in new JS block below) =====
function showESTTabLegacy(tabId, linkEl) {
  ['estTeaching','estNonTeaching','estAdmin','estGuest','estGroupD'].forEach(id => {
    const el = document.getElementById(id); if (el) el.style.display = 'none';
  });
  const el = document.getElementById(tabId);
  if (el) el.style.display = 'block';
  if (linkEl) {
    const row = linkEl.closest('.tabs');
    row && row.querySelectorAll('.tab').forEach(t => t.classList.remove('act'));
    linkEl.classList.add('act');
  }
}
function showGuestTab(tabId, linkEl) {
  ['gInfo','gWorkload','gUpload'].forEach(id => {
    const el = document.getElementById(id); if (el) el.style.display = 'none';
  });
  const el = document.getElementById(tabId);
  if (el) el.style.display = 'block';
  if (linkEl) {
    const row = linkEl.closest('.tabs');
    row && row.querySelectorAll('.tab').forEach(t => t.classList.remove('act'));
    linkEl.classList.add('act');
  }
}

// ===== ATTENDANCE =====
function toggleBatch() {
  const v = document.getElementById('attClassType').value;
  document.getElementById('batchField').style.display = v === 'Batch-wise Class' ? 'block' : 'none';
}
const waitTimers = {};
function startAttendance() {
  const branch = document.getElementById('attBranch').value;
  const subj = document.getElementById('attSubject').value;
  if (!branch || !subj) { alert('Please select Branch and Subject first.'); return; }
  if (!demoAtt.length) {
    alert('No attendance roster is available yet.');
    return;
  }
  document.getElementById('attStep1').style.display = 'none';
  document.getElementById('attMarkUI').style.display = 'block';
  document.getElementById('attSessionLabel').textContent = `Attendance — ${subj} · ${new Date().toLocaleDateString('en-IN')} · ${new Date().toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit'})}`;
  const grid = document.getElementById('attGrid');
  grid.innerHTML = '';
  demoAtt.forEach(s => {
    attState[s.reg] = null;
    const div = document.createElement('div');
    div.className = 'att-card';
    div.innerHTML = `<div class="reg">${s.reg}</div><div class="sname">${s.name}</div>
      <div class="att-btns">
        <button class="att-btn pres" id="p_${s.reg}" onclick="markAtt('${s.reg}','P')">✓ Present</button>
        <button class="att-btn abs" id="a_${s.reg}" onclick="markAtt('${s.reg}','A')">✗ Absent</button>
        <button class="att-btn wait" id="w_${s.reg}" onclick="markAtt('${s.reg}','W')" title="Wait — 1hr window, auto-absent after 6PM">⏳ Wait</button>
      </div>
      <div id="wt_${s.reg}" style="font-size:0.65rem;color:var(--accent);font-family:'JetBrains Mono',monospace;margin-top:4px;display:none;">⏳ Wait — auto-absent if not updated by 6:00 PM</div>`;
    grid.appendChild(div);
  });
}
function markAtt(reg, status) {
  attState[reg] = status;
  const pBtn = document.getElementById('p_'+reg);
  const aBtn = document.getElementById('a_'+reg);
  const wBtn = document.getElementById('w_'+reg);
  const wInfo = document.getElementById('wt_'+reg);
  if(pBtn) pBtn.classList.toggle('sel', status === 'P');
  if(aBtn) aBtn.classList.toggle('sel', status === 'A');
  if(wBtn) wBtn.classList.toggle('sel', status === 'W');
  if(wInfo) wInfo.style.display = status === 'W' ? 'block' : 'none';
  // Wait logic: set a demo timer (in production, server-side at 6PM)
  if (status === 'W') {
    if (waitTimers[reg]) clearTimeout(waitTimers[reg]);
    // Demo: show notification after 5s (production would be hourly till 6PM)
    waitTimers[reg] = setTimeout(() => {
      if (attState[reg] === 'W') {
        alert(`⏰ Reminder: Student "${reg}" is still on WAIT status. Please mark Present or Absent. Auto-marking as Absent at 6:00 PM.`);
      }
    }, 5000);
    // Auto-absent at 6PM (demo: immediately sets, production = cron job)
    const now = new Date();
    const sixPM = new Date(); sixPM.setHours(18,0,0,0);
    const msTo6PM = Math.max(0, sixPM - now);
    setTimeout(() => {
      if (attState[reg] === 'W') {
        attState[reg] = 'A';
        if(pBtn) pBtn.classList.remove('sel');
        if(aBtn) aBtn.classList.add('sel');
        if(wBtn) wBtn.classList.remove('sel');
        if(wInfo) wInfo.textContent = '❌ Auto-marked Absent (6:00 PM)';
      }
    }, msTo6PM);
  }
}
function submitAtt() {
  // Auto-absent any still on Wait
  Object.entries(attState).forEach(([r,s]) => { if (s === 'W') attState[r] = 'A'; });
  const absent = Object.entries(attState).filter(([r,s]) => s === 'A').map(([r]) => r);
  const marked = Object.values(attState).filter(Boolean).length;
  if (marked < demoAtt.length) { if (!confirm(`${demoAtt.length - marked} students not marked. Submit anyway?`)) return; }
  let msg = `Attendance submitted for ${marked} students.\n`;
  if (absent.length > 0) msg += `\n📱 WhatsApp alerts sent to parents of absent students:\n${absent.join(', ')}\n\n📊 Monthly attendance report will be auto-sent to all parents at month end.\n⚠ HOD notified of this attendance session.`;
  else msg += '\nAll students marked present. No WhatsApp alerts sent.';
  alert(msg);
  document.getElementById('attMarkUI').style.display = 'none';
  document.getElementById('attStep1').style.display = 'block';
}

// ===== STUDENT INFO FETCH =====
function fetchStuInfo() {
  const reg = document.getElementById('stuInfoReg').value.toUpperCase().trim();
  const s = students[reg];
  if (s) {
    document.getElementById('siName').value = s.name;
    document.getElementById('siFather').value = s.father;
    document.getElementById('stuInfoFields').style.display = 'block';
  } else {
    alert('Student not found. Please verify register number.');
    document.getElementById('stuInfoFields').style.display = 'none';
  }
}

// ===== FEES SEARCH =====
function searchFees() {
  const reg = document.getElementById('feesReg').value.toUpperCase().trim();
  const el = document.getElementById('feesResult');
  if (students[reg]) {
    el.style.display = 'block';
    el.querySelector('strong').textContent = students[reg].name;
  } else if (reg.length > 3) {
    el.style.display = 'none';
    alert('No fee record found for: ' + reg);
  }
}

// ===== SEARCH =====
function searchResult(q, containerId) {
  const s = students[q.toUpperCase().trim()];
  const el = document.getElementById(containerId);
  if (!el) return;
  if (s) {
    el.innerHTML = `<div style="background:var(--green-light);border:1px solid var(--green);border-radius:10px;padding:16px;">
      <div style="font-weight:700;color:var(--green);margin-bottom:10px;">✅ Student Found</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
        ${Object.entries({Name:s.name,'Reg. No.':q.toUpperCase(),Department:s.dept,Year:s.year,CGPA:s.cgpa,Attendance:s.att}).map(([k,v])=>`<div><div style="font-size:0.65rem;color:var(--text-muted);font-family:'JetBrains Mono',monospace;text-transform:uppercase;margin-bottom:2px;">${k}</div><div style="font-size:0.8rem;font-weight:600;color:var(--navy);">${v}</div></div>`).join('')}
      </div></div>`;
  } else if (q.length >= 4) {
    el.innerHTML = `<div style="text-align:center;padding:24px;background:var(--red-light);border:1px solid var(--red);border-radius:10px;color:var(--red);">🔍 <strong>Student Data Not Found</strong><br><span style="font-size:0.75rem;">No record for "${q.toUpperCase()}"</span></div>`;
  } else el.innerHTML = '';
}

function fullSearch() { searchResult(document.getElementById('fullSearchInput').value, 'fullSearchResult'); }
function facSearch() { searchResult(document.getElementById('facSearchInput').value, 'facSearchResult'); }

// ===== CERT =====
function genCert() {
  const r = document.getElementById('certReg').value.trim();
  document.getElementById('certOut').style.display = 'block';
  document.getElementById('certOut').scrollIntoView({ behavior:'smooth', block:'nearest' });
}

// ===== NOTIFICATIONS =====
let npOpen = false;
function toggleNP() {
  npOpen = !npOpen;
  const panel = document.getElementById('notifPanel');
  if (panel) panel.classList.toggle('open', npOpen);
  if (npOpen && typeof window.renderLiveNotifications === 'function') {
    window.renderLiveNotifications();
  }
}

function alertLogin() { alert('Please login to access this module.'); }

// ===== COMMITTEE MODAL =====
// ===== COMMITTEE DATA & RENDERING =====
const committeeList = [
  { name:'SC/ST Committee',                  icon:'⚖️',  color:'primary' },
  { name:'Internal Quality Assurance Cell',  icon:'🏅',  color:'purple'  },
  { name:"Women/Girl Students Grievance Cell", icon:'👩', color:'green'  },
  { name:'Anti-Ragging Squad',               icon:'🚫',  color:'red'     },
  { name:'Grievance Redressal',              icon:'📋',  color:'accent'  },
  { name:'Anti-Ragging Committee',           icon:'🛡️',  color:'teal'    },
  { name:'Institute Industry Cell',          icon:'🏭',  color:'orange'  },
  { name:'Internal Complaint Committee',     icon:'📝',  color:'primary' },
  { name:'Media Cell',                       icon:'📢',  color:'purple'  },
];
const committeeMembers = {};

function renderCommitteeGrid() {
  const grid = document.getElementById('cmCardsGrid');
  if (!grid) return;
  grid.innerHTML = committeeList.map(cm => {
    const count = (committeeMembers[cm.name] || []).length;
    return `<div class="cm-est-card" onclick="openCommittee('${cm.name.replace(/'/g,"\\'")}')">
      <div class="cm-est-icon" style="background:var(--${cm.color}-light);color:var(--${cm.color});">${cm.icon}</div>
      <div class="cm-est-body">
        <div class="cm-est-name">${cm.name}</div>
        <div class="cm-est-meta">${count} member${count !== 1 ? 's' : ''}</div>
      </div>
      <div class="cm-est-arrow">›</div>
    </div>`;
  }).join('');
}

function openCommittee(name) {
  if (!committeeMembers[name]) committeeMembers[name] = [
    { name: 'Staff Member', role: 'Chairperson', dept: 'Civil', designation:'HOD / Professor', mobile: '98XXXXXXXX', status:'Approved' },
    { name: 'Staff Member', role: 'Member', dept: 'CSE', designation:'Asst. Professor', mobile: '97XXXXXXXX', status:'Approved' }
  ];
  document.getElementById('cmTitle').textContent = name;
  document.getElementById('cmName').textContent  = name;
  renderCommitteeMembers(name);
  openM('mCommittee');
}

function renderCommitteeMembers(name) {
  const list   = committeeMembers[name] || [];
  const tbody  = document.getElementById('cmTable');
  const isEST  = ['est','faculty','admin'].includes(currentRole);
  const addSec = document.getElementById('cmAddSection');
  if (addSec) addSec.style.display = isEST ? '' : 'none';
  const countEl = document.getElementById('cmMemberCount');
  if (countEl) countEl.textContent = list.length + ' member' + (list.length !== 1 ? 's' : '');
  const visible = list.filter(m => isEST || m.status !== 'Pending');
  tbody.innerHTML = visible.length === 0
    ? `<tr><td colspan="6" style="text-align:center;color:var(--text-muted);padding:28px;font-size:0.82rem;">No members yet. Use the form below to add members.</td></tr>`
    : visible.map(m => {
        const ri = list.indexOf(m);
        return `<tr>
          <td><strong>${m.name}</strong></td>
          <td><span class="badge active">${m.role}</span></td>
          <td>${m.dept||'—'}</td>
          <td style="font-size:0.75rem;">${m.designation||'—'}</td>
          <td style="font-family:'JetBrains Mono',monospace;font-size:0.7rem;">${m.mobile||'—'}</td>
          <td>${isEST
            ? `<div style="display:flex;align-items:center;gap:6px;">
                <span class="badge ${m.status==='Pending'?'pending':'approved'}">${m.status||'Approved'}</span>
                <button class="btn re" style="padding:3px 9px;font-size:0.68rem;" onclick="removeMember('${name.replace(/'/g,"\\'")}',${ri})">🗑️</button>
               </div>`
            : `<span class="badge ${m.status==='Pending'?'pending':'approved'}">${m.status||'Approved'}</span>`
          }</td>
        </tr>`;
      }).join('');
  renderCommitteeGrid();
}

function addCommitteeMember() {
  const name  = document.getElementById('cmTitle').textContent;
  const mname = document.getElementById('cmMName').value.trim();
  const mdesig= document.getElementById('cmMDesig').value.trim();
  const mdept = document.getElementById('cmMDept').value.trim();
  const mrole = document.getElementById('cmMRole').value.trim();
  const mmob  = document.getElementById('cmMMob').value.trim();
  if (!mname) { alert('⚠️ Please enter the member\'s full name.'); document.getElementById('cmMName').focus(); return; }
  if (!mdesig){ alert('⚠️ Please enter the member\'s designation.'); document.getElementById('cmMDesig').focus(); return; }
  if (!mdept) { alert('⚠️ Please enter the branch / department.'); document.getElementById('cmMDept').focus(); return; }
  if (!mrole) { alert('⚠️ Please enter the role in committee.'); document.getElementById('cmMRole').focus(); return; }
  if (!committeeMembers[name]) committeeMembers[name] = [];
  committeeMembers[name].push({ name:mname, role:mrole, dept:mdept, designation:mdesig, mobile:mmob||'—', status:'Pending' });
  ['cmMName','cmMDesig','cmMDept','cmMRole','cmMMob'].forEach(id => { document.getElementById(id).value = ''; });
  renderCommitteeMembers(name);
  const btn = document.querySelector('#cmAddSection button[onclick="addCommitteeMember()"]');
  if (btn) {
    const orig = btn.innerHTML; btn.innerHTML = '✅ Member Added — Pending Principal Approval';
    btn.style.background='#065f46'; btn.disabled=true;
    setTimeout(() => { btn.innerHTML=orig; btn.style.background=''; btn.disabled=false; }, 2500);
  }
}

function removeMember(cname, idx) {
  if (!confirm('Remove this member from the committee?')) return;
  committeeMembers[cname].splice(idx, 1);
  renderCommitteeMembers(cname);
}

// ===== NEW COMMITTEE CREATION =====
let selectedCmIcon = '🏛️';
function openNewCommitteeModal() {
  selectedCmIcon = '🏛️';
  document.querySelectorAll('.cm-icon-btn').forEach(b => b.classList.remove('selected'));
  const first = document.querySelector('.cm-icon-btn[data-icon="🏛️"]');
  if (first) first.classList.add('selected');
  document.getElementById('newCmName').value = '';
  document.getElementById('newCmDesc').value = '';
  openM('mNewCommittee');
}
function selectCmIcon(btn) {
  document.querySelectorAll('.cm-icon-btn').forEach(b => b.classList.remove('selected'));
  btn.classList.add('selected');
  selectedCmIcon = btn.dataset.icon;
}
function createNewCommittee() {
  const name = document.getElementById('newCmName').value.trim();
  if (!name) { alert('⚠️ Please enter a committee name.'); document.getElementById('newCmName').focus(); return; }
  if (committeeList.find(c => c.name.toLowerCase() === name.toLowerCase())) {
    alert('⚠️ A committee with this name already exists.'); return;
  }
  const colors = ['primary','purple','green','red','accent','teal','orange'];
  const color  = colors[committeeList.length % colors.length];
  committeeList.push({ name, icon: selectedCmIcon, color });
  committeeMembers[name] = [];
  closeM('mNewCommittee');
  renderCommitteeGrid();
  // Auto-open the new committee
  setTimeout(() => openCommittee(name), 200);
}

// ===== ACM TAB SWITCHER (admin + faculty ACM workspace) =====
function showACMTab(tabId, btn) {
  // legacy alias
  showAdACMTab(tabId, btn);
}
function showAdACMTab(tabId, btn) {
  ['adAcmCerts', 'adAcmIssue', 'adAcmLookup', 'adAcmPrint', 'adAcmTc', 'adAcmTcReg', 'adAcmTcTpl',
    'adAcmStudy', 'adAcmStudying', 'adAcmStudyReg', 'adAcmStudyTpl', 'adAcmStudyingTpl',
    'acmCerts', 'acmRepeaters', 'acmNOC'].forEach(id => {
    const el = document.getElementById(id); if (el) el.style.display = 'none';
  });
  const el = document.getElementById(tabId); if (el) el.style.display = 'block';
  if (btn) {
    const tabs = btn.closest('.tabs');
    if (tabs) tabs.querySelectorAll('.tab').forEach(t => t.classList.remove('act'));
    btn.classList.add('act');
  }
  if (typeof window.renderAcmModule === 'function') window.renderAcmModule();
  if ((tabId === 'adAcmPrint' || tabId === 'facAcmPrint') && typeof window.acmPrintInitFields === 'function') {
    window.acmPrintInitFields();
  }
  if (tabId === 'adAcmTc' && typeof window.mountTcForm === 'function') window.mountTcForm();
  if (tabId === 'adAcmTcReg' && typeof window.renderTcRegister === 'function') window.renderTcRegister();
  if (tabId === 'adAcmTcTpl' && typeof window.renderTcTemplateEditor === 'function') window.renderTcTemplateEditor();
  if (tabId === 'adAcmStudy' && typeof window.mountStudyForm === 'function') window.mountStudyForm('study');
  if (tabId === 'adAcmStudying' && typeof window.mountStudyForm === 'function') window.mountStudyForm('studying');
  if (tabId === 'adAcmStudyReg' && typeof window.renderStudyRegister === 'function') window.renderStudyRegister();
  if (tabId === 'adAcmStudyTpl' && typeof window.renderStudyTemplateEditor === 'function') window.renderStudyTemplateEditor('study');
  if (tabId === 'adAcmStudyingTpl' && typeof window.renderStudyTemplateEditor === 'function') window.renderStudyTemplateEditor('studying');
}
window.showAdACMTab = showAdACMTab;
window.showACMTab = showACMTab;

// ===== EXAM TAB SWITCHER =====
function showExamTab(tabId, btn) {
  ['exResults','exPDC','exAttShort','exFees','exKeylist','exNotEligible'].forEach(id => {
    const el = document.getElementById(id); if (el) el.style.display = 'none';
  });
  const el = document.getElementById(tabId); if (el) el.style.display = 'block';
  if (btn) {
    btn.closest('.tabs').querySelectorAll('.tab').forEach(t => t.classList.remove('act'));
    btn.classList.add('act');
  }
}

// ===== TAB SWITCHER (Login / Create Account) =====
function switchTab(showId, hideId, activeTab, inactiveTab) {
  document.getElementById(showId).style.display = 'block';
  document.getElementById(hideId).style.display = 'none';
  document.getElementById(activeTab).classList.add('active');
  document.getElementById(inactiveTab).classList.remove('active');
}

// ===== CREATE ACCOUNT HANDLER =====
function createAccount(type) {
  const roleSelect = document.getElementById('facRoleSelect');
  const roleVal = roleSelect ? roleSelect.value : '';
  if (type === 'Faculty' && !roleVal) { alert('⚠️ Please select a Role before creating the account.'); return; }
  const roleLabels = {
    principal:'Principal', hod:'HOD', teaching:'Teaching Staff', nonteaching:'Non-Teaching Faculty',
    guest:'Guest Faculty', registrar:'Registrar', superintendent:'Superintendent',
    acm:'ACM Staff', exam:'Exam Cell Staff', accounts:'Accounts Staff', library:'Library Staff',
    stores:'Stores Staff', est:'EST Staff', cash:'Cash Staff',
    placement:'Placement Officer', nss:'NSS Officer', yrc:'Youth Red Cross Officer',
    alumni:'Alumni Officer', sports:'Sports Officer', swo:'SWO Officer'
  };
  const label = type === 'Faculty' ? (roleLabels[roleVal] || roleVal) : type;
  alert(`📋 ${type} account request submitted!\n\nRole Requested: ${label}\n\n⏳ STATUS: PENDING ROOT ADMIN APPROVAL\n\nYour account will be activated only after Root Admin approves your request.\nYou will receive a notification via Email & WhatsApp once approved.\n\nA temporary password will be assigned after approval and must be changed on first login.\nPlease change on first login.`);
  document.querySelectorAll('.overlay').forEach(o => o.classList.remove('open'));
}

// ===== ADMIN ROLE DESCRIPTION =====
function updateAdminRoleDesc(sel) {
  const desc = {
    root: '🔴 Full system access — manage all users, approve everything, configure system, access all modules.',
    'co-admin': '🟡 Limited admin access — can manage students & forms but cannot configure system or manage users.'
  };
  const el = document.getElementById('adRoleDesc');
  el.textContent = desc[sel.value] || '';
  el.style.color = sel.value === 'root' ? 'var(--red)' : 'var(--accent)';
}

// ===== FACULTY ROLE DESCRIPTIONS & MODULE AUTO-SELECT =====
const facRoleData = {
  principal: {
    color: 'var(--purple)', bg: 'var(--purple-light)',
    desc: '👔 Principal — Full institutional view. Approves EST edits, monitors HODs & faculty, views all modules. Cannot directly edit database.',
    modules: ['All Dashboards (View Only)','EST Edit Approvals','HOD Activity Monitor','Attendance Overview','Workload Review','All Office Modules']
  },
  hod: {
    color: 'var(--orange)', bg: 'var(--orange-light)',
    desc: '🎓 HOD — Full department control. Approve forms, manage attendance, view all dept. data, approve guest faculty workloads.',
    modules: ['Student Profile','Attendance Management','ACM Module','Office Modules','EST Module','Student Search','Staff & Invigilation','Institute Activities','Department Forms','360° Feedback']
  },
  teaching: {
    color: 'var(--primary)', bg: 'var(--primary-light)',
    desc: '👨‍🏫 Teaching Staff — Mark attendance for own subjects, view own dept. student profiles, submit forms.',
    modules: ['Student Profile (own dept)','Attendance Management (own subjects)','Submit Forms','View Results']
  },
  nonteaching: {
    color: 'var(--teal)', bg: 'var(--teal-light)',
    desc: '🔧 Non-Teaching Faculty — Access lab-related records and assigned modules only.',
    modules: ['Assigned Lab Module','Submit Forms']
  },
  guest: {
    color: 'var(--purple)', bg: 'var(--purple-light)',
    desc: '🎓 Guest Faculty — Upload workload only (Daily/Weekly/Monthly). HOD must approve before EST can view.',
    modules: ['Upload Workload (own only)']
  },
  registrar: {
    color: '#5a3000', bg: '#fff3e0',
    desc: '📜 Registrar — Manages official records, correspondence, and institutional documentation.',
    modules: ['Student Records','Staff Records','Official Documents','Certificates','NOC Generation']
  },
  superintendent: {
    color: 'var(--navy)', bg: 'var(--bg2)',
    desc: '🏢 Superintendent — Office administration, manages non-teaching staff duties and day-to-day office operations.',
    modules: ['Office Module','EST View','Staff Attendance','Administration Records']
  },
  est: {
    color: 'var(--teal)', bg: 'var(--teal-light)',
    desc: '📋 EST Staff — View all staff categories (Teaching/Non-Teaching/Admin/Guest/Group D). Edit requests need Principal approval.',
    modules: ['EST Module (View only)','Request Edit (Principal Approval)']
  },
  accounts: {
    color: 'var(--green)', bg: 'var(--green-light)',
    desc: '💰 Accounts Staff — Manage college accounts and financial records.',
    modules: ['Accounts Module']
  },
  library: {
    color: 'var(--navy)', bg: 'var(--bg)',
    desc: '📖 Library Staff — Manage book issues, returns, and library database.',
    modules: ['Library Module']
  },
  acm: {
    color: 'var(--primary)', bg: 'var(--primary-light)',
    desc: '📋 ACM Admin — Same Approvals & Students tools as Root Admin, plus ACM certificate desk. No Cash/Fees or other admin menus.',
    modules: ['Approvals (full)','Students (full)','ACM Module (Certificates)']
  },
  exam: {
    color: '#7a3a00', bg: '#fff7ed',
    desc: '📚 Exam Cell Staff — Manage results, PDC, attendance shortage, exam fees, keylist, and not-eligible list.',
    modules: ['Results','PDC','Attendance Shortage','Exam Fees','Keylist','Not Eligible List']
  },
  cash: {
    color: 'var(--green)', bg: 'var(--green-light)',
    desc: '💵 Cash Staff — Search and view fee payment details (Name, Amount, Date & Receipt Number only).',
    modules: ['Cash / Fees Search (limited view)']
  },
  stores: {
    color: 'var(--text-muted)', bg: 'var(--bg)',
    desc: '📦 Stores Staff — Manage department stores and inventory records.',
    modules: ['Stores Module']
  },
  placement: {
    color: 'var(--primary)', bg: 'var(--primary-light)',
    desc: '💼 Placement Officer — Manage campus placement drives, company registrations, student eligibility and placement records.',
    modules: ['Placement Module','Student Search','Institute Activities — Placement']
  },
  nss: {
    color: '#b30000', bg: '#ffe8e8',
    desc: '🤝 NSS Officer — Manage NSS volunteers, camp registrations, activity records and certificates.',
    modules: ['NSS Module','Submit Forms','Institute Activities — NSS']
  },
  yrc: {
    color: 'var(--red)', bg: 'var(--red-light)',
    desc: '🏥 Youth Red Cross Officer — Manage YRC membership, blood donation drives and event records.',
    modules: ['YRC Module','Submit Forms','Institute Activities — YRC']
  },
  alumni: {
    color: 'var(--purple)', bg: 'var(--purple-light)',
    desc: '🎓 Alumni Officer — Manage alumni registrations, network records and alumni meet events.',
    modules: ['Alumni Module','Submit Forms','Institute Activities — Alumni']
  },
  sports: {
    color: '#1a5e00', bg: '#eaf7e6',
    desc: '🏆 Sports Officer — Manage sports events, achievements, team registrations and sports records.',
    modules: ['Sports Module','Achievements — Sports','Institute Activities — Sports']
  },
  swo: {
    color: 'var(--orange)', bg: 'var(--orange-light)',
    desc: '🛡️ SWO Officer — Handle student welfare complaints, grievances, scholarship tracking and welfare schemes.',
    modules: ['SWO Module','Student Welfare Records','Submit Forms']
  }
};

function updateFacRoleDesc(sel) {
  const data = facRoleData[sel.value];
  const descEl = document.getElementById('facRoleDesc');
  const modsEl = document.getElementById('facModules');
  const boxesEl = document.getElementById('moduleCheckboxes');
  if (!data) { descEl.style.display = 'none'; modsEl.style.display = 'none'; return; }
  descEl.style.display = 'block';
  descEl.style.background = data.bg;
  descEl.style.border = `1px solid ${data.color}33`;
  descEl.style.color = data.color;
  descEl.textContent = data.desc;
  modsEl.style.display = 'block';
  boxesEl.innerHTML = data.modules.map(m =>
    `<label style="display:flex;align-items:center;gap:6px;cursor:pointer;padding:4px 8px;background:var(--bg);border-radius:5px;border:1px solid var(--border);">
       <input type="checkbox" checked style="accent-color:var(--primary);width:14px;height:14px;"> ${m}
     </label>`
  ).join('');
}

// ===== TIMETABLE YEAR TAB =====
function showTTYear(tabId, btn) {
  ['tt1st','tt2nd','tt3rd'].forEach(id => {
    const el = document.getElementById(id); if (el) el.style.display = 'none';
  });
  const el = document.getElementById(tabId); if (el) el.style.display = 'block';
  if (btn) {
    document.getElementById('ttYearTabs').querySelectorAll('.tab').forEach(t => t.classList.remove('act'));
    btn.classList.add('act');
  }
}

// ===== FACULTY TIMETABLE BRANCH TAB =====
function showFacTTBranch(tabId, btn) {
  ['ftCivil','ftCSE','ftECE','ftMech'].forEach(id => {
    const el = document.getElementById(id); if (el) el.style.display = 'none';
  });
  const el = document.getElementById(tabId); if (el) el.style.display = 'block';
  if (btn) {
    btn.closest('.tabs').querySelectorAll('.tab').forEach(t => t.classList.remove('act'));
    btn.classList.add('act');
  }
}

// ===== EXAM FEES CALCULATOR =====
function getRegFee(val) {
  if (val === 'not_this_sem' || val === 'passed') return 0;
  if (val === 'regular') return 350;
  const n = parseInt(val);
  if (n === 1 || n === 2) return 250;
  return 350; // 3 or more
}
function getBridgeFee(val) {
  if (val === 'not_this_sem' || val === 'passed') return 0;
  if (val === 'regular') return 200;
  if (val === 'regular3plus') return 300;
  const n = parseInt(val);
  if (n === 1 || n === 2) return 250;
  return 350; // 3 or more
}
function calcEFRegular() {
  let total = 0;
  const labels = {};
  for (let i=1; i<=6; i++) {
    const sel = document.getElementById('s'+i);
    const fee = getRegFee(sel.value);
    document.getElementById('sf'+i).textContent = fee > 0 ? '₹ '+fee : '—';
    total += fee;
    labels['Sem '+i] = fee;
  }
  const fine = parseInt(document.getElementById('efFineReg').value) || 0;
  total += fine;
  document.getElementById('efTotalReg').value = '₹ ' + total;
}
function calcEFLateral() {
  let total = 0;
  for (let i=3; i<=6; i++) {
    const sel = document.getElementById('ls'+i);
    const fee = getRegFee(sel.value);
    document.getElementById('lsf'+i).textContent = fee > 0 ? '₹ '+fee : '—';
    total += fee;
  }
  ['lb3','lb4'].forEach((id, idx) => {
    const sel = document.getElementById(id);
    const fee = getBridgeFee(sel.value);
    document.getElementById('lbf'+(3+idx)).textContent = fee > 0 ? '₹ '+fee : '—';
    total += fee;
  });
  const fine = parseInt(document.getElementById('efFineLat').value) || 0;
  total += fine;
  document.getElementById('efTotalLat').value = '₹ ' + total;
}

function selectEFType(type) {
  document.getElementById('efStep1').style.display = 'none';
  if (type === 'regular') {
    document.getElementById('efRegular').style.display = 'block';
    calcEFRegular();
  } else {
    document.getElementById('efLateral').style.display = 'block';
    calcEFLateral();
  }
}

function generateEFReceipt(type) {
  const totalEl = type === 'regular' ? document.getElementById('efTotalReg') : document.getElementById('efTotalLat');
  const fine = type === 'regular' ? document.getElementById('efFineReg').value : document.getElementById('efFineLat').value;
  const total = totalEl.value;
  // Build breakup
  let breakup = '';
  if (type === 'regular') {
    const parts = [];
    for (let i=1; i<=6; i++) {
      const sel = document.getElementById('s'+i);
      const fee = getRegFee(sel.value);
      if (fee > 0) parts.push(`Sem ${i}: ₹${fee}`);
    }
    breakup = parts.join(', ') || 'No sems selected';
  } else {
    const parts = [];
    for (let i=3; i<=6; i++) {
      const sel = document.getElementById('ls'+i);
      const fee = getRegFee(sel.value);
      if (fee > 0) parts.push(`Sem ${i}: ₹${fee}`);
    }
    const b3 = getBridgeFee(document.getElementById('lb3').value);
    const b4 = getBridgeFee(document.getElementById('lb4').value);
    if (b3 > 0) parts.push(`Bridge Sem3: ₹${b3}`);
    if (b4 > 0) parts.push(`Bridge Sem4: ₹${b4}`);
    breakup = parts.join(', ') || 'No sems selected';
  }
  document.getElementById('rcptType').textContent = type === 'regular' ? 'Regular Student' : 'Lateral Entry Student';
  document.getElementById('rcptBreakup').textContent = breakup;
  document.getElementById('rcptFine').textContent = '₹ ' + (parseInt(fine) || 0);
  document.getElementById('rcptTotal').textContent = total;
  document.getElementById('rcptDate').textContent = new Date().toLocaleDateString('en-IN');
  document.getElementById('efRegular').style.display = 'none';
  document.getElementById('efLateral').style.display = 'none';
  document.getElementById('efReceiptSection').style.display = 'block';
}

function toggleK2Second() {
  const el = document.getElementById('k2Challan2');
  el.style.display = el.style.display === 'none' ? 'block' : 'none';
}

function submitK2Receipts() {
  const r1 = document.getElementById('k2r1').value.trim();
  const a1 = document.getElementById('k2a1').value.trim();
  if (!r1 || !a1) { alert('Please enter Challan Receipt No. 1 and Amount.'); return; }
  const r2 = document.getElementById('k2r2') ? document.getElementById('k2r2').value.trim() : '';
  let msg = `✅ K2 Challan receipt submitted!\n\nChallan 1: ${r1} — ₹ ${a1}`;
  if (r2) msg += `\nChallan 2: ${r2} — ₹ ${document.getElementById('k2a2').value||'0'}`;
  msg += '\n\nYour exam fee payment has been recorded. You will receive confirmation via WhatsApp.';
  alert(msg);
}

// ===== GALLERY SYSTEM =====
// Shared gallery store (in a real system this would be backend DB)
let galleryItems = [];

function addGalleryItem() {
  const caption = document.getElementById('galleryCaption').value.trim();
  const category = document.getElementById('galleryCategory').value;
  const picker = document.getElementById('galleryFilePicker');
  if (!caption) { alert('Please enter a caption/event name for the photo.'); return; }
  if (!picker.files || picker.files.length === 0) { alert('Please select a photo file first.'); return; }
  const file = picker.files[0];
  const reader = new FileReader();
  reader.onload = function(e) {
    const item = {
      id: Date.now(),
      src: e.target.result,
      caption: caption,
      category: category,
      date: new Date().toLocaleDateString('en-IN', {day:'2-digit', month:'short', year:'numeric'})
    };
    galleryItems.push(item);
    renderAllGalleries();
    document.getElementById('galleryCaption').value = '';
    picker.value = '';
    alert('✅ Photo added to gallery! All users can now view it.');
  };
  reader.readAsDataURL(file);
}

function uploadGalleryImages(input) {
  // Just trigger visual feedback - actual add done via addGalleryItem
  if (input.files && input.files.length > 0) {
    const box = input.closest('.gallery-upload-box');
    if (box) {
      const div = box.querySelector('div');
      if (div) div.textContent = `📎 ${input.files.length} file(s) selected. Enter caption & click Add.`;
    }
  }
}

function deleteGalleryItem(id) {
  if (!confirm('Delete this photo from the gallery?')) return;
  galleryItems = galleryItems.filter(i => i.id !== id);
  renderAllGalleries();
}

function renderGalleryGrid(containerId, filter, allowDelete) {
  const container = document.getElementById(containerId);
  if (!container) return;
  let items = filter ? galleryItems.filter(i => i.category === filter) : galleryItems;
  if (items.length === 0) {
    container.innerHTML = `<div style="grid-column:1/-1;text-align:center;padding:48px;color:var(--text-muted);">
      <div style="font-size:2.5rem;margin-bottom:10px;">🖼️</div>
      <div style="font-weight:700;">${galleryItems.length === 0 ? 'No photos yet' : 'No photos in this category'}</div>
      <p style="font-size:0.78rem;margin-top:6px;">${galleryItems.length === 0 ? (allowDelete ? 'Upload photos above to build the college gallery.' : 'Root Admin hasn\'t uploaded any photos yet.') : 'Try selecting a different category.'}</p>
    </div>`;
    return;
  }
  container.innerHTML = items.map(item => `
    <div class="gallery-item">
      <div class="gallery-img-wrap" onclick="openLightbox('${item.src}','${item.caption}')">
        <img src="${item.src}" alt="${item.caption}" />
      </div>
      <div style="padding:8px 10px;">
        <div class="gallery-caption">${item.caption}</div>
        <div class="gallery-caption-sub">${item.category} · ${item.date}</div>
      </div>
      ${allowDelete ? `<button class="gallery-del-btn" onclick="deleteGalleryItem(${item.id})">🗑️ Remove</button>` : ''}
    </div>
  `).join('');
  if (containerId === 'adminGalleryGrid') {
    const countEl = document.getElementById('galleryCount');
    if (countEl) countEl.textContent = `(${galleryItems.length} photo${galleryItems.length !== 1 ? 's' : ''})`;
  }
}

function renderAllGalleries() {
  const adFilter = document.getElementById('galleryCatFilter') ? document.getElementById('galleryCatFilter').value : '';
  const facFilter = document.getElementById('facGalleryCatFilter') ? document.getElementById('facGalleryCatFilter').value : '';
  const stuFilter = document.getElementById('stuGalleryCatFilter') ? document.getElementById('stuGalleryCatFilter').value : '';
  const priFilter = document.getElementById('priGalleryCatFilter') ? document.getElementById('priGalleryCatFilter').value : '';
  renderGalleryGrid('adminGalleryGrid', adFilter, true);
  renderGalleryGrid('facGalleryGrid', facFilter, false);
  renderGalleryGrid('stuGalleryGrid', stuFilter, false);
  renderGalleryGrid('priGalleryGrid', priFilter, false);
  const countEl = document.getElementById('galleryCount');
  if (countEl) countEl.textContent = `(${galleryItems.length} photo${galleryItems.length !== 1 ? 's' : ''})`;
}

function filterGallery(role) {
  if (role === 'fac') renderGalleryGrid('facGalleryGrid', document.getElementById('facGalleryCatFilter').value, false);
  else if (role === 'stu') renderGalleryGrid('stuGalleryGrid', document.getElementById('stuGalleryCatFilter').value, false);
  else if (role === 'pri') renderGalleryGrid('priGalleryGrid', document.getElementById('priGalleryCatFilter').value, false);
  else renderGalleryGrid('adminGalleryGrid', document.getElementById('galleryCatFilter').value, true);
}

// Lightbox
function openLightbox(src, caption) {
  let lb = document.getElementById('galleryLightbox');
  if (!lb) {
    lb = document.createElement('div');
    lb.id = 'galleryLightbox';
    lb.className = 'gallery-lightbox';
    lb.innerHTML = `<button class="gallery-lightbox-close" onclick="closeLightbox()">✕</button>
      <img id="lbImg" src="" alt="" />
      <div class="gallery-lightbox-cap" id="lbCap"></div>`;
    lb.addEventListener('click', function(e){ if(e.target===lb) closeLightbox(); });
    document.body.appendChild(lb);
  }
  document.getElementById('lbImg').src = src;
  document.getElementById('lbCap').textContent = caption;
  lb.classList.add('open');
}
function closeLightbox() {
  const lb = document.getElementById('galleryLightbox');
  if (lb) lb.classList.remove('open');
}

// Logo & College Photo preview
function previewLogoUpload(input) {
  if (!input.files || !input.files[0]) return;
  const reader = new FileReader();
  reader.onload = function(e) {
    const box = document.getElementById('logoPreviewBox');
    box.innerHTML = `<img src="${e.target.result}" style="width:100%;height:100%;object-fit:cover;border-radius:50%;" />`;
  };
  reader.readAsDataURL(input.files[0]);
}

function previewCollegePhoto(input) {
  if (!input.files || !input.files[0]) return;
  const reader = new FileReader();
  reader.onload = function(e) {
    const box = document.getElementById('collegePhotoPreview');
    box.style.background = 'none';
    box.innerHTML = `<img src="${e.target.result}" style="width:100%;height:100%;object-fit:cover;border-radius:var(--radius);" />`;
  };
  reader.readAsDataURL(input.files[0]);
}

// ===== GRIEVANCE SYSTEM =====
let grievances = [];

function submitGrievance() {
  const subject = document.getElementById('grievSubject').value.trim();
  const category = document.getElementById('grievCategory').value;
  const desc = document.getElementById('grievDesc').value.trim();
  const expect = document.getElementById('grievExpect').value.trim();
  if (!subject || !category || !desc) { alert('Please fill in all required fields.'); return; }
  const g = {
    id: Date.now(),
    subject, category, desc, expect,
    status: 'open',
    submittedOn: new Date().toLocaleString('en-IN', {day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'}),
    resolution: ''
  };
  grievances.push(g);
  document.getElementById('grievSubject').value = '';
  document.getElementById('grievCategory').value = '';
  document.getElementById('grievDesc').value = '';
  document.getElementById('grievExpect').value = '';
  renderStuGrievances();
  renderPriGrievances('all');
  updatePriGrievanceCounts();
  alert('✅ Grievance submitted successfully! Only the Principal can view this. You will be notified via Email once resolved.');
}

function renderStuGrievances() {
  const list = document.getElementById('stuGrievanceList');
  if (!list) return;
  if (grievances.length === 0) {
    list.innerHTML = `<div style="text-align:center;padding:36px;color:var(--text-muted);">
      <div style="font-size:2.5rem;margin-bottom:10px;">📭</div>
      <div style="font-weight:700;">No grievances submitted yet</div>
      <p style="font-size:0.78rem;margin-top:6px;">Submit a grievance above and it will appear here with status.</p>
    </div>`;
    return;
  }
  list.innerHTML = grievances.map(g => `
    <div class="griev-card ${g.status}" style="margin-bottom:10px;">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:6px;">
        <div class="griev-title">📣 ${g.subject}</div>
        <span class="badge ${g.status === 'resolved' ? 'approved' : 'pending'}">${g.status === 'resolved' ? 'Resolved ✅' : 'Open 🔴'}</span>
      </div>
      <div class="griev-meta">Category: ${g.category} · Submitted: ${g.submittedOn}</div>
      <div class="griev-desc">${g.desc}</div>
      ${g.resolution ? `<div class="griev-resolve-box">✅ <strong>Principal's Resolution:</strong> ${g.resolution}</div>` : ''}
    </div>
  `).join('');
}

function renderPriGrievances(filter) {
  const list = document.getElementById('priGrievanceList');
  if (!list) return;
  const filtered = grievances.filter(g => filter === 'all' || g.status === filter);
  const empty = document.getElementById('priGrievEmpty');
  const dynamicArea = document.getElementById('priDynamicGrievances');
  if (filtered.length === 0) {
    list.querySelectorAll('.griev-card').forEach(c => c.style.display = 'none');
    if (dynamicArea) dynamicArea.innerHTML = '';
    if (empty) empty.style.display = 'block';
    return;
  }
  if (empty) empty.style.display = 'none';
  if (dynamicArea) {
    dynamicArea.innerHTML = filtered.map(g => `
      <div class="griev-card ${g.status}" data-status="${g.status}">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:6px;">
          <div class="griev-title">📣 ${g.subject}</div>
          <span class="badge ${g.status === 'resolved' ? 'approved' : 'pending'}">${g.status === 'resolved' ? 'Resolved ✅' : 'Open 🔴'}</span>
        </div>
        <div class="griev-meta">Category: ${g.category} · Submitted: ${g.submittedOn}</div>
        <div class="griev-desc">${g.desc}</div>
        ${g.resolution ? `<div class="griev-resolve-box">✅ <strong>Resolution:</strong> ${g.resolution}</div>` : `
        <div style="margin-top:12px;display:flex;gap:10px;align-items:flex-end;flex-wrap:wrap;">
          <div style="flex:1;min-width:200px;">
            <label style="display:block;font-size:0.7rem;font-weight:700;color:var(--navy);margin-bottom:5px;">Resolution Remarks</label>
            <input type="text" class="grievResRemarks" placeholder="Enter your resolution…" style="width:100%;padding:9px 12px;border:1.5px solid var(--border);border-radius:7px;font-family:'Plus Jakarta Sans',sans-serif;font-size:0.82rem;outline:none;" data-gid="${g.id}" />
          </div>
          <button onclick="resolveGrievance(this)" data-gid="${g.id}" style="padding:9px 18px;background:var(--green);color:white;border:none;border-radius:8px;cursor:pointer;font-weight:700;font-family:'Plus Jakarta Sans',sans-serif;font-size:0.82rem;white-space:nowrap;">✅ Mark Resolved</button>
        </div>`}
      </div>
    `).join('');
  }
}

function resolveGrievance(btn) {
  const card = btn.closest('.griev-card');
  const remarksInput = card.querySelector('.grievResRemarks');
  const remarks = remarksInput ? remarksInput.value.trim() : '';
  if (!remarks) { alert('Please enter resolution remarks before marking as resolved.'); return; }
  const gid = btn.dataset.gid;
  // Update sample or dynamic
  if (!gid) {
    // Static sample card
    card.classList.remove('open');
    card.classList.add('resolved');
    card.querySelector('.badge').className = 'badge approved';
    card.querySelector('.badge').textContent = 'Resolved ✅';
    const actionRow = card.querySelector('[style*="margin-top:12px"]');
    if (actionRow) actionRow.outerHTML = `<div class="griev-resolve-box">✅ <strong>Principal's Resolution:</strong> ${remarks}</div>`;
  } else {
    const g = grievances.find(x => x.id == gid);
    if (g) { g.status = 'resolved'; g.resolution = remarks; }
    renderStuGrievances();
    renderPriGrievances('all');
  }
  updatePriGrievanceCounts();
  alert('✅ Grievance marked as resolved! Student has been notified via Email.');
}

function filterGrievances(filter, btn) {
  if (btn) {
    btn.closest('.tabs').querySelectorAll('.tab').forEach(t => t.classList.remove('act'));
    btn.classList.add('act');
  }
  renderPriGrievances(filter);
}

function updatePriGrievanceCounts() {
  const openCount = grievances.filter(g => g.status === 'open').length;
  const resCount = grievances.filter(g => g.status === 'resolved').length;
  const tot = document.getElementById('priGrievTotal');
  const op = document.getElementById('priGrievOpen');
  const res = document.getElementById('priGrievResolved');
  if (tot) tot.textContent = grievances.length;
  if (op) op.textContent = openCount;
  if (res) res.textContent = resCount;
}

// Add dynamic grievance area to principal list
document.addEventListener('DOMContentLoaded', function() {
  const list = document.getElementById('priGrievanceList');
  if (list) {
    const area = document.createElement('div');
    area.id = 'priDynamicGrievances';
    list.appendChild(area);
  }
});


/* ===== next script block ===== */

// ===== RESULT DATA STORE =====
const resultDB = [];

function getGradeColor(g) {
  if (g==='O'||g==='A+') return 'var(--green)';
  if (g==='A') return 'var(--primary)';
  if (g==='B+'||g==='B') return 'var(--accent)';
  if (g==='C'||g==='P') return 'var(--orange)';
  if (g==='F'||g==='Ab') return 'var(--red)';
  return 'var(--text)';
}
function getResultBadge(r) {
  if (r==='Pass') return '<span class="badge approved">Pass</span>';
  if (r==='Fail') return '<span class="badge rejected">Fail</span>';
  if (r==='Absent') return '<span class="badge pending">Absent</span>';
  return '<span class="badge info">'+r+'</span>';
}

// ===== STUDENT: Load result for selected sem =====
// When semester changes — populate session dropdown
function onStuSemChange() {
  const sem = parseInt(document.getElementById('stuSemSelect').value);
  const sessionBox = document.getElementById('stuSessionBox');
  const sessionSel = document.getElementById('stuSessionSelect');
  const display = document.getElementById('stuResultDisplay');
  const printBtn = document.getElementById('mcPrintBtn');

  // Reset
  display.innerHTML = '';
  if (printBtn) printBtn.style.display = 'none';
  sessionSel.innerHTML = '<option value="">— Choose Session —</option>';

  if (!sem) {
    sessionBox.style.display = 'none';
    return;
  }

  // Find all sessions available for this student's reg + selected semester
  const reg = '';
  const available = resultDB.filter(r => r.reg === reg && r.sem === sem);

  if (!available.length) {
    sessionBox.style.display = 'none';
    display.innerHTML = `<div class="warn-card">
      <div class="wi">📭</div>
      <h3>No Results Available</h3>
      <p>No result has been uploaded for <strong>Semester ${sem}</strong> yet. Please contact the Exam Section.</p>
    </div>`;
    return;
  }

  // Populate sessions
  available.forEach(r => {
    const opt = document.createElement('option');
    opt.value = r.session;
    opt.textContent = r.session;
    sessionSel.appendChild(opt);
  });

  // Auto-select if only one session exists
  if (available.length === 1) {
    sessionSel.value = available[0].session;
    loadStudentResult();
  }

  sessionBox.style.display = 'block';
}

function loadStudentResult() {
  const sem = parseInt(document.getElementById('stuSemSelect').value);
  const session = document.getElementById('stuSessionSelect').value;
  const display = document.getElementById('stuResultDisplay');
  const printBtn = document.getElementById('mcPrintBtn');

  if (!sem || !session) {
    display.innerHTML = '';
    if (printBtn) printBtn.style.display = 'none';
    return;
  }

  const reg = '';
  const result = resultDB.find(r => r.reg === reg && r.sem === sem && r.session === session);

  if (!result) {
    display.innerHTML = `<div class="warn-card">
      <div class="wi">📭</div>
      <h3>No Result Found</h3>
      <p>No result found for <strong>Semester ${sem}</strong> — <strong>${session}</strong>. Please contact the Exam Section.</p>
    </div>`;
    if (printBtn) printBtn.style.display = 'none';
    return;
  }

  // Student view: Credits & Grade only
  let html = `<div class="card" style="overflow:hidden;">
    <div class="card-hd" style="background:linear-gradient(120deg,var(--primary),#2a5abf);padding:16px 20px;">
      <div style="color:white;">
        <div style="font-family:'Libre Baskerville',serif;font-size:1rem;font-weight:700;">Semester ${result.sem} — ${result.session}</div>
        <div style="font-size:0.72rem;opacity:0.8;margin-top:3px;">${result.branch} · ${result.reg}</div>
      </div>
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
        <span style="background:rgba(255,255,255,0.18);color:${result.result==='Pass'?'#a8ffcb':'#ffb3b3'};padding:4px 14px;border-radius:20px;font-size:0.75rem;font-weight:700;border:1px solid rgba(255,255,255,0.25);">${result.result}</span>
        <span style="background:rgba(255,255,255,0.18);color:#ffd97a;padding:4px 14px;border-radius:20px;font-size:0.75rem;font-weight:700;border:1px solid rgba(255,255,255,0.25);">SGPA: ${result.sgpa}</span>
      </div>
    </div>
    <div class="warn-box" style="margin:14px 16px 0;border-radius:8px;font-size:0.73rem;">
      ⚠️ <strong>Reference Only:</strong> Only Credits &amp; Grades are shown here. Internal/External marks are not disclosed. This is NOT a valid marks card. Contact the Exam Section for official copy.
    </div>
    <div style="padding:14px 0 0;">
      <table>
        <thead><tr><th>Subject Name</th><th>Subject Code</th><th style="text-align:center;">Credits</th><th style="text-align:center;">Grade</th></tr></thead>
        <tbody>`;

  let totalCredits = 0;
  result.subjects.forEach(s => {
    totalCredits += (parseInt(s.credits) || 0);
    html += `<tr>
      <td><strong>${s.name}</strong></td>
      <td style="font-family:'JetBrains Mono',monospace;font-size:0.7rem;">${s.code}</td>
      <td style="text-align:center;font-weight:700;">${s.credits}</td>
      <td style="text-align:center;">
        <span style="font-weight:800;font-size:0.82rem;color:${getGradeColor(s.grade)}">${s.grade}</span>
      </td>
    </tr>`;
  });

  html += `<tr style="background:var(--primary-light);">
    <td colspan="2" style="text-align:right;padding-right:16px;"><strong>Total Credits</strong></td>
    <td style="text-align:center;font-weight:800;color:var(--primary);">${totalCredits}</td>
    <td style="text-align:center;font-weight:800;color:var(--primary);">SGPA: ${result.sgpa}</td>
  </tr>
        </tbody>
      </table>
    </div>
    <div style="padding:10px 16px 14px;font-size:0.69rem;color:var(--text-muted);border-top:1px solid var(--border);margin-top:10px;">
      📞 For mark verification &amp; official copy — Contact: Exam Section, Government Polytechnic, Hubli · ☎ 0836-2277154
    </div>
  </div>`;

  display.innerHTML = html;
  if (printBtn) {
    printBtn.style.display = 'inline-block';
    printBtn.setAttribute('data-reg', reg);
    printBtn.setAttribute('data-sem', sem);
    printBtn.setAttribute('data-session', session);
  }
}

// ===== BUILD MARKS CARD HTML (letterhead as per GPT format) =====
function buildMarksCardHTML(result, isStaff) {
  const sessionYear = result.session ? result.session.split(' ').pop() : new Date().getFullYear();
  const academicYear = `${sessionYear}-${parseInt(sessionYear)+1}`;

  // Build subject rows
  let subjectRows = '';
  let totalCredits = 0, earnedCredits = 0;
  result.subjects.forEach((s, i) => {
    const cr = parseInt(s.credits) || 0;
    totalCredits += cr;
    if (s.grade !== 'F' && s.grade !== 'Ab') earnedCredits += cr;
    const gradeColor = getGradeColor(s.grade);
    if (isStaff) {
      const total = (parseInt(s.internal)||0) + (parseInt(s.external)||0);
      subjectRows += `<tr>
        <td style="text-align:left;padding-left:12px;">${i+1}. ${s.name}</td>
        <td>${s.code}</td>
        <td>${s.internal}</td>
        <td>${s.external}</td>
        <td><strong>${total}</strong></td>
        <td style="font-weight:700;">${s.credits}</td>
        <td style="font-weight:800;color:${gradeColor};font-size:0.82rem;">${s.grade}</td>
      </tr>`;
    } else {
      subjectRows += `<tr>
        <td style="text-align:left;padding-left:12px;">${i+1}. ${s.name}</td>
        <td>${s.code}</td>
        <td style="font-weight:700;">${s.credits}</td>
        <td style="font-weight:800;color:${gradeColor};font-size:0.82rem;">${s.grade}</td>
      </tr>`;
    }
  });

  const theadCols = isStaff
    ? `<th style="text-align:left;padding-left:12px;">Subject Name</th><th>Code</th><th>Internal<br><span style="font-weight:400;">(50)</span></th><th>External<br><span style="font-weight:400;">(100)</span></th><th>Total<br><span style="font-weight:400;">(150)</span></th><th>Credits</th><th>Grade</th>`
    : `<th style="text-align:left;padding-left:12px;">Subject Name</th><th>Subject Code</th><th>Credits</th><th>Grade</th>`;

  const footerRow = isStaff
    ? `<td colspan="4" style="text-align:right;padding-right:16px;"><strong>Total Credits: ${totalCredits} &nbsp;|&nbsp; Credits Earned: ${earnedCredits}</strong></td><td colspan="3" style="text-align:center;"><strong>SGPA: ${result.sgpa}</strong></td>`
    : `<td colspan="2" style="text-align:right;padding-right:16px;"><strong>Total Credits: ${totalCredits}</strong></td><td colspan="2" style="text-align:center;"><strong>SGPA: ${result.sgpa}</strong></td>`;

  const resultColor = result.result === 'Pass' ? '#1a8a4a' : '#c0392b';
  const today = new Date().toLocaleDateString('en-IN', {day:'2-digit',month:'long',year:'numeric'});

  return `<div class="result-letterhead">

    <!-- OFFICIAL LETTERHEAD — Matching GPT Hubli Official Format -->
    <div class="lh-official-header">
      <!-- Left: Karnataka Govt Emblem -->
      <div class="lh-emblem-left">
        <div class="lh-emblem-img">🏛️</div>
        <div style="font-size:0.55rem;text-align:center;color:#333;margin-top:2px;line-height:1.3;">ಕರ್ನಾಟಕ<br>ಸರ್ಕಾರ</div>
      </div>

      <!-- Center: Full text block -->
      <div class="lh-center-text">
        <div class="lh-kannada-line1">ಕರ್ನಾಟಕ ಸರ್ಕಾರ</div>
        <div class="lh-kannada-line2">ಕಾಲೇಜು ಮತ್ತು ತಾಂತ್ರಿಕ ಶಿಕ್ಷಣ ಇಲಾಖೆ</div>
        <div class="lh-college-name-en">Government Polytechnic, Hubli</div>
        <div class="lh-address">Vidyanagar, Hubli – 580 021, Karnataka State</div>
        <div class="lh-contact-bar">
          <span>✉ 171gpthubli@gmail.com</span>
          <span>☎ 0836-2277154</span>
        </div>
      </div>

      <!-- Right: GP Hubli logo circle -->
      <div class="lh-right-logo">
        <div class="lh-right-logo-inner">GP<br>HUBLI<br><span style="font-size:0.5rem;font-weight:400;">Est. 1964</span></div>
      </div>
    </div>

    <!-- Title bars -->
    <div class="lh-title-bar">SEMESTER EXAMINATION RESULT</div>
    <div class="lh-subtitle-bar">
      Semester: <strong>${result.sem}${result.sem==1?'st':result.sem==2?'nd':result.sem==3?'rd':'th'} Semester</strong>
      &nbsp;&nbsp;|&nbsp;&nbsp;
      Examination: <strong>${result.session}</strong>
      &nbsp;&nbsp;|&nbsp;&nbsp;
      Academic Year: <strong>${academicYear}</strong>
    </div>

    <!-- Warning -->
    <div class="result-warning">
      ⚠️ &nbsp; THIS IS NOT A VALID RESULT CARD. THIS DOCUMENT IS FOR REFERENCE ONLY. &nbsp; ⚠️<br>
      <span style="font-weight:500;">Please contact the Examination Section for official verification. This document is NOT valid for any official, legal, or institutional purpose.</span>
    </div>

    <!-- Student Info -->
    <div class="result-student-info">
      <div class="rsi-col">
        <div class="rsi-row"><span class="rsi-label">Register Number</span><span class="rsi-val" style="font-family:'JetBrains Mono',monospace;font-weight:700;font-size:0.8rem;">${result.reg}</span></div>
        <div class="rsi-row"><span class="rsi-label">Student</span><span class="rsi-val"><strong>${result.name}</strong></span></div>
        <div class="rsi-row"><span class="rsi-label">Branch / Course</span><span class="rsi-val">${result.branch}</span></div>
      </div>
      <div class="rsi-col">
        <div class="rsi-row"><span class="rsi-label">Semester</span><span class="rsi-val">Semester ${result.sem}</span></div>
        <div class="rsi-row"><span class="rsi-label">Examination</span><span class="rsi-val"><strong>${result.session}</strong></span></div>
        <div class="rsi-row"><span class="rsi-label">Academic Year</span><span class="rsi-val">${academicYear}</span></div>
      </div>
    </div>

    <!-- Result Table -->
    <div style="padding:0;">
      <table class="result-table">
        <thead><tr>${theadCols}</tr></thead>
        <tbody>
          ${subjectRows}
          <tr class="result-footer-row">
            ${footerRow}
          </tr>
        </tbody>
      </table>
    </div>

    <!-- Summary row -->
    <div style="display:flex;justify-content:space-between;align-items:center;padding:10px 18px;border-top:2px solid #1a4fa0;border-bottom:1px solid #ccc;background:#f0f4fb;">
      <div style="font-size:0.8rem;"><strong>Overall Result:</strong>
        <span style="font-weight:800;color:${resultColor};font-size:0.9rem;margin-left:8px;">${result.result}</span>
      </div>
      <div style="font-size:0.8rem;"><strong>SGPA:</strong> <span style="font-weight:800;color:#1a4fa0;font-size:0.9rem;margin-left:6px;">${result.sgpa}</span></div>
      <div style="font-size:0.72rem;color:#555;"><strong>Credits Earned:</strong> ${earnedCredits} / ${totalCredits}</div>
      <div style="font-size:0.72rem;color:#555;"><strong>Date Generated:</strong> ${today}</div>
    </div>

    <!-- Signature Row -->
    <div class="sign-row">
      <div class="sign-box">
        <div class="sign-line"></div>
        <div class="sign-label">Student Signature</div>
        <div class="sign-sublabel">(${result.reg})</div>
      </div>
      <div class="sign-box">
        <div class="sign-line"></div>
        <div class="sign-label">HOD Signature</div>
        <div class="sign-sublabel">Head of Department</div>
      </div>
      <div class="sign-box">
        <div class="sign-line"></div>
        <div class="sign-label">Principal Signature</div>
        <div class="sign-sublabel">Government Polytechnic, Hubli</div>
      </div>
    </div>

    <!-- Footer disclaimer -->
    <div style="text-align:center;font-size:0.62rem;color:#888;padding:8px 14px;border-top:1px solid #ddd;background:#fafafa;line-height:1.6;">
      ⚠️ NOT A VALID DOCUMENT — FOR REFERENCE ONLY — Contact Examination Section for official copy &nbsp;|&nbsp;
      Government Polytechnic, Hubli – 580 021 &nbsp;|&nbsp; ☎ 0836-2277154 &nbsp;|&nbsp; Printed on: ${today}
    </div>

  </div>`;
}

function openMarksCardPrint() {
  const sem = parseInt(document.getElementById('stuSemSelect').value);
  const session = document.getElementById('stuSessionSelect').value;
  const reg = '';
  const result = resultDB.find(r => r.reg===reg && r.sem===sem && r.session===session);
  if (!result) { alert('No result to print.'); return; }
  document.getElementById('marksCardContent').innerHTML = buildMarksCardHTML(result, false);
  document.getElementById('printArea').style.display = 'block';
  setTimeout(() => { window.print(); document.getElementById('printArea').style.display='none'; }, 300);
}

function openStaffMarksCard() {
  // For HOD/staff - shows full marks
  const reg = document.getElementById('editResReg').value.trim();
  const sem = parseInt(document.getElementById('editResSem').value) || 3;
  const result = resultDB.find(r => r.reg===reg && r.sem===sem);
  if (!result) { alert('No result found for this entry.'); return; }
  document.getElementById('marksCardContent').innerHTML = buildMarksCardHTML(result, true);
  document.getElementById('printArea').style.display = 'block';
  setTimeout(() => { window.print(); document.getElementById('printArea').style.display='none'; }, 300);
}

// ===== Admin: Upload PDF =====
function uploadResultPDF() {
  const branch = document.getElementById('upBranch').value;
  const sem = document.getElementById('upSem').value;
  const session = document.getElementById('upSession').value;
  const file = document.getElementById('resultPDFFile').files[0];
  if (!branch || !sem || !session) { alert('Please fill Branch, Semester, and Exam Session.'); return; }
  const tbody = document.getElementById('pdfLogBody');
  const tr = document.createElement('tr');
  tr.innerHTML = `<td>${branch}</td><td>Sem ${sem}</td><td>${session}</td><td>Root Admin</td><td>${new Date().toLocaleDateString('en-IN')}</td><td><div style="display:flex;gap:6px;"><button class="btn pr" onclick="alert('PDF viewer...')">📄 View</button><button class="btn re" onclick="this.closest('tr').remove()">🗑️</button></div></td>`;
  tbody.appendChild(tr);
  alert(`✅ PDF uploaded for ${branch} — Sem ${sem} — ${session}.\nNow enter student results manually in the Result Data section below.`);
}

// ===== Admin: Filter and render results table =====
function renderResultMasterTable(filtered) {
  const tbody = document.getElementById('resultMasterBody');
  if (!tbody) return;
  if (!filtered.length) {
    tbody.innerHTML = '<tr><td colspan="9" style="text-align:center;padding:24px;color:var(--text-muted);">No results found.</td></tr>';
    return;
  }
  tbody.innerHTML = filtered.map(r => `
    <tr>
      <td style="font-family:'JetBrains Mono',monospace;font-size:0.7rem;">${r.reg}</td>
      <td><strong>${r.name}</strong></td>
      <td>${r.branch.replace('Computer Science Engineering','CSE').replace('Civil Engineering','Civil').replace('Mechanical Engineering','Mech')}</td>
      <td style="text-align:center;">Sem ${r.sem}</td>
      <td style="font-size:0.72rem;">${r.session}</td>
      <td style="text-align:center;">${r.subjects.length} Subj.</td>
      <td style="text-align:center;font-weight:700;">${r.sgpa}</td>
      <td>${getResultBadge(r.result)}</td>
      <td>
        <div style="display:flex;gap:5px;">
          <button class="btn pr" onclick="viewFullResultAdmin('${r.reg}',${r.sem},'${r.session}')">👁️</button>
          <button class="btn go" onclick="editResultAdmin('${r.reg}',${r.sem},'${r.session}')">✏️</button>
          <button class="btn re" onclick="deleteResult('${r.reg}',${r.sem},'${r.session}')">🗑️</button>
        </div>
      </td>
    </tr>`).join('');
}
function filterResults() {
  const branch = (document.getElementById('filterBranch')||{}).value||'';
  const sem = (document.getElementById('filterSem')||{}).value||'';
  const filtered = resultDB.filter(r =>
    (!branch || r.branch.toLowerCase().includes(branch.toLowerCase()) || r.branch.toLowerCase().replace('computer science engineering','cse').includes(branch.toLowerCase())) &&
    (!sem || r.sem===parseInt(sem))
  );
  renderResultMasterTable(filtered);
}
function viewFullResultAdmin(reg, sem, session) {
  const result = resultDB.find(r => r.reg===reg && r.sem===sem && r.session===session);
  if (!result) return;
  document.getElementById('marksCardContent').innerHTML = buildMarksCardHTML(result, true);
  document.getElementById('printArea').style.display = 'block';
  setTimeout(() => { window.print(); document.getElementById('printArea').style.display='none'; }, 300);
}
function editResultAdmin(reg, sem, session) {
  // Pre-fill add result modal
  openAddResultModal();
  setTimeout(() => {
    const result = resultDB.find(r => r.reg===reg && r.sem===sem && r.session===session);
    if (!result) return;
    document.getElementById('arReg').value = result.reg;
    document.getElementById('arName').value = result.name;
    document.getElementById('arBranch').value = result.branch;
    document.getElementById('arSem').value = result.sem;
    document.getElementById('arSession').value = result.session;
    document.getElementById('arSGPA').value = result.sgpa;
    document.getElementById('arResult').value = result.result;
    const subDiv = document.getElementById('arSubjects');
    subDiv.innerHTML = '';
    result.subjects.forEach(s => {
      addSubjectRow();
      const rows = subDiv.querySelectorAll('.ar-subject-row');
      const last = rows[rows.length-1];
      last.querySelector('.ar-subname').value = s.name;
      last.querySelector('.ar-subcode').value = s.code;
      last.querySelector('.ar-internal').value = s.internal;
      last.querySelector('.ar-external').value = s.external;
      last.querySelector('.ar-credits').value = s.credits;
      last.querySelector('.ar-grade').value = s.grade;
    });
  }, 100);
}
function deleteResult(reg, sem, session) {
  if (!confirm(`Delete result for ${reg} — Sem ${sem} — ${session}?`)) return;
  const idx = resultDB.findIndex(r => r.reg===reg && r.sem===sem && r.session===session);
  if (idx > -1) resultDB.splice(idx, 1);
  filterResults();
}

function openAddResultModal() {
  document.getElementById('arSubjects').innerHTML = '';
  addSubjectRow();
  openM('mAddResult');
}
function addSubjectRow() {
  const div = document.getElementById('arSubjects');
  const row = document.createElement('div');
  row.className = 'ar-subject-row';
  row.style.cssText = 'display:grid;grid-template-columns:2fr 1fr 1fr 1fr 1fr 1fr auto;gap:8px;margin-bottom:8px;align-items:flex-end;';
  row.innerHTML = `
    <input type="text" class="ar-subname" placeholder="Subject name" style="padding:8px 10px;border:1.5px solid var(--border);border-radius:7px;font-size:0.8rem;font-family:'Plus Jakarta Sans',sans-serif;outline:none;" />
    <input type="text" class="ar-subcode" placeholder="Code" style="padding:8px 10px;border:1.5px solid var(--border);border-radius:7px;font-size:0.8rem;font-family:'Plus Jakarta Sans',sans-serif;outline:none;" />
    <input type="number" class="ar-internal" placeholder="Int." min="0" max="50" style="padding:8px 10px;border:1.5px solid var(--border);border-radius:7px;font-size:0.8rem;font-family:'Plus Jakarta Sans',sans-serif;outline:none;" />
    <input type="number" class="ar-external" placeholder="Ext." min="0" max="100" style="padding:8px 10px;border:1.5px solid var(--border);border-radius:7px;font-size:0.8rem;font-family:'Plus Jakarta Sans',sans-serif;outline:none;" />
    <input type="number" class="ar-credits" placeholder="Cr." min="1" max="6" style="padding:8px 10px;border:1.5px solid var(--border);border-radius:7px;font-size:0.8rem;font-family:'Plus Jakarta Sans',sans-serif;outline:none;" />
    <select class="ar-grade" style="padding:8px 10px;border:1.5px solid var(--border);border-radius:7px;font-size:0.8rem;font-family:'Plus Jakarta Sans',sans-serif;outline:none;">
      <option value="O">O</option><option value="A+">A+</option><option value="A">A</option>
      <option value="B+">B+</option><option value="B">B</option><option value="C">C</option>
      <option value="P">P</option><option value="F">F</option><option value="Ab">Ab</option>
    </select>
    <button onclick="this.parentElement.remove()" style="padding:8px 10px;background:var(--red-light);color:var(--red);border:1.5px solid var(--red);border-radius:7px;cursor:pointer;font-size:0.75rem;">✕</button>`;
  div.appendChild(row);
}
function saveResultEntry() {
  const reg = document.getElementById('arReg').value.trim().toUpperCase();
  const name = document.getElementById('arName').value.trim();
  const branch = document.getElementById('arBranch').value;
  const sem = parseInt(document.getElementById('arSem').value);
  const session = document.getElementById('arSession').value;
  const sgpa = parseFloat(document.getElementById('arSGPA').value)||0;
  const result = document.getElementById('arResult').value;
  if (!reg||!name||!branch||!sem||!session) { alert('Please fill all required fields.'); return; }
  const rows = document.querySelectorAll('#arSubjects .ar-subject-row');
  const subjects = [];
  rows.forEach(row => {
    const sname = row.querySelector('.ar-subname').value.trim();
    if (!sname) return;
    subjects.push({
      name: sname,
      code: row.querySelector('.ar-subcode').value.trim(),
      internal: parseInt(row.querySelector('.ar-internal').value)||0,
      external: parseInt(row.querySelector('.ar-external').value)||0,
      credits: parseInt(row.querySelector('.ar-credits').value)||0,
      grade: row.querySelector('.ar-grade').value
    });
  });
  // Remove existing & add new
  const idx = resultDB.findIndex(r => r.reg===reg && r.sem===sem && r.session===session);
  const entry = { reg, name, branch, sem, session, subjects, sgpa, result };
  if (idx > -1) resultDB[idx] = entry; else resultDB.push(entry);
  closeM('mAddResult');
  filterResults();
  alert(`✅ Result saved for ${name} — Sem ${sem} — ${session}`);
}

// ===== HOD Result Management =====
function showFacResTab(tabId, btn) {
  ['frView','frEdit'].forEach(id => { const el=document.getElementById(id); if(el)el.style.display='none'; });
  const el = document.getElementById(tabId); if(el) el.style.display='block';
  if (btn) { btn.closest('.tabs').querySelectorAll('.tab').forEach(t=>t.classList.remove('act')); btn.classList.add('act'); }
  if (tabId === 'frView') facFilterResults();
}
function facFilterResults() {
  const sem = (document.getElementById('facResSemFilter')||{}).value||'';
  const session = (document.getElementById('facResSessionFilter')||{}).value||'';
  const q = ((document.getElementById('facResSearch')||{}).value||'').toLowerCase();
  // HOD of Civil - filter by Civil branch for demo
  const filtered = resultDB.filter(r =>
    r.branch.toLowerCase().includes('civil') &&
    (!sem || r.sem===parseInt(sem)) &&
    (!session || r.session===session) &&
    (!q || r.reg.toLowerCase().includes(q) || r.name.toLowerCase().includes(q))
  );
  const tbody = document.getElementById('facResultViewBody');
  if (!tbody) return;
  if (!filtered.length) {
    tbody.innerHTML = '<tr><td colspan="13" style="text-align:center;padding:24px;color:var(--text-muted);">No results found for your department.</td></tr>';
    return;
  }
  tbody.innerHTML = filtered.map(r => {
    const subRows = r.subjects.map(s =>
      `<div style="font-size:0.7rem;">${s.code}: Int:${s.internal} Ext:${s.external} <strong style="color:${getGradeColor(s.grade)}">${s.grade}</strong></div>`).join('');
    return `<tr>
      <td style="font-family:'JetBrains Mono',monospace;font-size:0.7rem;">${r.reg}</td>
      <td><strong>${r.name}</strong></td>
      <td style="text-align:center;">Sem ${r.sem}</td>
      <td style="font-size:0.72rem;">${r.session}</td>
      <td colspan="9">${subRows}</td>
    </tr>
    <tr style="background:var(--primary-light);">
      <td colspan="4"></td>
      <td colspan="9" style="font-size:0.72rem;">
        <strong>SGPA: ${r.sgpa}</strong> &nbsp; ${getResultBadge(r.result)} &nbsp;
        <button class="btn pr" style="padding:3px 10px;font-size:0.7rem;" onclick="editResultAdmin('${r.reg}',${r.sem},'${r.session}')">✏️ Edit</button>
        <button class="btn go" style="padding:3px 10px;font-size:0.7rem;" onclick="viewFullResultAdmin('${r.reg}',${r.sem},'${r.session}')">🖨️ Print</button>
      </td>
    </tr>`;
  }).join('');
}
function loadEditResult() {
  const reg = document.getElementById('editResReg').value.trim().toUpperCase();
  const sem = parseInt(document.getElementById('editResSem').value);
  const session = document.getElementById('editResSession').value;
  if (!reg || !sem || !session) { alert('Please enter Register Number, Semester, and Session.'); return; }
  const result = resultDB.find(r => r.reg===reg && r.sem===sem && r.session===session);
  document.getElementById('editResFields').style.display = 'block';
  if (result) {
    document.getElementById('erName').value = result.name;
    document.getElementById('erBranch').value = result.branch;
    document.getElementById('erSGPA').value = result.sgpa;
    document.getElementById('erResult').value = result.result;
    const subDiv = document.getElementById('erSubjectRows');
    subDiv.innerHTML = `<div style="overflow-x:auto;margin-bottom:12px;"><table style="min-width:600px;"><thead><tr><th>Subject</th><th>Code</th><th>Internal</th><th>External</th><th>Credits</th><th>Grade</th></tr></thead><tbody>` +
      result.subjects.map((s,i) => `<tr>
        <td><input type="text" value="${s.name}" style="width:100%;border:1px solid var(--border);border-radius:5px;padding:5px 8px;font-size:0.78rem;" /></td>
        <td><input type="text" value="${s.code}" style="width:70px;border:1px solid var(--border);border-radius:5px;padding:5px 8px;font-size:0.78rem;" /></td>
        <td><input type="number" value="${s.internal}" style="width:55px;border:1px solid var(--border);border-radius:5px;padding:5px 8px;font-size:0.78rem;" /></td>
        <td><input type="number" value="${s.external}" style="width:55px;border:1px solid var(--border);border-radius:5px;padding:5px 8px;font-size:0.78rem;" /></td>
        <td><input type="number" value="${s.credits}" style="width:45px;border:1px solid var(--border);border-radius:5px;padding:5px 8px;font-size:0.78rem;" /></td>
        <td><select style="border:1px solid var(--border);border-radius:5px;padding:5px 8px;font-size:0.78rem;">
          ${['O','A+','A','B+','B','C','P','F','Ab'].map(g=>`<option ${g===s.grade?'selected':''}>${g}</option>`).join('')}
        </select></td>
      </tr>`).join('') +
      `</tbody></table></div>`;
  } else {
    const stu = students[reg];
    document.getElementById('erName').value = stu ? stu.name : '';
    document.getElementById('erBranch').value = stu ? stu.dept : '';
    document.getElementById('erSubjectRows').innerHTML = '<div class="info-box">New entry — No existing result found. Fill details above and add subjects using the Add Result form.</div>';
  }
}
function saveHODResult() {
  alert('✅ Result updated and saved by HOD. Changes logged. Students can now view updated results.');
}

// Initialize result table on admin login
document.addEventListener('DOMContentLoaded', () => {
  renderResultMasterTable(resultDB);
  initPermMatrix();
});

// ===== FACULTY ACM TAB SWITCHER =====
function showFacACMTab(tabId, btn) {
  ['facAcmCerts', 'facAcmIssue', 'facAcmLookup', 'facAcmPrint', 'facAcmTc', 'facAcmTcReg', 'facAcmTcTpl',
    'facAcmStudy', 'facAcmStudying', 'facAcmStudyReg', 'facAcmStudyTpl', 'facAcmStudyingTpl',
    'facAcmRepeaters', 'facAcmNOC'].forEach(id => {
    const el = document.getElementById(id); if (el) el.style.display = 'none';
  });
  const el = document.getElementById(tabId); if (el) el.style.display = 'block';
  if (btn) {
    const tabs = btn.closest('.tabs');
    if (tabs) tabs.querySelectorAll('.tab').forEach(t => t.classList.remove('act'));
    btn.classList.add('act');
  }
  if (typeof window.renderAcmModule === 'function') window.renderAcmModule();
  if ((tabId === 'adAcmPrint' || tabId === 'facAcmPrint') && typeof window.acmPrintInitFields === 'function') {
    window.acmPrintInitFields();
  }
  if (tabId === 'facAcmTc' && typeof window.mountTcForm === 'function') window.mountTcForm();
  if (tabId === 'facAcmTcReg' && typeof window.renderTcRegister === 'function') window.renderTcRegister();
  if (tabId === 'facAcmTcTpl' && typeof window.renderTcTemplateEditor === 'function') window.renderTcTemplateEditor();
  if (tabId === 'facAcmStudy' && typeof window.mountStudyForm === 'function') window.mountStudyForm('study');
  if (tabId === 'facAcmStudying' && typeof window.mountStudyForm === 'function') window.mountStudyForm('studying');
  if (tabId === 'facAcmStudyReg' && typeof window.renderStudyRegister === 'function') window.renderStudyRegister();
  if (tabId === 'facAcmStudyTpl' && typeof window.renderStudyTemplateEditor === 'function') window.renderStudyTemplateEditor('study');
  if (tabId === 'facAcmStudyingTpl' && typeof window.renderStudyTemplateEditor === 'function') window.renderStudyTemplateEditor('studying');
}
window.showFacACMTab = showFacACMTab;

// ===== FACULTY EXAM TAB SWITCHER =====
function showFacExamTab(tabId, btn) {
  ['facExKeylist','facExNotEligible','facExPDC','facExAttShort'].forEach(id => {
    const el = document.getElementById(id); if (el) el.style.display = 'none';
  });
  const el = document.getElementById(tabId); if (el) el.style.display = 'block';
  if (btn) { btn.closest('.tabs').querySelectorAll('.tab').forEach(t => t.classList.remove('act')); btn.classList.add('act'); }
}

// ===== EST TAB SWITCHER (extended) =====
function showESTTab(tabId, btn) {
  ['estTeaching','estNonTeaching','estAdmin','estGuest','estGroupD','estCommittees','estOfficers'].forEach(id => {
    const el = document.getElementById(id); if (el) el.style.display = 'none';
  });
  const el = document.getElementById(tabId); if (el) el.style.display = 'block';
  if (btn) { btn.closest('.tabs').querySelectorAll('.tab').forEach(t => t.classList.remove('act')); btn.classList.add('act'); }
  if (tabId === 'estCommittees') renderCommitteeGrid();
}

// ===== FORM MANAGER HELPERS =====
// ===== FORM BUILDER ENGINE (Google Forms Style) =====
const formStore = {};
let currentShareForm = null;
let gfFieldCount = 0;

function openCreateFormModal(prefillName) {
  gfFieldCount = 0;
  const titleEl = document.getElementById('fbFormTitle');
  const descEl  = document.getElementById('fbFormDesc');
  const canvas  = document.getElementById('gfCanvas');
  titleEl.value = '';
  descEl.value  = '';
  canvas.innerHTML = '<div id="gfEmptyHint" style="text-align:center;color:#94a3b8;padding:32px;background:white;border-radius:10px;font-size:0.82rem;">Click a field type above to add questions</div>';

  if (prefillName && formStore[prefillName]) {
    const f = formStore[prefillName];
    titleEl.value = f.title;
    descEl.value  = f.desc || '';
    canvas.innerHTML = '';
    f.fields.forEach(fd => buildFieldCard(fd));
  }
  document.getElementById('formBuilderModal').style.display = 'flex';
}

function closeFBModal() {
  document.getElementById('formBuilderModal').style.display = 'none';
}

function addGFField(type) {
  const hint = document.getElementById('gfEmptyHint');
  if (hint) hint.remove();
  gfFieldCount++;
  const fd = { id:'gff_'+gfFieldCount, type, question:'', required:false, options:[] };
  if (['radio','checkbox','dropdown'].includes(type)) fd.options = ['Option 1','Option 2'];
  buildFieldCard(fd);
}

function buildFieldCard(fd) {
  const canvas = document.getElementById('gfCanvas');
  if (!canvas) return;

  if (fd.type === 'section') {
    const div = document.createElement('div');
    div.id = fd.id; div.className = 'gf-section-card';
    div.innerHTML =
      '<div style="display:flex;align-items:center;justify-content:space-between;">' +
        '<input type="text" value="'+(fd.question||'Section Title')+'" placeholder="Section title" ' +
          'style="border:none;border-bottom:2px solid #e2e8f0;font-size:1rem;font-weight:800;font-family:\'Plus Jakarta Sans\',sans-serif;color:#1a2437;outline:none;background:transparent;width:85%;padding-bottom:4px;" ' +
          'oninput="gfUpdateField(\''+fd.id+'\',\'question\',this.value)" />' +
        '<button class="gf-del-card" onclick="document.getElementById(\''+fd.id+'\').remove()" title="Delete section">🗑️</button>' +
      '</div>' +
      '<input type="text" value="'+(fd.desc||'')+'" placeholder="Section description (optional)" ' +
        'style="border:none;border-bottom:1px solid #e2e8f0;font-size:0.82rem;font-family:\'Plus Jakarta Sans\',sans-serif;color:#64748b;outline:none;background:transparent;width:100%;padding:6px 0 3px;margin-top:6px;" />';
    canvas.appendChild(div); return;
  }

  const card = document.createElement('div');
  card.id = fd.id; card.className = 'gf-card';

  const typeLabel = {text:'Short Answer',paragraph:'Paragraph',radio:'Multiple Choice',checkbox:'Checkboxes',dropdown:'Dropdown',date:'Date',time:'Time',file:'File Upload'}[fd.type] || fd.type;

  let fieldPreview = '';
  if (fd.type === 'text')      fieldPreview = '<div style="border-bottom:1px solid #94a3b8;width:60%;padding:4px 0;font-size:0.8rem;color:#94a3b8;font-family:\'Plus Jakarta Sans\',sans-serif;">Short answer text</div>';
  else if (fd.type === 'paragraph') fieldPreview = '<div style="border-bottom:1px solid #94a3b8;width:90%;padding:4px 0;font-size:0.8rem;color:#94a3b8;font-family:\'Plus Jakarta Sans\',sans-serif;">Long answer text</div>';
  else if (fd.type === 'date') fieldPreview = '<div style="font-size:0.82rem;color:#94a3b8;font-family:\'Plus Jakarta Sans\',sans-serif;padding:4px 0;">📅 Month / Day / Year</div>';
  else if (fd.type === 'time') fieldPreview = '<div style="font-size:0.82rem;color:#94a3b8;font-family:\'Plus Jakarta Sans\',sans-serif;padding:4px 0;">🕐 Time</div>';
  else if (fd.type === 'file') fieldPreview = (
    '<div style="background:#f8fafc;border:1.5px solid #e2e8f0;border-radius:8px;padding:12px 14px;margin-top:6px;">' +
    '<div style="font-size:0.78rem;font-weight:700;color:#1a2437;margin-bottom:8px;font-family:\'Plus Jakarta Sans\',sans-serif;">Accepted file types:</div>' +
    '<div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:10px;">' +
      ['📄 PDF (10 MB)','📝 DOC/DOCX (5 MB)','📊 XLS/XLSX (5 MB)','🖼️ JPG/PNG (2 MB)','📸 JPEG (2 MB)','📦 ZIP (15 MB)','📋 PPT/PPTX (10 MB)','📃 TXT (1 MB)'].map(f =>
        '<span style="background:#e0f2fe;color:#0369a1;padding:3px 9px;border-radius:20px;font-size:0.7rem;font-family:\'Plus Jakarta Sans\',sans-serif;">' + f + '</span>'
      ).join('') +
    '</div>' +
    '<div style="border:2px dashed #cbd5e1;border-radius:7px;padding:14px;text-align:center;font-size:0.78rem;color:#94a3b8;font-family:\'Plus Jakarta Sans\',sans-serif;">' +
      '📎 Drag & drop or click to upload' +
    '</div></div>'
  );

  let optionsHtml = '';
  if (['radio','checkbox','dropdown'].includes(fd.type)) {
    const icon = fd.type === 'radio' ? '⭕' : fd.type === 'checkbox' ? '☐' : '';
    optionsHtml = '<div id="opts_'+fd.id+'">' +
      (fd.options||[]).map((opt,i) =>
        '<div class="gf-option-row">' +
          (icon ? '<span style="font-size:0.9rem;color:#94a3b8;">'+icon+'</span>' : '<span style="font-size:0.75rem;color:#64748b;min-width:18px;">'+(i+1)+'.</span>') +
          '<input type="text" class="gf-option-inp" value="'+opt+'" placeholder="Option '+(i+1)+'" />' +
          '<button class="gf-del-opt" onclick="this.parentElement.remove()">✕</button>' +
        '</div>'
      ).join('') +
    '</div>' +
    '<button class="gf-add-opt" onclick="gfAddOption(\''+fd.id+'\',\''+fd.type+'\')">+ Add option</button>';
  }

  card.innerHTML =
    '<div style="display:flex;align-items:flex-start;gap:10px;">' +
      '<div style="flex:1;">' +
        '<input type="text" class="gf-q-input" value="'+(fd.question||'')+'" placeholder="Question" />' +
        '<div style="font-size:0.68rem;color:#94a3b8;margin-top:3px;font-family:\'Plus Jakarta Sans\',sans-serif;">'+typeLabel+'</div>' +
      '</div>' +
      '<button class="gf-del-card" onclick="document.getElementById(\''+fd.id+'\').remove()" title="Delete question">🗑️</button>' +
    '</div>' +
    '<div style="margin-top:12px;">' + fieldPreview + optionsHtml + '</div>' +
    '<div class="gf-card-footer">' +
      '<label class="gf-req-toggle"><input type="checkbox" '+(fd.required?'checked':'')+' onchange="gfToggleReq(\''+fd.id+'\',this.checked)" /> Required</label>' +
    '</div>';

  canvas.appendChild(card);
}

function gfAddOption(cardId, type) {
  const container = document.getElementById('opts_'+cardId);
  if (!container) return;
  const count = container.children.length + 1;
  const icon = type === 'radio' ? '⭕' : type === 'checkbox' ? '☐' : '';
  const row = document.createElement('div');
  row.className = 'gf-option-row';
  row.innerHTML =
    (icon ? '<span style="font-size:0.9rem;color:#94a3b8;">'+icon+'</span>' : '<span style="font-size:0.75rem;color:#64748b;min-width:18px;">'+count+'.</span>') +
    '<input type="text" class="gf-option-inp" placeholder="Option '+count+'" />' +
    '<button class="gf-del-opt" onclick="this.parentElement.remove()">✕</button>';
  container.appendChild(row);
}

function gfUpdateField(id, prop, val) {}
function gfToggleReq(id, val) {}

function collectGFFields() {
  const canvas = document.getElementById('gfCanvas');
  if (!canvas) return [];
  const fields = [];
  Array.from(canvas.children).forEach(card => {
    if (!card.id || card.id === 'gfEmptyHint') return;
    const qInput = card.querySelector('.gf-q-input');
    const question = qInput ? qInput.value.trim() : '';
    const typeDiv = qInput ? qInput.nextElementSibling : null;
    const typeLabel = typeDiv ? typeDiv.textContent.trim() : '';
    const required = card.querySelector('input[type=checkbox]') ? card.querySelector('input[type=checkbox]').checked : false;
    const isSect = card.classList.contains('gf-section-card');
    const type = isSect ? 'section' :
      typeLabel === 'Short Answer' ? 'text' :
      typeLabel === 'Paragraph'    ? 'paragraph' :
      typeLabel === 'Multiple Choice' ? 'radio' :
      typeLabel === 'Checkboxes'   ? 'checkbox' :
      typeLabel === 'Dropdown'     ? 'dropdown' :
      typeLabel === 'Date'         ? 'date' :
      typeLabel === 'Time'         ? 'time' :
      typeLabel === 'File Upload'  ? 'file' : 'text';
    const optInputs = card.querySelectorAll('.gf-option-inp');
    const options = Array.from(optInputs).map(i => i.value.trim()).filter(Boolean);
    fields.push({ id: card.id, type, question, required, options });
  });
  return fields;
}

function saveGFForm() {
  const title = document.getElementById('fbFormTitle').value.trim();
  if (!title) { alert('Please enter a form title.'); document.getElementById('fbFormTitle').focus(); return; }
  const desc   = document.getElementById('fbFormDesc').value.trim();
  const fields = collectGFFields();
  formStore[title] = { title, desc, fields };
  closeFBModal();

  const tbody = document.getElementById('formListBody');
  if (tbody) {
    const emptyRow = document.getElementById('formEmptyRow');
    if (emptyRow) emptyRow.remove();
    const exists = Array.from(tbody.querySelectorAll('strong')).find(el => el.textContent.trim() === title);
    if (!exists) {
      const tr = document.createElement('tr');
      tr.innerHTML =
        '<td><strong>📋 '+title+'</strong>'+(desc?'<div style="font-size:0.68rem;color:var(--text-muted);">'+desc+'</div>':'')+' </td>'+
        '<td><span class="badge approved">Active</span></td>'+
        '<td><div style="display:flex;gap:5px;flex-wrap:wrap;">'+
          '<button class="btn pr" onclick="openFormView(\''+title+'\')" >👁️ View</button>'+
          '<button class="btn go" onclick="openFormShare(\''+title+'\')" >🔗 Share</button>'+
          '<button class="btn ol" onclick="openCreateFormModal(\''+title+'\')" >✏️ Edit</button>'+
          '<button class="btn re" onclick="deleteForm(this,\''+title+'\')" >🗑️ Delete</button>'+
        '</div></td>';
      
tbody.insertBefore(tr, tbody.firstChild);
    }
  }
  alert('Form "'+title+'" saved!\n'+fields.length+' questions. Click Share to send to students/staff.');
}

function previewGFForm() {
  const title  = document.getElementById('fbFormTitle').value.trim() || 'Untitled Form';
  const desc   = document.getElementById('fbFormDesc').value.trim();
  const fields = collectGFFields();
  currentShareForm = title;
  renderGFPreview(title, desc, fields);
  document.getElementById('gfPreviewModal').style.display = 'flex';
}

function renderGFPreview(title, desc, fields) {
  const body = document.getElementById('gfPreviewBody');
  let html = '';
  // Header card
  html += '<div class="gf-preview-card" style="border-top:8px solid #6d28d9;">'+
    '<div style="font-size:1.3rem;font-weight:800;color:#1a2437;font-family:\'Libre Baskerville\',serif;">'+title+'</div>'+
    (desc?'<div style="font-size:0.82rem;color:#64748b;margin-top:6px;">'+desc+'</div>':'')+
  '</div>';

  fields.forEach(fd => {
    if (fd.type === 'section') {
      html += '<div class="gf-preview-card" style="border-top:4px solid #6d28d9;padding:14px 20px;">'+
        '<div style="font-size:1rem;font-weight:800;color:#1a2437;font-family:\'Plus Jakarta Sans\',sans-serif;">'+fd.question+'</div>'+
      '</div>'; return;
    }
    const req = fd.required ? '<span style="color:#dc2626;margin-left:3px;">*</span>' : '';
    html += '<div class="gf-preview-card">';
    html += '<label class="gf-preview-label">'+fd.question+req+'</label>';
    if (fd.type === 'text')       html += '<input type="text" class="gf-preview-input" placeholder="Your answer" />';
    else if (fd.type === 'paragraph') html += '<textarea class="gf-preview-textarea" placeholder="Your answer"></textarea>';
    else if (fd.type === 'date') html += '<input type="date" class="gf-preview-input" style="max-width:200px;" />';
    else if (fd.type === 'time') html += '<input type="time" class="gf-preview-input" style="max-width:160px;" />';
    else if (fd.type === 'file') {
      html += '<div style="background:#f8fafc;border:1.5px solid #e2e8f0;border-radius:8px;padding:12px 14px;">';
      html += '<div style="display:flex;flex-wrap:wrap;gap:5px;margin-bottom:10px;">';
      ['PDF (10MB)','DOC/DOCX (5MB)','XLS/XLSX (5MB)','JPG/PNG (2MB)','ZIP (15MB)','PPT/PPTX (10MB)','TXT (1MB)'].forEach(f => {
        html += '<span style="background:#e0f2fe;color:#0369a1;padding:3px 9px;border-radius:20px;font-size:0.7rem;font-family:\'Plus Jakarta Sans\',sans-serif;">'+f+'</span>';
      });
      html += '</div>';
      html += '<input type="file" accept=".pdf,.doc,.docx,.xls,.xlsx,.jpg,.jpeg,.png,.zip,.ppt,.pptx,.txt" style="width:100%;padding:8px;border:1.5px solid #e2e8f0;border-radius:6px;font-family:\'Plus Jakarta Sans\',sans-serif;font-size:0.82rem;" />';
      html += '<div style="font-size:0.7rem;color:#94a3b8;margin-top:5px;font-family:\'Plus Jakarta Sans\',sans-serif;">Max file size varies by type. Files exceeding limits will be rejected.</div>';
      html += '</div>';
    }
    else if (fd.type === 'dropdown') {
      html += '<select class="gf-preview-select"><option value="">Choose</option>';
      (fd.options||[]).forEach(o => { html += '<option>'+o+'</option>'; });
      html += '</select>';
    } else if (fd.type === 'radio') {
      (fd.options||[]).forEach(o => {
        html += '<label style="display:flex;align-items:center;gap:8px;margin-bottom:6px;font-size:0.85rem;font-family:\'Plus Jakarta Sans\',sans-serif;cursor:pointer;"><input type="radio" name="gfr_'+fd.id+'" style="accent-color:#6d28d9;" /> '+o+'</label>';
      });
    } else if (fd.type === 'checkbox') {
      (fd.options||[]).forEach(o => {
        html += '<label style="display:flex;align-items:center;gap:8px;margin-bottom:6px;font-size:0.85rem;font-family:\'Plus Jakarta Sans\',sans-serif;cursor:pointer;"><input type="checkbox" style="accent-color:#6d28d9;" /> '+o+'</label>';
      });
    }
    html += '</div>';
  });
  html += '<div class="gf-preview-card" style="text-align:right;"><button style="padding:10px 28px;background:#6d28d9;color:white;border:none;border-radius:8px;cursor:pointer;font-weight:700;font-family:\'Plus Jakarta Sans\',sans-serif;" onclick="alert(\'Response submitted! Thank you.\')">Submit</button></div>';
  body.innerHTML = html;
}

function openShareFromPreview() {
  document.getElementById('gfPreviewModal').style.display = 'none';
  openFormShare(currentShareForm);
}

function openFormView(formName) {
  currentShareForm = formName;
  const f = formStore[formName];
  if (f) renderGFPreview(f.title, f.desc, f.fields);
  else {
    document.getElementById('gfPreviewBody').innerHTML =
      '<div class="gf-preview-card" style="text-align:center;color:#94a3b8;">'+
      '<div style="font-size:2rem;margin-bottom:8px;">📋</div>'+
      '<div style="font-weight:700;">'+formName+'</div>'+
      '<p style="font-size:0.82rem;">Click Share to send this form to recipients.</p></div>';
  }
  document.getElementById('gfPreviewModal').style.display = 'flex';
}

function openFormShare(formName) {
  currentShareForm = formName;
  document.getElementById('shareFormNameLabel').textContent = formName;
  document.getElementById('shareMessage').value = '';
  document.querySelectorAll('#shareRecipients input[type=checkbox]').forEach(cb => cb.checked = false);
  selectPriority('normal');
  document.getElementById('formShareModal').style.display = 'flex';
}

function selectPriority(p) {
  const colors = { normal:'#10b981', important:'#f59e0b', emergency:'#dc2626' };
  const bgs    = { normal:'#f0fdf4', important:'#fffbeb', emergency:'#fff1f2' };
  ['normal','important','emergency'].forEach(k => {
    const key = k.charAt(0).toUpperCase() + k.slice(1);
    const btn = document.getElementById('priBtn'+key);
    if (!btn) return;
    btn.style.borderColor = k===p ? colors[k] : '#e2e8f0';
    btn.style.background  = k===p ? bgs[k]    : '#fff';
  });
  const r = document.querySelector('input[name=sharePriority][value='+p+']');
  if (r) r.checked = true;
}

function confirmShareForm() {
  const radio = document.querySelector('input[name=sharePriority]:checked');
  const priority = radio ? radio.value : 'normal';
  const recipients = Array.from(document.querySelectorAll('#shareRecipients input:checked')).map(cb => cb.value);
  const message = document.getElementById('shareMessage').value.trim();
  if (!recipients.length) { alert('Please select at least one recipient group.'); return; }
  document.getElementById('formShareModal').style.display = 'none';
  showFormNotif(currentShareForm, priority, recipients, message);
}

const priorityConfig = {
  normal:    { bg:'linear-gradient(135deg,#065f46,#10b981)', icon:'🔔', label:'New Form Available' },
  important: { bg:'linear-gradient(135deg,#92400e,#f59e0b)', icon:'⚠️', label:'IMPORTANT — Action Required' },
  emergency: { bg:'linear-gradient(135deg,#7f1d1d,#dc2626)', icon:'🚨', label:'EMERGENCY — Immediate Action Required' }
};

function showFormNotif(formName, priority, recipients, message) {
  const cfg = priorityConfig[priority];
  // Build the shared form card HTML
  const today = new Date().toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'numeric'});
  const priBadge = priority === 'emergency'
    ? '<span style="background:#dc2626;color:white;padding:3px 10px;border-radius:20px;font-size:0.68rem;font-weight:800;font-family:\'Plus Jakarta Sans\',sans-serif;">🚨 EMERGENCY</span>'
    : priority === 'important'
    ? '<span style="background:#f59e0b;color:white;padding:3px 10px;border-radius:20px;font-size:0.68rem;font-weight:800;font-family:\'Plus Jakarta Sans\',sans-serif;">⚠️ IMPORTANT</span>'
    : '<span style="background:#10b981;color:white;padding:3px 10px;border-radius:20px;font-size:0.68rem;font-weight:800;font-family:\'Plus Jakarta Sans\',sans-serif;">🔔 Normal</span>';

  const cardHtml =
    '<div class="card" style="margin-bottom:12px;border-left:4px solid '+(priority==='emergency'?'#dc2626':priority==='important'?'#f59e0b':'#10b981')+';padding:16px 18px;">' +
      '<div style="display:flex;align-items:flex-start;justify-content:space-between;gap:10px;flex-wrap:wrap;">' +
        '<div>' +
          '<div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;">'+priBadge+
            '<span style="font-size:0.68rem;color:var(--text-muted);font-family:\'Plus Jakarta Sans\',sans-serif;">Shared '+today+'</span>' +
          '</div>' +
          '<div style="font-weight:800;font-size:0.9rem;color:#1a2437;font-family:\'Plus Jakarta Sans\',sans-serif;margin-bottom:4px;">📋 '+formName+'</div>' +
          (message?'<div style="font-size:0.78rem;color:#64748b;font-family:\'Plus Jakarta Sans\',sans-serif;margin-bottom:8px;font-style:italic;">"'+message+'"</div>':'') +
        '</div>' +
        '<button onclick="openFormFill(\''+formName+'\')" style="padding:8px 18px;background:linear-gradient(135deg,#6d28d9,#7c3aed);color:white;border:none;border-radius:8px;cursor:pointer;font-weight:700;font-family:\'Plus Jakarta Sans\',sans-serif;font-size:0.8rem;flex-shrink:0;">📝 Fill Form</button>' +
      '</div>' +
    '</div>';

  // Push into student inbox if Students selected
  if (recipients.includes('Students') || recipients.includes('All Staff')) {
    const stuList = document.getElementById('stuSharedFormsList');
    if (stuList) {
      document.getElementById('stuFormsEmpty') && document.getElementById('stuFormsEmpty').remove();
      stuList.insertAdjacentHTML('afterbegin', cardHtml);
    }
  }
  // Push into staff Submit Forms inbox
  const facList = document.getElementById('facSharedFormsList');
  if (facList) {
    document.getElementById('facFormsEmpty') && document.getElementById('facFormsEmpty').remove();
    facList.insertAdjacentHTML('afterbegin', cardHtml);
    // Update badge count
    const badge = document.getElementById('facFormsCount');
    if (badge) { badge.style.display=''; badge.textContent = (parseInt(badge.textContent)||0)+1; }
  }

  // Show popup notification
  document.getElementById('formNotifBanner').style.background = cfg.bg;
  document.getElementById('formNotifIcon').textContent  = cfg.icon;
  document.getElementById('formNotifBadge').textContent = cfg.label;
  document.getElementById('formNotifTitle').textContent = formName;
  document.getElementById('formNotifMsg').innerHTML =
    '<strong>Shared with:</strong> '+recipients.join(', ')+'<br>'+
    (message ? '<br><em>"'+message+'"</em><br>' : '')+
    '<br><span style="font-size:0.75rem;color:#64748b;">Sent by Root Admin &bull; '+today+'</span>';
  document.getElementById('formNotifFill').style.background = cfg.bg;
  document.getElementById('formNotifOverlay').style.background = priority==='emergency'?'rgba(127,29,29,0.75)':'rgba(0,0,0,0.6)';
  document.getElementById('formNotifPopup').style.display = 'flex';
}

function openFormFill(formName) {
  openFormView(formName);
}

function dismissFormNotif() {
  document.getElementById('formNotifPopup').style.display = 'none';
}

function deleteForm(btn, title) {
  if (!confirm('Delete form "' + title + '"?\nThis cannot be undone.')) return;
  delete formStore[title];
  const row = btn.closest('tr');
  row.style.transition = 'opacity 0.3s';
  row.style.opacity = '0';
  setTimeout(() => {
    row.remove();
    const tbody = document.getElementById('formListBody');
    if (tbody && tbody.children.length === 0) {
      const tr = document.createElement('tr');
      tr.id = 'formEmptyRow';
      tr.innerHTML = '<td colspan="4" style="text-align:center;color:var(--text-muted);padding:32px;font-size:0.82rem;">No forms yet. Click <strong>+ Create New Form</strong> to build one.</td>';
      tbody.appendChild(tr);
    }
  }, 300);
}

function openFormApprover(formName) {
  const a = prompt('Assign Approver for "'+formName+'"\nEnter role (e.g. HOD, Principal, ACM Staff):');
  if (a) alert('Approver for "'+formName+'" set to: '+a);
}

// ===== LIBRARY UPLOAD =====
function uploadLibraryBook() {
  const name = document.getElementById('libBookName').value.trim();
  const author = document.getElementById('libAuthor').value.trim();
  const branches = document.getElementById('libBranches');
  const selectedBranches = Array.from(branches.selectedOptions).map(o => o.value);
  if (!name || !author) { alert('Please fill Book Name and Author.'); return; }
  if (selectedBranches.length < 1) { alert('Please select at least one branch.'); return; }
  const file = document.getElementById('libPDFFile').files[0];
  if (!file) { alert('Please select a PDF file to upload.'); return; }
  const tbody = document.getElementById('libTableBody');
  const tr = document.createElement('tr');
  tr.style.background = 'var(--accent-light)';
  tr.innerHTML = `<td><strong>${name}</strong></td><td>${author}</td><td>${selectedBranches.join(', ')}</td><td>${document.getElementById('libSem').value || 'All'}</td><td><span class="badge info">${document.getElementById('libType').value}</span></td><td><span class="badge pending">Pending Principal Approval</span></td><td><div style="display:flex;gap:5px;"><button class="btn pr" onclick="alert('Preview…')">👁️ Preview</button><button class="btn re" onclick="this.closest('tr').remove()">🗑️</button></div></td>`;
  tbody.appendChild(tr);
  alert(`✅ Book "${name}" uploaded!\n\nStatus: Pending Principal Approval\nStudents will be able to view & download once Principal approves.\n\nApplicable Branches: ${selectedBranches.join(', ')}`);
  document.getElementById('libBookName').value = '';
  document.getElementById('libAuthor').value = '';
  document.getElementById('libPDFFile').value = '';
}

// ===== ROLES & PERMISSIONS MATRIX =====
const permModules = [
  { name:'Student Database', root:true, principal:'view', registrar:true, hod:'own dept', teaching:'own dept', acm:false, est:false, exam:false, library:false },
  { name:'ACM Module (Certs, NOC, Repeaters)', root:true, principal:'view', registrar:true, hod:true, teaching:false, acm:true, est:false, exam:false, library:false },
  { name:'Exam Module (Results, PDC, Keylist…)', root:true, principal:'view', registrar:'view', hod:'view', teaching:false, acm:false, est:false, exam:true, library:false },
  { name:'Attendance Management', root:true, principal:'view', registrar:false, hod:'own dept', teaching:'own subjects', acm:false, est:false, exam:false, library:false },
  { name:'EST Module (Staff Details)', root:true, principal:'view', registrar:true, hod:'view', teaching:false, acm:false, est:true, exam:false, library:false },
  { name:'Committee Management', root:true, principal:'approve', registrar:false, hod:false, teaching:false, acm:false, est:'add', exam:false, library:false },
  { name:'Officers (About Us)', root:true, principal:'approve', registrar:false, hod:false, teaching:false, acm:false, est:'add', exam:false, library:false },
  { name:'Library (E-Books)', root:true, principal:'approve', registrar:false, hod:false, teaching:false, acm:false, est:false, exam:false, library:true },
  { name:'Form Builder & Approvals', root:true, principal:'approve', registrar:false, hod:'dept forms', teaching:false, acm:false, est:false, exam:false, library:false },
  { name:'User Management', root:true, principal:false, registrar:false, hod:false, teaching:false, acm:false, est:false, exam:false, library:false },
  { name:'Account Approvals', root:true, principal:true, registrar:false, hod:'own branch students', teaching:false, acm:false, est:false, exam:false, library:false },
  { name:'Fees / Cash Module', root:true, principal:'view', registrar:true, hod:false, teaching:false, acm:false, est:false, exam:false, library:false },
  { name:'Institute Activities', root:true, principal:'view', registrar:false, hod:'dept', teaching:'dept', acm:false, est:false, exam:false, library:false },
];
function permCell(val) {
  if (val === true || val === 'full') return `<td style="text-align:center;color:var(--green);font-weight:700;font-size:1rem;">✅</td>`;
  if (val === false) return `<td style="text-align:center;color:var(--red);font-size:0.8rem;">—</td>`;
  return `<td style="text-align:center;font-size:0.68rem;color:var(--primary);font-weight:600;">${val}</td>`;
}
function initPermMatrix() {
  const tbody = document.getElementById('permMatrixBody');
  if (!tbody) return;
  tbody.innerHTML = permModules.map(m => `<tr>
    <td style="font-size:0.78rem;font-weight:600;color:var(--navy);">${m.name}</td>
    ${permCell(m.root)}${permCell(m.principal)}${permCell(m.registrar)}${permCell(m.hod)}${permCell(m.teaching)}${permCell(m.acm)}${permCell(m.est)}${permCell(m.exam)}${permCell(m.library)}
  </tr>`).join('');
}
// ===== AUTO-LOGIN (Demo Credentials Page Integration) =====
window.addEventListener('load', function() {
  const hash = window.location.hash;
  if (hash && hash.startsWith('#demo_')) {
    const role = hash.replace('#demo_', '');
    if (['admin','student','faculty','principal'].includes(role)) {
      setTimeout(() => login(role), 200);
    }
  }
});

// ===== DEMO LOGIN — all individual roles =====
function demoLogin(role) {

  // Define what each role can SEE in the faculty sidebar (data-fac values)
  const roleAccess = {
    faculty:      { show: ['home','myprofile','submitforms','approvals','stuprofile','attendance','timetable','results','acm','exam','office','est','cash','search','staff','activities'], sec: 'facHome', allBranches: false },
    hod:          { show: ['home','myprofile','submitforms','approvals','accountapprovals','stuprofile','attendance','timetable','results','staff','activities'], sec: 'facUserApprovals', allBranches: false },
    teaching:     { show: ['home','myprofile','submitforms','approvals','stuprofile','attendance','results','staff','activities'], sec: 'facHome', allBranches: false },
    registrar:    { show: ['home','myprofile','submitforms','approvals','stuprofile','acm','exam','office','est','cash','search','staff','activities'], sec: 'facOffice', allBranches: false },
    // ACM uses scoped admin shell (Approvals + Students + Student Data + ACM) — see applyAcmAdminScope
    acm:          { show: ['acm', 'studentdata'], sec: 'facACM', allBranches: true },
    // Exam: Student Profile all-branches view only, remove Staff
    exam:         { show: ['home','myprofile','submitforms','approvals','stuprofile','exam','cash'], sec: 'facExamModule', allBranches: true },
    // EST: remove Office, Activities, Student Profile entirely
    est:          { show: ['home','myprofile','submitforms','approvals','est','search'], sec: 'facEST', allBranches: false },
    // Library: Student Profile all-branches view only, Cash, Search, E-Book Upload
    library:      { show: ['home','myprofile','submitforms','stuprofile','search','cash','libupload'], sec: 'facLibraryUpload', allBranches: true },
    // Placement: Student Profile all-branches view only, remove Activities, add Placement section
    placement:    { show: ['home','myprofile','submitforms','approvals','stuprofile','search','placement'], sec: 'facPlacement', allBranches: true },
    // NSS: Student Profile all-branches view only, remove Activities, add NSS section
    nss:          { show: ['home','myprofile','submitforms','approvals','stuprofile','search','nss'], sec: 'facNSS', allBranches: true },
    // YRC: Student Profile all-branches view only, remove Activities, add YRC section
    yrc:          { show: ['home','myprofile','submitforms','approvals','stuprofile','search','yrc'], sec: 'facYRC', allBranches: true },
    // Alumni: Student Profile all-branches view only, remove Activities, add Alumni section
    alumni:       { show: ['home','myprofile','submitforms','approvals','stuprofile','search','alumni'], sec: 'facAlumni', allBranches: true },
    // Sports: Student Profile all-branches view only, remove Activities, add Sports section
    sports:       { show: ['home','myprofile','submitforms','approvals','stuprofile','search','sports'], sec: 'facSports', allBranches: true },
    // Student Welfare: Student Profile all-branches view only, remove Activities, add Welfare section
    welfare:      { show: ['home','myprofile','submitforms','approvals','stuprofile','search','welfare'], sec: 'facWelfare', allBranches: true },
    // Student Association: Student Profile all-branches view only, remove Activities, add SA section
    studentassoc: { show: ['home','myprofile','submitforms','approvals','stuprofile','search','studentassoc'], sec: 'facStudentAssoc', allBranches: true },
    // Cash: remove Accounts
    cash:         { show: ['home','myprofile','submitforms','stuprofile','search','cash'], sec: 'facCash', allBranches: false },
    // Accounts: remove Cash/Fees
    accounts:     { show: ['home','myprofile','submitforms','stuprofile','search','accounts'], sec: 'facCash', allBranches: false },
    // Stores: only stores section
    stores:       { show: ['home','myprofile','submitforms','stores'], sec: 'facStores', allBranches: false },
  };

  const roleLabels = {
    faculty:'Teaching Staff', hod:'HOD', teaching:'Teaching Staff',
    registrar:'Registrar', acm:'ACM', exam:'Exam Cell', est:'EST',
    library:'Library Staff', placement:'Placement Officer', nss:'NSS Officer',
    yrc:'Youth Red Cross', alumni:'Alumni Officer', sports:'Sports Officer',
    welfare:'Student Welfare Officer', cash:'Cash Officer', accounts:'Accounts',
    stores:'Stores', studentassoc:'Student Association'
  };

  const roleColors = {
    faculty:'#d4600a', hod:'#b45309', teaching:'#d4600a',
    registrar:'#0e7490', acm:'#1d4ed8', exam:'#be185d', est:'#15803d',
    library:'#78350f', placement:'#0f4c75', nss:'#166534',
    yrc:'#991b1b', alumni:'#3730a3', sports:'#065f46',
    welfare:'#7e22ce', cash:'#713f12', accounts:'#1e3a5f',
    stores:'#44403c', studentassoc:'#4a044e'
  };

  const dashRole = ['admin','student','principal'].includes(role) ? role : 'faculty';
  window._demoRole = role;
  login(dashRole);

  setTimeout(() => {
    if (dashRole === 'faculty') {
      const access = roleAccess[role];
      if (access) {
        // Show/hide sidebar items
        document.querySelectorAll('#dbFaculty [data-fac]').forEach(el => {
          el.style.display = access.show.includes(el.dataset.fac) ? '' : 'none';
        });
        // Show/hide section headers
        const officeItems = ['acm','exam','office','est','cash','search','stores','accounts','libupload'];
        const studentItems = ['stuprofile','attendance','timetable','results'];
        const otherItems   = ['staff','activities','placement','nss','yrc','alumni','sports','welfare','studentassoc'];
        document.querySelectorAll('#dbFaculty [data-fac-sec]').forEach(el => {
          const sec = el.dataset.facSec;
          const keys = sec==='office' ? officeItems : sec==='student' ? studentItems : sec==='other' ? otherItems : [];
          el.style.display = keys.some(k => access.show.includes(k)) ? '' : 'none';
        });
        // Update sidebar role label
        const roleLabel = document.querySelector('#dbFaculty .sb-role');
        if (roleLabel) roleLabel.textContent = roleLabels[role] || 'Faculty Panel';

        // Enable/disable all-branches in student profile
        const viewOnlyBanner = document.getElementById('stuProfileViewOnly');
        if (viewOnlyBanner) viewOnlyBanner.style.display = access.allBranches ? '' : 'none';
        // Unlock all branch tabs if allBranches
        ['stuTabCSE','stuTabECE','stuTabMech'].forEach(id => {
          const tab = document.getElementById(id);
          if (tab) {
            if (access.allBranches) {
              const branch = id.replace('stuTab','');
              tab.onclick = function(){ showStuBranch(branch, this); };
            } else {
              tab.onclick = function(){ alert('Access restricted to your department only.'); };
            }
          }
        });

        // Navigate to correct section
        if (access.sec) {
          const link = document.querySelector(`#dbFaculty .sl[onclick*="${access.sec}"]`);
          if (link && link.style.display !== 'none') { link.click(); }
          else {
            const first = document.querySelector('#dbFaculty .sl[data-fac]:not([style*="display: none"]):not([style*="display:none"])');
            if (first) first.click();
          }
        }
        // For Exam Cell: auto-open PDC tab to show incoming student requests
        if (role === 'exam') {
          setTimeout(() => {
            const pdcTab = Array.from(document.querySelectorAll('#facExamModule .tab')).find(t => t.textContent.includes('PDC'));
            if (pdcTab) pdcTab.click();
          }, 200);
        }
      }
    }

    // Role badge
    const existingBadge = document.getElementById('_demoRoleBadge');
    if (existingBadge) existingBadge.remove();
    const badge = document.createElement('div');
    badge.id = '_demoRoleBadge';
    badge.style.cssText = `position:fixed;bottom:18px;right:18px;z-index:9999;background:${roleColors[role]||'#333'};color:white;padding:8px 16px;border-radius:10px;font-family:'Plus Jakarta Sans',sans-serif;font-weight:700;font-size:0.78rem;box-shadow:0 4px 16px rgba(0,0,0,0.3);display:flex;align-items:center;gap:8px;`;
    badge.innerHTML = `<span style="opacity:0.7;font-size:0.65rem;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;">Viewing as</span>&nbsp;${roleLabels[role]||role}&nbsp;<button onclick="this.parentElement.remove()" style="background:rgba(255,255,255,0.2);border:none;color:white;width:18px;height:18px;border-radius:50%;cursor:pointer;font-size:0.7rem;margin-left:4px;">✕</button>`;
    document.body.appendChild(badge);
  }, 350);
}

// ===== STAFF MY PROFILE FUNCTIONS =====
function showMyProfileTab(id, btn) {
  ['mpTeaching','mpNonTeaching','mpAdmin','mpGuest','mpTeachingPost','mpNonTeachingPost','mpAdminPost'].forEach(t => {
    const el = document.getElementById(t); if (el) el.style.display = 'none';
  });
  const el = document.getElementById(id); if (el) el.style.display = '';
  document.querySelectorAll('#myProfileTabs .tab').forEach(t => t.classList.remove('act'));
  if (btn) btn.classList.add('act');
}

function toggleProfileEdit(formId) {
  const form = document.getElementById(formId);
  if (!form) return;
  const fields = form.querySelectorAll('.pf-field');
  const isEditing = fields[0] && !fields[0].hasAttribute('readonly') && !fields[0].disabled;
  if (isEditing) {
    // Lock back to readonly
    fields.forEach(f => {
      if (f.tagName === 'SELECT') { f.disabled = true; f.classList.remove('editable'); }
      else { f.setAttribute('readonly',''); f.classList.remove('editable'); }
    });
    form.querySelectorAll('.tbl-inp').forEach(f => { f.setAttribute('readonly',''); f.classList.remove('editable'); });
    alert('Fields locked. Click "Submit for Approval" to send to Principal.');
  } else {
    // Enable editing
    fields.forEach(f => {
      if (f.tagName === 'SELECT') { f.disabled = false; f.classList.add('editable'); }
      else { f.removeAttribute('readonly'); f.classList.add('editable'); }
    });
    form.querySelectorAll('.tbl-inp').forEach(f => { f.removeAttribute('readonly'); f.classList.add('editable'); });
    alert('Edit mode enabled. Make your changes then click "Submit for Approval".');
  }
}

function submitProfileApproval(profileType) {
  const reqId = 'PRF/' + new Date().getFullYear() + '/' + Math.floor(100 + Math.random()*900);
  // Add to principal approval queue
  const priQueue = document.getElementById('priProfileApprovalBody');
  if (priQueue) {
    const today = new Date().toLocaleDateString('en-IN', {day:'2-digit', month:'short', year:'numeric'});
    const tr = document.createElement('tr');
    tr.innerHTML = `<td style="font-family:'JetBrains Mono',monospace;font-size:0.7rem;">${reqId}</td>
      <td><strong>Staff Member</strong></td><td>${profileType}</td><td>${today}</td>
      <td><span class="badge pending">Pending</span></td>
      <td><div style="display:flex;gap:4px;">
        <button class="btn gr" onclick="approveProfReq(this,'${reqId}')">✓ Approve & Save</button>
        <button class="btn re" onclick="rejectProfReq(this,'${reqId}')">✕ Reject</button>
      </div></td>`;
    priQueue.insertBefore(tr, priQueue.firstChild);
  }
  alert('Profile update submitted for Principal approval!\n\nRequest ID: ' + reqId + '\nType: ' + profileType + '\n\nData will be saved to the database only after Principal approves.');
}

function approveProfReq(btn, reqId) {
  const row = btn.closest('tr');
  row.cells[4].innerHTML = '<span class="badge approved">Approved & Saved to DB</span>';
  row.cells[5].innerHTML = '<span style="font-size:0.72rem;color:var(--text-muted);">Saved ' + new Date().toLocaleDateString('en-IN') + '</span>';
  alert('Profile approved!\nRequest ID: ' + reqId + '\nData has been saved to the database.');
}

function rejectProfReq(btn, reqId) {
  const reason = prompt('Enter reason for rejection:');
  if (reason === null) return;
  const row = btn.closest('tr');
  row.cells[4].innerHTML = '<span class="badge re" style="background:#dc2626;color:white;">Rejected</span>';
  row.cells[5].innerHTML = '<span style="font-size:0.72rem;color:#dc2626;">Reason: ' + (reason || 'Not specified') + '</span>';
  alert('Profile request rejected.\nReason sent to staff member.');
}

function addProfileColumn(extraDivId) {
  const label = prompt('Enter column/field name to add:');
  if (!label) return;
  const container = document.getElementById(extraDivId);
  if (!container) return;
  container.style.display = 'flex';
  const div = document.createElement('div');
  div.className = 'fg';
  div.style.cssText = 'min-width:200px;flex:1;';
  div.innerHTML = '<label>' + label + '</label><input type="text" class="pf-field" placeholder="Enter ' + label + '" readonly />';
  container.appendChild(div);
  alert('"' + label + '" column added! Click Edit to fill in the value, then Submit for Approval.');
}

function addPostRow(tbodyId, colCount) {
  const tbody = document.getElementById(tbodyId);
  if (!tbody) return;
  const tr = document.createElement('tr');
  let cells = '';
  for (let i = 0; i < colCount; i++) {
    cells += '<td><input type="text" class="tbl-inp editable" placeholder="—" /></td>';
  }
  tr.innerHTML = cells;
  tbody.appendChild(tr);
}

function addPostColumn(tbodyId, theadRowId) {
  const label = prompt('Enter new column name:');
  if (!label) return;
  // Add header
  const thead = document.getElementById(theadRowId);
  if (thead) {
    const th = document.createElement('th');
    th.textContent = label;
    thead.appendChild(th);
  }
  // Add cell to each existing row
  const tbody = document.getElementById(tbodyId);
  if (tbody) {
    tbody.querySelectorAll('tr').forEach(row => {
      const td = document.createElement('td');
      td.innerHTML = '<input type="text" class="tbl-inp editable" placeholder="—" />';
      row.appendChild(td);
    });
  }
  alert('"' + label + '" column added to the post strength table.');
}


function showStuCertTab(id, btn) {
  ['scTC','scStudy','scStudying','scNOC','scPDC','scMyReqs'].forEach(t => {
    const el = document.getElementById(t); if (el) el.style.display = 'none';
  });
  const el = document.getElementById(id); if (el) el.style.display = '';
  document.querySelectorAll('#stuCertTabs .tab').forEach(t => t.classList.remove('act'));
  if (btn) btn.classList.add('act');
  // Prefill / refresh live status when opening certificate panels
  if (typeof window.prefillStudentCertForms === 'function') {
    window.prefillStudentCertForms();
  }
  if (id === 'scMyReqs' && typeof window.renderStuCertRequests === 'function') {
    window.renderStuCertRequests();
  }
}

// ===== STUDENT CERTIFICATE REQUEST SUBMISSION + ROUTING =====
// Real submit is provided by legacy-bridge.js (window.submitCertRequest).
// Keep a thin fallback so the page never crashes if bridge is delayed.
function submitCertRequest(certType, routedTo, formKey) {
  if (window.submitCertRequest && window.submitCertRequest !== submitCertRequest) {
    return window.submitCertRequest(certType, routedTo, formKey);
  }
  alert('Certificate service is still loading. Please wait a moment and try again.');
}

// ===== STUDENT PROFILE BRANCH SWITCHER =====
function showStuBranch(branch, btn) {
  if (btn) {
    document.querySelectorAll('#stuProfileBranchTabs .tab').forEach(t => t.classList.remove('act'));
    btn.classList.add('act');
  }
  const branchNames = { Civil:'Civil Engineering', CSE:'Computer Science Engg.', ECE:'Electronics & Comm. Engg.', Mech:'Mechanical Engineering' };
  const title = document.getElementById('stuProfileBranchTitle');
  if (title) title.textContent = (branchNames[branch] || branch) + ' — Student List';
  const tbody = document.getElementById('stuProfileTableBody');
  if (!tbody) return;
  tbody.querySelectorAll('tr').forEach(row => {
    const isBranch = row.classList.contains('branch-'+branch) || (!row.className.includes('branch-') && branch === 'Civil');
    row.style.display = isBranch ? '' : 'none';
  });
}

// ===== TAB SWITCHERS FOR NEW SECTIONS =====
function showPlacementTab(id, btn) {
  ['plDrives','plRecords','plCalendar','plUpload'].forEach(t => { const el=document.getElementById(t); if(el) el.style.display='none'; });
  const el = document.getElementById(id); if(el) el.style.display='';
  document.querySelectorAll('#placementTabs .tab').forEach(t=>t.classList.remove('act'));
  if(btn) btn.classList.add('act');
}
function showNSSTab(id, btn) {
  ['nssVolunteers','nssCamps','nssActivities','nssCerts'].forEach(t => { const el=document.getElementById(t); if(el) el.style.display='none'; });
  const el = document.getElementById(id); if(el) el.style.display='';
  document.querySelectorAll('#nssTabs .tab').forEach(t=>t.classList.remove('act'));
  if(btn) btn.classList.add('act');
}
function showYRCTab(id, btn) {
  ['yrcMembers','yrcBlood','yrcFirstAid','yrcEvents'].forEach(t => { const el=document.getElementById(t); if(el) el.style.display='none'; });
  const el = document.getElementById(id); if(el) el.style.display='';
  document.querySelectorAll('#yrcTabs .tab').forEach(t=>t.classList.remove('act'));
  if(btn) btn.classList.add('act');
}
function showAlumniTab(id, btn) {
  ['alDirectory','alBatch','alMentor','alEvents','alAddMember','alAllMembers','alPending','alCommittee','alDonation'].forEach(function(t) { var el=document.getElementById(t); if(el) el.style.display='none'; });
  if(id==='alAllMembers') renderAlAllMembers();
  if(id==='alPending') renderAlPending();
  if(id==='alCommittee') renderAlCommitteeTable();
  if(id==='alDonation') alLoadDonationForm();
  var el = document.getElementById(id); if(el) el.style.display='';
  // Reset all row-1 tabs
  document.querySelectorAll('#alumniTabs .tab').forEach(function(t){ t.classList.remove('act'); });
  // Reset all row-2 tabs to their default colours
  var r2defaults = {
    'alTabAddMember': {bg:'#ede9fe',cl:'#3730a3',bc:'#c4b5fd'},
    'alTabAllMembers': {bg:'#ede9fe',cl:'#3730a3',bc:'#c4b5fd'},
    'alPendingTab':   {bg:'#ede9fe',cl:'#3730a3',bc:'#c4b5fd'},
    'alTabCommittee': {bg:'#fef3c7',cl:'#b45309',bc:'#fde68a'},
    'alTabDonation':  {bg:'#dcfce7',cl:'#15803d',bc:'#86efac'}
  };
  Object.keys(r2defaults).forEach(function(tid){
    var tb = document.getElementById(tid);
    if(tb){ tb.style.background=r2defaults[tid].bg; tb.style.color=r2defaults[tid].cl; tb.style.borderColor=r2defaults[tid].bc; }
  });
  if(btn) {
    btn.classList.add('act');
    var r2ids = Object.keys(r2defaults);
    if(r2ids.includes(btn.id)) {
      btn.style.background='#1e1b4b'; btn.style.color='white'; btn.style.borderColor='#1e1b4b';
    }
  }
}
function showSportsTab(id, btn) {
  ['spEvents','spTeams','spAchievements','spEquipment'].forEach(t => { const el=document.getElementById(t); if(el) el.style.display='none'; });
  const el = document.getElementById(id); if(el) el.style.display='';
  document.querySelectorAll('#sportsTabs .tab').forEach(t=>t.classList.remove('act'));
  if(btn) btn.classList.add('act');
}
function showWelfareTab(id, btn) {
  ['wfGrievance','wfScholarship','wfCounseling','wfSchemes'].forEach(t => { const el=document.getElementById(t); if(el) el.style.display='none'; });
  const el = document.getElementById(id); if(el) el.style.display='';
  document.querySelectorAll('#welfareTabs .tab').forEach(t=>t.classList.remove('act'));
  if(btn) btn.classList.add('act');
}
function showSAssocTab(id, btn) {
  ['saCommittee','saEvents','saMeetings','saBudget','saProposals'].forEach(t => { const el=document.getElementById(t); if(el) el.style.display='none'; });
  const el = document.getElementById(id); if(el) el.style.display='';
  document.querySelectorAll('#sassocTabs .tab').forEach(t=>t.classList.remove('act'));
  if(btn) btn.classList.add('act');
}
function showStoresTab(id, btn) {
  ['stInventory','stPurchase','stIssue','stVendors','stAudit'].forEach(t => { const el=document.getElementById(t); if(el) el.style.display='none'; });
  const el = document.getElementById(id); if(el) el.style.display='';
  document.querySelectorAll('#storesTabs .tab').forEach(t=>t.classList.remove('act'));
  if(btn) btn.classList.add('act');
}
function uploadLibraryBookFac() {
  const name = document.getElementById('libFacBookName').value.trim();
  const author = document.getElementById('libFacAuthor').value.trim();
  if (!name || !author) { alert('Please fill in Book Name and Author.'); return; }
  alert('✅ Book "' + name + '" uploaded successfully!\n\nStatus: Pending Registrar Approval\nThe Registrar will be notified to review and approve this book before it appears in the student library.');
  document.getElementById('libFacBookName').value = '';
  document.getElementById('libFacAuthor').value = '';
}


/* ===== next script block ===== */

function openESTStaffModal(type, name, instCode, institution, ddo, hoa, kgid, branch, desig, grp, pay, scale, gender, ph, cat, caste, age, dob, joinDate, reportDate, place, service, address, pin, phone, mobile, taluk, district, qual, aadhaar, pan, status) {
  const typeLabels = { TH:'Teaching Staff', NT:'Non-Teaching Staff', AD:'Admin Staff', GF:'Guest Faculty', GD:'Group D / Outsource' };
  const typeColors = { TH:'linear-gradient(120deg,#1a4fa0,#2a5abf)', NT:'linear-gradient(120deg,#0a7a7a,#0d9e9e)', AD:'linear-gradient(120deg,#5b3fa0,#7b5fd0)', GF:'linear-gradient(120deg,#d4600a,#e8820e)', GD:'linear-gradient(120deg,#44403c,#6e6661)' };
  const typeIcons = { TH:'👨‍🏫', NT:'🔧', AD:'🏢', GF:'🎓', GD:'🧹' };

  document.getElementById('estModalHeader').style.background = typeColors[type] || typeColors.TH;
  document.getElementById('estModalAvatar').textContent = typeIcons[type] || '👤';
  document.getElementById('estModalName').textContent = name;
  document.getElementById('estModalSub').textContent = desig + ' · ' + branch;
  document.getElementById('estModalBadge').textContent = typeLabels[type] || type;

  document.getElementById('edInstCode').textContent = instCode;
  document.getElementById('edInstitution').textContent = institution;
  document.getElementById('edDDO').textContent = ddo;
  document.getElementById('edHOA').textContent = hoa;
  document.getElementById('edKGID').textContent = kgid;
  document.getElementById('edGender').textContent = gender;
  document.getElementById('edAge').textContent = age + ' years';
  document.getElementById('edDOB').textContent = dob;
  document.getElementById('edPH').textContent = ph;
  document.getElementById('edCAT').textContent = cat;
  document.getElementById('edCaste').textContent = caste;
  document.getElementById('edQual').textContent = qual;
  document.getElementById('edDesig').textContent = desig;
  document.getElementById('edBranch').textContent = branch;
  document.getElementById('edGroup').textContent = grp;
  document.getElementById('edPay').textContent = pay;
  document.getElementById('edScale').textContent = scale;
  document.getElementById('edJoin').textContent = joinDate;
  document.getElementById('edReporting').textContent = reportDate;
  document.getElementById('edPlace').textContent = place;
  document.getElementById('edService').textContent = service;
  document.getElementById('edAddress').textContent = address;
  document.getElementById('edPin').textContent = pin;
  document.getElementById('edPhone').textContent = phone;
  document.getElementById('edMobile').textContent = mobile;
  document.getElementById('edTaluk').textContent = taluk;
  document.getElementById('edDistrict').textContent = district;
  document.getElementById('edAadhaar').textContent = aadhaar;
  document.getElementById('edPAN').textContent = pan;

  const modal = document.getElementById('estStaffModal');
  modal.style.display = 'flex';
  document.body.style.overflow = 'hidden';
}

/* ================================================================
   EST MODULE — ADD / REMOVE EMPLOYEE ENGINE
   ================================================================ */

// ── Seed Data ────────────────────────────────────────────────────
const estData = {
  TH: [
    { name:'Staff Member', instCode:'171 Government Polytechnic Hubli', institution:'171 Government Polytechnic Hubli', ddo:'DDO/001', hoa:'HOA/2024', kgid:'KGD2015001', branch:'Civil Engineering', desig:'HOD / Professor', group:'Group A', pay:'₹56,100', scale:'56100-177500', gender:'Male', ph:'No', category:'General', caste:'Patil', age:'48', dob:'12-Mar-1977', joinDate:'01-Jun-2005', reportDate:'15-Jul-2018', place:'Hubli', service:'19 Yrs 8 Mo', address:'Vidyanagar, Hubli', pin:'580031', phone:'0836-XXXXXX', mobile:'98XXXXXXXX', taluk:'Hubli', district:'Dharwad', qual:'B.E., M.Tech, Ph.D', aadhaar:'XXXX-XXXX-XXXX', pan:'ABCDE1234F', status:'Active' },
    { name:'Staff Member', instCode:'171 Government Polytechnic Hubli', institution:'171 Government Polytechnic Hubli', ddo:'DDO/001', hoa:'HOA/2024', kgid:'KGD2016042', branch:'CSE', desig:'Asst. Professor', group:'Group B', pay:'₹42,700', scale:'42700-135600', gender:'Male', ph:'No', category:'OBC', caste:'Kumar', age:'38', dob:'05-Sep-1986', joinDate:'10-Aug-2012', reportDate:'01-Jan-2019', place:'Hubli', service:'12 Yrs 6 Mo', address:'Keshwapur, Hubli', pin:'580023', phone:'—', mobile:'97XXXXXXXX', taluk:'Hubli', district:'Dharwad', qual:'B.E., M.Tech', aadhaar:'XXXX-XXXX-XXXX', pan:'FGHIJ5678K', status:'Active' }
  ],
  NT: [
    { name:'Mr. K. Reddy', instCode:'171 Government Polytechnic Hubli', institution:'171 Government Polytechnic Hubli', ddo:'DDO/001', hoa:'HOA/2024', kgid:'KGD2018021', branch:'CSE', desig:'Lab Technician', group:'Group C', pay:'₹29,600', scale:'29600-94100', gender:'Male', ph:'No', category:'OBC', caste:'Reddy', age:'34', dob:'08-Jun-1990', joinDate:'15-Aug-2018', reportDate:'15-Aug-2018', place:'Hubli', service:'6 Yrs 6 Mo', address:'Navanagar, Hubli', pin:'580025', phone:'0836-XXXXXX', mobile:'98XXXXXXXX', taluk:'Hubli', district:'Dharwad', qual:'Diploma, B.Sc (CS)', aadhaar:'XXXX-XXXX-XXXX', pan:'KREDDY123A', status:'Active' },
    { name:'Mr. J. Hegde', instCode:'171 Government Polytechnic Hubli', institution:'171 Government Polytechnic Hubli', ddo:'DDO/001', hoa:'HOA/2024', kgid:'KGD2019054', branch:'Civil', desig:'Lab Assistant', group:'Group C', pay:'₹27,900', scale:'27900-88600', gender:'Male', ph:'No', category:'SC', caste:'Hegde', age:'31', dob:'22-Nov-1993', joinDate:'01-Dec-2019', reportDate:'01-Dec-2019', place:'Hubli', service:'5 Yrs 2 Mo', address:'Vidyanagar, Hubli', pin:'580031', phone:'—', mobile:'97XXXXXXXX', taluk:'Hubli', district:'Dharwad', qual:'Diploma (Civil Engg.)', aadhaar:'XXXX-XXXX-XXXX', pan:'JHEGDE456B', status:'Active' }
  ],
  AD: [
    { name:'Mr. P. Kulkarni', instCode:'171 Government Polytechnic Hubli', institution:'171 Government Polytechnic Hubli', ddo:'DDO/001', hoa:'HOA/2024', kgid:'KGD2017008', branch:'Accounts', desig:'Senior Accountant', group:'Group B', pay:'₹44,900', scale:'44900-142400', gender:'Male', ph:'No', category:'General', caste:'Kulkarni', age:'45', dob:'17-Apr-1980', joinDate:'01-Mar-2007', reportDate:'10-Jun-2017', place:'Hubli', service:'17 Yrs 11 Mo', address:'Deshpande Nagar, Hubli', pin:'580029', phone:'0836-XXXXXX', mobile:'96XXXXXXXX', taluk:'Hubli', district:'Dharwad', qual:'B.Com, M.Com', aadhaar:'XXXX-XXXX-XXXX', pan:'PKULK789C', status:'Active' },
    { name:'Mrs. L. Desai', instCode:'171 Government Polytechnic Hubli', institution:'171 Government Polytechnic Hubli', ddo:'DDO/001', hoa:'HOA/2024', kgid:'KGD2018033', branch:'ACM', desig:'Office Superintendent', group:'Group B', pay:'₹43,600', scale:'43600-138400', gender:'Female', ph:'No', category:'OBC', caste:'Desai', age:'42', dob:'03-Feb-1983', joinDate:'20-Sep-2008', reportDate:'05-Jan-2018', place:'Hubli', service:'16 Yrs 5 Mo', address:'Keshwapur, Hubli', pin:'580023', phone:'0836-XXXXXX', mobile:'95XXXXXXXX', taluk:'Hubli', district:'Dharwad', qual:'B.A, M.A (Admin)', aadhaar:'XXXX-XXXX-XXXX', pan:'LDESAI012D', status:'Active' }
  ],
  GF: [
    { name:'Mr. B. Naik', instCode:'171 Government Polytechnic Hubli', institution:'171 Government Polytechnic Hubli', ddo:'—', hoa:'—', kgid:'—', branch:'ECE', desig:'Guest Faculty', group:'—', pay:'Honorarium', scale:'—', gender:'Male', ph:'No', category:'General', caste:'Naik', age:'35', dob:'20-Jan-1990', joinDate:'01-Aug-2023', reportDate:'01-Aug-2023', place:'Hubli', service:'1 Yr 6 Mo', address:'Vidyanagar, Hubli', pin:'580031', phone:'—', mobile:'98XXXXXXXX', taluk:'Hubli', district:'Dharwad', qual:'B.E. ECE, M.Tech', aadhaar:'XXXX-XXXX-XXXX', pan:'BNAIK1234X', status:'Active' },
    { name:'Ms. R. Joshi', instCode:'171 Government Polytechnic Hubli', institution:'171 Government Polytechnic Hubli', ddo:'—', hoa:'—', kgid:'—', branch:'CSE', desig:'Guest Faculty', group:'—', pay:'Honorarium', scale:'—', gender:'Female', ph:'No', category:'OBC', caste:'Joshi', age:'30', dob:'14-May-1994', joinDate:'15-Aug-2024', reportDate:'15-Aug-2024', place:'Hubli', service:'6 Mo', address:'Keshwapur, Hubli', pin:'580023', phone:'—', mobile:'99XXXXXXXX', taluk:'Hubli', district:'Dharwad', qual:'B.E. CSE, MCA', aadhaar:'XXXX-XXXX-XXXX', pan:'RJOSHI678Y', status:'Active' }
  ],
  GD: [
    { name:'Mr. M. Singh', instCode:'171 Government Polytechnic Hubli', institution:'171 Government Polytechnic Hubli', ddo:'DDO/001', hoa:'HOA/2024', kgid:'—', branch:'Group D', desig:'Sweeper', group:'Group D', pay:'₹18,000', scale:'18000-56900', gender:'Male', ph:'No', category:'SC', caste:'Singh', age:'40', dob:'14-Jan-1985', joinDate:'01-Apr-2020', reportDate:'01-Apr-2020', place:'Hubli', service:'4 Yrs 10 Mo', address:'Old Hubli', pin:'580024', phone:'—', mobile:'94XXXXXXXX', taluk:'Hubli', district:'Dharwad', qual:'8th Std.', aadhaar:'XXXX-XXXX-XXXX', pan:'MSINGH11E', status:'Active' },
    { name:'Ms. K. Bai', instCode:'171 Government Polytechnic Hubli', institution:'171 Government Polytechnic Hubli', ddo:'DDO/001', hoa:'HOA/2024', kgid:'—', branch:'Outsource', desig:'Housekeeping', group:'—', pay:'Contract', scale:'Daily Wage', gender:'Female', ph:'No', category:'ST', caste:'Bai', age:'35', dob:'05-Aug-1989', joinDate:'10-Jan-2022', reportDate:'10-Jan-2022', place:'Hubli', service:'3 Yrs 1 Mo', address:'Tarihal, Hubli', pin:'580026', phone:'—', mobile:'93XXXXXXXX', taluk:'Hubli', district:'Dharwad', qual:'5th Std.', aadhaar:'XXXX-XXXX-XXXX', pan:'KBAI222F', status:'Active' },
    { name:'Mr. R. Das', instCode:'171 Government Polytechnic Hubli', institution:'171 Government Polytechnic Hubli', ddo:'DDO/001', hoa:'HOA/2024', kgid:'—', branch:'Outsource', desig:'Security Guard', group:'—', pay:'Contract', scale:'Monthly Fixed', gender:'Male', ph:'No', category:'OBC', caste:'Das', age:'38', dob:'19-Mar-1987', joinDate:'15-Jun-2023', reportDate:'15-Jun-2023', place:'Hubli', service:'1 Yr 8 Mo', address:'Gokul Road, Hubli', pin:'580030', phone:'—', mobile:'92XXXXXXXX', taluk:'Hubli', district:'Dharwad', qual:'10th Std.', aadhaar:'XXXX-XXXX-XXXX', pan:'RDAS333G', status:'Active' }
  ]
};

let currentAddEmpType = 'TH';

// ── Render Tables ─────────────────────────────────────────────────
function renderESTTable(type) {
  const bodyMap = { TH:'estTHBody', NT:'estNTBody', AD:'estADBody', GF:'estGFBody', GD:'estGDBody' };
  const countMap = { TH:'estTHCount', NT:'estNTCount', AD:'estADCount', GF:'estGFCount', GD:'estGDCount' };
  const body = document.getElementById(bodyMap[type]);
  const countEl = document.getElementById(countMap[type]);
  if (!body) return;
  const rows = estData[type];
  if (countEl) countEl.textContent = rows.length;
  if (rows.length === 0) {
    const colspan = type === 'GF' ? 13 : type === 'GD' ? 13 : 14;
    body.innerHTML = `<tr><td colspan="${colspan}" style="text-align:center;padding:32px;color:var(--text-muted);font-size:0.82rem;">No records found. Click <strong>➕ Add Employee</strong> to add one.</td></tr>`;
    return;
  }
  body.innerHTML = rows.map((e, i) => {
    const statusBadge = e.status === 'Pending' 
      ? `<span class="badge pending">${e.status}</span>` 
      : `<span class="badge approved">${e.status}</span>`;
    const modalArgs = `'${type}','${e.name}','${e.instCode}','${e.institution}','${e.ddo}','${e.hoa}','${e.kgid}','${e.branch}','${e.desig}','${e.group}','${e.pay}','${e.scale}','${e.gender}','${e.ph}','${e.category}','${e.caste}','${e.age}','${e.dob}','${e.joinDate}','${e.reportDate}','${e.place}','${e.service}','${e.address}','${e.pin}','${e.phone}','${e.mobile}','${e.taluk}','${e.district}','${e.qual}','${e.aadhaar}','${e.pan}','${e.status}'`;
    let cells = '';
    if (type === 'GF') {
      cells = `<td>${i+1}</td><td><strong>${e.name}</strong></td><td>${e.branch}</td><td>${e.desig}</td><td>${e.pay}</td><td>${e.gender}</td><td>${e.dob}</td><td>${e.category}</td><td>${e.joinDate}</td><td>${e.mobile}</td><td>${e.qual}</td><td>${statusBadge}</td>`;
    } else if (type === 'GD') {
      cells = `<td>${i+1}</td><td><strong>${e.name}</strong></td><td>${e.branch}</td><td>${e.desig}</td><td>${e.group}</td><td>${e.pay}</td><td>${e.gender}</td><td>${e.dob}</td><td>${e.category}</td><td>${e.joinDate}</td><td>${e.mobile}</td><td>${statusBadge}</td>`;
    } else {
      cells = `<td>${i+1}</td><td><strong>${e.name}</strong></td><td>${e.kgid}</td><td>${e.branch}</td><td>${e.desig}</td><td>${e.group}</td><td>${e.pay}</td><td>${e.gender}</td><td>${e.dob}</td><td>${e.category}</td><td>${e.joinDate}</td><td>${e.mobile}</td><td>${statusBadge}</td>`;
    }
    return `<tr style="cursor:pointer;" onclick="openESTStaffModal(${modalArgs})">
      ${cells}
      <td onclick="event.stopPropagation()">
        <button onclick="confirmRemoveEmp('${type}',${i})" style="padding:5px 10px;background:#fee2e2;color:#c0392b;border:1.5px solid #fca5a5;border-radius:6px;cursor:pointer;font-size:0.72rem;font-weight:700;font-family:'Plus Jakarta Sans',sans-serif;" title="Remove employee">🗑 Remove</button>
      </td>
    </tr>`;
  }).join('');
}

function renderAllESTTables() {
  ['TH','NT','AD','GF','GD'].forEach(t => renderESTTable(t));
}

// ── Remove Employee ───────────────────────────────────────────────
function confirmRemoveEmp(type, idx) {
  const emp = estData[type][idx];
  if (!emp) return;
  const typeLabels = { TH:'Teaching Staff', NT:'Non-Teaching Staff', AD:'Admin Staff', GF:'Guest Faculty', GD:'Group D / Outsource' };
  if (confirm(`⚠️ Remove Employee\n\nName: ${emp.name}\nType: ${typeLabels[type]}\n\nThis will be submitted to the Principal for removal approval.\n\nProceed?`)) {
    estData[type].splice(idx, 1);
    renderESTTable(type);
    showESTToast(`✅ Removal request for "${emp.name}" submitted to Principal for approval.`, 'success');
  }
}

// ── Add Employee Modal ────────────────────────────────────────────
const typeColors = { TH:'linear-gradient(135deg,#1a4fa0,#2a5abf)', NT:'linear-gradient(135deg,#0a7a7a,#0d9e9e)', AD:'linear-gradient(135deg,#5b3fa0,#7b5fd0)', GF:'linear-gradient(135deg,#d4600a,#e8820e)', GD:'linear-gradient(135deg,#44403c,#6e6661)' };
const typeLabels = { TH:'Teaching Staff', NT:'Non-Teaching Staff', AD:'Admin Staff', GF:'Guest Faculty', GD:'Group D / Outsource' };

function openAddEmpModal(type) {
  currentAddEmpType = type;
  const header = document.getElementById('addEmpModalHeader');
  if (header) header.style.background = typeColors[type] || typeColors.TH;
  document.getElementById('addEmpModalTitle').textContent = '➕ Add New ' + (typeLabels[type] || 'Employee');
  document.getElementById('addEmpModalSub').textContent = '171 Government Polytechnic Hubli · Pending Principal Approval';
  // Clear form
  ['ae_instCode','ae_kgid','ae_institution','ae_ddo','ae_hoa','ae_name','ae_dob','ae_caste','ae_qual','ae_desig','ae_pay','ae_scale','ae_joinDate','ae_reportDate','ae_place','ae_address','ae_pin','ae_taluk','ae_district','ae_phone','ae_mobile','ae_aadhaar','ae_pan'].forEach(id => {
    const el = document.getElementById(id);
    if (el && el.tagName !== 'SELECT') {
      if (['ae_instCode','ae_institution','ae_place','ae_taluk','ae_district'].includes(id)) return; // keep defaults
      el.value = '';
    }
  });
  const modal = document.getElementById('estAddEmpModal');
  modal.style.display = 'flex';
  document.body.style.overflow = 'hidden';
}

function closeAddEmpModal() {
  document.getElementById('estAddEmpModal').style.display = 'none';
  document.body.style.overflow = '';
}

function submitAddEmployee() {
  const name = document.getElementById('ae_name').value.trim();
  const mobile = document.getElementById('ae_mobile').value.trim();
  const desig = document.getElementById('ae_desig').value.trim();
  const joinDate = document.getElementById('ae_joinDate').value;
  const qual = document.getElementById('ae_qual').value.trim();
  if (!name || !mobile || !desig || !joinDate || !qual) {
    showESTToast('❌ Please fill all required fields (marked with *)', 'error');
    return;
  }
  const dob = document.getElementById('ae_dob').value;
  const joinDateFormatted = joinDate ? new Date(joinDate).toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'numeric'}) : '—';
  const dobFormatted = dob ? new Date(dob).toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'numeric'}) : '—';
  const today = new Date();
  const joinDateObj = new Date(joinDate);
  const years = today.getFullYear() - joinDateObj.getFullYear();
  const months = today.getMonth() - joinDateObj.getMonth();
  const totalMonths = years * 12 + months;
  const serviceStr = `${Math.floor(totalMonths/12)} Yrs ${totalMonths % 12} Mo`;
  const ageStr = dob ? String(today.getFullYear() - new Date(dob).getFullYear()) : '—';

  const newEmp = {
    name, instCode: document.getElementById('ae_instCode').value,
    institution: document.getElementById('ae_institution').value,
    ddo: document.getElementById('ae_ddo').value, hoa: document.getElementById('ae_hoa').value,
    kgid: document.getElementById('ae_kgid').value || '—',
    branch: document.getElementById('ae_branch').value, desig,
    group: document.getElementById('ae_group').value,
    pay: document.getElementById('ae_pay').value || '—',
    scale: document.getElementById('ae_scale').value || '—',
    gender: document.getElementById('ae_gender').value,
    ph: document.getElementById('ae_ph').value, category: document.getElementById('ae_category').value,
    caste: document.getElementById('ae_caste').value || '—', age: ageStr, dob: dobFormatted,
    joinDate: joinDateFormatted, reportDate: joinDateFormatted,
    place: document.getElementById('ae_place').value || 'Hubli', service: serviceStr,
    address: document.getElementById('ae_address').value || '—',
    pin: document.getElementById('ae_pin').value || '—',
    taluk: document.getElementById('ae_taluk').value || 'Hubli',
    district: document.getElementById('ae_district').value || 'Dharwad',
    phone: document.getElementById('ae_phone').value || '—', mobile,
    qual, aadhaar: document.getElementById('ae_aadhaar').value || 'XXXX-XXXX-XXXX',
    pan: (document.getElementById('ae_pan').value || '').toUpperCase() || '—',
    status: 'Pending'
  };

  estData[currentAddEmpType].push(newEmp);
  renderESTTable(currentAddEmpType);
  closeAddEmpModal();
  showESTToast(`✅ "${name}" added as Pending. Awaiting Principal approval to become Active.`, 'success');
}

// ── Toast Notification ────────────────────────────────────────────
function showESTToast(msg, type) {
  let toast = document.getElementById('estToast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'estToast';
    toast.style.cssText = 'position:fixed;bottom:24px;right:24px;z-index:99999;padding:12px 20px;border-radius:10px;font-family:Plus Jakarta Sans,sans-serif;font-size:0.82rem;font-weight:700;max-width:340px;box-shadow:0 8px 24px rgba(0,0,0,0.18);transition:opacity 0.3s;';
    document.body.appendChild(toast);
  }
  toast.textContent = msg;
  toast.style.background = type === 'error' ? '#fee2e2' : '#dcfce7';
  toast.style.color = type === 'error' ? '#c0392b' : '#156e3a';
  toast.style.border = type === 'error' ? '1.5px solid #fca5a5' : '1.5px solid #86efac';
  toast.style.opacity = '1';
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => { toast.style.opacity = '0'; }, 4000);
}

function scrollESTSection(id) {
  const el = document.getElementById(id);
  const body = document.getElementById('estModalBody');
  if (el && body) body.scrollTo({ top: el.offsetTop - 10, behavior: 'smooth' });
}

function closeESTStaffModal() {
  const m = document.getElementById('estStaffModal');
  if (m) m.style.display = 'none';
  document.body.style.overflow = '';
}

// Init everything after DOM is ready
document.addEventListener('DOMContentLoaded', function() {
  renderAllESTTables();

  const addModal = document.getElementById('estAddEmpModal');
  if (addModal) addModal.addEventListener('click', function(e) {
    if (e.target === this) closeAddEmpModal();
  });

  const viewModal = document.getElementById('estStaffModal');
  if (viewModal) viewModal.addEventListener('click', function(e) {
    if (e.target === this) closeESTStaffModal();
  });
});

/* ================================================================
   PROFILE PHOTO UPLOAD ENGINE
   - JPG, JPEG, PNG only
   - Max 100 KB
   - Syncs: topbar avatar + profile card + sidebar avatar
   ================================================================ */

const userPhotos = { ad: null, fac: null, stu: null, pri: null };

function triggerPhotoUpload(role) {
  const input = document.getElementById(role + 'PhotoInput');
  if (input) input.click();
}

function handlePhotoUpload(input, role) {
  const file = input.files[0];
  if (!file) return;

  // Validate type
  const allowed = ['image/jpeg', 'image/jpg', 'image/png'];
  if (!allowed.includes(file.type.toLowerCase())) {
    showPhotoMsg(role, '❌ Only JPG, JPEG, PNG files are allowed.', 'error');
    input.value = '';
    return;
  }

  // Validate size (100 KB = 102400 bytes)
  if (file.size > 102400) {
    const sizeKB = (file.size / 1024).toFixed(1);
    showPhotoMsg(role, `❌ File too large (${sizeKB} KB). Maximum allowed is 100 KB.`, 'error');
    input.value = '';
    return;
  }

  // Read and apply
  const reader = new FileReader();
  reader.onload = function(e) {
    const dataURL = e.target.result;
    userPhotos[role] = dataURL;
    applyPhotoEverywhere(role, dataURL);
    const sizeKB = (file.size / 1024).toFixed(1);

    // Student photos must go through Admin approval (profile request) to persist.
    if (role === 'stu') {
      window._stuPendingPhoto = dataURL;
      if (window._stuProfileEditLocked) {
        showPhotoMsg(
          role,
          '🔒 Profile is locked by Admin. Unlock is required before a photo change can be submitted for approval.',
          'error'
        );
        return;
      }
      // Open request draft so the student can submit photo + any field changes
      if (!window._stuProfileEditEnabled && typeof window.enableStuProfileEdit === 'function') {
        try { window.enableStuProfileEdit(); } catch (err) { /* ignore */ }
      }
      showPhotoMsg(
        role,
        `✅ Photo selected (${sizeKB} KB). Click "Submit Update Request" so Admin can approve and save it permanently.`,
        'success'
      );
      return;
    }

    showPhotoMsg(role, `✅ Photo uploaded successfully! (${sizeKB} KB)`, 'success');
  };
  reader.readAsDataURL(file);
  input.value = '';
}

function applyPhotoEverywhere(role, dataURL) {
  if (!dataURL || typeof dataURL !== 'string') return;

  // 1. Topbar avatar
  const ava = document.getElementById(role + 'Ava');
  if (ava) {
    ava.innerHTML = `<img src="${dataURL}" alt="Profile Photo" style="width:100%;height:100%;object-fit:cover;border-radius:9px;" />`;
    ava.style.background = 'transparent';
    ava.style.padding = '0';
    ava.style.overflow = 'hidden';
  }

  // 2. Profile card circle
  const circle = document.getElementById(role + 'ProfilePhotoCircle');
  if (circle) {
    circle.innerHTML = `<img src="${dataURL}" alt="Profile Photo" style="width:100%;height:100%;object-fit:cover;border-radius:50%;" />`;
  }

  // 3. Student profile card header (stuPhotoPreview)
  if (role === 'stu') {
    const prev = document.getElementById('stuPhotoPreview');
    if (prev) {
      prev.innerHTML = `<img src="${dataURL}" alt="Photo" style="width:100%;height:100%;object-fit:cover;border-radius:50%;" />`;
    }
  }

  // 4. Principal profile card header
  if (role === 'pri') {
    const prev = document.getElementById('priPhotoPreview');
    if (prev) {
      prev.innerHTML = `<img src="${dataURL}" alt="Photo" style="width:100%;height:100%;object-fit:cover;border-radius:50%;" />`;
    }
  }
}
window.applyPhotoEverywhere = applyPhotoEverywhere;
window.userPhotos = userPhotos;

function showPhotoMsg(role, msg, type) {
  const el = document.getElementById(role + 'PhotoMsg');
  if (!el) return;
  el.textContent = msg;
  el.style.color = type === 'error' ? '#c0392b' : '#1a7a4a';
  el.style.fontWeight = '600';
  setTimeout(() => { if (el) el.textContent = ''; }, 5000);
}

/* ================================================================
   PROFILE MANAGER ENGINE
   Root Admin controls Student & Staff profile sections/fields.
   Changes auto-sync to student login and faculty/staff login.
   ================================================================ */

// ── Official branches + Current Year options ────────────────
const OFFICIAL_BRANCHES = [
  'Civil Engineering',
  'Computer Science and Engineering',
  'Electronics and Communication Engineering',
  'Mechanical Engineering',
];
window.OFFICIAL_BRANCHES = OFFICIAL_BRANCHES;

const STU_YEAR_OPTIONS = ['1st Year', '2nd Year', '3rd Year', 'YEAR BACK', 'Completed'];

/** Which fee-year blocks are editable / view-only / locked for a Current Year value. */
function getStuFeeYearAccess(currentYear) {
  const y = String(currentYear || '').replace(/\s+/g, ' ').trim().toLowerCase();
  // edit = can fill when request draft is open; view = show values but not edit; locked = disabled placeholder
  if (y === '1st year' || y === '1 st year') return { 1: 'edit', 2: 'locked', 3: 'locked' };
  if (y === '2nd year' || y === '2 nd year') return { 1: 'edit', 2: 'edit', 3: 'locked' };
  if (y === '3rd year' || y === '3 rd year') return { 1: 'edit', 2: 'edit', 3: 'edit' };
  if (y === 'year back') return { 1: 'edit', 2: 'edit', 3: 'edit' };
  if (y === 'completed') return { 1: 'view', 2: 'view', 3: 'view' };
  return { 1: 'locked', 2: 'locked', 3: 'locked' };
}
window.getStuFeeYearAccess = getStuFeeYearAccess;
window.STU_YEAR_OPTIONS = STU_YEAR_OPTIONS;

// ── Default Student Profile Schema ──────────────────────────────
const defaultStuSections = [
  {
    id: 'stu_s1', title: '📚 Academic Information', visible: true,
    fields: [
      { id:'f1', label:'Current Year', type:'select', options: STU_YEAR_OPTIONS.slice(), value:'1st Year', editable:true },
      { id:'f2', label:'Branch', type:'select', options: OFFICIAL_BRANCHES.slice(), value:'', editable:false },
      { id:'f3', label:'Register Number',    type:'text',  value:'',   editable:false },
    ]
  },
  {
    id: 'stu_s2', title: '👤 Personal Details', visible: true,
    fields: [
      { id:'f4',  label:'Student (As per SSLC)',   type:'text', value:'', editable:false },
      { id:'f5',  label:'Student (As per Aadhar)', type:'text', value:'', editable:false },
      { id:'f6',  label:'Father Name',                  type:'text', value:'', editable:false },
      { id:'f7',  label:'Mother Name',                  type:'text', value:'', editable:false },
      { id:'f8',  label:'Date of Birth',                type:'text', value:'', editable:false },
      { id:'f9',  label:'Gender',                       type:'text', value:'', editable:false },
    ]
  },
  {
    id: 'stu_s3', title: '🪪 Identity & IDs', visible: true,
    fields: [
      { id:'f10', label:'Aadhar Number',           type:'text', value:'', editable:false },
      { id:'f11', label:'Aadhar Registered Mobile',type:'text', value:'', editable:false },
      { id:'f12', label:'APAAR ID',                type:'text', value:'', editable:false },
      { id:'f13', label:'SSP ID',                  type:'text', value:'', editable:false },
      { id:'f14', label:'NSP ID',                  type:'text', value:'', editable:false },
      { id:'f15', label:'RD Number (Caste)',        type:'text', value:'', editable:false },
      { id:'f16', label:'RD Number (Income)',       type:'text', value:'', editable:false },
      { id:'f17', label:'Income (Annual)',          type:'text', value:'', editable:false },
    ]
  },
  {
    id: 'stu_s4', title: '📋 Category & Background', visible: true,
    fields: [
      { id:'f18', label:'Category',             type:'text', value:'', editable:false },
      { id:'f19', label:'Religion',             type:'text', value:'', editable:false },
      { id:'f20', label:'Caste',                type:'text', value:'', editable:false },
      { id:'f21', label:'Physically Challenged?',type:'text', value:'', editable:false },
    ]
  },
  {
    id: 'stu_s5', title: '📞 Contact Information', visible: true,
    fields: [
      { id:'f22', label:'WhatsApp Number',        type:'text',  value:'', editable:true },
      { id:'f23', label:'Parents Mobile Number',  type:'text',  value:'', editable:true },
      { id:'f24', label:'Valid E-mail ID',        type:'email', value:'', editable:true },
      { id:'f25', label:'Staying in Hostel?',     type:'text',  value:'', editable:false },
      { id:'f26', label:'Home Address',           type:'textarea', value:'', editable:true },
    ]
  },
  {
    id: 'stu_s6', title: '💳 Fees Payment Details', visible: true,
    fields: [
      // Each year: Amount, Receipt No, Fees Paid Date (feeYear drives enable/lock rules)
      { id:'f27a', label:'1st Year Fee Amount',      type:'text', value:'', editable:true, feeYear:1, feeGroup:'1st Year Fees' },
      { id:'f27b', label:'1st Year Receipt No',       type:'text', value:'', editable:true, feeYear:1 },
      { id:'f27c', label:'1st Year Fees Paid Date',   type:'date', value:'', editable:true, feeYear:1 },
      { id:'f28a', label:'2nd Year Fee Amount',      type:'text', value:'', editable:true, feeYear:2, feeGroup:'2nd Year Fees' },
      { id:'f28b', label:'2nd Year Receipt No',       type:'text', value:'', editable:true, feeYear:2 },
      { id:'f28c', label:'2nd Year Fees Paid Date',   type:'date', value:'', editable:true, feeYear:2 },
      { id:'f29a', label:'3rd Year Fee Amount',      type:'text', value:'', editable:true, feeYear:3, feeGroup:'3rd Year Fees' },
      { id:'f29b', label:'3rd Year Receipt No',       type:'text', value:'', editable:true, feeYear:3 },
      { id:'f29c', label:'3rd Year Fees Paid Date',   type:'date', value:'', editable:true, feeYear:3 },
    ]
  }
];

// ── Student runtime state ─────────────────────────────────────────
let stuProfileSchema = JSON.parse(JSON.stringify(defaultStuSections));
let stuFieldCounter  = 100;
let stuSecCounter    = 100;

// ── Default Staff Profile Schemas — one per staff type ───────────
const defaultStaffSchemas = {
  TH: [
    { id:'th_s1', title:'👤 Personal Information', visible:true, fields:[
      { id:'th_f1', label:'Full Name',      type:'text',  value:'Staff Member',       editable:false },
      { id:'th_f2', label:'Date of Birth',  type:'text',  value:'12/06/1982',         editable:false },
      { id:'th_f3', label:'Gender',         type:'text',  value:'Male',               editable:false },
      { id:'th_f4', label:'Aadhaar Number', type:'text',  value:'XXXX XXXX 7812',     editable:false },
      { id:'th_f5', label:'PAN Number',     type:'text',  value:'ABCPS1234D',         editable:false },
    ]},
    { id:'th_s2', title:'🏛️ Institutional Details', visible:true, fields:[
      { id:'th_f6',  label:'SSN ID',         type:'text', value:'SSN2015001',         editable:false },
      { id:'th_f7',  label:'Designation',    type:'text', value:'HOD / Professor',    editable:false },
      { id:'th_f8',  label:'Department',     type:'text', value:'Civil Engineering',  editable:false },
      { id:'th_f9',  label:'Date of Joining',type:'text', value:'01/07/2015',         editable:false },
    ]},
    { id:'th_s3', title:'🎓 Qualifications', visible:true, fields:[
      { id:'th_f10', label:'Highest Qualification', type:'text', value:'Ph.D. in Civil Engineering', editable:true },
      { id:'th_f11', label:'University',            type:'text', value:'VTU, Belagavi',              editable:true },
      { id:'th_f12', label:'Year of Passing',       type:'text', value:'2013',                       editable:true },
    ]},
    { id:'th_s4', title:'📚 Teaching Load', visible:true, fields:[
      { id:'th_f13', label:'Subjects Handled',   type:'text', value:'Fluid Mechanics, Structural Analysis', editable:true },
      { id:'th_f14', label:'Weekly Hours',        type:'number', value:'18',                                editable:false },
    ]},
    { id:'th_s5', title:'📞 Contact Details', visible:true, fields:[
      { id:'th_f15', label:'Mobile Number',  type:'text',     value:'+91 9876500001',               editable:true },
      { id:'th_f16', label:'Official Email', type:'email',    value:'spatil@gpt.edu.in',            editable:false },
      { id:'th_f17', label:'Home Address',   type:'textarea', value:'45, Keshwapur, Hubli - 580023',editable:true },
    ]},
    { id:'th_s6', title:'💰 Bank & Payroll', visible:true, fields:[
      { id:'th_f18', label:'Bank Name',      type:'text', value:'State Bank of India', editable:false },
      { id:'th_f19', label:'Account Number', type:'text', value:'XXXXXX0001',          editable:false },
      { id:'th_f20', label:'IFSC Code',      type:'text', value:'SBIN0XXXXX',          editable:false },
      { id:'th_f21', label:'GPF Account No.',type:'text', value:'GPF-KA-XXXXX',        editable:false },
    ]},
  ],
  NT: [
    { id:'nt_s1', title:'👤 Personal Information', visible:true, fields:[
      { id:'nt_f1', label:'Full Name',      type:'text', value:'Mr. K. Reddy',         editable:false },
      { id:'nt_f2', label:'Date of Birth',  type:'text', value:'08/06/1990',           editable:false },
      { id:'nt_f3', label:'Gender',         type:'text', value:'Male',                 editable:false },
      { id:'nt_f4', label:'Aadhaar Number', type:'text', value:'XXXX XXXX 4521',       editable:false },
    ]},
    { id:'nt_s2', title:'🏛️ Institutional Details', visible:true, fields:[
      { id:'nt_f5', label:'KGID No.',       type:'text', value:'KGD2018021',           editable:false },
      { id:'nt_f6', label:'Designation',    type:'text', value:'Lab Technician',       editable:false },
      { id:'nt_f7', label:'Department',     type:'text', value:'CSE',                  editable:false },
      { id:'nt_f8', label:'Date of Joining',type:'text', value:'15/08/2018',           editable:false },
    ]},
    { id:'nt_s3', title:'🔧 Technical Skills', visible:true, fields:[
      { id:'nt_f9',  label:'Lab Managed',      type:'text', value:'Computer Lab – A Wing', editable:true },
      { id:'nt_f10', label:'Equipment Skills',  type:'text', value:'Server Admin, Networking', editable:true },
    ]},
    { id:'nt_s4', title:'📞 Contact Details', visible:true, fields:[
      { id:'nt_f11', label:'Mobile Number',  type:'text',     value:'+91 9876500002',               editable:true },
      { id:'nt_f12', label:'Home Address',   type:'textarea', value:'12, Navanagar, Hubli - 580025', editable:true },
    ]},
    { id:'nt_s5', title:'💰 Bank & Payroll', visible:true, fields:[
      { id:'nt_f13', label:'Bank Name',      type:'text', value:'Canara Bank',  editable:false },
      { id:'nt_f14', label:'Account Number', type:'text', value:'XXXXXX0002',   editable:false },
      { id:'nt_f15', label:'IFSC Code',      type:'text', value:'CNRB0XXXXX',   editable:false },
    ]},
  ],
  AD: [
    { id:'ad_s1', title:'👤 Personal Information', visible:true, fields:[
      { id:'ad_f1', label:'Full Name',      type:'text', value:'Mr. P. Kulkarni',      editable:false },
      { id:'ad_f2', label:'Date of Birth',  type:'text', value:'17/04/1980',           editable:false },
      { id:'ad_f3', label:'Gender',         type:'text', value:'Male',                 editable:false },
    ]},
    { id:'ad_s2', title:'🏢 Office Details', visible:true, fields:[
      { id:'ad_f4', label:'KGID No.',       type:'text', value:'KGD2017008',           editable:false },
      { id:'ad_f5', label:'Designation',    type:'text', value:'Senior Accountant',    editable:false },
      { id:'ad_f6', label:'Office Section', type:'text', value:'Accounts',             editable:false },
      { id:'ad_f7', label:'Date of Joining',type:'text', value:'01/03/2007',           editable:false },
    ]},
    { id:'ad_s3', title:'📋 Administrative Role', visible:true, fields:[
      { id:'ad_f8',  label:'Modules Handled',   type:'text', value:'Fee Collection, Budget, Audit', editable:true },
      { id:'ad_f9',  label:'In-charge of',       type:'text', value:'Accounts Department',          editable:true },
    ]},
    { id:'ad_s4', title:'📞 Contact Details', visible:true, fields:[
      { id:'ad_f10', label:'Mobile Number', type:'text',     value:'+91 9876500003',                   editable:true },
      { id:'ad_f11', label:'Home Address',  type:'textarea', value:'Deshpande Nagar, Hubli - 580029',  editable:true },
    ]},
    { id:'ad_s5', title:'💰 Bank & Payroll', visible:true, fields:[
      { id:'ad_f12', label:'Bank Name',      type:'text', value:'Union Bank of India', editable:false },
      { id:'ad_f13', label:'Account Number', type:'text', value:'XXXXXX0003',          editable:false },
      { id:'ad_f14', label:'IFSC Code',      type:'text', value:'UBIN0XXXXX',          editable:false },
    ]},
  ],
  GF: [
    { id:'gf_s1', title:'👤 Personal Information', visible:true, fields:[
      { id:'gf_f1', label:'Full Name',     type:'text',  value:'Mr. B. Naik',          editable:false },
      { id:'gf_f2', label:'Date of Birth', type:'text',  value:'20/01/1990',           editable:false },
      { id:'gf_f3', label:'Gender',        type:'text',  value:'Male',                 editable:false },
    ]},
    { id:'gf_s2', title:'🎓 Academic Details', visible:true, fields:[
      { id:'gf_f4', label:'Department',       type:'text',  value:'ECE',               editable:false },
      { id:'gf_f5', label:'Subjects Handling',type:'text',  value:'Signal Processing', editable:true  },
      { id:'gf_f6', label:'Qualification',    type:'text',  value:'B.E. ECE, M.Tech',  editable:true  },
      { id:'gf_f7', label:'Date of Joining',  type:'text',  value:'01/08/2023',        editable:false },
    ]},
    { id:'gf_s3', title:'⏱️ Workload', visible:true, fields:[
      { id:'gf_f8',  label:'Daily Hours',   type:'number', value:'6',  editable:true },
      { id:'gf_f9',  label:'Weekly Hours',  type:'number', value:'28', editable:true },
      { id:'gf_f10', label:'Monthly Hours', type:'number', value:'112',editable:true },
    ]},
    { id:'gf_s4', title:'📞 Contact Details', visible:true, fields:[
      { id:'gf_f11', label:'Mobile Number', type:'text',     value:'+91 9876500004',               editable:true },
      { id:'gf_f12', label:'Home Address',  type:'textarea', value:'Vidyanagar, Hubli - 580031',    editable:true },
    ]},
  ],
  GD: [
    { id:'gd_s1', title:'👤 Personal Information', visible:true, fields:[
      { id:'gd_f1', label:'Full Name',     type:'text', value:'Mr. M. Singh',          editable:false },
      { id:'gd_f2', label:'Date of Birth', type:'text', value:'14/01/1985',            editable:false },
      { id:'gd_f3', label:'Gender',        type:'text', value:'Male',                  editable:false },
    ]},
    { id:'gd_s2', title:'🧹 Job Details', visible:true, fields:[
      { id:'gd_f4', label:'Role',         type:'text', value:'Sweeper',                editable:false },
      { id:'gd_f5', label:'Type',         type:'text', value:'Group D / Direct',       editable:false },
      { id:'gd_f6', label:'Date of Joining',type:'text',value:'01/04/2020',            editable:false },
    ]},
    { id:'gd_s3', title:'📞 Contact Details', visible:true, fields:[
      { id:'gd_f7', label:'Mobile Number', type:'text',     value:'+91 9876500005',    editable:true },
      { id:'gd_f8', label:'Home Address',  type:'textarea', value:'Old Hubli - 580024',editable:true },
    ]},
  ],
};

// ── Runtime schemas (deep copy of defaults) ───────────────────────
const staffSchemas = {};
Object.keys(defaultStaffSchemas).forEach(t => {
  staffSchemas[t] = JSON.parse(JSON.stringify(defaultStaffSchemas[t]));
});

const spTabColors = { TH:'var(--primary)', NT:'var(--teal)', AD:'var(--purple)', GF:'var(--orange)', GD:'#6b7280' };
const spTabLabels = { TH:'Teaching Faculty', NT:'Non-Teaching', AD:'Admin Staff', GF:'Guest Faculty', GD:'Group D' };
let spFieldCounters = { TH:500, NT:600, AD:700, GF:800, GD:900 };
let spSecCounters   = { TH:50,  NT:60,  AD:70,  GF:80,  GD:90  };
let currentSPTab = 'TH';

// ── Tab Switcher ──────────────────────────────────────────────────
function showStaffProfileTab(type, btn) {
  ['TH','NT','AD','GF','GD'].forEach(t => {
    const panel = document.getElementById('spPanel_' + t);
    if (panel) panel.style.display = t === type ? '' : 'none';
  });
  document.querySelectorAll('#adStaffProfile .tab').forEach(b => b.classList.remove('act'));
  if (btn) btn.classList.add('act');
  currentSPTab = type;
  renderStaffBuilder(type);
}

// ── Render Builder for a given type ──────────────────────────────
function renderStaffBuilder(type) {
  if (!type) type = currentSPTab;
  const container = document.getElementById('staffBuilder_' + type);
  if (!container) return;
  const schema = staffSchemas[type];
  const color = spTabColors[type];
  container.innerHTML = '';
  if (!schema || schema.length === 0) {
    container.innerHTML = '<div class="info-box">No sections yet. Click ➕ Add Section to start.</div>';
    renderStaffPreview(type);
    return;
  }
  schema.forEach((sec, si) => {
    const secDiv = document.createElement('div');
    secDiv.style.cssText = 'background:#fff;border:1.5px solid var(--border);border-radius:10px;margin-bottom:14px;overflow:hidden;box-shadow:0 1px 4px rgba(0,0,0,0.06);';
    secDiv.innerHTML = `
      <div style="display:flex;align-items:center;gap:10px;padding:12px 16px;background:${sec.visible ? color : '#94a3b8'};color:white;flex-wrap:wrap;">
        <input value="${sec.title}" onchange="staffSchemas['${type}'][${si}].title=this.value;renderStaffPreview('${type}')"
          style="flex:1;min-width:160px;background:rgba(255,255,255,0.15);border:none;border-radius:6px;padding:6px 10px;color:white;font-weight:700;font-size:0.85rem;font-family:'Plus Jakarta Sans',sans-serif;outline:none;" />
        <label style="display:flex;align-items:center;gap:5px;font-size:0.75rem;cursor:pointer;white-space:nowrap;">
          <input type="checkbox" ${sec.visible ? 'checked' : ''} onchange="staffSchemas['${type}'][${si}].visible=this.checked;renderStaffBuilder('${type}');" style="cursor:pointer;" />
          Visible
        </label>
        <button onclick="addStaffField('${type}',${si})" style="padding:5px 12px;background:rgba(255,255,255,0.2);color:white;border:1px solid rgba(255,255,255,0.4);border-radius:6px;cursor:pointer;font-size:0.75rem;font-family:'Plus Jakarta Sans',sans-serif;">+ Add Field</button>
        <button onclick="deleteStaffSection('${type}',${si})" style="padding:5px 12px;background:rgba(220,50,50,0.7);color:white;border:none;border-radius:6px;cursor:pointer;font-size:0.75rem;font-family:'Plus Jakarta Sans',sans-serif;">🗑 Remove</button>
      </div>
      <div style="padding:14px 16px;" id="stfFields_${type}_${si}"></div>
    `;
    container.appendChild(secDiv);
    const fieldWrap = document.getElementById(`stfFields_${type}_${si}`);
    if (sec.fields.length === 0) {
      fieldWrap.innerHTML = '<div style="color:var(--text-muted);font-size:0.78rem;padding:6px 0;">No fields yet — click "+ Add Field" above.</div>';
    } else {
      sec.fields.forEach((field, fi) => {
        const row = document.createElement('div');
        row.style.cssText = 'display:flex;align-items:center;gap:8px;margin-bottom:10px;flex-wrap:wrap;';
        row.innerHTML = `
          <input value="${field.label}" placeholder="Field Label" onchange="staffSchemas['${type}'][${si}].fields[${fi}].label=this.value;renderStaffPreview('${type}');"
            style="flex:2;min-width:140px;padding:7px 10px;border:1.5px solid var(--border);border-radius:7px;font-size:0.8rem;font-family:'Plus Jakarta Sans',sans-serif;outline:none;" />
          <select onchange="staffSchemas['${type}'][${si}].fields[${fi}].type=this.value;renderStaffPreview('${type}');"
            style="flex:1;min-width:100px;padding:7px 10px;border:1.5px solid var(--border);border-radius:7px;font-size:0.8rem;font-family:'Plus Jakarta Sans',sans-serif;outline:none;">
            <option value="text"     ${field.type==='text'    ?'selected':''}>Text</option>
            <option value="email"    ${field.type==='email'   ?'selected':''}>Email</option>
            <option value="number"   ${field.type==='number'  ?'selected':''}>Number</option>
            <option value="textarea" ${field.type==='textarea'?'selected':''}>Textarea</option>
            <option value="date"     ${field.type==='date'    ?'selected':''}>Date</option>
          </select>
          <label style="display:flex;align-items:center;gap:4px;font-size:0.74rem;white-space:nowrap;cursor:pointer;">
            <input type="checkbox" ${field.editable?'checked':''} onchange="staffSchemas['${type}'][${si}].fields[${fi}].editable=this.checked;renderStaffPreview('${type}');" style="cursor:pointer;" />
            Staff Can Edit
          </label>
          <button onclick="deleteStaffField('${type}',${si},${fi})" style="padding:5px 10px;background:#fee;color:#c0392b;border:1.5px solid #f5c6cb;border-radius:6px;cursor:pointer;font-size:0.75rem;">🗑</button>
        `;
        fieldWrap.appendChild(row);
      });
    }
  });
  renderStaffPreview(type);
}

function addStaffSection(type) {
  staffSchemas[type].push({ id:`sp_new_${spSecCounters[type]++}`, title:'📁 New Section', visible:true, fields:[] });
  renderStaffBuilder(type);
}

function deleteStaffSection(type, si) {
  if (!confirm('Remove this section from the ' + spTabLabels[type] + ' profile?')) return;
  staffSchemas[type].splice(si, 1);
  renderStaffBuilder(type);
}

function addStaffField(type, si) {
  staffSchemas[type][si].fields.push({ id:`spf_${spFieldCounters[type]++}`, label:'New Field', type:'text', value:'', editable:true });
  renderStaffBuilder(type);
}

function deleteStaffField(type, si, fi) {
  staffSchemas[type][si].fields.splice(fi, 1);
  renderStaffBuilder(type);
}

function saveStaffProfile(type) {
  renderStaffDynamicProfile(type);
  renderStaffPreview(type);
  alert(`✅ ${spTabLabels[type]} profile updated!\n\nChanges are now live in the ${spTabLabels[type]} login portal.`);
}

function renderStaffPreview(type) {
  if (!type) type = currentSPTab;
  const preview = document.getElementById('staffPreview_' + type);
  if (!preview) return;
  preview.innerHTML = renderProfileHTML(staffSchemas[type], false);
}

function renderStaffDynamicProfile(type) {
  // Sync all types or just the saved type to the facDynamicStaffSections
  const target = document.getElementById('facDynamicStaffSections');
  if (!target) return;
  const t = type || 'TH';
  const schema = staffSchemas[t];
  const visible = schema.filter(s => s.visible);
  if (visible.length === 0) { target.innerHTML = ''; return; }
  target.innerHTML = `
    <div style="margin-bottom:14px;padding:14px 18px;background:linear-gradient(120deg,#7a2d0a,var(--orange));border-radius:10px;color:white;">
      <div style="font-weight:700;font-size:0.9rem;margin-bottom:4px;">📋 Admin-Configured Profile Sections</div>
      <div style="font-size:0.74rem;opacity:0.85;">Configured for ${spTabLabels[t]}. Submit updates for Principal approval.</div>
    </div>
    <div class="card" style="padding:20px 24px;margin-bottom:16px;">
      ${renderProfileHTML(schema, false)}
      <button class="btn pr" style="margin-top:16px;" onclick="alert('Update request submitted for Principal approval.')">📤 Submit Changes for Approval</button>
    </div>
  `;
}

// ── Old compatibility shims (keep old calls working) ──────────────
function addStaffSection_old()    { addStaffSection(currentSPTab); }
function saveStaffProfile_old()   { saveStaffProfile(currentSPTab); }
function renderStaffBuilder_old() { renderStaffBuilder(currentSPTab); }

/* ================================================================
   STUDENT PROFILE MANAGER — Google Form–style builder
   Schema saved to DB via /api/profile-schema.
   Student answers → profile request → approve → students.extra (DB).
   ================================================================ */
function stuEscAttr(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;');
}

function markStuSchemaDirty(msg) {
  const el = document.getElementById('stuSchemaSaveStatus');
  if (el) {
    el.textContent = msg || 'Unsaved changes — click Save & apply to store in database.';
    el.style.color = '#b45309';
  }
}

function renderStuBuilder() {
  const container = document.getElementById('stuSectionBuilder');
  if (!container) return;
  if (!Array.isArray(stuProfileSchema) || stuProfileSchema.length === 0) {
    container.innerHTML = '<div style="opacity:.7;padding:18px;text-align:center;">No sections yet. Click <strong>Add section</strong> to start your form.</div>';
    renderStuPreview();
    return;
  }

  container.innerHTML = stuProfileSchema.map((sec, si) => {
    const fields = (sec.fields || []).map((field, fi) => {
      const opts = Array.isArray(field.options) ? field.options.join(', ') : '';
      const showOpts = field.type === 'select';
      return `
        <div style="border:1px solid var(--border);border-radius:10px;padding:12px;margin-bottom:10px;background:var(--bg);">
          <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:8px;">
            <span style="font-size:0.72rem;font-weight:700;color:var(--navy);opacity:.7;">Q${fi + 1}</span>
            <input value="${stuEscAttr(field.label)}" placeholder="Question / field label"
              onchange="stuProfileSchema[${si}].fields[${fi}].label=this.value;renderStuPreview();markStuSchemaDirty();"
              style="flex:1;min-width:160px;padding:8px 10px;border:1.5px solid var(--border);border-radius:8px;font-size:0.85rem;font-weight:600;" />
            <select onchange="stuProfileSchema[${si}].fields[${fi}].type=this.value;if(this.value==='select'&&!stuProfileSchema[${si}].fields[${fi}].options){stuProfileSchema[${si}].fields[${fi}].options=['Option 1','Option 2'];}renderStuBuilder();renderStuPreview();markStuSchemaDirty();"
              style="padding:8px 10px;border:1.5px solid var(--border);border-radius:8px;font-size:0.8rem;min-width:120px;">
              <option value="text" ${field.type==='text'?'selected':''}>Short answer</option>
              <option value="textarea" ${field.type==='textarea'?'selected':''}>Paragraph</option>
              <option value="email" ${field.type==='email'?'selected':''}>Email</option>
              <option value="number" ${field.type==='number'?'selected':''}>Number</option>
              <option value="date" ${field.type==='date'?'selected':''}>Date</option>
              <option value="select" ${field.type==='select'?'selected':''}>Dropdown</option>
            </select>
          </div>
          ${showOpts ? `
          <div style="margin-bottom:8px;">
            <label style="font-size:0.7rem;font-weight:600;opacity:.75;">Dropdown options (comma-separated)</label>
            <input value="${stuEscAttr(opts)}" placeholder="e.g. Yes, No, Prefer not to say"
              onchange="stuProfileSchema[${si}].fields[${fi}].options=this.value.split(',').map(function(x){return x.trim();}).filter(Boolean);renderStuPreview();markStuSchemaDirty();"
              style="width:100%;padding:7px 10px;border:1.5px solid var(--border);border-radius:8px;font-size:0.8rem;margin-top:4px;" />
          </div>` : ''}
          <div style="display:flex;gap:12px;flex-wrap:wrap;align-items:center;font-size:0.75rem;">
            <label style="display:flex;align-items:center;gap:5px;cursor:pointer;">
              <input type="checkbox" ${field.editable!==false?'checked':''}
                onchange="stuProfileSchema[${si}].fields[${fi}].editable=this.checked;renderStuPreview();markStuSchemaDirty();" />
              Student can edit / request update
            </label>
            <label style="display:flex;align-items:center;gap:5px;cursor:pointer;">
              <input type="checkbox" ${field.required?'checked':''}
                onchange="stuProfileSchema[${si}].fields[${fi}].required=this.checked;markStuSchemaDirty();" />
              Required
            </label>
            <span style="flex:1;"></span>
            <button type="button" class="btn ol" style="padding:4px 8px;font-size:0.7rem;" onclick="moveStuField(${si},${fi},-1)" title="Move up">↑</button>
            <button type="button" class="btn ol" style="padding:4px 8px;font-size:0.7rem;" onclick="moveStuField(${si},${fi},1)" title="Move down">↓</button>
            <button type="button" class="btn re" style="padding:4px 10px;font-size:0.7rem;" onclick="deleteStuField(${si},${fi})">🗑</button>
          </div>
        </div>`;
    }).join('');

    return `
      <div style="border:1.5px solid var(--border);border-radius:12px;margin-bottom:14px;overflow:hidden;background:var(--surface);box-shadow:0 1px 4px rgba(15,23,42,.05);">
        <div style="display:flex;align-items:center;gap:8px;padding:12px 14px;background:${sec.visible!==false?'linear-gradient(120deg,#1a4fa0,#2a5abf)':'#94a3b8'};color:#fff;flex-wrap:wrap;">
          <span style="font-size:0.72rem;opacity:.85;font-weight:700;">SECTION ${si + 1}</span>
          <input value="${stuEscAttr(sec.title)}" placeholder="Section title"
            onchange="stuProfileSchema[${si}].title=this.value;renderStuPreview();markStuSchemaDirty();"
            style="flex:1;min-width:160px;background:rgba(255,255,255,.15);border:none;border-radius:8px;padding:8px 12px;color:#fff;font-weight:700;font-size:0.9rem;outline:none;" />
          <label style="display:flex;align-items:center;gap:5px;font-size:0.75rem;cursor:pointer;white-space:nowrap;">
            <input type="checkbox" ${sec.visible!==false?'checked':''}
              onchange="stuProfileSchema[${si}].visible=this.checked;renderStuBuilder();renderStuPreview();markStuSchemaDirty();" />
            Visible
          </label>
          <button type="button" class="btn ol" style="padding:5px 8px;font-size:0.72rem;background:rgba(255,255,255,.15);color:#fff;border-color:rgba(255,255,255,.35);" onclick="moveStuSection(${si},-1)">↑</button>
          <button type="button" class="btn ol" style="padding:5px 8px;font-size:0.72rem;background:rgba(255,255,255,.15);color:#fff;border-color:rgba(255,255,255,.35);" onclick="moveStuSection(${si},1)">↓</button>
          <button type="button" style="padding:5px 10px;background:rgba(220,50,50,.75);color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:0.72rem;" onclick="deleteStuSection(${si})">🗑</button>
        </div>
        <div style="padding:12px 14px;">
          ${fields || '<div style="opacity:.65;font-size:0.8rem;padding:8px 0;">No questions yet. Add a field below.</div>'}
          <button type="button" class="btn ol" style="width:100%;margin-top:4px;" onclick="addStuField(${si})">＋ Add question / field</button>
        </div>
      </div>`;
  }).join('');

  renderStuPreview();
}

function addStuSection() {
  stuProfileSchema.push({
    id: 'stu_new_' + (stuSecCounter++),
    title: 'Untitled section',
    visible: true,
    fields: [],
  });
  markStuSchemaDirty();
  renderStuBuilder();
}

function deleteStuSection(si) {
  if (!confirm('Remove this section and all its fields from the form structure?\\n\\nExisting student data already in the database is kept.')) return;
  stuProfileSchema.splice(si, 1);
  markStuSchemaDirty();
  renderStuBuilder();
}

function addStuField(si) {
  if (!stuProfileSchema[si].fields) stuProfileSchema[si].fields = [];
  stuProfileSchema[si].fields.push({
    id: 'nf' + (stuFieldCounter++),
    label: 'Untitled question',
    type: 'text',
    value: '',
    editable: true,
    required: false,
  });
  markStuSchemaDirty();
  renderStuBuilder();
}

function deleteStuField(si, fi) {
  if (!confirm('Remove this field from the form?')) return;
  stuProfileSchema[si].fields.splice(fi, 1);
  markStuSchemaDirty();
  renderStuBuilder();
}

function moveStuSection(si, dir) {
  const j = si + dir;
  if (j < 0 || j >= stuProfileSchema.length) return;
  const t = stuProfileSchema[si];
  stuProfileSchema[si] = stuProfileSchema[j];
  stuProfileSchema[j] = t;
  markStuSchemaDirty();
  renderStuBuilder();
}

function moveStuField(si, fi, dir) {
  const fields = stuProfileSchema[si].fields || [];
  const j = fi + dir;
  if (j < 0 || j >= fields.length) return;
  const t = fields[fi];
  fields[fi] = fields[j];
  fields[j] = t;
  markStuSchemaDirty();
  renderStuBuilder();
}

async function saveStuProfile() {
  if (!Array.isArray(stuProfileSchema) || !stuProfileSchema.length) {
    alert('Add at least one section before saving.');
    return;
  }
  // Normalize before save
  const payload = stuProfileSchema.map((sec, i) => ({
    id: sec.id || ('stu_sec_' + i),
    title: String(sec.title || 'Section').trim() || 'Section',
    visible: sec.visible !== false,
    fields: (sec.fields || []).map((f, j) => ({
      id: f.id || ('f_' + i + '_' + j),
      label: String(f.label || 'Field').trim() || 'Field',
      type: f.type || 'text',
      value: f.value != null ? f.value : '',
      editable: f.editable !== false,
      required: !!f.required,
      options: Array.isArray(f.options) ? f.options : undefined,
      feeYear: f.feeYear,
      feeGroup: f.feeGroup,
    })),
  }));

  const status = document.getElementById('stuSchemaSaveStatus');
  if (status) {
    status.textContent = 'Saving to database…';
    status.style.color = '#1a4fa0';
  }

  try {
    const res = await fetch('/api/profile-schema', {
      method: 'PUT',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ key: 'student', schema: payload }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data.error || ('HTTP ' + res.status));
    }
    stuProfileSchema = payload;
    renderStuDynamicProfile();
    renderStuPreview();
    if (status) {
      status.textContent = '✅ Saved to database · live on Student My Profile';
      status.style.color = '#065f46';
    }
    alert(
      '✅ Student My Profile form saved to the database.\\n\\n' +
      '• New sections/fields are live for students.\\n' +
      '• When a student fills them and Admin/ACM approves the request, values are stored in the student database (extra profile fields).'
    );
  } catch (e) {
    console.error('[profile-schema] save failed', e);
    if (status) {
      status.textContent = 'Save failed: ' + (e.message || 'error');
      status.style.color = '#991b1b';
    }
    alert('Failed to save form to database.\\n\\n' + (e.message || 'Unknown error') +
      '\\n\\nMake sure you are logged in as Root Admin and the profile_schemas table exists (run DB migration).');
  }
}

function renderStuPreview() {
  const preview = document.getElementById('stuProfilePreview');
  if (!preview) return;
  if (!stuProfileSchema || !stuProfileSchema.length) {
    preview.innerHTML = '<p style="opacity:.65;font-size:0.85rem;">Preview will appear here.</p>';
    return;
  }
  preview.innerHTML = renderProfileHTML(stuProfileSchema, true, { forceReadonly: true });
}

window.addStuSection = addStuSection;
window.deleteStuSection = deleteStuSection;
window.addStuField = addStuField;
window.deleteStuField = deleteStuField;
window.moveStuSection = moveStuSection;
window.moveStuField = moveStuField;
window.saveStuProfile = saveStuProfile;
window.renderStuBuilder = renderStuBuilder;
window.markStuSchemaDirty = markStuSchemaDirty;

/* ================================================================
   STAFF PROFILE MANAGER — ADMIN BUILDER
   ================================================================ */
/* ================================================================
   SHARED — Render profile HTML (used for both preview and live portal)
   ================================================================ */
// opts.forceReadonly: when true, every field is view-only (student live portal default)
// opts.liveStudent: student portal — fee blocks always visible (locked when not reached)
function renderProfileHTML(schema, isStudent, opts) {
  const forceReadonly = !!(opts && opts.forceReadonly);
  const liveStudent = !!(opts && opts.liveStudent);
  let html = '';
  schema.forEach(sec => {
    if (!sec.visible) return;
    html += `<div style="font-size:0.74rem;font-weight:700;color:var(--navy);margin:16px 0 10px;font-family:'Libre Baskerville',serif;border-bottom:1.5px solid var(--border);padding-bottom:6px;">${sec.title}</div>`;
    html += `<div class="form-row" style="flex-wrap:wrap;">`;
    let lastFeeYear = null;
    sec.fields.forEach(field => {
      // Fee year group header
      if (field.feeYear && field.feeYear !== lastFeeYear) {
        lastFeeYear = field.feeYear;
        const gTitle = field.feeGroup || ((field.feeYear === 1 ? '1st' : field.feeYear === 2 ? '2nd' : '3rd') + ' Year Fees');
        html += `<div class="stu-fee-year-hd" data-fee-year="${field.feeYear}" style="flex:1 1 100%;margin:12px 0 6px;padding:8px 12px;background:var(--bg);border:1px solid var(--border);border-radius:8px;font-size:0.78rem;font-weight:700;color:var(--navy);display:flex;justify-content:space-between;align-items:center;gap:8px;">
          <span>💳 ${gTitle}</span>
          <span class="stu-fee-year-status" data-fee-year="${field.feeYear}" style="font-size:0.68rem;font-weight:600;opacity:.75;"></span>
        </div>`;
      }

      // Student live portal is always view-only until they start a request session
      const ro = forceReadonly ? true : !field.editable;
      const roStyle = ro ? 'background:var(--bg);cursor:not-allowed;' : '';
      const feeAttr = field.feeYear ? ` data-fee-year="${field.feeYear}"` : '';
      const isCurrentYear = field.label === 'Current Year';
      const fieldAttrs = isCurrentYear ? ' data-stu-current-year="1"' : '';

      if (field.type === 'textarea') {
        html += `<div class="fg" style="flex:1 1 100%;"${feeAttr}><label>${field.label}</label>
          <textarea ${ro?'readonly':''} style="width:100%;padding:10px 12px;border:1.5px solid var(--border);border-radius:7px;font-family:'Plus Jakarta Sans',sans-serif;font-size:0.84rem;color:var(--text);resize:vertical;height:70px;${roStyle}">${field.value||''}</textarea>
          ${ro?'':'<div style="font-size:0.65rem;color:var(--green);margin-top:3px;">✏️ You can edit this field</div>'}
        </div>`;
      } else if (field.type === 'select') {
        const optsList = Array.isArray(field.options) ? field.options : (isCurrentYear ? STU_YEAR_OPTIONS : []);
        const optionsHtml = optsList.map(o => {
          const sel = String(field.value || '') === String(o) ? ' selected' : '';
          return `<option value="${String(o).replace(/"/g,'&quot;')}"${sel}>${o}</option>`;
        }).join('');
        html += `<div class="fg"${feeAttr}${fieldAttrs}><label>${field.label}</label>
          <select ${ro?'disabled':''} ${isCurrentYear ? 'onchange="onStuCurrentYearChange(this)"' : ''}
            style="width:100%;padding:10px 12px;border:1.5px solid var(--border);border-radius:7px;font-family:'Plus Jakarta Sans',sans-serif;font-size:0.84rem;color:var(--text);${roStyle}">
            ${optionsHtml}
          </select>
          ${ro?'':'<div style="font-size:0.65rem;color:var(--green);margin-top:3px;">✏️ Select your academic status</div>'}
        </div>`;
      } else {
        const inputType = field.type || 'text';
        html += `<div class="fg"${feeAttr}><label>${field.label}</label>
          <input type="${inputType}" value="${field.value||''}" ${ro?'readonly':''} style="width:100%;${roStyle}" />
          ${ro?'':'<div style="font-size:0.65rem;color:var(--green);margin-top:3px;">✏️ You can edit this field</div>'}
        </div>`;
      }
    });
    html += '</div>';
  });
  if (!html) html = '<div style="color:var(--text-muted);text-align:center;padding:32px;font-size:0.82rem;">No sections visible. Root Admin has hidden all sections.</div>';
  return html;
}

/**
 * Apply fee-year lock/view/edit state based on Current Year selection.
 * editMode: when false, everything stays view-only (still show status badges).
 */
function applyStuFeeYearLocks(editMode) {
  const container = document.getElementById('stuDynamicProfileSections');
  if (!container) return;

  let currentYear = '';
  const yearSel = container.querySelector('[data-stu-current-year="1"] select, select[data-stu-current-year="1"]');
  const yearWrap = container.querySelector('[data-stu-current-year="1"]');
  if (yearSel) currentYear = yearSel.value;
  else if (yearWrap) {
    const inp = yearWrap.querySelector('select, input');
    if (inp) currentYear = inp.value;
  }
  // Fallback from schema
  if (!currentYear && typeof stuProfileSchema !== 'undefined') {
    stuProfileSchema.forEach(sec => {
      (sec.fields || []).forEach(f => {
        if (f.label === 'Current Year' && f.value) currentYear = f.value;
      });
    });
  }

  const access = getStuFeeYearAccess(currentYear);
  const statusText = {
    edit: editMode ? '✅ Editable for this year' : 'Visible',
    view: '👁 View only (Completed)',
    locked: '🔒 Locked — unlocks when you reach this year',
  };

  [1, 2, 3].forEach(yr => {
    const mode = access[yr] || 'locked';
    container.querySelectorAll(`.stu-fee-year-status[data-fee-year="${yr}"]`).forEach(el => {
      el.textContent = statusText[mode] || '';
      el.style.color = mode === 'edit' ? 'var(--green)' : mode === 'view' ? '#1a4fa0' : '#b45309';
    });
    container.querySelectorAll(`.stu-fee-year-hd[data-fee-year="${yr}"]`).forEach(el => {
      el.style.opacity = mode === 'locked' ? '0.75' : '1';
      el.style.borderColor = mode === 'locked' ? 'var(--border)' : mode === 'edit' ? 'var(--green)' : '#1a4fa0';
    });
    container.querySelectorAll(`.fg[data-fee-year="${yr}"]`).forEach(fg => {
      const field = fg.querySelector('input, textarea, select');
      if (!field) return;
      const allowEdit = editMode && mode === 'edit';
      if (field.tagName === 'SELECT') {
        field.disabled = !allowEdit;
      } else {
        if (allowEdit) {
          field.removeAttribute('readonly');
          field.disabled = false;
          field.style.background = '';
          field.style.cursor = '';
        } else {
          field.setAttribute('readonly', '');
          field.disabled = mode === 'locked'; // locked: fully disabled; view: readonly
          field.style.background = 'var(--bg)';
          field.style.cursor = 'not-allowed';
        }
      }
      // Locked empty hint
      let hint = fg.querySelector('.stu-fee-lock-hint');
      if (mode === 'locked' && !editMode) {
        // view mode: no extra hint needed beyond badge
      } else if (mode === 'locked') {
        if (!hint) {
          hint = document.createElement('div');
          hint.className = 'stu-fee-lock-hint';
          hint.style.cssText = 'font-size:0.65rem;color:#b45309;margin-top:3px;';
          fg.appendChild(hint);
        }
        hint.textContent = '🔒 Available when Current Year reaches this year (or YEAR BACK)';
      } else if (hint) {
        hint.remove();
      }
    });
  });
}
window.applyStuFeeYearLocks = applyStuFeeYearLocks;

function onStuCurrentYearChange(sel) {
  // Keep schema in sync
  if (typeof stuProfileSchema !== 'undefined' && sel) {
    stuProfileSchema.forEach(sec => {
      (sec.fields || []).forEach(f => {
        if (f.label === 'Current Year') f.value = sel.value;
      });
    });
  }
  applyStuFeeYearLocks(!!window._stuProfileEditEnabled);
}
window.onStuCurrentYearChange = onStuCurrentYearChange;

/* ================================================================
   LIVE SYNC — Render dynamic sections into Student / Staff portals
   ================================================================ */
function renderStuDynamicProfile() {
  const target = document.getElementById('stuDynamicProfileSections');
  if (!target) return;
  // Always paint student portal as view-only. Edit mode is enabled only via
  // submitStuProfileUpdate → enableStuProfileEdit after Admin has not locked it.
  target.innerHTML = renderProfileHTML(stuProfileSchema, true, { forceReadonly: true, liveStudent: true });
  // Re-render restores readonly schema fields — clear edit mode UI state
  window._stuProfileEditEnabled = false;
  applyStuFeeYearLocks(false);
  const banner = document.getElementById('stuProfileEditBanner');
  if (banner) banner.style.display = 'none';
  const btn = document.getElementById('stuProfileUpdateBtn');
  if (btn) {
    btn.textContent = '📝 Request Profile Update';
    btn.classList.remove('gr');
    btn.disabled = false;
    btn.style.opacity = '';
    btn.style.cursor = '';
  }
  if (typeof window.updateStuProfileLockUI === 'function') {
    window.updateStuProfileLockUI();
  }
}

/* ================================================================
   ACTIVITY SYNC ENGINE — Live connection between officer portals and student portal
   ================================================================ */

// Shared in-memory activity database (persists for the session)
window.activityDB = window.activityDB || [];
window.studentRegistrations = window.studentRegistrations || {};

// Seed with some initial data so students see content immediately
(function seedActivityDB() {
  if (window.activityDB.length > 0) return;
  window.activityDB = [
    {
      id: 'seed_pl_1',
      category: 'placement',
      icon: '💼',
      postedBy: 'Placement Cell',
      title: 'Campus Drive — Infosys Ltd. | Registrations Open',
      description: '3rd year students (CSE, ECE) with 60%+ aggregate are eligible. Role: Systems Engineer. Package: ₹3.6 LPA. Bring original marksheets, resume & college ID.',
      date: '15 Mar 2026',
      venue: 'Seminar Hall, Block A',
      actionType: 'register',
      postedOn: '22 Feb 2026',
      responses: 12
    },
    {
      id: 'seed_nss_1',
      category: 'nss',
      icon: '🤝',
      postedBy: 'NSS Officer',
      title: 'NSS Annual Camp — Volunteer Registration Open',
      description: 'Annual 7-day NSS camp at adopted village, Dharwad. March 15–21. NSS volunteers with 50+ hours eligible. Food & transport provided by college.',
      date: '15 Mar 2026',
      venue: 'Adopted Village, Dharwad',
      actionType: 'register',
      postedOn: '20 Feb 2026',
      responses: 28
    },
    {
      id: 'seed_yrc_1',
      category: 'yrc',
      icon: '🏥',
      postedBy: 'YRC Officer',
      title: 'Blood Donation Camp — March 8, 2026',
      description: 'Annual blood donation camp in association with KIMS Blood Bank. All students aged 18+ with good health are eligible. Refreshments provided. Each donor receives certificate.',
      date: '08 Mar 2026',
      venue: 'College Auditorium',
      actionType: 'register',
      postedOn: '18 Feb 2026',
      responses: 45
    },
    {
      id: 'seed_alumni_1',
      category: 'alumni',
      icon: '🎓',
      postedBy: 'Alumni Cell',
      title: 'Industry Talk — CSE Alumni at Infosys & Bosch',
      description: 'Alumni from top companies will share career insights, job market tips and guidance for final year students. Q&A session after the talk. All branches welcome.',
      date: '20 Mar 2026',
      venue: 'Seminar Hall',
      actionType: 'register',
      postedOn: '15 Feb 2026',
      responses: 67
    },
    {
      id: 'seed_sports_1',
      category: 'sports',
      icon: '🏆',
      postedBy: 'Sports Officer',
      title: 'Inter-Polytechnic Athletics Trials — Team Selection',
      description: 'Trials for inter-polytechnic athletics team. Events: 100m, 200m, 400m, Long Jump, High Jump. All branches, 1st–3rd year eligible. Bring sports shoes.',
      date: '28 Mar 2026',
      venue: 'Sports Ground, GPT Hubli',
      actionType: 'register',
      postedOn: '12 Feb 2026',
      responses: 19
    },
    {
      id: 'seed_welfare_1',
      category: 'welfare',
      icon: '🛡️',
      postedBy: 'Student Welfare Office',
      title: 'NSP Scholarship — Last Date Extended to March 15',
      description: 'National Scholarship Portal applications extended to March 15, 2026. SC/ST/OBC students with family income below ₹2.5L are eligible. Required: Aadhaar, income certificate, marksheets.',
      date: '15 Mar 2026',
      venue: 'SWO Office, Room 12',
      actionType: 'acknowledge',
      postedOn: '24 Feb 2026',
      responses: 88
    },
    {
      id: 'seed_sa_1',
      category: 'studentassoc',
      icon: '🤜',
      postedBy: 'Student Association',
      title: 'Tech Fest TechGPT 2026 — Event Registrations Open',
      description: 'Annual Tech Fest April 15–16, 2026. Events: Paper Presentation, Coding Contest, Project Expo, Quiz, Debugging. Cash prizes worth ₹50,000. Teams of 2–4 students.',
      date: '15 Apr 2026',
      venue: 'GPT Campus',
      actionType: 'register',
      postedOn: '28 Feb 2026',
      responses: 134
    }
  ];
})();

// Category metadata
const actCatMeta = {
  placement:    { label: 'Placement',        color: '#1a4fa0', bg: '#e8f0fb', icon: '💼' },
  nss:          { label: 'NSS',              color: '#15803d', bg: '#e6f7ed', icon: '🤝' },
  yrc:          { label: 'Youth Red Cross',  color: '#c0392b', bg: '#fdecea', icon: '🏥' },
  alumni:       { label: 'Alumni',           color: '#3730a3', bg: '#ede9fe', icon: '🎓' },
  sports:       { label: 'Sports',           color: '#065f46', bg: '#d1fae5', icon: '🏆' },
  welfare:      { label: 'Student Welfare',  color: '#7e22ce', bg: '#f3e8ff', icon: '🛡️' },
  studentassoc: { label: 'Student Assoc.',   color: '#4a044e', bg: '#fdf4ff', icon: '🤜' }
};

const actionLabels = {
  register: { btn: '📝 Register', doing: 'Registered', color: '#15803d', bg: '#e6f7ed' },
  acknowledge: { btn: '✅ Mark as Read', doing: 'Read', color: '#1a4fa0', bg: '#e8f0fb' },
  interest: { btn: '⭐ Express Interest', doing: 'Interested', color: '#b45309', bg: '#fef3dc' },
  none: { btn: null, doing: null, color: '', bg: '' }
};

// ---- OFFICER: Post announcement ----
function postActivityAnnouncement(category, icon, postedBy) {
  const prefix = category === 'studentassoc' ? 'sa' : category;
  const title = document.getElementById(prefix + '_post_title')?.value.trim();
  const desc = document.getElementById(prefix + '_post_desc')?.value.trim();
  const dateEl = document.getElementById(prefix + '_post_date');
  const venueEl = document.getElementById(prefix + '_post_venue');
  const actionEl = document.getElementById(prefix + '_post_action');
  const feedbackEl = document.getElementById(prefix + '_post_feedback');
  const listEl = document.getElementById(prefix + '_posted_list');

  if (!title || !desc) {
    if (feedbackEl) feedbackEl.innerHTML = '<span style="color:var(--red);">⚠️ Title and Description are required.</span>';
    return;
  }

  const dateStr = dateEl?.value ? new Date(dateEl.value).toLocaleDateString('en-IN', {day:'2-digit',month:'short',year:'numeric'}) : '—';
  const venue = venueEl?.value.trim() || '—';
  const actionType = actionEl?.value || 'register';
  const now = new Date();
  const postedOn = now.toLocaleDateString('en-IN', {day:'2-digit',month:'short',year:'numeric'});

  const post = {
    id: 'post_' + Date.now(),
    category, icon, postedBy, title,
    description: desc,
    date: dateStr,
    venue,
    actionType,
    postedOn,
    responses: 0
  };

  window.activityDB.unshift(post);

  // Feedback on officer side
  if (feedbackEl) feedbackEl.innerHTML = '<span style="color:var(--green);">✅ Posted successfully! Students can now see this in their portal.</span>';

  // Refresh officer posted list
  if (listEl) refreshOfficerPostedList(category, listEl);

  // Clear form
  if (document.getElementById(prefix + '_post_title')) document.getElementById(prefix + '_post_title').value = '';
  if (document.getElementById(prefix + '_post_desc')) document.getElementById(prefix + '_post_desc').value = '';

  // Refresh student view if visible
  renderStudentActivityFeed();
  // Refresh alumni member notifications if this is an alumni post
  if (category === 'alumni') stuRenderAlumniMemberNotifs();

  // Show WhatsApp notification modal
  showWPNotifModal(post);
}

function refreshOfficerPostedList(category, container) {
  var posts = window.activityDB.filter(function(p){ return p.category === category; });
  if (!posts.length) {
    container.innerHTML = '<div style="font-size:0.75rem;color:var(--text-muted);padding:10px 0;">No announcements posted yet.</div>';
    return;
  }
  var catColor = (actCatMeta[category] && actCatMeta[category].color) || '#1a4fa0';
  var html = '';
  posts.forEach(function(p) {
    var plural = p.responses !== 1 ? 's' : '';
    html += '<div style="display:flex;align-items:flex-start;gap:10px;padding:10px 14px;background:var(--bg);border-radius:8px;margin-bottom:8px;border-left:3px solid ' + catColor + ';">';
    html += '<div style="flex:1;">';
    html += '<div style="font-weight:700;font-size:0.8rem;color:var(--navy);">' + p.title + '</div>';
    html += '<div style="font-size:0.7rem;color:var(--text-muted);margin-top:3px;">Date: ' + p.date + ' | Venue: ' + p.venue + ' | ' + p.responses + ' student' + plural + ' responded</div>';
    html += '</div>';
    html += '<button onclick="deleteActivityPost(event,&apos;' + p.id + '&apos;)" style="background:var(--red-light);color:var(--red);border:none;border-radius:6px;padding:4px 10px;font-size:0.68rem;cursor:pointer;font-weight:700;flex-shrink:0;">Remove</button>';
    html += '</div>';
  });
  container.innerHTML = html;
}
function deleteActivityPost(evt, id) { if(evt) evt.stopPropagation();
  window.activityDB = window.activityDB.filter(p => p.id !== id);
  renderStudentActivityFeed();
  // refresh all officer lists
  const cats = ['placement','nss','yrc','alumni','sports','welfare','studentassoc'];
  cats.forEach(cat => {
    const prefix = cat === 'studentassoc' ? 'sa' : cat;
    const el = document.getElementById(prefix + '_posted_list');
    if (el) refreshOfficerPostedList(cat, el);
  });
}

// ---- STUDENT: Render activity feed ----
let currentActivityFilter = 'all';

function filterActivityFeed(cat, btn) {
  currentActivityFilter = cat;
  document.querySelectorAll('[id^="iaFilter"]').forEach(b => b.classList.remove('act'));
  if (btn) btn.classList.add('act');
  renderStudentActivityFeed();
}

function renderStudentActivityFeed() {
  const feed = document.getElementById('stuActivityFeed');
  const cal = document.getElementById('stuActivityCalendar');
  if (!feed) return;

  const filtered = currentActivityFilter === 'all'
    ? window.activityDB
    : window.activityDB.filter(p => p.category === currentActivityFilter);

  if (!filtered.length) {
    feed.innerHTML = `<div style="text-align:center;padding:48px;color:var(--text-muted);background:white;border-radius:12px;border:1px solid var(--border);">
      <div style="font-size:2.5rem;margin-bottom:10px;">🔔</div>
      <div style="font-weight:700;font-size:0.9rem;">No announcements yet</div>
      <p style="font-size:0.75rem;margin-top:6px;">Officers haven't posted any updates for this category yet.</p>
    </div>`;
  } else {
    feed.innerHTML = filtered.map(p => renderActivityCard(p)).join('');
  }

  // Render calendar
  if (cal) {
    const calItems = window.activityDB.slice().sort(function(a,b){ return a.date > b.date ? 1 : -1; }).slice(0,10);
    var calRows = '';
    calItems.forEach(function(p) {
      var meta = actCatMeta[p.category] || {};
      var reg = window.studentRegistrations[p.id];
      var statusCell = reg
        ? '<span class="badge approved">\u2705 ' + (actionLabels[p.actionType] && actionLabels[p.actionType].doing || 'Done') + '</span>'
        : '<span class="badge active">Open</span>';
      var actionCell = '—';
      if (p.actionType !== 'none' && !reg) {
        var btnLabel = actionLabels[p.actionType] && actionLabels[p.actionType].btn || 'Respond';
        var btnColor = (actCatMeta[p.category] && actCatMeta[p.category].color) || '#1a4fa0';
        actionCell = '<button onclick="studentRespond(\'' + p.id + '\')" style="padding:4px 12px;background:' + btnColor + ';color:white;border:none;border-radius:6px;font-size:0.7rem;font-weight:700;cursor:pointer;">' + btnLabel + '</button>';
      } else if (reg) {
        actionCell = '<span style="font-size:0.7rem;color:var(--green);font-weight:700;">\u2714 Done</span>';
      }
      calRows += '<tr>'
        + '<td><strong>' + p.title + '</strong></td>'
        + '<td><span style="background:' + meta.bg + ';color:' + meta.color + ';padding:2px 8px;border-radius:12px;font-size:0.68rem;font-weight:700;">' + (meta.label || p.category) + '</span></td>'
        + '<td style="font-family:\'JetBrains Mono\',monospace;font-size:0.72rem;">' + p.date + '</td>'
        + '<td style="font-size:0.75rem;">' + p.venue + '</td>'
        + '<td>' + statusCell + '</td>'
        + '<td>' + actionCell + '</td>'
        + '</tr>';
    });
    cal.innerHTML = calRows || '<tr><td colspan="6" style="text-align:center;padding:24px;color:var(--text-muted);font-size:0.8rem;">No upcoming events.</td></tr>';
  }

  renderMyRegistrations();
}

function renderActivityCard(p) {
  var meta = actCatMeta[p.category] || {};
  var actionInfo = actionLabels[p.actionType] || actionLabels.none;
  var isRegistered = window.studentRegistrations[p.id];
  var metaColor = meta.color || '#1a4fa0';
  var metaBg = meta.bg || '#e8f0fb';
  var plural = p.responses !== 1 ? 's' : '';

  var registeredBadge = isRegistered
    ? '<span style="background:' + metaColor + ';color:white;padding:4px 12px;border-radius:20px;font-size:0.68rem;font-weight:700;flex-shrink:0;">&#x2705; ' + (actionInfo.doing || 'Responded') + '</span>'
    : '';

  var actionBtn = '';
  if (p.actionType !== 'none') {
    if (isRegistered) {
      actionBtn = '<button disabled style="padding:9px 20px;background:#e6f7ed;color:var(--green);border:none;border-radius:8px;font-weight:700;font-size:0.8rem;cursor:not-allowed;">&#x2705; ' + (actionInfo.doing || 'Done') + ' Successfully</button>';
    } else {
      actionBtn = '<button onclick="studentRespond(\'' + p.id + '\')" style="padding:9px 20px;background:' + metaColor + ';color:white;border:none;border-radius:8px;font-weight:700;font-size:0.8rem;cursor:pointer;">' + (actionInfo.btn || 'Respond') + '</button>';
    }
  }

  return '<div style="background:white;border-radius:14px;border:1px solid var(--border);margin-bottom:14px;overflow:hidden;box-shadow:var(--shadow-sm);">'
    + '<div style="background:' + metaBg + ';padding:12px 18px;display:flex;align-items:center;gap:10px;border-bottom:2px solid ' + metaColor + ';">'
    + '<span style="font-size:1.4rem;">' + p.icon + '</span>'
    + '<div style="flex:1;">'
    + '<div style="font-size:0.68rem;font-weight:800;text-transform:uppercase;letter-spacing:0.08em;color:' + metaColor + ';font-family:\'JetBrains Mono\',monospace;">' + (meta.label || p.category) + ' &middot; ' + p.postedBy + '</div>'
    + '<div style="font-weight:700;font-size:0.9rem;color:var(--navy);margin-top:2px;">' + p.title + '</div>'
    + '</div>'
    + registeredBadge
    + '</div>'
    + '<div style="padding:14px 18px;">'
    + '<p style="font-size:0.82rem;color:var(--text);line-height:1.6;margin-bottom:12px;">' + p.description + '</p>'
    + '<div style="display:flex;flex-wrap:wrap;gap:14px;font-size:0.72rem;color:var(--text-muted);margin-bottom:14px;">'
    + '<span>&#128197; <strong>' + p.date + '</strong></span>'
    + '<span>&#128205; <strong>' + p.venue + '</strong></span>'
    + '<span>&#128101; <strong>' + p.responses + '</strong> student' + plural + ' responded</span>'
    + '<span style="margin-left:auto;font-family:\'JetBrains Mono\',monospace;">Posted ' + p.postedOn + '</span>'
    + '</div>'
    + '<div style="display:flex;gap:8px;align-items:center;">'
    + actionBtn
    + '<button onclick="showActivityDetail(\'' + p.id + '\')" style="padding:9px 16px;background:var(--bg);color:var(--text-muted);border:1.5px solid var(--border);border-radius:8px;font-size:0.78rem;font-weight:600;cursor:pointer;">More Info</button>'
    + '</div>'
    + '</div>'
    + '</div>';
}
function studentRespond(postId) {
  const post = window.activityDB.find(p => p.id === postId);
  if (!post) return;
  const actionInfo = actionLabels[post.actionType] || actionLabels.register;
  const meta = actCatMeta[post.category] || {};

  // Confirmation
  const confirmed = window.confirm(`${actionInfo.btn} for:\n\n"${post.title}"\n\n📅 ${post.date}  |  📍 ${post.venue}\n\nConfirm?`);
  if (!confirmed) return;

  window.studentRegistrations[postId] = {
    postId,
    title: post.title,
    category: post.category,
    action: post.actionType,
    actionLabel: actionInfo.doing,
    date: post.date,
    venue: post.venue,
    registeredOn: new Date().toLocaleDateString('en-IN', {day:'2-digit',month:'short',year:'numeric'})
  };
  post.responses++;

  renderStudentActivityFeed();
  renderMyRegistrations();

  // Notification badge update
  const nbDot = document.querySelector('.nb-dot');
  if (nbDot) nbDot.textContent = String(Number(nbDot.textContent||0) + 1);
}

function showActivityDetail(postId) {
  const post = window.activityDB.find(p => p.id === postId);
  if (!post) return;
  const meta = actCatMeta[post.category] || {};
  alert(`${post.icon} ${meta.label||post.category} — ${post.postedBy}\n\n📌 ${post.title}\n\n${post.description}\n\n📅 Date: ${post.date}\n📍 Venue: ${post.venue}\n👥 ${post.responses} students responded\n\nPosted on: ${post.postedOn}`);
}

function renderMyRegistrations() {
  const el = document.getElementById('stuMyRegistrations');
  if (!el) return;
  const regs = Object.values(window.studentRegistrations);
  if (!regs.length) {
    el.innerHTML = '<div style="text-align:center;padding:24px;color:var(--text-muted);font-size:0.82rem;">No registrations yet. Register for activities above.</div>';
    return;
  }
  el.innerHTML = `<div style="padding:0 14px;">` + regs.map(r => {
    const meta = actCatMeta[r.category] || {};
    return `<div style="display:flex;align-items:center;gap:12px;padding:12px 4px;border-bottom:1px solid var(--border-light);">
      <div style="width:38px;height:38px;border-radius:9px;background:${meta.bg};display:flex;align-items:center;justify-content:center;font-size:1.1rem;flex-shrink:0;">${meta.icon||'📌'}</div>
      <div style="flex:1;">
        <div style="font-weight:700;font-size:0.82rem;color:var(--navy);">${r.title}</div>
        <div style="font-size:0.7rem;color:var(--text-muted);margin-top:2px;">📅 ${r.date} &nbsp;·&nbsp; 📍 ${r.venue} &nbsp;·&nbsp; Registered ${r.registeredOn}</div>
      </div>
      <span style="background:${meta.bg};color:${meta.color};padding:3px 10px;border-radius:20px;font-size:0.68rem;font-weight:700;flex-shrink:0;">✅ ${r.actionLabel}</span>
    </div>`;
  }).join('') + `</div>`;
}

// Auto-render when student portal loads the activities section
const _origShowSec = window.showSec;
window.showSec = function(id, el) {
  if (_origShowSec) _origShowSec(id, el);
  if (id === 'stuInstActivities') {
    setTimeout(renderStudentActivityFeed, 50);
    setTimeout(stuRefreshAlumniStatus, 80);
    setTimeout(stuRenderAlumniCommittee, 100);
    setTimeout(stuRenderAlumniDonation, 110);
    setTimeout(stuRenderAlumniMemberNotifs, 120);
  }
};

// Also refresh officer posted lists when officer sections open
document.addEventListener('click', function(e) {
  const sl = e.target.closest('.sl[data-fac]');
  if (!sl) return;
  const fac = sl.getAttribute('data-fac');
  const cats = ['placement','nss','yrc','alumni','sports','welfare','studentassoc'];
  cats.forEach(cat => {
    const prefix = cat === 'studentassoc' ? 'sa' : cat;
    const el = document.getElementById(prefix + '_posted_list');
    if (el) refreshOfficerPostedList(cat, el);
  });
});

// ================================================================
//  WHATSAPP NOTIFICATION ENGINE
// ================================================================
var _wpCurrentPost = null;

function showWPNotifModal(post) {
  _wpCurrentPost = post;
  var meta = actCatMeta[post.category] || {};
  var catLabel = meta.label || post.category;
  var actionLine = '';
  if (post.actionType === 'register') actionLine = 'Register now in your Student Portal under Institute Activities.';
  else if (post.actionType === 'acknowledge') actionLine = 'Please read and acknowledge this in your Student Portal.';
  else if (post.actionType === 'interest') actionLine = 'Express your interest in your Student Portal.';

  var msg = '*[' + catLabel + ' - 171 Government Polytechnic Hubli]*\n\n'
    + '&#128204; *' + post.title + '*\n\n'
    + post.description + '\n\n'
    + '&#128197; *Date:* ' + post.date + '\n'
    + '&#128205; *Venue:* ' + post.venue + '\n\n'
    + (actionLine ? '&#128073; ' + actionLine + '\n\n' : '')
    + 'Login: Student Portal &#8594; Institute Activities\n'
    + '&#8195;_Posted by: ' + post.postedBy + ' | ' + post.postedOn + '_';

  var preview = document.getElementById('wpMsgPreview');
  if (preview) preview.textContent = msg.replace(/&#128204;/g,'📌').replace(/&#128197;/g,'📅').replace(/&#128205;/g,'📍').replace(/&#128073;/g,'👉').replace(/&#8594;/g,'→').replace(/&#8195;/g,' ');
  var modal = document.getElementById('wpNotifModal');
  if (modal) modal.style.display = 'flex';
  var sentEl = document.getElementById('wpSentConfirm');
  if (sentEl) sentEl.style.display = 'none';
}

function closeWPModal() {
  var modal = document.getElementById('wpNotifModal');
  if (modal) modal.style.display = 'none';
  _wpCurrentPost = null;
}

function openWhatsApp() {
  if (!_wpCurrentPost) return;
  var meta = actCatMeta[_wpCurrentPost.category] || {};
  var catLabel = meta.label || _wpCurrentPost.category;
  var actionLine = '';
  if (_wpCurrentPost.actionType === 'register') actionLine = 'Register now in Student Portal > Institute Activities.';
  else if (_wpCurrentPost.actionType === 'acknowledge') actionLine = 'Please read and acknowledge in Student Portal.';
  else if (_wpCurrentPost.actionType === 'interest') actionLine = 'Express your interest in Student Portal.';

  var msg = '[' + catLabel + ' - 171 Government Polytechnic Hubli]\n\n'
    + _wpCurrentPost.title + '\n\n'
    + _wpCurrentPost.description + '\n\n'
    + 'Date: ' + _wpCurrentPost.date + '\n'
    + 'Venue: ' + _wpCurrentPost.venue + '\n\n'
    + (actionLine ? actionLine + '\n\n' : '')
    + 'Login: Student Portal -> Institute Activities\n'
    + 'Posted by: ' + _wpCurrentPost.postedBy;

  var encoded = encodeURIComponent(msg);
  window.open('https://wa.me/?text=' + encoded, '_blank');
  var sentEl = document.getElementById('wpSentConfirm');
  if (sentEl) sentEl.style.display = 'block';
}

// ================================================================
//  ALUMNI MEMBER DATABASE
// ================================================================
window.alumniMembersDB = window.alumniMembersDB || [];
window.alumniPendingRequests = window.alumniPendingRequests || [];
window._alFetchedStudent = null;

// Officer: fetch student from DB by reg no
function alFetchStudent() {
  var regNo = (document.getElementById('alAddRegNo').value || '').trim().toUpperCase();
  var preview = document.getElementById('alFetchedPreview');
  var errEl  = document.getElementById('alFetchError');
  preview.style.display = 'none';
  errEl.style.display   = 'none';
  window._alFetchedStudent = null;

  if (!regNo) { errEl.style.display = 'block'; errEl.textContent = 'Please enter a register number first.'; return; }

  var stu = students[regNo];
  if (!stu) { errEl.style.display = 'block'; errEl.textContent = 'Register number "' + regNo + '" not found in student database.'; return; }

  window._alFetchedStudent = { regNo: regNo, ...stu };
  document.getElementById('alPrevName').textContent   = stu.name   || '-';
  document.getElementById('alPrevDept').textContent   = stu.dept   || '-';
  document.getElementById('alPrevYear').textContent   = stu.year   || '-';
  document.getElementById('alPrevCGPA').textContent   = stu.cgpa   || '-';
  document.getElementById('alPrevAtt').textContent    = stu.att    || '-';
  document.getElementById('alPrevFather').textContent = stu.father || '-';
  preview.style.display = 'block';
}

// Officer: submit add member form
function alSubmitAddMember() {
  var fb = document.getElementById('alAddFeedback');
  if (!window._alFetchedStudent) { fb.innerHTML = '<span style="color:var(--red);">&#9888; Please fetch a valid student first.</span>'; return; }
  var receiptNo = (document.getElementById('alAddReceiptNo').value || '').trim();
  var status    = (document.getElementById('alAddStatus').value    || '').trim();
  var remarks   = (document.getElementById('alAddRemarks').value   || '').trim();
  if (!receiptNo) { fb.innerHTML = '<span style="color:var(--red);">&#9888; Receipt Number is required.</span>'; return; }
  if (!status)    { fb.innerHTML = '<span style="color:var(--red);">&#9888; Alumni Status is required.</span>'; return; }

  // Check duplicate
  var exists = window.alumniMembersDB.find(function(m){ return m.regNo === window._alFetchedStudent.regNo; });
  if (exists) { fb.innerHTML = '<span style="color:var(--red);">&#9888; This student is already in the alumni register.</span>'; return; }

  var now = new Date();
  var dateStr = now.toLocaleDateString('en-IN', {day:'2-digit', month:'short', year:'numeric'});

  var member = {
    regNo:     window._alFetchedStudent.regNo,
    name:      window._alFetchedStudent.name,
    dept:      window._alFetchedStudent.dept,
    year:      window._alFetchedStudent.year,
    cgpa:      window._alFetchedStudent.cgpa,
    father:    window._alFetchedStudent.father,
    receiptNo: receiptNo,
    status:    status,
    remarks:   remarks,
    dateAdded: dateStr,
    addedBy:   'Alumni Officer'
  };

  window.alumniMembersDB.push(member);

  // Also resolve any pending request for same reg no
  window.alumniPendingRequests = window.alumniPendingRequests.filter(function(r){ return r.regNo !== member.regNo; });
  renderAlPendingBadge();

  fb.innerHTML = '<span style="color:var(--green);">&#10003; ' + member.name + ' (' + member.regNo + ') added to alumni register successfully!</span>';
  alClearAddForm();
  renderAlAllMembers();
}

function alClearAddForm() {
  ['alAddRegNo','alAddReceiptNo','alAddStatus','alAddRemarks'].forEach(function(id){
    var el = document.getElementById(id); if(el) el.value = '';
  });
  document.getElementById('alFetchedPreview').style.display = 'none';
  document.getElementById('alFetchError').style.display     = 'none';
  window._alFetchedStudent = null;
}

// Officer: render All Members table
function renderAlAllMembers(filter) {
  var tbody = document.getElementById('alMembersTableBody');
  var emptyEl = document.getElementById('alMembersEmpty');
  var countEl = document.getElementById('alMemberCount');
  if (!tbody) return;

  window.alumniMembersDB = window.alumniMembersDB || [];
  var list = window.alumniMembersDB;
  if (filter) {
    var q = filter.toLowerCase();
    list = list.filter(function(m){ return (m.name+m.regNo+m.dept+m.status+m.receiptNo).toLowerCase().includes(q); });
  }

  if (countEl) countEl.textContent = list.length + ' member' + (list.length !== 1 ? 's' : '');

  if (!list.length) {
    tbody.innerHTML = '';
    if (emptyEl) emptyEl.style.display = 'block';
    return;
  }
  if (emptyEl) emptyEl.style.display = 'none';

  tbody.innerHTML = list.map(function(m, idx) {
    return '<tr>'
      + '<td style="font-family:JetBrains Mono,monospace;font-size:0.7rem;">' + m.regNo + '</td>'
      + '<td><strong>' + m.name + '</strong></td>'
      + '<td style="font-size:0.75rem;">' + m.dept + '</td>'
      + '<td style="font-family:JetBrains Mono,monospace;font-size:0.7rem;">' + m.receiptNo + '</td>'
      + '<td><span class="badge approved" style="font-size:0.65rem;">' + m.status + '</span></td>'
      + '<td style="font-size:0.72rem;color:var(--text-muted);">' + (m.remarks || '—') + '</td>'
      + '<td style="font-family:JetBrains Mono,monospace;font-size:0.68rem;">' + m.dateAdded + '</td>'
      + '<td><button class="btn re" style="font-size:0.68rem;padding:4px 10px;" onclick="alRemoveMember(' + idx + ')">Remove</button></td>'
      + '</tr>';
  }).join('');
}

function alRemoveMember(idx) {
  if (!confirm('Remove this alumni member from the register?')) return;
  window.alumniMembersDB.splice(idx, 1);
  renderAlAllMembers();
}

function alSearchMembers(q) { renderAlAllMembers(q); }

// Officer: render Pending Requests table
function renderAlPending() {
  var tbody   = document.getElementById('alPendingTableBody');
  var emptyEl = document.getElementById('alPendingEmpty');
  if (!tbody) return;

  var list = window.alumniPendingRequests;
  if (!list.length) {
    tbody.innerHTML = '';
    if (emptyEl) emptyEl.style.display = 'block';
    return;
  }
  if (emptyEl) emptyEl.style.display = 'none';

  tbody.innerHTML = list.map(function(r, idx) {
    return '<tr>'
      + '<td style="font-family:JetBrains Mono,monospace;font-size:0.7rem;">' + r.regNo + '</td>'
      + '<td><strong>' + r.name + '</strong></td>'
      + '<td style="font-size:0.75rem;">' + r.dept + '</td>'
      + '<td style="font-family:JetBrains Mono,monospace;font-size:0.7rem;">' + r.receiptNo + '</td>'
      + '<td style="font-family:JetBrains Mono,monospace;font-size:0.68rem;">' + r.requestedOn + '</td>'
      + '<td style="display:flex;gap:6px;">'
      + '<button class="btn gr" style="font-size:0.68rem;padding:4px 10px;" onclick="alApproveRequest(' + idx + ')">&#10003; Approve</button>'
      + '<button class="btn re" style="font-size:0.68rem;padding:4px 10px;" onclick="alRejectRequest(' + idx + ')">&#10005; Reject</button>'
      + '</td></tr>';
  }).join('');

  renderAlPendingBadge();
}

function renderAlPendingBadge() {
  var badge = document.getElementById('alPendingBadge');
  var count = window.alumniPendingRequests.length;
  if (!badge) return;
  if (count > 0) { badge.style.display = 'inline'; badge.textContent = count; }
  else           { badge.style.display = 'none'; }
}

function alApproveRequest(idx) {
  var req = window.alumniPendingRequests[idx];
  if (!req) return;

  // Check not already member
  var exists = window.alumniMembersDB.find(function(m){ return m.regNo === req.regNo; });
  if (!exists) {
    var now = new Date();
    window.alumniMembersDB.push({
      regNo:     req.regNo,
      name:      req.name,
      dept:      req.dept,
      year:      req.year || '-',
      cgpa:      req.cgpa || '-',
      father:    req.father || '-',
      receiptNo: req.receiptNo,
      status:    'Active Member',
      remarks:   'Self-registered, approved by officer',
      dateAdded: now.toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'numeric'}),
      addedBy:   'Alumni Officer (Approved)'
    });
  }

  // Mark approved in student-facing state
  window.alumniRequestStatus[req.regNo] = 'approved';

  window.alumniPendingRequests.splice(idx, 1);
  renderAlPending();
  renderAlAllMembers();
  alert('&#10003; Request approved! ' + req.name + ' is now a registered alumni member.');
}

function alRejectRequest(idx) {
  var req = window.alumniPendingRequests[idx];
  if (!req) return;
  if (!confirm('Reject alumni request from ' + req.name + '?')) return;
  window.alumniRequestStatus[req.regNo] = 'rejected';
  window.alumniPendingRequests.splice(idx, 1);
  renderAlPending();
  // Refresh student-side status if visible
  stuRefreshAlumniStatus();
}

// ================================================================
//  STUDENT: Alumni Join Request
// ================================================================
window.alumniRequestStatus = window.alumniRequestStatus || {};  // regNo -> 'pending'|'approved'|'rejected'
var STU_REG_NO = ''; // Currently logged-in student reg no (updated by legacy-bridge.js on login)

function stuSubmitAlumniRequest() {
  var receiptInput = document.getElementById('stuAlumniReceiptInput');
  var fb = document.getElementById('stuAlumniFeedback');
  var receiptNo = (receiptInput ? receiptInput.value.trim() : '');
  if (!receiptNo) { if(fb) fb.innerHTML = '<span style="color:var(--red);">&#9888; Please enter your Receipt Number.</span>'; return; }

  // Check if already member
  var isMember = window.alumniMembersDB.find(function(m){ return m.regNo === STU_REG_NO; });
  if (isMember) { stuRefreshAlumniStatus(); return; }

  // Check duplicate pending
  var alreadyPending = window.alumniPendingRequests.find(function(r){ return r.regNo === STU_REG_NO; });
  if (alreadyPending) { if(fb) fb.innerHTML = '<span style="color:#b45309;">&#9203; Your request is already pending with the Alumni Officer.</span>'; return; }

  var stu = students[STU_REG_NO] || { name: 'Student', dept: '-', year: '-', cgpa: '-', father: '-' };
  var now = new Date();
  var req = {
    regNo:       STU_REG_NO,
    name:        stu.name,
    dept:        stu.dept,
    year:        stu.year,
    cgpa:        stu.cgpa,
    father:      stu.father,
    receiptNo:   receiptNo,
    requestedOn: now.toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'numeric'})
  };
  window.alumniPendingRequests.push(req);
  window.alumniRequestStatus[STU_REG_NO] = 'pending';
  renderAlPendingBadge();

  if(fb) fb.innerHTML = '';
  stuRefreshAlumniStatus();
}

function stuRefreshAlumniStatus() {
  var statusEl = document.getElementById('stuAlumniStatus');
  var formEl   = document.getElementById('stuAlumniForm');
  if (!statusEl) return;

  var isMember = window.alumniMembersDB.find(function(m){ return m.regNo === STU_REG_NO; });
  var reqStatus = window.alumniRequestStatus[STU_REG_NO];

  if (isMember) {
    statusEl.style.display = 'block';
    statusEl.innerHTML = '<div style="background:#e6f7ed;border:1.5px solid #86efac;border-radius:10px;padding:16px 18px;">'
      + '<div style="font-weight:800;font-size:0.95rem;color:var(--green);margin-bottom:6px;">&#10003; You are a Registered Alumni Member</div>'
      + '<div style="font-size:0.78rem;color:var(--text);line-height:1.8;">'
      + '<strong>Name:</strong> ' + isMember.name + ' &nbsp;|&nbsp; '
      + '<strong>Receipt No.:</strong> <span style="font-family:JetBrains Mono,monospace;">' + isMember.receiptNo + '</span><br>'
      + '<strong>Status:</strong> ' + isMember.status + ' &nbsp;|&nbsp; '
      + '<strong>Date:</strong> ' + isMember.dateAdded
      + '</div></div>';
    if (formEl) formEl.style.display = 'none';
  } else if (reqStatus === 'pending') {
    statusEl.style.display = 'block';
    statusEl.innerHTML = '<div style="background:#fef9c3;border:1.5px solid #fde047;border-radius:10px;padding:16px 18px;">'
      + '<div style="font-weight:800;color:#b45309;margin-bottom:4px;">&#9203; Request Sent — Awaiting Alumni Officer Approval</div>'
      + '<div style="font-size:0.78rem;color:var(--text);">Your receipt has been submitted. The Alumni Officer will review and approve your membership. Please check back later.</div>'
      + '</div>';
    if (formEl) formEl.style.display = 'none';
  } else if (reqStatus === 'rejected') {
    statusEl.style.display = 'block';
    statusEl.innerHTML = '<div style="background:#fee2e2;border:1.5px solid #fca5a5;border-radius:10px;padding:16px 18px;">'
      + '<div style="font-weight:800;color:var(--red);margin-bottom:4px;">&#10005; Request Rejected</div>'
      + '<div style="font-size:0.78rem;color:var(--text);">Your alumni membership request was not approved. Please contact the Alumni Officer for details.</div>'
      + '</div>';
    if (formEl) formEl.style.display = 'block';
    // reset so they can resubmit
    delete window.alumniRequestStatus[STU_REG_NO];
  } else {
    statusEl.style.display = 'none';
    if (formEl) formEl.style.display = 'block';
  }
  // Always refresh live student sections
  stuRenderAlumniCommittee();
  stuRenderAlumniDonation();
  stuRenderAlumniMemberNotifs();
}


// ================================================================
//  ALUMNI COMMITTEE DB
// ================================================================
window.alumniCommitteeDB = window.alumniCommitteeDB || [];

function alAddCommitteeMember() {
  var fb = document.getElementById('alCmtFeedback');
  var name    = (document.getElementById('alCmtName').value    || '').trim();
  var desig   = (document.getElementById('alCmtDesig').value   || '').trim();
  var role    = (document.getElementById('alCmtRole').value    || '').trim();
  var contact = (document.getElementById('alCmtContact').value || '').trim();
  if (!name || !desig || !role || !contact) {
    fb.innerHTML = '<span style="color:var(--red);">&#9888; All fields are required.</span>';
    return;
  }
  window.alumniCommitteeDB.push({ name: name, desig: desig, role: role, contact: contact });
  fb.innerHTML = '<span style="color:var(--green);">&#10003; ' + name + ' added to committee.</span>';
  alClearCmtForm();
  renderAlCommitteeTable();
  stuRenderAlumniCommittee(); // sync to student portal
}

function alClearCmtForm() {
  ['alCmtName','alCmtDesig','alCmtRole','alCmtContact'].forEach(function(id){
    var el = document.getElementById(id); if(el) el.value = '';
  });
}

function renderAlCommitteeTable() {
  var tbody   = document.getElementById('alCommitteeTableBody');
  var emptyEl = document.getElementById('alCommitteeEmpty');
  if (!tbody) return;
  var list = window.alumniCommitteeDB;
  if (!list.length) {
    tbody.innerHTML = '';
    if (emptyEl) emptyEl.style.display = 'block';
    return;
  }
  if (emptyEl) emptyEl.style.display = 'none';
  tbody.innerHTML = list.map(function(m, i) {
    return '<tr>'
      + '<td style="font-weight:700;color:var(--text-muted);font-size:0.75rem;">' + (i+1) + '</td>'
      + '<td><strong>' + m.name + '</strong></td>'
      + '<td style="font-size:0.78rem;">' + m.desig + '</td>'
      + '<td><span class="badge info" style="font-size:0.65rem;">' + m.role + '</span></td>'
      + '<td style="font-family:JetBrains Mono,monospace;font-size:0.72rem;">' + m.contact + '</td>'
      + '<td><button class="btn re" style="font-size:0.68rem;padding:4px 10px;" onclick="alDeleteCommitteeMember(' + i + ')">Remove</button></td>'
      + '</tr>';
  }).join('');
}

function alDeleteCommitteeMember(idx) {
  if (!confirm('Remove ' + window.alumniCommitteeDB[idx].name + ' from committee?')) return;
  window.alumniCommitteeDB.splice(idx, 1);
  renderAlCommitteeTable();
  stuRenderAlumniCommittee();
}

// ── Student portal: render committee ────────────────────────���────
function stuRenderAlumniCommittee() {
  var body = document.getElementById('stuAlumniCommitteeBody');
  if (!body) return;
  var list = window.alumniCommitteeDB || [];
  if (!list.length) {
    body.innerHTML = '<div style="padding:24px;text-align:center;color:var(--text-muted);font-size:0.8rem;">Alumni Committee details will appear here once published by the Alumni Officer.</div>';
    return;
  }
  var html = '<div style="overflow-x:auto;"><table><thead><tr><th>#</th><th>Name</th><th>Designation</th><th>Committee Role</th><th>Contact</th></tr></thead><tbody>';
  list.forEach(function(m, i) {
    html += '<tr>'
      + '<td style="font-weight:700;color:var(--text-muted);">' + (i+1) + '</td>'
      + '<td><strong>' + m.name + '</strong></td>'
      + '<td style="font-size:0.78rem;">' + m.desig + '</td>'
      + '<td><span class="badge info" style="font-size:0.65rem;">' + m.role + '</span></td>'
      + '<td style="font-family:JetBrains Mono,monospace;font-size:0.72rem;">' + m.contact + '</td>'
      + '</tr>';
  });
  html += '</tbody></table></div>';
  body.innerHTML = html;
}

// ================================================================
//  ALUMNI DONATION DB
// ================================================================
window.alumniDonationData = window.alumniDonationData || null;

function alLoadQR(input) {
  var file = input.files[0];
  if (!file) return;
  var reader = new FileReader();
  reader.onload = function(e) {
    var img = document.getElementById('alDonQRImg');
    var preview = document.getElementById('alDonQRPreview');
    if (img) img.src = e.target.result;
    if (preview) preview.style.display = 'block';
    window._alQRBase64 = e.target.result;
  };
  reader.readAsDataURL(file);
}

function alRemoveQR() {
  var preview = document.getElementById('alDonQRPreview');
  var img = document.getElementById('alDonQRImg');
  var input = document.getElementById('alDonQRInput');
  if (img) img.src = '';
  if (preview) preview.style.display = 'none';
  if (input) input.value = '';
  window._alQRBase64 = null;
}

function alLoadDonationForm() {
  // Populate form if data already saved
  var d = window.alumniDonationData;
  if (!d) return;
  ['alDonTitle','alDonUPI','alDonBank','alDonAccNo','alDonIFSC','alDonAccName','alDonDesc'].forEach(function(id){
    var el = document.getElementById(id);
    if (el && d[id.replace('alDon','').toLowerCase()]) el.value = d[id.replace('alDon','').toLowerCase()] || '';
  });
  // Easier: set each field by key
  if (document.getElementById('alDonTitle'))   document.getElementById('alDonTitle').value   = d.title   || '';
  if (document.getElementById('alDonUPI'))     document.getElementById('alDonUPI').value     = d.upi     || '';
  if (document.getElementById('alDonBank'))    document.getElementById('alDonBank').value    = d.bank    || '';
  if (document.getElementById('alDonAccNo'))   document.getElementById('alDonAccNo').value   = d.accNo   || '';
  if (document.getElementById('alDonIFSC'))    document.getElementById('alDonIFSC').value    = d.ifsc    || '';
  if (document.getElementById('alDonAccName')) document.getElementById('alDonAccName').value = d.accName || '';
  if (document.getElementById('alDonDesc'))    document.getElementById('alDonDesc').value    = d.desc    || '';
  if (d.qr) {
    var img = document.getElementById('alDonQRImg');
    var prev = document.getElementById('alDonQRPreview');
    if (img) img.src = d.qr;
    if (prev) prev.style.display = 'block';
    window._alQRBase64 = d.qr;
  }
}

function alSaveDonation() {
  var fb = document.getElementById('alDonFeedback');
  var title   = (document.getElementById('alDonTitle').value   || '').trim();
  var upi     = (document.getElementById('alDonUPI').value     || '').trim();
  if (!title || !upi) {
    fb.innerHTML = '<span style="color:var(--red);">&#9888; Title and UPI ID are required.</span>';
    return;
  }
  window.alumniDonationData = {
    title:   title,
    upi:     upi,
    bank:    (document.getElementById('alDonBank').value    || '').trim(),
    accNo:   (document.getElementById('alDonAccNo').value   || '').trim(),
    ifsc:    (document.getElementById('alDonIFSC').value    || '').trim(),
    accName: (document.getElementById('alDonAccName').value || '').trim(),
    desc:    (document.getElementById('alDonDesc').value    || '').trim(),
    qr:      window._alQRBase64 || null
  };
  fb.innerHTML = '<span style="color:var(--green);">&#10003; Donation details saved and published to student portal!</span>';
  stuRenderAlumniDonation();
  alShowDonationPreview();
}

function alClearDonation() {
  ['alDonTitle','alDonUPI','alDonBank','alDonAccNo','alDonIFSC','alDonAccName','alDonDesc'].forEach(function(id){
    var el = document.getElementById(id); if(el) el.value = '';
  });
  alRemoveQR();
  var fb = document.getElementById('alDonFeedback');
  if(fb) fb.innerHTML = '';
  var lp = document.getElementById('alDonLivePreview');
  if(lp) lp.style.display = 'none';
}

function alShowDonationPreview() {
  var d = window.alumniDonationData;
  if (!d) return;
  var lp = document.getElementById('alDonLivePreview');
  var pc = document.getElementById('alDonPreviewCard');
  if (!lp || !pc) return;
  lp.style.display = 'block';
  pc.innerHTML = buildDonationCard(d);
}

function buildDonationCard(d) {
  var qrHtml = d.qr
    ? '<img src="' + d.qr + '" style="width:160px;height:160px;object-fit:contain;border:2px solid var(--border);border-radius:12px;background:white;padding:8px;display:block;margin:0 auto 10px;" />'
    : '<div style="width:160px;height:160px;background:var(--bg);border:2px dashed var(--border);border-radius:12px;display:flex;align-items:center;justify-content:center;margin:0 auto 10px;font-size:2rem;color:var(--text-muted);">&#128247;</div>';
  return '<div style="background:linear-gradient(135deg,#f0fdf4,#dcfce7);border:1.5px solid #86efac;border-radius:14px;padding:22px;text-align:center;">'
    + '<div style="font-weight:800;font-size:1rem;color:#15803d;margin-bottom:4px;">&#128176; ' + d.title + '</div>'
    + (d.desc ? '<div style="font-size:0.78rem;color:var(--text);margin-bottom:16px;line-height:1.6;">' + d.desc + '</div>' : '')
    + qrHtml
    + '<div style="display:inline-block;background:white;border:1.5px solid #86efac;border-radius:10px;padding:12px 20px;text-align:left;min-width:220px;">'
    + '<div style="font-size:0.68rem;color:var(--text-muted);font-weight:700;text-transform:uppercase;letter-spacing:0.06em;margin-bottom:8px;">Payment Details</div>'
    + '<div style="font-size:0.78rem;margin-bottom:4px;"><strong>UPI ID:</strong> <span style="font-family:JetBrains Mono,monospace;color:#15803d;">' + d.upi + '</span></div>'
    + (d.bank    ? '<div style="font-size:0.75rem;margin-bottom:3px;"><strong>Bank:</strong> ' + d.bank + '</div>' : '')
    + (d.accNo   ? '<div style="font-size:0.75rem;margin-bottom:3px;"><strong>A/C No:</strong> <span style="font-family:JetBrains Mono,monospace;">' + d.accNo + '</span></div>' : '')
    + (d.ifsc    ? '<div style="font-size:0.75rem;margin-bottom:3px;"><strong>IFSC:</strong> <span style="font-family:JetBrains Mono,monospace;">' + d.ifsc + '</span></div>' : '')
    + (d.accName ? '<div style="font-size:0.75rem;"><strong>Name:</strong> ' + d.accName + '</div>' : '')
    + '</div>'
    + '<div style="margin-top:12px;font-size:0.7rem;color:var(--text-muted);">Thank you for supporting 171 Government Polytechnic Hubli Alumni Network &#128149;</div>'
    + '</div>';
}

// ── Student portal: render donation ──────────────────────────────
function stuRenderAlumniDonation() {
  var body = document.getElementById('stuAlumniDonationBody');
  if (!body) return;
  var d = window.alumniDonationData;
  if (!d) {
    body.innerHTML = '<div style="padding:18px;text-align:center;color:var(--text-muted);font-size:0.8rem;">Donation details will appear here once published by the Alumni Officer.</div>';
    return;
  }
  body.innerHTML = buildDonationCard(d);
}

// ================================================================
//  ALUMNI MEMBERS-ONLY NOTIFICATIONS
// ================================================================
// When officer posts, we tag it. Members-only feed shows tagged posts.
window.alumniMemberOnlyPosts = window.alumniMemberOnlyPosts || [];

function stuRenderAlumniMemberNotifs() {
  var container  = document.getElementById('stuAlumniMemberNotifs');
  var listEl     = document.getElementById('stuAlumniMemberNotifList');
  if (!container || !listEl) return;

  // Only show to approved alumni members
  var isMember = window.alumniMembersDB && window.alumniMembersDB.find(function(m){ return m.regNo === STU_REG_NO; });
  var isPending = window.alumniRequestStatus && window.alumniRequestStatus[STU_REG_NO] === 'pending';
  if (!isMember && !isPending) { container.style.display = 'none'; return; }
  container.style.display = 'block';

  // Show alumni category posts from activityDB as member notifications
  var posts = (window.activityDB || []).filter(function(p){ return p.category === 'alumni'; });
  if (!posts.length && !window.alumniMemberOnlyPosts.length) {
    listEl.innerHTML = '<div style="padding:14px;text-align:center;color:var(--text-muted);font-size:0.8rem;">No exclusive updates yet. Check back after the Alumni Officer posts updates.</div>';
    return;
  }
  var all = posts.concat(window.alumniMemberOnlyPosts || []);
  listEl.innerHTML = all.map(function(p) {
    return '<div class="app-item" style="align-items:flex-start;gap:12px;padding:14px 16px;border-bottom:1px solid var(--border);">'
      + '<div style="width:40px;height:40px;background:#ede9fe;border-radius:10px;display:flex;align-items:center;justify-content:center;font-size:1.2rem;flex-shrink:0;">&#127891;</div>'
      + '<div style="flex:1;">'
      + '<div style="font-weight:700;font-size:0.86rem;">' + p.title + '</div>'
      + '<div style="font-size:0.75rem;color:var(--text-muted);margin-top:3px;line-height:1.5;">' + (p.description || '') + '</div>'
      + '<div style="margin-top:6px;font-size:0.68rem;font-family:JetBrains Mono,monospace;color:var(--text-light);">'
      + (p.date !== '—' ? '&#128197; ' + p.date + ' &nbsp;' : '')
      + (p.venue !== '—' ? '&#128205; ' + p.venue + ' &nbsp;' : '')
      + '&#128100; ' + (p.postedBy || 'Alumni Cell') + ' &middot; ' + (p.postedOn || '')
      + '</div>'
      + '</div>'
      + '<span class="badge approved" style="font-size:0.6rem;flex-shrink:0;">Members</span>'
      + '</div>';
  }).join('');
}



document.addEventListener('DOMContentLoaded', function() {
  renderStaffDynamicProfile('TH');
  renderStuBuilder();
  renderStaffBuilder('TH');
  renderStuDynamicProfile();
});
