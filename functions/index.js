const { onSchedule } = require("firebase-functions/v2/scheduler");
const { setGlobalOptions } = require("firebase-functions/v2");
const { initializeApp } = require("firebase-admin/app");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");
const { getMessaging } = require("firebase-admin/messaging");

initializeApp();
setGlobalOptions({ region:"asia-northeast3", maxInstances:3 });
const db=getFirestore();
const HOLIDAYS=new Set([
    "2026-01-01","2026-02-16","2026-02-17","2026-02-18","2026-03-01","2026-03-02","2026-05-05","2026-05-24","2026-05-25","2026-06-06","2026-08-15","2026-08-17","2026-09-24","2026-09-25","2026-09-26","2026-10-03","2026-10-05","2026-10-09","2026-12-25",
    "2027-01-01","2027-02-06","2027-02-07","2027-02-08","2027-02-09","2027-03-01","2027-05-05","2027-05-13","2027-06-06","2027-08-15","2027-08-16","2027-09-14","2027-09-15","2027-09-16","2027-10-03","2027-10-04","2027-10-09","2027-10-11","2027-12-25"
  ]);
const MAX_ASSIGNED_VEHICLES=3;

function seoulParts(instant){
    const parts=new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Seoul",year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",hourCycle:"h23",weekday:"short"}).formatToParts(instant);
    const value=type=>parts.find(part=>part.type===type)?.value||"";
    return {date:`${value("year")}-${value("month")}-${value("day")}`,hour:Number(value("hour")),weekday:value("weekday")};
}
function tokenDocId(token){ return token.replace(/[^a-zA-Z0-9_-]/g,"_"); }

async function isExtraHoliday(date){
    const settingsSnap=await db.doc("settings/main").get();
    const extra=String(settingsSnap.data()?.extraHolidays||"").split(/[\s,]+/).filter(Boolean);
    return extra.includes(date);
}
function isCompanyHoliday(date,weekday,extraSet){
    return ["Sat","Sun"].includes(weekday)||HOLIDAYS.has(date)||extraSet.has(date);
}
async function extraHolidaySet(){
    const settingsSnap=await db.doc("settings/main").get();
    return new Set(String(settingsSnap.data()?.extraHolidays||"").split(/[\s,]+/).filter(Boolean));
}
function accountVehiclePlates(account){
    const raw=Array.isArray(account.vehicles)&&account.vehicles.length?account.vehicles:(account.vehicle?[account.vehicle]:[]);
    return [...new Set(raw.filter(Boolean))].slice(0,MAX_ASSIGNED_VEHICLES);
}
async function tokensForAccount(aid){
    const tokenSnap=await db.collection("pushTokens").where("aid","==",aid).get();
    return [...new Set(tokenSnap.docs.filter(doc=>doc.data().active!==false&&doc.data().token).map(doc=>doc.data().token))].slice(0,500);
}
async function sendAndCleanTokens(tokens,payload){
    if(!tokens.length) return {successCount:0,failureCount:0};
    const response=await getMessaging().sendEachForMulticast({tokens,data:payload});
    const invalid=[];
    response.responses.forEach((item,index)=>{
          if(!item.success&&["messaging/registration-token-not-registered","messaging/invalid-registration-token"].includes(item.error?.code)) invalid.push(tokens[index]);
    });
    await Promise.all(invalid.map(token=>db.doc(`pushTokens/${tokenDocId(token)}`).set({active:false,invalidAt:FieldValue.serverTimestamp()},{merge:true})));
    return {successCount:response.successCount,failureCount:response.failureCount};
}

/* ① 운행 종료 미완료 알림 (평일 19·20·21·22시, 기존) */
exports.sendTripEndReminders=onSchedule({schedule:"0 19-22 * * 1-5",timeZone:"Asia/Seoul",retryCount:1},async event=>{
    const {date,hour,weekday}=seoulParts(new Date(event.scheduleTime||Date.now()));
    if(["Sat","Sun"].includes(weekday)||HOLIDAYS.has(date)) return;
    if(await isExtraHoliday(date)) return;

                                          const tripsSnap=await db.collection("trips").where("status","==","운행중").get();
    for(const tripDoc of tripsSnap.docs){
          const trip=tripDoc.data();if(!trip.uid) continue;
          const deliveryRef=db.doc(`tripReminderDeliveries/${date}_${hour}_${tripDoc.id}`);
          if((await deliveryRef.get()).exists) continue;
          const tokens=await tokensForAccount(trip.uid);
          if(!tokens.length) continue;
          const body=`${trip.vehicle||"차량"} 차량이 운행 중입니다. 종료 KM을 입력하거나 계속 운행 중을 선택해 주세요.`;
          const {successCount,failureCount}=await sendAndCleanTokens(tokens,{title:"운행 종료 확인이 필요합니다",body,kind:"end",tripId:tripDoc.id,vehicle:String(trip.vehicle||""),hour:String(hour)});
          await deliveryRef.set({tripId:tripDoc.id,uid:trip.uid,vehicle:trip.vehicle,date,hour,successCount,failureCount,createdAt:FieldValue.serverTimestamp()});
    }
});

/* ② 운행 시작 미입력 알림 (평일 08·09·10시, 신규) */
exports.sendTripStartReminders=onSchedule({schedule:"0 8-10 * * 1-5",timeZone:"Asia/Seoul",retryCount:1},async event=>{
    const {date,hour,weekday}=seoulParts(new Date(event.scheduleTime||Date.now()));
    const extraSet=await extraHolidaySet();
    if(isCompanyHoliday(date,weekday,extraSet)) return;

                                            const accountsSnap=await db.collection("accounts").get();
    for(const accDoc of accountsSnap.docs){
          const account=accDoc.data();
          const plates=accountVehiclePlates(account);
          if(!plates.length) continue;

      const startedSnap=await db.collection("trips").where("uid","==",accDoc.id).where("date","==",date).limit(1).get();
          if(!startedSnap.empty) continue;

      const selfHolidaySnap=await db.doc(`selfHolidayReports/${accDoc.id}_${date}`).get();
          if(selfHolidaySnap.exists) continue;

      const deliveryRef=db.doc(`startReminderDeliveries/${date}_${hour}_${accDoc.id}`);
          if((await deliveryRef.get()).exists) continue;
          const tokens=await tokensForAccount(accDoc.id);
          if(!tokens.length) continue;
          const body=`${plates.join(", ")} 차량 운행을 아직 시작하지 않았습니다. 시작 버튼을 눌러 출발 KM을 기록해 주세요.`;
          const {successCount,failureCount}=await sendAndCleanTokens(tokens,{title:"운행 시작 확인이 필요합니다",body,kind:"start",vehicle:plates[0]||"",hour:String(hour)});
          await deliveryRef.set({aid:accDoc.id,name:account.name,dept:account.dept,vehicle:plates[0]||"",date,hour,successCount,failureCount,createdAt:FieldValue.serverTimestamp()});
    }
});

/* ③ 주간 개인별 습관 점검 알림 (매주 월요일 08시, 신규) */
function mondayOf(date){
    const d=new Date(date+"T00:00:00Z");
    const day=d.getUTCDay();
    const diff=day===0?-6:1-day;
    d.setUTCDate(d.getUTCDate()+diff);
    return d.toISOString().slice(0,10);
}
function addDays(date,n){
    const d=new Date(date+"T00:00:00Z");
    d.setUTCDate(d.getUTCDate()+n);
    return d.toISOString().slice(0,10);
}
function workdaysInRange(from,to,extraSet){
    const days=[]; let cur=from;
    while(cur<=to){
          const weekday=["Sun","Mon","Tue","Wed","Thu","Fri","Sat"][new Date(cur+"T00:00:00Z").getUTCDay()];
          if(!isCompanyHoliday(cur,weekday,extraSet)) days.push(cur);
          cur=addDays(cur,1);
    }
    return days;
}

exports.sendWeeklyComplianceReport=onSchedule({schedule:"0 8 * * 1",timeZone:"Asia/Seoul",retryCount:1},async event=>{
    const {date,weekday}=seoulParts(new Date(event.scheduleTime||Date.now()));
    if(weekday!=="Mon") return;
    const extraSet=await extraHolidaySet();
    const thisMonday=mondayOf(date);
    const prevMonday=addDays(thisMonday,-7);
    const prevFriday=addDays(prevMonday,4);
    const workdays=workdaysInRange(prevMonday,prevFriday,extraSet);
    if(!workdays.length) return;

                                                const [accountsSnap,tripsSnap]=await Promise.all([
                                                      db.collection("accounts").get(),
                                                      db.collection("trips").where("date",">=",prevMonday).where("date","<=",prevFriday).get()
                                                    ]);
    const tripsByUid=new Map();
    tripsSnap.docs.forEach(doc=>{
          const t=doc.data(); if(!t.uid) return;
          if(!tripsByUid.has(t.uid)) tripsByUid.set(t.uid,[]);
          tripsByUid.get(t.uid).push(t);
    });

                                                for(const accDoc of accountsSnap.docs){
                                                      const account=accDoc.data();
                                                      const plates=accountVehiclePlates(account);
                                                      if(!plates.length) continue;

      const deliveryRef=db.doc(`weeklyReportDeliveries/${prevMonday}_${accDoc.id}`);
                                                      if((await deliveryRef.get()).exists) continue;

      const myTrips=tripsByUid.get(accDoc.id)||[];
                                                      let successDays=0,failDays=0;
                                                      const details=[];
                                                      for(const ds of workdays){
                                                              const dayTrips=myTrips.filter(t=>t.date===ds);
                                                              const started=dayTrips.length>0;
                                                              const ended=dayTrips.some(t=>t.status!=="운행중"&&t.endKm!=null&&t.endKm!=="");
                                                              if(!started){ failDays++; details.push({date:ds,ok:false,reason:"미시작"}); }
                                                              else if(!ended){ failDays++; details.push({date:ds,ok:false,reason:"종료 미완료"}); }
                                                              else { successDays++; details.push({date:ds,ok:true,reason:"완료"}); }
                                                      }

      const tokens=await tokensForAccount(accDoc.id);
                                                      if(!tokens.length){
                                                              await deliveryRef.set({aid:accDoc.id,name:account.name,dept:account.dept,weekFrom:prevMonday,weekTo:prevFriday,totalDays:workdays.length,successDays,failDays,pushed:false,createdAt:FieldValue.serverTimestamp()});
                                                              continue;
                                                      }
                                                      const body=failDays>0
                                                        ? `지난주(${prevMonday}~${prevFriday}) ${workdays.length}일 중 ${successDays}일 성공, ${failDays}일 실패 — 운행 시작·종료 기록 습관화가 필요합니다.`
                                                              : `지난주(${prevMonday}~${prevFriday}) ${workdays.length}일 모두 시작·종료 기록을 잘 완료했습니다. 감사합니다!`;
                                                      const {successCount,failureCount}=await sendAndCleanTokens(tokens,{title:"주간 운행기록 점검 결과",body,kind:"weekly",weekFrom:prevMonday,weekTo:prevFriday,successDays:String(successDays),failDays:String(failDays)});
                                                      await deliveryRef.set({aid:accDoc.id,name:account.name,dept:account.dept,weekFrom:prevMonday,weekTo:prevFriday,totalDays:workdays.length,successDays,failDays,pushed:true,successCount,failureCount,createdAt:FieldValue.serverTimestamp()});
                                                }
});
