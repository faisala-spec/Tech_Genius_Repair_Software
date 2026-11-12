import { requireStaff } from "@/lib/session";
import { fullName } from "@/lib/format";
import { ui } from "@/lib/ui";
import CheckInForm from "@/components/CheckInForm";

export const dynamic = "force-dynamic";

export default async function NewTicket({ searchParams }: { searchParams: Promise<{ customer?: string; error?: string }> }) {
  const { customer, error } = await searchParams;
  const { supabase } = await requireStaff();

  const [{ data: c }, { data: techs }] = await Promise.all([
    customer
      ? supabase.from("customers").select("id, first_name, last_name, company, phone, email").eq("id", customer).maybeSingle()
      : Promise.resolve({ data: null }),
    supabase.from("staff").select("id, full_name").eq("active", true).order("full_name"),
  ]);

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <h1 className={ui.h1}>New repair ticket</h1>
      <CheckInForm
        techs={techs ?? []}
        initialCustomer={c ? { id: c.id, name: fullName(c), phone: c.phone, email: c.email } : null}
        showError={error === "customer"}
      />
    </div>
  );
}
