
(function(){
  'use strict';
  const $ = s => document.querySelector(s);
  const $$ = s => Array.from(document.querySelectorAll(s));
  const todayStr = () => new Date().toISOString().slice(0,10);
  const clamp = (v,min,max)=> Math.max(min, Math.min(max, v));
  const num = v => { const n=parseFloat(v); return isNaN(n)?0:n; };
  function load(){ try { return JSON.parse(localStorage.getItem('glycotank')||'{}'); } catch(e){ return {}; } }
  function save(state){ localStorage.setItem('glycotank', JSON.stringify(state)); }
  function uid(){ return Math.random().toString(36).slice(2,10); }

  const defaults = {
    workouts:[], meals:[], checks:[],
    workoutFavs:[], mealFavs:[],
    undo:[], glycoHistory:{},
    settings: {
      proteinTarget:140, fiberTarget:28, carbGuide:250,
      glycoCap:400, uptakePct:85, setCost:6.0, cardioGpmIntensity1:0.33,
      autosave:false, lastBackup:"", chartDays:14,
      remind:{ hydrate:"", lunch:"", evening:"" }
    }
  };
  const state = Object.assign({}, defaults, load());
  state.settings = Object.assign({}, defaults.settings, state.settings||{});

  // PWA
  if('serviceWorker' in navigator){ window.addEventListener('load', ()=> navigator.serviceWorker.register('./service-worker.js')); }
  let deferredPrompt;
  window.addEventListener('beforeinstallprompt', (e)=>{ e.preventDefault(); deferredPrompt=e; const btn=$('#installBtn'); if(btn){ btn.hidden=false; btn.onclick=async()=>{ btn.disabled=true; await deferredPrompt.prompt(); deferredPrompt=null; }; }});

  // Nav
  $$('#nav button').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      $$('#nav button').forEach(b=>b.classList.remove('active'));
      btn.classList.add('active');
      const tab=btn.dataset.tab; $$('.tab').forEach(sec=>sec.hidden=true);
      $('#tab-'+tab).hidden=false;
      if(tab==='dash') renderDashboard();
      setupEnhancements(); if(tab==='history') renderHistory();
      if(tab==='settings') renderSettings();
    });
  });

  // Speech
  const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
  function dictateTo(inputEl){ if(!SpeechRec){ alert('Speech recognition not supported in this browser.'); return; } const r=new SpeechRec(); r.lang='en-US'; r.interimResults=false; r.maxAlternatives=1; r.onresult = e => { inputEl.value = e.results[0][0].transcript; }; r.start(); }

  // Workout form
  const wType=$('#wType'), strengthFields=$('#strengthFields'), cardioFields=$('#cardioFields');
  wType.addEventListener('change', ()=>{ const v=wType.value; strengthFields.hidden = v!=='strength'; cardioFields.hidden = v!=='cardio'; });
  $('#wDate').value = todayStr();
  $('#voiceWorkout').addEventListener('click', e=>{ e.preventDefault(); dictateTo($('#wName')); });

  // Meal form
  $('#mDate').value = todayStr();
  $('#voiceMeal').addEventListener('click', e=>{ e.preventDefault(); dictateTo($('#mName')); });

  // Check-in form
  $('#cDate').value = todayStr();

  // Favorites (render selects)
  function refreshFavs(){
    const wSel=$('#wFavs'), mSel=$('#mFavs');
    if(wSel){ wSel.innerHTML = '<option value=\"\">Favorites…</option>' + (state.workoutFavs||[]).map((f,i)=>`<option value=\"${i}\">${f.label}</option>`).join(''); }
    if(mSel){ mSel.innerHTML = '<option value=\"\">Favorites…</option>' + (state.mealFavs||[]).map((f,i)=>`<option value=\"${i}\">${f.label}</option>`).join(''); }
  }
  refreshFavs();

  $('#wFavs').addEventListener('change', ()=>{
    const idx = parseInt($('#wFavs').value,10); if(isNaN(idx)) return;
    const f = state.workoutFavs[idx]; if(!f) return;
    $('#wType').value = f.type||'strength'; wType.dispatchEvent(new Event('change'));
    if(f.type==='strength'){ $('#wName').value=f.name||''; $('#wSets').value=f.sets||3; $('#wReps').value=f.reps||5; $('#wWeight').value=f.weight||0; }
    else { $('#wCardioName').value=f.name||''; $('#wMins').value=f.mins||30; $('#wIntensity').value=f.intensity||3; }
    $('#wNotes').value=f.notes||'';
  });
  $('#mFavs').addEventListener('change', ()=>{
    const idx = parseInt($('#mFavs').value,10); if(isNaN(idx)) return;
    const f = state.mealFavs[idx]; if(!f) return;
    $('#mName').value=f.name||''; $('#mCalories').value=f.kcal||''; $('#mCarbs').value=f.carbs||''; $('#mProtein').value=f.protein||''; $('#mFat').value=f.fat||''; $('#mFiber').value=f.fiber||''; $('#mNotes').value=f.notes||'';
  });
  $('#saveWFav').addEventListener('click', ()=>{
    const type=wType.value;
    const fav = (type==='strength')
      ? {label:($('#wName').value||'Strength'), type, name:$('#wName').value, sets:num($('#wSets').value), reps:num($('#wReps').value), weight:num($('#wWeight').value), notes:$('#wNotes').value}
      : {label:($('#wCardioName').value||'Cardio'), type, name:$('#wCardioName').value, mins:num($('#wMins').value), intensity:num($('#wIntensity').value), notes:$('#wNotes').value};
    state.workoutFavs = state.workoutFavs||[]; state.workoutFavs.push(fav); save(state); refreshFavs(); alert('Saved to favorites.');
  });
  $('#saveMFav').addEventListener('click', ()=>{
    const fav = {label:($('#mName').value||'Meal'), name:$('#mName').value, kcal:num($('#mCalories').value), carbs:num($('#mCarbs').value), protein:num($('#mProtein').value), fat:num($('#mFat').value), fiber:num($('#mFiber').value), notes:$('#mNotes').value};
    state.mealFavs = state.mealFavs||[]; state.mealFavs.push(fav); save(state); refreshFavs(); alert('Saved to favorites.');
  });

  // Parse helpers (AI-ish)
  function parseMealNotes(t){
    const g = s=> { const m=t.match(s); return m? num(m[1]) : 0; }
    return {
      kcal: g(/(?:kcal|cal)\s*(\d+)/i),
      carbs: g(/(?:c|carb|carbs)\s*(\d+)/i),
      protein: g(/(?:p|prot|protein)\s*(\d+)/i),
      fat: g(/(?:f|fat)\s*(\d+)/i),
      fiber: g(/(?:fib|fiber)\s*(\d+)/i),
    };
  }
  $('#parseMeal').addEventListener('click', ()=>{
    const t = ($('#mNotes').value||'');
    const r = parseMealNotes(t);
    if(r.kcal) $('#mCalories').value=r.kcal;
    if(r.carbs) $('#mCarbs').value=r.carbs;
    if(r.protein) $('#mProtein').value=r.protein;
    if(r.fat) $('#mFat').value=r.fat;
    if(r.fiber) $('#mFiber').value=r.fiber;
  });
  $('#parseWorkout').addEventListener('click', ()=>{
    const t = ($('#wNotes').value||'');
    const s = t.match(/(\d+)\s*x\s*(\d+)/i); if(s){ $('#wSets').value=s[1]; $('#wReps').value=s[2]; }
    const w = t.match(/@?\s*(\d+(\.\d+)?)\s*(kg|lb)?/i); if(w){ $('#wWeight').value=w[1]; }
    const m = t.match(/(\d+)\s*(min|mins|minutes)/i); if(m){ $('#wMins').value=m[1]; }
  });

  // Save entries + Undo
  function pushUndo(action){ state.undo = state.undo||[]; state.undo.push(action); if(state.undo.length>25) state.undo.shift(); save(state); }
  $('#undoBtn').addEventListener('click', ()=>{
    const last = (state.undo||[]).pop(); if(!last){ alert('Nothing to undo.'); return; }
    if(last.kind==='workout'){ state.workouts = state.workouts.filter(x=>x.id!==last.id); }
    if(last.kind==='meal'){ state.meals = state.meals.filter(x=>x.id!==last.id); }
    save(state); renderDashboard(); setupEnhancements(); renderHistory();
  });

  $('#saveWorkout').addEventListener('click', ()=>{
    const date=$('#wDate').value||todayStr();
    const type=wType.value; const notes=$('#wNotes').value.trim();
    let entry;
    if(type==='strength'){
      entry={ id:uid(), date, type, name:($('#wName').value.trim()||'Strength'), sets:num($('#wSets').value), reps:num($('#wReps').value), weight:num($('#wWeight').value), notes };
    } else if(type==='cardio'){
      entry={ id:uid(), date, type, name:($('#wCardioName').value.trim()||'Cardio'), mins:num($('#wMins').value), intensity:clamp(num($('#wIntensity').value)||3,1,5), notes };
    } else {
      entry={ id:uid(), date, type, name:(type[0].toUpperCase()+type.slice(1)), notes };
    }
    state.workouts.push(entry); pushUndo({kind:'workout', id:entry.id}); save(state); clearWorkoutForm(); renderDashboard(); setupEnhancements(); alert('Workout saved.');
  });
  function clearWorkoutForm(){ $('#wName').value=''; $('#wSets').value=3; $('#wReps').value=5; $('#wWeight').value=100; $('#wCardioName').value=''; $('#wMins').value=30; $('#wIntensity').value=3; $('#wNotes').value=''; $('#wDate').value=todayStr(); }

  $('#saveMeal').addEventListener('click', ()=>{
    const date=$('#mDate').value||todayStr();
    const entry={ id:uid(), date, name:($('#mName').value.trim()||'Meal'),
      kcal:num($('#mCalories').value), carbs:num($('#mCarbs').value), protein:num($('#mProtein').value), fat:num($('#mFat').value), fiber:num($('#mFiber').value),
      notes:$('#mNotes').value.trim()
    };
    state.meals.push(entry); pushUndo({kind:'meal', id:entry.id}); save(state); clearMealForm(); renderDashboard(); setupEnhancements(); alert('Meal saved.');
  });
  function clearMealForm(){ $('#mDate').value=todayStr(); $('#mName').value=''; $('#mCalories').value=''; $('#mCarbs').value=''; $('#mProtein').value=''; $('#mFat').value=''; $('#mFiber').value=''; $('#mNotes').value=''; }

  $('#saveCheckin').addEventListener('click', ()=>{
    const entry={ id:uid(), date:($('#cDate').value||todayStr()), mood:$('#cMood').value, sleep:num($('#cSleep').value), rhr:parseInt($('#cRHR').value||'0',10), notes:$('#cNotes').value.trim() };
    // Upsert by date (one check per day)
    const i = (state.checks||[]).findIndex(x=>x.date===entry.date);
    if(i>=0) state.checks[i]=entry; else state.checks.push(entry);
    save(state); alert('Check-in saved.');
    renderDashboard();
  setupEnhancements(); });

  // Click-to-edit from Today & History (event delegation)
  function attachEditHandlers(){
    ['todayMeals','todayWorkouts','history'].forEach(id=>{
      const root = $('#'+id);
      if(!root) return;
      root.onclick = (e)=>{
        const div = e.target.closest('[data-kind]');
        if(!div) return;
        const kind = div.dataset.kind, itemId = div.dataset.id;
        if(kind==='meal'){
          const m = state.meals.find(x=>x.id===itemId); if(!m) return;
          $('#mDate').value=m.date; $('#mName').value=m.name; $('#mCalories').value=m.kcal||''; $('#mCarbs').value=m.carbs||''; $('#mProtein').value=m.protein||''; $('#mFat').value=m.fat||''; $('#mFiber').value=m.fiber||''; $('#mNotes').value=m.notes||'';
          $('#nav [data-tab="meal"]').click();
          // Replace save to edit once
          const original = $('#saveMeal').onclick;
          $('#saveMeal').onclick = ()=>{
            m.date=$('#mDate').value||todayStr(); m.name=$('#mName').value||'Meal';
            m.kcal=num($('#mCalories').value); m.carbs=num($('#mCarbs').value); m.protein=num($('#mProtein').value); m.fat=num($('#mFat').value); m.fiber=num($('#mFiber').value);
            m.notes=$('#mNotes').value||'';
            save(state); renderDashboard(); setupEnhancements(); renderHistory(); alert('Meal updated.');
            $('#saveMeal').onclick = original;
            clearMealForm();
          };
        } else if(kind==='workout'){
          const w = state.workouts.find(x=>x.id===itemId); if(!w) return;
          $('#wDate').value=w.date; $('#wType').value=w.type; wType.dispatchEvent(new Event('change'));
          if(w.type==='strength'){ $('#wName').value=w.name||''; $('#wSets').value=w.sets||3; $('#wReps').value=w.reps||5; $('#wWeight').value=w.weight||0; }
          else if(w.type==='cardio'){ $('#wCardioName').value=w.name||''; $('#wMins').value=w.mins||30; $('#wIntensity').value=w.intensity||3; }
          $('#wNotes').value=w.notes||'';
          $('#nav [data-tab="workout"]').click();
          const original2 = $('#saveWorkout').onclick;
          $('#saveWorkout').onclick = ()=>{
            w.date=$('#wDate').value||todayStr(); w.type=$('#wType').value;
            if(w.type==='strength'){ w.name=$('#wName').value||'Strength'; w.sets=num($('#wSets').value); w.reps=num($('#wReps').value); w.weight=num($('#wWeight').value); }
            else if(w.type==='cardio'){ w.name=$('#wCardioName').value||'Cardio'; w.mins=num($('#wMins').value); w.intensity=clamp(num($('#wIntensity').value)||3,1,5); }
            w.notes=$('#wNotes').value||'';
            save(state); renderDashboard(); setupEnhancements(); renderHistory(); alert('Workout updated.');
            $('#saveWorkout').onclick = original2;
            clearWorkoutForm();
          };
        }
      };
    });
  }

  // Glycogen calc
  function computeGlycoForDay(dateStr){
    const cfg=state.settings;
    const yesterday=new Date(dateStr); yesterday.setDate(yesterday.getDate()-1);
    const y=yesterday.toISOString().slice(0,10);
    let start=(state.glycoHistory && state.glycoHistory[y]!=null)?state.glycoHistory[y]:(cfg.glycoCap*0.7);
    const meals=state.meals.filter(m=>m.date===dateStr);
    const added=meals.reduce((sum,m)=> sum+(num(m.carbs)*(cfg.uptakePct/100)), 0);
    const wos=state.workouts.filter(w=>w.date===dateStr);
    let cost=0;
    for(const w of wos){
      if(w.type==='strength'){ cost += (num(w.sets)||0)*cfg.setCost; }
      else if(w.type==='cardio'){ const mins=num(w.mins)||0; const intensity=clamp(num(w.intensity)||1,1,5); cost += mins*cfg.cardioGpmIntensity1*intensity; }
      else { cost += 10; }
    }
    let end = clamp(start + added - cost, 0, cfg.glycoCap); return { start, added, cost, end };
  }
  function rebuildGlycoHistory(days=14){
    state.glycoHistory = state.glycoHistory || {};
    const now=new Date(); const startDate=new Date(now); startDate.setDate(startDate.getDate()-(days-1));
    let prev=state.settings.glycoCap*0.7;
    for(let i=0;i<days;i++){
      const d=new Date(startDate); d.setDate(startDate.getDate()+i);
      const ds=d.toISOString().slice(0,10);
      state.glycoHistory[ds]=prev;
      const {end}=computeGlycoForDay(ds); state.glycoHistory[ds]=end; prev=end;
    }
  }

  // Dashboard
  function renderDashboard(){
    const daysSel = parseInt($('#chartDays').value||state.settings.chartDays||14,10);
    state.settings.chartDays = daysSel;
    rebuildGlycoHistory(Math.max(30, daysSel)); // keep buffer for tooltips
    const ds=todayStr();
    const meals=state.meals.filter(m=>m.date===ds);
    const wos=state.workouts.filter(w=>w.date===ds);
    const kcal=meals.reduce((s,m)=> s+num(m.kcal),0);
    const protein=meals.reduce((s,m)=> s+num(m.protein),0);
    const fiber=meals.reduce((s,m)=> s+num(m.fiber),0);
    $('#kcalToday').textContent=Math.round(kcal);
    $('#proteinToday').textContent=Math.round(protein);
    $('#fiberToday').textContent=Math.round(fiber);
    $('#proteinProgress').value=clamp(protein/state.settings.proteinTarget*100,0,100);
    $('#fiberProgress').value=clamp(fiber/state.settings.fiberTarget*100,0,100);

    const gly=state.glycoHistory[ds]||0; $('#glycoNow').textContent=`${Math.round(gly)} g`;
    const pct=clamp(gly/state.settings.glycoCap*100,0,100); const bar=$('#glycoBar'); bar.value=pct;
    const wrap=$('#glycoBarWrap'); wrap.classList.remove('ok','warn','danger'); wrap.classList.add(pct<25?'danger':pct<50?'warn':'ok');
    $('#glycoHint').textContent = pct<25?'Low — consider carbs/rest': pct<50?'Moderate — easy day':'Good — ready to train';

    $('#todayWorkouts').innerHTML = wos.length ? wos.map(renderWorkoutItem).join('') : '<span class="muted">No workouts yet.</span>';
    $('#todayMeals').innerHTML = meals.length ? meals.map(renderMealItem).join('') : '<span class="muted">No meals yet.</span>';

    drawGlycoChart(daysSel);
    $('#chartDaysLabel').textContent = daysSel + 'd';

    // streak + 7d totals
    $('#streakDays').textContent = computeStreak();
    const weekDates = rangeDays(7).map(d=>d.toISOString().slice(0,10));
    const weekMeals = state.meals.filter(m=>weekDates.includes(m.date));
    const weekProtein = weekMeals.reduce((s,m)=> s+num(m.protein),0);
    const weekWos = state.workouts.filter(w=>weekDates.includes(w.date)).length;
    $('#proteinWeek').textContent = Math.round(weekProtein);
    $('#workoutsWeek').textContent = weekWos;

    // readiness
    const r = latestReadiness();
    $('#readinessScore').textContent = r.score!=null ? Math.round(r.score) : '–';
    $('#readinessLabel').textContent = r.label || '–';

    // smart carb planner for tomorrow
    $('#carbPlan').textContent = Math.round(smartCarbPlan()) + ' g';

    attachEditHandlers();
    save(state);
    maybeAutosave();
  }

  function renderWorkoutItem(w){
    let text = '';
    if(w.type==='strength'){ text = \`\${w.sets}×\${w.reps} @ \${w.weight}kg\`; }
    else if(w.type==='cardio'){ text = \`\${w.mins} min (intensity \${w.intensity})\`; }
    return \`<div class="entry" data-kind="workout" data-id="\${w.id}"><strong>\${w.name||w.type}</strong> — \${text}</div>\`;
  }
  function renderMealItem(m){
    return \`<div class="entry" data-kind="meal" data-id="\${m.id}"><strong>\${m.name}</strong> — \${Math.round(num(m.kcal))} kcal • C\${num(m.carbs)} P\${num(m.protein)} F\${num(m.fat)} Fib\${num(m.fiber)}</div>\`;
  }

  // History with filters
  function renderHistory(){
    const type = $('#histType').value;
    const prot = $('#histProtein').value;
    const groups={};
    for(const m of state.meals){ groups[m.date]=groups[m.date]||{meals:[],workouts:[]}; groups[m.date].meals.push(m); }
    for(const w of state.workouts){ groups[w.date]=groups[w.date]||{meals:[],workouts:[]}; groups[w.date].workouts.push(w); }
    const dates=Object.keys(groups).sort().reverse();
    const el=$('#history');
    if(!dates.length){ el.innerHTML='<span class="muted">Nothing yet.</span>'; return; }
    const rows = [];
    for(const d of dates){
      let ws = groups[d].workouts; let ms = groups[d].meals;
      if(type){ ws = ws.filter(x=>x.type===type); }
      if(prot){
        const totalP = ms.reduce((s,m)=>s+num(m.protein),0);
        const hit = totalP >= (state.settings.proteinTarget||140);
        if(prot==='hit' && !hit) { ws=[]; ms=[]; }
        if(prot==='miss' && hit) { ws=[]; ms=[]; }
      }
      if(!ws.length && !ms.length) continue;
      rows.push(\`<div class="group"><h4>\${d}</h4>\${ws.map(renderWorkoutItem).join('')||'<div class="muted">No workouts.</div>'}\${ms.map(renderMealItem).join('')||'<div class="muted">No meals.</div>'}</div>\`);
    }
    el.innerHTML = rows.join('') || '<span class="muted">No matching days.</span>';
    attachEditHandlers();
  }
  $('#histType').addEventListener('change', renderHistory);
  $('#histProtein').addEventListener('change', renderHistory);

  // Chart with tooltip + days selector
  $('#chartDays').addEventListener('change', renderDashboard);
  function drawGlycoChart(days){
    const c=$('#glycoChart'); const tip=$('#glycoTip');
    const ctx=c.getContext('2d');
    const w=c.width=c.clientWidth*devicePixelRatio; const h=c.height=160*devicePixelRatio;
    ctx.clearRect(0,0,w,h);
    const cap=state.settings.glycoCap;
    const labels=[]; const values=[];
    const now=new Date();
    for(let i=days-1;i>=0;i--){
      const d=new Date(now); d.setDate(now.getDate()-i);
      const ds=d.toISOString().slice(0,10);
      labels.push(ds); values.push(state.glycoHistory && state.glycoHistory[ds]!=null ? state.glycoHistory[ds] : cap*0.7);
    }
    const padding=12*devicePixelRatio; const gx0=padding, gx1=w-padding, gy0=padding, gy1=h-padding;
    const x=i=> gx0+(gx1-gx0)*i/(days-1); const y=v=> gy1-(gy1-gy0)*(v/cap);
    ctx.globalAlpha=0.25; ctx.strokeStyle='#3a3f55'; ctx.lineWidth=1*devicePixelRatio;
    for(const frac of [0.25,0.5,0.75,1.0]){ const gy=y(cap*frac); ctx.beginPath(); ctx.moveTo(gx0,gy); ctx.lineTo(gx1,gy); ctx.stroke(); } ctx.globalAlpha=1;
    ctx.beginPath(); for(let i=0;i<values.length;i++){ const xv=x(i), yv=y(values[i]); if(i===0) ctx.moveTo(xv,yv); else ctx.lineTo(xv,yv); } ctx.strokeStyle='#57cc99'; ctx.lineWidth=2.5*devicePixelRatio; ctx.stroke();
    const grad=ctx.createLinearGradient(0,gy0,0,gy1); grad.addColorStop(0,'rgba(87,204,153,0.25)'); grad.addColorStop(1,'rgba(87,204,153,0.02)'); ctx.lineTo(gx1,gy1); ctx.lineTo(gx0,gy1); ctx.closePath(); ctx.fillStyle=grad; ctx.fill();

    function showTip(px,py,txt){ const b=c.getBoundingClientRect(); tip.style.left=(b.left+px/devicePixelRatio+10)+'px'; tip.style.top=(b.top+py/devicePixelRatio-30)+'px'; tip.innerHTML=txt; tip.hidden=false; }
    function hideTip(){ tip.hidden=true; }
    c.onmousemove = c.ontouchstart = (ev)=>{
      const clientX = ev.touches? ev.touches[0].clientX : ev.clientX;
      const rect = c.getBoundingClientRect();
      const px = (clientX - rect.left) * devicePixelRatio;
      const frac = clamp((px - gx0)/(gx1-gx0),0,1);
      const i = Math.round(frac*(days-1));
      const xv = x(i), yv = y(values[i]);
      const ds = labels[i].slice(5);
      showTip(xv, yv, \`<strong>\${Math.round(values[i])} g</strong><div class="smallmuted">\${ds}</div>\`);
    };
    c.onmouseleave = hideTip;
  }

  // Streak & helpers
  function dateAdd(d,delta){ const x=new Date(d); x.setDate(x.getDate()+delta); return x; }
  function rangeDays(n){ const a=[]; const now=new Date(); for(let i=0;i<n;i++){ const d=new Date(now); d.setDate(now.getDate()-i); a.push(d); } return a; }
  function computeStreak(){
    let streak=0; let d = new Date();
    while(true){
      const ds = d.toISOString().slice(0,10);
      const has = state.meals.some(x=>x.date===ds) || state.workouts.some(x=>x.date===ds) || state.checks.some(x=>x.date===ds);
      if(!has) break;
      streak++; d = dateAdd(d,-1);
    }
    return streak;
  }

  // Readiness score (0-100)
  function latestReadiness(){
    if(!(state.checks||[]).length) return {score:null,label:null};
    const last = [...state.checks].sort((a,b)=> a.date<b.date?1:-1)[0];
    const sleep = clamp(num(last.sleep),0,12); const rhr = num(last.rhr)||60; const mood = last.mood||'ok';
    const moodScore = {great:1.0, ok:0.8, tired:0.6, stressed:0.55, sore:0.65}[mood] || 0.8;
    // Simple model: more sleep => up; higher RHR => down. Scale to 0..100.
    const base = 50 + (sleep-7)*5 - (rhr-60)*0.5;
    const score = clamp(base*moodScore, 0, 100);
    const label = (score>=75)?'Train': (score>=55)?'Easy':'Rest';
    return {score, label};
  }

  // Smart carb planner for tomorrow (use tomorrow's planned workouts)
  function smartCarbPlan(){
    const cfg=state.settings; const tomorrow=new Date(); tomorrow.setDate(tomorrow.getDate()+1);
    const ts = tomorrow.toISOString().slice(0,10);
    const planned = state.workouts.filter(w=>w.date===ts);
    let cost=0;
    for(const w of planned){
      if(w.type==='strength'){ cost += (num(w.sets)||0)*cfg.setCost; }
      else if(w.type==='cardio'){ const mins=num(w.mins)||0; const intensity=clamp(num(w.intensity)||1,1,5); cost += mins*cfg.cardioGpmIntensity1*intensity; }
      else { cost += 10; }
    }
    // Aim to start tomorrow around 75% cap
    const desired = cfg.glycoCap*0.75;
    const todayEnd = state.glycoHistory[todayStr()]||cfg.glycoCap*0.7;
    const predictedStart = clamp(todayEnd - cost, 0, cfg.glycoCap);
    const gramsNeeded = clamp(desired - predictedStart, 0, cfg.glycoCap);
    const carbsNeeded = gramsNeeded>0 ? (gramsNeeded*100)/(cfg.uptakePct||85) : 0;
    return carbsNeeded;
  }

  // Autosave backup (JSON download once per day)
  function maybeAutosave(){
    try{
      if(!state.settings.autosave) return;
      const t = todayStr();
      if(state.settings.lastBackup === t) return;
      const blob = new Blob([JSON.stringify(state,null,2)], {type:'application/json'});
      const a=document.createElement('a');
      a.href=URL.createObjectURL(blob);
      a.download = \`glycotank-backup-\${t}.json\`;
      document.body.appendChild(a); a.click(); URL.revokeObjectURL(a.href); a.remove();
      state.settings.lastBackup = t; save(state);
    }catch(e){ /* ignore */ }
  }

  // Notifications (Capacitor if available, else fallback banner)
  async function requestReminderPerms(){
    try{
      const cap = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.LocalNotifications;
      if(cap){ await cap.requestPermissions(); return true; }
      if('Notification' in window){ const r = await Notification.requestPermission(); return r==='granted'; }
    }catch(e){}
    return false;
  }
  async function scheduleReminders(){
    const times = state.settings.remind||{};
    const cap = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.LocalNotifications;
    if(cap){
      const toId = (h,m)=> (h*60+m);
      const jobs=[];
      [['hydrate',times.hydrate],['lunch',times.lunch],['evening',times.evening]].forEach(([name,t])=>{
        if(!t) return;
        const [hh,mm] = t.split(':').map(x=>parseInt(x,10));
        jobs.push({
          id: toId(hh,mm),
          title: 'GlycoTank',
          body: name==='hydrate'?'Hydrate!':'Time to log '+(name==='lunch'?'lunch':'your evening check-in'),
          schedule: { repeats: true, every: 'day', on: { hour: hh, minute: mm } }
        });
      });
      if(jobs.length) await cap.schedule({ notifications: jobs });
      alert('Reminders scheduled.');
    } else {
      alert('LocalNotifications not available. Using in-app banners while the app is open.');
    }
  }

  // Settings
  function renderSettings(){
    $('#sProtein').value=state.settings.proteinTarget;
    $('#sFiber').value=state.settings.fiberTarget;
    $('#sCarb').value=state.settings.carbGuide;
    $('#sGlycoCap').value=state.settings.glycoCap;
    $('#sUptake').value=state.settings.uptakePct;
    $('#sSetCost').value=state.settings.setCost;
    $('#sCardioGpm').value=state.settings.cardioGpmIntensity1;
    $('#sAutosave').checked=!!state.settings.autosave;
    $('#sHydrateAt').value=state.settings.remind.hydrate||'';
    $('#sLunchAt').value=state.settings.remind.lunch||'';
    $('#sEveningAt').value=state.settings.remind.evening||'';
  }
  $('#saveSettings').addEventListener('click', ()=>{
    state.settings.proteinTarget=num($('#sProtein').value)||defaults.settings.proteinTarget;
    state.settings.fiberTarget=num($('#sFiber').value)||defaults.settings.fiberTarget;
    state.settings.carbGuide=num($('#sCarb').value)||defaults.settings.carbGuide;
    state.settings.glycoCap=num($('#sGlycoCap').value)||defaults.settings.glycoCap;
    state.settings.uptakePct=clamp(num($('#sUptake').value)||defaults.settings.uptakePct,10,100);
    state.settings.setCost=num($('#sSetCost').value)||defaults.settings.setCost;
    state.settings.cardioGpmIntensity1=num($('#sCardioGpm').value)||defaults.settings.cardioGpmIntensity1;
    state.settings.autosave=$('#sAutosave').checked;
    state.settings.remind = {
      hydrate: $('#sHydrateAt').value||'',
      lunch: $('#sLunchAt').value||'',
      evening: $('#sEveningAt').value||'',
    };
    save(state); renderDashboard(); setupEnhancements(); alert('Settings saved.');
  });
  const resetBtn = $('#resetSettings'); if (resetBtn) resetBtn.addEventListener('click', ()=>{
    state.settings = JSON.parse(JSON.stringify(defaults.settings)); save(state); renderSettings(); renderDashboard();
  setupEnhancements(); });
  const remBtn = $('#enableReminders'); if (remBtn) remBtn.addEventListener('click', async ()=>{
    const ok = await requestReminderPerms();
    if(ok) await scheduleReminders(); else alert('Permission not granted.');
  });

  // Exports / Clear
  function download(filename, text){ const blob=new Blob([text],{type:'text/plain'}); const url=URL.createObjectURL(blob); const a=document.createElement('a'); a.href=url; a.download=filename; a.click(); URL.revokeObjectURL(url); }
  $('#exportJson').addEventListener('click', ()=>{ download('glycotank-export.json', JSON.stringify(state,null,2)); });
  $('#exportCSV').addEventListener('click', ()=>{
    const wcsv=['id,date,type,name,sets,reps,weight,mins,intensity,notes'];
    for(const w of state.workouts){ wcsv.push([w.id,w.date,w.type,quote(w.name),w.sets||'',w.reps||'',w.weight||'',w.mins||'',w.intensity||'',quote(w.notes||'')].join(',')); }
    const mcsv=['id,date,name,kcal,carbs,protein,fat,fiber,notes'];
    for(const m of state.meals){ mcsv.push([m.id,m.date,quote(m.name),m.kcal||'',m.carbs||'',m.protein||'',m.fat||'',m.fiber||'',quote(m.notes||'')].join(',')); }
    download('workouts.csv', wcsv.join('\n')); download('meals.csv', mcsv.join('\n'));
  });
  function quote(s){ if(s==null) return ''; const t=String(s); if(t.includes(',')||t.includes('\"')||t.includes('\n')){ return '\"' + t.replace(/\"/g,'\"\"') + '\"'; } return t; }
  $('#clearAll').addEventListener('click', ()=>{ if(confirm('This will delete all local data. Proceed?')){ localStorage.removeItem('glycotank'); Object.assign(state, JSON.parse(JSON.stringify(defaults))); renderDashboard(); setupEnhancements(); renderHistory(); renderSettings(); alert('Cleared.'); }});

  // Quick nav
  $('#quickAddWorkout').addEventListener('click', e=>{ e.preventDefault(); $('#nav [data-tab=\"workout\"]').click(); });
  $('#quickAddMeal').addEventListener('click', e=>{ e.preventDefault(); $('#nav [data-tab=\"meal\"]').click(); });

  // Initial tab state
  $('#tab-dash').hidden=false; $('#tab-workout').hidden=true; $('#tab-meal').hidden=true; $('#tab-checkin').hidden=true; $('#tab-history').hidden=true; $('#tab-settings').hidden=true;

  renderDashboard(); setupEnhancements(); renderHistory(); renderSettings();

})();

  // === Enhancements: session mode, rest timer, plate math, glyco planner ===
  (function(){
    let restTickRef=null, restLeft=0, restDefault=90;

    function fmt(t){ t=Math.max(0,Math.floor(t)); const m=String(Math.floor(t/60)).padStart(2,'0'); const s=String(t%60).padStart(2,'0'); return m+":"+s; }
    function drawRest(){ const el=document.getElementById('restTimer'); if(el) el.textContent = fmt(restLeft); }
    function startRest(sec){ restLeft=sec; drawRest(); if(restTickRef) clearInterval(restTickRef); restTickRef=setInterval(()=>{ restLeft--; drawRest(); if(restLeft<=0){ clearInterval(restTickRef); restTickRef=null; } },1000); }

    function addSessRow(pref){
      const list = document.getElementById('sessList'); if(!list) return;
      const row = document.createElement('div'); row.className='sessrow';
      row.innerHTML = `
        <label class="fld"><span class="label">Exercise</span><input class="sxName" placeholder="e.g., Incline DB Press" value="${(pref&&pref.name)||''}"></label>
        <label class="fld"><span class="label">Sets</span><input class="sxSets" type="number" min="1" step="1" value="${(pref&&pref.sets)||''}"></label>
        <label class="fld"><span class="label">Reps</span><input class="sxReps" type="number" min="1" step="1" value="${(pref&&pref.reps)||''}"></label>
        <label class="fld"><span class="label">Weight</span><input class="sxWeight" type="number" min="0" step="0.5" value="${(pref&&pref.weight)||''}"></label>
        <button class="btn ghost small rm" title="Remove">✕</button>
      `;
      list.appendChild(row);
      row.querySelector('.rm').addEventListener('click', ()=>{ row.remove(); updateSessCount(); });
      updateSessCount();
    }
    function updateSessCount(){
      const c=document.getElementById('sessCount'); const n=(document.querySelectorAll('#sessList .sessrow')||[]).length; if(c) c.textContent = n + ' exercise' + (n===1?'':'s');
    }

    function handleSaveSession(){
      try{
        const list=[].slice.call(document.querySelectorAll('#sessList .sessrow'));
        if(!list.length){ alert('Add at least one exercise.'); return; }
        const ds = document.getElementById('wDate')?.value || (new Date()).toISOString().slice(0,10);
        const sname = (document.getElementById('wSessionName')?.value||'Session').trim();
        const state = (function(){ try { return JSON.parse(localStorage.getItem('glycotank')||'{}'); } catch(e){ return {}; } })();
        state.workouts = Array.isArray(state.workouts)?state.workouts:[];
        const sid = Math.random().toString(36).slice(2,10);
        list.forEach(row=>{
          const name = row.querySelector('.sxName')?.value.trim() || 'Strength';
          const sets = parseFloat(row.querySelector('.sxSets')?.value||'0')||0;
          const reps = parseFloat(row.querySelector('.sxReps')?.value||'0')||0;
          const weight = parseFloat(row.querySelector('.sxWeight')?.value||'0')||0;
          state.workouts.push({ id: Math.random().toString(36).slice(2,10), sessionId:sid, sessionName:sname, date:ds, type:'strength', name, sets, reps, weight, notes:'' });
        });
        localStorage.setItem('glycotank', JSON.stringify(state));
        alert('Session saved ('+list.length+' exercises).');
        startRest(restDefault); // start timer
        location.reload();
      }catch(e){ console.error(e); alert('Failed to save session.'); }
    }

    function setupSessionMode(){
      const mode = document.getElementById('wMode');
      const sess = document.getElementById('sessionFields');
      const strn = document.getElementById('strengthFields');
      const cardio = document.getElementById('cardioFields');
      const addBtn = document.getElementById('addSessExercise');
      const saveBtn= document.getElementById('saveSession');
      const clrBtn = document.getElementById('clearSession');
      if(!mode) return;

      function apply(){
        const m = mode.value||'single';
        const showSession = (m==='session');
        if(sess)   sess.hidden = !showSession;
        if(strn)   strn.hidden = showSession || (document.getElementById('wType')?.value!=='strength');
        if(cardio) cardio.hidden = showSession || (document.getElementById('wType')?.value!=='cardio');
      }
      mode.addEventListener('change', apply);
      document.getElementById('wType')?.addEventListener('change', apply);
      addBtn?.addEventListener('click', (e)=>{ e.preventDefault(); addSessRow(); });
      saveBtn?.addEventListener('click', (e)=>{ e.preventDefault(); handleSaveSession(); });
      clrBtn?.addEventListener('click', (e)=>{ e.preventDefault(); const list=document.getElementById('sessList'); if(list){ list.innerHTML=''; updateSessCount(); } });
      // rest buttons
      document.getElementById('rest60')?.addEventListener('click', ()=>{ restDefault=60; startRest(60); });
      document.getElementById('rest90')?.addEventListener('click', ()=>{ restDefault=90; startRest(90); });
      document.getElementById('rest120')?.addEventListener('click',()=>{ restDefault=120;startRest(120); });
      apply();
    }

    function setupPlateMath(){
      function compute(){
        const units = (document.getElementById('pmUnits')?.value)||'kg';
        const target = parseFloat(document.getElementById('pmTarget')?.value||'0')||0;
        const bar = parseFloat(document.getElementById('pmBar')?.value|| (units==='kg'?20:45) )||0;
        const avail = (units==='kg') ? [25,20,15,10,5,2.5,1.25,0.5] : [45,35,25,10,5,2.5];
        let perSide = (target - bar)/2;
        const used=[];
        for(const p of avail){
          while(perSide >= p-1e-9){ used.push(p); perSide -= p; }
        }
        const txt = (target<=bar) ? 'Bar only' : ('Per side: ' + (used.length? used.join(' + ') : '–'));
        const el = document.getElementById('pmResult'); if(el) el.textContent = txt + (units==='kg'?' kg':' lb');
      }
      ['pmUnits','pmTarget','pmBar','wWeight'].forEach(id=>{
        const el=document.getElementById(id); if(el){ el.addEventListener('input', compute); el.addEventListener('change', compute); }
      });
      compute();
    }

    function setupPlanner(){
      function load(){ try { return JSON.parse(localStorage.getItem('glycotank')||'{}'); } catch(e){ return {}; } }
      function ensure(s){
        s=s||{}; s.settings=Object.assign({ glycoCap:400, uptakePct:85, setCost:6.0, cardioGpmIntensity1:0.33 }, s.settings||{});
        s.glycoHistory=s.glycoHistory||{};
        return s;
      }
      function nowIso(){ return new Date().toISOString().slice(0,10); }

      function update(){
        try{
          const s=ensure(load());
          const cap=s.settings.glycoCap, uptake=(s.settings.uptakePct||85)/100;
          const sets=parseFloat(document.getElementById('planSets')?.value||'0')||0;
          const mins=parseFloat(document.getElementById('planMins')?.value||'0')||0;
          const intensity=parseFloat(document.getElementById('planIntensity')?.value||'3')||3;
          const cost = sets*(s.settings.setCost||6) + mins*(s.settings.cardioGpmIntensity1||0.33)*intensity;
          // current glycogen end today (we maintain it in glycoHistory on render)
          const today=nowIso(); const gly = s.glycoHistory[today] ?? (cap*0.7);
          const wantStart = cap*0.60; // aim to start tomorrow at 60% full
          const carbsToReachStart = Math.max(0, wantStart - gly) / Math.max(0.1, uptake);
          const carbsToCoverCost  = cost / Math.max(0.1, uptake);
          const suggest = Math.ceil(carbsToReachStart + carbsToCoverCost);
          const out = document.getElementById('planOut');
          if(out) out.textContent = `Plan cost ≈ ${Math.round(cost)} g; eat ~${suggest} g carbs (reach 60% tank + cover cost).`;
        }catch(e){}
      }
      ['planSets','planMins','planIntensity'].forEach(id=>{
        const el=document.getElementById(id); if(el){ el.addEventListener('input', update); el.addEventListener('change', update); }
      });
      update();
    }

    window.setupEnhancements = function(){
      try{ setupSessionMode(); }catch(e){ console.error(e); }
      try{ setupPlateMath(); }catch(e){ console.error(e); }
      try{ setupPlanner(); }catch(e){ console.error(e); }
    };
  })();

  // ==== Personalize (calibration wizard) ====
  (function(){
    function lsLoad(){ try { return JSON.parse(localStorage.getItem("glycotank")||"{}"); } catch(e){ return {}; } }
    function lsSave(s){ localStorage.setItem("glycotank", JSON.stringify(s)); }
    function ensure(s){
      s=s||{};
      s.settings = Object.assign({
        proteinTarget:140, fiberTarget:28, carbGuide:250, glycoCap:400,
        uptakePct:85, setCost:6.0, cardioGpmIntensity1:0.33
      }, s.settings||{});
      s.meta = Object.assign({ userSetSettings:false }, s.meta||{});
      return s;
    }
    function clamp(v,min,max){ return Math.max(min, Math.min(max, v)); }

    function kgFrom(val, units){ var x=parseFloat(val||"0")||0; return (units==="lb")? x*0.453592 : x; }
    function tdeeGuess(kg, goal){
      // very rough: kg * 30 kcal/day baseline; cut 0.85, gain 1.10
      var base = kg * 30;
      return goal==="cut" ? base*0.85 : goal==="gain" ? base*1.10 : base;
    }

    function calc(){
      var units = document.getElementById("pzUnits")?.value || "kg";
      var kg    = kgFrom(document.getElementById("pzWeight")?.value || "0", units);
      var goal  = document.getElementById("pzGoal")?.value || "maintain";
      var days  = parseFloat(document.getElementById("pzDays")?.value || "3")||3;
      var avgSets = parseFloat(document.getElementById("pzAvgSets")?.value || "12")||12;
      var cardioMin = parseFloat(document.getElementById("pzCardio")?.value || "0")||0;
      var intensity = parseFloat(document.getElementById("pzInt")?.value || "3")||3;
      var lowCarb   = !!document.getElementById("pzLowCarb")?.checked;

      // Protein (g): 2.2 g/kg on cut, 2.0 maintain, 1.8 gain
      var pPerKg = goal==="cut" ? 2.2 : goal==="gain" ? 1.8 : 2.0;
      var pTarget = Math.round(kg * pPerKg);

      // Fiber (g): 14g per 1000 kcal (clamped 20..45)
      var kcal = tdeeGuess(kg, goal);
      var fTarget = clamp(Math.round(14 * (kcal/1000)), 20, 45);

      // Training score for carbs: days + sets + cardio
      var trainScore = (days * (avgSets/12)) + ((cardioMin * (0.6 + 0.1*intensity))/60);
      var carbPerKg = clamp(2.5 + 0.4*trainScore, lowCarb?1.8:2.0, lowCarb?4.5:6.0);
      var carbGuide = Math.round(kg * carbPerKg);

      // Glyco cap (g): base 350 + size + training; clamp 300..600
      var cap = clamp(Math.round(350 + (kg-70)*1.8 + days*12 + (cardioMin/4)), 300, 600);

      // Uptake %: default 85; cut/low-carb: 80; gain: 88-90
      var uptake = goal==="gain" ? 90 : (lowCarb || goal==="cut") ? 80 : 85;

      // Set cost (g): 5.5..6.5 based on size
      var setCost = clamp(5.5 + (kg>90?0.7:(kg<65?-0.5:0)), 4.5, 7.5);

      // Cardio g/min @ intensity 1: 0.25 small, 0.33 med, 0.35+ large
      var gpm = (kg<65)?0.25 : (kg>90?0.36:0.33);

      // Output
      function put(id, txt){ var el=document.getElementById(id); if(el) el.textContent = txt; }
      put("pzProtOut", pTarget + " g");
      put("pzFibOut",  fTarget + " g");
      put("pzCarbOut", carbGuide + " g");
      put("pzCapOut",  cap + " g");
      put("pzUptakeOut", uptake + " %");
      put("pzSetCostOut", setCost.toFixed(1) + " g");
      put("pzGpmOut", gpm.toFixed(2));

      // Tiny explanation
      var exp = "Based on " + (Math.round(kg)||"—") + (units==="lb"?" kg":" kg") + ", "+days+"d/wk, "+Math.round(avgSets)+" sets, "+Math.round(cardioMin)+" cardio mins.";
      var exEl = document.getElementById("pzExplain"); if(exEl) exEl.textContent = exp;

      return { proteinTarget:pTarget, fiberTarget:fTarget, carbGuide:carbGuide, glycoCap:cap, uptakePct:uptake, setCost:setCost, cardioGpmIntensity1:gpm };
    }

    function apply(){
      var s = ensure(lsLoad());
      var rec = calc();
      Object.assign(s.settings, rec);
      s.meta.userSetSettings = true;
      lsSave(s);
      alert("Applied to Settings.");
      setTimeout(()=>location.reload(), 100);
    }

    window.setupPersonalize = function(){
      ["pzUnits","pzWeight","pzHeight","pzGoal","pzDays","pzAvgSets","pzCardio","pzInt","pzLowCarb"].forEach(function(id){
        var el=document.getElementById(id); if(el){ ["input","change"].forEach(evt=>el.addEventListener(evt, calc)); }
      });
      var btn=document.getElementById("pzApply"); if(btn){ btn.addEventListener("click", apply); }
      calc();
    };

    // Auto-setup once DOM is ready
    if (document.readyState==="loading") {
      document.addEventListener("DOMContentLoaded", function(){ try{ setupPersonalize(); }catch(e){} });
    } else { try{ setupPersonalize(); }catch(e){} }
  })();


try{ window.state=state; window.renderSettings=renderSettings; window.renderDashboard=renderDashboard; }catch(e){}



