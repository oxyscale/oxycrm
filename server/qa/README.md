# QA suites

    npm run qa        # from code/server

Each suite spins up the real Express routes against a throwaway SQLite
database, drives them over HTTP, and asserts what the data looks like
afterwards. Nothing is mocked, and nothing touches a real database.

| suite | what it protects |
|---|---|
| `lifecycle` | lead to build to live to churn, and the money at every step |
| `calls` | dispositions, unanswered threshold, voicemail flag, transcripts and notes never lost |
| `merge` | folding duplicates without dropping history, and no orphaned rows |
| `report` | Business Health totals, locking a month, share links |
| `projects` | build fees, revenue start dates, deleting a project safely |
| `stages` | pipeline stages exist, accept leads, and parked ones stay out of pipeline value |

## Adding to them

When a bug is found, write the assertion that would have caught it
before writing the fix. A failing check is only useful if it fails for
the reason you think — several of the first failures here were wrong
expectations in the tests rather than faults in the product, and each
one had to be traced before it was believed.
