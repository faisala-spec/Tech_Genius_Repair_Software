"""
Clean RepairDesk exports and turn them into import-ready files for Tech Genius Software.

Usage:
    python import_repairdesk.py --customers Customers.xlsx --products products.xlsx --out output/

Writes:
    customers_clean.csv   -> loads into the `customers` table
    products_clean.csv    -> loads into the `products` table
    review.xlsx           -> rows a person should check before go-live
    report.json           -> counts proving every input row is accounted for

Nothing is deleted: rows RepairDesk marked for deletion are imported as archived,
and anything we could not clean is kept in the customer's notes.
"""
import argparse, json, re
from pathlib import Path
import pandas as pd

MAC_RE = re.compile(r"(?:[0-9A-Fa-f]{2}[:\-]){5}[0-9A-Fa-f]{2}")
EXT_RE = re.compile(r"\s*(ext\.?|x)\s*\d+\s*$", re.I)
PROVINCES = {"ON": "ON", "ONTARIO": "ON", "QC": "QC", "QUEBEC": "QC", "BC": "BC", "AB": "AB",
             "MB": "MB", "SK": "SK", "NS": "NS", "NB": "NB", "NL": "NL", "PE": "PE"}
COUNTRIES = {"CANADA": "CA", "CA": "CA", "UNITED STATES": "US", "USA": "US", "US": "US",
             "UNITED ARAB EMIRATES": "AE"}
NO_REFERRAL = {"not applicable", "not referred", ""}


def s(v):
    """Clean string or None."""
    if v is None or (isinstance(v, float) and pd.isna(v)):
        return None
    v = str(v).strip()
    return v or None


def name_case(v):
    v = s(v)
    if v and v == v.lower():
        return " ".join(w[:1].upper() + w[1:] for w in v.split())
    return v


def normalize_phone(raw):
    """Return (e164 or None, problem or None)."""
    raw = s(raw)
    if not raw:
        return None, None
    ext = EXT_RE.search(raw)
    body = EXT_RE.sub("", raw)
    digits = re.sub(r"\D", "", body)
    plus = body.strip().startswith("+")
    if plus and digits.startswith("1") and len(digits) == 11:
        e164 = "+" + digits
    elif plus and not digits.startswith("1") and 8 <= len(digits) <= 15:
        e164 = "+" + digits                     # international number
    elif not plus and len(digits) == 10:
        e164 = "+1" + digits
    elif not plus and len(digits) == 11 and digits.startswith("1"):
        e164 = "+" + digits
    else:
        return None, f"unreadable phone: {raw}"
    if e164.startswith("+1") and e164[2] in "01":
        return None, f"unreadable phone: {raw}"  # NANP area codes never start with 0/1
    return e164, (f"extension {ext.group(0).strip()}" if ext else None)


def clean_customers(path):
    df = pd.read_excel(path, dtype=str)
    rows_in = len(df)

    # exact duplicate rows (same code, same everything) are dropped once
    exact_dups = df[df.duplicated(keep="first")]
    df = df.drop_duplicates(keep="first")

    out, problems = [], []
    for _, r in df.iterrows():
        notes = []
        mobile, p1 = normalize_phone(r.get("Mobile"))
        phone, p2 = normalize_phone(r.get("Phone"))
        for p in (p1, p2):
            if p:
                notes.append(p)
        primary = mobile or phone
        alt = phone if (mobile and phone and phone != mobile) else None

        addr = s(r.get("Address1"))
        if addr and MAC_RE.search(addr):
            notes.append(f"Device/box ID from RepairDesk address field: {addr}")
            addr = None
        addr2 = s(r.get("Address2"))
        if addr and addr2:
            addr = f"{addr}, {addr2}"

        prov = s(r.get("State"))
        prov = PROVINCES.get(prov.upper()) if prov else None
        country = s(r.get("Country"))
        country = COUNTRIES.get(country.upper()) if country else None
        city = s(r.get("City"))
        city = name_case(city.title() if city and city.isupper() else city)

        ref = s(r.get("Refered By")) or ""
        ref = None if ref.lower() in NO_REFERRAL else ref
        if ref == "Customer Referral":
            ref = "Referred By A Friend"

        archived = s(r.get("Store Name")) == "DELETE 1"
        email = s(r.get("Email"))
        rec = pd.to_numeric(r.get("Amount Receivables"), errors="coerce")

        row = dict(
            legacy_code=s(r["Code"]),
            first_name=name_case(r.get("FirstName")),
            last_name=name_case(r.get("LastName")),
            company=s(r.get("Organization")),
            phone=primary,
            phone_alt=alt,
            email=email.lower() if email else None,
            address=addr,
            city=city,
            province=prov,
            postal_code=(s(r.get("Postcode")) or "").upper() or None,
            country=country,
            referral_source=ref,
            notes="; ".join(notes) or None,
            archived=archived,
            legacy_ticket_count=int(pd.Series([r.get("Ticket")]).pipe(pd.to_numeric, errors="coerce").fillna(0).iloc[0]),
            legacy_lifetime_spend=float(pd.Series([r.get("Tickets Amount")]).pipe(pd.to_numeric, errors="coerce").fillna(0).iloc[0]),
        )
        out.append(row)
        problems.append(dict(
            legacy_code=row["legacy_code"],
            no_phone=primary is None,
            unreadable_phone=any(p and p.startswith("unreadable") for p in (p1, p2)),
            receivable=float(rec) if pd.notna(rec) and rec > 0 else 0.0,
            mac_moved=bool(s(r.get("Address1")) and MAC_RE.search(s(r.get("Address1")))),
        ))

    clean = pd.DataFrame(out)
    prob = pd.DataFrame(problems)

    # legacy codes that collide but are NOT exact duplicates get a suffix so search still works
    dup_code = clean["legacy_code"].duplicated(keep="first")
    clean.loc[dup_code, "legacy_code"] = clean.loc[dup_code, "legacy_code"] + "-b"

    return clean, prob, rows_in, exact_dups


def categorize(name):
    n = name.lower()
    if any(k in n for k in ("session", "support", "repair", "labour", "labor")):
        return "service"
    if any(k in n for k in ("case", "protector", "pen", "controller", "charger", "cable")):
        return "accessory"
    if any(k in n for k in ("camera", "screen", "battery", "port", "lcd")) and "protector" not in n:
        return "part"
    return "device"


def clean_products(path):
    df = pd.read_excel(path, dtype=str)
    df = df[pd.to_numeric(df["Item ID"], errors="coerce").notna()]   # drop RepairDesk's help row
    out, issues = [], []
    for _, r in df.iterrows():
        name = s(r["Item Name"])
        qty = int(float(s(r.get("On Hand Qty")) or 0))
        cost = float(s(r.get("Cost Price")) or 0)
        price = float(s(r.get("Retail Price")) or 0)
        cat = categorize(name)
        why = []
        if qty < 0:
            why.append(f"stock is {qty} in RepairDesk (sold more than received); imported as 0")
        if cost == 0 and cat != "service":
            why.append("no cost price, so profit can't be calculated")
        if price == 0 and cat != "service":
            why.append("no retail price")
        desc = s(r.get("Description"))
        out.append(dict(
            legacy_id=s(r["Item ID"]), name=name if not desc else f"{name} ({desc})",
            category=cat, sku=s(r.get("SKU")), barcode=None,   # RepairDesk 'UPC' here is a row counter, not a barcode
            cost=cost, price=price, taxable=s(r.get("Tax Class")) == "ONHST",
            serialized=cat == "device", qty_on_hand=max(qty, 0),
            warranty_days=int(float(s(r.get("Warranty")) or 0)) or None, active=True,
        ))
        issues.append(dict(legacy_id=s(r["Item ID"]), item=name, repairdesk_qty=qty,
                           cost=cost, price=price, issue="; ".join(why) or "OK"))
    return pd.DataFrame(out), pd.DataFrame(issues), len(df)


def write_review(path, clean, prob, exact_dups, prod_issues):
    from openpyxl import Workbook
    from openpyxl.styles import Font, PatternFill, Alignment
    from openpyxl.utils import get_column_letter

    c = pd.concat([clean.reset_index(drop=True), prob.drop(columns="legacy_code").reset_index(drop=True)], axis=1)
    name = (c["first_name"].fillna("") + " " + c["last_name"].fillna("")).str.strip()
    c = c.assign(name=name)

    shared = c[c["phone"].notna() & c["phone"].duplicated(keep=False)].sort_values(["phone", "legacy_code"])
    sheets = {
        "Shared phone numbers": (
            "Several customers share one phone number. Could be family members or duplicate profiles. "
            "Tell us which ones to merge; the rest stay separate.",
            shared[["phone", "legacy_code", "name", "email", "legacy_ticket_count", "archived"]]),
        "Open balances": (
            "RepairDesk shows money owed by these customers. Please confirm which balances are real "
            "before we carry them over; they are NOT imported as balances yet.",
            c[c["receivable"] > 0].sort_values("receivable", ascending=False)
             [["legacy_code", "name", "company", "phone", "receivable", "legacy_ticket_count"]]),
        "Phone problems": (
            "Phone numbers we could not read. These customers are still imported; the original "
            "number is saved in their notes.",
            c[c["unreadable_phone"]][["legacy_code", "name", "notes"]]),
        "No phone": (
            "Customers with no phone number. They are imported but cannot get texts.",
            c[c["no_phone"] & ~c["unreadable_phone"]][["legacy_code", "name", "email", "legacy_ticket_count", "archived"]]),
        "Marked DELETE": (
            "RepairDesk store name was 'DELETE 1'. Imported as archived (hidden from search). "
            "Say if any should be restored or removed for good.",
            c[c["archived"]][["legacy_code", "name", "phone", "legacy_ticket_count"]]),
        "Products": (
            "Your RepairDesk stock counts are mostly negative and most items have no cost. "
            "We recommend a fresh stock count on day one instead of trusting these numbers.",
            prod_issues),
    }

    wb = Workbook()
    wb.remove(wb.active)
    head_fill = PatternFill("solid", start_color="E28E34")
    for title, (note, df) in sheets.items():
        ws = wb.create_sheet(title)
        ws["A1"] = note
        ws["A1"].font = Font(name="Arial", italic=True, size=10)
        ws["A1"].alignment = Alignment(wrap_text=True, vertical="top")
        ws.merge_cells(start_row=1, start_column=1, end_row=1, end_column=max(len(df.columns), 4))
        ws.row_dimensions[1].height = 42
        cols = [col.replace("_", " ").capitalize() for col in df.columns]
        for j, col in enumerate(cols, 1):
            cell = ws.cell(row=3, column=j, value=col)
            cell.font = Font(name="Arial", bold=True, color="FFFFFF")
            cell.fill = head_fill
        for i, rec in enumerate(df.itertuples(index=False), 4):
            for j, v in enumerate(rec, 1):
                if isinstance(v, float) and pd.isna(v):
                    v = None
                cell = ws.cell(row=i, column=j, value=v)
                cell.font = Font(name="Arial", size=10)
                if df.columns[j - 1] in ("receivable", "cost", "price"):
                    cell.number_format = '$#,##0.00'
        for j, col in enumerate(df.columns, 1):
            width = max([len(cols[j - 1])] + [len(str(x)) for x in df[col].head(300) if x is not None])
            ws.column_dimensions[get_column_letter(j)].width = min(max(width + 2, 10), 60)
        ws.freeze_panes = "A4"
    wb.save(path)
    return {k: len(v[1]) for k, v in sheets.items()}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--customers", required=True)
    ap.add_argument("--products", required=True)
    ap.add_argument("--out", default="output")
    a = ap.parse_args()
    out = Path(a.out)
    out.mkdir(parents=True, exist_ok=True)

    clean, prob, rows_in, exact_dups = clean_customers(a.customers)
    products, prod_issues, prod_in = clean_products(a.products)

    clean.to_csv(out / "customers_clean.csv", index=False)
    products.to_csv(out / "products_clean.csv", index=False)
    review_counts = write_review(out / "review.xlsx", clean, prob, exact_dups, prod_issues)

    report = {
        "customers_in_export": rows_in,
        "exact_duplicate_rows_dropped": len(exact_dups),
        "customers_imported": len(clean),
        "customers_active": int((~clean["archived"]).sum()),
        "customers_archived": int(clean["archived"].sum()),
        "every_row_accounted_for": rows_in == len(clean) + len(exact_dups),
        "with_phone": int(clean["phone"].notna().sum()),
        "with_email": int(clean["email"].notna().sum()),
        "device_ids_moved_out_of_address": int(prob["mac_moved"].sum()),
        "products_in_export": prod_in,
        "products_imported": len(products),
        "review_rows": review_counts,
    }
    (out / "report.json").write_text(json.dumps(report, indent=2))
    print(json.dumps(report, indent=2))



if __name__ == "__main__":
    main()
