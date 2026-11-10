import CustomerForm from "@/components/CustomerForm";
import { createCustomer } from "../actions";
import { requireStaff } from "@/lib/session";
import { ui } from "@/lib/ui";

export default async function NewCustomer({ searchParams }: { searchParams: Promise<{ then?: string }> }) {
  await requireStaff();
  const { then } = await searchParams;
  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <h1 className={ui.h1}>New customer</h1>
      <CustomerForm action={createCustomer} then={then} />
    </div>
  );
}
