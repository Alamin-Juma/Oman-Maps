# Data model

Source of truth: [`apps/api/src/db/schema.ts`](../../apps/api/src/db/schema.ts). Migrations: `apps/api/drizzle/`.
Update this diagram in the same PR as any schema change.

```mermaid
erDiagram
  parents ||--o{ consents : gives
  parents ||--o{ child_profiles : owns
  child_profiles ||--o{ learning_events : produces

  parents {
    uuid id PK
    text email UK
    text password_hash "scrypt"
    timestamptz created_at
  }
  consents {
    uuid id PK
    uuid parent_id FK
    text policy_version
    text method
    timestamptz given_at
  }
  child_profiles {
    uuid id PK
    uuid parent_id FK
    text nickname "not a real name"
    int grade
    text pin_hash "picture PIN, scrypt"
    timestamptz created_at
  }
  learning_events {
    uuid event_id PK "client UUID = idempotency key"
    uuid profile_id FK
    text pack_id "scopes progress per pack"
    text skill_id
    text task_id
    text kind "choice|locate|explain|follow-up"
    bool correct
    timestamptz occurred_at "device clock"
    text context "mission|review"
    text checked_by "ai|local"
    timestamptz received_at
  }
```

## Deliberately NOT stored (data minimisation)

| Not stored | Why |
|---|---|
| Child's real name, date of birth, photo | Not needed for learning; ODPC guidance asks for minimal data |
| Location, device identifiers | Not needed |
| Camera frames | Map recognition happens on the device |
| Voice recordings | Narration is pre-recorded; children never record |
| Mastery status | **Derived** from `learning_events` every time (event sourcing), so it can never drift |
| Explanation text | Not stored in the MVP. The AI-vs-teacher agreement study needs a separate, consented, time-limited dataset (see DPIA) |

Adding any personal-data column needs a DPIA update and an ADR.

## Retention and deletion (to implement before the pilot)

- Parent deletes the account → `ON DELETE CASCADE` removes consents, profiles and events.
- Fixed retention schedule for inactive accounts: open question for the Kenyan data protection lawyer.
