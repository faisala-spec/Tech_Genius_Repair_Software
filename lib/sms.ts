/** Sends a text through Twilio. Returns ok:false (without throwing) when texting isn't set up. */
export async function sendSms(to: string, body: string): Promise<{ ok: boolean; id?: string; error?: string }> {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const from = process.env.TWILIO_FROM_NUMBER;
  if (!sid || !token || !from) return { ok: false, error: "Texting is not set up yet" };

  try {
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
      method: "POST",
      headers: {
        Authorization: "Basic " + Buffer.from(`${sid}:${token}`).toString("base64"),
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ To: to, From: from, Body: body }),
    });
    const json = await res.json();
    return res.ok ? { ok: true, id: json.sid } : { ok: false, error: json.message ?? "Text failed" };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? "Text failed" };
  }
}

export const smsTemplates = {
  created: (first: string, device: string, ticket: string, shopName: string) =>
    `Hi ${first}, thanks for choosing ${shopName}! We've checked in your ${device} under ticket ${ticket}. We'll text you as soon as there's an update.`,
  ready: (first: string, device: string, ticket: string, shopName: string, balance: string | null) =>
    `Hi ${first}, good news: your ${device} is ready for pickup at ${shopName} (ticket ${ticket}).${
      balance ? ` Balance due: ${balance}.` : ""
    } See you soon!`,
};
