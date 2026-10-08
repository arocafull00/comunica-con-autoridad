import { createHmac, randomBytes, randomUUID } from "node:crypto";
import { execSync } from "node:child_process";
import { createClient } from "@supabase/supabase-js";
import { expect, test } from "@playwright/test";
import pg from "pg";
import { fillMasterclass } from "../browser/masterclass-helper";
import { unsubscribeToken } from "../../lib/followups/unsubscribe";

test("real form consents, signed booking, CONFIRMO and unsubscribe persist with sends disabled",async({page,request})=>{
  const db=new pg.Client({connectionString:"postgresql://postgres:postgres@127.0.0.1:55322/postgres"});await db.connect();
  const email=`flow-${randomUUID()}@example.com`;const uid=randomUUID();const replyId=`wamid.${randomUUID()}`;
  const sign=(value:string,secret:string)=>createHmac("sha256",secret).update(value).digest("hex");
  try{
    await page.goto("/");await fillMasterclass(page,email);
    await page.locator("#whatsappConsent").check();await page.locator("#communicationsConsent").check();
    await page.setViewportSize({width:390,height:900});
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
    await page.screenshot({path:"test-results/flow-consents-mobile.png",fullPage:true});
    await page.getByRole("button",{name:"DESBLOQUEAR MASTERCLASS"}).click();
    await expect(page.locator("#webinar-content")).toBeVisible();
    const saved=(await db.query("select l.whatsapp_consent,l.communications_consent,r.id from public.leads l join public.webinar_registrations r on r.lead_id=l.id where l.email=$1",[email])).rows[0];
    expect(saved).toMatchObject({whatsapp_consent:true,communications_consent:true});
    expect((await db.query("select count(*)::int as n from public.followup_jobs where registration_id=$1",[saved.id])).rows[0].n).toBe(7);
    const raw=JSON.stringify({triggerEvent:"BOOKING_CREATED",createdAt:new Date().toISOString(),payload:{uid,type:"sesion-gratuita-comunicacion",
      startTime:new Date(Date.now()+48*3600_000).toISOString(),endTime:new Date(Date.now()+48*3600_000+2700_000).toISOString(),
      attendees:[{email,timeZone:"Europe/Madrid"}],metadata:{videoCallUrl:"https://meet.google.com/local-test"}}});
    const headers={"Content-Type":"application/json","x-cal-signature-256":sign(raw,"local-browser-cal-secret-at-least-32-characters")};
    expect((await request.post("/api/webhooks/cal",{headers,data:raw})).status()).toBe(200);
    expect((await request.post("/api/webhooks/cal",{headers,data:raw})).status()).toBe(200);
    expect((await db.query("select count(*)::int as n from public.followup_jobs where booking_uid=$1",[uid])).rows[0].n).toBe(4);
    // Use the next complete second so the provider timestamp follows this booking envelope.
    await page.waitForTimeout(1100);
    const incoming=JSON.stringify({object:"whatsapp_business_account",entry:[{changes:[{field:"messages",value:{metadata:{phone_number_id:"123456789"},messages:[{id:replyId,from:"34612345678",timestamp:Math.floor(Date.now()/1000).toString(),type:"text",text:{body:"CONFIRMO"}}]}}]}]});
    expect((await request.post("/api/webhooks/whatsapp",{headers:{"Content-Type":"application/json","x-hub-signature-256":`sha256=${sign(incoming,"local-browser-meta-secret-at-least-32-characters")}`},data:incoming})).status()).toBe(200);
    expect((await db.query("select confirmed_at from public.call_bookings where uid=$1",[uid])).rows[0].confirmed_at).toBeInstanceOf(Date);
    const token=unsubscribeToken(saved.id,"local-browser-unsubscribe-secret-at-least-32-characters");
    await page.goto(`/api/followups/unsubscribe?token=${token}`);
    expect((await db.query("select email_unsubscribed_at from public.webinar_registrations where id=$1",[saved.id])).rows[0].email_unsubscribed_at).toBeNull();
    await page.getByRole("button",{name:"Dejar de recibir emails"}).click();
    await expect(page.getByText("Ya no recibirás esta secuencia de emails.",{exact:false})).toBeVisible();
    expect((await db.query("select communications_consent from public.leads where email=$1",[email])).rows[0].communications_consent).toBe(false);
    expect((await db.query("select distinct status from public.followup_jobs where registration_id=$1 and step like 'email_%'",[saved.id])).rows).toEqual([{status:"suppressed"}]);
    expect((await db.query("select sum(attempts)::int as attempts from public.followup_jobs where registration_id=$1",[saved.id])).rows[0].attempts).toBe(0);
  } finally{
    await db.query("delete from public.call_bookings where email=$1",[email]);
    await db.query("delete from public.leads where email=$1",[email]);
    await db.query("delete from private.followup_replies where provider_id=$1",[replyId]);await db.end();
  }
});

test("private calls page exposes manual review and fits mobile widths",async({page})=>{
  const status=JSON.parse(execSync("pnpm exec supabase status -o json",{encoding:"utf8",stdio:["ignore","pipe","pipe"]}));
  if(!["localhost","127.0.0.1"].includes(new URL(status.API_URL).hostname)) throw new Error("Local Auth only");
  const auth=createClient(status.API_URL,status.SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
  const db=new pg.Client({connectionString:"postgresql://postgres:postgres@127.0.0.1:55322/postgres"});await db.connect();
  const email=`calls-admin-${randomUUID()}@example.com`;const contact=`calls-contact-${randomUUID()}@example.com`;const uid=randomUUID();
  const password=`Local-${randomBytes(18).toString("hex")}`;let adminId:string|undefined;
  try{
    const created=await auth.auth.admin.createUser({email,password,email_confirm:true});
    if(created.error)throw new Error("Cannot create local admin");adminId=created.data.user.id;
    await db.query("insert into public.admin_accounts(user_id) values($1)",[adminId]);
    await db.query("select public.record_cal_booking($1)",[JSON.stringify({uid,event:"BOOKING_CREATED",eventAt:new Date().toISOString(),email:contact,
      startTime:new Date(Date.now()+48*3600_000).toISOString(),endTime:new Date(Date.now()+48*3600_000+2700_000).toISOString(),timeZone:"Europe/Madrid",meetingUrl:"https://meet.google.com/local-test"})]);
    await page.goto("/admin/calls");await expect(page).toHaveURL(/\/admin\/login$/);
    await page.getByLabel("Email",{exact:true}).fill(email);await page.getByLabel("Contraseña",{exact:true}).fill(password);
    await page.getByRole("button",{name:"Entrar",exact:true}).click();
    await page.getByRole("link",{name:"Llamadas",exact:true}).click();
    await expect(page.getByRole("heading",{name:"Llamadas",exact:true})).toBeVisible();
    const row=page.getByRole("row").filter({hasText:contact});await expect(row).toContainText("Pendiente de revisión");
    await expect(row).toContainText("Sin formulario asociado a este email.");
    for(const width of [1280,768,390,320]){
      await page.setViewportSize({width,height:900});
      expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
      const labels = width > 800 ? page.getByRole("columnheader") : row;
      for (const [column, explanation] of [
        ["contacto", "Puede haber reservado directamente desde el enlace de Cal.com"],
        ["sesión", "zona horaria de la persona que reservó"],
        ["confirmación", "La falta de confirmación no cancela la reserva automáticamente"],
      ]) {
        const trigger = labels.getByRole("button", { name: `Información sobre ${column}`, exact: true });
        await trigger.focus();
        await page.keyboard.press("Enter");
        const info = page.getByRole("dialog", { name: `Información sobre ${column}`, exact: true });
        await expect(info).toBeVisible();
        await expect(info).toContainText(explanation);
        const bounds = await info.boundingBox();
        expect(bounds).not.toBeNull();
        expect(bounds!.x).toBeGreaterThanOrEqual(0);
        expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);
        expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
        await page.screenshot({path:`test-results/calls-info-${column}-${width}.png`,fullPage:true});
        await page.keyboard.press("Escape");
        await expect(info).toBeHidden();
        await expect(trigger).toBeFocused();
      }
      const trigger = labels.getByRole("button", { name: "Información sobre contacto", exact: true });
      await trigger.click();
      await page.getByRole("button", { name: "Cerrar información", exact: true }).click();
      await expect(page.getByRole("dialog")).toBeHidden();
      await page.screenshot({path:`test-results/calls-${width}.png`,fullPage:true});
    }
    await db.query("update public.call_bookings set confirmed_at=now() where uid=$1",[uid]);await page.reload();
    await expect(page.getByRole("row").filter({hasText:contact})).toContainText("CONFIRMO recibido");
  }finally{
    await db.query("delete from public.call_bookings where uid=$1",[uid]);
    if(adminId)await auth.auth.admin.deleteUser(adminId);await db.end();
  }
});
