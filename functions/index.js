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

function seoulParts(instant){
  const parts=new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Seoul",year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",hourCycle:"h23",weekday:"short"}).formatToParts(instant);
  const value=type=>parts.find(part=>part.type===type)?.value||"";
  return {date:`${value("year")}-${value("month")}-${value("day")}`,hour:Number(value("hour")),weekday:value("weekday")};
}
function tokenDocId(token){ return token.replace(/[^a-zA-Z0-9_-]/g,"_"); }

exports.sendTripEndReminders=onSchedule({schedule:"0 19-22 * * 1-5",timeZone:"Asia/Seoul",retryCount:1},async event=>{
  const {date,hour,weekday}=seoulParts(new Date(event.scheduleTime||Date.now()));
  if(["Sat","Sun"].includes(weekday)||HOLIDAYS.has(date)) return;
  const settingsSnap=await db.doc("settings/main").get();
  const extra=String(settingsSnap.data()?.extraHolidays||"").split(/[\s,]+/).filter(Boolean);
  if(extra.includes(date)) return;

  const tripsSnap=await db.collection("trips").where("status","==","운행중").get();
  for(const tripDoc of tripsSnap.docs){
    const trip=tripDoc.data();if(!trip.uid) continue;
    const deliveryRef=db.doc(`tripReminderDeliveries/${date}_${hour}_${tripDoc.id}`);
    if((await deliveryRef.get()).exists) continue;
    const tokenSnap=await db.collection("pushTokens").where("aid","==",trip.uid).get();
    const tokens=[...new Set(tokenSnap.docs.filter(doc=>doc.data().active!==false&&doc.data().token).map(doc=>doc.data().token))].slice(0,500);
    if(!tokens.length) continue;
    const body=`${trip.vehicle||"차량"} 차량이 운행 중입니다. 종료 KM을 입력하거나 계속 운행 중을 선택해 주세요.`;
    const response=await getMessaging().sendEachForMulticast({tokens,data:{title:"운행 종료 확인이 필요합니다",body,tripId:tripDoc.id,vehicle:String(trip.vehicle||""),hour:String(hour)}});
    const invalid=[];response.responses.forEach((item,index)=>{if(!item.success&&["messaging/registration-token-not-registered","messaging/invalid-registration-token"].includes(item.error?.code))invalid.push(tokens[index]);});
    await Promise.all(invalid.map(token=>db.doc(`pushTokens/${tokenDocId(token)}`).set({active:false,invalidAt:FieldValue.serverTimestamp()},{merge:true})));
    await deliveryRef.set({tripId:tripDoc.id,uid:trip.uid,vehicle:trip.vehicle,date,hour,successCount:response.successCount,failureCount:response.failureCount,createdAt:FieldValue.serverTimestamp()});
  }
});
