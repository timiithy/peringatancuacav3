# Strong-wind indicator rule mapping

Status: accepted policy, implemented locally. Model, backend and frontend must be
rebuilt and deployed to enable the complete behavior in a hosted environment.

Source for definitions and trust tiers: the user-provided image titled
"Table B. Strong-wind (Wn) sign codes". The table supplies sign definitions and
rankings, but no action recommendations, numeric trust weights, warning levels,
report thresholds, or combination rules.

Actions marked "existing CSV" below come from
`SHAP-model-api/src/engine/lik_filtered_action_taken.csv`, not from Table B.

## Established indicator definitions

| Code | Observation from Table B | Trust tier | Action in existing CSV |
| --- | --- | --- | --- |
| Wn-1 | Clouds descend, forming clumps three times | High | Siaga Penuh / Amankan Alat Tangkap |
| Wn-2 | Cloud groups approach or merge | High | Berhati-hati / Tingkatkan kewaspadaan |
| Wn-3 | Lightning on one side of the sky or alternating between two sides | High | Sesuaikan Jadwal Melaut |
| Wn-4 | Waves change from small and frequent to large and close together | Low | Siaga Penuh / Amankan Alat Tangkap |
| Wn-5 | Dolphins approach the boat as if guiding it | Low | Berhati-hati / Tingkatkan kewaspadaan |
| Wn-6 | Seagulls fly hastily while calling loudly | Low | Berhati-hati / Tingkatkan kewaspadaan |
| Wn-7 | Transition from the west wind to the east wind | High | Berhati-hati / Tingkatkan kewaspadaan |
| Wn-8 | Overcast sky, but not too dark | High | Siaga Penuh / Amankan Alat Tangkap |
| Wn-9 | Rain or thick clouds during the east wind | Low | Sesuaikan Jadwal Melaut |
| Wn-10 | Clear, cloudless weather during the west wind | Unranked | Not supplied |
| Wn-11 | A booming sound heard once or seven times | Unranked | Not supplied |
| Wn-12 | Many twinkling stars at night during the west wind | Unranked | Not supplied |
| Wn-13 | Stars not visible at night during the east wind | Low | Berhati-hati / Tingkatkan kewaspadaan |
| Wn-14 | Stars near or aligned with the moon, including inside its halo | Unranked | Not supplied |
| Wn-15 | Cockroaches fly around inside the boat | Unranked | Not supplied |
| Wn-16 | Moon between the claws of the Scorpion constellation (Bintang Kala) | Unranked | Not supplied |
| Wn-17 | Whales surface and flap their tails | Unranked | Not supplied |

For all seven unranked signs, Table B states fewer than 20 records in Aceh.
Unranked means no ranking was established; it does not mean safe or zero risk.
High/low trust does not by itself specify high/low disaster severity.

## Implemented inference policy

1. Recognize and preserve all 17 observation codes.
2. Keep the current ten ranked signs eligible for action lookup, preserving their
   existing recommendations and priority ordering. Record high and low trust as
   separate metadata rather than inventing numeric weights.
3. Preserve unranked signs as observations awaiting validation. Until action and
   eligibility rules are supplied, do not let these signs alone create or
   escalate a local warning. The user accepted this observation-only policy;
   it is an application policy rather than a rule stated in Table B.
4. For mixed reports, use only eligible signs in local warning severity and
   combination counting. Retain the other signs in report history.
5. An observation containing only unranked signs should communicate insufficient
   evidence for local inference, rather than asserting that conditions are safe.
   BMKG assessment remains a separate input to the final warning.

## Integration details

- The current trusted-sign list already equals the ten ranked signs in Table B.
- The current model does not distinguish high and low trust in its calculations.
- Model descriptions and the PWA alert catalog now cover the same 17 Table B
  codes. Model, PWA and WhatsApp alert labels for Wn-8, Wn-9 and Wn-13 describe
  overcast sky, rain during east wind and invisible stars respectively. PWA label
  lookup accepts the model's mixed-case codes. The obsolete Wn-18 catalog entry
  was removed; it is not in the reporting form or supplied table.
- Freshness is checked before warning eligibility. Old/uncertain reports retain
  their historical dispositions. A fresh unranked-only report receives HTTP 200,
  `ok: true`, `status: pending_validation`, `inferenceStatus: insufficient_evidence`,
  `shouldDistribute: false`, empty `reportCounts` and an Indonesian explanation.
- Every new receipt contains `signAssessment.rankedCodes`, `unrankedCodes` and
  categorical `trustTiers`. SQLite retains the original complete observations
  and the acknowledgement. Retrying a stable report ID replays the receipt.
- Both backend submission routes filter ranked signs before queue updates and
  filter accepted model results afterward. Explicitly empty accepted-sign results
  cannot fall back to the submitted codes. Multiple-sign escalation counts
  accepted current-batch signs; unranked and rejected signs do not inflate it.
- Ranked existing warning signs can accompany inference. Unranked cached signs
  are filtered from new model requests and warning writes. Observation-only
  reports leave existing warnings and their expiry untouched.
- Direct model calls return `inference_status: insufficient_evidence` and
  `community_characteristics: Insufficient Evidence` when no ranked signs are
  available. `unranked_lik_codes` identifies provisional observations separately.
- The PWA stores receipt messages and inference status in IndexedDB and displays
  them after receipt and reload. Pending validation is a completed delivery,
  not a retryable failure. No IndexedDB version change is required.
- WhatsApp supports explicit codes, for example `!lapor lampuuk WN-16
  waktu=sekarang`, and descriptive phrases for provisional signs. Explicit codes
  take precedence over prose. An unknown explicit code produces the existing
  missing-sign response. Provisional acknowledgements are private/chat replies,
  never warning broadcasts. Mixed acknowledgements explain provisional signs.
- Existing generic WhatsApp aliases remain heuristic; explicit codes provide
  precise Table B attribution. This work does not establish prediction accuracy
  for any provisional sign.
- BMKG fusion for ranked reports is unchanged. Unranked-only submissions do not
  start new inference or BMKG requests. Independently configured weather lookup
  paths remain available.

The backend trust map is packaged separately from the Python JSON because each
service has its own Docker build context. A parity test prevents the two maps
from drifting. Existing cached receipts and historical alerts are preserved;
this change does not retroactively re-evaluate them. Deploy the rebuilt model,
backend and frontend together. No new environment settings or migrations are
required.

## Verification

75 targeted Python model/API tests, 108 backend tests (including 8 webhook tests
run separately), 3 frontend catalog/label checks, and 20 browser scenarios pass.
The frontend production build passes. Browser checks use installed Chrome via
`artifacts/provisional-indicators/playwright.config.ts` because bundled Chromium
is absent. Full backend TypeScript checking has existing unrelated errors; the
legacy Python API suite still imports missing constants. The dedicated API tests
exercise real predictions for all five beaches and all 17 signs.

## Information needed to enable the seven unranked signs

- Whether each sign should participate in automatic warnings, with supporting
  validation criteria or research evidence.
- Its action recommendation and action priority if it is enabled.
- Any required combinations, corroboration, or report-count thresholds.

If the seven signs remain observation-only, their missing actions can stay
explicitly unspecified. No new action CSV rows or numeric SHAP weights can be
derived from Table B alone.
