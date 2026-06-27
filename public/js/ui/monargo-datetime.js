"use strict";
/**
 * Monargo One — moderne datum/tijd-kiezer (Editorial 2026).
 *
 * Progressive enhancement: vervangt de lelijke, browser-eigen popups van
 * <input type="date|time|datetime-local"> door één consistente, licht-getinte
 * popover (kalender + tijdkolommen) in de Monargo-stijl. De onderliggende
 * native input blijft in de DOM staan met dezelfde naam/waarde/required, dus
 * formulieren en bestaande JS (die input.value leest) blijven ongewijzigd werken.
 *
 * Waardeformaten blijven exact zoals native:
 *   date            -> "YYYY-MM-DD"
 *   time            -> "HH:MM"
 *   datetime-local  -> "YYYY-MM-DDTHH:MM"
 *
 * Werkt in alle shells: hangt via event-delegation aan document, dus ook aan
 * inputs die later dynamisch gerenderd worden — geen registratie per scherm nodig.
 */
(function () {
  if (window.__monargoDT) return;
  window.__monargoDT = true;

  var SEL = 'input[type="date"],input[type="time"],input[type="datetime-local"]';
  var MONTHS = ["januari","februari","maart","april","mei","juni","juli","augustus","september","oktober","november","december"];
  var DOW = ["ma","di","wo","do","vr","za","zo"];

  // ── Stijl (gebruikt de globale Editorial-tokens) ──────────────────────────
  var css = ''
    + SEL.split(',').map(function(s){return s+'::-webkit-calendar-picker-indicator';}).join(',')
    + '{opacity:0;display:none}'
    + '.mdt-pop{position:fixed;z-index:4000;background:var(--surface,#fff);border:1px solid var(--line,#e5e5ea);'
    + 'border-radius:16px;box-shadow:0 12px 40px rgba(0,0,0,.14);padding:14px;'
    + 'font-family:var(--font-sans,-apple-system,Segoe UI,sans-serif);color:var(--ink,#1d1d1f);'
    + 'width:max-content;display:flex;gap:14px;animation:mdtIn .12s ease}'
    + '@keyframes mdtIn{from{opacity:0;transform:translateY(-4px)}to{opacity:1;transform:none}}'
    + '.mdt-cal{width:252px}'
    + '.mdt-hd{display:flex;align-items:center;justify-content:space-between;margin-bottom:10px}'
    + '.mdt-title{font-size:14px;font-weight:600;letter-spacing:-.2px;text-transform:capitalize}'
    + '.mdt-nav{display:flex;gap:4px}'
    + '.mdt-nav button{width:30px;height:30px;border:none;background:none;border-radius:8px;cursor:pointer;'
    + 'color:var(--gray-600,#475569);font-size:16px;display:grid;place-items:center;transition:background .12s}'
    + '.mdt-nav button:hover{background:rgba(0,0,0,.05)}'
    + '.mdt-dow{display:grid;grid-template-columns:repeat(7,1fr);gap:2px;margin-bottom:4px}'
    + '.mdt-dow span{font-size:10.5px;color:var(--muted,#6e6e73);text-align:center;padding:4px 0;font-weight:500}'
    + '.mdt-grid{display:grid;grid-template-columns:repeat(7,1fr);gap:2px}'
    + '.mdt-day{height:32px;border:none;background:none;border-radius:9px;cursor:pointer;font-size:13px;'
    + 'color:var(--ink,#1d1d1f);transition:background .1s,color .1s}'
    + '.mdt-day:hover{background:var(--wf-blue-l,#e9f1fd)}'
    + '.mdt-day.mut{color:var(--gray-300,#cbd5e1)}'
    + '.mdt-day.today{font-weight:600;color:var(--wf-blue,#0071e3)}'
    + '.mdt-day.sel{background:var(--wf-blue,#0071e3);color:#fff;font-weight:600}'
    + '.mdt-day:disabled{color:var(--gray-300,#cbd5e1);cursor:not-allowed;background:none}'
    + '.mdt-time{display:flex;gap:8px;align-items:stretch}'
    + '.mdt-col{display:flex;flex-direction:column}'
    + '.mdt-col-lbl{font-size:10.5px;color:var(--muted,#6e6e73);text-align:center;margin-bottom:4px;font-weight:500}'
    + '.mdt-scroll{height:198px;overflow-y:auto;width:56px;scrollbar-width:thin;display:flex;flex-direction:column;gap:2px;padding-right:2px}'
    + '.mdt-scroll::-webkit-scrollbar{width:5px}.mdt-scroll::-webkit-scrollbar-thumb{background:var(--gray-300,#cbd5e1);border-radius:3px}'
    + '.mdt-t{padding:7px 0;border:none;background:none;border-radius:8px;cursor:pointer;font-size:13px;'
    + 'color:var(--ink,#1d1d1f);font-variant-numeric:tabular-nums;transition:background .1s}'
    + '.mdt-t:hover{background:rgba(0,0,0,.05)}'
    + '.mdt-t.sel{background:var(--wf-blue,#0071e3);color:#fff;font-weight:600}'
    + '.mdt-foot{display:flex;gap:8px;justify-content:space-between;align-items:center;margin-top:12px;padding-top:10px;border-top:1px solid var(--line,#e5e5ea)}'
    + '.mdt-now{background:none;border:none;color:var(--wf-blue,#0071e3);font-size:12.5px;font-weight:600;cursor:pointer;padding:6px 4px}'
    + '.mdt-btns{display:flex;gap:6px}'
    + '.mdt-btn{padding:7px 16px;border-radius:980px;font-size:13px;font-weight:600;cursor:pointer;border:none;font-family:inherit}'
    + '.mdt-btn-clear{background:none;color:var(--muted,#6e6e73)}'
    + '.mdt-btn-ok{background:var(--wf-blue,#0071e3);color:#fff}'
    + '.mdt-foot-time{justify-content:flex-end}';
  var st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);

  // ── Helpers ───────────────────────────────────────────────────────────────
  function pad(n){ return (n<10?'0':'')+n; }
  function ymd(d){ return d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate()); }
  function parseDate(s){ if(!s) return null; var m=String(s).match(/(\d{4})-(\d{2})-(\d{2})/); return m?new Date(+m[1],+m[2]-1,+m[3]):null; }
  function parseTime(s){ if(!s) return null; var m=String(s).match(/T?(\d{2}):(\d{2})/); return m?{h:+m[1],min:+m[2]}:null; }

  var current = null; // {input, type, pop, view(Date), date(Date|null), time({h,min}|null)}

  function close(){ if(current){ current.pop.remove(); current=null; document.removeEventListener('mousedown',onDoc,true); window.removeEventListener('resize',close); window.removeEventListener('scroll',close,true); } }

  function onDoc(e){ if(current && !current.pop.contains(e.target) && e.target!==current.input) close(); }

  function commit(){
    var inp=current.input, type=current.type, val='';
    if(type!=='time' && !current.date) current.date=new Date();
    if(type!=='date' && !current.time) { var n=new Date(); current.time={h:n.getHours(),min:n.getMinutes()}; }
    if(type==='date') val=ymd(current.date);
    else if(type==='time') val=pad(current.time.h)+':'+pad(current.time.min);
    else val=ymd(current.date)+'T'+pad(current.time.h)+':'+pad(current.time.min);
    inp.value=val;
    inp.dispatchEvent(new Event('input',{bubbles:true}));
    inp.dispatchEvent(new Event('change',{bubbles:true}));
  }

  function renderCal(){
    var c=current, host=c.pop.querySelector('.mdt-cal'); if(!host) return;
    var view=c.view, y=view.getFullYear(), mo=view.getMonth();
    var today=new Date(); var min=parseDate(c.input.min), max=parseDate(c.input.max);
    var first=new Date(y,mo,1); var startDow=(first.getDay()+6)%7; // ma=0
    var grid='';
    for(var i=0;i<42;i++){
      var d=new Date(y,mo,1-startDow+i); var inMonth=d.getMonth()===mo;
      var dis=(min&&d<min)||(max&&d>max);
      var cls='mdt-day'+(inMonth?'':' mut')
        +(ymd(d)===ymd(today)?' today':'')
        +(c.date&&ymd(d)===ymd(c.date)?' sel':'');
      grid+='<button type="button" class="'+cls+'"'+(dis?' disabled':'')+' data-d="'+ymd(d)+'">'+d.getDate()+'</button>';
    }
    host.innerHTML=''
      +'<div class="mdt-hd"><div class="mdt-title">'+MONTHS[mo]+' '+y+'</div>'
      +'<div class="mdt-nav"><button type="button" data-mv="-1" aria-label="Vorige maand">‹</button>'
      +'<button type="button" data-mv="1" aria-label="Volgende maand">›</button></div></div>'
      +'<div class="mdt-dow">'+DOW.map(function(x){return '<span>'+x+'</span>';}).join('')+'</div>'
      +'<div class="mdt-grid">'+grid+'</div>';
  }

  function renderTime(){
    var c=current, host=c.pop.querySelector('.mdt-time'); if(!host) return;
    var h=c.time?c.time.h:-1, mn=c.time?c.time.min:-1;
    var hours=''; for(var i=0;i<24;i++) hours+='<button type="button" class="mdt-t'+(i===h?' sel':'')+'" data-h="'+i+'">'+pad(i)+'</button>';
    var mins=''; for(var m=0;m<60;m+=5) mins+='<button type="button" class="mdt-t'+(m===mn?' sel':'')+'" data-min="'+m+'">'+pad(m)+'</button>';
    host.innerHTML=''
      +'<div class="mdt-col"><div class="mdt-col-lbl">uur</div><div class="mdt-scroll" data-c="h">'+hours+'</div></div>'
      +'<div class="mdt-col"><div class="mdt-col-lbl">min</div><div class="mdt-scroll" data-c="min">'+mins+'</div></div>';
    // scroll geselecteerde in beeld
    host.querySelectorAll('.mdt-t.sel').forEach(function(b){ b.scrollIntoView({block:'center'}); });
  }

  function open(input){
    close();
    var type=input.type;
    var pop=document.createElement('div'); pop.className='mdt-pop';
    var dv=parseDate(input.value), tv=parseTime(input.value);
    current={input:input,type:type,pop:pop,view:dv||new Date(),date:dv,time:tv};

    var parts='';
    if(type!=='time') parts+='<div class="mdt-cal"></div>';
    if(type!=='date') parts+='<div class="mdt-time"></div>';
    var footCls='mdt-foot'+(type==='time'?' mdt-foot-time':'');
    var foot='<div class="'+footCls+'">';
    if(type!=='time') foot+='<button type="button" class="mdt-now">Vandaag</button>';
    else foot+='<button type="button" class="mdt-now">Nu</button>';
    foot+='<div class="mdt-btns"><button type="button" class="mdt-btn mdt-btn-clear">Wissen</button>'
        +'<button type="button" class="mdt-btn mdt-btn-ok">Klaar</button></div></div>';

    // datetime: kalender + tijd naast elkaar, met gedeelde voet eronder
    if(type==='datetime-local'){
      pop.style.flexDirection='column';
      pop.innerHTML='<div style="display:flex;gap:14px"><div class="mdt-cal"></div><div class="mdt-time"></div></div>'+foot;
    } else {
      pop.innerHTML='<div style="display:flex;flex-direction:column">'+parts+foot+'</div>';
    }

    document.body.appendChild(pop);
    if(type!=='time') renderCal();
    if(type!=='date') renderTime();
    position(input,pop);

    pop.addEventListener('click', onPop);
    document.addEventListener('mousedown', onDoc, true);
    window.addEventListener('resize', close);
    window.addEventListener('scroll', close, true);
  }

  function position(input,pop){
    var r=input.getBoundingClientRect(), pr=pop.getBoundingClientRect();
    var top=r.bottom+6, left=r.left;
    if(top+pr.height>window.innerHeight-8) top=Math.max(8, r.top-pr.height-6);
    if(left+pr.width>window.innerWidth-8) left=Math.max(8, window.innerWidth-pr.width-8);
    pop.style.top=top+'px'; pop.style.left=left+'px';
  }

  function onPop(e){
    var t=e.target.closest('button'); if(!t) return;
    var c=current;
    if(t.dataset.mv){ c.view=new Date(c.view.getFullYear(), c.view.getMonth()+ (+t.dataset.mv), 1); renderCal(); return; }
    if(t.dataset.d){ c.date=parseDate(t.dataset.d); renderCal(); if(c.type==='date'){ commit(); close(); } return; }
    if(t.dataset.h!=null){ c.time=c.time||{h:0,min:0}; c.time.h=+t.dataset.h; renderTime(); if(c.type==='time') commit(); return; }
    if(t.dataset.min!=null){ c.time=c.time||{h:0,min:0}; c.time.min=+t.dataset.min; renderTime(); if(c.type==='time') commit(); return; }
    if(t.classList.contains('mdt-now')){
      var n=new Date();
      if(c.type!=='time'){ c.date=n; c.view=n; renderCal(); }
      if(c.type!=='date'){ c.time={h:n.getHours(),min:Math.round(n.getMinutes()/5)*5%60}; renderTime(); }
      if(c.type==='date'||c.type==='time'){ commit(); close(); }
      return;
    }
    if(t.classList.contains('mdt-btn-clear')){ c.input.value=''; c.input.dispatchEvent(new Event('input',{bubbles:true})); c.input.dispatchEvent(new Event('change',{bubbles:true})); close(); return; }
    if(t.classList.contains('mdt-btn-ok')){ commit(); close(); return; }
  }

  // ── Inhaken op native inputs (delegatie) ───────────────────────────────────
  function intercept(e){
    var inp=e.target;
    if(!inp || !inp.matches || !inp.matches(SEL) || inp.disabled || inp.readOnly) return;
    if(typeof inp.showPicker==='function') { try{ inp.__noPicker=true; }catch(_){} }
    e.preventDefault();
    if(current && current.input===inp){ return; }
    open(inp);
  }
  document.addEventListener('mousedown', intercept, true);
  // toetsenbord: open op Enter / pijl-omlaag, maar laat typen toe
  document.addEventListener('keydown', function(e){
    var inp=e.target;
    if(!inp || !inp.matches || !inp.matches(SEL)) return;
    if(e.key==='Enter' || e.key==='ArrowDown'){ e.preventDefault(); open(inp); }
    else if(e.key==='Escape') close();
  }, true);
})();
