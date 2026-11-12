# Printing at the counter

Two printers:
- **Brother QL-800**: ticket labels (stick on the device or its bag)
- **Brother MFC**: invoices on normal paper

Do these steps once on each counter computer. Use **Chrome or Edge**.

## 1. Brother QL-800 (labels)

1. Install the **QL-800 driver** from Brother's website (support.brother.com → QL-800 → Downloads → Windows → "Printer Driver"). Plug in the USB cable when the installer asks.
2. On the printer, make sure the **Editor Lite** light (green, on the front) is **off**. If it's on, hold the Editor Lite button until it turns off. With it on, the computer can't print to it.
3. Load a 62 mm roll:
   - **DK-1209** (62 × 29 mm labels), or
   - **DK-2205** (62 mm continuous): the printer cuts each label after 29 mm.
4. Windows → Settings → Printers → **Brother QL-800** → Printing preferences:
   - Paper size: **62mm x 29mm** (or for DK-2205: "62mm" continuous, length 29 mm)
   - Orientation: **Landscape** if the preview looks sideways; otherwise Portrait
   - Turn on **Auto cut**
5. In the app, open any ticket → **Print label**. In the print box:
   - Printer: **Brother QL-800**
   - More settings → Margins: **None**, Scale: **100**, untick **Headers and footers**
   - Print

   Chrome/Edge remember these choices for the label page, so next time it's just **Print** (or Enter).

The label shows: ticket number (big), date, customer name, phone, device and problem.

## 2. Brother MFC (invoices)

1. Install the MFC driver if it isn't already.
2. Invoice → **Print / Save as PDF** → Printer: **Brother MFC**, Paper: **Letter**, Margins: **Default**, untick **Headers and footers**.

## 3. Optional: one-click label printing (no print box)

If the counter computer only ever prints labels from Chrome, a shortcut can skip the print box completely:

1. Set the **QL-800 as the Windows default printer**.
2. Make a desktop shortcut for Chrome with this at the end of "Target":
   `--kiosk-printing`
3. Open the app from that shortcut. Labels now print straight away when a ticket is created.

Downside: invoices would also go straight to the QL-800. So only do this if invoices are printed from another computer, or use a second Chrome shortcut without the flag for invoices.

## Problems?

| What you see | Fix |
| --- | --- |
| Nothing prints, no error | Editor Lite light is on (step 1.2) |
| Label is tiny or cut off | Margins **None**, Scale **100** in the print box |
| Two labels come out | Paper size is wrong in Printing preferences (step 1.4) |
| Print box shows a full page | Pick the QL-800 printer; the page size comes from the printer |
