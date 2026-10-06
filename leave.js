/* 휴가(연차) 기능: selfHolidayReports 컬렉션 확장 (문서 ID = {aid}_{date}, kind:"leave") */
(function(){
  var DAY_KO="일월화수목금토", LV_CACHE={};

 async function leaves(){
   try{ return await dbAll("selfHolidayReports"); }catch(e){ return []; }
 }
  function eachWorkday(from,to){
    var out=[],d=new Date(from+"T00:00:00"),e=new Date(to+"T00:00:00");
    while(d<=e){ var ds=localDateValue(d); if(!isOffday(ds)) out.push(ds); d.setDate(d.getDate()+1); }
    return out;
  }
  async function saveLeave(acc,date,by){
    var id=acc.id+"_"+date, rec={aid:acc.id,name:acc.name,dept:acc.dept||"",date:date,kind:"leave",by:by};
    if(useFB&&fdb){
      rec.reportedAt=firebase.firestore.FieldValue.serverTimestamp();
      await fdb.collection("selfHolidayReports").doc(id).set(rec,{merge:true});
    }else{
      rec.reportedAt=new Date().toISOString(); rec.id=id;
      var a=LS.get("selfHolidayReports").filter(function(x){return x.id!==id;}); a.push(rec); LS.set("selfHolidayReports",a);
    }
    LV_CACHE={}; invalidateDataCache("selfHolidayReports");
  }
  async function removeLeave(id){
    if(useFB&&fdb) await fdb.collection("selfHolidayReports").doc(id).delete();
    else LS.set("selfHolidayReports",LS.get("selfHolidayReports").filter(function(x){return x.id!==id;}));
    LV_CACHE={}; invalidateDataCache("selfHolidayReports");
  }
  async function onLeaveToday(){
    var t=todayStr(), k=SESSION.aid+t, c=LV_CACHE[k];
    if(c&&(c.v||Date.now()-c.at<300000)) return c.v;
    var v=false;
    try{
      if(useFB&&fdb) v=(await fdb.collection("selfHolidayReports").doc(SESSION.aid+"_"+t).get()).exists;
      else v=LS.get("selfHolidayReports").some(function(x){return x.id===SESSION.aid+"_"+t;});
    }catch(e){}
    LV_CACHE[k]={v:v,at:Date.now()}; return v;
  }
  async function leaveRecords(){
    var l=await leaves(), trips=await dbAll("trips"), out=[];
    await loadCore();
    l.forEach(function(x){
      var acc=ACCOUNTS.find(function(a){return a.id===x.aid;}); if(!acc) return;
      var plate=accountVehiclePlates(acc)[0]; if(!plate) return;
      if(trips.some(function(t){return t.uid===x.aid&&t.date===x.date;})) return;
      var v=VEHICLES.find(function(q){return q.plate===plate;});
      out.push({id:x.id,aid:x.aid,date:x.date,name:acc.name,dept:acc.dept||"",vehicle:plate,model:v?v.model:""});
    });
    return out.sort(function(a,b){return b.date.localeCompare(a.date);});
  }

 /* 1) 당일 팝업: 금일 휴가 */
 window.reportTodayHoliday=async function(){
   localStorage.setItem(holidaySelfReportKey(),new Date().toISOString());
   var acc=ACCOUNTS.find(function(a){return a.id===SESSION.aid;})||{id:SESSION.aid,name:SESSION.name,dept:SESSION.dept};
   try{ await saveLeave(acc,todayStr(),"self"); }
   catch(e){
     console.warn("휴가 저장 실패",e); localStorage.removeItem(holidaySelfReportKey());
     closeModal(); return toast("휴가 저장에 실패했습니다. 잠시 후 다시 시도해 주세요.");
   }
   closeModal(); toast("오늘은 휴가로 기록했습니다. 이후 시작 알림이 표시되지 않으며 운행 기록에 휴가로 표시됩니다.");
 };
  var _osr=window.openStartReminder;
  window.openStartReminder=function(h){
    _osr(h);
    document.querySelectorAll('button[onclick="reportTodayHoliday()"]').forEach(function(b){ b.textContent="③ 금일 휴가 (연차)"; });
  };
  var _csr=window.checkStartReminder;
  window.checkStartReminder=async function(force){
    var h=new Date().getHours();
    if(SESSION&&!isAdmin()&&(force||h===8||h===9||h===10)){ if(await onLeaveToday()) return; }
    return _csr(force);
  };

 /* 2) 주간 개인 점검: 휴가일 제외 */
 var _cwp=window.checkWeeklyPersonalReport;
  window.checkWeeklyPersonalReport=async function(force){
    var n=new Date(); window.__myLeaves=new Set();
    if(SESSION&&!isAdmin()&&(force||(n.getDay()===1&&n.getHours()===8))){
      (await leaves()).forEach(function(x){ if(x.aid===SESSION.aid) window.__myLeaves.add(x.date); });
    }
    return _cwp(force);
  };
  window.computePersonalWeekStats=function(from,to,trips){
    var days=workdaysInRangeClient(from,to), lv=window.__myLeaves||new Set(), ok=0, fail=0, leave=0, details=[];
    days.forEach(function(ds){
      var dt=trips.filter(function(t){return t.date===ds;});
      if(!dt.length&&lv.has(ds)){ leave++; details.push({date:ds,ok:true,leave:true,reason:"휴가"}); return; }
      if(!dt.length){ fail++; details.push({date:ds,ok:false,reason:"미시작"}); }
      else if(!dt.some(function(t){return !isRunningTrip(t);})){ fail++; details.push({date:ds,ok:false,reason:"종료 미완료"}); }
      else{ ok++; details.push({date:ds,ok:true,reason:"완료"}); }
    });
    return {totalDays:days.length-leave,successDays:ok,failDays:fail,leaveDays:leave,details:details};
  };
  var _owp=window.openWeeklyReportPopup;
  window.openWeeklyReportPopup=function(stats,from,to){
    _owp(stats,from,to);
    var root=document.querySelector(".weekly-report"); if(!root||!stats.leaveDays) return;
    var p=root.querySelector("p[style*='font-size:15px']"); if(p) p.textContent+=" (휴가 "+stats.leaveDays+"일 제외)";
    var set=new Set(stats.details.filter(function(x){return x.leave;}).map(function(x){return x.date;}));
    root.querySelectorAll("tbody tr").forEach(function(tr){
      var td=tr.children[0], pill=tr.querySelector(".status-pill");
      if(td&&pill&&set.has(td.textContent.trim())){ pill.textContent="휴가"; pill.className="status-pill unknown"; }
    });
  };

 /* 3) 관리자 주간 차량 리포트: 담당자 전원이 휴가인 날은 준수로 처리 */
 var _rwr=window.renderWeeklyReport;
  window.renderWeeklyReport=async function(from,to){
    var lv=(await leaves()).filter(function(x){return x.date>=from&&x.date<=to;}), orig=window.dbAll, used=false;
    window.dbAll=async function(col){
      var r=await orig(col);
      if(col==="trips"&&!used){
        used=true; window.dbAll=orig;
        var extra=[];
        VEHICLES.forEach(function(v){
          var owners=vehicleOwners(v.plate); if(!owners.length) return;
          workdaysInRangeClient(from,to).forEach(function(ds){
            if(owners.every(function(o){return lv.some(function(x){return x.aid===o.id&&x.date===ds;});}))
              extra.push({id:"lv_"+v.plate+ds,date:ds,vehicle:v.plate,status:"완료",startKm:0,endKm:0,dist:0,isLeave:true});
          });
        });
        return r.concat(extra);
      }
      return r;
    };
    try{ await _rwr(from,to); }finally{ window.dbAll=orig; }
  };

 /* 4) 내 정보: 휴가 등록 */
 var _vmy=window.vMy;
  window.vMy=async function(){
    await _vmy();
    var pw=null;
    document.querySelectorAll("#app .card").forEach(function(c){ if(!pw&&c.querySelector("#cpw")) pw=c; });
    var html='<div class="card" id="leaveCard"><h2>휴가 등록</h2><p class="sub">미리 등록한 휴가일에는 시작·종료 알림이 오지 않고, 주간 점검에서 제외되며 운행 기록에 휴가로 표시됩니다. 오늘 이전 날짜는 관리자에게 요청해 주세요.</p>'+
      '<div class="row"><div><label>시작일</label><input type="date" id="lvF" value="'+todayStr()+'"></div><div><label>종료일</label><input type="date" id="lvT" value="'+todayStr()+'"></div></div>'+
      '<button class="btn sm grn" onclick="regMyLeave()">휴가 등록</button><div id="myLeaves"></div></div>';
    if(pw) pw.insertAdjacentHTML("beforebegin",html); else $("#app").insertAdjacentHTML("beforeend",html);
    renderMyLeaves();
  };
  async function renderMyLeaves(){
    var el=$("#myLeaves"); if(!el) return;
    var l=(await leaves()).filter(function(x){return x.aid===SESSION.aid&&x.date>=todayStr();}).sort(function(a,b){return a.date.localeCompare(b.date);});
    el.innerHTML=l.length?'<p class="sub" style="margin-top:10px">등록된 휴가</p>'+l.map(function(x){
      return '<div style="display:flex;justify-content:space-between;align-items:center;padding:6px 0"><span>'+esc(x.date)+' ('+DAY_KO[new Date(x.date+"T00:00:00").getDay()]+')</span>'+
        (x.by==="admin"?'<span class="sub">관리자 등록</span>':'<button class="btn sm sec" onclick="cancelMyLeave(\''+esc(x.id)+'\')">취소</button>')+'</div>';
    }).join(""):'<p class="sub" style="margin-top:10px">등록된 예정 휴가가 없습니다.</p>';
  }
  window.regMyLeave=async function(){
    var f=$("#lvF").value, t=$("#lvT").value, acc=ACCOUNTS.find(function(a){return a.id===SESSION.aid;});
    if(!acc||!f||!t||t<f) return toast("기간을 확인하세요");
    if(f<todayStr()) return toast("오늘 이전 날짜는 관리자에게 요청해 주세요");
    var days=eachWorkday(f,t);
    if(!days.length) return toast("선택한 기간에 근무일이 없습니다");
    if(days.length>62) return toast("한 번에 62일까지 등록할 수 있습니다");
    try{ for(var i=0;i<days.length;i++) await saveLeave(acc,days[i],"self"); }
    catch(e){ console.error(e); return toast("휴가 등록에 실패했습니다. 잠시 후 다시 시도해 주세요"); }
    toast("휴가 "+days.length+"일이 등록되었습니다"); renderMyLeaves();
  };
  window.cancelMyLeave=async function(id){
    try{ await removeLeave(id); }catch(e){ return toast("취소에 실패했습니다"); }
    toast("휴가가 취소되었습니다"); renderMyLeaves();
  };

 /* 5) 관리자: 휴가 관리 탭 */
 window.aLeave=async function(){
   await loadCore();
   var td=todayStr(), r=window._lvr||{from:addDaysStr(td,-30),to:addDaysStr(td,90)};
   var l=(await leaves()).filter(function(x){return x.date>=r.from&&x.date<=r.to;}).sort(function(a,b){return b.date.localeCompare(a.date)||String(a.name).localeCompare(String(b.name));});
   $("#aBody").innerHTML='<div class="card"><h2>휴가 등록</h2><p class="sub">직원의 휴가(연차)를 대신 등록합니다. 지난 날짜도 등록할 수 있으며 변경 이력에 기록됩니다.</p>'+
     '<label>직원</label><select id="lvA">'+ACCOUNTS.filter(function(a){return accountVehiclePlates(a).length;}).map(function(a){return '<option value="'+esc(a.id)+'">'+esc(a.name)+' · '+esc(a.dept)+'</option>';}).join("")+'</select>'+
     '<div class="row"><div><label>시작일</label><input type="date" id="lvF" value="'+td+'"></div><div><label>종료일</label><input type="date" id="lvT" value="'+td+'"></div></div>'+
     '<button class="btn sm grn" onclick="adminAddLeave()">휴가 등록</button></div>'+
     '<div class="card"><h2>휴가 현황</h2><div class="row"><div><label>조회 시작일</label><input type="date" id="lvQF" value="'+r.from+'"></div><div><label>조회 종료일</label><input type="date" id="lvQT" value="'+r.to+'"></div></div>'+
     '<button class="btn sm teal" onclick="window._lvr={from:$(\'#lvQF\').value,to:$(\'#lvQT\').value};aLeave()">조회</button>'+
     '<div class="tbl-wrap"><table><thead><tr><th>일자</th><th>성명</th><th>부서</th><th>등록</th><th></th></tr></thead><tbody>'+
     (l.map(function(x){return '<tr><td>'+esc(x.date)+'</td><td>'+esc(x.name)+'</td><td>'+esc(x.dept||"")+'</td><td>'+(x.by==="admin"?"관리자":"본인")+'</td><td><button class="btn sm red" onclick="adminDelLeave(\''+esc(x.id)+'\')">삭제</button></td></tr>';}).join("")||'<tr><td colspan="5">해당 기간 휴가 없음</td></tr>')+
     '</tbody></table></div></div>';
 };
  window.adminAddLeave=async function(){
    var acc=ACCOUNTS.find(function(a){return a.id===$("#lvA").value;}), f=$("#lvF").value, t=$("#lvT").value;
    if(!acc||!f||!t||t<f) return toast("직원과 기간을 확인하세요");
    var days=eachWorkday(f,t);
    if(!days.length) return toast("선택한 기간에 근무일이 없습니다");
    if(days.length>62) return toast("한 번에 62일까지 등록할 수 있습니다");
    try{
      for(var i=0;i<days.length;i++) await auditedMutation({operation:"create",collection:"selfHolidayReports",id:acc.id+"_"+days[i],before:null,
                                                            after:{aid:acc.id,name:acc.name,dept:acc.dept||"",date:days[i],kind:"leave",by:"admin",reportedAt:new Date().toISOString()},reason:"관리자 휴가 등록",label:acc.name+" "+days[i]});
    }catch(e){ console.error(e); return toast("휴가 등록에 실패했습니다"); }
    LV_CACHE={}; toast(acc.name+" 휴가 "+days.length+"일 등록됨"); aLeave();
  };
  window.adminDelLeave=async function(id){
    var l=(await leaves()).find(function(x){return x.id===id;}); if(!l) return;
    if(!confirm(l.name+" "+l.date+" 휴가를 삭제할까요?")) return;
    try{ await auditedMutation({operation:"delete",collection:"selfHolidayReports",id:id,before:l,after:null,reason:"관리자 휴가 삭제",label:l.name+" "+l.date}); }
    catch(e){ return toast("삭제에 실패했습니다"); }
    LV_CACHE={}; toast("삭제되었습니다"); aLeave();
  };

 /* 6) 운행 기록 화면: 휴가 행 표시 */
 var _vh=window.vHistory;
  window.vHistory=async function(){
    await _vh();
    try{
      var tb=document.querySelector(".desktop-table tbody"), ml=document.querySelector(".mobile-list");
      if(!tb) return;
      var f=historyFilters, plates=new Set(visibleVehicles().map(function(v){return v.plate;}));
      var rows=(await leaveRecords()).filter(function(r){
        return plates.has(r.vehicle)&&(!f.vehicle||r.vehicle===f.vehicle)&&(!f.user||r.name===f.user)&&(!f.from||r.date>=f.from)&&(!f.to||r.date<=f.to);
      });
      rows.forEach(function(r){
        var tr=document.createElement("tr");
        tr.innerHTML='<td>'+esc(r.date)+'</td><td><b>'+esc(r.vehicle)+'</b><div class="sub">'+esc(r.model)+'</div></td><td>'+esc(r.name)+'</td><td>'+esc(r.dept)+'</td><td>'+statusBadge({level:"warn",label:"휴가"})+'</td><td>-</td><td>-</td><td>-</td><td>휴가(연차)</td>';
        var at=Array.prototype.find.call(tb.rows,function(x){return x.cells[0].textContent.trim().slice(0,10)<r.date;});
        tb.insertBefore(tr,at||null);
        if(ml){
          var d=document.createElement("div"); d.className="mobile-record";
          d.innerHTML='<div class="mobile-record-head"><div><strong>'+esc(r.vehicle)+'</strong><div class="sub">'+esc(r.date)+' · '+esc(r.name)+'</div></div>'+statusBadge({level:"warn",label:"휴가"})+'</div><div class="mobile-record-grid"><div><span>목적·비고</span><strong>휴가(연차)</strong></div></div>';
          var am=Array.prototype.find.call(ml.children,function(x){var s=x.querySelector(".sub");return s&&s.textContent.trim().slice(0,10)<r.date;});
          ml.insertBefore(d,am||null);
        }
      });
    }catch(e){ console.warn("휴가 행 표시 실패",e); }
  };

 /* 7) 엑셀: 전체기록(운행기록 시트 + 휴가 현황 시트), 운행기록부(휴가 현황 시트만 추가) */
 function leaveSheet(X,rows){
   var ws=X.utils.json_to_sheet(rows.map(function(r){
     return {일자:r.date,요일:DAY_KO[new Date(r.date+"T00:00:00").getDay()],성명:r.name,부서:r.dept,차량번호:r.vehicle,차종:r.model,구분:"휴가"};
   }));
   ws["!cols"]=[{wch:11},{wch:5},{wch:9},{wch:16},{wch:11},{wch:14},{wch:6}];
   return ws;
 }
  var _dle=window.dlExcel;
  window.dlExcel=async function(){
    var orig=XLSX.writeFile, f=window._af||{v:"",u:"",from:"",to:""};
    var rows=(await leaveRecords()).filter(function(r){return (!f.v||r.vehicle===f.v)&&(!f.u||r.name===f.u)&&(!f.from||r.date>=f.from)&&(!f.to||r.date<=f.to);});
    XLSX.writeFile=function(wb,name){
      XLSX.writeFile=orig;
      try{
        var ws=wb.Sheets["운행기록"];
        if(ws&&rows.length){
          var rg=XLSX.utils.decode_range(ws["!ref"]), hdr=[];
          for(var c=rg.s.c;c<=rg.e.c;c++){ var cell=ws[XLSX.utils.encode_cell({r:0,c:c})]; hdr.push(cell?cell.v:""); }
          var recs=rows.map(function(r){
            var o={}; hdr.forEach(function(h){o[h]="";});
            o["시작일자"]=r.date; o["종료일자"]=r.date; o["요일"]=DAY_KO[new Date(r.date+"T00:00:00").getDay()];
            o["차량번호"]=r.vehicle; o["차종"]=r.model; o["부서"]=r.dept; o["사용자"]=r.name; o["목적"]="휴가(연차)"; o["상태"]="휴가";
            return o;
          });
          XLSX.utils.sheet_add_json(ws,recs,{header:hdr,skipHeader:true,origin:-1});
        }
        if(rows.length) XLSX.utils.book_append_sheet(wb,leaveSheet(XLSX,rows),"휴가 현황");
      }catch(e){ console.warn("휴가 엑셀 추가 실패",e); }
      return orig.call(XLSX,wb,name);
    };
    try{ await _dle(); }finally{ XLSX.writeFile=orig; }
  };
  var _wbe=window.writeBookExcel2007;
  window.writeBookExcel2007=async function(X,wb,fileName){
    try{
      var from=$("#bF").value, to=$("#bT").value, only=$("#bV").value;
      var rows=(await leaveRecords()).filter(function(r){return (!only||r.vehicle===only)&&(!from||r.date>=from)&&(!to||r.date<=to);});
      if(rows.length) X.utils.book_append_sheet(wb,leaveSheet(X,rows),"휴가 현황");
    }catch(e){ console.warn("휴가 시트 추가 실패",e); }
    return _wbe(X,wb,fileName);
  };
})();
