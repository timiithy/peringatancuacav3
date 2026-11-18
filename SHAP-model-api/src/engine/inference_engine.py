import pandas as pd
import json
from pathlib import Path

class InferenceEngine:

    SIGN_TRUST = json.loads((Path(__file__).parent / 'sign_trust.json').read_text())

    def __init__(self):
        self.df_community = pd.read_csv(Path(__file__).parent / 'community_rule_categorization.csv')

        self.pantai_lampuuk_rules = {
            'Overall Category': self.df_community.loc[self.df_community['Mapped Beach'] == 'pantai lampuuk', 'Overall Category'].iloc[0],
            'Level of Interaction with Disaster Status': self.df_community.loc[self.df_community['Mapped Beach'] == 'pantai lampuuk', 'Level of Interaction with Disaster Status'].iloc[0],
            'Frequency of Usage Status': self.df_community.loc[self.df_community['Mapped Beach'] == 'pantai lampuuk', 'Frequency of Usage Status'].iloc[0],
            'Usage Duration Status': self.df_community.loc[self.df_community['Mapped Beach'] == 'pantai lampuuk', 'Usage Duration Status'].iloc[0],
            'Number of Known LIK Status': self.df_community.loc[self.df_community['Mapped Beach'] == 'pantai lampuuk', 'Number of LIK Combination Status'].iloc[0],
            'Number of Experience with Disaster Status': self.df_community.loc[self.df_community['Mapped Beach'] == 'pantai lampuuk', 'Number of Experience with Disaster Status'].iloc[0],
        }    

        self.pantai_depok_rules = {
            'Overall Category': self.df_community.loc[self.df_community['Mapped Beach'] == 'pantai depok', 'Overall Category'].iloc[0],
            'Level of Interaction with Disaster Status': self.df_community.loc[self.df_community['Mapped Beach'] == 'pantai depok', 'Level of Interaction with Disaster Status'].iloc[0],
            'Frequency of Usage Status': self.df_community.loc[self.df_community['Mapped Beach'] == 'pantai depok', 'Frequency of Usage Status'].iloc[0],
            'Usage Duration Status': self.df_community.loc[self.df_community['Mapped Beach'] == 'pantai depok', 'Usage Duration Status'].iloc[0],
            'Number of Known LIK Status': self.df_community.loc[self.df_community['Mapped Beach'] == 'pantai depok', 'Number of LIK Combination Status'].iloc[0],
            'Number of Experience with Disaster Status': self.df_community.loc[self.df_community['Mapped Beach'] == 'pantai depok', 'Number of Experience with Disaster Status'].iloc[0],
        }    

        self.pantai_lhoknga_rules = {
            'Overall Category': self.df_community.loc[self.df_community['Mapped Beach'] == 'pantai lhoknga', 'Overall Category'].iloc[0],
            'Level of Interaction with Disaster Status': self.df_community.loc[self.df_community['Mapped Beach'] == 'pantai lhoknga', 'Level of Interaction with Disaster Status'].iloc[0],
            'Frequency of Usage Status': self.df_community.loc[self.df_community['Mapped Beach'] == 'pantai lhoknga', 'Frequency of Usage Status'].iloc[0],
            'Usage Duration Status': self.df_community.loc[self.df_community['Mapped Beach'] == 'pantai lhoknga', 'Usage Duration Status'].iloc[0],
            'Number of Known LIK Status': self.df_community.loc[self.df_community['Mapped Beach'] == 'pantai lhoknga', 'Number of LIK Combination Status'].iloc[0],
            'Number of Experience with Disaster Status': self.df_community.loc[self.df_community['Mapped Beach'] == 'pantai lhoknga', 'Number of Experience with Disaster Status'].iloc[0],
        }    

        self.pantai_ulee_lheue_rules = {
            'Overall Category': self.df_community.loc[self.df_community['Mapped Beach'] == 'pantai ulee lheue', 'Overall Category'].iloc[0],
            'Level of Interaction with Disaster Status': self.df_community.loc[self.df_community['Mapped Beach'] == 'pantai ulee lheue', 'Level of Interaction with Disaster Status'].iloc[0],
            'Frequency of Usage Status': self.df_community.loc[self.df_community['Mapped Beach'] == 'pantai ulee lheue', 'Frequency of Usage Status'].iloc[0],
            'Usage Duration Status': self.df_community.loc[self.df_community['Mapped Beach'] == 'pantai ulee lheue', 'Usage Duration Status'].iloc[0],
            'Number of Known LIK Status': self.df_community.loc[self.df_community['Mapped Beach'] == 'pantai ulee lheue', 'Number of LIK Combination Status'].iloc[0],
            'Number of Experience with Disaster Status': self.df_community.loc[self.df_community['Mapped Beach'] == 'pantai ulee lheue', 'Number of Experience with Disaster Status'].iloc[0],
        }    

        self.pantai_samas_rules = {
            'Overall Category': self.df_community.loc[self.df_community['Mapped Beach'] == 'pantai samas', 'Overall Category'].iloc[0],
            'Level of Interaction with Disaster Status': self.df_community.loc[self.df_community['Mapped Beach'] == 'pantai samas', 'Level of Interaction with Disaster Status'].iloc[0],
            'Frequency of Usage Status': self.df_community.loc[self.df_community['Mapped Beach'] == 'pantai samas', 'Frequency of Usage Status'].iloc[0],
            'Usage Duration Status': self.df_community.loc[self.df_community['Mapped Beach'] == 'pantai samas', 'Usage Duration Status'].iloc[0],
            'Number of Known LIK Status': self.df_community.loc[self.df_community['Mapped Beach'] == 'pantai samas', 'Number of LIK Combination Status'].iloc[0],
            'Number of Experience with Disaster Status': self.df_community.loc[self.df_community['Mapped Beach'] == 'pantai samas', 'Number of Experience with Disaster Status'].iloc[0],
        }                                                       

    LIK_LABELS = {
        "wn-1": {"label_id": "Awan Turun", "label_en": "Falling Clouds", "detail_id": "Awan tampak turun ke bawah membentuk gumpalan 3 kali", "detail_en": "Clouds appear to descend forming clusters 3 times"},
        "wn-2": {"label_id": "Awan Bergumpal", "label_en": "Clustered Clouds", "detail_id": "Awan bergumpal dalam beberapa kelompok yang tampak saling mendekat atau menyatu", "detail_en": "Clouds cluster in groups that appear to approach or merge"},
        "wn-3": {"label_id": "Kilat", "label_en": "Lightning", "detail_id": "Kilat muncul di salah satu sisi langit ataupun saling berbalas antara dua sisi", "detail_en": "Lightning appears on one side of the sky or flashes between two sides"},
        "wn-4": {"label_id": "Ombak Besar", "label_en": "High Waves", "detail_id": "Gelombang laut berubah pola dari kecil dan sering hingga besar dan rapat", "detail_en": "Ocean waves change pattern from small and frequent to large and dense"},
        "wn-5": {"label_id": "Lumba-lumba Mendekat", "label_en": "Approaching Dolphins", "detail_id": "Lumba-lumba mendekati perahu, seolah menggiring perahu", "detail_en": "Dolphins approach the boat, seemingly herding it"},
        "wn-6": {"label_id": "Burung Camar", "label_en": "Seagulls", "detail_id": "Burung camar terbang tergesa sambil bersuara keras", "detail_en": "Seagulls fly hastily while calling loudly"},
        "wn-7": {"label_id": "Peralihan Angin", "label_en": "Wind Transition", "detail_id": "Pada masa peralihan angin barat ke angin timur", "detail_en": "During the transition from west wind to east wind"},
        "wn-8": {"label_id": "Langit Mendung", "label_en": "Overcast Sky", "detail_id": "Langit mendung namun tidak terlalu gelap", "detail_en": "Sky is overcast but not too dark"},
        "wn-9": {"label_id": "Hujan Saat Angin Timur", "label_en": "Rain During East Wind", "detail_id": "Hujan atau langit tertutup awan tebal, saat angin timur", "detail_en": "Rain or sky covered by thick clouds during east wind"},
        "wn-10": {"label_id": "Cerah Saat Angin Barat", "label_en": "Clear During West Wind", "detail_id": "Langit cerah tanpa awan saat angin barat", "detail_en": "Clear, cloudless weather during west wind"},
        "wn-11": {"label_id": "Suara Gemuruh", "label_en": "Booming Sound", "detail_id": "Suara gemuruh terdengar sekali atau tujuh kali", "detail_en": "A booming sound is heard once or seven times"},
        "wn-12": {"label_id": "Bintang Berkelap-kelip", "label_en": "Twinkling Stars", "detail_id": "Banyak bintang berkelap-kelip di malam hari saat angin barat", "detail_en": "Many stars twinkle at night during west wind"},
        "wn-13": {"label_id": "Bintang Tidak Terlihat", "label_en": "Stars Not Visible", "detail_id": "Bintang tidak terlihat di malam hari, saat angin timur", "detail_en": "Stars not visible at night during east wind"},
        "wn-14": {"label_id": "Bintang Dekat Bulan", "label_en": "Stars Near Moon", "detail_id": "Bintang dekat atau sejajar dengan bulan, termasuk di dalam lingkaran cahaya bulan", "detail_en": "Stars appear close to or aligned with the moon, including inside its halo"},
        "wn-15": {"label_id": "Kecoa Beterbangan", "label_en": "Flying Cockroaches", "detail_id": "Kecoa beterbangan di dalam perahu", "detail_en": "Cockroaches fly around inside the boat"},
        "wn-16": {"label_id": "Bulan di Capit Bintang Kala", "label_en": "Moon Between Scorpion Claws", "detail_id": "Bulan terlihat di antara dua capit rasi Kalajengking (Bintang Kala)", "detail_en": "The moon appears between the claws of the Scorpion constellation (Bintang Kala)"},
        "wn-17": {"label_id": "Paus Mengibaskan Ekor", "label_en": "Whale Tail Flapping", "detail_id": "Paus muncul ke permukaan dan mengibaskan ekornya", "detail_en": "Whales surface and flap their tails"},
    }

    def get_lik_sign_info(self, lik_codes: list) -> list:
        return [
            {"code": code.upper(), **self.LIK_LABELS[code.lower()], "trust_tier": self.SIGN_TRUST[code.capitalize()]}
            for code in lik_codes
            if code.lower() in self.LIK_LABELS
        ]

    def predict(self, data: dict) -> dict:
        csv_path = Path(__file__).parent / 'lik_filtered_action_taken.csv'
        try:
            df_action = pd.read_csv(csv_path)
        except FileNotFoundError:
            df_action = pd.DataFrame(columns=['LIK', 'most_action_taken'])

        # Extract data input
        raw_lik_codes = data.get('lik_codes', [])
        raw_active_warning = data.get('active_warning', [])
        rules = data.get('rules', {})

        # Normalisasi format teks (misal: 'wn-2' atau 'WN-2' menjadi 'Wn-2')
        input_lik_codes = list(dict.fromkeys(str(s).strip().capitalize() for s in raw_lik_codes))
        active_warnings = [str(s).strip().capitalize() for s in raw_active_warning]
        unranked_codes = [code for code in input_lik_codes if self.SIGN_TRUST.get(code) == 'unranked']

        # ---------------------------------------------------------
        # Logic 1: Trusted signs filter
        # ---------------------------------------------------------
        trusted_signs = [code for code, tier in self.SIGN_TRUST.items() if tier != 'unranked']
        
        # Filter hanya LIK yang masuk dalam list trusted
        trusted_input_codes = [code for code in input_lik_codes if code in trusted_signs]
        trusted_active_warnings = [code for code in active_warnings if code in trusted_signs]

        # Gabungkan input nelayan dan active warning untuk dievaluasi aksinya (gunakan set agar unik)
        combined_codes = list(dict.fromkeys(trusted_input_codes + trusted_active_warnings))

        # ---------------------------------------------------------
        # Logic 2: Action recommendation (Mencari Level Tertinggi)
        # ---------------------------------------------------------
        escalation_map = {
            'berhati-hati / tingkatkan kewaspadaan': 0,
            'siaga penuh / amankan alat tangkap': 1,
            'sesuaikan jadwal melaut': 2
        }
        
        highest_level = -1
        best_action = "Tidak ada aksi"
        trigger_code = None

        if combined_codes and not df_action.empty:
            # Filter dataframe berdasarkan kombinasi LIK yang valid
            df_selected = df_action[df_action['LIK'].isin(combined_codes)].copy()
            
            if not df_selected.empty:
                # Map ke level eskalasi
                df_selected['action_lower'] = df_selected['most_action_taken'].str.lower()
                df_selected['level'] = df_selected['action_lower'].map(escalation_map).fillna(-1)
                
                # Ambil level paling tinggi
                max_idx = df_selected['level'].idxmax()
                highest_level = df_selected.loc[max_idx, 'level']
                
                if highest_level != -1:
                    best_action = df_selected.loc[max_idx, 'most_action_taken']
                    trigger_code = df_selected.loc[max_idx, 'LIK']

        # Format output rekomendasi aksi
        if highest_level != -1:
            # Format sesuai instruksi: "LIK_code: action level: action response" atau kata-kata
            action_recommendation = f"Berdasarkan indikasi: {self.get_lik_sign_info([trigger_code])[0]['detail_id']}, direkomendasikan tindakan: {best_action}."
        else:
            action_recommendation = "Bukti belum cukup untuk inferensi tanda alam. Tidak ada rekomendasi tindakan yang tervalidasi untuk tanda yang diterima; ini bukan konfirmasi kondisi aman."

        # ---------------------------------------------------------
        # Logic 3: Get Sign Description
        # ---------------------------------------------------------
        desc_list = self.get_lik_sign_info(combined_codes or unranked_codes)

        extracted_descriptions = []
        if desc_list:
            for item in desc_list:
                extracted_descriptions.append(" - ".join([str(item["code"]), str(item["detail_id"])]))

        sign_description_str = " | ".join(extracted_descriptions) if extracted_descriptions else "Tidak ada deskripsi tanda alam yang valid."

        # ---------------------------------------------------------
        # Community risk categorization (Format: Boolean)
        # ---------------------------------------------------------
        # Return False jika 'Unsafe' (Low Actionable), True jika sebaliknya (Actionable)
        is_actionable = "Low Actionable" if rules.get('Overall Category') == "Unsafe" else "Actionable"
        if not combined_codes:
            is_actionable = "Insufficient Evidence"

        # ---------------------------------------------------------
        # Return Final Output JSON
        # ---------------------------------------------------------
        return {
            "active_warning": combined_codes,
            "sign_description": sign_description_str,
            "community_characteristics": is_actionable,
            "action_recommendation": action_recommendation,
            "triggered_lik_codes": combined_codes,
            "inference_status": "evaluated" if combined_codes else "insufficient_evidence",
            "unranked_lik_codes": unranked_codes,
        }

    ESCALATION_WEIGHTS = {
        0: 0.3,
        1: 0.6,
        2: 0.9,
    }

    COMMUNITY_FACTOR_META = {
        "interaction": {
            "label_id": "Interaksi Bencana",
            "label_en": "Disaster Interaction",
            "rule_key": "Level of Interaction with Disaster Status",
            "detail_safe_id": "Cukup berinteraksi dengan bencana",
            "detail_safe_en": "Adequate disaster interaction",
            "detail_unsafe_id": "Kurang berinteraksi dengan bencana",
            "detail_unsafe_en": "Limited disaster interaction",
        },
        "frequency": {
            "label_id": "Frekuensi Pelaporan",
            "label_en": "Reporting Frequency",
            "rule_key": "Frequency of Usage Status",
            "detail_safe_id": "Sering menggunakan sistem",
            "detail_safe_en": "Frequently uses the system",
            "detail_unsafe_id": "Jarang menggunakan sistem",
            "detail_unsafe_en": "Rarely uses the system",
        },
        "duration": {
            "label_id": "Durasi Penggunaan",
            "label_en": "Usage Duration",
            "rule_key": "Usage Duration Status",
            "detail_safe_id": "Lama menggunakan sistem",
            "detail_safe_en": "Long usage duration",
            "detail_unsafe_id": "Durasi penggunaan singkat",
            "detail_unsafe_en": "Short usage duration",
        },
        "lik_combination": {
            "label_id": "Kombinasi LIK",
            "label_en": "LIK Combination",
            "rule_key": "Number of Known LIK Status",
            "detail_safe_id": "Cukup mengenal tanda alam",
            "detail_safe_en": "Adequate knowledge of natural signs",
            "detail_unsafe_id": "Kurang mengenal tanda alam",
            "detail_unsafe_en": "Limited knowledge of natural signs",
        },
        "experience": {
            "label_id": "Pengalaman Bencana",
            "label_en": "Disaster Experience",
            "rule_key": "Number of Experience with Disaster Status",
            "detail_safe_id": "Pengalaman bencana memadai",
            "detail_safe_en": "Adequate disaster experience",
            "detail_unsafe_id": "Pengalaman bencana terbatas",
            "detail_unsafe_en": "Limited disaster experience",
        },
    }

    def compute_contributions(self, prediction: dict, rules: dict, beach_location: str = "") -> dict:
        import pandas as pd
        from pathlib import Path

        contributions = []

        triggered_codes = prediction.get("triggered_lik_codes", [])
        csv_path = Path(__file__).parent / 'lik_filtered_action_taken.csv'
        df_action = pd.read_csv(csv_path)
        escalation_map = {
            'berhati-hati / tingkatkan kewaspadaan': 0,
            'siaga penuh / amankan alat tangkap': 1,
            'sesuaikan jadwal melaut': 2,
        }

        for code in triggered_codes:
            sign_info = self.get_lik_sign_info([code.lower()])
            if not sign_info:
                continue
            info = sign_info[0]
            row = df_action[df_action['LIK'] == code]
            if row.empty:
                continue
            action_str = row.iloc[0]['most_action_taken'].lower()
            level = escalation_map.get(action_str, 0)
            raw_weight = self.ESCALATION_WEIGHTS.get(level, 0.3)
            contributions.append({
                "factor": code,
                "label_id": info["label_id"],
                "label_en": info["label_en"],
                "category": "natural_sign",
                "weight": raw_weight,
                "direction": "increases_risk",
                "detail_id": info["detail_id"],
                "detail_en": info["detail_en"],
            })

        community_profile_factors = []
        beach_slug = beach_location.replace("_", " ") if beach_location else None
        csv_row = self.df_community[self.df_community['Mapped Beach'] == beach_slug] if beach_slug else None

        for key, meta in self.COMMUNITY_FACTOR_META.items():
            status = rules.get(meta["rule_key"], "Safe")
            is_unsafe = status == "Unsafe"
            raw_weight = 0.5 if is_unsafe else 0.0
            value = self._get_community_value_from_row(csv_row, key) if csv_row is not None and not csv_row.empty else 0.0

            contributions.append({
                "factor": key,
                "label_id": meta["label_id"],
                "label_en": meta["label_en"],
                "category": "community",
                "weight": raw_weight,
                "direction": "increases_risk" if is_unsafe else "neutral",
                "detail_id": meta["detail_unsafe_id"] if is_unsafe else meta["detail_safe_id"],
                "detail_en": meta["detail_unsafe_en"] if is_unsafe else meta["detail_safe_en"],
            })

            community_profile_factors.append({
                "key": key,
                "label_id": meta["label_id"],
                "label_en": meta["label_en"],
                "value": value,
                "status": status,
                "detail_id": meta["detail_unsafe_id"] if is_unsafe else meta["detail_safe_id"],
                "detail_en": meta["detail_unsafe_en"] if is_unsafe else meta["detail_safe_en"],
            })

        total = sum(c["weight"] for c in contributions)
        if total > 0:
            for c in contributions:
                c["weight"] = round(c["weight"] / total, 2)

        contributions.sort(key=lambda x: x["weight"], reverse=True)

        summary_parts_id = []
        summary_parts_en = []
        for c in contributions[:5]:
            if c["weight"] > 0:
                summary_parts_id.append(f"{c['label_id'].lower()} ({int(c['weight'] * 100)}%)")
                summary_parts_en.append(f"{c['label_en'].lower()} ({int(c['weight'] * 100)}%)")

        summary_id = f"Bahaya karena {', '.join(summary_parts_id)}" if summary_parts_id else "Tidak ada faktor risiko terdeteksi."
        summary_en = f"Danger due to {', '.join(summary_parts_en)}" if summary_parts_en else "No risk factors detected."

        overall = rules.get("Overall Category", "Safe")

        return {
            "summary_id": summary_id,
            "summary_en": summary_en,
            "contributions": contributions,
            "community_profile": {
                "beach": beach_location if beach_location else "unknown",
                "overall": overall,
                "factors": community_profile_factors,
            },
        }

    def _get_community_value_from_row(self, csv_row, factor_key: str) -> float:
        csv_col_map = {
            "interaction": "Level of Interaction with Disaster",
            "frequency": "Frequency of Usage (max) (in month)",
            "duration": "Usage Duration",
            "lik_combination": "Number of LIK Combination",
            "experience": "Number of Experience with Disaster",
        }
        col_name = csv_col_map.get(factor_key)
        if not col_name:
            return 0.0
        if csv_row is None or csv_row.empty:
            return 0.0
        return float(csv_row.iloc[0][col_name]) if col_name in csv_row.columns else 0.0
