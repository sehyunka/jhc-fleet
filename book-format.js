/* ═══════════════════════════════════════════════════════════════
   운행기록부 별지 서식 내보내기 모듈 (book-format.js)
   - 법인세법 시행규칙 별지 제29호 서식 <2016.4.1. 제정> 레이아웃
   - index.html 의 </body> 바로 앞에 아래 한 줄을 추가하면 적용됩니다:
     <script src="book-format.js"></script>
   - [관리] → [운행기록부] → [엑셀 생성] 버튼이 이 서식으로 대체됩니다.
     (차량별로 시트 1개, 테두리·병합·서식 포함)
   ═══════════════════════════════════════════════════════════════ */
const BOOK_CORP  = "㈜재현인텍스";     // 법인명
const BOOK_BIZNO = "125-81-50325";    // 사업자등록번호

/* 서식(테두리·병합) 지원 엑셀 라이브러리 로드 (xlsx-js-style, 기존 XLSX와 API 동일) */
let __XLSXS = null;
let __JSZIP = null;
function loadXlsxStyle(){
  return new Promise(function(res, rej){
    if(typeof window !== "undefined" && window.__TEST_XLSX){ __XLSXS = window.__TEST_XLSX; return res(__XLSXS); }
    if(__XLSXS) return res(__XLSXS);
    var s = document.createElement("script");
    s.src = "https://cdn.jsdelivr.net/npm/xlsx-js-style@1.2.0/dist/xlsx.bundle.js";
    s.onload = function(){ __XLSXS = window.XLSX; res(__XLSXS); };
    s.onerror = function(){ rej(new Error("xlsx-js-style 로드 실패")); };
    document.head.appendChild(s);
  });
}
function loadJsZip(){
  return new Promise(function(res, rej){
    if(typeof window !== "undefined" && window.__TEST_JSZIP){ __JSZIP = window.__TEST_JSZIP; return res(__JSZIP); }
    if(__JSZIP) return res(__JSZIP);
    if(typeof window !== "undefined" && window.JSZip){ __JSZIP = window.JSZip; return res(__JSZIP); }
    var s = document.createElement("script");
    s.src = "https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js";
    s.onload = function(){ __JSZIP = window.JSZip; res(__JSZIP); };
    s.onerror = function(){ rej(new Error("JSZip 로드 실패")); };
    document.head.appendChild(s);
  });
}

/* ── 스타일 정의 ── */
const __bd  = {style:"thin", color:{rgb:"000000"}};
const __ALL = {top:__bd, bottom:__bd, left:__bd, right:__bd};
const BS = {
  note :{font:{sz:8,  color:{rgb:"595959"}}, alignment:{horizontal:"left", vertical:"center"}},
  title:{font:{sz:14, bold:true}, alignment:{horizontal:"center", vertical:"center", wrapText:true}, border:__ALL},
  head :{font:{sz:9, bold:true}, alignment:{horizontal:"center", vertical:"center", wrapText:true},
         fill:{patternType:"solid", fgColor:{rgb:"EDF2F7"}}, border:__ALL},
  sect :{font:{sz:10, bold:true}, alignment:{horizontal:"left", vertical:"center"}},
  cell :{font:{sz:9}, alignment:{horizontal:"center", vertical:"center", wrapText:true}, border:__ALL},
  cellL:{font:{sz:9}, alignment:{horizontal:"left", vertical:"center", wrapText:true}, border:__ALL},
  num  :{font:{sz:9}, alignment:{horizontal:"right", vertical:"center"}, border:__ALL, numFmt:"#,##0"},
  dist :{font:{sz:9}, alignment:{horizontal:"right", vertical:"center"}, border:__ALL, numFmt:"#,##0.0"},
  foot :{font:{sz:9, bold:true}, alignment:{horizontal:"center", vertical:"center", wrapText:true},
         fill:{patternType:"solid", fgColor:{rgb:"E7E6E6"}}, border:__ALL},
  footV:{font:{sz:9, bold:true}, alignment:{horizontal:"right", vertical:"center"}, border:__ALL, numFmt:"#,##0.0"},
  gray :{fill:{patternType:"solid", fgColor:{rgb:"BFBFBF"}}, border:__ALL}
};
function bc(v, s){ return {v:(v==null?"":v), t:(typeof v==="number"?"n":"s"), s:s}; }
function bkDate(ds){
  var d = new Date(ds+"T00:00:00");
  return ds + "(" + "일월화수목금토"[d.getDay()] + ")";
}
function bkYear(ds){
  var p = ds.split("-");
  return p[0] + "년 " + (+p[1]) + "월 " + (+p[2]) + "일";
}

const BOOK_COL_MIN = [13,10,8,13,13,10,11,12,20];
const BOOK_COL_MAX = [16,13,10,15,15,12,13,14,26];
const BOOK_TOTAL_WIDTH = 120;
function bookDisplayWidth(value){
  return String(value==null?"":value).split(/\r?\n/).reduce(function(max,line){
    var width=Array.from(line).reduce(function(sum,ch){ return sum+(/[\u1100-\u11ff\u2e80-\u9fff\uac00-\ud7af]/.test(ch)?1.7:1); },0);
    return Math.max(max,width);
  },0);
}
function fitBookColumns(aoa){
  var widths=BOOK_COL_MIN.slice();
  for(var r=5;r<aoa.length;r++) for(var c=0;c<BOOK_COL_MIN.length;c++){
    var cell=aoa[r]&&aoa[r][c], value=cell&&typeof cell==="object"&&"v" in cell?cell.v:cell;
    if(value==null||value==="") continue;
    widths[c]=Math.min(BOOK_COL_MAX[c],Math.max(widths[c],Math.ceil(bookDisplayWidth(value)+2)));
  }
  while(widths.reduce(function(s,w){return s+w;},0)>BOOK_TOTAL_WIDTH){
    var idx=-1,room=0;
    for(var i=0;i<widths.length;i++) if(widths[i]-BOOK_COL_MIN[i]>room){ room=widths[i]-BOOK_COL_MIN[i]; idx=i; }
    if(idx<0) break;
    widths[idx]=Math.max(BOOK_COL_MIN[idx],widths[idx]-0.5);
  }
  return widths.map(function(w){ return {wch:+w.toFixed(1)}; });
}
function fitBookDataHeight(row,widths){
  var lines=1;
  for(var c=0;c<BOOK_COL_MIN.length;c++){
    var cell=row&&row[c], value=cell&&typeof cell==="object"&&"v" in cell?cell.v:cell;
    var chunks=String(value==null?"":value).split(/\r?\n/), count=0;
    chunks.forEach(function(chunk){ count+=Math.max(1,Math.ceil(bookDisplayWidth(chunk)/Math.max(4,widths[c].wch-2))); });
    lines=Math.max(lines,count);
  }
  return {hpx:Math.min(42,Math.max(20,18+(lines-1)*12))};
}

/* ── 차량 1대 → 별지 서식 시트 ── */
function makeBookSheet(X, v, rows, from, to){
  var total = rows.reduce(function(s,t){ return s + (+t.dist || 0); }, 0);
  var aoa = [], merges = [];
  function M(r1,c1,r2,c2){ merges.push({s:{r:r1,c:c1}, e:{r:r2,c:c2}}); }

  /* r0 안내문 */
  aoa.push([bc("【업무용승용차 운행기록부에 관한 별지 서식】 <2016.4.1. 제정>", BS.note)]);
  M(0,0,0,8);
  /* r1~r2 상단 블록 */
  aoa.push([bc("사업연도",BS.head), bc("",BS.head),
            bc(bkYear(from)+" ~ "+bkYear(to),BS.cell), bc("",BS.cell),
            bc("업무용승용차 운행기록부",BS.title), bc("",BS.title),
            bc("법인명",BS.head), bc(BOOK_CORP,BS.cell), bc("",BS.cell)]);
  aoa.push([bc("",BS.head), bc("",BS.head),
            bc("",BS.cell), bc("",BS.cell),
            bc("",BS.title), bc("",BS.title),
            bc("사업자등록번호",BS.head), bc(BOOK_BIZNO,BS.cell), bc("",BS.cell)]);
  M(1,0,2,1); M(1,2,2,3); M(1,4,2,5); M(1,7,1,8); M(2,7,2,8);
  /* r3 공백, r4 섹션1 */
  aoa.push([bc("",BS.note)]);
  aoa.push([bc("1. 기본정보", BS.sect)]); M(4,0,4,8);
  /* r5~r6 차종/등록번호 */
  aoa.push([bc("① 차 종",BS.head), bc("",BS.head), bc("② 자동차등록번호",BS.head), bc("",BS.head), bc("",BS.head)]);
  aoa.push([bc(v.model,BS.cell), bc("",BS.cell), bc(v.plate,BS.cell), bc("",BS.cell), bc("",BS.cell)]);
  M(5,0,5,1); M(5,2,5,4); M(6,0,6,1); M(6,2,6,4);
  /* r7 공백, r8 섹션2 */
  aoa.push([bc("",BS.note)]);
  aoa.push([bc("2. 업무용 사용비율 계산", BS.sect)]); M(8,0,8,8);
  /* r9~r10 표 머리글 */
  aoa.push([bc("③ 사용일자\n(요일)",BS.head), bc("④ 사용자",BS.head), bc("",BS.head),
            bc("운  행  내  역",BS.head), bc("",BS.head), bc("",BS.head),
            bc("업무용 사용거리(km)",BS.head), bc("",BS.head), bc("⑩ 비 고",BS.head)]);
  aoa.push([bc("",BS.head), bc("부서",BS.head), bc("성명",BS.head),
            bc("⑤ 주행 전\n계기판거리(km)",BS.head), bc("⑥ 주행 후\n계기판거리(km)",BS.head), bc("⑦ 주행거리\n(km)",BS.head),
            bc("⑧ 출·퇴근용\n(km)",BS.head), bc("⑨ 일반업무용\n(km)",BS.head), bc("",BS.head)]);
  M(9,0,10,0); M(9,1,9,2); M(9,3,9,5); M(9,6,9,7); M(9,8,10,8);
  /* 데이터 행 */
  rows.forEach(function(t){
    aoa.push([bc(bkDate(t.date),BS.cell), bc(t.dept,BS.cell), bc(t.user,BS.cell),
              bc(+t.startKm,BS.num), bc(+t.endKm,BS.num), bc(+t.dist,BS.dist),
              bc("",BS.cell), bc(+t.dist,BS.dist),
              bc((t.purpose||"")+(t.offday?" [휴무일 운행]":""),BS.cellL)]);
  });
  if(!rows.length){
    aoa.push([bc("해당 기간 완료된 운행기록 없음",BS.cell), bc("",BS.cell), bc("",BS.cell), bc("",BS.cell),
              bc("",BS.cell), bc("",BS.cell), bc("",BS.cell), bc("",BS.cell), bc("",BS.cell)]);
    M(11,0,11,8);
  }
  /* 합계부 */
  var r = aoa.length;
  aoa.push([bc("⑪ 사업연도 총주행거리(km)",BS.foot), bc("",BS.foot), bc("",BS.foot), bc("",BS.foot), bc("",BS.foot),
            bc(total,BS.footV), bc("",BS.gray), bc("",BS.gray), bc("",BS.gray)]);
  aoa.push([bc("⑫ 사업연도 업무용 사용거리(km)",BS.foot), bc("",BS.foot), bc("",BS.foot), bc("",BS.foot), bc("",BS.foot),
            bc(total,BS.footV), bc("",BS.gray), bc("",BS.gray), bc("",BS.gray)]);
  aoa.push([bc("⑬ 업무사용비율 (⑫ ÷ ⑪)",BS.foot), bc("",BS.foot), bc("",BS.foot), bc("",BS.foot), bc("",BS.foot),
            bc("100%",{font:{sz:9,bold:true},alignment:{horizontal:"right",vertical:"center"},border:__ALL}),
            bc("",BS.gray), bc("",BS.gray), bc("",BS.gray)]);
  M(r,0,r,4); M(r,6,r,8); M(r+1,0,r+1,4); M(r+1,6,r+1,8); M(r+2,0,r+2,4); M(r+2,6,r+2,8);

  var ws = X.utils.aoa_to_sheet(aoa);
  ws["!merges"] = merges;
  ws["!cols"] = fitBookColumns(aoa);
  var hs = [{hpx:18},{hpx:26},{hpx:26},{hpx:8},{hpx:20},{hpx:20},{hpx:20},{hpx:8},{hpx:20},{hpx:24},{hpx:38}];
  for(var i=0;i<Math.max(1,rows.length);i++) hs.push(fitBookDataHeight(aoa[11+i],ws["!cols"]));
  hs.push({hpx:20},{hpx:20},{hpx:20});
  ws["!rows"] = hs;
  ws["!margins"] = {left:0.2,right:0.2,top:0.35,bottom:0.35,header:0.15,footer:0.15};
  ws["!pageSetup"] = {paperSize:9,orientation:"landscape",fitToWidth:1,fitToHeight:0,horizontalDpi:300,verticalDpi:300};
  ws["!printArea"] = "A1:I"+aoa.length;
  ws["!repeatRows"] = "10:11";
  return ws;
}

function bookXmlEscape(value){
  return String(value).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
}
function injectBookSheetPrintLayout(xml){
  if(!/<pageSetUpPr\b/.test(xml)){
    if(/<sheetPr\b[^>]*\/>/.test(xml)) xml=xml.replace(/<sheetPr\b([^>]*)\/>/,"<sheetPr$1><pageSetUpPr fitToPage=\"1\" autoPageBreaks=\"0\"/></sheetPr>");
    else if(/<sheetPr\b[^>]*>/.test(xml)) xml=xml.replace(/<\/sheetPr>/,"<pageSetUpPr fitToPage=\"1\" autoPageBreaks=\"0\"/></sheetPr>");
    else xml=xml.replace(/(<worksheet\b[^>]*>)/,"$1<sheetPr><pageSetUpPr fitToPage=\"1\" autoPageBreaks=\"0\"/></sheetPr>");
  }
  xml=xml.replace(/<printOptions\b[^>]*\/>/g,"").replace(/<pageMargins\b[^>]*\/>/g,"").replace(/<pageSetup\b[^>]*\/>/g,"");
  var printXml='<printOptions horizontalCentered="1" verticalCentered="0" gridLines="0" headings="0"/>'+
    '<pageMargins left="0.2" right="0.2" top="0.35" bottom="0.35" header="0.15" footer="0.15"/>'+
    '<pageSetup paperSize="9" orientation="landscape" fitToWidth="1" fitToHeight="0" blackAndWhite="0" draft="0" horizontalDpi="300" verticalDpi="300"/>';
  var marker=/<(?:headerFooter|rowBreaks|colBreaks|customProperties|cellWatches|ignoredErrors|smartTags|drawing|legacyDrawing|legacyDrawingHF|picture|oleObjects|controls|webPublishItems|tableParts|extLst)\b|<\/worksheet>/;
  return xml.replace(marker,function(found){ return printXml+found; });
}
function injectBookDefinedNames(xml,wb,X){
  var defs=wb.SheetNames.map(function(name,index){
    var ws=wb.Sheets[name], end=X.utils.decode_range(ws["!ref"]).e.r+1;
    var safe="'"+name.replace(/'/g,"''")+"'";
    return '<definedName name="_xlnm.Print_Area" localSheetId="'+index+'">'+bookXmlEscape(safe+'!$A$1:$I$'+end)+'</definedName>'+
      '<definedName name="_xlnm.Print_Titles" localSheetId="'+index+'">'+bookXmlEscape(safe+'!$10:$11')+'</definedName>';
  }).join("");
  if(/<definedNames>/.test(xml)) return xml.replace("</definedNames>",defs+"</definedNames>");
  return xml.replace(/(<calcPr\b|<\/workbook>)/,"<definedNames>"+defs+"</definedNames>$1");
}
function saveBookBlob(blob,fileName){
  var a=document.createElement("a"),url=URL.createObjectURL(blob);
  a.href=url; a.download=fileName; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(function(){ URL.revokeObjectURL(url); },30000);
}
async function writeBookA4(X,wb,fileName){
  try{
    var Z=await loadJsZip(), data=X.write(wb,{bookType:"xlsx",type:"array"}), zip=await Z.loadAsync(data);
    var sheetPaths=Object.keys(zip.files).filter(function(path){ return /^xl\/worksheets\/sheet\d+\.xml$/.test(path); });
    await Promise.all(sheetPaths.map(async function(path){
      var xml=await zip.file(path).async("string");
      zip.file(path,injectBookSheetPrintLayout(xml));
    }));
    var workbookXml=await zip.file("xl/workbook.xml").async("string");
    zip.file("xl/workbook.xml",injectBookDefinedNames(workbookXml,wb,X));
    saveBookBlob(await zip.generateAsync({type:"blob",compression:"DEFLATE"}),fileName);
  }catch(e){
    console.warn("A4 인쇄 설정 적용 실패",e);
    toast("A4 인쇄 설정 적용 실패 — 기본 엑셀 형식으로 생성합니다");
    X.writeFile(wb,fileName);
  }
}

/* ── 기존 [엑셀 생성] 버튼(dlBook)을 별지 서식 버전으로 대체 ── */
async function dlBook(){
  var from = $("#bF").value, to = $("#bT").value, only = $("#bV").value;
  var X;
  try{ X = await loadXlsxStyle(); }
  catch(e){ X = window.XLSX; toast("서식 라이브러리 로드 실패 — 기본 형식으로 생성합니다"); }
  var trips = (await dbAll("trips"))
    .filter(function(t){ return t.status==="완료" && (!from||t.date>=from) && (!to||t.date<=to); })
    .sort(function(a,b){ return (a.date+(a.startTime||"")).localeCompare(b.date+(b.startTime||"")); });
  var vlist = only ? VEHICLES.filter(function(v){ return v.plate===only; }) : VEHICLES;
  var wb = X.utils.book_new(), made = 0;
  for(var i=0;i<vlist.length;i++){
    var v = vlist[i];
    var rows = trips.filter(function(t){ return t.vehicle===v.plate; });
    if(!rows.length && !only) continue;
    X.utils.book_append_sheet(wb, makeBookSheet(X, v, rows, from, to), v.plate.replace(/[\\\/\?\*\[\]:]/g,"").slice(0,31));
    made++;
  }
  if(!made) return toast("해당 기간 완료된 운행기록이 없습니다");
  await writeBookA4(X,wb,"운행기록부_" + from.replace(/-/g,"") + "-" + to.replace(/-/g,"") + ".xlsx");
}
