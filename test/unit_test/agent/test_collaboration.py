#
#  Copyright 2026 The InfiniFlow Authors. All Rights Reserved.
#
#  Licensed under the Apache License, Version 2.0 (the "License");
#  you may not use this file except in compliance with the License.
#  You may obtain a copy of the License at
#
#      http://www.apache.org/licenses/LICENSE-2.0
#
#  Unless required by applicable law or agreed to in writing, software
#  distributed under the License is distributed on an "AS IS" BASIS,
#  WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
#  See the License for the specific language governing permissions and
#  limitations under the License.

from agent.collaboration import (
    build_previous_round_context,
    consensus_choice,
    parse_judge,
    parse_vote,
    tally_votes,
)


def _vote(task_index: int, choice: str, confidence: float) -> dict:
    return {
        "task_index": task_index,
        "worker_id": f"worker_{task_index}",
        "choice": choice,
        "confidence": confidence,
        "rationale": "",
        "status": "valid",
        "error": "",
    }


def test_parse_vote_accepts_fenced_json():
    vote = parse_vote(0, "reviewer", '```json\n{"choice": "approve", "confidence": 0.8, "rationale": "ok"}\n```')

    assert vote["status"] == "valid"
    assert vote["choice"] == "approve"
    assert vote["confidence"] == 0.8
    assert vote["rationale"] == "ok"


def test_parse_vote_accepts_inline_json_object():
    vote = parse_vote(1, "reviewer", 'Review complete: {"choice": "reject", "confidence": 2}')

    assert vote["status"] == "valid"
    assert vote["choice"] == "reject"
    assert vote["confidence"] == 2


def test_parse_vote_rejects_negative_confidence():
    vote = parse_vote(0, "reviewer", '{"choice": "approve", "confidence": -1}')

    assert vote["status"] == "invalid"
    assert vote["choice"] == ""
    assert "confidence" in vote["error"]


def test_tally_votes_breaks_equal_count_by_confidence():
    tally = tally_votes(
        [
            _vote(0, "approve", 0.4),
            _vote(1, "approve", 0.4),
            _vote(2, "reject", 0.5),
            _vote(3, "reject", 0.5),
        ]
    )

    assert tally["winner"] == "reject"
    assert tally["tie_break"] == "confidence"
    assert tally["tied"] == ["approve", "reject"]


def test_tally_votes_returns_unique_count_winner():
    tally = tally_votes(
        [
            _vote(0, "approve", 0.1),
            _vote(1, "approve", 0.1),
            _vote(2, "reject", 0.9),
        ]
    )

    assert tally["winner"] == "approve"
    assert tally["tie_break"] == "count"


def test_parse_judge_accepts_only_current_candidates():
    accepted = parse_judge('{"choice": "reject", "rationale": "lower risk"}', ["approve", "reject"])
    rejected = parse_judge('{"choice": "abstain", "rationale": "unknown"}', ["approve", "reject"])

    assert accepted["status"] == "valid"
    assert accepted["choice"] == "reject"
    assert rejected["status"] == "invalid"


def test_build_previous_round_context_excludes_self_and_failures():
    context = build_previous_round_context(
        [
            {"task_index": 0, "worker_id": "reviewer_a", "status": "ok", "content": "first view"},
            {"task_index": 1, "worker_id": "reviewer_b", "status": "ok", "content": "second view"},
            {"task_index": 2, "worker_id": "reviewer_c", "status": "error", "content": ""},
        ],
        current_task_index=1,
    )

    assert "first view" in context
    assert "second view" not in context
    assert "reviewer_c" not in context


def test_consensus_choice_requires_every_participant_to_vote_validly():
    unanimous = [
        _vote(0, "approve", 0.6),
        _vote(1, "approve", 0.7),
    ]
    invalid = [
        _vote(0, "approve", 0.6),
        {**_vote(1, "", 0), "status": "invalid", "choice": "", "error": "invalid json"},
    ]

    assert consensus_choice(unanimous, expected_count=2) == "approve"
    assert consensus_choice(invalid, expected_count=2) == ""
