"""Pure-logic tests for the backend allocation + workflow rules (no DB required)."""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.models import VALID_TRANSITIONS, IssueStatus
from app.services.allocation import _distance_score, _workload_score, _availability_score, haversine_km
from app.services.workflow import text_similarity


def test_happy_path_transitions():
    assert IssueStatus.UNDER_REVIEW in VALID_TRANSITIONS[IssueStatus.REPORTED]
    assert IssueStatus.ASSIGNED in VALID_TRANSITIONS[IssueStatus.UNDER_REVIEW]
    assert IssueStatus.IN_PROGRESS in VALID_TRANSITIONS[IssueStatus.ASSIGNED]
    assert IssueStatus.PENDING_VERIFICATION in VALID_TRANSITIONS[IssueStatus.IN_PROGRESS]
    assert IssueStatus.VERIFIED in VALID_TRANSITIONS[IssueStatus.PENDING_VERIFICATION]


def test_illegal_transitions_blocked():
    assert IssueStatus.VERIFIED not in VALID_TRANSITIONS[IssueStatus.REPORTED]
    assert IssueStatus.IN_PROGRESS not in VALID_TRANSITIONS[IssueStatus.PENDING_VERIFICATION]
    assert VALID_TRANSITIONS[IssueStatus.VERIFIED] == set()


def test_rework_loop():
    assert IssueStatus.REWORK_REQUIRED in VALID_TRANSITIONS[IssueStatus.PENDING_VERIFICATION]
    assert IssueStatus.IN_PROGRESS in VALID_TRANSITIONS[IssueStatus.REWORK_REQUIRED]


def test_scoring_bounds():
    assert _distance_score(0.2) == 1.0
    assert _distance_score(50) == 0.05
    assert _workload_score(0, 3) == 1.0
    assert _workload_score(3, 3) == 0.0
    assert _availability_score("AVAILABLE") == 1.0
    assert _availability_score("OFFLINE") == 0.0


def test_haversine_zero_and_positive():
    assert haversine_km(12.97, 77.59, 12.97, 77.59) == 0
    assert 1.0 < haversine_km(12.97, 77.59, 12.98, 77.60) < 3.0


def test_text_similarity():
    assert text_similarity("deep pothole near the signal", "signal pothole deep") > 0.5
    assert text_similarity("completely unrelated words", "streetlight pole") == 0.0

