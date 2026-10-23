"""Gemma 4 integration — verified multimodal model family.

Model ids (instruction-tuned, as deployed by Google AI Studio):
  gemma-4-26b-a4b-it   26B total / ~4B active MoE — fast, free-tier friendly
  gemma-4-31b-it       31B dense — highest quality

Endpoint: {GEMMA_ENDPOINT}/models/{model}:generateContent  (x-goog-api-key auth)
Images are passed as inlineData base64 parts (image input supported).
When GEMMA_API_KEY is empty the backend returns an explicitly-labelled
development stub — never pretending to be a model.
"""
import json
import re
import httpx
from ..config import settings

CATEGORIES = ("pothole", "streetlight")


def _extract_json(raw: str) -> dict:
    text = raw.strip()
    fence = re.search(r"```(?:json)?\s*([\s\S]*?)```", text, re.I)
    if fence:
        text = fence.group(1).strip()
    start, end = text.find("{"), text.rfind("}")
    if start >= 0 and end > start:
        text = text[start:end + 1]
    return json.loads(text)


def _call_gemma(parts: list[dict]) -> str:
    model = settings.GEMMA_MODEL
    url = f"{settings.GEMMA_ENDPOINT.rstrip('/')}/models/{model}:generateContent"
    with httpx.Client(timeout=45.0) as client:
        res = client.post(
            url,
            headers={"Content-Type": "application/json", "x-goog-api-key": settings.GEMMA_API_KEY},
            json={
                "contents": [{"role": "user", "parts": parts}],
                "generationConfig": {"temperature": 0.2, "maxOutputTokens": 1024, "responseMimeType": "application/json"},
            },
        )
    if res.status_code != 200:
        raise RuntimeError(f"Gemma API {res.status_code}: {res.text[:240]}")
    data = res.json()
    out = "".join(p.get("text", "") for c in data.get("candidates", []) for p in c.get("content", {}).get("parts", []))
    if not out.strip():
        raise RuntimeError("Gemma returned empty completion")
    return out


def image_part_from_path(path: str) -> dict:
    import base64, mimetypes
    mime = mimetypes.guess_type(path)[0] or "image/jpeg"
    with open(path, "rb") as fh:
        return {"inlineData": {"mimeType": mime, "data": base64.b64encode(fh.read()).decode()}}


def analyze_issue(description: str, image_path: str | None = None) -> dict:
    """Returns validated, sanitized structured analysis."""
    if settings.GEMMA_API_KEY:
        prompt = (
            "You are CIVICXON's civic-infrastructure triage assistant. Analyse this citizen report and respond with STRICT JSON only:\n"
            '{"category": "pothole"|"streetlight", "severity": "low"|"moderate"|"severe"|"critical", "description": string, "riskIndicators": string[], "confidence": number 0..1, "departmentSuggestion": string, "explanation": string}\n'
            f'Report: """{description[:1500]}"""'
        )
        parts: list[dict] = [{"text": prompt}]
        if image_path:
            try:
                parts.append(image_part_from_path(image_path))
            except OSError:
                pass
        try:
            parsed = _extract_json(_call_gemma(parts))
            return {
                "provider": "gemma-4",
                "model": settings.GEMMA_MODEL,
                "category": parsed.get("category") if parsed.get("category") in CATEGORIES else "pothole",
                "severity": parsed.get("severity") if parsed.get("severity") in ("low", "moderate", "severe", "critical") else "moderate",
                "description": str(parsed.get("description", description))[:400],
                "riskIndicators": [str(x) for x in parsed.get("riskIndicators", [])][:5] if isinstance(parsed.get("riskIndicators"), list) else [],
                "confidence": min(1.0, max(0.0, float(parsed.get("confidence", 0.6)))),
                "departmentSuggestion": str(parsed.get("departmentSuggestion", "Road Maintenance Department"))[:120],
                "explanation": str(parsed.get("explanation", "Gemma 4 analysis."))[:800],
            }
        except Exception as exc:  # fall back with explicit label — never silently fake
            return {**_dev_analysis(description), "explanation": f"[DEVELOPMENT-ONLY FALLBACK — Gemma 4 call failed: {str(exc)[:120]}] Deterministic keyword analysis."}
    return {**_dev_analysis(description), "explanation": "[DEVELOPMENT-ONLY heuristic — set GEMMA_API_KEY for real Gemma 4] Keyword-severity scan of the report text."}


def assess_repair(before_path: str, after_path: str, category: str, description: str) -> dict:
    if settings.GEMMA_API_KEY:
        prompt = (
            "You are CIVICXON's repair-verification assistant. FIRST image = original citizen-reported "
            f"{'road defect' if category == 'pothole' else 'streetlight fault'}. SECOND image = after-repair evidence. "
            'Respond with STRICT JSON only: {"outcome": "likely_resolved"|"not_resolved"|"uncertain", "explanation": string, "limitations": string, "confidence": number 0..1}\n'
            "Similarity is NOT proof of resolution. If unsure, answer uncertain. You may NOT close tickets — an admin decides.\n"
            f'Original report: """{description[:800]}"""'
        )
        parts = [{"text": prompt}]
        try:
            parts.append(image_part_from_path(before_path))
            parts.append(image_part_from_path(after_path))
        except OSError:
            return {**_dev_verification(), "explanation": "[DEVELOPMENT-ONLY FALLBACK — image unreadable by the server] An administrator must inspect the evidence manually."}
        try:
            parsed = _extract_json(_call_gemma(parts))
            outcome = parsed.get("outcome") if parsed.get("outcome") in ("likely_resolved", "not_resolved", "uncertain") else "uncertain"
            return {
                "provider": "gemma-4",
                "model": settings.GEMMA_MODEL,
                "outcome": outcome,
                "explanation": str(parsed.get("explanation", "Gemma 4 compared the images."))[:800],
                "limitations": str(parsed.get("limitations", "Photo comparison cannot verify structural quality."))[:400],
                "confidence": min(1.0, max(0.0, float(parsed.get("confidence", 0.55)))),
            }
        except Exception as exc:
            return {**_dev_verification(), "explanation": f"[DEVELOPMENT-ONLY FALLBACK — Gemma 4 call failed: {str(exc)[:120]}] Admin must inspect manually."}
    return {**_dev_verification(), "explanation": "[DEVELOPMENT-ONLY heuristic — set GEMMA_API_KEY for real Gemma 4 image comparison] No pixels were compared; outcome is 'uncertain' so an admin always decides."}


def _dev_analysis(description: str) -> dict:
    text = description.lower()
    if re.search(r"street\s?light|lamp|pole|bulb|lighting", text):
        category = "streetlight"
        dept = "Streetlight Maintenance Department"
    else:
        category = "pothole"
        dept = "Road Maintenance Department"
    if re.search(r"accident|injur|electrocut|sparking|school|hospital|collapse", text):
        severity = "critical"
    elif re.search(r"deep|large|dangerous|unsafe|crater|pitch dark", text):
        severity = "severe"
    elif re.search(r"small|minor|tiny|dim", text):
        severity = "low"
    else:
        severity = "moderate"
    risks = [label for pattern, label in [
        (r"accident|injur", "Accident risk reported"),
        (r"school|hospital", "Sensitive zone nearby"),
        (r"night|dark|unsafe|safety", "Night-time safety risk"),
        (r"spark|wire|electrocut", "Electrical hazard"),
        (r"rain|flood|water", "Monsoon/water damage"),
    ] if re.search(pattern, text)]
    return {"provider": "heuristic", "model": None, "category": category, "severity": severity,
            "description": description[:140], "riskIndicators": risks[:5], "confidence": 0.55,
            "departmentSuggestion": dept, "explanation": ""}


def _dev_verification() -> dict:
    return {"provider": "heuristic", "model": None, "outcome": "uncertain", "explanation": "",
            "limitations": "No pixel-level comparison performed in development mode.", "confidence": 0.4}
