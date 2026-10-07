# Daisey money: proposal (2026-10-07)

Status: a proposal for Mor to approve. No code has been written for it yet.

## What it covers

1. **Receivables**: who owes Mor money, plus reminders that nudge them.
2. **Payables**: who Mor has to pay, how much, and by when.
3. **Budget**: a simple monthly table of planned against actual amounts per category.

## Main idea: money entries become tasks when action is due

Daisey already does three things well: it knows the date, it nudges, and it puts one thing on the card. Money should feed into those strengths. It should not become a second app inside the app.

- A money entry is its own record, kept separate from tasks. It holds an amount, a person, a due date and a state.
- When an entry needs action, Daisey creates or updates one ordinary task for it, such as "Pay Arnona ₪480 (due Thu)" or "Nudge Uri: ₪2,400, 12 days late". The engine already ranks tasks by date and stakes, so these tasks reach the Now card and the day proposal with no new ranking logic.
- When the task is marked done, the entry updates: it is marked paid, or the nudge is logged.

## Data (Firestore, under `users/{uid}/`)

```
money/{id}
  kind:      "in" | "out"            // owed to me | I owe
  who:       "Uri"                   // person or company
  what:      "Mix for Reprise ep 3"  // what it's for
  amount:    2400                    // whole units, in `currency`
  currency:  "ILS"
  issuedOn:  "2026-10-01"            // invoice sent / bill received
  dueOn:     "2026-10-15"
  state:     "open" | "partial" | "paid" | "written_off"
  paid:      [{ on: "2026-10-20", amount: 1200 }]   // partial payments
  project:   "Reprise"               // optional, ties to a Daisey project
  contact:   { phone?, email? }      // for the nudge
  nudges:    [{ on, via: "whatsapp" | "email" }]
  nudgeEvery: 7                      // days between nudges once late (default 7)
  repeat:    null | "monthly" | "yearly"   // rent, subscriptions, arnona
  category:  "Rent"                  // budget category (payables + income)
  taskId:    "…"                     // the task currently standing in for it
  createdAt, touchedAt

state/budget
  month: "2026-10"
  categories: [{ name: "Rent", planned: 4200, kind: "out" }, { name: "Gigs", planned: 9000, kind: "in" }, …]
```

Why this shape:

- **One collection for both directions.** "In" and "out" differ only in which way the money moves and what the nudge says. Keeping them together means one list, one set of rules, and one place to calculate the balance.
- **Payments are stored as a list, not a yes/no flag.** Clients often pay in parts, and the list keeps that history.
- **The amount is stored with its currency.** Mor gets paid in ILS and sometimes in USD or EUR. Totals are shown per currency. Daisey does not convert currencies in v1.
- **`repeat` replaces repeating tasks.** The spec says there are no repeating tasks. A repeating bill is different: it has a real amount and a real due date. When it is paid, Daisey creates the next one.
- **Actual budget amounts are calculated, not typed in.** The budget table adds up the money entries paid each month by category. Mor only types the planned amounts.

## Where it goes in the UI

- **A "Money" page, opened from a button next to Projects** in the Schedule header (the same pattern as Projects). It has three tabs:
  - **Owed to me**: late entries first, each with its amount, how many days late, and Nudge / Paid / Partial.
  - **I owe**: sorted by due date, each with Pay / Paid.
  - **Budget**: one row per category with planned, actual and difference for this month, plus a row showing what has come in against what has gone out. Swipe sideways to change month.
- **Adding entries.** In Tell Daisey, "Uri owes me 2400 for the mix, due the 15th" and "pay arnona 480 by Thursday" become confirm cards, using a new `money` action in `daisey-now-chat.js`. The + menu gets a third item, Money. The entry form is a sheet with fields in this order: who, amount, what, due date, then In/Out.
- **The Now card and the day proposal.** Only the stand-in tasks appear there, as described above. A payment due today ranks like a deadline. A late receivable becomes a short call-type task ("Nudge Uri"), which can be batched with other calls.
- **Needs you.** One weekly question: "3 invoices are late, ₪5,200 in total. Nudge them all?" It also asks when a repeating bill has no amount yet.
- **The morning brief** gets one line: "₪2,400 owed to you is late. Arnona is due Thursday."

## Nudges (receivables)

- When an entry passes its due date, Daisey creates a nudge task. After that it creates a new one every `nudgeEvery` days until the entry is paid.
- **The nudge is a drafted message, not an automatic send.** It uses the same WhatsApp flow as Pending's nudge (`nudge.js`): Daisey writes a polite note with the amount and the invoice details, and Mor picks the contact and sends it. Daisey never messages anyone itself. That is a deliberate safety line.
- The tone gets firmer over time: first a friendly reminder, then a mention of the date, then a mention of the amount and the number of days late. The wording follows the language of the entry, Hebrew or English.
- Optional later step: an email draft through Gmail, if Mor connects it.

## Phases

1. **Records and the page.** The `money` collection, the Money page with the two lists, the entry sheet, and marking entries Paid or Partial. Stand-in tasks for payables due within 3 days. *(About one session.)*
2. **Nudges.** Late receivables create nudge tasks, with the WhatsApp drafts and the Needs-you question. *(About one session.)*
3. **Tell Daisey and the brief.** The `money` action in the chat function and the line in the morning brief.
4. **Budget.** The `state/budget` planned amounts, the monthly table, and repeating bills.

## Questions for Mor before building

1. **Currency.** Is ILS-only fine for v1, or are USD and EUR needed from the start? Totals stay separate per currency either way.
2. **Invoices.** Should Daisey just link to the invoice (a Green Invoice or Drive link in the entry), or should it create invoices too? This plan assumes linking only.
3. **The budget's actual amounts.** Should they come only from entries logged in Daisey, or should Mor be able to import a bank CSV? CSV import would be a phase 5.
4. **Privacy.** Amounts would live in the same Firestore account as tasks, readable only by Mor (the existing rules). Is that acceptable, or should money data stay on the device only?
5. **Nudge channel.** WhatsApp drafts only, or email drafts as well?
