import pytest


class TestTrustedSignFiltering:

    def test_untrusted_codes_are_dropped(self, engine):
        data = {
            "lik_codes": ["wn-10", "wn-11", "wn-1"],
            "active_warning": [],
            "rules": engine.pantai_lampuuk_rules,
        }
        result = engine.predict(data)
        assert result["triggered_lik_codes"] == ["Wn-1"]

    def test_all_trusted_codes_pass_through(self, engine):
        data = {
            "lik_codes": ["wn-1", "wn-3", "wn-9"],
            "active_warning": [],
            "rules": engine.pantai_lampuuk_rules,
        }
        result = engine.predict(data)
        assert set(result["triggered_lik_codes"]) == {"Wn-1", "Wn-3", "Wn-9"}

    def test_active_warning_merged_with_input(self, engine):
        data = {
            "lik_codes": ["wn-1"],
            "active_warning": ["wn-8"],
            "rules": engine.pantai_lampuuk_rules,
        }
        result = engine.predict(data)
        assert set(result["triggered_lik_codes"]) == {"Wn-1", "Wn-8"}

    def test_duplicate_codes_deduplicated(self, engine):
        data = {
            "lik_codes": ["wn-1"],
            "active_warning": ["wn-1"],
            "rules": engine.pantai_lampuuk_rules,
        }
        result = engine.predict(data)
        assert result["triggered_lik_codes"] == ["Wn-1"]


class TestActionEscalation:

    def test_highest_action_wins(self, engine):
        data = {
            "lik_codes": ["wn-1", "wn-2", "wn-3"],
            "active_warning": [],
            "rules": engine.pantai_lampuuk_rules,
        }
        result = engine.predict(data)
        assert "Sesuaikan Jadwal Melaut" in result["action_recommendation"]

    def test_single_code_returns_its_action(self, engine):
        data = {
            "lik_codes": ["wn-4"],
            "active_warning": [],
            "rules": engine.pantai_lampuuk_rules,
        }
        result = engine.predict(data)
        assert "Siaga Penuh" in result["action_recommendation"]

    def test_empty_input_returns_insufficient_evidence(self, engine):
        data = {
            "lik_codes": [],
            "active_warning": [],
            "rules": engine.pantai_lampuuk_rules,
        }
        result = engine.predict(data)
        assert result["triggered_lik_codes"] == []
        assert result["inference_status"] == "insufficient_evidence"
        assert "Bukti belum cukup" in result["action_recommendation"]


class TestResponseShape:

    def test_response_preserves_fields_and_adds_evidence_status(self, engine):
        data = {
            "lik_codes": ["wn-3"],
            "active_warning": [],
            "rules": engine.pantai_lampuuk_rules,
        }
        result = engine.predict(data)
        expected_keys = {"active_warning", "sign_description", "community_characteristics", "action_recommendation", "triggered_lik_codes"}
        assert expected_keys <= set(result.keys())
        assert result["inference_status"] == "evaluated"
        assert result["unranked_lik_codes"] == []

    def test_triggered_lik_codes_matches_active_warning(self, engine):
        data = {
            "lik_codes": ["wn-3", "wn-7"],
            "active_warning": [],
            "rules": engine.pantai_lampuuk_rules,
        }
        result = engine.predict(data)
        assert result["triggered_lik_codes"] == result["active_warning"]


class TestBeachCommunityCharacteristics:

    def test_depok_is_unsafe(self, engine):
        data = {
            "lik_codes": ["wn-3"],
            "active_warning": [],
            "rules": engine.pantai_depok_rules,
        }
        result = engine.predict(data)
        assert result["community_characteristics"] == "Low Actionable"

    def test_lampuuk_is_safe(self, engine):
        data = {
            "lik_codes": ["wn-3"],
            "active_warning": [],
            "rules": engine.pantai_lampuuk_rules,
        }
        result = engine.predict(data)
        assert result["community_characteristics"] == "Actionable"


class TestSignDescriptions:

    def test_valid_code_returns_info(self, engine):
        descs = engine.get_lik_sign_info(["wn-1"])
        assert len(descs) == 1
        assert descs[0]["code"] == "WN-1"
        assert "Awan tampak turun" in descs[0]["detail_id"]
        assert descs[0]["label_id"] == "Awan Turun"
        assert descs[0]["label_en"] == "Falling Clouds"
        assert descs[0]["detail_en"] == "Clouds appear to descend forming clusters 3 times"

    def test_invalid_code_returns_empty(self, engine):
        descs = engine.get_lik_sign_info(["wn-99"])
        assert descs == []

    def test_mixed_valid_invalid(self, engine):
        descs = engine.get_lik_sign_info(["wn-1", "wn-99", "wn-3"])
        assert len(descs) == 2
        codes = {d["code"] for d in descs}
        assert codes == {"WN-1", "WN-3"}


class TestComputeContributions:

    def test_contributions_with_unsafe_beach(self, engine):
        data = {
            "lik_codes": ["wn-4", "wn-7"],
            "active_warning": [],
            "rules": engine.pantai_samas_rules,
        }
        prediction = engine.predict(data)
        contributions = engine.compute_contributions(prediction, engine.pantai_samas_rules, "pantai_samas")
        assert "contributions" in contributions
        assert "community_profile" in contributions
        assert "summary_id" in contributions
        assert "summary_en" in contributions
        assert len(contributions["contributions"]) > 0
        assert contributions["community_profile"]["beach"] == "pantai_samas"
        total_weight = sum(c["weight"] for c in contributions["contributions"])
        assert abs(total_weight - 1.0) < 0.01

    def test_contributions_with_safe_beach(self, engine):
        data = {
            "lik_codes": ["wn-2"],
            "active_warning": [],
            "rules": engine.pantai_lampuuk_rules,
        }
        prediction = engine.predict(data)
        contributions = engine.compute_contributions(prediction, engine.pantai_lampuuk_rules, "pantai_lampuuk")
        assert len(contributions["contributions"]) > 0
        community_factors = [c for c in contributions["contributions"] if c["category"] == "community"]
        safe_factors = [c for c in community_factors if c["direction"] == "neutral"]
        assert len(safe_factors) == 4

    def test_contributions_no_lik_codes(self, engine):
        data = {
            "lik_codes": [],
            "active_warning": [],
            "rules": engine.pantai_samas_rules,
        }
        prediction = engine.predict(data)
        contributions = engine.compute_contributions(prediction, engine.pantai_samas_rules, "pantai_samas")
        natural_signs = [c for c in contributions["contributions"] if c["category"] == "natural_sign"]
        assert len(natural_signs) == 0

    def test_contributions_sorted_by_weight_desc(self, engine):
        data = {
            "lik_codes": ["wn-4", "wn-7"],
            "active_warning": [],
            "rules": engine.pantai_samas_rules,
        }
        prediction = engine.predict(data)
        contributions = engine.compute_contributions(prediction, engine.pantai_samas_rules, "pantai_samas")
        weights = [c["weight"] for c in contributions["contributions"]]
        assert weights == sorted(weights, reverse=True)

    def test_community_profile_has_all_five_factors(self, engine):
        data = {
            "lik_codes": ["wn-3"],
            "active_warning": [],
            "rules": engine.pantai_depok_rules,
        }
        prediction = engine.predict(data)
        contributions = engine.compute_contributions(prediction, engine.pantai_depok_rules, "pantai_depok")
        profile = contributions["community_profile"]
        assert profile["overall"] == "Unsafe"
        assert len(profile["factors"]) == 5
        factor_keys = [f["key"] for f in profile["factors"]]
        assert set(factor_keys) == {"interaction", "frequency", "duration", "lik_combination", "experience"}
