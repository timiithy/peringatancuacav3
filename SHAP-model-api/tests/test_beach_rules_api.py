"""Exercise beach-rule selection through the real prediction endpoint."""

import csv
from pathlib import Path

import pandas as pd
import pytest

from src import main


@pytest.mark.parametrize(
    "beach, expected_classification",
    [
        ("pantai_lampuuk", "Actionable"),
        ("pantai_lhoknga", "Actionable"),
        ("pantai_ulee_lheue", "Actionable"),
        ("pantai_depok", "Low Actionable"),
        ("pantai_samas", "Low Actionable"),
    ],
)
def test_predict_uses_the_complete_beach_profile(
    client, monkeypatch, beach, expected_classification
):
    captured = {}
    original_predict = main.LikInferenceEngine.predict

    def capture_prediction(engine, data):
        captured.update(data)
        return original_predict(engine, data)

    monkeypatch.setattr(main.LikInferenceEngine, "predict", capture_prediction)
    response = client.post(
        "/predict",
        json={
            "beach_location": beach,
            "lik_codes": ["WN-4"],
            "active_warning": ["wn-3"],
        },
    )

    assert response.status_code == 200
    body = response.json()
    assert body["community_characteristics"] == expected_classification
    assert set(body["triggered_lik_codes"]) == {"Wn-4", "Wn-3"}
    assert "Sesuaikan Jadwal Melaut" in body["action_recommendation"]
    assert {
        "active_warning", "sign_description", "community_characteristics",
        "action_recommendation", "triggered_lik_codes",
    } <= set(body)

    csv_path = Path(main.__file__).parent / "engine/community_rule_categorization.csv"
    with csv_path.open(newline="", encoding="utf-8") as source:
        profile = next(
            row for row in csv.DictReader(source)
            if row["Mapped Beach"] == beach.replace("_", " ")
        )
    expected_rules = {
        "Overall Category": profile["Overall Category"],
        "Level of Interaction with Disaster Status": profile["Level of Interaction with Disaster Status"],
        "Frequency of Usage Status": profile["Frequency of Usage Status"],
        "Usage Duration Status": profile["Usage Duration Status"],
        "Number of Known LIK Status": profile["Number of LIK Combination Status"],
        "Number of Experience with Disaster Status": profile["Number of Experience with Disaster Status"],
    }
    assert captured["rules"] == expected_rules


def test_depok_interaction_is_loaded_from_depok(client, monkeypatch):
    original_read_csv = pd.read_csv
    original_predict = main.LikInferenceEngine.predict
    captured = {}

    def distinct_interaction_profiles(path, *args, **kwargs):
        frame = original_read_csv(path, *args, **kwargs)
        if Path(path).name == "community_rule_categorization.csv":
            frame.loc[
                frame["Mapped Beach"] == "pantai depok",
                "Level of Interaction with Disaster Status",
            ] = "Unsafe"
        return frame

    def capture_prediction(engine, data):
        captured.update(data)
        return original_predict(engine, data)

    monkeypatch.setattr(pd, "read_csv", distinct_interaction_profiles)
    monkeypatch.setattr(main.LikInferenceEngine, "predict", capture_prediction)
    response = client.post(
        "/predict", json={"beach_location": "pantai_depok", "lik_codes": ["WN-4"]}
    )

    assert response.status_code == 200
    assert captured["rules"]["Level of Interaction with Disaster Status"] == "Unsafe"


def test_unknown_beach_is_rejected_even_with_legacy_identifiers(client):
    response = client.post(
        "/predict",
        json={
            "beach_location": "pantai_unknown",
            "lik_codes": ["WN-4"],
            "beach_id": 1,
            "beach_name": "pantai_lampuuk",
        },
    )
    assert response.status_code == 400


def test_beach_location_selects_rules_despite_conflicting_legacy_fields(client):
    response = client.post(
        "/predict",
        json={
            "beach_location": "pantai_depok",
            "lik_codes": ["WN-4"],
            "reported_codes": ["WN-3"],
            "beach_id": 1,
            "beach_name": "pantai_lampuuk",
            "rules": {"Overall Category": "Safe"},
        },
    )
    assert response.status_code == 200
    body = response.json()
    assert body["community_characteristics"] == "Low Actionable"
    assert body["triggered_lik_codes"] == ["Wn-3"]


def test_sequential_requests_do_not_reuse_another_beachs_rules(client):
    classifications = []
    for beach in ["pantai_depok", "pantai_lampuuk", "pantai_samas"]:
        response = client.post(
            "/predict", json={"beach_location": beach, "lik_codes": ["WN-4"]}
        )
        assert response.status_code == 200
        classifications.append(response.json()["community_characteristics"])
    assert classifications == ["Low Actionable", "Actionable", "Low Actionable"]
