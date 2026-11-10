-- Tech Genius Burlington: first shop. Tickets and invoices start fresh
-- (RepairDesk history is not carried over; customers are).
insert into shops (name, legal_name, phone, email, address, city, province, country,
                   tax_name, tax_rate, tax_number, logo_url, brand_color, ticket_prefix,
                   repair_warranty_days, device_warranty_days,
                   ai_call_start, ai_call_end, review_delay_minutes,
                   next_ticket_number, next_invoice_number, invoice_terms)
values ('Tech Genius', 'Tech Genius Burlington Inc.', '+19053333345', 'info@techgenius.ca',
        '796 Brant Street Unit 3', 'Burlington', 'ON', 'CA',
        'HST', 0.13, '741942122RT0001', '/brand/techgenius-logo.png', '#E28E34', 'T-',
        60, 90, '10:00', '19:00', 60,
        1001, 1001,
$terms$Warranty Terms & Conditions (please read carefully):
- Warranty valid for 60 days from the date of the repair completed notification (unless otherwise agreed).
- Warranty coverage applies only to the purchased/installed part or service and does not cover pre-existing conditions.
- Warranty does NOT cover issues arising from ANY liquid damage (1) and/or physical damage (2) under any circumstances.
- If an issue is covered under warranty, customers must come to the store and make a claim BEFORE any physical/liquid damage to the device. No warranty claims are accepted after physical/liquid damage.
- Claims about liquid and/or drop resistance prior to the repair are not valid grounds for a warranty claim after liquid/physical damage.
- Valid warranty claims are handled on a priority basis.
(1) OEM sealant tape/adhesive is used, but we do NOT warranty ANY liquid damage. Repairs are liquid resistant, not liquid proof.
(2) No physical damage is covered under warranty, regardless of time since repair, including internal LCD/OLED damage with no visible outer damage.$terms$);
