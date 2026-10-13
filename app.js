/* Hall Pass — classroom sign-out board.
   The resting screen is the whole room status. Everything else is a short
   detour that returns to it. All data stays on this device.

   Each class has its own roster and its own meeting times; the board shows
   whichever class the clock says is in the room. Student PINs are per class,
   so two Elijahs in different classes never share one. */
(function(){
"use strict";

/* ========================= storage ========================= */

var KEY="hallpass.v1";
var SEED_VERSION=2;      /* bump to offer new seed classes to an existing board */

/* Each destination carries its own mark and colour: at a glance, from a queue
   by the door, the shape is what a student reads, not the word. */
var REASONS=[
 {k:"bathroom",label:"Bathroom",pass:true,big:true,c:"#2E6FB7",
  icon:'<path d="M6 3h12v18H6z"/><circle cx="14.6" cy="12" r="1.1" fill="currentColor" stroke="none"/>'},
 {k:"nurse",label:"Nurse",pass:false,c:"#C2415A",
  icon:'<rect x="3" y="7.5" width="18" height="12.5" rx="2"/><path d="M9 7.5V5h6v2.5M12 11.2v5M9.5 13.7h5"/>'},
 {k:"office",label:"Office",pass:false,c:"#6A4FB6",
  icon:'<rect x="4" y="3" width="16" height="18" rx="1.5"/><path d="M8 7.5h3M13 7.5h3M8 12h3M13 12h3M10 21v-4h4v4"/>'},
 {k:"resource",label:"Resource",pass:false,c:"#1F6B42",
  icon:'<path d="M4 4.8A2.8 2.8 0 0 1 6.8 2H20v20H6.8A2.8 2.8 0 0 1 4 19.2z"/><path d="M4 17.4h16"/>'},
 {k:"item",label:"Get something",pass:false,c:"#C97A16",
  icon:'<path d="M3 8.2l9-5 9 5-9 5z"/><path d="M3 8.2v7.6l9 5 9-5V8.2"/>'},
 {k:"other",label:"Other",pass:false,c:"#6B6A63",
  icon:'<circle cx="6" cy="12" r="1.5" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none"/><circle cx="18" cy="12" r="1.5" fill="currentColor" stroke="none"/>'}
];
var WALK_ICON='<path d="M10 3H4.5v18H10"/><path d="M14.5 8l4 4-4 4"/><path d="M18 12H9"/>';
function reasonOf(k){
  for(var i=0;i<REASONS.length;i++){if(REASONS[i].k===k)return REASONS[i]}
  return REASONS[REASONS.length-1];
}

/* The starting classes come from seed-classes.js, which the hosted copy ships
   empty so no student names are ever published. */
var SEED_CLASSES=window.HALLPASS_SEED||[];

function defaults(){
  return {
    classes:[],             /* {id,name,meets:[{d,s,e}],roster:[names]} */
    out:[],                 /* {id,nm,clsId,cls,reason,at,pin,override} */
    inRoom:null,            /* {clsId,day}: a class the teacher switched to by hand */
    log:[],
    limits:{bathroom:1,nurse:1,office:1,resource:1,item:1,other:1},
    settings:{pin:"1234",maxOut:1,longOut:10,quiet:10,
              openLabel:"OPEN",occLabel:"SOMEONE IS OUT",room:""},
    seed:0
  };
}

var S=defaults(),storageBroken=false;

function load(){
  try{
    var raw=window.localStorage.getItem(KEY);
    if(raw){
      var p=JSON.parse(raw),d=defaults(),k;
      for(k in d){if(!(k in p))p[k]=d[k]}
      for(k in d.settings){if(!(k in p.settings))p.settings[k]=d.settings[k]}
      for(k in d.limits){if(!(k in p.limits))p.limits[k]=d.limits[k]}
      S=p;
    }
  }catch(e){storageBroken=true}

  /* A board from before classes existed: keep its roster as one class. */
  if(S.roster&&S.roster.length&&!S.classes.length){
    S.classes.push({id:uid(),name:"My class",meets:[],roster:S.roster.slice()});
  }
  delete S.roster;delete S.periods;
  delete S.pins;          /* PINs are made fresh for each trip now */

  /* Add any seed class the board hasn't got yet, without touching the rest. */
  if(S.seed!==SEED_VERSION){
    SEED_CLASSES.forEach(function(sc){
      for(var i=0;i<S.classes.length;i++){
        if(S.classes[i].name.toLowerCase()===sc.name.toLowerCase())return;
      }
      S.classes.push({id:uid(),name:sc.name,
        meets:sc.meets.map(function(m){return {d:m.d,s:m.s,e:m.e}}),
        roster:sc.roster.slice()});
    });
    S.seed=SEED_VERSION;
  }
  save();
}
function save(){
  try{window.localStorage.setItem(KEY,JSON.stringify(S))}catch(e){storageBroken=true}
}

/* ========================= time ========================= */

function now(){return Date.now()}
function fmt(ms){
  var d=new Date(ms),h=d.getHours(),m=d.getMinutes(),ap=h>=12?"PM":"AM",h12=h%12;
  if(h12===0)h12=12;
  return h12+":"+(m<10?"0":"")+m+" "+ap;
}
function fmtShort(ms){
  var d=new Date(ms),h=d.getHours(),m=d.getMinutes(),h12=h%12;
  if(h12===0)h12=12;
  return h12+":"+(m<10?"0":"")+m;
}
function minsSince(ms){return Math.max(0,(now()-ms)/60000)}
function outMins(o){return Math.max(1,Math.round(minsSince(o.at)))}
function pad(n){return (n<10?"0":"")+n}
function dayKey(ms){var d=new Date(ms);return d.getFullYear()+"-"+pad(d.getMonth()+1)+"-"+pad(d.getDate())}
function fmtDate(ms){
  var d=new Date(ms);
  return ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"][d.getDay()]+" "+d.getDate()+" "+
         ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][d.getMonth()];
}
/* "2:00 PM" or "9:42" -> minutes after midnight. A bare 1-7 reads as afternoon,
   the way a school timetable is written. */
function parseClock(str){
  var m=String(str).trim().match(/^(\d{1,2}):(\d{2})\s*(a|p|am|pm)?\.?$/i);
  if(!m)return null;
  var h=+m[1],mi=+m[2],ap=m[3]?m[3].toLowerCase()[0]:null;
  if(h>23||mi>59)return null;
  if(ap==="p"&&h<12)h+=12;
  else if(ap==="a"&&h===12)h=0;
  else if(!ap&&h>=1&&h<=7)h+=12;
  return h*60+mi;
}
var DAYLETTER=["","M","T","W","H","F",""];   /* Sun..Sat, H = Thursday */

/* Which class the clock says is in the room, or null. */
function scheduledClass(){
  var d=new Date(),mins=d.getHours()*60+d.getMinutes(),letter=DAYLETTER[d.getDay()];
  if(!letter)return null;
  for(var i=0;i<S.classes.length;i++){
    var c=S.classes[i],ms=c.meets||[];
    for(var j=0;j<ms.length;j++){
      var s=parseClock(ms[j].s),e=parseClock(ms[j].e);
      if(s==null||e==null)continue;
      if(String(ms[j].d||"").toUpperCase().indexOf(letter)<0)continue;
      if(mins>=s&&mins<e)return c;
    }
  }
  return null;
}
/* Which class the board is showing. The timetable runs it on an ordinary day;
   a class the teacher switched to by hand wins until they clear it, or until the
   day turns over. */
function handPicked(){
  if(!S.inRoom)return null;
  if(S.inRoom.day!==dayKey(now())){S.inRoom=null;save();return null}
  var c=classById(S.inRoom.clsId);
  if(!c){S.inRoom=null;save();return null}
  return c;
}
function activeClass(){return handPicked()||scheduledClass()}
function setInRoom(clsId){
  S.inRoom={clsId:clsId,day:dayKey(now())};save();
  remoteWrite("PUT","/inRoom",S.inRoom);
}
function clearInRoom(){S.inRoom=null;save();remoteWrite("PUT","/inRoom",null)}
/* Where we are inside the current period: how far in, how long left. Only the
   timetable counts here \u2014 a class put on the board by hand has no clock. */
function classWindow(){
  var c=scheduledClass();
  if(!c)return null;
  var d=new Date(),mins=d.getHours()*60+d.getMinutes(),letter=DAYLETTER[d.getDay()],ms=c.meets||[];
  for(var i=0;i<ms.length;i++){
    var st=parseClock(ms[i].s),e=parseClock(ms[i].e);
    if(st==null||e==null)continue;
    if(String(ms[i].d||"").toUpperCase().indexOf(letter)<0)continue;
    if(mins>=st&&mins<e)return {cls:c,start:st,end:e,sofar:mins-st,left:e-mins};
  }
  return null;
}
/* Nobody leaves in the first or last few minutes: it keeps the corridor empty
   while classes are changing over. */
function quietNow(){
  var n=S.settings.quiet;
  if(n==null)n=10;
  if(n<=0)return null;
  var w=classWindow();
  if(!w)return null;
  if(w.sofar<n){
    return {where:"start",short:"First "+n+" minutes of class",
            line:"First "+n+" minutes of class. Passes open at "+clockText(w.start+n)+"."};
  }
  if(w.left<=n){
    return {where:"end",short:"Last "+n+" minutes of class",
            line:"Last "+n+" minutes of class. No more passes this period."};
  }
  return null;
}
function clockText(mins){
  var h=Math.floor(mins/60)%24,m=mins%60,ap=h>=12?"PM":"AM",h12=h%12;
  if(h12===0)h12=12;
  return h12+":"+(m<10?"0":"")+m+" "+ap;
}

function classById(id){
  for(var i=0;i<S.classes.length;i++){if(S.classes[i].id===id)return S.classes[i]}
  return null;
}
function meetsText(c){
  return (c.meets||[]).map(function(m){return m.d+" "+m.s+"–"+m.e}).join(", ");
}

/* ========================= helpers ========================= */

var $=function(s){return document.querySelector(s)};
function mk(t,c,x){var e=document.createElement(t);if(c)e.className=c;if(x!=null)e.textContent=x;return e}
function esc(s){return String(s==null?"":s).replace(/[&<>"']/g,function(c){
  return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]})}
function uid(){return Date.now().toString(36)+Math.random().toString(36).slice(2,7)}
function anyWalkout(){
  for(var i=0;i<S.out.length;i++){if(S.out[i].walk)return S.out[i]}
  return null;
}
function isOut(clsId,nm){
  for(var i=0;i<S.out.length;i++){
    if(S.out[i].nm===nm&&S.out[i].clsId===clsId)return S.out[i];
  }
  return null;
}

/* How many may be out at once, overall and per destination. Only the teacher
   can change these, or wave a single trip through with the teacher PIN. */
function limitFor(k){var v=S.limits[k];return (v==null||v<1)?1:v}
function countOut(k){var n=0;for(var i=0;i<S.out.length;i++){if(S.out[i].reason===k)n++}return n}
function blockedBecause(k){
  var q=quietNow();
  if(q)return q.short;
  if(S.out.length>=(S.settings.maxOut||1)){
    return (S.settings.maxOut||1)===1?"Someone is already out":"The room is at its limit";
  }
  if(countOut(k)>=limitFor(k))return "Already someone there";
  return null;
}

/* ========================= screens ========================= */

var IDS=["s0","s1","s2","s3","s5","shand","spin","steacher"],timer=null;
function show(id){
  if(timer){clearTimeout(timer);timer=null}
  for(var i=0;i<IDS.length;i++){$("#"+IDS[i]).hidden=(IDS[i]!==id)}
  if(id==="s0"||id==="s1")allowOnce=false;   /* an override never carries over */
  if(id==="s0")renderStatus();
  if(id==="s1")renderRoster();
}
function idle(ms){
  if(timer)clearTimeout(timer);
  timer=setTimeout(function(){show("s0")},ms);
}

/* ---- S0 : the room status ---- */
function renderStatus(){
  var st=S.settings,anyOut=S.out.length>0,walk=anyWalkout(),quiet=quietNow();
  /* Read across the room: green clear, red closed or someone signed out,
     yellow someone is unaccounted for. A walkout outranks the rest. */
  $("#s0").className="screen status "+(walk?"walk":(anyOut||quiet)?"occ":"open");
  $("#s0clock").textContent=fmtShort(now());

  var word;
  if(!anyOut&&quiet)word="NO PASSES";
  else if(!anyOut)word=st.openLabel||"OPEN";
  else if(walk&&S.out.length===1)word="SOMEONE WALKED OUT";
  else if(S.out.length===1)word=st.occLabel||"SOMEONE IS OUT";
  else word=S.out.length+" STUDENTS ARE OUT";
  var w=$("#s0word");
  w.textContent=word;
  w.className="statusword"+(word.length>8?" sm":"");

  /* The reason stays on screen even when somebody is already out, because it
     is the bit a student walking up needs to read. */
  $("#s0line").textContent=quiet?quiet.line:"No one is out of the room";
  $("#s0line").hidden=!quiet&&anyOut;

  var who=$("#s0who");who.innerHTML="";
  S.out.forEach(function(o){
    var m=outMins(o),box=mk("div");
    box.appendChild(mk("div","wname",o.nm));
    box.appendChild(mk("div","wdet"+(m>=(st.longOut||10)?" long":""),
      (o.walk?"Walked out — not signed out":reasonOf(o.reason).label)+
      " · "+m+" min"+(o.cls?" · "+o.cls:"")));
    who.appendChild(box);
  });

  var c=activeClass(),label=c?c.name:(st.room||"");
  $("#s0class").textContent=label;
  $("#s0class").hidden=!label;
  $("#s0hint").textContent=anyOut?"Tap anywhere to sign back in":
    (quiet?"Nobody leaves right now":"Tap anywhere to sign out");
}
$("#s0").addEventListener("click",function(e){
  if(e.target.closest("#hotcorner"))return;
  show("s1");
  idle(25000);
});

/* ---- S1 : the name grid ---- */
/* Lay the roster out to fill the page whatever the class size: try every
   column count, and keep the one that puts the most tile on the screen.
   Dividing evenly wins on its own, because a short last row wastes area. */
function fitRoster(){
  var g=$("#grid"),n=g.querySelectorAll(".tile").length;
  if(!n)return;
  var W=g.clientWidth,H=g.clientHeight;
  if(!W||!H)return;
  var gap=Math.max(6,Math.round(Math.min(W,H)*0.014)),best=null;
  for(var c=2;c<=Math.min(9,n);c++){
    var rows=Math.ceil(n/c),
        tw=(W-(c-1)*gap)/c,
        th=(H-(rows-1)*gap)/rows;
    if(tw<88||th<46)continue;                 /* still a fingertip target */
    var ar=tw/th;
    if(ar<0.55||ar>4.4)continue;              /* no slivers, no columns */
    var score=tw*th*(n/(c*rows));             /* area actually used */
    if(!best||score>best.score)best={c:c,rows:rows,tw:tw,th:th,score:score};
  }
  if(!best){
    var c2=Math.max(2,Math.min(6,Math.round(W/150)));
    best={c:c2,rows:Math.ceil(n/c2),tw:W/c2,th:H/Math.ceil(n/c2)};
  }
  g.style.gap=gap+"px";
  g.style.gridTemplateColumns="repeat("+best.c+",1fr)";
  g.style.gridTemplateRows="repeat("+best.rows+",1fr)";
  g.style.setProperty("--tilefont",
    Math.max(12,Math.min(best.th*0.3,best.tw*0.16,36)).toFixed(1)+"px");
}
window.addEventListener("resize",function(){if(!$("#s1").hidden)fitRoster()});

function renderRoster(){
  $("#clock").textContent=fmtShort(now());
  var c=activeClass(),g=$("#grid");
  g.innerHTML="";
  g.style.gap="";g.style.gridTemplateColumns="";g.style.gridTemplateRows="";

  if(!S.classes.length){
    $("#bartitle").textContent="Tap your name";
    g.appendChild(mk("div","emptyroster",
      "No classes yet.\nPress and hold the top-right corner of the status screen to open the teacher panel, then add a class."));
    return;
  }
  if(!c){
    $("#bartitle").textContent="No class right now";
    g.appendChild(mk("div","emptyroster",
      "The timetable has no class in the room at the moment.\nIf this is an off day, your teacher can switch the board to the right class."));
    return;
  }

  $("#bartitle").textContent="Tap your name · "+c.name;
  if(!c.roster.length){
    g.appendChild(mk("div","emptyroster",
      c.name+" has no students yet.\nAdd them in the teacher panel, under Students."));
    return;
  }
  c.roster.forEach(function(nm){
    var b=mk("button","tile"+(isOut(c.id,nm)?" isout":""));
    b.appendChild(mk("span",null,nm));
    b.addEventListener("click",function(){tapName(c,nm)});
    g.appendChild(b);
  });
  fitRoster();
}

/* Set by the teacher on the way through the override; it lasts for this one
   student's trip and is dropped the moment the board comes back to rest. */
var allowOnce=false;
var KEY_ICON='<circle cx="8" cy="15" r="4"/><path d="M10.8 12.2L20 3"/><path d="M17 6l2.5 2.5"/>';

function iconSvg(paths,cls){
  var w=mk("span",cls||"ricon");
  w.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true">'+paths+'</svg>';
  return w;
}

function tapName(c,nm){
  var o=isOut(c.id,nm);
  if(o){askReturn(o);return}
  $("#s2name").textContent=nm;

  /* One line at the top carries the reason nobody else can go, so the little
     cards underneath only have to say what to do about it. */
  var walk=anyWalkout(),caut=$("#s2caution"),others=S.out.length,quiet=quietNow();
  if(allowOnce){
    caut.hidden=false;
    caut.className="caution ok";
    caut.textContent="Your teacher allowed this one. Pick where you are going.";
  }else if(quiet){
    caut.hidden=false;
    caut.className="caution warn";
    caut.textContent=quiet.line+" Your teacher can still let you go.";
  }else if(walk){
    caut.hidden=false;
    caut.className="caution warn";
    caut.textContent=walk.nm+" walked out and is not back. Be careful letting anyone else go \u2014 your teacher has to allow it.";
  }else if(others&&others>=(S.settings.maxOut||1)){
    caut.hidden=false;
    caut.className="caution";
    caut.textContent=(others===1?S.out[0].nm+" is already out.":others+" students are already out.")+
      " Your teacher can still let you go.";
  }else{
    caut.hidden=true;
  }

  var box=$("#reasons");box.innerHTML="";
  REASONS.forEach(function(r){
    var why=allowOnce?null:blockedBecause(r.k),
        b=mk("button","rbtn"+(r.big?" big":"")+(why?" full":""));
    b.style.setProperty("--rc",r.c);
    b.appendChild(iconSvg(r.icon));
    b.appendChild(mk("span","rlabel",r.label));
    /* Only say something when there is something to say: "no pass" on five of
       six cards was noise. */
    var note=why?"Ask your teacher":(r.pass?"Takes the pass":"");
    if(note)b.appendChild(mk("small",null,note));
    b.addEventListener("click",function(){
      if(why)askOverride(c,nm,r.k,why);
      else beginSignOut(c,nm,r.k,allowOnce);
    });
    box.appendChild(b);
  });

  /* Last card in the grid, the same size as the rest but red: it belongs with
     the destinations, it just isn't one of them. */
  var wb=mk("button","rbtn walkoutbtn");
  wb.appendChild(iconSvg(WALK_ICON));
  wb.appendChild(mk("span","rlabel","Walked out"));
  wb.appendChild(mk("small",null,"Teacher PIN"));
  wb.addEventListener("click",function(){askWalkout(c,nm)});
  box.appendChild(wb);

  /* When the board is shut, the way through is a button of its own rather than
     a student guessing that a greyed-out card is still tappable. */
  var ob=$("#overridebtn"),shut=!allowOnce&&!!blockedBecause("bathroom");
  ob.hidden=!shut;
  if(shut){
    ob.innerHTML="";
    ob.appendChild(iconSvg(KEY_ICON,"ricon"));
    ob.appendChild(mk("span","rlabel","Teacher override"));
    ob.appendChild(mk("small",null,"Let this one student go"));
    ob.onclick=function(){
      askPin("Teacher override",
        (quietNow()?quietNow().line+" ":"")+"Teacher PIN to let "+nm+" go anyway.",
        function(code){return code===String(S.settings.pin)?null:"That is not the teacher PIN."},
        function(){allowOnce=true;handBack(nm,function(){tapName(c,nm)})},
        null,"teacherpin");
    };
  }

  show("s2");
  idle(20000);
}

/* A walkout is recorded by the teacher, and puts the student on the board as
   out of the room, because that is what they are. */
function askWalkout(c,nm){
  askPin("Record a walkout",
    nm+" left without signing out? Teacher PIN to record it.",
    function(code){return code===String(S.settings.pin)?null:"That is not the teacher PIN."},
    function(){recordWalkout(c,nm)},
    null,"teacherpin");
}
function recordWalkout(c,nm){
  var t=now(),rec={id:uid(),nm:nm,clsId:c.id,cls:c.name,reason:"other",at:t,walk:true};
  var entry={id:rec.id,nm:nm,cls:c.name,reason:"other",out:t,back:null,
             type:"walkout",day:dayKey(t)};
  S.out.push(rec);
  S.log.push(entry);
  save();
  remoteWrite("PUT","/out/"+rec.id,rec);
  remoteWrite("PUT","/log/"+rec.id,entry);
  $("#s3name").textContent=nm;
  $("#s3time").textContent=fmt(t);
  $("#s3reason").textContent="Recorded as walked out";
  $("#s3pass").hidden=true;
  show("s3");
  idle(3400);
}

/* ---- signing out ---- */
/* A PIN is made fresh for each trip and thrown away on the way back in, so
   there is nothing for a student to remember between trips, and nothing for the
   teacher to reset. */
function newTripPin(nm,then){
  askPin("Make a PIN for this trip",
    nm+", pick 4 digits. You need them to sign back in, so keep them in your head.",
    null,
    function(first){
      askPin("Type it again","Just to be sure.",
        function(second){return second===first?null:"Those two did not match. Start again."},
        function(){then(first)},
        function(){newTripPin(nm,then)});
    });
}
function beginSignOut(c,nm,rk,over){
  newTripPin(nm,function(code){finishSignOut(c,nm,rk,!!over,code)});
}

function finishSignOut(c,nm,rk,override,code){
  var r=reasonOf(rk),t=now(),
      rec={id:uid(),nm:nm,clsId:c.id,cls:c.name,reason:rk,at:t,pin:code,override:!!override};
  var entry={id:rec.id,nm:nm,cls:c.name,reason:rk,out:t,back:null,type:"departure",
             day:dayKey(t),override:!!override};
  S.out.push(rec);
  S.log.push(entry);
  save();
  remoteWrite("PUT","/out/"+rec.id,rec);
  remoteWrite("PUT","/log/"+rec.id,entry);
  $("#s3name").textContent=nm;
  $("#s3time").textContent=fmt(t);
  $("#s3reason").textContent="Signed out to "+
    (rk==="item"?"get something":rk==="bathroom"?"the bathroom":"the "+r.label.toLowerCase());
  $("#s3pass").hidden=!r.pass;
  show("s3");
  idle(3400);
}

/* Only the teacher PIN can wave a trip through when the room is at its limit.
   Her keypad is red so she can see it is hers, and the board waits on a hand-back
   screen afterwards rather than dropping the student straight into a PIN pad. */
function askOverride(c,nm,rk,why){
  askPin("Teacher override",
    why+". Your teacher can allow this — ask them to enter their PIN.",
    function(code){return code===String(S.settings.pin)?null:"That is not the teacher PIN."},
    function(){
      handBack(nm,function(){
        newTripPin(nm,function(code){finishSignOut(c,nm,rk,true,code)});
      });
    },
    null,"teacherpin");
}

/* "Allowed — hand it back to Dagim", and nothing happens until someone taps. */
var handThen=null;
function handBack(nm,then){
  handThen=then;
  $("#handname").textContent=nm;
  $("#handbtn").textContent="I have it — carry on";
  show("shand");
  idle(45000);
}
$("#handbtn").addEventListener("click",function(){
  var f=handThen;handThen=null;
  if(f)f();
});

/* ---- coming back ---- */
function askReturn(o){
  if(o.walk){
    /* They never made a PIN on the way out, so the teacher signs them back in. */
    askPin(o.nm+" is back",
      "They walked out, so there is no PIN. Teacher PIN to sign them back in.",
      function(code){return code===String(S.settings.pin)?null:"That is not the teacher PIN."},
      function(){doReturn(o)},
      null,"teacherpin");
    return;
  }
  if(!o.pin){doReturn(o);return}   /* signed out before trip PINs existed */
  askPin(o.nm,"Enter the PIN you made on the way out.",
    function(code){return code===String(o.pin)?null:"That is not the PIN you made."},
    function(){doReturn(o)});
}

/* The one place a trip is closed off, so the board and the panel can never
   disagree about it. */
function applyReturn(o){
  var t=now(),dur=outMins(o);
  S.out=S.out.filter(function(x){return x.id!==o.id});
  for(var i=0;i<S.log.length;i++){
    if(S.log[i].id===o.id){S.log[i].back=t;S.log[i].dur=dur;break}
  }
  save();
  remoteWrite("DELETE","/out/"+o.id);
  remoteWrite("PATCH","/log/"+o.id,{back:t,dur:dur});
  return {t:t,dur:dur};
}

function doReturn(o){
  var r=applyReturn(o),t=r.t,dur=r.dur;
  $("#s5name").textContent=o.nm;
  $("#s5time").textContent=fmt(t);
  $("#s5dur").textContent=(o.walk?"Back after ":"Out for ")+dur+(dur===1?" minute":" minutes");
  show("s5");
  idle(3400);
}

/* ========================= the PIN pad ========================= */

var pin={buf:"",check:null,done:null,fail:null};

function drawPin(bad){
  var d=$("#pindots");d.innerHTML="";d.className="pindots"+(bad?" bad":"");
  for(var i=0;i<4;i++){d.appendChild(mk("i",i<pin.buf.length?"on":null))}
}
/* check(code) returns null to accept, or a message to show. done(code) runs on
   accept; fail() runs instead of re-asking when check rejects, if given. */
function askPin(title,hint,check,done,fail,tone){
  pin.buf="";pin.check=check||null;pin.done=done;pin.fail=fail||null;
  $("#spin").className="screen sheet pinscreen"+(tone?" "+tone:"");
  $("#pintitle").textContent=title;
  $("#pinhint").textContent=hint;
  drawPin(false);
  show("spin");
  idle(30000);
}
function pinEntered(){
  var code=pin.buf,msg=pin.check?pin.check(code):null;
  pin.buf="";
  if(msg){
    drawPin(true);
    $("#pinhint").textContent=msg;
    if(pin.fail){var f=pin.fail;pin.fail=null;setTimeout(f,900)}
    idle(30000);
    return;
  }
  drawPin(false);
  var d=pin.done;pin.done=null;pin.check=null;pin.fail=null;
  if(d)d(code);
}
function buildKeypad(){
  var k=$("#keypad");k.innerHTML="";
  ["1","2","3","4","5","6","7","8","9","clear","0","del"].forEach(function(key){
    var b=mk("button","kb"+(key==="clear"||key==="del"?" wide":""),
             key==="clear"?"CLEAR":key==="del"?"⌫":key);
    b.addEventListener("click",function(){
      if(key==="clear")pin.buf="";
      else if(key==="del")pin.buf=pin.buf.slice(0,-1);
      else if(pin.buf.length<4)pin.buf+=key;
      drawPin(false);
      idle(30000);
      if(pin.buf.length===4)setTimeout(pinEntered,120);
    });
    k.appendChild(b);
  });
}

/* Long press the invisible corner, so a student leaning on it does nothing. */
(function(){
  var hc=$("#hotcorner"),t=null;
  function down(e){
    e.stopPropagation();
    t=setTimeout(function(){
      t=null;
      askPin("Teacher access","Enter your PIN",
        function(code){return code===String(S.settings.pin)?null:"Not that PIN. Try again."},
        function(){openTeacher("room")});
    },900);
  }
  function up(){if(t){clearTimeout(t);t=null}}
  hc.addEventListener("touchstart",down,{passive:true});
  hc.addEventListener("touchend",up);
  hc.addEventListener("touchcancel",up);
  hc.addEventListener("mousedown",down);
  hc.addEventListener("mouseup",up);
  hc.addEventListener("mouseleave",up);
  hc.addEventListener("click",function(e){e.stopPropagation()});
})();

/* ========================= sharing between devices ========================= */
/* One board, many devices. Writes go to a Firebase Realtime Database over plain
   REST; reads come back on an EventSource stream, so a walkout marked on a phone
   turns the iPad yellow a second later with nothing to refresh.

   Local storage stays the source of truth for drawing the screen, so a dropped
   connection never blanks the board. Writes that fail are queued and replayed. */

var SYNCKEY="hallpass.sync";
var sync={url:"",board:"",es:null,status:"off",queue:[],flushing:false,seeded:false};
var remote={};

function syncOn(){return !!(sync.url&&sync.board)}
function syncBase(){
  return sync.url.replace(/\/+$/,"")+"/boards/"+encodeURIComponent(sync.board);
}
function syncLoadCfg(){
  try{
    var c=JSON.parse(window.localStorage.getItem(SYNCKEY)||"{}");
    sync.url=c.url||"";sync.board=c.board||"";sync.queue=c.queue||[];
  }catch(e){}
}
function syncSaveCfg(){
  try{
    window.localStorage.setItem(SYNCKEY,
      JSON.stringify({url:sync.url,board:sync.board,queue:sync.queue}));
  }catch(e){}
}
function setStatus(st){
  if(sync.status===st)return;
  sync.status=st;
  if(!$("#steacher").hidden&&curPane==="sync")drawPane();
}

/* ---- writing ---- */
function remoteWrite(method,path,value){
  if(!syncOn())return;
  sync.queue.push({m:method,p:path,v:value===undefined?null:value});
  if(sync.queue.length>400)sync.queue.splice(0,sync.queue.length-400);
  syncSaveCfg();
  flushQueue();
}
function flushQueue(){
  if(!syncOn()||sync.flushing||!sync.queue.length)return;
  sync.flushing=true;
  var job=sync.queue[0],opts={method:job.m};
  if(job.m!=="DELETE"){opts.body=JSON.stringify(job.v);opts.headers={"Content-Type":"application/json"}}
  fetch(syncBase()+job.p+".json",opts).then(function(r){
    if(!r.ok)throw new Error(r.status);
    sync.queue.shift();syncSaveCfg();sync.flushing=false;
    if(sync.queue.length)flushQueue();
    else setStatus(sync.es?"live":"saved");
  }).catch(function(){
    sync.flushing=false;setStatus("offline");
  });
}

/* ---- reading ---- */
function pathSet(obj,path,data,patch){
  if(path==="/"){
    if(!patch){for(var k in obj)delete obj[k]}
    if(data)for(var k2 in data)obj[k2]=data[k2];
    return;
  }
  var parts=path.split("/").filter(function(x){return x.length}),cur=obj;
  for(var i=0;i<parts.length-1;i++){
    if(!cur[parts[i]]||typeof cur[parts[i]]!=="object")cur[parts[i]]={};
    cur=cur[parts[i]];
  }
  var last=parts[parts.length-1];
  if(data===null&&!patch)delete cur[last];
  else if(patch&&cur[last]&&typeof cur[last]==="object"){for(var k3 in data)cur[last][k3]=data[k3]}
  else cur[last]=data;
}
function mapToArr(m){
  if(!m)return [];
  if(Object.prototype.toString.call(m)==="[object Array]")return m.filter(Boolean);
  return Object.keys(m).map(function(k){return m[k]}).filter(Boolean);
}
function arrToMap(a){
  var m={};(a||[]).forEach(function(x){if(x&&x.id)m[x.id]=x});return m;
}

function adoptRemote(){
  var empty=!remote||!Object.keys(remote).length;
  if(empty){
    /* Nothing up there yet: this device seeds the board. */
    if(!sync.seeded){
      sync.seeded=true;
      remoteWrite("PUT","/out",arrToMap(S.out));
      remoteWrite("PUT","/log",arrToMap(S.log));
      remoteWrite("PUT","/classes",S.classes);
      remoteWrite("PUT","/settings",S.settings);
      remoteWrite("PUT","/limits",S.limits);
      remoteWrite("PUT","/inRoom",S.inRoom);
    }
    return;
  }
  sync.seeded=true;
  S.out=mapToArr(remote.out);
  S.log=mapToArr(remote.log);
  if(remote.classes)S.classes=remote.classes;
  if(remote.limits)S.limits=remote.limits;
  if(remote.settings){
    var d=defaults().settings,k;
    for(k in d){if(!(k in remote.settings))remote.settings[k]=d[k]}
    S.settings=remote.settings;
  }
  S.inRoom=remote.inRoom||null;
  save();
  redraw();
}
function redraw(){
  if(!$("#s0").hidden)renderStatus();
  else if(!$("#s1").hidden)renderRoster();
  else if(!$("#steacher").hidden)drawPane();
}

function syncConnect(){
  if(sync.es){try{sync.es.close()}catch(e){}sync.es=null}
  if(!syncOn()||typeof window.EventSource==="undefined"){setStatus("off");return}
  setStatus("connecting");
  try{
    var es=new EventSource(syncBase()+".json");
    sync.es=es;
    es.addEventListener("put",function(e){
      try{var m=JSON.parse(e.data);pathSet(remote,m.path,m.data,false);adoptRemote()}catch(err){}
    });
    es.addEventListener("patch",function(e){
      try{var m=JSON.parse(e.data);pathSet(remote,m.path,m.data,true);adoptRemote()}catch(err){}
    });
    es.addEventListener("open",function(){setStatus("live");flushQueue()});
    es.onerror=function(){
      setStatus("offline");
      /* EventSource reconnects on its own; nudge the write queue too. */
      flushQueue();
    };
  }catch(e){setStatus("offline")}
}

/* The browser throttles a backgrounded tab; pick straight back up on return. */
document.addEventListener("visibilitychange",function(){
  if(!document.hidden&&syncOn()){flushQueue();if(!sync.es)syncConnect()}
});
setInterval(flushQueue,8000);

/* ========================= teacher panel ========================= */

var curPane="room";

function openTeacher(pane){
  if(pane!==curPane)stuDetail=null;
  curPane=pane||"room";
  var navs=document.querySelectorAll(".tnav");
  for(var i=0;i<navs.length;i++){
    navs[i].className="tnav"+(navs[i].getAttribute("data-pane")===curPane?" on":"");
  }
  show("steacher");
  drawPane();
}
document.addEventListener("click",function(e){
  var n=e.target.closest(".tnav");
  if(n){openTeacher(n.getAttribute("data-pane"));return}
  if(e.target.closest("[data-cancel]"))show("s0");
});

function drawPane(){
  var p=$("#pane");
  if(curPane==="room")paneRoom(p);
  else if(curPane==="out")paneOut(p);
  else if(curPane==="log")paneLog(p);
  else if(curPane==="students")paneStudents(p);
  else if(curPane==="limits")paneLimits(p);
  else if(curPane==="classes")paneClasses(p);
  else if(curPane==="sync")paneSync(p);
  else paneSettings(p);
}

/* ---- in the room ---- */
function paneRoom(p){
  var hand=handPicked(),sched=scheduledClass(),live=activeClass();
  var h='<h2>In the room</h2>'+
    '<p class="pnote">The board follows your timetable on its own — nothing to press. '+
    'Switch it by hand for an off day, a swap or an assembly; the switch lasts until you '+
    'clear it or the day ends.</p>'+
    '<p class="pnote">Timetable right now: <b>'+(sched?esc(sched.name):"no class")+'</b>'+
    (hand?' · switched by hand to <b>'+esc(hand.name)+'</b>':'')+'</p><div class="picker wrap">';
  S.classes.forEach(function(c){
    var on=live&&live.id===c.id;
    h+='<button class="pickbtn'+(on?" on":"")+'" data-room="'+esc(c.id)+'">'+
      '<span>'+esc(c.name)+'</span><small>'+esc(meetsText(c)||"no meeting times set")+'</small>'+
      (on?'<small class="nowtag">on the board now</small>':'')+'</button>';
  });
  h+='</div><div class="row" style="margin-top:2.2vh">'+
    (hand?'<button class="btn ghost" id="clearroom">Go back to the timetable</button>':'')+
    '<span id="roommsg" class="ok"></span></div>';
  p.innerHTML=h;
  p.querySelectorAll("[data-room]").forEach(function(b){
    b.addEventListener("click",function(){setInRoom(b.getAttribute("data-room"));drawPane()});
  });
  var cr=$("#clearroom");
  if(cr)cr.addEventListener("click",function(){clearInRoom();drawPane()});
}

/* ---- still out ---- */
function paneOut(p){
  var c=activeClass();
  var h='<h2>Still out</h2><p class="pnote">'+
    (c?'In the room now: <b>'+esc(c.name)+'</b>. ':'No class in the room right now. ')+
    'Marking someone back here does not ask for a PIN — it is the way round a '+
    'forgotten one. A walkout is recorded on the board: tap the screen, tap their '+
    'name, then <b>Walked out</b>.</p>';
  if(!S.out.length){h+='<p class="ok">Everybody is in the room.</p>'}
  else{
    h+='<table class="t"><tr><th>Student</th><th>Class</th><th>Reason</th><th>Left</th><th>Out for</th><th></th></tr>';
    S.out.forEach(function(o){
      h+='<tr'+(o.walk?' class="walk"':'')+'><td><b>'+esc(o.nm)+'</b></td><td>'+
         esc(o.cls||"")+'</td><td>'+
         (o.walk?'<span class="badge walk">walked out</span>':esc(reasonOf(o.reason).label))+
         (o.override?' <span class="badge pass">override</span>':'')+
         '</td><td class="tnum">'+fmt(o.at)+'</td><td class="tnum">'+outMins(o)+' min</td>'+
         '<td><button class="btn" data-back="'+esc(o.id)+'">Mark back</button></td></tr>';
    });
    h+='</table>';
  }
  p.innerHTML=h;
  p.querySelectorAll("[data-back]").forEach(function(b){
    b.addEventListener("click",function(){
      var id=b.getAttribute("data-back"),o=null;
      S.out.forEach(function(x){if(x.id===id)o=x});
      if(!o)return;
      applyReturn(o);
      drawPane();
    });
  });
}

/* ---- log ---- */
/* Nothing is ever thrown away: every day the board has seen is still here, and
   the strip of dates is how you get back to it. */
var logDay=null;
function dayLabel(key){
  var p=key.split("-"),d=new Date(+p[0],+p[1]-1,+p[2]);
  if(key===dayKey(now()))return "Today";
  if(key===dayKey(now()-86400000))return "Yesterday";
  return fmtDate(d.getTime());
}
function dayFull(key){
  var p=key.split("-");
  return fmtDate(new Date(+p[0],+p[1]-1,+p[2]).getTime());
}
function paneLog(p){
  var today=dayKey(now()),days=[],seen={};
  S.log.forEach(function(r){if(r.day&&!seen[r.day]){seen[r.day]=1;days.push(r.day)}});
  var realDays=days.length;
  if(!seen[today])days.push(today);
  days.sort().reverse();
  if(!logDay||(!seen[logDay]&&logDay!==today))logDay=today;

  var rows=S.log.filter(function(r){return r.day===logDay});
  rows.sort(function(a,b){return b.out-a.out});

  var h='<h2>Log</h2><p class="pnote">Every day the board has been used is kept on this '+
    'device — nothing is cleared overnight. The export covers all of them.</p>'+
    '<div class="row"><button class="btn" id="csvdl">Download CSV</button>'+
    '<button class="btn ghost" id="csvcopy">Copy CSV</button>'+
    '<span class="tnum" style="opacity:.55">'+S.log.length+' records over '+realDays+
    (realDays===1?' day':' days')+'</span></div>';

  h+='<div class="days">';
  days.forEach(function(d){
    var n=0;S.log.forEach(function(r){if(r.day===d)n++});
    h+='<button class="day'+(d===logDay?" on":"")+'" data-day="'+esc(d)+'">'+
       esc(dayLabel(d))+'<small>'+n+'</small></button>';
  });
  h+='</div>';

  h+='<p class="pnote" style="margin-top:2.2vh"><b>'+esc(dayFull(logDay))+'</b> · '+
     rows.length+(rows.length===1?' record':' records')+'</p>';
  if(!rows.length){h+='<p class="pnote">Nothing on this day.</p>'}
  else{
    h+='<table class="t"><tr><th>Out</th><th>Student</th><th>Class</th><th>Reason</th><th>Back</th><th>Minutes</th></tr>';
    rows.forEach(function(r){
      var isWalk=r.type==="walkout";
      h+='<tr'+(isWalk?' class="walk"':'')+'><td class="tnum">'+fmtShort(r.out)+
        '</td><td><b>'+esc(r.nm)+'</b></td><td>'+esc(r.cls||r.period||"")+'</td><td>'+
        (isWalk?'<span class="badge walk">walkout</span>':esc(reasonOf(r.reason).label))+
        (r.override?' <span class="badge pass">override</span>':'')+
        '</td><td class="tnum">'+
        (r.back?fmtShort(r.back):(isWalk?"—":'<span class="badge outnow">out now</span>'))+
        '</td><td class="tnum">'+(r.dur!=null?r.dur:"—")+'</td></tr>';
    });
    h+='</table>';
  }
  p.innerHTML=h;
  p.querySelectorAll("[data-day]").forEach(function(b){
    b.addEventListener("click",function(){logDay=b.getAttribute("data-day");drawPane()});
  });
  var dl=$("#csvdl"),cp=$("#csvcopy");
  if(dl)dl.addEventListener("click",downloadCSV);
  if(cp)cp.addEventListener("click",function(){copyText(buildCSV(),cp,"Copy CSV")});
}

function buildCSV(){
  var out=["date,time_out,time_back,minutes,student,class,reason,type,override"];
  S.log.slice().sort(function(a,b){return a.out-b.out}).forEach(function(r){
    out.push([r.day,fmtShort(r.out),r.back?fmtShort(r.back):"",r.dur!=null?r.dur:"",
      csvCell(r.nm),csvCell(r.cls||r.period||""),
      csvCell(r.type==="walkout"?"walkout":reasonOf(r.reason).label),
      r.type,r.override?"yes":""].join(","));
  });
  return out.join("\n");
}
function csvCell(v){
  v=String(v==null?"":v);
  return /[",\n]/.test(v)?'"'+v.replace(/"/g,'""')+'"':v;
}
function downloadCSV(){
  var blob=new Blob([buildCSV()],{type:"text/csv"}),url=URL.createObjectURL(blob);
  var a=document.createElement("a");
  a.href=url;a.download="hall-pass-"+dayKey(now())+".csv";
  document.body.appendChild(a);a.click();document.body.removeChild(a);
  setTimeout(function(){URL.revokeObjectURL(url)},2000);
}
function copyText(text,btn,label){
  function done(ok){
    btn.textContent=ok?"Copied":"Could not copy";
    setTimeout(function(){btn.textContent=label},1800);
  }
  if(navigator.clipboard&&navigator.clipboard.writeText){
    navigator.clipboard.writeText(text).then(function(){done(true)},function(){done(false)});
  }else{done(false)}
}

/* ---- students ---- */
/* The question a teacher actually has is not "how many trips in total" but
   "who is going every single lesson, and for how long". So: a range, a sort by
   frequency, a flag on the outliers, and one tap into that student's own log. */
var stuRange="month",stuDetail=null;

var RANGES=[{k:"month",label:"This month"},{k:"30",label:"Last 30 days"},{k:"all",label:"All time"}];
function rangeStart(k){
  var d=new Date();
  if(k==="month")return new Date(d.getFullYear(),d.getMonth(),1).getTime();
  if(k==="30")return now()-30*86400000;
  return 0;
}
function rangeLabel(k){
  for(var i=0;i<RANGES.length;i++){if(RANGES[i].k===k)return RANGES[i].label}
  return "All time";
}
function inRange(r,k){return r.out>=rangeStart(k)}

/* Days the board was actually used \u2014 the honest denominator. A day nobody
   touched it (holiday, snow day, forgotten iPad) should not count against
   anyone. */
function boardDays(k){
  var seen={},out=[];
  S.log.forEach(function(r){
    if(!inRange(r,k)||!r.day||seen[r.day])return;
    seen[r.day]=1;out.push(r.day);
  });
  return out;
}
function classMetDays(c,k){
  var letters="";
  (c.meets||[]).forEach(function(m){letters+=String(m.d||"").toUpperCase()});
  if(!letters)return [];
  return boardDays(k).filter(function(day){
    var p=day.split("-"),wd=new Date(+p[0],+p[1]-1,+p[2]).getDay();
    return letters.indexOf(DAYLETTER[wd])>=0;
  });
}

function statsFor(cls,nm,k){
  var a={trips:0,mins:0,walk:0,longest:0,days:{},rows:[]};
  S.log.forEach(function(r){
    if(r.nm!==nm||r.cls!==cls||!inRange(r,k))return;
    a.rows.push(r);
    a.days[r.day]=1;
    if(r.type==="walkout"){a.walk++;return}
    a.trips++;
    if(r.dur){a.mins+=r.dur;if(r.dur>a.longest)a.longest=r.dur}
  });
  a.dayCount=Object.keys(a.days).length;
  a.avg=a.trips?Math.round(a.mins/a.trips):0;
  a.rows.sort(function(x,y){return y.out-x.out});
  return a;
}

function paneStudents(p){
  if(stuDetail)return paneStudentDetail(p);
  if(!S.classes.length){
    p.innerHTML='<h2>Students</h2><p class="pnote">Add a class first, under Classes.</p>';
    return;
  }
  var k=stuRange;
  var h='<h2>Students</h2><p class="pnote">Who is leaving the room, how often, and for '+
    'how long. <b>Out of</b> counts the days that class met and the board was in use, so a '+
    'student marked 7 of 8 is going nearly every lesson. Tap a name for their own log.</p>'+
    '<div class="days">';
  RANGES.forEach(function(r){
    h+='<button class="day'+(r.k===k?" on":"")+'" data-range="'+r.k+'">'+esc(r.label)+'</button>';
  });
  h+='</div>';

  var anything=false;
  S.classes.forEach(function(c){
    if(!c.roster.length)return;
    var met=classMetDays(c,k).length;
    var list=c.roster.map(function(nm){
      var a=statsFor(c.name,nm,k);a.nm=nm;return a;
    });
    var active=list.filter(function(a){return a.trips||a.walk});
    var totalTrips=0;
    active.forEach(function(a){totalTrips+=a.trips});
    var avgTrips=active.length?totalTrips/active.length:0;
    list.sort(function(x,y){return y.trips-x.trips||y.mins-x.mins||x.nm.localeCompare(y.nm)});

    h+='<h2 style="margin-top:3.2vh">'+esc(c.name)+'</h2>'+
      '<p class="pnote">'+rangeLabel(k)+' \u00b7 '+totalTrips+
      (totalTrips===1?' trip':' trips')+' across '+active.length+
      (active.length===1?' student':' students')+
      (met?' \u00b7 the class met '+met+(met===1?' day':' days'):'')+'</p>';

    if(!active.length){
      h+='<p class="pnote">Nobody from '+esc(c.name)+' has left the room in this period.</p>';
      return;
    }
    anything=true;
    h+='<table class="t"><tr><th>Student</th><th>Trips</th><th>Out of</th>'+
       '<th>Minutes</th><th>Average</th><th>Longest</th><th>Walkouts</th></tr>';
    list.forEach(function(a){
      if(!a.trips&&!a.walk)return;
      /* A frequent flier: going far more than their classmates, and often
         enough that it is a pattern rather than a bad week. */
      var flier=a.trips>=3&&avgTrips>0&&a.trips>=avgTrips*1.8;
      var everyTime=met>0&&a.dayCount>=met;
      h+='<tr'+(flier?' class="flier"':'')+'><td><b>'+esc(a.nm)+'</b>'+
        (flier?' <span class="badge flier">frequent</span>':'')+
        (everyTime?' <span class="badge every">every lesson</span>':'')+
        (isOut(c.id,a.nm)?' <span class="badge outnow">out now</span>':'')+
        '</td><td class="tnum">'+a.trips+'</td>'+
        '<td class="tnum">'+(met?a.dayCount+" of "+met:"\u2014")+'</td>'+
        '<td class="tnum">'+a.mins+'</td>'+
        '<td class="tnum">'+(a.trips?a.avg+" min":"\u2014")+'</td>'+
        '<td class="tnum">'+(a.longest?a.longest+" min":"\u2014")+'</td>'+
        '<td class="tnum">'+(a.walk||"\u2014")+'</td>'+
        '<td><button class="btn ghost small" data-cls="'+esc(c.name)+'" data-nm="'+
        esc(a.nm)+'">Log</button></td></tr>';
    });
    h+='</table>';
  });
  if(!anything&&S.log.length===0){
    h+='<p class="pnote">No sign-outs recorded yet.</p>';
  }
  p.innerHTML=h;

  p.querySelectorAll("[data-range]").forEach(function(b){
    b.addEventListener("click",function(){stuRange=b.getAttribute("data-range");drawPane()});
  });
  p.querySelectorAll("[data-nm]").forEach(function(b){
    b.addEventListener("click",function(){
      stuDetail={cls:b.getAttribute("data-cls"),nm:b.getAttribute("data-nm")};
      drawPane();
    });
  });
}

function paneStudentDetail(p){
  var cls=stuDetail.cls,nm=stuDetail.nm,k=stuRange;
  var c=null;
  S.classes.forEach(function(x){if(x.name===cls)c=x});
  var a=statsFor(cls,nm,k),met=c?classMetDays(c,k).length:0;

  var h='<div class="row"><button class="btn ghost" id="stuback">\u2190 All students</button></div>'+
    '<h2>'+esc(nm)+'</h2><p class="pnote">'+esc(cls)+' \u00b7 '+rangeLabel(k)+'</p>'+
    '<div class="days">';
  RANGES.forEach(function(r){
    h+='<button class="day'+(r.k===k?" on":"")+'" data-range="'+r.k+'">'+esc(r.label)+'</button>';
  });
  h+='</div>';

  h+='<div class="figs">'+
    '<div class="fig"><b>'+a.trips+'</b><span>trips</span></div>'+
    '<div class="fig"><b>'+(met?a.dayCount+" / "+met:"\u2014")+'</b><span>days out, of days the class met</span></div>'+
    '<div class="fig"><b>'+a.mins+'</b><span>minutes out in total</span></div>'+
    '<div class="fig"><b>'+(a.trips?a.avg:"\u2014")+'</b><span>minutes on average</span></div>'+
    '<div class="fig"><b>'+(a.longest||"\u2014")+'</b><span>longest trip</span></div>'+
    '<div class="fig"><b>'+(a.walk||"\u2014")+'</b><span>walkouts</span></div>'+
    '</div>';

  if(met&&a.dayCount>=met&&a.trips){
    h+='<p class="pnote warn" style="margin-top:2vh">Out of the room on every day '+
       esc(cls)+' met in this period.</p>';
  }

  if(!a.rows.length){
    h+='<p class="pnote">Nothing in this period.</p>';
  }else{
    h+='<table class="t"><tr><th>Date</th><th>Out</th><th>Back</th><th>Minutes</th><th>Reason</th></tr>';
    a.rows.forEach(function(r){
      var isWalk=r.type==="walkout";
      h+='<tr'+(isWalk?' class="walk"':'')+'><td>'+esc(dayLabel(r.day))+'</td>'+
        '<td class="tnum">'+fmtShort(r.out)+'</td>'+
        '<td class="tnum">'+(r.back?fmtShort(r.back):"\u2014")+'</td>'+
        '<td class="tnum">'+(r.dur!=null?r.dur:"\u2014")+'</td><td>'+
        (isWalk?'<span class="badge walk">walked out</span>':esc(reasonOf(r.reason).label))+
        (r.override?' <span class="badge pass">override</span>':'')+'</td></tr>';
    });
    h+='</table>';
  }
  p.innerHTML=h;
  $("#stuback").addEventListener("click",function(){stuDetail=null;drawPane()});
  p.querySelectorAll("[data-range]").forEach(function(b){
    b.addEventListener("click",function(){stuRange=b.getAttribute("data-range");drawPane()});
  });
}

/* ---- classes ---- */
function paneClasses(p){
  var cur=scheduledClass();
  var h='<h2>Classes</h2>'+
    '<p class="pnote">Each class has its own roster, and the board shows whichever one the '+
    'clock says is in the room. Meeting times go one per line: <b>days | start | end</b>, '+
    'using M T W H F — <b>H is Thursday</b>. Right now: <b>'+
    (cur?esc(cur.name):"no class scheduled")+'</b>.</p>'+
    '<div class="row"><button class="btn" id="addclass">Add a class</button></div>';

  S.classes.forEach(function(c,i){
    h+='<div class="card" data-card="'+esc(c.id)+'">'+
      '<div class="row" style="margin-bottom:1.2vh">'+
      '<input class="in" data-name="'+esc(c.id)+'" value="'+esc(c.name)+'" style="max-width:160px;font-weight:700">'+
      '<span class="tnum" style="opacity:.55">'+c.roster.length+' students</span>'+
      (cur&&cur.id===c.id?'<span class="badge outnow">in the room now</span>':'')+
      '</div>'+
      '<label class="flab">When it meets</label>'+
      '<textarea class="ta short" data-meets="'+esc(c.id)+'" spellcheck="false">'+
        esc((c.meets||[]).map(function(m){return m.d+" | "+m.s+" | "+m.e}).join("\n"))+
      '</textarea>'+
      '<label class="flab">Roster, one name per line</label>'+
      '<textarea class="ta" data-roster="'+esc(c.id)+'" spellcheck="false">'+
        esc(c.roster.join("\n"))+'</textarea>'+
      '<div class="row" style="margin-top:1.4vh">'+
      '<button class="btn" data-save="'+esc(c.id)+'">Save '+esc(c.name)+'</button>'+
      '<button class="btn ghost" data-del="'+esc(c.id)+'">Delete class</button>'+
      '<span class="ok" data-msg="'+esc(c.id)+'"></span></div></div>';
  });
  p.innerHTML=h;

  $("#addclass").addEventListener("click",function(){
    S.classes.push({id:uid(),name:"New class",meets:[],roster:[]});
    save();remoteWrite("PUT","/classes",S.classes);drawPane();
  });
  p.querySelectorAll("[data-save]").forEach(function(b){
    b.addEventListener("click",function(){
      var id=b.getAttribute("data-save"),c=classById(id);
      if(!c)return;
      var msg=p.querySelector('[data-msg="'+id+'"]'),bad=[],meets=[];
      p.querySelector('[data-meets="'+id+'"]').value.split("\n").forEach(function(line,i){
        if(!line.trim())return;
        var x=line.split("|").map(function(s){return s.trim()});
        if(x.length<3||!/^[MTWHF]+$/i.test(x[0])||parseClock(x[1])==null||parseClock(x[2])==null
           ||parseClock(x[1])>=parseClock(x[2])){bad.push(i+1);return}
        meets.push({d:x[0].toUpperCase(),s:x[1],e:x[2]});
      });
      if(bad.length){
        msg.className="warn";
        msg.textContent="Could not read line "+bad.join(", ")+" of the meeting times — nothing saved.";
        return;
      }
      var nm=p.querySelector('[data-name="'+id+'"]').value.trim();
      c.name=nm||c.name;
      c.meets=meets;
      c.roster=p.querySelector('[data-roster="'+id+'"]').value.split("\n")
                 .map(function(s){return s.trim()}).filter(function(s){return s.length});
      save();
      remoteWrite("PUT","/classes",S.classes);
      msg.className="ok";
      msg.textContent="Saved — "+c.roster.length+" students.";
    });
  });
  p.querySelectorAll("[data-del]").forEach(function(b){
    b.addEventListener("click",function(){
      var id=b.getAttribute("data-del"),c=classById(id);
      if(!c)return;
      if(!window.confirm("Delete "+c.name+" and its roster? Records already logged are kept."))return;
      S.classes=S.classes.filter(function(x){return x.id!==id});
      S.out=S.out.filter(function(o){return o.clsId!==id});
      save();
      remoteWrite("PUT","/classes",S.classes);
      remoteWrite("PUT","/out",arrToMap(S.out));
      drawPane();
    });
  });
}

/* ---- who may go ---- */
function paneLimits(p){
  var h='<h2>Who may go</h2>'+
    '<p class="pnote">The board lets one student out at a time unless you say otherwise. '+
    'Raise a number to let more than one go at once — you might allow two to the office '+
    'but only ever one to the bathroom. A student who taps a full destination is asked for '+
    '<b>your</b> PIN, so you can still wave a single trip through without changing anything. '+
    'These apply to every class.</p>'+
    '<div class="row"><label style="font-weight:700">Out at once, in total: </label>'+
    '<input class="in num" id="maxout" inputmode="numeric" value="'+esc(S.settings.maxOut||1)+'"></div>'+
    '<table class="t"><tr><th>Destination</th><th>How many at once</th><th>Out now</th></tr>';
  REASONS.forEach(function(r){
    h+='<tr><td><b>'+esc(r.label)+'</b>'+(r.pass?' <span class="badge pass">takes the pass</span>':'')+
      '</td><td><input class="in num" data-limit="'+r.k+'" inputmode="numeric" value="'+
      limitFor(r.k)+'"></td><td class="tnum">'+countOut(r.k)+'</td></tr>';
  });
  h+='</table><div class="row" style="margin-top:2.4vh">'+
    '<button class="btn" id="limsave">Save</button><span id="limmsg" class="ok"></span></div>';
  p.innerHTML=h;

  $("#limsave").addEventListener("click",function(){
    var mo=parseInt($("#maxout").value,10),bad=!isFinite(mo)||mo<1,next={};
    p.querySelectorAll("[data-limit]").forEach(function(i){
      var v=parseInt(i.value,10);
      if(!isFinite(v)||v<1){bad=true;return}
      next[i.getAttribute("data-limit")]=v;
    });
    if(bad){
      $("#limmsg").className="warn";
      $("#limmsg").textContent="Every number has to be 1 or more — nothing saved.";
      return;
    }
    S.settings.maxOut=mo;S.limits=next;save();
    remoteWrite("PUT","/settings",S.settings);
    remoteWrite("PUT","/limits",S.limits);
    $("#limmsg").className="ok";
    $("#limmsg").textContent="Saved.";
  });
}

/* ---- sharing ---- */
function statusWords(){
  if(!syncOn())return {t:"Not sharing",d:"This device keeps its own records.",c:""};
  if(sync.status==="live")return {t:"Sharing",d:"Connected. Changes appear on your other devices straight away.",c:"ok"};
  if(sync.status==="connecting")return {t:"Connecting\u2026",d:"Reaching the shared board.",c:""};
  if(sync.status==="saved")return {t:"Saved",d:"Changes are going up, but live updates are not coming back yet.",c:""};
  return {t:"Offline",d:"The board still works. Anything you do is queued and sent when the connection returns.",c:"warn"};
}
function setupLink(){
  return location.origin+location.pathname+
    "?db="+encodeURIComponent(sync.url)+"&board="+encodeURIComponent(sync.board);
}
function paneSync(p){
  var st=statusWords();
  var h='<h2>Sharing between devices</h2>'+
    '<p class="pnote">Put the same two lines into your phone and your iPad and they '+
    'become one board: who is out, the whole log, your classes and settings. Mark a '+
    'walkout on your phone and the iPad turns yellow a second later.</p>'+
    '<p class="pnote '+st.c+'"><b>'+esc(st.t)+'</b> \u2014 '+esc(st.d)+
    (sync.queue.length?' <b>'+sync.queue.length+' change'+(sync.queue.length===1?'':'s')+
      ' waiting to send.</b>':'')+'</p>'+
    '<dl class="dl">'+
    '<dt>Database address</dt><dd>From the Firebase console.<br>'+
      '<input class="in" id="syncurl" style="max-width:100%" spellcheck="false" '+
      'placeholder="https://something-default-rtdb.firebaseio.com" value="'+esc(sync.url)+'"></dd>'+
    '<dt>Board id</dt><dd>The private name for this room. Must match on every device.<br>'+
      '<input class="in" id="syncboard" style="max-width:100%" spellcheck="false" value="'+esc(sync.board)+'"></dd>'+
    '</dl>'+
    '<div class="row" style="margin-top:2.4vh">'+
    '<button class="btn" id="syncsave">Save and connect</button>'+
    (syncOn()?'<button class="btn ghost" id="synccopy">Copy setup link</button>'+
              '<button class="btn ghost" id="syncoff">Stop sharing</button>':'')+
    '<span id="syncmsg" class="ok"></span></div>';
  if(syncOn()){
    h+='<p class="pnote" style="margin-top:2.4vh">The setup link carries both lines. '+
       'Message it to yourself, open it on the other device, and it sets itself up \u2014 '+
       'no typing. Treat it like a key: anyone who opens it joins this board.</p>';
  }
  p.innerHTML=h;

  $("#syncsave").addEventListener("click",function(){
    var u=$("#syncurl").value.trim().replace(/\/+$/,""),b=$("#syncboard").value.trim();
    var msg=$("#syncmsg");
    if(u&&!/^https:\/\/[^\s\/]+$/.test(u)){
      msg.className="warn";
      msg.textContent="That does not look like the database address \u2014 it should be https:// and nothing after the host.";
      return;
    }
    sync.url=u;sync.board=b;sync.seeded=false;remote={};
    syncSaveCfg();
    msg.className="ok";
    if(syncOn()){msg.textContent="Connecting\u2026";syncConnect()}
    else{msg.textContent="Sharing switched off.";if(sync.es){sync.es.close();sync.es=null}setStatus("off")}
    setTimeout(drawPane,1200);
  });
  var cp=$("#synccopy");
  if(cp)cp.addEventListener("click",function(){copyText(setupLink(),cp,"Copy setup link")});
  var off=$("#syncoff");
  if(off)off.addEventListener("click",function(){
    if(!window.confirm("Stop sharing on this device? Its records stay, but it stops talking to the others."))return;
    sync.url="";sync.board="";sync.queue=[];syncSaveCfg();
    if(sync.es){sync.es.close();sync.es=null}
    setStatus("off");drawPane();
  });
}

/* ---- settings ---- */
function paneSettings(p){
  var st=S.settings;
  p.innerHTML='<h2>Settings</h2>'+
    '<p class="pnote">Everything here is stored on this device only.'+
    (storageBroken?' <b class="warn">This browser is refusing to save data, so changes will be lost when the page closes.</b>':'')+
    '</p><dl class="dl">'+
    '<dt>Teacher PIN</dt><dd>Four digits. Opens this panel, and allows a trip when a '+
      'destination is full.<br><input class="in" id="setpin" inputmode="numeric" maxlength="4" value="'+esc(st.pin)+'"></dd>'+
    '<dt>Flag a long trip after</dt><dd>Minutes before the name on the board gets underlined.<br>'+
      '<input class="in num" id="setlong" inputmode="numeric" value="'+esc(st.longOut)+'"></dd>'+
    '<dt>No passes at each end of class</dt><dd>Minutes at the start and at the end of a '+
      'period when nobody may leave, to keep the corridor clear while classes change over. '+
      'The board goes red and says so. You can still wave one student through. 0 turns it off.<br>'+
      '<input class="in num" id="setquiet" inputmode="numeric" value="'+esc(st.quiet==null?10:st.quiet)+'"></dd>'+
    '<dt>Room label</dt><dd>Shown at the bottom of the status screen when no class is scheduled.<br>'+
      '<input class="in" id="setroom" value="'+esc(st.room)+'"></dd>'+
    '<dt>What the big screen says</dt><dd>When the room is clear, and when one student is out.<br>'+
      '<input class="in" id="setopen" value="'+esc(st.openLabel)+'"> '+
      '<input class="in" id="setocc" value="'+esc(st.occLabel)+'"></dd>'+
    '</dl><div class="row" style="margin-top:2.6vh">'+
    '<button class="btn" id="setsave">Save settings</button><span id="setmsg" class="ok"></span></div>'+
    '<h2 style="margin-top:3.4vh">Data</h2>'+
    '<p class="pnote">Export first if you want to keep the records — these cannot be undone.</p>'+
    '<div class="row"><button class="btn ghost" id="clearout">Send everyone back in</button>'+
    '<button class="btn danger" id="wipelog">Delete all records</button>'+
    '<span id="datamsg" class="ok"></span></div>';

  $("#setsave").addEventListener("click",function(){
    var pinv=$("#setpin").value.replace(/\D/g,""),lng=parseInt($("#setlong").value,10),
        qt=parseInt($("#setquiet").value,10);
    if(pinv.length!==4){
      $("#setmsg").className="warn";
      $("#setmsg").textContent="PIN needs to be exactly 4 digits — nothing saved.";
      return;
    }
    st.pin=pinv;
    st.longOut=(isFinite(lng)&&lng>0)?lng:10;
    st.quiet=(isFinite(qt)&&qt>=0)?qt:10;
    st.room=$("#setroom").value.trim();
    st.openLabel=$("#setopen").value.trim()||"OPEN";
    st.occLabel=$("#setocc").value.trim()||"SOMEONE IS OUT";
    save();
    remoteWrite("PUT","/settings",S.settings);
    $("#setmsg").className="ok";
    $("#setmsg").textContent="Saved.";
  });
  $("#clearout").addEventListener("click",function(){
    var t=now();
    S.out.forEach(function(o){
      for(var i=0;i<S.log.length;i++){
        if(S.log[i].id===o.id){S.log[i].back=t;S.log[i].dur=outMins(o);break}
      }
    });
    S.out=[];save();
    remoteWrite("PUT","/out",null);
    remoteWrite("PUT","/log",arrToMap(S.log));
    $("#datamsg").textContent="Board cleared.";
  });
  $("#wipelog").addEventListener("click",function(){
    if(!window.confirm("Delete every sign-out record on this device? Classes and rosters stay."))return;
    S.log=[];S.out=[];save();
    remoteWrite("PUT","/log",null);
    remoteWrite("PUT","/out",null);
    $("#datamsg").textContent="All records deleted.";
  });
}

/* ========================= boot ========================= */

/* A setup link (?db=...&board=...) configures a new device in one tap, then
   tidies itself out of the address bar. */
(function(){
  var q=new URLSearchParams(location.search||"");
  if(q.get("db")||q.get("board")){
    syncLoadCfg();
    if(q.get("db"))sync.url=q.get("db").replace(/\/+$/,"");
    if(q.get("board"))sync.board=q.get("board");
    syncSaveCfg();
    try{history.replaceState(null,"",location.pathname)}catch(e){}
  }
})();

load();
syncLoadCfg();
buildKeypad();

/* The board changes class on its own as the timetable moves. Nothing to press. */
var shownClass=null;
setInterval(function(){
  var c=activeClass(),id=c?c.id:null;
  if(!$("#s0").hidden){renderStatus();shownClass=id}
  else if(!$("#s1").hidden){
    if(id!==shownClass){shownClass=id;renderRoster()}
    else $("#clock").textContent=fmtShort(now());
  }
  else if(!$("#steacher").hidden&&(curPane==="out"||curPane==="room"))drawPane();
},10000);

/* Last resort if the teacher PIN is forgotten: five quick taps on the clock.
   Resets that PIN to 1234 and never touches records. */
(function(){
  var taps=[],c=$("#s0clock");
  c.addEventListener("click",function(e){
    e.stopPropagation();
    var t=Date.now();taps.push(t);taps=taps.filter(function(x){return t-x<2500});
    if(taps.length>=5){
      taps=[];
      if(window.confirm("Reset the teacher PIN to 1234?")){S.settings.pin="1234";save()}
    }
  });
})();

/* Offline cache. Browsers refuse a service worker over plain http, so this does
   nothing on the copy the laptop serves and everything on the hosted one. */
if("serviceWorker" in navigator){
  navigator.serviceWorker.register("sw.js").catch(function(){});
}

syncConnect();

show("s0");
})();
