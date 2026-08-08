# GPT Hubli — agent rules

## Signature stamp (mandatory — do not forget)

**Every time someone changes, approves, rejects, verifies, transfers, deletes, or flags data, the system must record and show who did it.**

Applies to all actors:

- Student  
- HOD  
- ACM  
- Exam Cell  
- Principal  
- Root Admin  
- Faculty / other staff  

### What to store (on every write)

| Field | Meaning |
|--------|---------|
| `by_id` | users.id (when known) |
| `by_name` | display name |
| `by_role` | role code (`exam`, `hod`, `acm`, …) |
| `at` | ISO timestamp (India display in UI) |
| `action` | `approved` / `edited` / `verified` / `rejected` / … |

Use shared helpers:

- Server: `lib/signature-stamp.ts` → `stampFromSession(user, action)`  
- Client UI: `public/gpth-stamp.js` → `window.gpthStamp.html(stamp)` or `.line(stamp)`  

### What to show in UI

Visible stamp, not only logs, e.g.:

> **Approved by** Akshay Uppar (Exam Cell) · 08 Aug 2026, 10:15  

or the full signature card from `gpthStamp.html()`.

### When building new features

1. On API write: always set stamp from `getCurrentUser()` / session.  
2. On API read: return stamp fields so the UI can render them.  
3. On list/detail UI: show stamp for approve **and** edit paths.  
4. Never silently overwrite history without recording the new actor.  
5. Prefer dedicated columns or a `last_change` / audit JSON object — never drop who/when.

### Related existing coverage

- Account approvals: `approved_by_name` / `approved_by_role`  
- Student Management ops: `last_change`, branch-transfer `created_by_*` / `accepted_by_*`  
- Exam fees: `paid_marked_by_name`  
- Exam attempts: `verified_by_name`, `verifier_role`  
- Forms: `verified_by_name`, `edited_by_name`  

New modules must follow the same pattern from day one.

## Other product rules (short)

- No emoji in **user-entered** data (see `lib/no-emoji.ts` + `cms-boot.js`).  
- Exam Module: no Pathways tab (HOD keeps pathways).  
- Exam Cell sidebar: Approvals, Students, Student Data, Exam Module, Branch Transfer, Student Management, Live Academic.  
- ACM: same write rights as HOD for academic documentation / SM hub where already granted.  
