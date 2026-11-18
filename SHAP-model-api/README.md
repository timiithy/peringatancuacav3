# Dokumentasi Skenario Pengujian API (Hybrid SHAP)

## Current `/predict` beach-rule integration

The endpoint selects the server-owned community profile from
`src/engine/community_rule_categorization.csv` using `beach_location`, then passes
all six rule fields into `InferenceEngine.predict()` as `rules`. Legacy
`beach_id`/`beach_name` values and client-supplied rules do not select or override
the profile. An unsupported beach slug returns HTTP 400.

When at least one ranked sign is evaluated, the current CSV and classification
logic produce:

| `beach_location` | CSV `Overall Category` | Response `community_characteristics` |
| --- | --- | --- |
| `pantai_lampuuk` | Safe | Actionable |
| `pantai_lhoknga` | Safe | Actionable |
| `pantai_ulee_lheue` | Safe | Actionable |
| `pantai_depok` | Unsafe | Low Actionable |
| `pantai_samas` | Unsafe | Low Actionable |

These are community-profile classifications, not current weather measurements.
Previously the endpoint omitted `rules`, causing every beach to default to
`Actionable`. Depok's interaction-status lookup now also reads Depok's own row.

Both app and WhatsApp reports already send `beach_location` through the backend,
so no client payload changes are needed. The response still contains
`active_warning`, `sign_description`, `community_characteristics`,
`action_recommendation`, and `triggered_lik_codes`. It also returns
`inference_status` (`evaluated` or `insufficient_evidence`) and
`unranked_lik_codes`.

`src/engine/sign_trust.json` records Table B's five high-trust signs, five
low-trust signs, and seven unranked signs. All 17 signs have descriptions. Only
ranked signs participate in action lookup; the action CSV is unchanged. With no
ranked evidence, `community_characteristics` becomes `Insufficient Evidence`,
and the recommendation explains the lack of validated evidence instead of
asserting safe conditions. Mixed reports retain unranked codes separately.

Both backend submission routes store the complete report, then queue ranked
codes only. Fresh unranked-only reports receive a durable `pending_validation`
acknowledgement, without calling inference, refreshing warnings or broadcasting.
They are not indefinitely queued waiting for more votes. See
`../docs/strong-wind-rule-mapping.md` for the policy and rollout details.

The backend currently maps `Low Actionable` to a local `NORMAL` level; BMKG can
still raise the final level. This integration therefore changes warning outcomes
for Depok and Samas by applying the existing profile policy. No new action
recommendations or numeric trust weights are introduced. Explanation generation
remains separate from this change.

Run the beach-rule API regression tests and existing engine tests from this
directory:

```text
python -m pytest tests/test_beach_rules_api.py tests/test_inference.py tests/test_provisional_signs.py -q
```

The scenarios below are historical examples; their response fields differ from
the current endpoint contract described above.

Gunakan kumpulan JSON di bawah ini untuk menguji endpoint /predict pada API. Seluruh skenario didasarkan pada ambang batas matematis (tipping points) yang diekstraksi dari analisis dan pemodelan rule based SHAP.

## Skenario 1: Community Unsafe & Tanda dalam Trust Index
Contoh Kondisi: Komunitas memiliki karakteristik perilaku tidak aman dan melaporkan tanda alam dengan validitas tinggi (WN-3).

```JSON
{
  "lik_codes": ["wn-3"],
  "beach_location": "pantai_depok",
}
```

Ekspektasi return:

```JSON
{
    "community_risk_behaviour": "Unsafe",
    "description": "Komunitas diklasifikasikan berisiko tinggi karena terdeteksi karakteristik: Frekuensi Penggunaan Tanda Alam Rendah, Durasi Penggunaan Tanda Alam Rendah, Pengetahuan Tanda Alam Lokal Kurang. Terdeteksi tanda alam dengan tingkat kepercayaan tinggi: WN-3.",
    "detected_signs": [
        {
            "code": "WN-3",
            "description": "Kilat muncul di salah satu sisi langit ataupun saling berbalas antara dua sisi"
        }
    ]
}
```

## Skenario 2: Community Safe & Tanda dalam Trust Index
Contoh Kondisi: Komunitas tidak memiliki karakteristik perilaku tidak aman dan melaporkan tanda alam dengan validitas tinggi (WN-3).

```JSON
{
    "lik_codes": ["wn-3"],
    "beach_location": "pantai_lampuuk"
}
```

Ekspektasi return:

```JSON
{
    "community_risk_behaviour": "Safe",
    "description": "Komunitas tidak memenuhi kriteria risiko tinggi pada profil demografis/behavior. Terdeteksi tanda alam dengan tingkat kepercayaan tinggi: WN-3.",
    "detected_signs": [
        {
            "code": "WN-3",
            "description": "Kilat muncul di salah satu sisi langit ataupun saling berbalas antara dua sisi"
        }
    ]
}
```

## Skenario 3: Terdeteksi 3 tanda alam atau lebih

```JSON
{
    "lik_codes": ["wn-3", "wn-1", "wn-12"],
    "beach_location": "pantai_lampuuk"
}
```

Ekspektasi return:

```JSON
{
    "community_risk_behaviour": "Safe",
    "description": "Komunitas tidak memenuhi kriteria risiko tinggi pada profil demografis/behavior. Harap berhati-hati, terdeteksi 3 atau lebih tanda alam pengetahuan lokal. Terdeteksi tanda alam dengan tingkat kepercayaan tinggi: WN-3, WN-1.",
    "detected_signs": [
        {
            "code": "WN-3",
            "description": "Kilat muncul di salah satu sisi langit ataupun saling berbalas antara dua sisi"
        },
        {
            "code": "WN-1",
            "description": "Awan tampak turun ke bawah membentuk gumpalan 3 kali"
        },
        {
            "code": "WN-12",
            "description": "Banyak bintang di malam hari berkelap kelip, saat angin barat"
        }
    ]
}
```

## Catatan Implementasi untuk Developer
**community_risk_behaviour**: Jika Unsafe, pengembang disarankan untuk memicu Extra Warning pada antarmuka pengguna.

**Multimodal Detection**: Deteksi lebih dari 3 tanda alam (seperti skenario 5-8) secara teknis meningkatkan level bahaya meskipun profil user aman.
