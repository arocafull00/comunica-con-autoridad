import { createHash, randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import pg from "pg";

const target = process.env.TEST_SUPABASE_DATABASE_URL ?? "postgresql://postgres:postgres@127.0.0.1:55322/postgres";
if (!["localhost","127.0.0.1","[::1]"].includes(new URL(target).hostname)) throw new Error("Local database only");
const pool = new pg.Pool({ connectionString: target });
let db: pg.PoolClient;
beforeEach(async () => { db = await pool.connect(); await db.query("begin"); });
afterEach(async () => { await db.query("rollback"); db.release(); });
afterAll(async () => { await pool.end(); });
async function lead(email = `${randomUUID()}@example.com`, whatsapp = true, communications = true) {
  const key = randomUUID();
  const sql = "select public.submit_lead($1,'Adrián','+34612345678',$2,$3,'v3',$4,null,null,null,'Dirección','Situación','Objetivo',$5) as result";
  const args = [key,email,whatsapp,createHash("sha256").update(key).digest("hex"),communications];
  expect((await db.query(sql,args)).rows[0].result.outcome).toBe("created");
  return { key,email,sql,args };
}
async function register(key: string) { return (await db.query("select public.register_webinar($1) as id",[key])).rows[0].id as string; }
async function booking(email: string, extras: Record<string,unknown> = {}) {
  const event = { uid: randomUUID(), previousUid: null, event: "BOOKING_CREATED", eventAt: new Date().toISOString(), email,
    startTime: new Date(Date.now()+48*3600_000).toISOString(), endTime: new Date(Date.now()+48*3600_000+2700_000).toISOString(),
    timeZone: "Europe/Madrid", meetingUrl: "https://meet.google.com/test", ...extras };
  const result=(await db.query("select public.record_cal_booking($1) as result",[JSON.stringify(event)])).rows[0].result;
  return { event,result };
}
async function due(registration: string, step = "email_1") {
  return (await db.query("update public.followup_jobs set scheduled_at=clock_timestamp()-interval '1 second' where registration_id=$1 and step=$2 returning id",[registration,step])).rows[0].id as string;
}
async function claim(id: string) { return (await db.query("select public.claim_followup_job($1,true,true) as result",[id])).rows[0].result; }
async function enableTemplates() {
  const template = (await db.query("insert into public.whatsapp_templates(name,language,body,approved) values($1,'es','Hola {{1}}',true) returning id",[`test_${randomUUID().replaceAll("-","")}`])).rows[0].id;
  await db.query("update public.whatsapp_settings set enabled=true,template_id=$1",[template]);
  const steps=(await db.query("select key as step,replace(body,'{{'||coalesce(parameter,'')||'}}','{{1}}') as body from public.followup_steps where channel='whatsapp'")).rows;
  await db.query("select public.sync_followup_templates($1)",[JSON.stringify(steps.map(s=>({...s,name:`test_${s.step}`,language:"es"})))]);
}
async function reply(text: string, at = new Date(Date.now()+1000).toISOString(), id = randomUUID()) {
  await db.query("select public.record_whatsapp_replies($1)",[JSON.stringify([{id,phone:"+34612345678",receivedAt:at,confirms:text==="CONFIRMO",optsOut:text==="BAJA"}])]);
  return id;
}

describe("webinar registration and consent", () => {
  it("does not enroll on contact save, and records seven jobs only once on granting access", async () => {
    const l=await lead();
    expect((await db.query("select count(*)::int as n from public.webinar_registrations where email=$1",[l.email])).rows[0].n).toBe(0);
    expect((await db.query("select count(*)::int as n from public.whatsapp_messages m join public.leads l on l.id=m.lead_id where l.idempotency_key=$1",[l.key])).rows[0].n).toBe(0);
    const id=await register(l.key); expect(await register(l.key)).toBe(id);
    const duplicate=await lead(l.email); expect(await register(duplicate.key)).toBe(id);
    const {rows}=await db.query("select j.step,extract(epoch from j.scheduled_at-r.registered_at)::int as seconds from public.followup_jobs j join public.webinar_registrations r on r.id=j.registration_id where r.id=$1 order by j.scheduled_at",[id]);
    expect(rows).toHaveLength(7);
    expect(rows.find(row=>row.step==="email_1").seconds).toBe(1800);
    expect(rows.find(row=>row.step==="webinar_3d").seconds).toBe(259200);
  });
  it.each([[false,false,0],[true,false,3],[false,true,4]])("enrolls only consented channels wa=%s email=%s",async(wa,email,count)=>{
    const l=await lead(undefined,wa,email); const id=await register(l.key);
    expect((await db.query("select count(*)::int as n from public.followup_jobs where registration_id=$1",[id])).rows[0].n).toBe(count);
  });
  it("stores both consent evidence and conflicts if an idempotent retry changes email consent",async()=>{
    const l=await lead();
    expect((await db.query("select communications_consent_at,communications_consent_version,whatsapp_consent_at from public.leads where idempotency_key=$1",[l.key])).rows[0]).toMatchObject({communications_consent_at:expect.any(Date),communications_consent_version:"v3",whatsapp_consent_at:expect.any(Date)});
    expect((await db.query(l.sql,l.args)).rows[0].result.outcome).toBe("replayed");
    expect((await db.query(l.sql,[...l.args.slice(0,4),false])).rows[0].result.outcome).toBe("conflict");
  });
  it("rejects incomplete historical contacts instead of manufacturing webinar access",async()=>{
    const key=randomUUID();
    await db.query("select public.submit_lead($1,'Prueba','+34612345678','test@example.com',false,'v1',repeat('a',64))",[key]);
    await expect(register(key)).rejects.toThrow("Completed form required");
  });
});

describe("booking lifecycle",()=>{
  it("stops nonbooker WhatsApps while preserving emails and schedules four booking messages",async()=>{
    const l=await lead(); const id=await register(l.key); const {event}=await booking(l.email);
    await booking(l.email,event);
    const {rows}=await db.query("select step,status from public.followup_jobs where registration_id=$1",[id]);
    expect(rows.filter(row=>row.status==="suppressed")).toHaveLength(3);
    expect(rows.filter(row=>row.step.startsWith("booking_"))).toHaveLength(4);
    expect(rows.filter(row=>row.step.startsWith("email_")&&row.status==="pending")).toHaveLength(4);
  });
  it("associates earlier unmatched bookings on registration",async()=>{
    const l=await lead(); const {event,result}=await booking(l.email); expect(result.matched).toBe(false);
    const id=await register(l.key);
    expect((await db.query("select registration_id from public.call_bookings where uid=$1",[event.uid])).rows[0].registration_id).toBe(id);
    expect((await db.query("select count(*)::int as n from public.followup_jobs where booking_uid=$1",[event.uid])).rows[0].n).toBe(4);
  });
  it("does not schedule elapsed reminders for a short-notice booking",async()=>{
    const l=await lead(); await register(l.key);
    const {event}=await booking(l.email,{startTime:new Date(Date.now()+3600_000).toISOString(),endTime:new Date(Date.now()+6300_000).toISOString()});
    expect((await db.query("select step from public.followup_jobs where booking_uid=$1 order by step",[event.uid])).rows).toEqual([{step:"booking_15m"},{step:"booking_confirmation"}]);
  });
  it("reschedules to a new UID and ignores delayed original creates",async()=>{
    const l=await lead(); await register(l.key); const first=await booking(l.email);
    const moved=await booking(l.email,{...first.event,uid:randomUUID(),previousUid:first.event.uid,event:"BOOKING_RESCHEDULED",eventAt:new Date(Date.now()+1000).toISOString()});
    expect((await booking(l.email,first.event)).result.outcome).toBe("ignored");
    expect((await db.query("select status,replaced_by from public.call_bookings where uid=$1",[first.event.uid])).rows[0]).toEqual({status:"rescheduled",replaced_by:moved.event.uid});
    expect((await db.query("select distinct status from public.followup_jobs where booking_uid=$1",[first.event.uid])).rows).toEqual([{status:"suppressed"}]);
  });
  it("records cancellation even before creation and rejects older creation events",async()=>{
    const l=await lead(); await register(l.key); const now=Date.now();
    const canceled=await booking(l.email,{event:"BOOKING_CANCELLED",eventAt:new Date(now+1000).toISOString()});
    expect((await booking(l.email,{...canceled.event,event:"BOOKING_CREATED",eventAt:new Date(now).toISOString()})).result.outcome).toBe("ignored");
    expect((await db.query("select status from public.call_bookings where uid=$1",[canceled.event.uid])).rows[0].status).toBe("cancelled");
    expect((await booking(l.email,{...canceled.event,event:"BOOKING_CREATED",eventAt:new Date(now+2000).toISOString()})).result.outcome).toBe("ignored");
  });
});

describe("responses and durable claims",()=>{
  it("marks CONFIRMO exactly once and stops only the final unbooked message on a response",async()=>{
    const l=await lead(); const id=await register(l.key); const at=new Date(Date.now()+1000).toISOString();
    const replyId=await reply("Hola",at); await reply("Hola",at,replyId);
    expect((await db.query("select count(*)::int as n from private.followup_replies where provider_id=$1",[replyId])).rows[0].n).toBe(1);
    expect((await db.query("select step,status from public.followup_jobs where registration_id=$1 and step like 'webinar_%' order by step",[id])).rows).toEqual([{step:"webinar_1d",status:"pending"},{step:"webinar_1h",status:"pending"},{step:"webinar_3d",status:"suppressed"}]);
    const {event}=await booking(l.email); await reply("CONFIRMO",new Date(Date.now()+2000).toISOString());
    expect((await db.query("select confirmed_at from public.call_bookings where uid=$1",[event.uid])).rows[0].confirmed_at).toBeInstanceOf(Date);
  });
  it("does not confirm multiple future appointments from an ambiguous response",async()=>{
    const l=await lead(); await register(l.key); const a=await booking(l.email);const b=await booking(l.email);
    await reply("CONFIRMO");
    expect((await db.query("select confirmed_at from public.call_bookings where uid=any($1::text[])",[[a.event.uid,b.event.uid]])).rows.every(row=>row.confirmed_at===null)).toBe(true);
  });
  it("does not confirm several registrations sharing the same telephone",async()=>{
    const a=await lead();const b=await lead();await register(a.key);await register(b.key);
    const first=await booking(a.email);const second=await booking(b.email);await reply("CONFIRMO");
    expect((await db.query("select confirmed_at from public.call_bookings where uid=any($1::text[])",[[first.event.uid,second.event.uid]])).rows.every(row=>row.confirmed_at===null)).toBe(true);
  });
  it("waits for a meeting URL and still expires canceled or late reminders",async()=>{
    const l=await lead();const id=await register(l.key);await enableTemplates();
    const {event}=await booking(l.email,{meetingUrl:null});const job=await due(id,"booking_2h");
    expect((await claim(job)).action).toBe("missing_meeting_url");
    await booking(l.email,{...event,event:"BOOKING_CANCELLED",eventAt:new Date(Date.now()+1000).toISOString()});
    expect((await claim(job)).action).toBe("skip");
  });
  it("caps retries at three and keeps the personalized payload snapshot",async()=>{
    const l=await lead();const id=await register(l.key);const job=await due(id);
    const first=await claim(job);
    for(let attempt=1;attempt<=3;attempt++){
      const active=attempt===1?first:await claim(job);
      expect(active.message).toEqual(first.message);
      await db.query("select public.finish_followup_job($1,$2,'retry',null,'temporary')",[job,active.claimToken]);
      if(attempt<3) await db.query("update public.followup_jobs set scheduled_at=clock_timestamp()-interval '1 second' where id=$1",[job]);
    }
    expect((await db.query("select attempts,status from public.followup_jobs where id=$1",[job])).rows[0]).toEqual({attempts:3,status:"failed"});
  });
  it("rechecks email and WhatsApp consent at claim time and never cancels unconfirmed calls",async()=>{
    const l=await lead(); const id=await register(l.key); const emailJob=await due(id);
    await db.query("select public.unsubscribe_webinar_email($1)",[id]); expect((await claim(emailJob)).action).toBe("skip");
    const waJob=await due(id,"webinar_1h"); await reply("BAJA"); expect((await claim(waJob)).action).toBe("skip");
    const {event}=await booking(l.email);
    expect((await db.query("select status,confirmed_at from public.call_bookings where uid=$1",[event.uid])).rows[0]).toEqual({status:"booked",confirmed_at:null});
  });
  it("requires approved templates and honors the admin pause without using an attempt",async()=>{
    const l=await lead(); const id=await register(l.key); const job=await due(id,"webinar_1h");
    await db.query("update public.whatsapp_settings set enabled=false"); expect((await claim(job)).action).toBe("paused");
    await enableTemplates(); expect((await claim(job)).action).toBe("claimed");
    expect((await claim(job)).action).toBe("busy");
  });
  it("keeps missing templates from monopolizing batches and retries after catalog sync",async()=>{
    const l=await lead();const id=await register(l.key);await enableTemplates();
    await db.query("update private.followup_templates set approved=false where step='webinar_1h'");
    const blocked=await due(id,"webinar_1h");const email=await due(id,"email_1");
    expect((await claim(blocked)).action).toBe("missing_template");
    const ready=(await db.query("select id from public.read_followup_jobs(true,true)")).rows.map(row=>row.id);
    expect(ready).toContain(email);expect(ready).not.toContain(blocked);
    await enableTemplates();
    expect((await db.query("select id from public.read_followup_jobs(true,true)")).rows.map(row=>row.id)).toContain(blocked);
  });
  it("limits concurrent sends across claims to two slots and protects finish tokens",async()=>{
    const l=await lead();const id=await register(l.key);
    const ids=[await due(id,"email_1"),await due(id,"email_2"),await due(id,"email_3")];
    const first=await claim(ids[0]); expect(first.action).toBe("claimed"); expect((await claim(ids[1])).action).toBe("claimed");expect((await claim(ids[2])).action).toBe("busy");
    expect((await db.query("select public.finish_followup_job($1,$2,'sent','provider') as result",[ids[0],randomUUID()])).rows[0].result).toBe(false);
    expect((await db.query("select public.finish_followup_job($1,$2,'sent','provider') as result",[ids[0],first.claimToken])).rows[0].result).toBe(true);
    expect((await claim(ids[2])).action).toBe("claimed");
  });
  it("expires interrupted sends to delivery_unknown rather than risking duplicates",async()=>{
    const l=await lead();const id=await register(l.key);const job=await due(id);await claim(job);
    await db.query("update public.followup_jobs set processing_started_at=clock_timestamp()-interval '121 seconds' where id=$1",[job]);
    expect((await claim(job)).action).toBe("unknown");expect((await claim(job)).action).toBe("skip");
    expect((await db.query("select status,last_error from public.followup_jobs where id=$1",[job])).rows[0]).toEqual({status:"failed",last_error:"delivery_unknown"});
  });
  it("suppresses expired work instead of replaying a stale sequence on activation",async()=>{
    const l=await lead();const id=await register(l.key);const job=await due(id);
    await db.query("update public.followup_jobs set expires_at=clock_timestamp()-interval '1 second' where id=$1",[job]);
    expect((await claim(job)).action).toBe("skip");
    expect((await db.query("select last_error from public.followup_jobs where id=$1",[job])).rows[0].last_error).toBe("schedule_expired");
  });
  it.each(["anon","authenticated"])("denies followup data and functions to %s",async(role)=>{
    for(const sql of ["select * from public.followup_jobs","select * from public.call_bookings","select * from public.webinar_registrations","select public.read_followup_jobs(true,true)","select public.record_cal_booking('{}')","select public.sync_followup_templates('[]')"]){
      await db.query("savepoint denied");await db.query(`set local role ${role}`);await expect(db.query(sql)).rejects.toThrow(/permission denied/);await db.query("rollback to savepoint denied");
    }
  });
});
