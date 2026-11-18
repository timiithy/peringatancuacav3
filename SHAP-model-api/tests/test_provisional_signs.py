import pytest


UNRANKED = [10, 11, 12, 14, 15, 16, 17]
RANKED = [1, 2, 3, 4, 5, 6, 7, 8, 9, 13]
BEACHES = ["lampuuk", "lhoknga", "ulee_lheue", "depok", "samas"]


@pytest.mark.parametrize("number", UNRANKED)
@pytest.mark.parametrize("beach", BEACHES)
def test_unranked_signs_are_observations_without_a_local_inference(client, number, beach):
    response = client.post("/predict", json={
        "beach_location": f"pantai_{beach}", "lik_codes": [f"WN-{number}"],
    })
    assert response.status_code == 200
    result = response.json()
    assert result["inference_status"] == "insufficient_evidence"
    assert result["community_characteristics"] == "Insufficient Evidence"
    assert result["triggered_lik_codes"] == []
    assert result["active_warning"] == []
    assert result["unranked_lik_codes"] == [f"Wn-{number}"]
    assert f"WN-{number}" in result["sign_description"]
    assert "Bukti belum cukup" in result["action_recommendation"]
    assert "Situasi aman" not in result["action_recommendation"]


@pytest.mark.parametrize("number", RANKED)
def test_ranked_signs_keep_their_existing_recommendations(client, number):
    response = client.post("/predict", json={
        "beach_location": "pantai_lampuuk", "lik_codes": [f"WN-{number}"],
    })
    result = response.json()
    assert result["inference_status"] == "evaluated"
    assert result["triggered_lik_codes"] == [f"Wn-{number}"]
    assert result["community_characteristics"] == "Actionable"
    assert "direkomendasikan tindakan:" in result["action_recommendation"]


def test_mixed_report_retains_unranked_codes_without_changing_recommendation(client):
    def predict(codes, active=None):
        return client.post("/predict", json={
            "beach_location": "pantai_lampuuk", "lik_codes": codes,
            "active_warning": active or [],
        }).json()

    ranked = predict(["WN-4"])
    mixed = predict(["WN-4", "wn-16", "WN-10", "WN-16"], ["WN-15"])
    assert mixed["triggered_lik_codes"] == ["Wn-4"]
    assert mixed["active_warning"] == ["Wn-4"]
    assert mixed["unranked_lik_codes"] == ["Wn-16", "Wn-10"]
    assert mixed["action_recommendation"] == ranked["action_recommendation"]


def test_all_signs_have_labels_and_table_b_trust_metadata(engine):
    signs = engine.get_lik_sign_info([f"wn-{i}" for i in range(1, 18)])
    assert len(signs) == 17
    assert {s["code"] for s in signs if s["trust_tier"] == "high"} == {
        "WN-1", "WN-2", "WN-3", "WN-7", "WN-8",
    }
    assert {s["code"] for s in signs if s["trust_tier"] == "low"} == {
        "WN-4", "WN-5", "WN-6", "WN-9", "WN-13",
    }
    assert engine.LIK_LABELS["wn-8"]["label_id"] == "Langit Mendung"
    assert engine.LIK_LABELS["wn-9"]["label_id"] == "Hujan Saat Angin Timur"
    assert engine.LIK_LABELS["wn-13"]["label_id"] == "Bintang Tidak Terlihat"
