/* =====================================================================
   Park Nova — IoT Parking Simulator
   script.js — vanilla JS, no frameworks. Pairs with index.html + style.css.
   ===================================================================== */

/* ---------- 1. Component catalogue (edit prices here anytime) ---------- */
const COMPONENTS = [
  { type:'slot',        name:'Parking Slot',       desc:'One marked space for a car',     price:2500,   icon:'🅿️', w:78,  h:88,  group:'slots' },
  { type:'entry-gate',  name:'Entry Gate',         desc:'Opens for cars coming in',        price:95000,  icon:'🛬', w:120, h:60,  group:'gates' },
  { type:'exit-gate',   name:'Exit Gate',          desc:'Opens for cars going out',        price:120000, icon:'🛫', w:120, h:60,  group:'gates' },
  { type:'sensor',      name:'Parking Sensor',     desc:'Detects if a car is parked',      price:250,    icon:'📡', w:46,  h:46,  group:'sensors' },
  { type:'camera',      name:'Number Plate Camera', desc:'Reads the car\'s number plate',   price:59500,  icon:'📸', w:50,  h:50,  group:'cameras' },
  { type:'lcd',         name:'Display Screen',     desc:'Shows slot status live',          price:350,    icon:'📟', w:90,  h:54,  group:'lcds' },
  { type:'servo',       name:'Gate Motor',         desc:'Opens and closes the gate arm',   price:300,    icon:'⚙️', w:46,  h:46,  group:'servos' },
  { type:'controller',  name:'Smart Controller',   desc:'Connects every device together',  price:1100,   icon:'🧠', w:46,  h:46,  group:'controllers' },
  { type:'payment',     name:'Final Payment Module', desc:'Takes payment before car exits', price:450,   icon:'💳', w:46,  h:46,  group:'payment' },
];

/* runtime state */
const canvas   = document.getElementById('canvas');
const logList  = document.getElementById('logList');
let placed     = [];      // {id, type, price, label, x, y, w, h, status, el}
let counter    = 0;
let selectedId = null;
let simTimer   = null;
let simRunning = false;
let lastEvent  = null;    // {slotLabel, status} — most recent slot change, drives the LCDs

/* entry queue — cars wait in line, one at a time walks from entry gate to its slot */
let spawnQueue = [];
let entryBusy  = false;

/* NEW: simulation "epoch" — Reset/Clear increments this. Every pending setTimeout
   inside a car's journey checks the epoch before acting; agar Reset/Clear ho chuka
   hai to purana pending step khud-ba-khud cancel ho jata hai aur state ko overwrite
   nahi karta. Ye hi Reset State ke "kaam na karne" wale bug ki asal wajah thi. */
let simEpoch = 0;

/* Pakistani-style number plate generator, e.g. LEA-4521, ICT-0892 */
const PLATE_PREFIXES = ['LEA','LEB','LED','LEF','LEZ','ICT','KHI','RIA','PES','GUJ'];
function generatePlate(){
  const prefix = PLATE_PREFIXES[Math.floor(Math.random()*PLATE_PREFIXES.length)];
  const digits = String(Math.floor(1000 + Math.random()*8999));
  return `${prefix}-${digits}`;
}

/* ---------- 2. Build the library sidebar ---------- */
const libList = document.getElementById('libList');
COMPONENTS.forEach(c => {
  const row = document.createElement('div');
  row.className = 'lib-item';
  row.innerHTML = `
    <div class="lib-icon">${c.icon}</div>
    <div class="lib-meta">
      <div class="name">${c.name}</div>
      <div class="desc">${c.desc}</div>
      <div class="price">Rs ${c.price.toLocaleString()}</div>
    </div>
    <button class="lib-add" title="Add to layout">+</button>`;
  row.addEventListener('click', () => addComponent(c.type));
  libList.appendChild(row);
});

/* ---------- 3. Adding a component to the canvas ---------- */
function addComponent(type, x, y){
  const def = COMPONENTS.find(c => c.type === type);
  if(!def) return;
  counter++;

  const sameTypeCount = placed.filter(p => p.type === type).length + 1;
  const SHORT_LABEL = { sensor:'Sensor', camera:'Camera', lcd:'Screen', servo:'Motor', controller:'Controller', payment:'Payment' };
  let label = def.name;
  if(type === 'slot'){
    const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    const slotIndex = placed.filter(p=>p.type==='slot').length; // 0-based
    label = `Slot ${letters[slotIndex % 26]}`;
  } else if (SHORT_LABEL[type]){
    label = `${SHORT_LABEL[type]}-${sameTypeCount}`;
  } else {
    label = def.name;
  }

  const posX = x ?? (80 + (placed.length % 8) * 40);
  const posY = y ?? (250 + Math.floor(placed.length / 8) * 40);

  const item = { id:'c'+counter, type, price:def.price, label, x:posX, y:posY,
                 w:def.w, h:def.h,
                 status: (type==='slot') ? 'free' : null };

  const el = document.createElement('div');
  el.className = `placed ${type}`;
  el.style.left = posX+'px';
  el.style.top  = posY+'px';
  el.style.width  = item.w+'px';
  el.style.height = item.h+'px';
  el.dataset.id = item.id;

  el.innerHTML = buildInnerHTML(item, def);
  canvas.appendChild(el);
  item.el = el;
  placed.push(item);

  makeDraggable(el, item);
  el.querySelector('.p-del')?.addEventListener('click', (e)=>{ e.stopPropagation(); removeItem(item.id); });

  // NEW: sirf Parking Slot ke liye ek resize handle wire karo (bottom-right corner square)
  if(type === 'slot'){
    const handle = el.querySelector('.resize-handle');
    if(handle) makeResizable(handle, item);
  }

  updateCostPanel();
  log(`Added <b>${label}</b> to layout.`);
  return item;
}

function buildInnerHTML(item, def){
  if(item.type === 'lcd'){
    return `
      <button class="p-del">×</button>
      <span class="p-label">${item.label}</span>
      <div class="lcd-screen">
        <span class="lcd-line">PARK NOVA</span>
        <span class="lcd-line dim">System Ready</span>
      </div>`;
  }
  let statusHTML = '';
  if(item.type === 'slot'){
    statusHTML = `<span class="p-status ${item.status}">${item.status.toUpperCase()}</span><span class="p-timer"></span>`;
  } else if(item.type === 'entry-gate' || item.type === 'exit-gate'){
    statusHTML = `<span class="p-status">READY</span>`;
  }
  // resize-handle sirf slot type ke liye chahiye, magar isko yahan bina harm sabke liye
  // add kar sakte hain kyunke CSS ise sirf .placed.slot.selected par hi dikhata hai.
  const resizeHandleHTML = (item.type === 'slot') ? `<div class="resize-handle" title="Drag to resize"></div>` : '';
  return `
    <button class="p-del">×</button>
    <span class="p-icon">${def.icon}</span>
    <span class="p-label">${item.label}</span>
    ${statusHTML}
    ${resizeHandleHTML}`;
}

function removeItem(id){
  const item = placed.find(p => p.id === id);
  if(!item) return;
  item.el.remove();
  placed = placed.filter(p => p.id !== id);
  if(selectedId === id){
    selectedId = null;
    hideSlotSizeCard();
  }
  updateCostPanel();
  log(`Removed <b>${item.label}</b>.`);
}

/* ---------- 4. Drag to move + click to select ---------- */
function makeDraggable(el, item){
  let dragging = false, startX=0, startY=0, origX=0, origY=0, moved=false;

  el.addEventListener('pointerdown', (e)=>{
    // FIX: agar click delete (×) button ya resize handle par hua hai to
    // is listener ko kuch bhi na karne dein — unke apne handlers chalne dein.
    if(e.target.closest('.p-del') || e.target.closest('.resize-handle')) return;

    dragging = true; moved = false;
    startX = e.clientX; startY = e.clientY;
    origX = item.x; origY = item.y;
    el.setPointerCapture(e.pointerId);
  });

  el.addEventListener('pointermove', (e)=>{
    if(!dragging) return;
    const dx = e.clientX - startX, dy = e.clientY - startY;
    if(Math.abs(dx) > 3 || Math.abs(dy) > 3) moved = true;
    item.x = Math.max(0, origX + dx);
    item.y = Math.max(0, origY + dy);
    el.style.left = item.x+'px';
    el.style.top  = item.y+'px';
  });

  el.addEventListener('pointerup', ()=>{
    dragging = false;
    if(!moved) selectItem(item.id);
  });
}

/* ---------- 5. Component selection (highlight + slot-size panel) ---------- */
function showSlotSizeCard(item){
  const sizeCard = document.getElementById('slotSizeCard');
  if(!sizeCard) return;
  sizeCard.style.display = 'block';
  const nameEl = document.getElementById('slotSizeName');
  const wInput = document.getElementById('slotWidthInput');
  const hInput = document.getElementById('slotHeightInput');
  if(nameEl) nameEl.textContent = item.label;
  if(wInput) wInput.value = item.w;
  if(hInput) hInput.value = item.h;
}

function hideSlotSizeCard(){
  const sizeCard = document.getElementById('slotSizeCard');
  if(sizeCard) sizeCard.style.display = 'none';
}

function selectItem(id){
  selectedId = id;
  document.querySelectorAll('.placed').forEach(e => e.classList.remove('selected'));
  const item = placed.find(p => p.id === id);
  if(item) item.el.classList.add('selected');

  if(item && item.type === 'slot'){
    showSlotSizeCard(item);
  } else {
    hideSlotSizeCard();
  }
}

canvas.addEventListener('pointerdown', (e)=>{
  if(e.target === canvas){
    selectedId = null;
    document.querySelectorAll('.placed').forEach(el=>el.classList.remove('selected'));
    hideSlotSizeCard();
  }
});

/* ---------- 5b. Slot width/height resize ---------- */
function resizeItem(id, w, h){
  const item = placed.find(p=>p.id===id);
  if(!item) return;
  // safe minimum/maximum taake element ghayab ya screen se bahar na chala jaye
  item.w = Math.max(30, Math.min(400, Math.round(w)));
  item.h = Math.max(30, Math.min(400, Math.round(h)));
  item.el.style.width  = item.w+'px';
  item.el.style.height = item.h+'px';

  // agar yehi item abhi select hai to sidebar ke number-inputs bhi live sync karein
  if(selectedId === id){
    const wInput = document.getElementById('slotWidthInput');
    const hInput = document.getElementById('slotHeightInput');
    if(wInput) wInput.value = item.w;
    if(hInput) hInput.value = item.h;
  }
}

/* NEW: canvas par slot ke corner wale chhote square ko drag karke resize karna —
   ye sidebar inputs se bilkul independent tareeqa hai, isliye zyada reliable hai. */
function makeResizable(handle, item){
  handle.addEventListener('pointerdown', (e)=>{
    e.stopPropagation(); // taake ye event slot ko "move-drag" mode mein na le jaye
    e.preventDefault();

    const startX = e.clientX, startY = e.clientY;
    const startW = item.w, startH = item.h;
    handle.setPointerCapture(e.pointerId);

    // select bhi kar dein taake sidebar card turant dikh jaye
    selectItem(item.id);

    function onMove(ev){
      const dw = ev.clientX - startX;
      const dh = ev.clientY - startY;
      resizeItem(item.id, startW + dw, startH + dh);
    }
    function onUp(ev){
      handle.releasePointerCapture(ev.pointerId);
      handle.removeEventListener('pointermove', onMove);
      handle.removeEventListener('pointerup', onUp);
    }
    handle.addEventListener('pointermove', onMove);
    handle.addEventListener('pointerup', onUp);
  });
}

/* Sidebar ke number-inputs se bhi resize kar sakein (typing ke zariye exact px) */
document.getElementById('slotWidthInput')?.addEventListener('input', (e)=>{
  if(!selectedId) return;
  const item = placed.find(p=>p.id===selectedId);
  if(!item || item.type!=='slot') return;
  const val = Number(e.target.value);
  if(!isNaN(val)) resizeItem(selectedId, val, item.h);
});

document.getElementById('slotHeightInput')?.addEventListener('input', (e)=>{
  if(!selectedId) return;
  const item = placed.find(p=>p.id===selectedId);
  if(!item || item.type!=='slot') return;
  const val = Number(e.target.value);
  if(!isNaN(val)) resizeItem(selectedId, item.w, val);
});

/* ---------- 6. Cost & Budget panel (CBA) ---------- */
const GROUP_LABELS = { slots:'Slots', gates:'Gates', sensors:'Sensors', cameras:'ANPR Cams', lcds:'LCDs', servos:'Servos', controllers:'Controllers', payment:'Payment' };

function updateCostPanel(){
  const total = placed.reduce((sum, p) => sum + p.price, 0);
  document.getElementById('totalCost').textContent = 'Rs ' + total.toLocaleString();
  document.getElementById('monthlyCost').textContent = 'Monthly maintenance: Rs ' + Math.round(total*0.015).toLocaleString() + '/mo (~1.5%)';

  const grid = document.getElementById('statGrid');
  grid.innerHTML = Object.entries(GROUP_LABELS).map(([key,label])=>{
    const itemsInGroup = placed.filter(p => COMPONENTS.find(c=>c.type===p.type)?.group === key);
    const count = itemsInGroup.length;
    const subtotal = itemsInGroup.reduce((s,p)=>s+p.price, 0);
    const icon = COMPONENTS.find(c=>c.group===key)?.icon || '📦';
    return `
      <div class="stat ${count===0 ? 'empty' : ''}">
        <span class="stat-icon">${icon}</span>
        <span class="k">${label}</span>
        <span class="stat-sub">${count===0 ? 'Not placed yet' : 'Rs ' + subtotal.toLocaleString()}</span>
        <span class="v">${count}</span>
      </div>`;
  }).join('');

  refreshAllLCDs();
}

function renderParkingStatus(){
  const box = document.getElementById('statusRowGrid');
  if(!box) return;
  const slots = placed.filter(p=>p.type==='slot');
  const free = slots.filter(s=>s.status==='free').length;
  const occupied = slots.length - free;

  box.innerHTML = `
    <div class="status-pill free"><span class="dot"></span><span>Free</span><strong>${free}</strong></div>
    <div class="status-pill occupied"><span class="dot"></span><span>Occupied</span><strong>${occupied}</strong></div>
    <div class="status-pill total"><span class="dot"></span><span>Total</span><strong>${slots.length}</strong></div>`;
}

function refreshAllLCDs(){
  renderParkingStatus();
  const totalSlots = placed.filter(p=>p.type==='slot').length;
  const free = placed.filter(p=>p.type==='slot' && p.status==='free').length;

  const line1 = lastEvent
    ? (lastEvent.status === 'full' ? '🚫 PARKING FULL' : `${lastEvent.slotLabel}: ${lastEvent.status.toUpperCase()}`)
    : 'PARK NOVA';
  const line2 = lastEvent
    ? `${free}/${totalSlots} FREE${totalSlots>0 && free===0 ? ' · FULL' : ''}`
    : 'System Ready';

  placed.filter(p=>p.type==='lcd').forEach(p=>{
    const lines = p.el.querySelectorAll('.lcd-line');
    if(lines[0]){ lines[0].textContent = line1; lines[0].classList.remove('dim'); }
    if(lines[1]){ lines[1].textContent = line2; lines[1].classList.toggle('dim', !lastEvent); }
  });
}

/* ---------- 7. Live telemetry log ---------- */
function log(msg){
  if(!logList) return;
  const time = new Date().toLocaleTimeString();
  const row = document.createElement('div');
  row.className = 'log-entry';
  row.innerHTML = `[<b>${time}</b>] ${msg}`;
  logList.prepend(row);
  while(logList.children.length > 40) logList.removeChild(logList.lastChild);
}

/* ---------- 8. Simulation ---------- */
/* briefly flash a component (camera/sensor) so a "detecting" pulse is visible */
function flashDetect(item, ms=900){
  if(!item) return;
  item.el.classList.add('detecting');
  setTimeout(()=> item.el.classList.remove('detecting'), ms);
}

/* pick the sensor/camera physically nearest a slot, so feedback lands on the right device */
function nearestOfType(type, target){
  const candidates = placed.filter(p=>p.type===type);
  if(!candidates.length) return null;
  return candidates.reduce((best, c)=>{
    const d = Math.hypot(c.x-target.x, c.y-target.y);
    const bd = Math.hypot(best.x-target.x, best.y-target.y);
    return d < bd ? c : best;
  });
}

/* Drives the car through the road lane instead of cutting diagonally across the
   layout: down/up into the lane, along the lane to the target's x, then in to park. */
function driveAlongLane(car, targetX, targetY, onDone){
  const laneY = 465; // fixed row the car drives through instead of teleporting diagonally
  const hop = 550;   // ms per hop
  car.style.transition = `left ${hop}ms linear, top ${hop}ms linear`;

  car.style.top = laneY + 'px';
  setTimeout(()=>{
    car.style.left = targetX + 'px';
    setTimeout(()=>{
      car.style.top = targetY + 'px';
      setTimeout(()=>{
        car.style.transition = '';
        if(onDone) onDone();
      }, hop);
    }, hop);
  }, hop);
}

/* Public entry point — sirf queue mein daalta hai, turant journey shuru nahi karta.
   Isi wajah se ek waqt mein sirf ek hi car entry gate se slot ki taraf move karti hai. */
function spawnCar(){
  spawnQueue.push(true);
  log(`🧾 Car added to queue. (Queue: ${spawnQueue.length})`);
  processSpawnQueue();
}

function processSpawnQueue(){
  if(entryBusy) return;
  if(spawnQueue.length === 0) return;
  spawnQueue.shift();
  entryBusy = true;
  runSpawn(simEpoch);
}

/* Asal spawn logic. `startEpoch` capture kiya jata hai taake Reset/Clear ke baad
   ye purani car apne pending steps mein state ko overwrite na kar sake. */
function runSpawn(startEpoch){
  const entry  = placed.find(p=>p.type==='entry-gate');
  const exit   = placed.find(p=>p.type==='exit-gate');
  const camera = placed.find(p=>p.type==='camera');

  if(!entry){
    log('⚠️ Please add an Entry Gate to the layout.');
    entryBusy = false;
    processSpawnQueue();
    return;
  }

  const freeSlot = placed.find(p=>p.type==='slot' && p.status==='free');
  if(!freeSlot){
    log('🚫 Parking FULL — no free slot available.');
    lastEvent = { slotLabel: 'ALL SLOTS', status: 'full' };
    refreshAllLCDs();
    entryBusy = false;
    processSpawnQueue();
    return;
  }

  const plate = generatePlate();
  const durationSelect = document.getElementById('durationSelect');
  const durationSeconds = Number(durationSelect.value);
  const durationLabel = `${durationSeconds} Sec`;
  const exitFee = durationSeconds * 2;

  const car = document.createElement('div');
  car.className = 'car';
  car.innerHTML = `<span class="car-plate">${plate}</span><span class="car-timer" id="timer-${plate}"></span>🚗`;
  car.style.left = entry.x + 30 + 'px';
  car.style.top  = entry.y + 20 + 'px';
  canvas.appendChild(car);

  const entryBadge = entry.el.querySelector('.p-status');
  if(entryBadge){ entryBadge.textContent = 'OPEN'; entryBadge.className = 'p-status open'; }

  flashDetect(camera);
  log(`📷 ANPR Camera detected plate <b>${plate}</b> at Entry Gate.`);

  setTimeout(()=>{
    if(startEpoch !== simEpoch){ car.remove(); return; } // Reset/Clear ho chuka — yahin ruk jao

    log(`🔎 Plate ${plate} recognized → assigned to ${freeSlot.label} for ${durationLabel}. Barrier opening.`);
    if(entryBadge){ entryBadge.textContent = 'READY'; entryBadge.className = 'p-status'; }

    driveAlongLane(car, freeSlot.x + 20, freeSlot.y + 25, ()=>{
      if(startEpoch !== simEpoch){ car.remove(); return; }

      const sensor = nearestOfType('sensor', freeSlot);
      flashDetect(sensor);

      freeSlot.status = 'occupied';
      freeSlot.plate  = plate;
      const badge = freeSlot.el.querySelector('.p-status');
      if(badge){ badge.textContent = `${plate} · OCCUPIED`; badge.className = 'p-status occupied'; }

      lastEvent = { slotLabel: freeSlot.label, status: 'occupied' };
      refreshAllLCDs();
      log(`✅ Sensor confirms ${freeSlot.label} OCCUPIED (${plate}). Timer started: ${durationLabel}.`);

      startCarCountdown(car, plate, durationSeconds, freeSlot);

      // is car ne apni slot pakad li — ab entry lane free hai, agli car ko release karo
      entryBusy = false;
      processSpawnQueue();

      setTimeout(()=>{
        if(startEpoch !== simEpoch) return;
        log(`⏰ Time's up for ${plate} — now heading to the exit gate.`);

        if(!exit){ log('⚠️ No Exit Gate found — car will remain parked.'); return; }
        const exitBadge = exit.el.querySelector('.p-status');
        if(exitBadge){ exitBadge.textContent = 'OPEN'; exitBadge.className = 'p-status open'; }
        log(`🚗 ${plate} leaving ${freeSlot.label} → driving to Exit Gate.`);

        driveAlongLane(car, exit.x + 20, exit.y + 20, ()=>{
          if(startEpoch !== simEpoch){ car.remove(); return; }

          const paymentModule = placed.find(p=>p.type==='payment');
          if(paymentModule){
            flashDetect(paymentModule);
            log(`💳 Final Payment Module processing payment for <b>${plate}</b>: Rs ${exitFee} (${durationLabel}).`);
          } else {
            exit.el.classList.add('paying');
            log(`💳 Calculating exit fee for ${plate}: <b>Rs ${exitFee}</b> (${durationLabel}). <i>(Final Payment Module not in layout — software-only payment)</i>`);
          }

          setTimeout(()=>{
            if(startEpoch !== simEpoch) return;
            exit.el.classList.remove('paying');

            if(paymentModule){
              paymentModule.el.classList.remove('detecting');
              paymentModule.el.classList.add('paid');
              setTimeout(()=> paymentModule.el.classList.remove('paid'), 1200);
            }
            if(exitBadge){ exitBadge.textContent = 'PAYMENT DONE ✓'; exitBadge.className = 'p-status open'; }
            log(`✅ Payment complete — Rs ${exitFee} charged for ${plate}.`);

            setTimeout(()=>{
              if(startEpoch !== simEpoch) return;
              flashDetect(camera);
              freeSlot.status = 'free';
              freeSlot.plate  = null;
              const badge = freeSlot.el.querySelector('.p-status');
              if(badge){ badge.textContent = 'FREE'; badge.className = 'p-status free'; }
              const timerEl = freeSlot.el.querySelector('.p-timer');
              if(timerEl){ timerEl.textContent=''; timerEl.classList.remove('showing','ending'); }
              if(exitBadge){ exitBadge.textContent = 'READY'; exitBadge.className = 'p-status'; }

              lastEvent = { slotLabel: freeSlot.label, status: 'free' };
              refreshAllLCDs();
              log(`🚦 Exit gate opening for ${plate}.`);
              car.remove();
              log(`🏁 ${plate} exited. ${freeSlot.label} is FREE again.`);
            }, 1100);
          }, 1300);
        });
      }, durationSeconds * 1000);
    });
  }, 700);
}

/* Live mm:ss countdown shown above the parked car — turns red in the last 3 seconds. */
function startCarCountdown(car, plate, totalSeconds, slotItem){
  let remaining = totalSeconds;
  const carBadge = document.getElementById(`timer-${plate}`);
  const slotBadge = slotItem?.el.querySelector('.p-timer');

  const render = ()=>{
    const mm = String(Math.floor(Math.max(0,remaining)/60)).padStart(2,'0');
    const ss = String(Math.max(0,remaining)%60).padStart(2,'0');
    const text = `${mm}:${ss}`;
    const ending = remaining <= 3;

    if(carBadge){ carBadge.textContent = text; carBadge.classList.toggle('ending', ending); }
    if(slotBadge){
      slotBadge.textContent = text;
      slotBadge.classList.add('showing');
      slotBadge.classList.toggle('ending', ending);
    }
  };
  render();

  const interval = setInterval(()=>{
    remaining--;
    if(!document.body.contains(car)){ clearInterval(interval); return; }
    render();
    if(remaining <= 0) clearInterval(interval);
  }, 1000);
}

document.getElementById('btnSpawn').addEventListener('click', spawnCar);

document.getElementById('btnStart').addEventListener('click', (e)=>{
  simRunning = !simRunning;
  if(simRunning){
    e.target.textContent = '⏸ Stop Simulation';
    log('🟢 Simulation started — cars will auto-spawn.');
    spawnCar();
    simTimer = setInterval(spawnCar, 3800);
  } else {
    e.target.textContent = '▶ Start Simulation';
    clearInterval(simTimer);
    log('🔴 Simulation stopped.');
  }
});

document.getElementById('btnReset').addEventListener('click', ()=>{
  // FIX: epoch badhane se koi bhi purani "in-flight" car ka pending setTimeout
  // ab kuch nahi karega — is se slots turant aur permanently free rehte hain.
  simEpoch++;

  clearInterval(simTimer); simRunning = false;
  document.getElementById('btnStart').textContent = '▶ Start Simulation';
  document.querySelectorAll('.car').forEach(c=>c.remove());

  placed.filter(p=>p.type==='slot').forEach(p=>{
    p.status='free';
    p.plate=null;
    const badge = p.el.querySelector('.p-status');
    if(badge){ badge.textContent='FREE'; badge.className='p-status free'; }
    const timerEl = p.el.querySelector('.p-timer');
    if(timerEl){ timerEl.textContent=''; timerEl.classList.remove('showing','ending'); }
  });

  // gates ko bhi READY par wapas le aayein
  placed.filter(p=>p.type==='entry-gate' || p.type==='exit-gate').forEach(p=>{
    const badge = p.el.querySelector('.p-status');
    if(badge){ badge.textContent='READY'; badge.className='p-status'; }
    p.el.classList.remove('paying');
  });

  lastEvent = null;
  spawnQueue = [];
  entryBusy = false;
  refreshAllLCDs();
  log('↺ State reset — layout kept, all slots freed, pending cars cancelled.');
});

document.getElementById('btnClear').addEventListener('click', ()=>{
  simEpoch++; // yahan bhi cancel karo taake koi bhi purani journey ke callbacks harm na karein

  clearInterval(simTimer); simRunning = false;
  document.getElementById('btnStart').textContent = '▶ Start Simulation';
  placed.forEach(p=>p.el.remove());
  document.querySelectorAll('.car').forEach(c=>c.remove());
  placed = [];
  lastEvent = null;
  spawnQueue = [];
  entryBusy = false;
  selectedId = null;
  hideSlotSizeCard();
  updateCostPanel();
  log('🗑 Layout cleared.');
});

/* ---------- 9. Starter demo layout (so the page is never empty) ---------- */
function initDemo(){
  addComponent('entry-gate', 60, 40);
  addComponent('exit-gate', 1180, 40);
  addComponent('sensor', 220, 20);
  addComponent('servo', 150, 40);
  addComponent('camera', 60, 150);
  addComponent('slot', 220, 90);
  addComponent('slot', 320, 90);
  addComponent('slot', 420, 90);
  addComponent('lcd', 600, 100);
  addComponent('controller', 700, 200);
  log('SmartYard ready. Customize the layout or start the simulation directly.');
}
initDemo();